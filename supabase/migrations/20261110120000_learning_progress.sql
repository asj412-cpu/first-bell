-- At-home learning parent checkmarks.
-- Additive only. New table name, so it does not collide with the unmerged
-- PR #5 catalog migrations (through 20261017040000_doll_clothes.sql).
-- Do not apply this from the app. Apply by hand on project
-- tzkxuinbpmoeyhzomvut after Andrew says yes.
-- Until then, checkmarks stay in localStorage key first-bell.v1.
-- No anon grants. No service-role use from the browser.

CREATE TABLE IF NOT EXISTS public.learning_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  kid_key text NOT NULL,
  week_start date NOT NULL,
  plan_id text NOT NULL,
  done boolean NOT NULL DEFAULT true,
  done_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, kid_key, week_start, plan_id)
);

CREATE INDEX IF NOT EXISTS learning_progress_household_idx
  ON public.learning_progress (household_id, kid_key, week_start);

ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learning_progress_member_all ON public.learning_progress;
CREATE POLICY learning_progress_member_all
  ON public.learning_progress
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_progress TO authenticated;
