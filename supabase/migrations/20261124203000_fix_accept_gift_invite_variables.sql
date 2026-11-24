-- Fix "missing FROM-clause entry for table accept_gift_invite".
-- private.accept_gift_invite qualified its DECLAREd variables as
-- accept_gift_invite.list_id / accept_gift_invite.group_id. In PL/pgSQL only
-- parameters live in the function-name scope; DECLARE variables do not, so
-- Postgres read those as table references and every join failed.
-- Label the DECLARE block <<v>> and qualify the variables as v.list_id / v.group_id.
-- Body otherwise unchanged from 20261115190000_family_invites_and_reentry.sql.

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
<<v>>
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
  ideas jsonb := COALESCE(p_ideas, '[]'::jsonb);
  has_ideas boolean := false;
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
  IF jsonb_typeof(ideas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Gift ideas were not a list';
  END IF;
  has_ideas := jsonb_array_length(ideas) > 0;

  SELECT * INTO invite
  FROM public.gift_invites i
  WHERE i.token = btrim(p_token)
    AND i.revoked_at IS NULL;

  IF invite.id IS NULL THEN
    RAISE EXCEPTION 'That invite link is not active';
  END IF;
  IF invite.expires_at IS NOT NULL AND invite.expires_at <= now() THEN
    RAISE EXCEPTION 'That invite expired. Ask for a new link';
  END IF;
  IF invite.single_use AND invite.used_at IS NOT NULL AND invite.used_by IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'That invite has already been used';
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
    already := has_ideas AND EXISTS (
      SELECT 1 FROM public.gift_items i WHERE i.list_id = v.list_id
    );
  END IF;

  IF person_id IS NULL THEN
    INSERT INTO public.gift_participants (
      household_id, group_id, user_id, display_name, list_id, in_draw, submitted_at
    )
    VALUES (
      invite.household_id,
      v.group_id,
      uid,
      btrim(p_name),
      v.list_id,
      true,
      CASE WHEN has_ideas THEN now() ELSE NULL END
    )
    RETURNING id INTO person_id;
  ELSE
    UPDATE public.gift_participants AS participant
    SET group_id = v.group_id,
        display_name = btrim(p_name),
        list_id = v.list_id,
        submitted_at = CASE
          WHEN has_ideas THEN COALESCE(participant.submitted_at, now())
          ELSE participant.submitted_at
        END
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
    WHERE gift.list_id = v.list_id
      AND gift.claimed_at IS NULL
      AND gift.source_slug IS NULL;
  END IF;
  IF has_ideas THEN
    PERFORM private.add_invite_items(list_id, ideas);
  END IF;

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

  IF invite.single_use AND invite.used_at IS NULL THEN
    UPDATE public.gift_invites
    SET used_at = now(),
        used_by = uid
    WHERE id = invite.id;
  END IF;

  RETURN jsonb_build_object(
    'participant_id', person_id,
    'list_id', list_id,
    'group_id', group_id,
    'kid_key', (SELECT l.kid_key FROM public.gift_lists l WHERE l.id = list_id)
  );
END v;
$$;
