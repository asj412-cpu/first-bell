-- Extended family: browse every list, share your own link, non-participants,
-- "they won't sign up", edit people, no new draw entries after lock, no duplicate names.
--
-- Additive only: one new column (default false), two new functions, and
-- replacement bodies for existing functions (CREATE OR REPLACE keeps their grants).
-- No table rows, policies, Secret Santa pairings, claims, marks, or the family link
-- are touched. No service role key is needed or used.
--
--   1. get_family_directory(): every list in the caller's family, grouped by household.
--      It returns names, link slugs and idea counts only: no marks, no Secret Santa
--      assignments, no drawing status, no emails or phones.
--   2. get_my_gift_access() also says whether the caller is in the drawing and
--      whether it is locked, so the app can hide "who you are buying for" for
--      people who are not in it and tell the truth in "Your family".
--   3. gift_profiles.wont_sign_up + admin_set_wont_sign_up(): Andrew keeps a
--      person's list himself and hides their name from the "Who are you?" picker.
--      Reversible. Claiming a hidden name is refused.
--   4. admin_update_profile also keeps "Managed by <name>" in step with a rename;
--      admin_list_profiles also returns wont_sign_up and only households that have people.
--   5. accept_gift_invite (the one-time Invite link and "I'm not on the list"):
--      a new person joins the drawing only if it is not locked, same as
--      "Add to the list". preview_family_invite reports drawing_locked.
--   6. add_managed_member / update_managed_member refuse a name that already
--      belongs to someone in the family (case-insensitive, trimmed).

ALTER TABLE public.gift_profiles ADD COLUMN IF NOT EXISTS wont_sign_up boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Access: in the drawing? locked?
-- ---------------------------------------------------------------------------
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
    'display_name', p.display_name,
    'in_draw', p.in_draw,
    'drawing_locked', EXISTS (
      SELECT 1 FROM public.secret_santa_events e
      WHERE e.household_id = p.household_id AND e.occasion = 'Christmas 2026' AND e.status = 'locked'
    )
  )
  FROM public.gift_participants p
  WHERE p.user_id = (SELECT auth.uid())
  ORDER BY p.created_at
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 1. Family directory
-- ---------------------------------------------------------------------------
-- Everyone's list in the caller's family, grouped by household. Callers: a
-- claimed family member, or the household owner. Names and counts only.
CREATE OR REPLACE FUNCTION private.get_family_directory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  hid uuid;
  mine_label text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  SELECT p.household_id, g.label INTO hid, mine_label
  FROM public.gift_participants p
  LEFT JOIN public.gift_groups g ON g.id = p.group_id
  WHERE p.user_id = uid
  ORDER BY p.created_at
  LIMIT 1;
  IF hid IS NULL THEN
    hid := private.owned_household();
  END IF;
  IF hid IS NULL THEN
    RAISE EXCEPTION 'Join the family list first';
  END IF;

  RETURN jsonb_build_object(
    'mine_label', mine_label,
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', t.label, 'lists', t.lists) ORDER BY t.label)
      FROM (
        SELECT x.label, jsonb_agg(x.entry ORDER BY x.name) AS lists
        FROM (
          SELECT
            COALESCE(g.label, 'The Johnson kids') AS label,
            l.display_name AS name,
            jsonb_build_object(
              'list_id', l.id,
              'kid_key', l.kid_key,
              'display_name', l.display_name,
              'share_slug', l.share_slug,
              'list_kind', l.list_kind,
              'item_count', (SELECT count(*) FROM public.gift_items i WHERE i.list_id = l.id AND i.review_status = 'approved'),
              'mine', (SELECT private.viewer_owns_list(l.id)) OR COALESCE(m.manager_user_id = uid, false),
              'managed_by', CASE WHEN m.list_id IS NOT NULL AND m.manager_user_id IS DISTINCT FROM uid THEN m.manager_name END
            ) AS entry
          FROM public.gift_lists l
          LEFT JOIN public.gift_participants gp ON gp.list_id = l.id
          LEFT JOIN public.gift_groups g ON g.id = gp.group_id
          LEFT JOIN public.gift_managed_members m ON m.list_id = l.id
          WHERE l.household_id = hid
        ) x
        GROUP BY x.label
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_family_directory()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_family_directory(); $$;

REVOKE ALL ON FUNCTION private.get_family_directory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_family_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_family_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_family_directory() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. "They won't sign up, I'll keep their list"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.admin_set_wont_sign_up(p_participant uuid, p_wont boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid := private.owned_household();
  person public.gift_participants;
BEGIN
  SELECT gp.* INTO person FROM public.gift_participants gp
  JOIN public.gift_profiles pr ON pr.participant_id = gp.id
  WHERE gp.id = p_participant AND gp.household_id = hid;
  IF hid IS NULL OR person.id IS NULL THEN
    RAISE EXCEPTION 'Only Andrew can change this';
  END IF;
  IF COALESCE(p_wont, false) AND person.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Someone has claimed this profile. Undo the claim first.';
  END IF;
  UPDATE public.gift_profiles pr SET wont_sign_up = COALESCE(p_wont, false) WHERE pr.participant_id = person.id;
  RETURN private.family_profile_json(person.id)
    || jsonb_build_object('wont_sign_up', COALESCE(p_wont, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_wont_sign_up(p_participant uuid, p_wont boolean)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_set_wont_sign_up(p_participant, p_wont); $$;
REVOKE ALL ON FUNCTION private.admin_set_wont_sign_up(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_wont_sign_up(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.admin_set_wont_sign_up(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_wont_sign_up(uuid, boolean) TO authenticated;

-- Picker: hide names Andrew is keeping himself.
CREATE OR REPLACE FUNCTION private.list_claimable_profiles(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  link public.gift_invites := private.active_family_invite(p_token);
  mine public.gift_participants;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF link.id IS NULL THEN
    RAISE EXCEPTION 'This family link is turned off or expired. Ask Andrew for the new one.';
  END IF;
  SELECT * INTO mine FROM public.gift_participants gp
  WHERE gp.household_id = link.household_id AND gp.user_id = uid LIMIT 1;
  RETURN jsonb_build_object(
    'already', CASE WHEN mine.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', mine.display_name,
      'kid_key', (SELECT l.kid_key FROM public.gift_lists l WHERE l.id = mine.list_id)
    ) END,
    'profiles', CASE WHEN mine.id IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'name', gp.display_name) ORDER BY gp.display_name)
      FROM public.gift_profiles pr
      JOIN public.gift_participants gp ON gp.id = pr.participant_id
      WHERE pr.household_id = link.household_id AND gp.user_id IS NULL AND NOT pr.wont_sign_up
    ), '[]'::jsonb) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.family_link_info(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  link public.gift_invites := private.active_family_invite(p_token);
BEGIN
  IF link.id IS NULL THEN
    RETURN jsonb_build_object('status', 'inactive', 'has_profiles', false);
  END IF;
  RETURN jsonb_build_object(
    'status', 'active',
    'has_profiles', EXISTS (
      SELECT 1 FROM public.gift_profiles pr
      JOIN public.gift_participants gp ON gp.id = pr.participant_id
      WHERE pr.household_id = link.household_id AND gp.user_id IS NULL AND NOT pr.wont_sign_up
    )
  );
END;
$$;

-- Claiming a name Andrew is keeping is refused (same message as an unknown name).
CREATE OR REPLACE FUNCTION private.claim_gift_profile(p_token text, p_participant uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  link public.gift_invites := private.active_family_invite(p_token);
  mine public.gift_participants;
  target public.gift_participants;
  bound public.gift_participants;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF link.id IS NULL THEN
    RAISE EXCEPTION 'This family link is turned off or expired. Ask Andrew for the new one.';
  END IF;

  SELECT * INTO mine FROM public.gift_participants gp
  WHERE gp.household_id = link.household_id AND gp.user_id = uid LIMIT 1;
  IF mine.id IS NOT NULL THEN
    IF mine.id = p_participant THEN
      RETURN jsonb_build_object('participant_id', mine.id, 'name', mine.display_name,
        'kid_key', (SELECT l.kid_key FROM public.gift_lists l WHERE l.id = mine.list_id), 'already', true);
    END IF;
    RAISE EXCEPTION 'You are already on the list as %. If that is wrong, ask Andrew to fix it.', mine.display_name;
  END IF;

  SELECT gp.* INTO target FROM public.gift_participants gp
  JOIN public.gift_profiles pr ON pr.participant_id = gp.id
  WHERE gp.id = p_participant AND gp.household_id = link.household_id
    AND NOT pr.wont_sign_up;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'That name is not on this family list';
  END IF;

  BEGIN
    bound := private.bind_gift_profile(target.id, uid);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You are already on the list. If that is wrong, ask Andrew to fix it.';
  END;
  IF bound.id IS NULL THEN
    RAISE EXCEPTION 'Someone already picked %. Pick again, or ask Andrew if that was you.', target.display_name;
  END IF;

  IF link.single_use AND link.used_at IS NULL THEN
    UPDATE public.gift_invites SET used_at = now(), used_by = uid WHERE id = link.id;
  END IF;

  RETURN jsonb_build_object(
    'participant_id', bound.id,
    'name', bound.display_name,
    'kid_key', (SELECT l.kid_key FROM public.gift_lists l WHERE l.id = bound.list_id),
    'already', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.admin_list_profiles()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN private.owned_household() IS NULL THEN NULL ELSE jsonb_build_object(
    'link', (
      SELECT jsonb_build_object('token', i.token, 'created_at', i.created_at)
      FROM public.gift_invites i
      WHERE i.household_id = private.owned_household() AND NOT i.single_use AND i.revoked_at IS NULL
        AND (i.expires_at IS NULL OR i.expires_at > now())
      ORDER BY i.created_at DESC LIMIT 1
    ),
    'groups', COALESCE((
      SELECT jsonb_agg(g.label ORDER BY g.label)
      FROM public.gift_groups g WHERE g.household_id = private.owned_household()
        AND EXISTS (SELECT 1 FROM public.gift_participants gx WHERE gx.group_id = g.id)
    ), '[]'::jsonb),
    'profiles', COALESCE((
      SELECT jsonb_agg((private.family_profile_json(pr.participant_id) || jsonb_build_object('wont_sign_up', pr.wont_sign_up)) ORDER BY p.display_name)
      FROM public.gift_profiles pr
      JOIN public.gift_participants p ON p.id = pr.participant_id
      WHERE pr.household_id = private.owned_household()
    ), '[]'::jsonb)
  ) END;
$$;

CREATE OR REPLACE FUNCTION private.admin_update_profile(p_participant uuid, p_name text, p_group text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid := private.owned_household();
  person public.gift_participants;
  clean_name text := btrim(COALESCE(p_name, ''));
  clean_group text := NULLIF(left(btrim(COALESCE(p_group, '')), 80), '');
  clean_email text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  grp uuid;
BEGIN
  SELECT gp.* INTO person FROM public.gift_participants gp
  JOIN public.gift_profiles pr ON pr.participant_id = gp.id
  WHERE gp.id = p_participant AND gp.household_id = hid;
  IF hid IS NULL OR person.id IS NULL THEN
    RAISE EXCEPTION 'Only Andrew can change this';
  END IF;
  IF char_length(clean_name) < 1 OR char_length(clean_name) > 80 THEN
    RAISE EXCEPTION 'Enter a name';
  END IF;
  IF clean_email IS NOT NULL AND (position('@' IN clean_email) < 2 OR char_length(clean_email) > 254) THEN
    RAISE EXCEPTION 'That email does not look right';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gift_participants gp
    WHERE gp.household_id = hid AND gp.id <> person.id AND lower(btrim(gp.display_name)) = lower(clean_name)
  ) THEN
    RAISE EXCEPTION '% is already on the list. Use a different name, like a last initial.', clean_name;
  END IF;
  IF clean_group IS NOT NULL THEN
    SELECT g.id INTO grp FROM public.gift_groups g
    WHERE g.household_id = hid AND lower(g.label) = lower(clean_group) LIMIT 1;
    IF grp IS NULL THEN
      INSERT INTO public.gift_groups (household_id, label) VALUES (hid, clean_group) RETURNING id INTO grp;
    END IF;
  END IF;
  UPDATE public.gift_participants gp
  SET display_name = clean_name, group_id = COALESCE(grp, gp.group_id)
  WHERE gp.id = person.id;
  UPDATE public.gift_lists gl SET display_name = clean_name WHERE gl.id = person.list_id;
  UPDATE public.gift_profiles pr SET email = clean_email WHERE pr.participant_id = person.id;
  -- Keep "Managed by <name>" on the lists this person manages in step with a rename.
  UPDATE public.gift_managed_members mm SET manager_name = left(clean_name, 80) WHERE mm.manager_participant_id = person.id;
  RETURN private.family_profile_json(person.id);
END;
$$;

-- 5. One-time Invite link and "I'm not on the list": locked means not in the drawing.
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
  joins_draw boolean := true;
  ev public.secret_santa_events;
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
    -- A new person joins the drawing only while it is not locked (same rule as
    -- Andrew's "Add to the list"). A draft draw is cleared so it is drawn again.
    SELECT * INTO ev FROM public.secret_santa_events e
    WHERE e.household_id = invite.household_id AND e.occasion = 'Christmas 2026';
    joins_draw := ev.status IS DISTINCT FROM 'locked';
    IF ev.status = 'draft' THEN
      DELETE FROM public.secret_santa_assignments sa WHERE sa.event_id = ev.id;
      UPDATE public.secret_santa_events se SET status = 'open', drawn_at = NULL WHERE se.id = ev.id;
    END IF;
    INSERT INTO public.gift_participants (
      household_id, group_id, user_id, display_name, list_id, in_draw, submitted_at
    )
    VALUES (
      invite.household_id,
      v.group_id,
      uid,
      btrim(p_name),
      v.list_id,
      joins_draw,
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

CREATE OR REPLACE FUNCTION private.preview_family_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean text := btrim(COALESCE(p_token, ''));
  gift public.gift_invites;
  event public.family_invites;
  status text;
BEGIN
  IF char_length(clean) < 16 THEN
    RETURN jsonb_build_object('status', 'missing', 'kind', NULL, 'label', '', 'party_slug', NULL);
  END IF;

  SELECT * INTO event
  FROM public.family_invites i
  WHERE i.token = clean;

  IF event.id IS NOT NULL THEN
    status := private.invite_status(event.revoked_at, event.expires_at, true, event.used_at, event.used_by);
    RETURN jsonb_build_object(
      'status', status,
      'kind', 'event',
      'label', event.label,
      'party_slug', event.party_slug
    );
  END IF;

  SELECT * INTO gift
  FROM public.gift_invites i
  WHERE i.token = clean;

  IF gift.id IS NULL THEN
    RETURN jsonb_build_object('status', 'missing', 'kind', NULL, 'label', '', 'party_slug', NULL);
  END IF;

  status := private.invite_status(gift.revoked_at, gift.expires_at, gift.single_use, gift.used_at, gift.used_by);
  RETURN jsonb_build_object(
    'status', status,
    'kind', 'gift_list',
    'label', gift.label,
    'party_slug', NULL,
    'drawing_locked', EXISTS (
      SELECT 1 FROM public.secret_santa_events e
      WHERE e.household_id = gift.household_id AND e.occasion = 'Christmas 2026' AND e.status = 'locked'
    )
  );
END;
$$;

-- 6. No duplicate names when adding or renaming a family member.
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
  event public.secret_santa_events;
  joins_draw boolean;
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
  IF EXISTS (
    SELECT 1 FROM public.gift_participants gp
    WHERE gp.household_id = manager.household_id AND lower(btrim(gp.display_name)) = lower(clean_name)
  ) OR EXISTS (
    SELECT 1 FROM public.gift_lists gl
    WHERE gl.household_id = manager.household_id AND lower(btrim(gl.display_name)) = lower(clean_name)
  ) THEN
    RAISE EXCEPTION '% is already on the family list. If this is a different person, add a last initial or nickname so everyone can tell them apart.', clean_name;
  END IF;

  IF (SELECT count(*) FROM public.gift_managed_members m WHERE m.manager_user_id = uid) >= 12 THEN
    RAISE EXCEPTION 'Twelve family members is the limit for one person';
  END IF;

  SELECT l.occasion INTO occasion FROM public.gift_lists l WHERE l.id = manager.list_id;

  -- Secret Santa: a new family member joins the drawing like anyone else,
  -- unless the drawing is already locked. A draft draw is cleared so Andrew
  -- draws again with them in it (same as set_participant_in_draw).
  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = manager.household_id AND e.occasion = 'Christmas 2026';
  joins_draw := event.status IS DISTINCT FROM 'locked';
  IF event.status = 'draft' THEN
    DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
    UPDATE public.secret_santa_events SET status = 'open', drawn_at = NULL WHERE id = event.id;
  END IF;

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
  -- Same group as the manager, so "avoid same household" keeps them apart.
  VALUES (manager.household_id, manager.group_id, NULL, clean_name, new_list, joins_draw, NULL)
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
  hid uuid;
BEGIN
  IF NOT (SELECT private.manages_gift_list(p_list)) THEN
    RAISE EXCEPTION 'Only the person who added them, or Andrew, can change this';
  END IF;
  IF char_length(clean_name) < 1 OR char_length(clean_name) > 80 THEN
    RAISE EXCEPTION 'Enter a name';
  END IF;
  SELECT gl.household_id INTO hid FROM public.gift_lists gl WHERE gl.id = p_list;
  -- Only when the name actually changes, so editing age or relationship still works
  -- for someone who already shares a name with another person.
  IF lower(btrim(COALESCE((SELECT gl0.display_name FROM public.gift_lists gl0 WHERE gl0.id = p_list), ''))) IS DISTINCT FROM lower(clean_name)
    AND (EXISTS (
      SELECT 1 FROM public.gift_participants gp
      WHERE gp.household_id = hid AND gp.list_id IS DISTINCT FROM p_list AND lower(btrim(gp.display_name)) = lower(clean_name)
    ) OR EXISTS (
      SELECT 1 FROM public.gift_lists gl
      WHERE gl.household_id = hid AND gl.id <> p_list AND lower(btrim(gl.display_name)) = lower(clean_name)
    ))
  THEN
    RAISE EXCEPTION '% is already on the family list. If this is a different person, add a last initial or nickname so everyone can tell them apart.', clean_name;
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
