-- Email-only re-entry, two ways (GJP-3).
-- Additive only: one new table and new functions. Nothing existing is changed or
-- dropped. The old public.reentry_gate is left in place but no longer called:
-- it errors ("column reference ip is ambiguous") and its public wrapper cannot
-- reach the private schema as service_role, so it never rate-limited anything.
-- No service role key belongs in the app or this repo.
--
-- Only the Vercel functions /api/reentry and /api/remember-device call these,
-- with the service role key from a server-only env var. Browsers cannot.
--
--   REENTRY_MODE=device (default): email-only works on a device that finished a
--     code or link sign-in before. The device holds a random token in an
--     httpOnly cookie; only its SHA-256 hash is stored here.
--   REENTRY_MODE=email: email-only works for any address that finished a code or
--     link sign-in before, on any device.
--   REENTRY_MODE=off: always send the code.

CREATE TABLE IF NOT EXISTS public.reentry_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (position('@' IN email) > 1 AND char_length(email) <= 254),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '180 days',
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS reentry_devices_user_idx ON public.reentry_devices (user_id);
CREATE INDEX IF NOT EXISTS reentry_attempts_email_time_idx ON public.reentry_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS reentry_attempts_ip_time_idx ON public.reentry_attempts (ip, created_at);

ALTER TABLE public.reentry_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reentry_devices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reentry_devices FROM PUBLIC, anon, authenticated;
-- No policies: only the definer functions below (and service_role) touch it.

-- Rate limit, then decide whether this email may skip the code.
-- Returns {allowed, ok}. allowed=false means "too many tries" and is returned
-- the same way whether or not the email exists. ok=true means mint a session.
CREATE OR REPLACE FUNCTION private.reentry_check(
  p_email text, p_ip text, p_device_hash text, p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mail text := lower(btrim(COALESCE(p_email, '')));
  v_ip text := NULLIF(left(btrim(COALESCE(p_ip, '')), 64), '');
  v_mode text := lower(btrim(COALESCE(p_mode, 'device')));
  v_email_tries integer;
  v_ip_tries integer;
  v_user uuid;
  v_device uuid;
BEGIN
  IF position('@' IN v_mail) < 2 OR char_length(v_mail) > 254 THEN
    RETURN jsonb_build_object('allowed', true, 'ok', false);
  END IF;
  v_ip := COALESCE(v_ip, 'unknown');

  DELETE FROM public.reentry_attempts WHERE created_at < now() - interval '1 day';
  INSERT INTO public.reentry_attempts (email, ip) VALUES (v_mail, v_ip);

  SELECT count(*) INTO v_email_tries FROM public.reentry_attempts ra
  WHERE ra.email = v_mail AND ra.created_at > now() - interval '15 minutes';
  SELECT count(*) INTO v_ip_tries FROM public.reentry_attempts ra
  WHERE ra.ip = v_ip AND ra.created_at > now() - interval '15 minutes';
  IF v_email_tries > 5 OR v_ip_tries > 20 THEN
    RETURN jsonb_build_object('allowed', false, 'ok', false);
  END IF;

  IF v_mode NOT IN ('email', 'device') THEN
    RETURN jsonb_build_object('allowed', true, 'ok', false);
  END IF;

  -- Someone who has signed in before: a confirmed, not banned, not deleted user.
  SELECT u.id INTO v_user
  FROM auth.users u
  WHERE lower(u.email) = v_mail
    AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until < now())
    AND (
      u.email_confirmed_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.verified_emails ve WHERE ve.email = v_mail AND ve.verified_at IS NOT NULL)
    )
  ORDER BY u.created_at
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'ok', false);
  END IF;

  IF v_mode = 'email' THEN
    RETURN jsonb_build_object('allowed', true, 'ok', true);
  END IF;

  -- device mode: this browser's token must belong to this same user.
  IF p_device_hash IS NULL OR p_device_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('allowed', true, 'ok', false);
  END IF;
  UPDATE public.reentry_devices d
  SET last_used_at = now(),
      expires_at = GREATEST(d.expires_at, now() + interval '180 days')
  WHERE d.token_hash = p_device_hash
    AND d.user_id = v_user
    AND d.revoked_at IS NULL
    AND d.expires_at > now()
  RETURNING d.id INTO v_device;

  RETURN jsonb_build_object('allowed', true, 'ok', v_device IS NOT NULL);
END;
$$;

-- After a successful code or link sign-in. The Vercel function has already
-- checked the caller's access token; p_user and p_email come from that token.
-- Also records the verified-at time on the server.
CREATE OR REPLACE FUNCTION private.reentry_device_register(
  p_user uuid, p_email text, p_token_hash text, p_user_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mail text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Bad device token';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user AND lower(u.email) = v_mail
      AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;

  INSERT INTO public.verified_emails (email, user_id, verified_at)
  VALUES (v_mail, p_user, now())
  ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id;

  INSERT INTO public.reentry_devices (user_id, email, token_hash, user_agent, created_at)
  VALUES (p_user, v_mail, p_token_hash, NULLIF(left(COALESCE(p_user_agent, ''), 300), ''), clock_timestamp());

  -- Keep the 10 newest devices per person.
  UPDATE public.reentry_devices d
  SET revoked_at = now()
  WHERE d.user_id = p_user
    AND d.revoked_at IS NULL
    AND d.id NOT IN (
      SELECT k.id FROM public.reentry_devices k
      WHERE k.user_id = p_user AND k.revoked_at IS NULL
      ORDER BY k.created_at DESC
      LIMIT 10
    );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Sign out on this device: the token stops working.
CREATE OR REPLACE FUNCTION private.reentry_device_forget(p_token_hash text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH gone AS (
    UPDATE public.reentry_devices d
    SET revoked_at = now()
    WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL
    RETURNING d.id
  )
  SELECT jsonb_build_object('ok', true, 'forgot', (SELECT count(*) FROM gone));
$$;

-- Public wrappers for the service role only. They are SECURITY DEFINER because
-- service_role has no USAGE on the private schema (that is why the old
-- reentry_gate wrapper fails). anon and authenticated cannot execute them.
CREATE OR REPLACE FUNCTION public.reentry_check(p_email text, p_ip text, p_device_hash text, p_mode text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.reentry_check(p_email, p_ip, p_device_hash, p_mode); $$;

CREATE OR REPLACE FUNCTION public.reentry_device_register(p_user uuid, p_email text, p_token_hash text, p_user_agent text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.reentry_device_register(p_user, p_email, p_token_hash, p_user_agent); $$;

CREATE OR REPLACE FUNCTION public.reentry_device_forget(p_token_hash text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.reentry_device_forget(p_token_hash); $$;

REVOKE ALL ON FUNCTION private.reentry_check(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reentry_device_register(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.reentry_device_forget(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reentry_check(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reentry_device_register(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reentry_device_forget(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reentry_check(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reentry_device_register(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reentry_device_forget(text) TO service_role;
