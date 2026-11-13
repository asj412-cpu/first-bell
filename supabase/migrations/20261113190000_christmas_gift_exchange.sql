-- Christmas 2026 gift exchange.
-- Additive only. Does not drop or replace the kid iPad functions
-- (get_kid_gift_list, get_kid_catalog, add_kid_catalog_wish, claim_gift_item, get_public_gift_list)
-- or the gift_catalog / gift_kid_links tables from the unmerged kid-list migrations.
-- Do not apply this until Andrew approves the preview. No service role key belongs in the app.
--
-- Privacy:
--   Purchases live in gift_claims. The recipient cannot read them.
--   Kid wish lists also stamp gift_items.claimed_at so the existing kid view keeps hiding bought gifts.
--   Phone and email live in gift_participant_contacts. Only household owners can read them.
--   Secret Santa pairs are visible to the giver, and to an owner only while the drawing is still a draft.
--   After lock, the admin functions do not return the full mapping.

-- ---------------------------------------------------------------------------
-- Columns the researched wishes and the exchange need.
-- review_status already exists where the kid iPad migration was applied.
-- ---------------------------------------------------------------------------

ALTER TABLE public.gift_items
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS price_label text,
  ADD COLUMN IF NOT EXISTS retailer text,
  ADD COLUMN IF NOT EXISTS age_fit text,
  ADD COLUMN IF NOT EXISTS doll_size text,
  ADD COLUMN IF NOT EXISTS source_slug text,
  ADD COLUMN IF NOT EXISTS price_as_of date;

ALTER TABLE public.gift_lists
  ADD COLUMN IF NOT EXISTS list_kind text NOT NULL DEFAULT 'wish',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gift_lists_list_kind_check') THEN
    ALTER TABLE public.gift_lists
      ADD CONSTRAINT gift_lists_list_kind_check
      CHECK (list_kind IN ('wish', 'exchange'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gift_lists_owner_user_fkey') THEN
    ALTER TABLE public.gift_lists
      ADD CONSTRAINT gift_lists_owner_user_fkey
      FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gift_lists_created_by_fkey') THEN
    ALTER TABLE public.gift_lists
      ADD CONSTRAINT gift_lists_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS gift_items_list_source_slug
  ON public.gift_items (list_id, source_slug)
  WHERE source_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS gift_lists_owner_idx
  ON public.gift_lists (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Extended family, purchases, Secret Santa, reminders.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gift_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_groups_household_idx
  ON public.gift_groups (household_id);

CREATE TABLE IF NOT EXISTS public.gift_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.gift_groups (id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  member_key text,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  list_id uuid REFERENCES public.gift_lists (id) ON DELETE SET NULL,
  in_draw boolean NOT NULL DEFAULT true,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gift_participants_member_key_idx
  ON public.gift_participants (household_id, member_key)
  WHERE member_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gift_participants_user_idx
  ON public.gift_participants (household_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gift_participants_household_idx
  ON public.gift_participants (household_id);

CREATE INDEX IF NOT EXISTS gift_participants_list_idx
  ON public.gift_participants (list_id);

CREATE TABLE IF NOT EXISTS public.gift_participant_contacts (
  participant_id uuid PRIMARY KEY REFERENCES public.gift_participants (id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (char_length(btrim(phone)) BETWEEN 7 AND 40),
  email text NOT NULL CHECK (position('@' IN email) > 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gift_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  token text NOT NULL CHECK (char_length(token) BETWEEN 16 AND 80),
  label text NOT NULL DEFAULT 'Christmas 2026',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT gift_invites_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS gift_invites_household_idx
  ON public.gift_invites (household_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.gift_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.gift_items (id) ON DELETE CASCADE,
  claimed_by_name text CHECK (claimed_by_name IS NULL OR char_length(claimed_by_name) <= 80),
  claimed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_claims_item_unique UNIQUE (item_id)
);

CREATE INDEX IF NOT EXISTS gift_claims_claimed_by_idx
  ON public.gift_claims (claimed_by);

CREATE TABLE IF NOT EXISTS public.secret_santa_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  occasion text NOT NULL DEFAULT 'Christmas 2026',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'draft', 'locked')),
  avoid_same_group boolean NOT NULL DEFAULT true,
  drawn_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT secret_santa_events_household_occasion UNIQUE (household_id, occasion)
);

CREATE TABLE IF NOT EXISTS public.secret_santa_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.secret_santa_events (id) ON DELETE CASCADE,
  giver_id uuid NOT NULL REFERENCES public.gift_participants (id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.gift_participants (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT secret_santa_giver_unique UNIQUE (event_id, giver_id),
  CONSTRAINT secret_santa_receiver_unique UNIQUE (event_id, receiver_id),
  CONSTRAINT secret_santa_not_self CHECK (giver_id <> receiver_id)
);

CREATE INDEX IF NOT EXISTS secret_santa_assignments_receiver_idx
  ON public.secret_santa_assignments (event_id, receiver_id);

CREATE TABLE IF NOT EXISTS public.gift_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  kind text NOT NULL,
  send_at timestamptz NOT NULL,
  audience text NOT NULL CHECK (audience IN ('participants', 'missing_lists', 'assigned')),
  subject text NOT NULL,
  body text NOT NULL,
  CONSTRAINT gift_reminders_kind_unique UNIQUE (household_id, kind)
);

CREATE TABLE IF NOT EXISTS public.gift_reminder_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL REFERENCES public.gift_reminders (id) ON DELETE CASCADE,
  actor uuid,
  adapter text NOT NULL DEFAULT 'stub',
  delivered boolean NOT NULL DEFAULT false,
  recipient_count integer NOT NULL DEFAULT 0,
  preview jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_reminder_previews_not_delivered CHECK (delivered = false)
);

CREATE INDEX IF NOT EXISTS gift_reminder_previews_reminder_idx
  ON public.gift_reminder_previews (reminder_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Helpers. Security definer, not granted to anon.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.is_household_admin(hid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = hid
      AND hm.user_id = (SELECT auth.uid())
      AND hm.role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION private.viewer_owns_list(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.gift_lists l
    WHERE l.id = p_list
      AND (SELECT auth.uid()) IS NOT NULL
      AND (
        l.owner_user_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.gift_participants p
          WHERE p.list_id = l.id
            AND p.user_id = (SELECT auth.uid())
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.viewer_owns_item(p_item uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.gift_items i
    WHERE i.id = p_item
      AND (SELECT private.viewer_owns_list(i.list_id))
  );
$$;

CREATE OR REPLACE FUNCTION private.gift_purchase_visible(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT (SELECT private.viewer_owns_list(p_list));
$$;

CREATE OR REPLACE FUNCTION private.can_edit_gift_list(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.gift_lists l
    WHERE l.id = p_list
      AND (
        (SELECT private.is_household_admin(l.household_id))
        OR l.owner_user_id = (SELECT auth.uid())
        OR l.created_by = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.gift_participants p
          WHERE p.list_id = l.id
            AND p.user_id = (SELECT auth.uid())
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.gift_item_json(p_item public.gift_items, p_reveal boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', p_item.id,
    'title', p_item.title,
    'notes', p_item.notes,
    'url', p_item.url,
    'url_secondary', p_item.url_secondary,
    'image', p_item.image,
    'category', p_item.category,
    'price_label', p_item.price_label,
    'retailer', p_item.retailer,
    'age_fit', p_item.age_fit,
    'doll_size', NULLIF(p_item.doll_size, ''),
    'sort', p_item.sort,
    'availability', p_item.availability
  )) || CASE
    WHEN p_reveal THEN jsonb_build_object(
      'purchased', EXISTS (SELECT 1 FROM public.gift_claims c WHERE c.item_id = p_item.id) OR p_item.claimed_at IS NOT NULL,
      'claimed_by_name', COALESCE(
        (SELECT c.claimed_by_name FROM public.gift_claims c WHERE c.item_id = p_item.id),
        p_item.claimed_by_name
      ),
      'claimed_at', COALESCE(
        (SELECT c.claimed_at FROM public.gift_claims c WHERE c.item_id = p_item.id),
        p_item.claimed_at
      )
    )
    ELSE '{}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION private.list_items_json(p_list uuid, p_reveal boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(private.gift_item_json(i, p_reveal) ORDER BY i.sort, i.created_at), '[]'::jsonb)
  FROM public.gift_items i
  WHERE i.list_id = p_list
    AND i.review_status = 'approved';
$$;

-- ---------------------------------------------------------------------------
-- Shared list. Anonymous shoppers can see what is taken.
-- The signed-in recipient cannot.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.get_shared_gift_list(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lst public.gift_lists;
  reveal boolean;
BEGIN
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO lst
  FROM public.gift_lists l
  WHERE l.share_slug = btrim(p_slug);

  IF lst.id IS NULL THEN
    RETURN NULL;
  END IF;

  reveal := private.gift_purchase_visible(lst.id);

  RETURN jsonb_build_object(
    'list', jsonb_build_object(
      'id', lst.id,
      'kid_key', lst.kid_key,
      'display_name', lst.display_name,
      'occasion', lst.occasion,
      'share_slug', lst.share_slug,
      'list_kind', lst.list_kind
    ),
    'purchases_visible', reveal,
    'items', private.list_items_json(lst.id, reveal)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_gift_purchased(
  p_slug text,
  p_item_id uuid,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lst public.gift_lists;
  item public.gift_items;
  cname text;
  claim_id uuid;
BEGIN
  IF p_item_id IS NULL OR p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'List and item are required';
  END IF;

  SELECT * INTO lst FROM public.gift_lists l WHERE l.share_slug = btrim(p_slug);
  IF lst.id IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  IF private.viewer_owns_list(lst.id) THEN
    RAISE EXCEPTION 'Purchases on your own list stay hidden';
  END IF;

  SELECT * INTO item
  FROM public.gift_items i
  WHERE i.id = p_item_id
    AND i.list_id = lst.id
    AND i.review_status = 'approved';

  IF item.id IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  cname := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF cname IS NOT NULL AND char_length(cname) > 80 THEN
    RAISE EXCEPTION 'Name is too long';
  END IF;

  INSERT INTO public.gift_claims (item_id, claimed_by_name, claimed_by)
  VALUES (item.id, cname, (SELECT auth.uid()))
  ON CONFLICT (item_id) DO NOTHING
  RETURNING id INTO claim_id;

  IF claim_id IS NULL THEN
    RAISE EXCEPTION 'Someone already marked that gift';
  END IF;

  -- Kid lists have no owner. Stamp the old columns so the kid iPad view keeps hiding them.
  -- Owned lists stay blank here, so a recipient selecting gift_items learns nothing.
  IF lst.owner_user_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.gift_participants p WHERE p.list_id = lst.id AND p.user_id IS NOT NULL
  ) THEN
    UPDATE public.gift_items
    SET claimed_by_name = cname,
        claimed_at = now()
    WHERE id = item.id
      AND claimed_at IS NULL;
  END IF;

  RETURN jsonb_build_object('id', item.id, 'purchased', true);
END;
$$;

CREATE OR REPLACE FUNCTION private.release_gift_purchase(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lst public.gift_lists;
  claim public.gift_claims;
BEGIN
  SELECT l.* INTO lst
  FROM public.gift_items i
  JOIN public.gift_lists l ON l.id = i.list_id
  WHERE i.id = p_item_id;

  IF lst.id IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  SELECT * INTO claim FROM public.gift_claims c WHERE c.item_id = p_item_id;

  IF NOT (
    (SELECT private.is_household_admin(lst.household_id))
    OR (claim.claimed_by IS NOT NULL AND claim.claimed_by = (SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You cannot put that gift back';
  END IF;

  DELETE FROM public.gift_claims WHERE item_id = p_item_id;
  UPDATE public.gift_items
  SET claimed_by_name = NULL, claimed_at = NULL
  WHERE id = p_item_id;

  RETURN jsonb_build_object('id', p_item_id, 'purchased', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Invite, my lists, linking a parent seat.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.insert_wish(p_list uuid, p_title text, p_notes text, p_url text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean text;
  next_sort integer;
  item_id uuid;
BEGIN
  clean := left(btrim(COALESCE(p_title, '')), 160);
  IF clean = '' THEN
    RETURN NULL;
  END IF;
  IF p_url IS NOT NULL AND p_url <> '' AND p_url !~ '^https?://' THEN
    RAISE EXCEPTION 'Link must start with http';
  END IF;

  SELECT COALESCE(MAX(i.sort), -1) + 1 INTO next_sort
  FROM public.gift_items i
  WHERE i.list_id = p_list;

  INSERT INTO public.gift_items (list_id, title, notes, url, sort, review_status, category)
  VALUES (
    p_list,
    clean,
    NULLIF(left(btrim(COALESCE(p_notes, '')), 500), ''),
    NULLIF(p_url, ''),
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
  idea text;
  other jsonb;
  other_name text;
  other_list uuid;
  other_id uuid;
  slug text;
  kid_key text;
  created_ids uuid[] := '{}';
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

  FOR idea IN SELECT left(btrim(value), 160) FROM jsonb_array_elements_text(p_ideas) AS value LOOP
    PERFORM private.insert_wish(list_id, idea, '', '');
  END LOOP;

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
        CASE WHEN jsonb_typeof(other -> 'ideas') = 'array' AND jsonb_array_length(other -> 'ideas') > 0 THEN now() ELSE NULL END
      )
      RETURNING id INTO other_id;
      created_ids := created_ids || other_id;

      IF jsonb_typeof(other -> 'ideas') = 'array' THEN
        FOR idea IN
          SELECT left(btrim(value), 160)
          FROM jsonb_array_elements_text(other -> 'ideas') AS value
        LOOP
          PERFORM private.insert_wish(other_list, idea, '', '');
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'participant_id', person_id,
    'list_id', list_id,
    'group_id', group_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.link_gift_participant()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  mail text := lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''));
  person_id uuid;
BEGIN
  IF uid IS NULL OR mail = '' THEN
    RETURN jsonb_build_object('linked', false);
  END IF;

  UPDATE public.gift_participants p
  SET user_id = uid
  FROM public.gift_participant_contacts c
  WHERE c.participant_id = p.id
    AND lower(c.email) = mail
    AND (p.user_id IS NULL OR p.user_id = uid)
  RETURNING p.id INTO person_id;

  UPDATE public.gift_lists l
  SET owner_user_id = uid
  FROM public.gift_participants p
  WHERE p.list_id = l.id
    AND p.user_id = uid
    AND (l.owner_user_id IS NULL OR l.owner_user_id = uid);

  RETURN jsonb_build_object('linked', person_id IS NOT NULL, 'participant_id', person_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.get_my_gift_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'household_id', p.household_id,
    'role', 'gift',
    'participant_id', p.id,
    'display_name', p.display_name
  )
  FROM public.gift_participants p
  WHERE p.user_id = (SELECT auth.uid())
  ORDER BY p.created_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.get_my_gift_lists()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'kid_key', l.kid_key,
    'display_name', l.display_name,
    'occasion', l.occasion,
    'share_slug', l.share_slug,
    'list_kind', l.list_kind,
    'items', private.list_items_json(l.id, false)
  ) ORDER BY l.display_name), '[]'::jsonb)
  FROM public.gift_lists l
  WHERE l.owner_user_id = (SELECT auth.uid())
     OR l.created_by = (SELECT auth.uid())
     OR EXISTS (
       SELECT 1 FROM public.gift_participants p
       WHERE p.list_id = l.id AND p.user_id = (SELECT auth.uid())
     );
$$;

-- ---------------------------------------------------------------------------
-- Secret Santa. Owners see the pairs only while status is draft.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.secret_santa_pairs(p_event uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'giver_id', a.giver_id,
    'giver', giver.display_name,
    'receiver_id', a.receiver_id,
    'receiver', recv.display_name
  ) ORDER BY giver.display_name), '[]'::jsonb)
  FROM public.secret_santa_assignments a
  JOIN public.gift_participants giver ON giver.id = a.giver_id
  JOIN public.gift_participants recv ON recv.id = a.receiver_id
  WHERE a.event_id = p_event;
$$;

CREATE OR REPLACE FUNCTION private.get_exchange_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  hid uuid;
  admin boolean;
  event public.secret_santa_events;
  token text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;

  SELECT hm.household_id, true INTO hid, admin
  FROM public.household_members hm
  WHERE hm.user_id = uid AND hm.role = 'owner'
  LIMIT 1;

  IF hid IS NULL THEN
    SELECT p.household_id, false INTO hid, admin
    FROM public.gift_participants p
    WHERE p.user_id = uid
    LIMIT 1;
  END IF;

  IF hid IS NULL THEN
    RETURN jsonb_build_object('role', null);
  END IF;

  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';

  IF admin THEN
    SELECT i.token INTO token
    FROM public.gift_invites i
    WHERE i.household_id = hid AND i.revoked_at IS NULL
    ORDER BY i.created_at
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'role', CASE WHEN admin THEN 'admin' ELSE 'gift' END,
    'household_id', hid,
    'invite_token', token,
    'event', jsonb_build_object(
      'status', COALESCE(event.status, 'open'),
      'avoid_same_group', COALESCE(event.avoid_same_group, true),
      'drawn_at', event.drawn_at,
      'locked_at', event.locked_at
    ),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id,
        'label', g.label,
        'people', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', p.id,
            'name', p.display_name,
            'in_draw', p.in_draw,
            'submitted', p.submitted_at IS NOT NULL OR EXISTS (
              SELECT 1 FROM public.gift_items i WHERE i.list_id = p.list_id
            ),
            'linked', p.user_id IS NOT NULL,
            'list_id', p.list_id,
            'idea_count', (
              SELECT count(*) FROM public.gift_items i WHERE i.list_id = p.list_id
            )
          ) ORDER BY p.display_name)
          FROM public.gift_participants p
          WHERE p.group_id = g.id
            AND (admin OR p.user_id = uid)
        ), '[]'::jsonb)
      ) ORDER BY g.label)
      FROM public.gift_groups g
      WHERE g.household_id = hid
        AND (admin OR EXISTS (
          SELECT 1 FROM public.gift_participants p
          WHERE p.group_id = g.id AND p.user_id = uid
        ))
    ), '[]'::jsonb),
    'assignments', CASE
      WHEN admin AND event.status = 'draft' THEN private.secret_santa_pairs(event.id)
      ELSE NULL
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.get_participant_contacts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
BEGIN
  SELECT hm.household_id INTO hid
  FROM public.household_members hm
  WHERE hm.user_id = (SELECT auth.uid()) AND hm.role = 'owner'
  LIMIT 1;

  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only Andrew or Megan can see phone numbers';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.display_name,
      'phone', c.phone,
      'email', c.email
    ) ORDER BY p.display_name)
    FROM public.gift_participants p
    LEFT JOIN public.gift_participant_contacts c ON c.participant_id = p.id
    WHERE p.household_id = hid
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION private.save_participant_contact(
  p_participant uuid,
  p_phone text,
  p_email text,
  p_make_admin boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
  mail text;
  target uuid;
BEGIN
  IF char_length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'Enter a phone number';
  END IF;
  mail := lower(btrim(COALESCE(p_email, '')));
  IF position('@' IN mail) < 2 THEN
    RAISE EXCEPTION 'Enter an email';
  END IF;

  SELECT p.household_id INTO hid
  FROM public.gift_participants p
  WHERE p.id = p_participant;

  IF hid IS NULL OR NOT (SELECT private.is_household_admin(hid)) THEN
    RAISE EXCEPTION 'Only Andrew or Megan can save contact info';
  END IF;

  INSERT INTO public.gift_participant_contacts (participant_id, phone, email)
  VALUES (p_participant, btrim(p_phone), mail)
  ON CONFLICT (participant_id) DO UPDATE
  SET phone = EXCLUDED.phone, email = EXCLUDED.email, updated_at = now();

  IF COALESCE(p_make_admin, false) THEN
    UPDATE public.households
    SET host_emails = array_append(host_emails, mail)
    WHERE id = hid
      AND NOT (mail = ANY (SELECT lower(e) FROM unnest(host_emails) AS e));

    SELECT u.id INTO target FROM auth.users u WHERE lower(u.email) = mail LIMIT 1;
    IF target IS NOT NULL THEN
      INSERT INTO public.household_members (household_id, user_id, role)
      VALUES (hid, target, 'owner')
      ON CONFLICT DO NOTHING;
      UPDATE public.gift_participants SET user_id = target WHERE id = p_participant AND user_id IS NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION private.set_participant_in_draw(p_participant uuid, p_in_draw boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
  event public.secret_santa_events;
BEGIN
  SELECT p.household_id INTO hid
  FROM public.gift_participants p
  WHERE p.id = p_participant;

  IF hid IS NULL OR NOT (SELECT private.is_household_admin(hid)) THEN
    RAISE EXCEPTION 'Only Andrew or Megan can change the drawing';
  END IF;

  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';

  IF event.status = 'locked' THEN
    RAISE EXCEPTION 'Secret Santa is locked';
  END IF;

  UPDATE public.gift_participants SET in_draw = COALESCE(p_in_draw, false) WHERE id = p_participant;

  IF event.status = 'draft' THEN
    DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
    UPDATE public.secret_santa_events
    SET status = 'open', drawn_at = NULL
    WHERE id = event.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'open');
END;
$$;

CREATE OR REPLACE FUNCTION private.draw_secret_santa(p_avoid boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
  event public.secret_santa_events;
  people uuid[];
  roster jsonb;
  n integer;
  attempt integer;
  i integer;
  j integer;
  shuffled uuid[];
  tmp uuid;
  ok boolean;
  ggroup uuid;
  rgroup uuid;
BEGIN
  SELECT hm.household_id INTO hid
  FROM public.household_members hm
  WHERE hm.user_id = (SELECT auth.uid()) AND hm.role = 'owner'
  LIMIT 1;

  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only Andrew or Megan can run Secret Santa';
  END IF;

  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';

  IF event.id IS NULL THEN
    INSERT INTO public.secret_santa_events (household_id, avoid_same_group)
    VALUES (hid, COALESCE(p_avoid, true))
    RETURNING * INTO event;
  END IF;

  IF event.status = 'locked' THEN
    RAISE EXCEPTION 'Secret Santa is locked';
  END IF;

  UPDATE public.secret_santa_events
  SET avoid_same_group = COALESCE(p_avoid, event.avoid_same_group)
  WHERE id = event.id
  RETURNING * INTO event;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'group_id', p.group_id
  ) ORDER BY p.display_name, p.id), '[]'::jsonb)
  INTO roster
  FROM public.gift_participants p
  WHERE p.household_id = hid AND p.in_draw;

  n := COALESCE(jsonb_array_length(roster), 0);
  IF n < 2 THEN
    RAISE EXCEPTION 'Add at least two people to the drawing';
  END IF;

  SELECT COALESCE(array_agg((person->>'id')::uuid ORDER BY ord), '{}')
  INTO people
  FROM jsonb_array_elements(roster) WITH ORDINALITY AS roster_row(person, ord);

  FOR attempt IN 1..500 LOOP
    shuffled := people;
    FOR i IN REVERSE n..2 LOOP
      j := 1 + floor(random() * i)::integer;
      tmp := shuffled[i];
      shuffled[i] := shuffled[j];
      shuffled[j] := tmp;
    END LOOP;

    ok := true;
    FOR i IN 1..n LOOP
      IF shuffled[i] = people[i] THEN
        ok := false;
        EXIT;
      END IF;
      IF event.avoid_same_group THEN
        ggroup := NULLIF(roster->(i - 1)->>'group_id', '')::uuid;
        rgroup := NULL;
        FOR j IN 1..n LOOP
          IF people[j] = shuffled[i] THEN
            rgroup := NULLIF(roster->(j - 1)->>'group_id', '')::uuid;
            EXIT;
          END IF;
        END LOOP;
        IF ggroup IS NOT NULL AND ggroup = rgroup THEN
          ok := false;
          EXIT;
        END IF;
      END IF;
    END LOOP;

    IF ok THEN
      DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
      FOR i IN 1..n LOOP
        INSERT INTO public.secret_santa_assignments (event_id, giver_id, receiver_id)
        VALUES (event.id, people[i], shuffled[i]);
      END LOOP;
      UPDATE public.secret_santa_events
      SET status = 'draft', drawn_at = now(), avoid_same_group = event.avoid_same_group
      WHERE id = event.id;
      RETURN private.get_exchange_overview();
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Could not draw without matching a household. Invite another household, or allow same-household pairs.';
END;
$$;

CREATE OR REPLACE FUNCTION private.lock_secret_santa()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
  event public.secret_santa_events;
  drawn integer;
  needed integer;
BEGIN
  SELECT hm.household_id INTO hid
  FROM public.household_members hm
  WHERE hm.user_id = (SELECT auth.uid()) AND hm.role = 'owner'
  LIMIT 1;

  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only Andrew or Megan can lock Secret Santa';
  END IF;

  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';

  IF event.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Draw Secret Santa before locking it';
  END IF;

  SELECT count(*) INTO drawn FROM public.secret_santa_assignments a WHERE a.event_id = event.id;
  SELECT count(*) INTO needed FROM public.gift_participants p WHERE p.household_id = hid AND p.in_draw;
  IF drawn <> needed OR drawn < 2 THEN
    RAISE EXCEPTION 'Draw again before locking';
  END IF;

  UPDATE public.secret_santa_events
  SET status = 'locked', locked_at = now()
  WHERE id = event.id;

  RETURN jsonb_build_object('ok', true, 'status', 'locked');
END;
$$;

CREATE OR REPLACE FUNCTION private.get_my_assignment()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  giver public.gift_participants;
  event public.secret_santa_events;
  recv public.gift_participants;
  lst public.gift_lists;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;

  SELECT * INTO giver
  FROM public.gift_participants p
  WHERE p.user_id = uid
  ORDER BY p.created_at
  LIMIT 1;

  IF giver.id IS NULL THEN
    RETURN jsonb_build_object('status', 'open', 'receiver', NULL);
  END IF;

  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = giver.household_id AND e.occasion = 'Christmas 2026';

  IF event.status IS NULL OR event.status = 'open' THEN
    RETURN jsonb_build_object('status', 'open', 'receiver', NULL);
  END IF;

  SELECT r.* INTO recv
  FROM public.secret_santa_assignments a
  JOIN public.gift_participants r ON r.id = a.receiver_id
  WHERE a.event_id = event.id AND a.giver_id = giver.id;

  IF recv.id IS NULL THEN
    RETURN jsonb_build_object('status', event.status, 'receiver', NULL);
  END IF;

  SELECT * INTO lst FROM public.gift_lists l WHERE l.id = recv.list_id;
  IF lst.id IS NULL THEN
    RETURN jsonb_build_object('status', event.status, 'receiver', jsonb_build_object(
      'id', recv.id,
      'name', recv.display_name,
      'list', NULL
    ));
  END IF;

  RETURN jsonb_build_object(
    'status', event.status,
    'receiver', jsonb_build_object(
      'id', recv.id,
      'name', recv.display_name,
      'list', jsonb_build_object(
        'id', lst.id,
        'display_name', lst.display_name,
        'share_slug', lst.share_slug,
        'occasion', lst.occasion,
        'items', private.list_items_json(lst.id, true)
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.add_exchange_wish(
  p_list uuid,
  p_title text,
  p_notes text,
  p_url text
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
  item_id := private.insert_wish(p_list, p_title, p_notes, p_url);
  IF item_id IS NULL THEN
    RAISE EXCEPTION 'Enter a gift idea';
  END IF;
  RETURN jsonb_build_object('id', item_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.delete_exchange_wish(p_item uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  list_id uuid;
BEGIN
  SELECT i.list_id INTO list_id FROM public.gift_items i WHERE i.id = p_item;
  IF list_id IS NULL OR NOT (SELECT private.can_edit_gift_list(list_id)) THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
  DELETE FROM public.gift_items WHERE id = p_item;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Reminder preview. The delivered flag cannot be true.
-- This function does not call any email or SMS provider.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.reminder_recipients(p_reminder uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  reminder public.gift_reminders;
  event public.secret_santa_events;
BEGIN
  SELECT * INTO reminder FROM public.gift_reminders r WHERE r.id = p_reminder;
  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = reminder.household_id AND e.occasion = 'Christmas 2026';

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.display_name,
      'email', c.email,
      'phone', c.phone,
      'reachable', c.email IS NOT NULL,
      'message', replace(reminder.body, '{name}', p.display_name)
    ) ORDER BY p.display_name)
    FROM public.gift_participants p
    LEFT JOIN public.gift_participant_contacts c ON c.participant_id = p.id
    WHERE p.household_id = reminder.household_id
      AND p.in_draw
      AND (
        reminder.audience = 'participants'
        OR (
          reminder.audience = 'missing_lists'
          AND p.submitted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.gift_items i WHERE i.list_id = p.list_id)
        )
        OR (
          reminder.audience = 'assigned'
          AND event.status IN ('draft', 'locked')
          AND EXISTS (
            SELECT 1 FROM public.secret_santa_assignments a
            WHERE a.event_id = event.id AND a.giver_id = p.id
          )
        )
      )
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION private.preview_gift_reminder(p_reminder uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  reminder public.gift_reminders;
  people jsonb;
  preview_id uuid;
BEGIN
  SELECT * INTO reminder FROM public.gift_reminders r WHERE r.id = p_reminder;
  IF reminder.id IS NULL OR NOT (SELECT private.is_household_admin(reminder.household_id)) THEN
    RAISE EXCEPTION 'Only Andrew or Megan can preview reminders';
  END IF;

  people := private.reminder_recipients(reminder.id);

  INSERT INTO public.gift_reminder_previews (reminder_id, actor, adapter, delivered, recipient_count, preview)
  VALUES (
    reminder.id,
    (SELECT auth.uid()),
    'stub',
    false,
    jsonb_array_length(people),
    people
  )
  RETURNING id INTO preview_id;

  RETURN jsonb_build_object(
    'id', preview_id,
    'adapter', 'stub',
    'delivered', false,
    'kind', reminder.kind,
    'subject', reminder.subject,
    'body', reminder.body,
    'send_at', reminder.send_at,
    'recipients', people
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.list_gift_reminders()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
BEGIN
  SELECT hm.household_id INTO hid
  FROM public.household_members hm
  WHERE hm.user_id = (SELECT auth.uid()) AND hm.role = 'owner'
  LIMIT 1;
  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only Andrew or Megan can preview reminders';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id,
      'kind', r.kind,
      'send_at', r.send_at,
      'audience', r.audience,
      'subject', r.subject,
      'body', r.body
    ) ORDER BY r.send_at)
    FROM public.gift_reminders r
    WHERE r.household_id = hid
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers stay security invoker. Privileges live on private.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_shared_gift_list(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_shared_gift_list(p_slug); $$;

CREATE OR REPLACE FUNCTION public.mark_gift_purchased(p_slug text, p_item_id uuid, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.mark_gift_purchased(p_slug, p_item_id, p_name); $$;

CREATE OR REPLACE FUNCTION public.release_gift_purchase(p_item_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.release_gift_purchase(p_item_id); $$;

CREATE OR REPLACE FUNCTION public.accept_gift_invite(
  p_token text, p_name text, p_phone text, p_email text, p_group text, p_ideas jsonb, p_others jsonb
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.accept_gift_invite(p_token, p_name, p_phone, p_email, p_group, p_ideas, p_others); $$;

CREATE OR REPLACE FUNCTION public.link_gift_participant()
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.link_gift_participant(); $$;

CREATE OR REPLACE FUNCTION public.get_my_gift_access()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_my_gift_access(); $$;

CREATE OR REPLACE FUNCTION public.get_my_gift_lists()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_my_gift_lists(); $$;

CREATE OR REPLACE FUNCTION public.get_exchange_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_exchange_overview(); $$;

CREATE OR REPLACE FUNCTION public.get_participant_contacts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_participant_contacts(); $$;

CREATE OR REPLACE FUNCTION public.save_participant_contact(
  p_participant uuid, p_phone text, p_email text, p_make_admin boolean DEFAULT false
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.save_participant_contact(p_participant, p_phone, p_email, p_make_admin); $$;

CREATE OR REPLACE FUNCTION public.set_participant_in_draw(p_participant uuid, p_in_draw boolean)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.set_participant_in_draw(p_participant, p_in_draw); $$;

CREATE OR REPLACE FUNCTION public.draw_secret_santa(p_avoid boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.draw_secret_santa(p_avoid); $$;

CREATE OR REPLACE FUNCTION public.lock_secret_santa()
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.lock_secret_santa(); $$;

CREATE OR REPLACE FUNCTION public.get_my_assignment()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_my_assignment(); $$;

CREATE OR REPLACE FUNCTION public.add_exchange_wish(
  p_list uuid, p_title text, p_notes text DEFAULT '', p_url text DEFAULT ''
)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.add_exchange_wish(p_list, p_title, p_notes, p_url); $$;

CREATE OR REPLACE FUNCTION public.delete_exchange_wish(p_item uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.delete_exchange_wish(p_item); $$;

CREATE OR REPLACE FUNCTION public.preview_gift_reminder(p_reminder uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.preview_gift_reminder(p_reminder); $$;

CREATE OR REPLACE FUNCTION public.list_gift_reminders()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.list_gift_reminders(); $$;

REVOKE ALL ON FUNCTION private.is_household_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.viewer_owns_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.viewer_owns_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gift_purchase_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_edit_gift_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gift_item_json(public.gift_items, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.list_items_json(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.get_shared_gift_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.mark_gift_purchased(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.release_gift_purchase(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.insert_wish(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.accept_gift_invite(text, text, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.link_gift_participant() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_my_gift_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_my_gift_lists() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.secret_santa_pairs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_exchange_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_participant_contacts() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.save_participant_contact(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.set_participant_in_draw(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.draw_secret_santa(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.lock_secret_santa() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_my_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.add_exchange_wish(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.delete_exchange_wish(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reminder_recipients(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.preview_gift_reminder(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.list_gift_reminders() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_shared_gift_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_gift_purchased(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_gift_purchase(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_gift_invite(text, text, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_gift_participant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_gift_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_gift_lists() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_exchange_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_participant_contacts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_participant_contact(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_participant_in_draw(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.draw_secret_santa(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_secret_santa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_exchange_wish(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_exchange_wish(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_gift_reminder(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_gift_reminders() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.get_shared_gift_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mark_gift_purchased(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.release_gift_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.accept_gift_invite(text, text, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.link_gift_participant() TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_gift_access() TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_gift_lists() TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_exchange_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_participant_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION private.save_participant_contact(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.set_participant_in_draw(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.draw_secret_santa(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.lock_secret_santa() TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_assignment() TO authenticated;
GRANT EXECUTE ON FUNCTION private.add_exchange_wish(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.delete_exchange_wish(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.preview_gift_reminder(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.list_gift_reminders() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_shared_gift_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_gift_purchased(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_gift_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_gift_invite(text, text, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_gift_participant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_gift_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_gift_lists() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exchange_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_participant_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_participant_contact(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_participant_in_draw(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.draw_secret_santa(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_secret_santa() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_assignment() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_exchange_wish(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_exchange_wish(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_gift_reminder(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_gift_reminders() TO authenticated;

-- RLS. Direct table reads do not reveal contacts, claims on your own list, or a locked drawing.
ALTER TABLE public.gift_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_participant_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secret_santa_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secret_santa_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_reminder_previews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gift_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gift_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gift_participant_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gift_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gift_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.secret_santa_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.secret_santa_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gift_reminders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gift_reminder_previews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_claims_shopper_select ON public.gift_claims;
CREATE POLICY gift_claims_shopper_select
  ON public.gift_claims
  FOR SELECT
  TO authenticated
  USING (
    NOT (SELECT private.viewer_owns_item(item_id))
    AND (
      claimed_by = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.gift_items i
        JOIN public.gift_lists l ON l.id = i.list_id
        WHERE i.id = item_id
          AND (
            (SELECT private.is_household_member(l.household_id))
            OR EXISTS (
              SELECT 1
              FROM public.secret_santa_assignments a
              JOIN public.secret_santa_events e ON e.id = a.event_id
              JOIN public.gift_participants giver ON giver.id = a.giver_id
              JOIN public.gift_participants recv ON recv.id = a.receiver_id
              WHERE giver.user_id = (SELECT auth.uid())
                AND recv.list_id = l.id
                AND e.status IN ('draft', 'locked')
            )
          )
      )
    )
  );

DROP POLICY IF EXISTS secret_santa_assignments_select ON public.secret_santa_assignments;
CREATE POLICY secret_santa_assignments_select
  ON public.secret_santa_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.gift_participants giver
      WHERE giver.id = giver_id
        AND giver.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.secret_santa_events e
      WHERE e.id = event_id
        AND e.status = 'draft'
        AND (SELECT private.is_household_admin(e.household_id))
    )
  );

DROP POLICY IF EXISTS gift_contacts_admin_select ON public.gift_participant_contacts;
CREATE POLICY gift_contacts_admin_select
  ON public.gift_participant_contacts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.gift_participants p
      WHERE p.id = participant_id
        AND (SELECT private.is_household_admin(p.household_id))
    )
  );

REVOKE ALL ON TABLE public.gift_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gift_participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gift_participant_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gift_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gift_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.secret_santa_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.secret_santa_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gift_reminders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gift_reminder_previews FROM PUBLIC, anon, authenticated;

-- Authenticated may select the rows the policies above allow. No inserts.
GRANT SELECT ON public.gift_claims TO authenticated;
GRANT SELECT ON public.secret_santa_assignments TO authenticated;
GRANT SELECT ON public.gift_participant_contacts TO authenticated;

-- ---------------------------------------------------------------------------
-- Johnson seed: grown-up lists, one invite, the reminder schedule.
-- Andrew's phone and email are already in the household seed. Megan's email
-- is not in the repo, so her contact row waits until Andrew saves it.
-- ---------------------------------------------------------------------------

INSERT INTO public.gift_groups (id, household_id, label)
VALUES ('66666666-6666-4666-8666-666666666601', '11111111-1111-4111-8111-111111111111', 'Johnson')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.gift_lists (id, household_id, kid_key, display_name, occasion, share_slug, list_kind)
VALUES
  ('44444444-4444-4444-8444-444444444404', '11111111-1111-4111-8111-111111111111', 'andrew', 'Andrew', 'Christmas 2026', 'b7n3-andrew-xmas', 'exchange'),
  ('44444444-4444-4444-8444-444444444405', '11111111-1111-4111-8111-111111111111', 'megan', 'Megan', 'Christmas 2026', 'c2r8-megan-xmas', 'exchange')
ON CONFLICT (share_slug) DO NOTHING;

INSERT INTO public.gift_participants (
  id, household_id, group_id, member_key, display_name, list_id, in_draw
)
VALUES
  ('77777777-7777-4777-8777-777777777701', '11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666601', 'andrew', 'Andrew', '44444444-4444-4444-8444-444444444404', true),
  ('77777777-7777-4777-8777-777777777702', '11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666601', 'megan', 'Megan', '44444444-4444-4444-8444-444444444405', true)
ON CONFLICT (household_id, member_key) WHERE member_key IS NOT NULL DO NOTHING;

INSERT INTO public.gift_participant_contacts (participant_id, phone, email)
VALUES ('77777777-7777-4777-8777-777777777701', '936-355-1281', 'asj412@me.com')
ON CONFLICT (participant_id) DO NOTHING;

INSERT INTO public.gift_invites (household_id, token, label)
SELECT
  '11111111-1111-4111-8111-111111111111',
    substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 36),
  'Christmas 2026'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.gift_invites i
  WHERE i.household_id = '11111111-1111-4111-8111-111111111111'
    AND i.revoked_at IS NULL
);

INSERT INTO public.secret_santa_events (household_id, occasion, status, avoid_same_group)
VALUES ('11111111-1111-4111-8111-111111111111', 'Christmas 2026', 'open', true)
ON CONFLICT (household_id, occasion) DO NOTHING;

INSERT INTO public.gift_reminders (household_id, kind, send_at, audience, subject, body)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'lists_due',
    (timestamp '2026-12-01 09:00:00' AT TIME ZONE 'America/Chicago'),
    'missing_lists',
    'Christmas lists are due',
    'Hi {name}, Christmas is December 25. Please add your gift ideas in Mi Casa today so the family knows what to look for.'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'assigned',
    (timestamp '2026-12-08 09:00:00' AT TIME ZONE 'America/Chicago'),
    'assigned',
    'You have someone for Secret Santa',
    'Hi {name}, you have been assigned someone for the Johnson family Secret Santa. Open Mi Casa to see their list, and please keep it a surprise.'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'buy_by',
    (timestamp '2026-12-18 09:00:00' AT TIME ZONE 'America/Chicago'),
    'participants',
    'A week left to buy',
    'Hi {name}, Christmas is one week from today. This is a good day to order gifts so they arrive by December 25. Mark an item in Mi Casa once you have it, so nobody else buys the same one.'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'final',
    (timestamp '2026-12-23 09:00:00' AT TIME ZONE 'America/Chicago'),
    'participants',
    'Final Christmas reminder',
    'Hi {name}, Christmas Eve is tomorrow. If a gift is still on the way, you still have a day. Mi Casa will not remind you again after this.'
  )
ON CONFLICT (household_id, kind) DO NOTHING;
