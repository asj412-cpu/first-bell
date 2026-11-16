-- Family invites, email re-entry bookkeeping, household tasks, and event boards.
-- Additive. Do not apply until Andrew approves this pull request.
-- The app does not run this file. No service role key belongs in the app or this repo.
--
-- Invite links are created by a household admin and shared from their phone
-- (copy, share sheet, sms:, mailto:). This database does not send email or SMS.
-- A new invite expires in 30 days and is single-use. The older standing Christmas
-- link (single_use = false, no expiry) keeps working for anyone who already has it.
--
-- Email re-entry: verified_emails records an address only after that person
-- completes the existing OTP / magic-link sign-in. reentry_gate is executable
-- by the service role only. The browser never sees the service role key.

ALTER TABLE public.gift_invites
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS used_at timestamptz,
  ADD COLUMN IF NOT EXISTS used_by uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS single_use boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.family_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  token text NOT NULL CHECK (char_length(token) BETWEEN 16 AND 80),
  kind text NOT NULL CHECK (kind IN ('event')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  party_slug text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz,
  CONSTRAINT family_invites_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS family_invites_household_idx
  ON public.family_invites (household_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.event_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  party_slug text NOT NULL,
  user_id uuid NOT NULL,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  email text NOT NULL CHECK (position('@' IN email) > 1),
  rsvp text NOT NULL DEFAULT 'none' CHECK (rsvp IN ('yes', 'no', 'maybe', 'none')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_guests_party_user_unique UNIQUE (party_slug, user_id)
);

CREATE TABLE IF NOT EXISTS public.event_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  party_slug text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bring', 'task')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  owner_name text CHECK (owner_name IS NULL OR char_length(owner_name) <= 80),
  done_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_contributions_party_idx
  ON public.event_contributions (party_slug, created_at);

CREATE TABLE IF NOT EXISTS public.household_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 8 AND 80),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_tasks_client_unique UNIQUE (household_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.verified_emails (
  email text PRIMARY KEY CHECK (position('@' IN email) > 1 AND char_length(email) <= 254),
  user_id uuid,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reentry_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reentry_attempts_email_idx
  ON public.reentry_attempts (email, created_at DESC);

CREATE INDEX IF NOT EXISTS reentry_attempts_ip_idx
  ON public.reentry_attempts (ip, created_at DESC);

ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reentry_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.family_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.event_guests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.event_contributions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.household_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.verified_emails FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reentry_attempts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.family_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.event_guests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.event_contributions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.household_tasks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.verified_emails FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reentry_attempts FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invite helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.new_invite_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40);
$$;

CREATE OR REPLACE FUNCTION private.invite_status(
  revoked timestamptz,
  expires_at timestamptz,
  single_use boolean,
  used_at timestamptz,
  used_by uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN revoked IS NOT NULL THEN 'missing'
    WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired'
    WHEN single_use AND used_at IS NOT NULL AND used_by IS DISTINCT FROM (SELECT auth.uid()) THEN 'used'
    ELSE 'active'
  END;
$$;

CREATE OR REPLACE FUNCTION private.create_family_invite(
  p_kind text,
  p_party_slug text,
  p_label text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  hid uuid;
  token text;
  label text;
  expires_at timestamptz := now() + interval '30 days';
  party_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;

  SELECT hm.household_id INTO hid
  FROM public.household_members hm
  WHERE hm.user_id = uid AND hm.role = 'owner'
  LIMIT 1;

  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only a household admin can invite someone';
  END IF;

  IF p_kind NOT IN ('gift_list', 'event') THEN
    RAISE EXCEPTION 'Unknown invite';
  END IF;

  label := left(btrim(COALESCE(p_label, '')), 80);
  IF char_length(label) < 2 THEN
    label := CASE WHEN p_kind = 'event' THEN 'Family event' ELSE 'Christmas 2026' END;
  END IF;

  token := private.new_invite_token();

  IF p_kind = 'event' THEN
    IF btrim(COALESCE(p_party_slug, '')) = '' THEN
      RAISE EXCEPTION 'Choose an event';
    END IF;
    SELECT p.id INTO party_id
    FROM public.parties p
    WHERE p.slug = btrim(p_party_slug)
      AND p.household_id = hid;
    IF party_id IS NULL THEN
      RAISE EXCEPTION 'That event was not found';
    END IF;

    INSERT INTO public.family_invites (
      household_id, token, kind, label, party_slug, created_by, expires_at
    )
    VALUES (hid, token, 'event', label, btrim(p_party_slug), uid, expires_at);
  ELSE
    INSERT INTO public.gift_invites (
      household_id, token, label, created_by, expires_at, single_use
    )
    VALUES (hid, token, label, uid, expires_at, true);
  END IF;

  RETURN jsonb_build_object(
    'token', token,
    'kind', p_kind,
    'label', label,
    'expires_at', expires_at,
    'party_slug', CASE WHEN p_kind = 'event' THEN btrim(p_party_slug) ELSE NULL END
  );
END;
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
    'party_slug', NULL
  );
END;
$$;

-- Replace accept so a person can join with name, phone, and email, then fill
-- the list afterwards. Expired and already-used single-use links are refused.
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
      SELECT 1 FROM public.gift_items i WHERE i.list_id = accept_gift_invite.list_id
    );
  END IF;

  IF person_id IS NULL THEN
    INSERT INTO public.gift_participants (
      household_id, group_id, user_id, display_name, list_id, in_draw, submitted_at
    )
    VALUES (
      invite.household_id,
      accept_gift_invite.group_id,
      uid,
      btrim(p_name),
      accept_gift_invite.list_id,
      true,
      CASE WHEN has_ideas THEN now() ELSE NULL END
    )
    RETURNING id INTO person_id;
  ELSE
    UPDATE public.gift_participants AS participant
    SET group_id = accept_gift_invite.group_id,
        display_name = btrim(p_name),
        list_id = accept_gift_invite.list_id,
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
    WHERE gift.list_id = accept_gift_invite.list_id
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
END;
$$;

CREATE OR REPLACE FUNCTION private.accept_event_invite(
  p_token text,
  p_name text,
  p_rsvp text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  mail text := lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''));
  invite public.family_invites;
  party public.parties;
  status text;
  guest_id uuid;
BEGIN
  IF uid IS NULL OR mail = '' THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF char_length(btrim(COALESCE(p_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Enter your name';
  END IF;
  status := CASE
    WHEN p_rsvp IN ('yes', 'no', 'maybe') THEN p_rsvp
    ELSE 'none'
  END;

  SELECT * INTO invite
  FROM public.family_invites i
  WHERE i.token = btrim(COALESCE(p_token, ''))
    AND i.revoked_at IS NULL
    AND i.kind = 'event';

  IF invite.id IS NULL THEN
    RAISE EXCEPTION 'That invite link is not active';
  END IF;
  IF invite.expires_at <= now() THEN
    RAISE EXCEPTION 'That invite expired. Ask for a new link';
  END IF;
  IF invite.used_at IS NOT NULL AND invite.used_by IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'That invite has already been used';
  END IF;

  SELECT * INTO party
  FROM public.parties p
  WHERE p.slug = invite.party_slug
    AND p.household_id = invite.household_id;

  IF party.id IS NULL THEN
    RAISE EXCEPTION 'That event was not found';
  END IF;

  INSERT INTO public.event_guests (
    household_id, party_slug, user_id, display_name, email, rsvp
  )
  VALUES (invite.household_id, invite.party_slug, uid, btrim(p_name), mail, status)
  ON CONFLICT (party_slug, user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      rsvp = EXCLUDED.rsvp
  RETURNING id INTO guest_id;

  INSERT INTO public.rsvps (party_id, guest_name, parent_name, status)
  VALUES (
    party.id,
    btrim(p_name),
    NULL,
    CASE status WHEN 'none' THEN 'no_response' ELSE status END
  )
  ON CONFLICT (party_id, guest_name_norm) DO UPDATE
  SET status = EXCLUDED.status,
      updated_at = now();

  IF invite.used_at IS NULL THEN
    UPDATE public.family_invites
    SET used_at = now(),
        used_by = uid
    WHERE id = invite.id;
  END IF;

  RETURN jsonb_build_object(
    'guest_id', guest_id,
    'party_slug', invite.party_slug,
    'rsvp', status,
    'label', invite.label
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.get_my_event_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'party_slug', g.party_slug,
    'display_name', g.display_name,
    'rsvp', g.rsvp,
    'label', COALESCE(p.title, g.party_slug)
  ) ORDER BY g.created_at), '[]'::jsonb)
  FROM public.event_guests g
  LEFT JOIN public.parties p
    ON p.slug = g.party_slug
   AND p.household_id = g.household_id
  WHERE g.user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.caller_can_see_event(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.parties p
    JOIN public.household_members hm ON hm.household_id = p.household_id
    WHERE p.slug = p_slug
      AND hm.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1
    FROM public.event_guests g
    WHERE g.party_slug = p_slug
      AND g.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.list_event_contributions(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT private.caller_can_see_event(p_slug)) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'kind', c.kind,
      'title', c.title,
      'owner_name', COALESCE(c.owner_name, ''),
      'done', c.done_at IS NOT NULL
    ) ORDER BY c.created_at)
    FROM public.event_contributions c
    WHERE c.party_slug = p_slug
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION private.add_event_contribution(
  p_slug text,
  p_kind text,
  p_title text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  hid uuid;
  title text := left(btrim(COALESCE(p_title, '')), 120);
  row_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF NOT (SELECT private.caller_can_see_event(p_slug)) THEN
    RAISE EXCEPTION 'That event was not found';
  END IF;
  IF p_kind NOT IN ('bring', 'task') THEN
    RAISE EXCEPTION 'Choose bring or a task';
  END IF;
  IF char_length(title) < 2 THEN
    RAISE EXCEPTION 'Name the item';
  END IF;

  SELECT p.household_id INTO hid
  FROM public.parties p
  WHERE p.slug = p_slug
  LIMIT 1;

  INSERT INTO public.event_contributions (household_id, party_slug, kind, title, created_by)
  VALUES (hid, p_slug, p_kind, title, uid)
  RETURNING id INTO row_id;

  RETURN jsonb_build_object('id', row_id, 'kind', p_kind, 'title', title, 'owner_name', '', 'done', false);
END;
$$;

CREATE OR REPLACE FUNCTION private.set_event_contribution(
  p_id uuid,
  p_owner text,
  p_done boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row public.event_contributions;
  owner text := NULLIF(left(btrim(COALESCE(p_owner, '')), 80), '');
BEGIN
  SELECT * INTO row FROM public.event_contributions c WHERE c.id = p_id;
  IF row.id IS NULL OR NOT (SELECT private.caller_can_see_event(row.party_slug)) THEN
    RAISE EXCEPTION 'That item was not found';
  END IF;

  UPDATE public.event_contributions
  SET owner_name = owner,
      done_at = CASE WHEN p_done THEN COALESCE(done_at, now()) ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO row;

  RETURN jsonb_build_object(
    'id', row.id,
    'kind', row.kind,
    'title', row.title,
    'owner_name', COALESCE(row.owner_name, ''),
    'done', row.done_at IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.list_household_tasks()
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
  WHERE hm.user_id = (SELECT auth.uid())
  LIMIT 1;
  IF hid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.client_id,
      'title', t.title,
      'done', t.done_at IS NOT NULL
    ) ORDER BY t.created_at)
    FROM public.household_tasks t
    WHERE t.household_id = hid
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION private.save_household_task(
  p_client_id text,
  p_title text,
  p_done boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  hid uuid;
  title text := left(btrim(COALESCE(p_title, '')), 120);
  client text := btrim(COALESCE(p_client_id, ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  SELECT hm.household_id INTO hid
  FROM public.household_members hm
  WHERE hm.user_id = uid
    AND hm.role IN ('owner', 'member')
  LIMIT 1;
  IF hid IS NULL THEN
    RAISE EXCEPTION 'Only the household can edit chores';
  END IF;
  IF char_length(client) < 8 OR char_length(client) > 80 THEN
    RAISE EXCEPTION 'Could not save that chore';
  END IF;
  IF char_length(title) < 2 THEN
    RAISE EXCEPTION 'Name the chore';
  END IF;

  INSERT INTO public.household_tasks (household_id, client_id, title, done_at)
  VALUES (hid, client, title, CASE WHEN p_done THEN now() ELSE NULL END)
  ON CONFLICT (household_id, client_id) DO UPDATE
  SET title = EXCLUDED.title,
      done_at = CASE
        WHEN p_done THEN COALESCE(public.household_tasks.done_at, now())
        ELSE NULL
      END;

  RETURN jsonb_build_object('id', client, 'title', title, 'done', p_done);
END;
$$;

-- ---------------------------------------------------------------------------
-- Verified email flag + rate limit. Service role only for the gate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.mark_email_verified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  mail text := lower(btrim(COALESCE((SELECT auth.jwt() ->> 'email'), '')));
BEGIN
  IF uid IS NULL OR position('@' IN mail) < 2 THEN
    RETURN jsonb_build_object('verified', false);
  END IF;
  INSERT INTO public.verified_emails (email, user_id, verified_at)
  VALUES (mail, uid, now())
  ON CONFLICT (email) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      verified_at = now();
  RETURN jsonb_build_object('verified', true, 'verified_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION private.reentry_gate(p_email text, p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mail text := lower(btrim(COALESCE(p_email, '')));
  ip text := left(btrim(COALESCE(p_ip, 'unknown')), 64);
  email_count integer;
  ip_count integer;
  confirmed timestamptz;
  flagged timestamptz;
BEGIN
  IF position('@' IN mail) < 2 OR char_length(mail) > 254 THEN
    RETURN jsonb_build_object('allowed', false, 'verified', false);
  END IF;
  IF ip = '' THEN
    ip := 'unknown';
  END IF;

  DELETE FROM public.reentry_attempts
  WHERE created_at < now() - interval '1 day';

  INSERT INTO public.reentry_attempts (email, ip)
  VALUES (mail, ip);

  SELECT count(*) INTO email_count
  FROM public.reentry_attempts a
  WHERE a.email = mail
    AND a.created_at > now() - interval '15 minutes';

  SELECT count(*) INTO ip_count
  FROM public.reentry_attempts a
  WHERE a.ip = ip
    AND a.created_at > now() - interval '15 minutes';

  IF email_count > 5 OR ip_count > 20 THEN
    RETURN jsonb_build_object('allowed', false, 'verified', false);
  END IF;

  SELECT u.email_confirmed_at INTO confirmed
  FROM auth.users u
  WHERE lower(u.email) = mail
    AND u.deleted_at IS NULL
  LIMIT 1;

  SELECT v.verified_at INTO flagged
  FROM public.verified_emails v
  WHERE v.email = mail;

  RETURN jsonb_build_object(
    'allowed', true,
    'verified', confirmed IS NOT NULL OR flagged IS NOT NULL
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers. Privileges stay on private.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_family_invite(
  p_kind text,
  p_party_slug text DEFAULT NULL,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.create_family_invite(p_kind, p_party_slug, p_label); $$;

CREATE OR REPLACE FUNCTION public.preview_family_invite(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.preview_family_invite(p_token); $$;

CREATE OR REPLACE FUNCTION public.accept_event_invite(p_token text, p_name text, p_rsvp text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.accept_event_invite(p_token, p_name, p_rsvp); $$;

CREATE OR REPLACE FUNCTION public.get_my_event_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.get_my_event_access(); $$;

CREATE OR REPLACE FUNCTION public.list_event_contributions(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.list_event_contributions(p_slug); $$;

CREATE OR REPLACE FUNCTION public.add_event_contribution(p_slug text, p_kind text, p_title text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.add_event_contribution(p_slug, p_kind, p_title); $$;

CREATE OR REPLACE FUNCTION public.set_event_contribution(p_id uuid, p_owner text, p_done boolean)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.set_event_contribution(p_id, p_owner, p_done); $$;

CREATE OR REPLACE FUNCTION public.list_household_tasks()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.list_household_tasks(); $$;

CREATE OR REPLACE FUNCTION public.save_household_task(p_client_id text, p_title text, p_done boolean)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.save_household_task(p_client_id, p_title, p_done); $$;

CREATE OR REPLACE FUNCTION public.mark_email_verified()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.mark_email_verified(); $$;

CREATE OR REPLACE FUNCTION public.reentry_gate(p_email text, p_ip text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT private.reentry_gate(p_email, p_ip); $$;

REVOKE ALL ON FUNCTION private.new_invite_token() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.invite_status(timestamptz, timestamptz, boolean, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.create_family_invite(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.preview_family_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.accept_event_invite(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_my_event_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.caller_can_see_event(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.list_event_contributions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.add_event_contribution(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.set_event_contribution(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.list_household_tasks() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.save_household_task(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.mark_email_verified() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.reentry_gate(text, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_family_invite(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_family_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_event_invite(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_event_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_event_contributions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_event_contribution(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_event_contribution(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_household_tasks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_household_task(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_email_verified() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reentry_gate(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.create_family_invite(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.preview_family_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.accept_event_invite(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_event_access() TO authenticated;
GRANT EXECUTE ON FUNCTION private.list_event_contributions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.add_event_contribution(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.set_event_contribution(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.list_household_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION private.save_household_task(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION private.mark_email_verified() TO authenticated;
GRANT EXECUTE ON FUNCTION private.reentry_gate(text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_family_invite(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_family_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_event_invite(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_event_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_event_contributions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_event_contribution(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_contribution(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_household_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_household_task(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_email_verified() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reentry_gate(text, text) TO service_role;
