-- Gift rows from an invite: description, optional http(s) link, and an optional preview image.
-- Additive. Does not apply itself. Uses gift_items.title, url, and image.
-- Does not replace the kid iPad functions.

DROP FUNCTION IF EXISTS private.insert_wish(uuid, text, text, text);

CREATE FUNCTION private.insert_wish(
  p_list uuid,
  p_title text,
  p_notes text,
  p_url text,
  p_image text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean text;
  link text;
  photo text;
  next_sort integer;
  item_id uuid;
BEGIN
  clean := left(btrim(COALESCE(p_title, '')), 160);
  IF clean = '' THEN
    RETURN NULL;
  END IF;

  link := NULLIF(btrim(COALESCE(p_url, '')), '');
  IF link IS NOT NULL AND link !~ '^https?://' THEN
    RAISE EXCEPTION 'Link must start with http';
  END IF;

  photo := NULLIF(btrim(COALESCE(p_image, '')), '');
  IF photo IS NOT NULL AND photo !~ '^https?://' THEN
    photo := NULL;
  END IF;

  SELECT COALESCE(MAX(i.sort), -1) + 1 INTO next_sort
  FROM public.gift_items i
  WHERE i.list_id = p_list;

  INSERT INTO public.gift_items (list_id, title, notes, url, image, sort, review_status, category)
  VALUES (
    p_list,
    clean,
    NULLIF(left(btrim(COALESCE(p_notes, '')), 500), ''),
    link,
    photo,
    next_sort,
    'approved',
    'Idea'
  )
  RETURNING id INTO item_id;

  UPDATE public.gift_participants
  SET submitted_at = COALESCE(submitted_at, now())
  WHERE list_id = p_list;

  RETURN item_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.add_invite_items(p_list uuid, p_ideas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entry jsonb;
  added integer := 0;
  description text;
  link text;
  photo text;
BEGIN
  IF jsonb_typeof(p_ideas) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_ideas) AS value LOOP
    EXIT WHEN added >= 40;
    IF jsonb_typeof(entry) = 'string' THEN
      description := left(btrim(entry #>> '{}'), 160);
      link := '';
      photo := NULL;
    ELSIF jsonb_typeof(entry) = 'object' THEN
      description := left(btrim(COALESCE(entry->>'description', entry->>'title', '')), 160);
      link := COALESCE(entry->>'url', '');
      photo := NULLIF(entry->>'image', '');
    ELSE
      CONTINUE;
    END IF;
    IF private.insert_wish(p_list, description, '', link, photo) IS NOT NULL THEN
      added := added + 1;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.accept_gift_invite(
  p_token text,
  p_name text,
  p_phone text,
  p_email text,
  p_group text,
  p_ideas jsonb,
  p_others jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  mail text := lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''));
  invite public.gift_invites;
  group_id uuid;
  person_id uuid;
  list_id uuid;
  other jsonb;
  other_name text;
  other_list uuid;
  other_id uuid;
  slug text;
  kid_key text;
  created_ids uuid[] := '{}';
  already boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF mail = '' OR lower(btrim(COALESCE(p_email, ''))) <> mail THEN
    RAISE EXCEPTION 'Use the email you signed in with';
  END IF;
  IF char_length(btrim(COALESCE(p_name, ''))) < 2 OR char_length(btrim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Enter your name';
  END IF;
  IF char_length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'Enter a phone number';
  END IF;
  IF char_length(btrim(COALESCE(p_group, ''))) < 2 OR char_length(btrim(p_group)) > 80 THEN
    RAISE EXCEPTION 'Name your household';
  END IF;
  IF jsonb_typeof(p_ideas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ideas) < 1 THEN
    RAISE EXCEPTION 'Add at least one gift idea';
  END IF;

  SELECT * INTO invite
  FROM public.gift_invites i
  WHERE i.token = btrim(p_token)
    AND i.revoked_at IS NULL;

  IF invite.id IS NULL THEN
    RAISE EXCEPTION 'That invite link is not active';
  END IF;

  SELECT g.id INTO group_id
  FROM public.gift_groups g
  WHERE g.household_id = invite.household_id
    AND lower(g.label) = lower(btrim(p_group))
  LIMIT 1;

  IF group_id IS NULL THEN
    INSERT INTO public.gift_groups (household_id, label)
    VALUES (invite.household_id, btrim(p_group))
    RETURNING id INTO group_id;
  END IF;

  SELECT p.id, p.list_id INTO person_id, list_id
  FROM public.gift_participants p
  WHERE p.household_id = invite.household_id
    AND p.user_id = uid
  LIMIT 1;

  IF list_id IS NULL THEN
    slug := 'f' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
    kid_key := 'guest-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    INSERT INTO public.gift_lists (
      household_id, kid_key, display_name, occasion, share_slug, list_kind, owner_user_id, created_by
    )
    VALUES (
      invite.household_id, kid_key, btrim(p_name), 'Christmas 2026', slug, 'exchange', uid, uid
    )
    RETURNING id INTO list_id;
  ELSE
    UPDATE public.gift_lists
    SET display_name = btrim(p_name),
        owner_user_id = uid,
        list_kind = 'exchange'
    WHERE id = list_id;
    already := EXISTS (
      SELECT 1 FROM public.gift_items i WHERE i.list_id = accept_gift_invite.list_id
    );
  END IF;

  IF person_id IS NULL THEN
    INSERT INTO public.gift_participants (
      household_id, group_id, user_id, display_name, list_id, in_draw, submitted_at
    )
    VALUES (
      invite.household_id, accept_gift_invite.group_id, uid, btrim(p_name), accept_gift_invite.list_id, true, now()
    )
    RETURNING id INTO person_id;
  ELSE
    UPDATE public.gift_participants AS participant
    SET group_id = accept_gift_invite.group_id,
        display_name = btrim(p_name),
        list_id = accept_gift_invite.list_id,
        submitted_at = COALESCE(participant.submitted_at, now())
    WHERE participant.id = person_id;
  END IF;

  INSERT INTO public.gift_participant_contacts (participant_id, phone, email)
  VALUES (person_id, btrim(p_phone), mail)
  ON CONFLICT (participant_id) DO UPDATE
  SET phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      updated_at = now();

  IF already THEN
    DELETE FROM public.gift_items AS gift
    WHERE gift.list_id = accept_gift_invite.list_id
      AND gift.claimed_at IS NULL
      AND gift.source_slug IS NULL;
  END IF;
  PERFORM private.add_invite_items(list_id, p_ideas);

  IF jsonb_typeof(p_others) = 'array' THEN
    FOR other IN SELECT value FROM jsonb_array_elements(p_others) AS value LOOP
      EXIT WHEN COALESCE(array_length(created_ids, 1), 0) >= 8;
      other_name := left(btrim(COALESCE(other ->> 'name', '')), 80);
      IF char_length(other_name) < 2 THEN
        CONTINUE;
      END IF;
      slug := 'f' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
      kid_key := 'guest-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
      INSERT INTO public.gift_lists (
        household_id, kid_key, display_name, occasion, share_slug, list_kind, created_by
      )
      VALUES (
        invite.household_id, kid_key, other_name, 'Christmas 2026', slug, 'exchange', uid
      )
      RETURNING id INTO other_list;

      INSERT INTO public.gift_participants (
        household_id, group_id, display_name, list_id, in_draw, submitted_at
      )
      VALUES (
        invite.household_id,
        group_id,
        other_name,
        other_list,
        false,
        CASE
          WHEN jsonb_typeof(other -> 'ideas') = 'array' AND jsonb_array_length(other -> 'ideas') > 0 THEN now()
          ELSE NULL
        END
      )
      RETURNING id INTO other_id;
      created_ids := created_ids || other_id;
      PERFORM private.add_invite_items(other_list, other -> 'ideas');
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'participant_id', person_id,
    'list_id', list_id,
    'group_id', group_id,
    'kid_key', (SELECT l.kid_key FROM public.gift_lists l WHERE l.id = list_id)
  );
END;
$$;

DROP FUNCTION IF EXISTS private.add_exchange_wish(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.add_exchange_wish(uuid, text, text, text);

CREATE FUNCTION private.add_exchange_wish(
  p_list uuid,
  p_title text,
  p_notes text,
  p_url text,
  p_image text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item_id uuid;
BEGIN
  IF NOT (SELECT private.can_edit_gift_list(p_list)) THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  item_id := private.insert_wish(p_list, p_title, p_notes, p_url, p_image);
  IF item_id IS NULL THEN
    RAISE EXCEPTION 'Enter a gift idea';
  END IF;
  RETURN jsonb_build_object('id', item_id);
END;
$$;

CREATE FUNCTION public.add_exchange_wish(
  p_list uuid,
  p_title text,
  p_notes text DEFAULT '',
  p_url text DEFAULT '',
  p_image text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.add_exchange_wish(p_list, p_title, p_notes, p_url, p_image);
$$;

CREATE OR REPLACE FUNCTION private.save_my_gift_items(p_list uuid, p_items jsonb)
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
BEGIN
  IF NOT (SELECT private.can_edit_gift_list(p_list)) THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'Add at least one gift';
  END IF;
  IF jsonb_array_length(p_items) > 40 THEN
    RAISE EXCEPTION 'Forty gifts is the limit for one list';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_items) AS value LOOP
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

  DELETE FROM public.gift_items AS gift
  WHERE gift.list_id = p_list
    AND gift.claimed_at IS NULL
    AND gift.source_slug IS NULL
    AND NOT (gift.id = ANY (kept));

  UPDATE public.gift_participants
  SET submitted_at = COALESCE(submitted_at, now())
  WHERE list_id = p_list;

  RETURN jsonb_build_object('count', added);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_gift_items(p_list uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.save_my_gift_items(p_list, p_items);
$$;

REVOKE ALL ON FUNCTION private.insert_wish(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.add_invite_items(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.add_exchange_wish(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_exchange_wish(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.save_my_gift_items(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_my_gift_items(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.add_exchange_wish(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_exchange_wish(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.save_my_gift_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_gift_items(uuid, jsonb) TO authenticated;
