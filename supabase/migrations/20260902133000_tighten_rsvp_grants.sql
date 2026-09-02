-- Tighten grants/policies after the initial v2 schema.
-- ensure_host_membership is hosts-only; guest RSVP RPC stays callable by anon.
-- Combine overlapping SELECT/INSERT policies to avoid duplicate permissive RLS.

REVOKE ALL ON FUNCTION public.ensure_host_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_host_membership() TO authenticated;

DROP POLICY IF EXISTS parties_member_select ON public.parties;
DROP POLICY IF EXISTS parties_public_select ON public.parties;
DROP POLICY IF EXISTS parties_anon_select ON public.parties;
DROP POLICY IF EXISTS parties_auth_select ON public.parties;

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

DROP POLICY IF EXISTS rsvps_public_insert ON public.rsvps;

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
