-- Family vault. Additive. Stores ciphertext only.
-- Not applied by the app. Andrew runs this in the Supabase SQL editor when ready.
-- There is no decrypt function, no public bucket, and no signed-URL helper.

CREATE OR REPLACE FUNCTION private.is_household_owner(hid uuid)
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

REVOKE ALL ON FUNCTION private.is_household_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_household_owner(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.vault_parents (
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE OR REPLACE FUNCTION private.is_vault_parent(hid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT private.is_household_owner(hid))
    OR EXISTS (
      SELECT 1
      FROM public.vault_parents vp
      WHERE vp.household_id = hid
        AND vp.user_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION private.is_vault_parent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_vault_parent(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.enforce_vault_parent_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = NEW.household_id
      AND hm.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'vault parent must already be a household member';
  END IF;
  IF (
    SELECT count(*)
    FROM public.vault_parents vp
    WHERE vp.household_id = NEW.household_id
      AND vp.user_id <> NEW.user_id
  ) >= 1 THEN
    RAISE EXCEPTION 'vault allows the owner plus one other parent';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vault_parents_cap ON public.vault_parents;
CREATE TRIGGER vault_parents_cap
  BEFORE INSERT OR UPDATE ON public.vault_parents
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_vault_parent_cap();

CREATE TABLE IF NOT EXISTS public.vault_keys (
  household_id uuid PRIMARY KEY REFERENCES public.households (id) ON DELETE CASCADE,
  kdf text NOT NULL,
  kdf_salt text NOT NULL,
  kdf_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  wrapped_dek text NOT NULL,
  wrap_iv text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vault_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  wrapped_dek text NOT NULL,
  wrap_iv text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vault_records (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  iv text NOT NULL,
  ciphertext text NOT NULL,
  file_iv text,
  file_path text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vault_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('unlock', 'lock', 'add', 'view', 'delete', 'reveal')),
  record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_records_household_idx ON public.vault_records (household_id);
CREATE INDEX IF NOT EXISTS vault_audit_household_idx ON public.vault_audit (household_id, created_at DESC);

ALTER TABLE public.vault_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vault_parents_select ON public.vault_parents;
CREATE POLICY vault_parents_select
  ON public.vault_parents
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_vault_parent(household_id)));

DROP POLICY IF EXISTS vault_parents_owner_write ON public.vault_parents;
CREATE POLICY vault_parents_owner_write
  ON public.vault_parents
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_household_owner(household_id)));

DROP POLICY IF EXISTS vault_parents_owner_delete ON public.vault_parents;
CREATE POLICY vault_parents_owner_delete
  ON public.vault_parents
  FOR DELETE
  TO authenticated
  USING ((SELECT private.is_household_owner(household_id)));

DROP POLICY IF EXISTS vault_keys_parent_all ON public.vault_keys;
CREATE POLICY vault_keys_parent_all
  ON public.vault_keys
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_vault_parent(household_id)))
  WITH CHECK ((SELECT private.is_vault_parent(household_id)));

DROP POLICY IF EXISTS vault_passkeys_parent_all ON public.vault_passkeys;
CREATE POLICY vault_passkeys_parent_all
  ON public.vault_passkeys
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_vault_parent(household_id)))
  WITH CHECK (
    (SELECT private.is_vault_parent(household_id))
    AND user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS vault_records_parent_all ON public.vault_records;
CREATE POLICY vault_records_parent_all
  ON public.vault_records
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_vault_parent(household_id)))
  WITH CHECK ((SELECT private.is_vault_parent(household_id)));

DROP POLICY IF EXISTS vault_audit_parent_select ON public.vault_audit;
CREATE POLICY vault_audit_parent_select
  ON public.vault_audit
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_vault_parent(household_id)));

DROP POLICY IF EXISTS vault_audit_parent_insert ON public.vault_audit;
CREATE POLICY vault_audit_parent_insert
  ON public.vault_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT private.is_vault_parent(household_id))
    AND actor_id = (SELECT auth.uid())
  );

GRANT SELECT, INSERT, DELETE ON public.vault_parents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vault_keys TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.vault_passkeys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_records TO authenticated;
GRANT SELECT, INSERT ON public.vault_audit TO authenticated;

-- Private bucket. No public policy. No signed-URL function is created.
INSERT INTO storage.buckets (id, name, public)
VALUES ('vault', 'vault', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS vault_objects_parent_select ON storage.objects;
CREATE POLICY vault_objects_parent_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'vault'
    AND (SELECT private.is_vault_parent(((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS vault_objects_parent_insert ON storage.objects;
CREATE POLICY vault_objects_parent_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vault'
    AND (SELECT private.is_vault_parent(((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS vault_objects_parent_delete ON storage.objects;
CREATE POLICY vault_objects_parent_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'vault'
    AND (SELECT private.is_vault_parent(((storage.foldername(name))[1])::uuid))
  );
