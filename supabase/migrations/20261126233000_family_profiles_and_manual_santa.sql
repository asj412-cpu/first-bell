-- Family profiles, a shared "who are you?" family link, and offline Secret Santa (GJP-4).
-- Additive only: one new table and new functions. No existing table, column,
-- policy, or function is changed or dropped. No service role key is needed:
-- everything runs as SECURITY DEFINER RPCs that check the caller themselves.
--
-- How it works:
--   * Andrew (household owner) adds everyone as pre-made profiles. Each profile
--     is an ordinary gift list + gift_participants row (user_id NULL), managed by
--     Andrew (gift_managed_members), so he can fill in their gifts and they are in
--     Secret Santa like anyone else.
--   * Andrew shares ONE family link (a multi-use gift_invites token) into the
--     family group text. Whoever opens it signs in, picks who they are from the
--     unclaimed names, and their account is bound to that profile: same list,
--     same items, same Secret Santa slot. The "Managed by" row is removed.
--   * A claim is one UPDATE ... WHERE user_id IS NULL, so two people cannot take
--     the same name. The existing unique index (household_id, user_id) keeps it to
--     one profile per account per family.
--   * Andrew can see who claimed what, undo a claim, move a claim to another
--     profile, and make a new link or turn the link off.
--   * Offline Secret Santa: save_manual_secret_santa stores pairings Andrew drew
--     himself, after checking nobody has themselves and everyone gives once and
--     receives once.

CREATE TABLE IF NOT EXISTS public.gift_profiles (
  participant_id uuid PRIMARY KEY REFERENCES public.gift_participants (id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  email text CHECK (email IS NULL OR (position('@' IN email) > 1 AND char_length(email) <= 254)),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS gift_profiles_household_idx ON public.gift_profiles (household_id);

ALTER TABLE public.gift_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gift_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gift_profiles TO authenticated;
DROP POLICY IF EXISTS gift_profiles_owner_select ON public.gift_profiles;
CREATE POLICY gift_profiles_owner_select ON public.gift_profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.is_gift_household_owner(household_id)));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The household the caller owns, or NULL.
CREATE OR REPLACE FUNCTION private.owned_household()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT hm.household_id
  FROM public.household_members hm
  WHERE hm.user_id = (SELECT auth.uid()) AND hm.role = 'owner'
  ORDER BY hm.household_id
  LIMIT 1;
$$;

-- An active shared family link: not revoked, not expired, not a used single-use invite.
CREATE OR REPLACE FUNCTION private.active_family_invite(p_token text)
RETURNS public.gift_invites
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT i.*
  FROM public.gift_invites i
  WHERE i.token = btrim(COALESCE(p_token, ''))
    AND char_length(btrim(COALESCE(p_token, ''))) >= 16
    AND i.revoked_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > now())
    AND (NOT i.single_use OR i.used_at IS NULL OR i.used_by = (SELECT auth.uid()))
  LIMIT 1;
$$;

-- Bind a user to an unclaimed profile. One atomic UPDATE: if someone else got
-- there first, nothing changes and this returns NULL.
CREATE OR REPLACE FUNCTION private.bind_gift_profile(p_participant uuid, p_user uuid)
RETURNS public.gift_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  person public.gift_participants;
BEGIN
  UPDATE public.gift_participants gp
  SET user_id = p_user
  WHERE gp.id = p_participant
    AND gp.user_id IS NULL
    AND EXISTS (SELECT 1 FROM public.gift_profiles pr WHERE pr.participant_id = gp.id)
  RETURNING gp.* INTO person;

  IF person.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.gift_lists gl SET owner_user_id = p_user WHERE gl.id = person.list_id;
  DELETE FROM public.gift_managed_members mm WHERE mm.list_id = person.list_id;
  UPDATE public.gift_profiles pr
  SET claimed_at = now(), claimed_by = p_user
  WHERE pr.participant_id = person.id;
  RETURN person;
END;
$$;

-- Undo a claim: the profile goes back to Andrew, unclaimed. Items and the
-- Secret Santa slot stay with the profile.
CREATE OR REPLACE FUNCTION private.release_gift_profile(p_participant uuid, p_manager uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  person public.gift_participants;
  manager public.gift_participants;
BEGIN
  UPDATE public.gift_participants gp
  SET user_id = NULL
  WHERE gp.id = p_participant
  RETURNING gp.* INTO person;
  IF person.id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.gift_lists gl SET owner_user_id = NULL WHERE gl.id = person.list_id;
  UPDATE public.gift_profiles pr SET claimed_at = NULL, claimed_by = NULL WHERE pr.participant_id = person.id;

  SELECT * INTO manager FROM public.gift_participants mp
  WHERE mp.household_id = person.household_id AND mp.user_id = p_manager LIMIT 1;
  INSERT INTO public.gift_managed_members (
    list_id, household_id, participant_id, manager_participant_id, manager_user_id, manager_name
  )
  VALUES (
    person.list_id, person.household_id, person.id, manager.id, p_manager,
    left(COALESCE(NULLIF(btrim(manager.display_name), ''), 'Andrew'), 80)
  )
  ON CONFLICT (list_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION private.family_profile_json(p_participant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'participant_id', p.id,
    'name', p.display_name,
    'group_id', p.group_id,
    'group_label', g.label,
    'list_id', p.list_id,
    'kid_key', l.kid_key,
    'share_slug', l.share_slug,
    'in_draw', p.in_draw,
    'item_count', (SELECT count(*) FROM public.gift_items i WHERE i.list_id = p.list_id),
    'email', pr.email,
    'claimed', p.user_id IS NOT NULL,
    'claimed_at', pr.claimed_at,
    'claimed_email', (SELECT u.email FROM auth.users u WHERE u.id = p.user_id),
    'created_at', pr.created_at
  )
  FROM public.gift_profiles pr
  JOIN public.gift_participants p ON p.id = pr.participant_id
  LEFT JOIN public.gift_groups g ON g.id = p.group_id
  LEFT JOIN public.gift_lists l ON l.id = p.list_id
  WHERE pr.participant_id = p_participant;
$$;

-- ---------------------------------------------------------------------------
-- Owner (Andrew) functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.admin_add_profile(p_name text, p_group text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  hid uuid := private.owned_household();
  clean_name text := btrim(COALESCE(p_name, ''));
  clean_group text := NULLIF(left(btrim(COALESCE(p_group, '')), 80), '');
  clean_email text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  manager public.gift_participants;
  event public.secret_santa_events;
  grp uuid;
  new_list uuid;
  new_person uuid;
BEGIN
  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only Andrew can add people here';
  END IF;
  IF char_length(clean_name) < 1 OR char_length(clean_name) > 80 THEN
    RAISE EXCEPTION 'Enter a name';
  END IF;
  IF clean_email IS NOT NULL AND (position('@' IN clean_email) < 2 OR char_length(clean_email) > 254) THEN
    RAISE EXCEPTION 'That email does not look right';
  END IF;
  IF (SELECT count(*) FROM public.gift_profiles pr WHERE pr.household_id = hid) >= 80 THEN
    RAISE EXCEPTION 'Eighty people is the limit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gift_participants gp
    WHERE gp.household_id = hid AND lower(btrim(gp.display_name)) = lower(clean_name)
  ) THEN
    RAISE EXCEPTION '% is already on the list. Use a different name, like a last initial.', clean_name;
  END IF;

  clean_group := COALESCE(clean_group, clean_name);
  SELECT g.id INTO grp FROM public.gift_groups g
  WHERE g.household_id = hid AND lower(g.label) = lower(clean_group) LIMIT 1;
  IF grp IS NULL THEN
    INSERT INTO public.gift_groups (household_id, label) VALUES (hid, clean_group) RETURNING id INTO grp;
  END IF;

  SELECT * INTO event FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';
  IF event.status = 'draft' THEN
    DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
    UPDATE public.secret_santa_events SET status = 'open', drawn_at = NULL WHERE id = event.id;
  END IF;

  INSERT INTO public.gift_lists (
    household_id, kid_key, display_name, occasion, share_slug, list_kind, owner_user_id, created_by
  )
  VALUES (
    hid,
    'guest-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    clean_name,
    'Christmas 2026',
    'f' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    'exchange',
    NULL,
    uid
  )
  RETURNING id INTO new_list;

  INSERT INTO public.gift_participants (household_id, group_id, user_id, display_name, list_id, in_draw)
  VALUES (hid, grp, NULL, clean_name, new_list, event.status IS DISTINCT FROM 'locked')
  RETURNING id INTO new_person;

  SELECT * INTO manager FROM public.gift_participants mp
  WHERE mp.household_id = hid AND mp.user_id = uid LIMIT 1;
  INSERT INTO public.gift_managed_members (
    list_id, household_id, participant_id, manager_participant_id, manager_user_id, manager_name
  )
  VALUES (
    new_list, hid, new_person, manager.id, uid,
    left(COALESCE(NULLIF(btrim(manager.display_name), ''), 'Andrew'), 80)
  );

  INSERT INTO public.gift_profiles (participant_id, household_id, email, created_by)
  VALUES (new_person, hid, clean_email, uid);

  RETURN private.family_profile_json(new_person);
END;
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
  RETURN private.family_profile_json(person.id);
END;
$$;

-- Remove an unclaimed profile (and its list). A claimed one must be released first.
CREATE OR REPLACE FUNCTION private.admin_remove_profile(p_participant uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid := private.owned_household();
  person public.gift_participants;
  event public.secret_santa_events;
BEGIN
  SELECT gp.* INTO person FROM public.gift_participants gp
  JOIN public.gift_profiles pr ON pr.participant_id = gp.id
  WHERE gp.id = p_participant AND gp.household_id = hid;
  IF hid IS NULL OR person.id IS NULL THEN
    RAISE EXCEPTION 'Only Andrew can remove this';
  END IF;
  IF person.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Someone has claimed this profile. Undo the claim first.';
  END IF;
  SELECT * INTO event FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';
  IF event.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.secret_santa_assignments a
    WHERE a.event_id = event.id AND (a.giver_id = person.id OR a.receiver_id = person.id)
  ) THEN
    IF event.status = 'locked' THEN
      RAISE EXCEPTION 'Secret Santa is locked, so they stay in the drawing.';
    END IF;
    DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
    UPDATE public.secret_santa_events SET status = 'open', drawn_at = NULL WHERE id = event.id;
  END IF;
  DELETE FROM public.gift_participants WHERE id = person.id;
  DELETE FROM public.gift_lists WHERE id = person.list_id;
  RETURN jsonb_build_object('removed', true);
END;
$$;

-- The shared family link. p_action: 'get' (make one if none), 'rotate'
-- (turn off the old link, make a new one), 'revoke' (turn it off).
CREATE OR REPLACE FUNCTION private.admin_family_link(p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  hid uuid := private.owned_household();
  act text := lower(btrim(COALESCE(p_action, 'get')));
  link public.gift_invites;
BEGIN
  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only Andrew can manage the family link';
  END IF;
  IF act NOT IN ('get', 'rotate', 'revoke') THEN
    RAISE EXCEPTION 'Unknown action';
  END IF;
  IF act IN ('rotate', 'revoke') THEN
    UPDATE public.gift_invites i SET revoked_at = now()
    WHERE i.household_id = hid AND NOT i.single_use AND i.revoked_at IS NULL;
  END IF;
  IF act = 'revoke' THEN
    RETURN jsonb_build_object('token', NULL, 'created_at', NULL);
  END IF;

  SELECT * INTO link FROM public.gift_invites i
  WHERE i.household_id = hid AND NOT i.single_use AND i.revoked_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > now())
  ORDER BY i.created_at DESC LIMIT 1;

  IF link.id IS NULL THEN
    INSERT INTO public.gift_invites (household_id, token, label, single_use, created_by)
    VALUES (hid, private.new_invite_token(), 'Christmas 2026', false, uid)
    RETURNING * INTO link;
  END IF;
  RETURN jsonb_build_object('token', link.token, 'created_at', link.created_at);
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
    ), '[]'::jsonb),
    'profiles', COALESCE((
      SELECT jsonb_agg(private.family_profile_json(pr.participant_id) ORDER BY p.display_name)
      FROM public.gift_profiles pr
      JOIN public.gift_participants p ON p.id = pr.participant_id
      WHERE pr.household_id = private.owned_household()
    ), '[]'::jsonb)
  ) END;
$$;

CREATE OR REPLACE FUNCTION private.admin_unclaim_profile(p_participant uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid := private.owned_household();
BEGIN
  IF hid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.gift_profiles pr WHERE pr.participant_id = p_participant AND pr.household_id = hid
  ) THEN
    RAISE EXCEPTION 'Only Andrew can undo a claim';
  END IF;
  PERFORM private.release_gift_profile(p_participant, (SELECT auth.uid()));
  RETURN private.family_profile_json(p_participant);
END;
$$;

-- Fix a wrong pick: move whoever claimed p_from onto p_to (which must be unclaimed).
CREATE OR REPLACE FUNCTION private.admin_reassign_profile(p_from uuid, p_to uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid := private.owned_household();
  who uuid;
  bound public.gift_participants;
BEGIN
  IF hid IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.gift_profiles pr WHERE pr.participant_id = p_from AND pr.household_id = hid)
    OR NOT EXISTS (SELECT 1 FROM public.gift_profiles pr WHERE pr.participant_id = p_to AND pr.household_id = hid)
  THEN
    RAISE EXCEPTION 'Only Andrew can move a claim';
  END IF;
  SELECT gp.user_id INTO who FROM public.gift_participants gp WHERE gp.id = p_from FOR UPDATE;
  IF who IS NULL THEN
    RAISE EXCEPTION 'Nobody has claimed that profile';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gift_participants gp WHERE gp.id = p_to AND gp.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'That profile is already claimed';
  END IF;
  PERFORM private.release_gift_profile(p_from, (SELECT auth.uid()));
  bound := private.bind_gift_profile(p_to, who);
  IF bound.id IS NULL THEN
    RAISE EXCEPTION 'That profile is already claimed';
  END IF;
  RETURN jsonb_build_object('from', private.family_profile_json(p_from), 'to', private.family_profile_json(p_to));
END;
$$;

-- ---------------------------------------------------------------------------
-- Family link: open, pick who you are, claim
-- ---------------------------------------------------------------------------

-- Anyone with the link: is it active, and are there names to pick from?
-- Returns no names and nothing private.
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
      WHERE pr.household_id = link.household_id AND gp.user_id IS NULL
    )
  );
END;
$$;

-- Signed in with the link: the unclaimed names (display name only).
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
      WHERE pr.household_id = link.household_id AND gp.user_id IS NULL
    ), '[]'::jsonb) END
  );
END;
$$;

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
  WHERE gp.id = p_participant AND gp.household_id = link.household_id;
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

-- ---------------------------------------------------------------------------
-- Offline Secret Santa: Andrew enters the pairings he drew himself
-- ---------------------------------------------------------------------------

-- p_pairs: [{"giver": "<participant id>", "receiver": "<participant id>"}, ...]
-- covering everyone in the drawing exactly once as giver and once as receiver.
CREATE OR REPLACE FUNCTION private.save_manual_secret_santa(p_pairs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid := private.owned_household();
  event public.secret_santa_events;
  roster uuid[];
  pair jsonb;
  g uuid;
  r uuid;
  givers uuid[] := '{}';
  receivers uuid[] := '{}';
  missing_name text;
BEGIN
  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only Andrew or Megan can run Secret Santa';
  END IF;
  IF jsonb_typeof(p_pairs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Pairings were not a list';
  END IF;

  SELECT * INTO event FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';
  IF event.id IS NULL THEN
    INSERT INTO public.secret_santa_events (household_id) VALUES (hid) RETURNING * INTO event;
  END IF;
  IF event.status = 'locked' THEN
    RAISE EXCEPTION 'Secret Santa is locked';
  END IF;

  SELECT COALESCE(array_agg(gp.id), '{}') INTO roster
  FROM public.gift_participants gp WHERE gp.household_id = hid AND gp.in_draw;
  IF COALESCE(array_length(roster, 1), 0) < 2 THEN
    RAISE EXCEPTION 'Add at least two people to the drawing';
  END IF;

  FOR pair IN SELECT value FROM jsonb_array_elements(p_pairs) AS value LOOP
    BEGIN
      g := (pair ->> 'giver')::uuid;
      r := (pair ->> 'receiver')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Each pairing needs a giver and a receiver';
    END;
    IF g IS NULL OR r IS NULL THEN
      RAISE EXCEPTION 'Each pairing needs a giver and a receiver';
    END IF;
    IF NOT (g = ANY (roster)) OR NOT (r = ANY (roster)) THEN
      RAISE EXCEPTION 'Someone in these pairings is not in the drawing';
    END IF;
    IF g = r THEN
      RAISE EXCEPTION '% cannot draw themselves', (SELECT display_name FROM public.gift_participants WHERE id = g);
    END IF;
    IF g = ANY (givers) THEN
      RAISE EXCEPTION '% is giving more than once', (SELECT display_name FROM public.gift_participants WHERE id = g);
    END IF;
    IF r = ANY (receivers) THEN
      RAISE EXCEPTION '% is receiving more than once', (SELECT display_name FROM public.gift_participants WHERE id = r);
    END IF;
    givers := givers || g;
    receivers := receivers || r;
  END LOOP;

  SELECT gp.display_name INTO missing_name FROM public.gift_participants gp
  WHERE gp.id = ANY (roster) AND NOT (gp.id = ANY (givers)) ORDER BY gp.display_name LIMIT 1;
  IF missing_name IS NOT NULL THEN
    RAISE EXCEPTION 'Pick who % draws', missing_name;
  END IF;
  SELECT gp.display_name INTO missing_name FROM public.gift_participants gp
  WHERE gp.id = ANY (roster) AND NOT (gp.id = ANY (receivers)) ORDER BY gp.display_name LIMIT 1;
  IF missing_name IS NOT NULL THEN
    RAISE EXCEPTION 'Nobody is giving to %', missing_name;
  END IF;

  DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
  INSERT INTO public.secret_santa_assignments (event_id, giver_id, receiver_id)
  SELECT event.id, givers[i], receivers[i] FROM generate_subscripts(givers, 1) AS i;
  UPDATE public.secret_santa_events SET status = 'draft', drawn_at = now() WHERE id = event.id;
  RETURN private.get_exchange_overview();
END;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_add_profile(p_name text, p_group text DEFAULT NULL, p_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_add_profile(p_name, p_group, p_email); $$;
CREATE OR REPLACE FUNCTION public.admin_update_profile(p_participant uuid, p_name text, p_group text DEFAULT NULL, p_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_update_profile(p_participant, p_name, p_group, p_email); $$;
CREATE OR REPLACE FUNCTION public.admin_remove_profile(p_participant uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_remove_profile(p_participant); $$;
CREATE OR REPLACE FUNCTION public.admin_family_link(p_action text DEFAULT 'get')
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_family_link(p_action); $$;
CREATE OR REPLACE FUNCTION public.admin_list_profiles()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_list_profiles(); $$;
CREATE OR REPLACE FUNCTION public.admin_unclaim_profile(p_participant uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_unclaim_profile(p_participant); $$;
CREATE OR REPLACE FUNCTION public.admin_reassign_profile(p_from uuid, p_to uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.admin_reassign_profile(p_from, p_to); $$;
CREATE OR REPLACE FUNCTION public.family_link_info(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.family_link_info(p_token); $$;
CREATE OR REPLACE FUNCTION public.list_claimable_profiles(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.list_claimable_profiles(p_token); $$;
CREATE OR REPLACE FUNCTION public.claim_gift_profile(p_token text, p_participant uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.claim_gift_profile(p_token, p_participant); $$;
CREATE OR REPLACE FUNCTION public.save_manual_secret_santa(p_pairs jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.save_manual_secret_santa(p_pairs); $$;

-- Internal helpers: nobody calls these directly.
REVOKE ALL ON FUNCTION private.owned_household() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.active_family_invite(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.bind_gift_profile(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.release_gift_profile(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.family_profile_json(uuid) FROM PUBLIC, anon, authenticated;

-- Signed-in functions (each checks the caller itself).
DO $grants$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'admin_add_profile(text, text, text)',
    'admin_update_profile(uuid, text, text, text)',
    'admin_remove_profile(uuid)',
    'admin_family_link(text)',
    'admin_list_profiles()',
    'admin_unclaim_profile(uuid)',
    'admin_reassign_profile(uuid, uuid)',
    'list_claimable_profiles(text)',
    'claim_gift_profile(text, uuid)',
    'save_manual_secret_santa(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION private.%s FROM PUBLIC, anon', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION private.%s TO authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', sig);
  END LOOP;
END
$grants$;

-- Anyone holding the link (signed in or not) may ask whether it is active.
REVOKE ALL ON FUNCTION private.family_link_info(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.family_link_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.family_link_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_link_info(text) TO anon, authenticated;
