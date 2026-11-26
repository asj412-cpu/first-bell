-- Managed family members on the gift list (GJP-2).
-- Additive only: one new table, new helper/RPC functions, and new RLS policies.
-- No existing rows, columns, functions, or policies are changed or dropped.
-- Do not apply until Andrew approves the pull request.
-- No service role key belongs in the app or this repo.
--
-- An invited gift-list member (say Sarah) can add people under herself, such as
-- her husband and kids. Each managed person is a name-only profile: no account,
-- email, or invite. Each one gets an ordinary exchange gift list plus a
-- gift_participants row (in_draw = false, user_id NULL), so they show and can be
-- claimed exactly like any other list. gift_managed_members records who manages
-- the list.
--
-- Who can change a managed person or their items: the managing member and the
-- household owner (Andrew). Enforced in three places:
--   1. RLS on gift_managed_members: read for household members and the manager;
--      direct writes only for the household owner. Managers write only through
--      the SECURITY DEFINER functions below, so nobody can mark someone else's
--      list as "managed by me".
--   2. RESTRICTIVE policies on gift_lists and gift_items: a household member who
--      is not the owner cannot change a managed list or its items directly.
--   3. Every function below checks private.manages_gift_list() first.
-- Claims are untouched: claim_gift_item / mark_gift_purchased run as definer and
-- work the same as for every other list.

CREATE TABLE IF NOT EXISTS public.gift_managed_members (
  list_id uuid PRIMARY KEY REFERENCES public.gift_lists (id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.gift_participants (id) ON DELETE SET NULL,
  manager_participant_id uuid REFERENCES public.gift_participants (id) ON DELETE SET NULL,
  manager_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  manager_name text NOT NULL CHECK (char_length(btrim(manager_name)) BETWEEN 1 AND 80),
  relationship text CHECK (relationship IS NULL OR char_length(relationship) <= 40),
  age_label text CHECK (age_label IS NULL OR char_length(age_label) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_managed_members_manager_idx
  ON public.gift_managed_members (manager_user_id);
CREATE INDEX IF NOT EXISTS gift_managed_members_household_idx
  ON public.gift_managed_members (household_id);

ALTER TABLE public.gift_managed_members ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when the caller is the household owner. Wraps private.is_household_admin,
-- which authenticated cannot call directly, so RLS policies can use it.
CREATE OR REPLACE FUNCTION private.is_gift_household_owner(hid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.is_household_admin(hid); $$;

-- True when the caller may change this managed list: its manager, or the
-- household owner. False for lists that are not managed.
CREATE OR REPLACE FUNCTION private.manages_gift_list(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.gift_managed_members m
    WHERE m.list_id = p_list
      AND (SELECT auth.uid()) IS NOT NULL
      AND (
        m.manager_user_id = (SELECT auth.uid())
        OR (SELECT private.is_household_admin(m.household_id))
      )
  );
$$;

-- True when a direct table write to this list is allowed by the managed rule:
-- the list is not managed, or the caller manages it.
CREATE OR REPLACE FUNCTION private.managed_list_write_ok(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.gift_managed_members m WHERE m.list_id = p_list)
      OR (SELECT private.manages_gift_list(p_list));
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS gift_managed_members_read ON public.gift_managed_members;
CREATE POLICY gift_managed_members_read
  ON public.gift_managed_members
  FOR SELECT
  TO authenticated
  USING (
    manager_user_id = (SELECT auth.uid())
    OR (SELECT private.is_household_member(household_id))
  );

DROP POLICY IF EXISTS gift_managed_members_owner_write ON public.gift_managed_members;
CREATE POLICY gift_managed_members_owner_write
  ON public.gift_managed_members
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_gift_household_owner(household_id)))
  WITH CHECK ((SELECT private.is_gift_household_owner(household_id)));

-- Restrictive guards. They narrow the existing household-member policies only
-- for managed lists; every other list behaves exactly as before.
DROP POLICY IF EXISTS gift_lists_managed_update_guard ON public.gift_lists;
CREATE POLICY gift_lists_managed_update_guard
  ON public.gift_lists AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.managed_list_write_ok(id)))
  WITH CHECK ((SELECT private.managed_list_write_ok(id)));

DROP POLICY IF EXISTS gift_lists_managed_delete_guard ON public.gift_lists;
CREATE POLICY gift_lists_managed_delete_guard
  ON public.gift_lists AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING ((SELECT private.managed_list_write_ok(id)));

DROP POLICY IF EXISTS gift_items_managed_insert_guard ON public.gift_items;
CREATE POLICY gift_items_managed_insert_guard
  ON public.gift_items AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.managed_list_write_ok(list_id)));

DROP POLICY IF EXISTS gift_items_managed_update_guard ON public.gift_items;
CREATE POLICY gift_items_managed_update_guard
  ON public.gift_items AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.managed_list_write_ok(list_id)))
  WITH CHECK ((SELECT private.managed_list_write_ok(list_id)));

DROP POLICY IF EXISTS gift_items_managed_delete_guard ON public.gift_items;
CREATE POLICY gift_items_managed_delete_guard
  ON public.gift_items AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING ((SELECT private.managed_list_write_ok(list_id)));

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.managed_member_json(p_list uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'list_id', l.id,
    'kid_key', l.kid_key,
    'display_name', l.display_name,
    'occasion', l.occasion,
    'share_slug', l.share_slug,
    'list_kind', l.list_kind,
    'participant_id', m.participant_id,
    'manager_name', m.manager_name,
    'relationship', m.relationship,
    'age_label', m.age_label,
    'mine', m.manager_user_id IS NOT DISTINCT FROM (SELECT auth.uid()),
    'can_edit', (SELECT private.manages_gift_list(l.id))
  )
  FROM public.gift_managed_members m
  JOIN public.gift_lists l ON l.id = m.list_id
  WHERE m.list_id = p_list;
$$;

CREATE OR REPLACE FUNCTION private.add_managed_member(p_name text, p_relationship text, p_age text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  manager public.gift_participants;
  clean_name text := btrim(COALESCE(p_name, ''));
  clean_rel text := NULLIF(left(btrim(COALESCE(p_relationship, '')), 40), '');
  clean_age text := NULLIF(left(btrim(COALESCE(p_age, '')), 20), '');
  occasion text;
  new_list uuid;
  new_person uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF char_length(clean_name) < 1 OR char_length(clean_name) > 80 THEN
    RAISE EXCEPTION 'Enter a name';
  END IF;

  SELECT * INTO manager
  FROM public.gift_participants p
  WHERE p.user_id = uid
  ORDER BY p.created_at
  LIMIT 1;
  IF manager.id IS NULL THEN
    RAISE EXCEPTION 'Join the family list first';
  END IF;

  IF (SELECT count(*) FROM public.gift_managed_members m WHERE m.manager_user_id = uid) >= 12 THEN
    RAISE EXCEPTION 'Twelve family members is the limit for one person';
  END IF;

  SELECT l.occasion INTO occasion FROM public.gift_lists l WHERE l.id = manager.list_id;

  INSERT INTO public.gift_lists (
    household_id, kid_key, display_name, occasion, share_slug, list_kind, owner_user_id, created_by
  )
  VALUES (
    manager.household_id,
    'guest-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    clean_name,
    COALESCE(occasion, 'Christmas 2026'),
    'f' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    'exchange',
    NULL,
    uid
  )
  RETURNING id INTO new_list;

  INSERT INTO public.gift_participants (
    household_id, group_id, user_id, display_name, list_id, in_draw, submitted_at
  )
  VALUES (manager.household_id, manager.group_id, NULL, clean_name, new_list, false, NULL)
  RETURNING id INTO new_person;

  INSERT INTO public.gift_managed_members (
    list_id, household_id, participant_id, manager_participant_id, manager_user_id,
    manager_name, relationship, age_label
  )
  VALUES (
    new_list, manager.household_id, new_person, manager.id, uid,
    left(btrim(manager.display_name), 80), clean_rel, clean_age
  );

  RETURN private.managed_member_json(new_list);
END;
$$;

CREATE OR REPLACE FUNCTION private.update_managed_member(
  p_list uuid, p_name text, p_relationship text, p_age text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean_name text := btrim(COALESCE(p_name, ''));
BEGIN
  IF NOT (SELECT private.manages_gift_list(p_list)) THEN
    RAISE EXCEPTION 'Only the person who added them, or Andrew, can change this';
  END IF;
  IF char_length(clean_name) < 1 OR char_length(clean_name) > 80 THEN
    RAISE EXCEPTION 'Enter a name';
  END IF;

  UPDATE public.gift_lists SET display_name = clean_name WHERE id = p_list;
  UPDATE public.gift_participants SET display_name = clean_name WHERE list_id = p_list AND user_id IS NULL;
  UPDATE public.gift_managed_members
  SET relationship = NULLIF(left(btrim(COALESCE(p_relationship, '')), 40), ''),
      age_label = NULLIF(left(btrim(COALESCE(p_age, '')), 20), ''),
      updated_at = now()
  WHERE list_id = p_list;

  RETURN private.managed_member_json(p_list);
END;
$$;

CREATE OR REPLACE FUNCTION private.remove_managed_member(p_list uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
BEGIN
  IF NOT (SELECT private.manages_gift_list(p_list)) THEN
    RAISE EXCEPTION 'Only the person who added them, or Andrew, can remove them';
  END IF;
  SELECT m.household_id INTO hid FROM public.gift_managed_members m WHERE m.list_id = p_list;

  -- A gift someone already bought stays put unless Andrew removes the person.
  -- The message does not say a gift was bought, to keep claims secret.
  IF NOT (SELECT private.is_household_admin(hid)) AND EXISTS (
    SELECT 1 FROM public.gift_items i WHERE i.list_id = p_list AND i.claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Ask Andrew to remove this person';
  END IF;

  DELETE FROM public.gift_participants WHERE list_id = p_list AND user_id IS NULL;
  DELETE FROM public.gift_lists WHERE id = p_list;  -- cascades items and the managed row

  RETURN jsonb_build_object('removed', true, 'list_id', p_list);
END;
$$;

-- Save the whole item list for a managed person. Unlike save_my_gift_items this
-- allows zero items, so the last gift can be removed.
CREATE OR REPLACE FUNCTION private.save_managed_member_items(p_list uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entry jsonb;
  kept uuid[] := '{}';
  item_id uuid;
  description text;
  link text;
  photo text;
  added integer := 0;
  items jsonb := COALESCE(p_items, '[]'::jsonb);
BEGIN
  IF NOT (SELECT private.manages_gift_list(p_list)) THEN
    RAISE EXCEPTION 'Only the person who added them, or Andrew, can change their gifts';
  END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Gift ideas were not a list';
  END IF;
  IF jsonb_array_length(items) > 40 THEN
    RAISE EXCEPTION 'Forty gifts is the limit for one list';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(items) AS value LOOP
    description := left(btrim(COALESCE(entry->>'description', entry->>'title', '')), 160);
    link := NULLIF(btrim(COALESCE(entry->>'url', '')), '');
    photo := NULLIF(btrim(COALESCE(entry->>'image', '')), '');
    IF description = '' THEN
      RAISE EXCEPTION 'Each gift needs a description';
    END IF;
    IF link IS NOT NULL AND link !~ '^https?://' THEN
      RAISE EXCEPTION 'Link must start with http';
    END IF;
    IF photo IS NOT NULL AND photo !~ '^https?://' THEN
      photo := NULL;
    END IF;

    item_id := NULL;
    IF COALESCE(entry->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      UPDATE public.gift_items AS gift
      SET title = description,
          url = link,
          image = photo
      WHERE gift.id = (entry->>'id')::uuid
        AND gift.list_id = p_list
      RETURNING gift.id INTO item_id;
    END IF;

    IF item_id IS NULL THEN
      item_id := private.insert_wish(p_list, description, '', COALESCE(link, ''), photo);
    END IF;
    kept := kept || item_id;
    added := added + 1;
  END LOOP;

  -- Bought gifts are never deleted here, same as save_my_gift_items.
  DELETE FROM public.gift_items AS gift
  WHERE gift.list_id = p_list
    AND gift.claimed_at IS NULL
    AND gift.source_slug IS NULL
    AND NOT (gift.id = ANY (kept));

  UPDATE public.gift_participants
  SET submitted_at = CASE WHEN added > 0 THEN COALESCE(submitted_at, now()) ELSE submitted_at END
  WHERE list_id = p_list AND user_id IS NULL;

  RETURN jsonb_build_object('count', added);
END;
$$;

-- Managed people the caller can see: all of them for household members, and
-- the caller's own for an invited member.
CREATE OR REPLACE FUNCTION private.get_managed_members()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(private.managed_member_json(m.list_id) ORDER BY m.created_at), '[]'::jsonb)
  FROM public.gift_managed_members m
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND (
      m.manager_user_id = (SELECT auth.uid())
      OR (SELECT private.is_household_member(m.household_id))
    );
$$;

-- "Managed by ..." for a shared list page. Returns NULL for ordinary lists.
-- Shows only the manager's display name and the relationship, never contact info.
CREATE OR REPLACE FUNCTION private.get_managed_label(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object('manager_name', m.manager_name, 'relationship', m.relationship)
  FROM public.gift_lists l
  JOIN public.gift_managed_members m ON m.list_id = l.id
  WHERE l.share_slug = btrim(COALESCE(p_slug, ''))
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers. Privileges stay on private.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_managed_member(p_name text, p_relationship text DEFAULT NULL, p_age text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.add_managed_member(p_name, p_relationship, p_age); $$;

CREATE OR REPLACE FUNCTION public.update_managed_member(p_list uuid, p_name text, p_relationship text DEFAULT NULL, p_age text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.update_managed_member(p_list, p_name, p_relationship, p_age); $$;

CREATE OR REPLACE FUNCTION public.remove_managed_member(p_list uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.remove_managed_member(p_list); $$;

CREATE OR REPLACE FUNCTION public.save_managed_member_items(p_list uuid, p_items jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.save_managed_member_items(p_list, p_items); $$;

CREATE OR REPLACE FUNCTION public.get_managed_members()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_managed_members(); $$;

CREATE OR REPLACE FUNCTION public.get_managed_label(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_managed_label(p_slug); $$;

REVOKE ALL ON FUNCTION private.is_gift_household_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.manages_gift_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.managed_list_write_ok(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.managed_member_json(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.add_managed_member(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.update_managed_member(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.remove_managed_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.save_managed_member_items(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.get_managed_members() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.get_managed_label(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.add_managed_member(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_managed_member(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_managed_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_managed_member_items(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_managed_members() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_managed_label(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.is_gift_household_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.manages_gift_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.managed_list_write_ok(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.managed_member_json(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.add_managed_member(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.update_managed_member(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.remove_managed_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.save_managed_member_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_managed_members() TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_managed_label(text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_managed_member(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_managed_member(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_managed_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_managed_member_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_label(text) TO anon, authenticated;

GRANT SELECT ON public.gift_managed_members TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.gift_managed_members TO authenticated;
