-- First Bell vNext (2026-10-15): history, calendar import, gift lists, meals.
-- Additive only. Does not alter household_members (that table is auth membership).
-- Kid birthdays live in household_profiles. Do not apply this file from the app.
-- Project tzkxuinbpmoeyhzomvut. Run in the SQL editor when Andrew is ready.

-- ---------------------------------------------------------------------------
-- Optional archive stamp. The app still decides History from ends_at
-- (or starts_at + 1 hour) in America/Chicago when this stays null.
-- ---------------------------------------------------------------------------

ALTER TABLE public.parties
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ---------------------------------------------------------------------------
-- Household events (drafts from "Plan this", plus anything the host adds)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.household_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  client_id text,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'plan',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  notes text,
  party_id uuid REFERENCES public.parties (id) ON DELETE SET NULL,
  draft boolean NOT NULL DEFAULT false,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_events_client_id_unique UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS household_events_household_idx
  ON public.household_events (household_id, starts_at);

-- ---------------------------------------------------------------------------
-- Family calendar imports. COO upserts with the service role. See docs/CALENDAR-SYNC.md.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_events_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  source text NOT NULL,
  external_uid text NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  notes text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_import_external_uid_unique UNIQUE (external_uid)
);

CREATE INDEX IF NOT EXISTS calendar_events_import_household_idx
  ON public.calendar_events_import (household_id, starts_at);

-- ---------------------------------------------------------------------------
-- Gift lists. Claims go through claim_gift_item. Anon has no table update.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gift_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  kid_key text NOT NULL,
  display_name text NOT NULL,
  occasion text NOT NULL DEFAULT 'Christmas 2026',
  share_slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_lists_share_slug_unique UNIQUE (share_slug),
  CONSTRAINT gift_lists_household_kid_occasion_unique UNIQUE (household_id, kid_key, occasion)
);

CREATE TABLE IF NOT EXISTS public.gift_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.gift_lists (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
  notes text,
  url text,
  url_secondary text,
  image text,
  availability text,
  sort integer NOT NULL DEFAULT 0,
  claimed_by_name text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_items_list_idx ON public.gift_items (list_id, sort);

-- ---------------------------------------------------------------------------
-- Meals. household_profiles holds kid settings; birth_date and grade may be null.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.household_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  member_key text NOT NULL,
  name text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'kid',
  birth_date date,
  grade text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_profiles_household_member_unique UNIQUE (household_id, member_key)
);

CREATE TABLE IF NOT EXISTS public.meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  week_start date NOT NULL,
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_plans_household_week_unique UNIQUE (household_id, week_start)
);

CREATE TABLE IF NOT EXISTS public.grocery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  week_start date NOT NULL,
  name text NOT NULL,
  aisle text,
  qty text,
  checked boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grocery_items_week_idx
  ON public.grocery_items (household_id, week_start);

DROP TRIGGER IF EXISTS meal_plans_touch_updated_at ON public.meal_plans;
CREATE TRIGGER meal_plans_touch_updated_at
  BEFORE UPDATE ON public.meal_plans
  FOR EACH ROW
  EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileged gift RPCs live in private. Public wrappers are invoker-only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.get_public_gift_list(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'list', jsonb_build_object(
      'id', l.id,
      'kid_key', l.kid_key,
      'display_name', l.display_name,
      'occasion', l.occasion,
      'share_slug', l.share_slug
    ),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'title', i.title,
          'notes', i.notes,
          'url', i.url,
          'url_secondary', i.url_secondary,
          'image', i.image,
          'availability', i.availability,
          'sort', i.sort,
          'claimed_by_name', i.claimed_by_name,
          'claimed_at', i.claimed_at
        )
        ORDER BY i.sort, i.created_at
      )
      FROM public.gift_items i
      WHERE i.list_id = l.id
    ), '[]'::jsonb)
  )
  INTO result
  FROM public.gift_lists l
  WHERE l.share_slug = trim(p_slug);

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION private.claim_gift_item(
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
  lid uuid;
  item public.gift_items;
  cname text;
BEGIN
  IF p_item_id IS NULL OR p_slug IS NULL OR trim(p_slug) = '' THEN
    RAISE EXCEPTION 'List and item are required';
  END IF;

  SELECT l.id INTO lid
  FROM public.gift_lists l
  WHERE l.share_slug = trim(p_slug);

  IF lid IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  cname := NULLIF(trim(COALESCE(p_name, '')), '');
  IF cname IS NOT NULL AND char_length(cname) > 80 THEN
    RAISE EXCEPTION 'Name is too long';
  END IF;

  UPDATE public.gift_items AS g
  SET claimed_by_name = cname,
      claimed_at = now()
  WHERE g.id = p_item_id
    AND g.list_id = lid
    AND g.claimed_at IS NULL
  RETURNING * INTO item;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.gift_items g
      WHERE g.id = p_item_id AND g.list_id = lid
    ) THEN
      RAISE EXCEPTION 'Already claimed';
    END IF;
    RAISE EXCEPTION 'Item not found';
  END IF;

  RETURN jsonb_build_object(
    'id', item.id,
    'claimed_by_name', item.claimed_by_name,
    'claimed_at', item.claimed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_gift_list(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_public_gift_list(p_slug);
$$;

CREATE OR REPLACE FUNCTION public.claim_gift_item(
  p_slug text,
  p_item_id uuid,
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.claim_gift_item(p_slug, p_item_id, p_name);
$$;

REVOKE ALL ON FUNCTION private.get_public_gift_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.claim_gift_item(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_gift_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_gift_item(text, uuid, text) FROM PUBLIC;

GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_public_gift_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.claim_gift_item(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_gift_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gift_item(text, uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.household_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS household_events_member_all ON public.household_events;
CREATE POLICY household_events_member_all
  ON public.household_events
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

DROP POLICY IF EXISTS calendar_import_member_select ON public.calendar_events_import;
CREATE POLICY calendar_import_member_select
  ON public.calendar_events_import
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)));

DROP POLICY IF EXISTS gift_lists_member_all ON public.gift_lists;
CREATE POLICY gift_lists_member_all
  ON public.gift_lists
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

DROP POLICY IF EXISTS gift_items_member_all ON public.gift_items;
CREATE POLICY gift_items_member_all
  ON public.gift_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.gift_lists l
      WHERE l.id = list_id
        AND (SELECT private.is_household_member(l.household_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.gift_lists l
      WHERE l.id = list_id
        AND (SELECT private.is_household_member(l.household_id))
    )
  );

DROP POLICY IF EXISTS household_profiles_member_all ON public.household_profiles;
CREATE POLICY household_profiles_member_all
  ON public.household_profiles
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

DROP POLICY IF EXISTS meal_plans_member_all ON public.meal_plans;
CREATE POLICY meal_plans_member_all
  ON public.meal_plans
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

DROP POLICY IF EXISTS grocery_items_member_all ON public.grocery_items;
CREATE POLICY grocery_items_member_all
  ON public.grocery_items
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_events TO authenticated;
GRANT SELECT ON public.calendar_events_import TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grocery_items TO authenticated;

-- No anon table grants. Public gift read and claim are the RPCs above.

-- ---------------------------------------------------------------------------
-- Seed birth dates from Andrew. Ages are not stored; the app computes them.
-- Claire’s grade stays null (kindergarten or 1st). Chloe starts at Pre-K.
-- Allergies (notes) stay null. No imported calendar rows.
-- ---------------------------------------------------------------------------

INSERT INTO public.household_profiles (id, household_id, member_key, name, full_name, role, birth_date, grade, notes)
VALUES
  ('55555555-5555-4555-8555-555555555504', '11111111-1111-4111-8111-111111111111', 'andrew', 'Andrew', 'Andrew Scott Johnson', 'parent', DATE '1985-04-12', NULL, NULL),
  ('55555555-5555-4555-8555-555555555505', '11111111-1111-4111-8111-111111111111', 'megan', 'Megan', 'Megan Quiroga Johnson', 'parent', DATE '1987-02-09', NULL, NULL),
  ('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111111', 'claire', 'Claire', 'Claire Lynn Johnson', 'kid', DATE '2020-02-10', NULL, NULL),
  ('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111111', 'chloe', 'Chloe', 'Chloe Margaret Johnson', 'kid', DATE '2021-10-13', 'Pre-K', NULL),
  ('55555555-5555-4555-8555-555555555503', '11111111-1111-4111-8111-111111111111', 'drew', 'Drew', 'Andrew Paul Johnson', 'kid', DATE '2026-02-10', NULL, NULL)
ON CONFLICT (household_id, member_key) DO NOTHING;

INSERT INTO public.gift_lists (id, household_id, kid_key, display_name, occasion, share_slug)
VALUES
  ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111111', 'chloe', 'Chloe', 'Christmas 2026', 'a8k2-chloe-xmas'),
  ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111111', 'claire', 'Claire', 'Christmas 2026', 'm4p9-claire-xmas'),
  ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111111', 'drew', 'Drew', 'Christmas 2026', 'q1w6-drew-xmas')
ON CONFLICT (share_slug) DO NOTHING;

INSERT INTO public.gift_items (id, list_id, title, notes, sort)
VALUES
  ('44444444-4444-4444-8444-444444444411', '44444444-4444-4444-8444-444444444401', 'Washable markers and a big drawing pad', 'Starter wish — edit or replace. Not pulled from a store.', 0),
  ('44444444-4444-4444-8444-444444444412', '44444444-4444-4444-8444-444444444401', 'Picture books to read together', 'Starter wish — edit or replace. Not pulled from a store.', 1),
  ('44444444-4444-4444-8444-444444444413', '44444444-4444-4444-8444-444444444401', 'A dress-up crown', 'Starter wish — edit or replace. Not pulled from a store.', 2),
  ('44444444-4444-4444-8444-444444444414', '44444444-4444-4444-8444-444444444401', 'Sidewalk chalk', 'Starter wish — edit or replace. Not pulled from a store.', 3),
  ('44444444-4444-4444-8444-444444444421', '44444444-4444-4444-8444-444444444402', 'A book Claire chooses', 'Starter wish — edit or replace. Not pulled from a store.', 0),
  ('44444444-4444-4444-8444-444444444422', '44444444-4444-4444-8444-444444444402', 'Cozy socks', 'Starter wish — edit or replace. Not pulled from a store.', 1),
  ('44444444-4444-4444-8444-444444444423', '44444444-4444-4444-8444-444444444402', 'Art paper and crayons', 'Starter wish — edit or replace. Not pulled from a store.', 2),
  ('44444444-4444-4444-8444-444444444431', '44444444-4444-4444-8444-444444444403', 'A soft bath book', 'Starter wish — edit or replace. Not pulled from a store.', 0),
  ('44444444-4444-4444-8444-444444444432', '44444444-4444-4444-8444-444444444403', 'A silicone spoon and bowl', 'Starter wish — edit or replace. Not pulled from a store.', 1),
  ('44444444-4444-4444-8444-444444444433', '44444444-4444-4444-8444-444444444403', 'A ball he can hold', 'Starter wish — edit or replace. Not pulled from a store.', 2)
ON CONFLICT (id) DO NOTHING;
