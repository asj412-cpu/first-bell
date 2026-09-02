-- First Bell v2: households, parties, RSVPs (RLS-safe)
-- Region: us-west-2 · project tzkxuinbpmoeyhzomvut
-- Guest RSVP works without login via public.submit_public_rsvp.
-- Hosts read/update RSVPs for their household after email OTP / magic link.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_email text,
  host_emails text[] NOT NULL DEFAULT '{}',
  timezone text NOT NULL DEFAULT 'America/Chicago',
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.household_members (
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE TABLE public.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  honoree text,
  age integer,
  theme text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  birthday date,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  venue_name text,
  venue_campus text,
  venue_address text,
  venue_package text,
  venue_package_detail text,
  venue_status text,
  venue_phone text,
  venue_notes text,
  contact_name text,
  contact_phone text,
  contact_email text,
  registry_url text,
  registry_label text,
  is_public boolean NOT NULL DEFAULT false,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parties_slug_unique UNIQUE (slug)
);

CREATE TABLE public.rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  guest_name text NOT NULL CHECK (char_length(trim(guest_name)) BETWEEN 1 AND 80),
  guest_name_norm text GENERATED ALWAYS AS (lower(trim(guest_name))) STORED,
  parent_name text CHECK (parent_name IS NULL OR char_length(parent_name) <= 80),
  status text NOT NULL CHECK (status IN ('yes', 'no', 'maybe', 'no_response')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rsvps_party_guest_unique UNIQUE (party_id, guest_name_norm)
);

CREATE INDEX household_members_user_id_idx ON public.household_members (user_id);
CREATE INDEX parties_household_id_idx ON public.parties (household_id);
CREATE INDEX rsvps_party_id_idx ON public.rsvps (party_id);
CREATE INDEX households_host_emails_idx ON public.households USING gin (host_emails);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER rsvps_touch_updated_at
  BEFORE UPDATE ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helper (SECURITY DEFINER, not exposed to anon)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.is_household_member(hid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = hid
      AND hm.user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION private.is_household_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_household_member(uuid) TO authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ---------------------------------------------------------------------------
-- Auto-link host emails on signup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mail text := lower(NEW.email);
BEGIN
  IF mail IS NULL OR mail = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.household_members (household_id, user_id, role)
  SELECT h.id, NEW.id, 'owner'
  FROM public.households h
  WHERE lower(h.contact_email) = mail
     OR mail = ANY (SELECT lower(e) FROM unnest(h.host_emails) e)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.ensure_host_membership()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  mail text := lower((SELECT auth.jwt() ->> 'email'));
  hid uuid;
  r text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT hm.household_id, hm.role
    INTO hid, r
  FROM public.household_members hm
  WHERE hm.user_id = uid
  LIMIT 1;

  IF hid IS NOT NULL THEN
    RETURN jsonb_build_object('household_id', hid, 'role', r, 'claimed', false);
  END IF;

  IF mail IS NOT NULL THEN
    SELECT h.id INTO hid
    FROM public.households h
    WHERE lower(COALESCE(h.contact_email, '')) = mail
       OR mail = ANY (SELECT lower(e) FROM unnest(h.host_emails) e)
    ORDER BY h.created_at
    LIMIT 1;

    IF hid IS NOT NULL THEN
      INSERT INTO public.household_members (household_id, user_id, role)
      VALUES (hid, uid, 'owner')
      ON CONFLICT DO NOTHING;
      RETURN jsonb_build_object('household_id', hid, 'role', 'owner', 'claimed', true);
    END IF;
  END IF;

  -- Restore-friendly bootstrap: first signed-in user claims the seeded household
  -- if it still has zero members.
  SELECT h.id INTO hid
  FROM public.households h
  WHERE h.is_seed = true
    AND NOT EXISTS (
      SELECT 1 FROM public.household_members m WHERE m.household_id = h.id
    )
  ORDER BY h.created_at
  LIMIT 1;

  IF hid IS NOT NULL THEN
    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES (hid, uid, 'owner');

    IF mail IS NOT NULL THEN
      UPDATE public.households
      SET host_emails = array_append(host_emails, mail)
      WHERE id = hid
        AND NOT (mail = ANY (SELECT lower(e) FROM unnest(host_emails) e));
    END IF;

    RETURN jsonb_build_object('household_id', hid, 'role', 'owner', 'claimed', true);
  END IF;

  RETURN jsonb_build_object('household_id', NULL, 'role', NULL, 'claimed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_host_membership()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.ensure_host_membership();
$$;

REVOKE ALL ON FUNCTION public.ensure_host_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_host_membership() TO authenticated;

CREATE OR REPLACE FUNCTION private.submit_public_rsvp(
  p_slug text,
  p_guest_name text,
  p_parent_name text DEFAULT NULL,
  p_status text DEFAULT 'yes',
  p_note text DEFAULT NULL
)
RETURNS public.rsvps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  row public.rsvps;
  st text;
  gname text;
  pname text;
  ntxt text;
BEGIN
  gname := trim(p_guest_name);
  IF gname IS NULL OR gname = '' THEN
    RAISE EXCEPTION 'Guest name is required';
  END IF;
  IF char_length(gname) > 80 THEN
    RAISE EXCEPTION 'Guest name is too long';
  END IF;

  st := lower(trim(p_status));
  IF st NOT IN ('yes', 'no', 'maybe') THEN
    RAISE EXCEPTION 'Status must be yes, no, or maybe';
  END IF;

  pname := NULLIF(trim(COALESCE(p_parent_name, '')), '');
  ntxt := NULLIF(trim(COALESCE(p_note, '')), '');

  SELECT p.id INTO pid
  FROM public.parties p
  WHERE p.slug = p_slug
    AND p.is_public = true;

  IF pid IS NULL THEN
    RAISE EXCEPTION 'Party not found';
  END IF;

  INSERT INTO public.rsvps (party_id, guest_name, parent_name, status, note)
  VALUES (pid, gname, pname, st, ntxt)
  ON CONFLICT ON CONSTRAINT rsvps_party_guest_unique
  DO UPDATE SET
    parent_name = COALESCE(EXCLUDED.parent_name, public.rsvps.parent_name),
    status = EXCLUDED.status,
    note = COALESCE(EXCLUDED.note, public.rsvps.note),
    updated_at = now()
  RETURNING * INTO row;

  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_rsvp(
  p_slug text,
  p_guest_name text,
  p_parent_name text DEFAULT NULL,
  p_status text DEFAULT 'yes',
  p_note text DEFAULT NULL
)
RETURNS public.rsvps
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM private.submit_public_rsvp(p_slug, p_guest_name, p_parent_name, p_status, p_note);
$$;

REVOKE ALL ON FUNCTION public.submit_public_rsvp(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_rsvp(text, text, text, text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY households_member_select
  ON public.households
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_household_member(id)));

CREATE POLICY household_members_select
  ON public.household_members
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)));

CREATE POLICY parties_anon_select
  ON public.parties
  FOR SELECT
  TO anon
  USING (is_public = true);

CREATE POLICY parties_auth_select
  ON public.parties
  FOR SELECT
  TO authenticated
  USING (
    is_public = true
    OR (SELECT private.is_household_member(household_id))
  );

CREATE POLICY parties_member_update
  ON public.parties
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

CREATE POLICY rsvps_member_all
  ON public.rsvps
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parties p
      WHERE p.id = party_id
        AND (SELECT private.is_household_member(p.household_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.parties p
      WHERE p.id = party_id
        AND (SELECT private.is_household_member(p.household_id))
    )
  );

-- Direct anon inserts as a fallback; the RPC is the supported guest path.
CREATE POLICY rsvps_public_insert
  ON public.rsvps
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.parties p
      WHERE p.id = party_id
        AND p.is_public = true
    )
    AND status IN ('yes', 'no', 'maybe', 'no_response')
  );

-- ---------------------------------------------------------------------------
-- Grants (RLS still applies)
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT ON public.households TO authenticated;
GRANT SELECT ON public.household_members TO authenticated;
GRANT SELECT ON public.parties TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rsvps TO authenticated;
GRANT INSERT ON public.rsvps TO anon;

-- ---------------------------------------------------------------------------
-- Realtime for the host RSVP board
-- ---------------------------------------------------------------------------

ALTER TABLE public.rsvps REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rsvps'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rsvps;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Chloe party seed — Saturday Oct 10 2026, 1:00–2:30pm America/Chicago
-- ---------------------------------------------------------------------------

INSERT INTO public.households (id, name, contact_email, host_emails, timezone, is_seed)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Johnson',
  'asj412@me.com',
  ARRAY['asj412@me.com', 'asj412@icloud.com'],
  'America/Chicago',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  contact_email = EXCLUDED.contact_email,
  host_emails = EXCLUDED.host_emails,
  timezone = EXCLUDED.timezone,
  is_seed = true;

INSERT INTO public.parties (
  id, household_id, slug, title, honoree, age, theme,
  starts_at, ends_at, birthday, timezone,
  venue_name, venue_campus, venue_address, venue_package, venue_package_detail,
  venue_status, venue_phone, venue_notes,
  contact_name, contact_phone, contact_email,
  registry_url, registry_label, is_public, is_seed
) VALUES (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'princess-chloe-5',
  'Princess Chloe is turning 5!',
  'Chloe',
  5,
  'Mario-movie style · Princess Peach',
  (timestamp '2026-10-10 13:00:00' AT TIME ZONE 'America/Chicago'),
  (timestamp '2026-10-10 14:30:00' AT TIME ZONE 'America/Chicago'),
  DATE '2026-10-13',
  'America/Chicago',
  'Cypress Academy of Gymnastics',
  'Kuykendahl',
  '23200 Kuykendahl Rd, Tomball, TX 77375',
  'SNAP Package A',
  '1–10 children · 1½ hours · 1 coach · paid',
  'paid',
  '281-766-4899',
  'Complimentary “Best Birthday Ever” T-shirt for the birthday child. Tables, chairs, and coaches provided. You may bring food, decorations, refreshments, and paper goods.',
  'Andrew',
  '936-355-1281',
  'asj412@me.com',
  'https://www.amazon.com/registries/gl/guest-view/L53W1XS578SM',
  'Amazon Registry',
  true,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  honoree = EXCLUDED.honoree,
  age = EXCLUDED.age,
  theme = EXCLUDED.theme,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  birthday = EXCLUDED.birthday,
  venue_name = EXCLUDED.venue_name,
  venue_campus = EXCLUDED.venue_campus,
  venue_address = EXCLUDED.venue_address,
  venue_package = EXCLUDED.venue_package,
  venue_package_detail = EXCLUDED.venue_package_detail,
  venue_status = EXCLUDED.venue_status,
  venue_phone = EXCLUDED.venue_phone,
  venue_notes = EXCLUDED.venue_notes,
  contact_name = EXCLUDED.contact_name,
  contact_phone = EXCLUDED.contact_phone,
  contact_email = EXCLUDED.contact_email,
  registry_url = EXCLUDED.registry_url,
  registry_label = EXCLUDED.registry_label,
  is_public = true,
  is_seed = true;

INSERT INTO public.rsvps (id, party_id, guest_name, parent_name, status, note)
VALUES
  ('33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222222', 'Leila', 'Leila''s Mom', 'yes', 'Preloaded RSVP'),
  ('33333333-3333-4333-8333-333333333302', '22222222-2222-4222-8222-222222222222', 'Harper', 'Harper''s Mom', 'no_response', NULL),
  ('33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222222', 'Nora', 'Nora''s Dad', 'no_response', NULL),
  ('33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222222', 'Isla', 'Isla''s Mom', 'no_response', NULL),
  ('33333333-3333-4333-8333-333333333305', '22222222-2222-4222-8222-222222222222', 'Ava', 'Ava''s Mom', 'no_response', NULL),
  ('33333333-3333-4333-8333-333333333306', '22222222-2222-4222-8222-222222222222', 'Mia', 'Mia''s Dad', 'no_response', NULL),
  ('33333333-3333-4333-8333-333333333307', '22222222-2222-4222-8222-222222222222', 'Zoe', 'Zoe''s Mom', 'no_response', NULL),
  ('33333333-3333-4333-8333-333333333308', '22222222-2222-4222-8222-222222222222', 'Riley', 'Riley''s Mom', 'no_response', NULL)
ON CONFLICT (id) DO NOTHING;
