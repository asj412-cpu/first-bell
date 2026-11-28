-- Sign in with email + a 4-digit PIN (Andrew's ask, Nov 28 2026).
-- Additive only: three new tables and new functions. Nothing existing changes.
--
-- Only the Supabase Edge Function `pin-auth` calls these, with the service role
-- it gets natively from Supabase. Browsers (anon, authenticated) cannot touch
-- the tables or run the functions. No service role key goes in the app or repo.
--
-- PINs are hashed here with bcrypt (pgcrypto crypt + gen_salt('bf', 10)); each
-- hash carries its own random salt. The plaintext PIN is never stored or returned.
--
-- Lockout: 5 wrong PINs in a row locks PIN sign-in for that person. It stays
-- locked until they sign in with the emailed code (which clears the lock), or
-- set a new PIN from a code-verified session. Unknown emails behave the same way
-- (5 misses in 15 minutes -> "locked"), so the answer never shows who has a PIN.
-- One IP gets at most 20 misses per 15 minutes across all emails (cooldown).

CREATE TABLE IF NOT EXISTS public.user_pins (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  pin_hash text NOT NULL CHECK (pin_hash LIKE '$2%' AND char_length(pin_hash) BETWEEN 50 AND 72),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.pin_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CHECK (char_length(email) <= 254),
  ip text NOT NULL CHECK (char_length(ip) <= 64),
  ok boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pin_attempts_email_time_idx ON public.pin_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS pin_attempts_ip_time_idx ON public.pin_attempts (ip, created_at);

-- Sessions that were opened with a PIN (not with the emailed code). Changing a
-- PIN from one of these needs the current PIN.
CREATE TABLE IF NOT EXISTS public.pin_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pin_sessions_user_idx ON public.pin_sessions (user_id);

ALTER TABLE public.user_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_pins FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pin_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pin_sessions FROM PUBLIC, anon, authenticated;
-- No policies: only the definer functions below touch these tables.

-- Too easy to guess: 0000, 1111 ... 9999, 1234, 4321.
CREATE OR REPLACE FUNCTION private.pin_is_weak(p_pin text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT p_pin ~ '^(\d)\1{3}$' OR p_pin IN ('1234', '4321');
$$;

CREATE OR REPLACE FUNCTION private.pin_user_for_email(p_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.id FROM auth.users u
  WHERE lower(u.email) = lower(btrim(COALESCE(p_email, '')))
    AND u.deleted_at IS NULL
    AND u.email_confirmed_at IS NOT NULL
    AND (u.banned_until IS NULL OR u.banned_until < now())
  ORDER BY u.created_at
  LIMIT 1;
$$;

-- Email + PIN. Returns {result: ok|wrong|locked|slow, user_id?, email?}.
CREATE OR REPLACE FUNCTION private.pin_login_check(p_email text, p_pin text, p_ip text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_mail text := lower(btrim(COALESCE(p_email, '')));
  v_pin text := COALESCE(p_pin, '');
  v_ip text := COALESCE(NULLIF(left(btrim(COALESCE(p_ip, '')), 64), ''), 'unknown');
  v_user uuid;
  v_row public.user_pins%ROWTYPE;
  v_ip_misses integer;
  v_mail_misses integer;
BEGIN
  IF position('@' IN v_mail) < 2 OR char_length(v_mail) > 254 THEN
    RETURN jsonb_build_object('result', 'wrong');
  END IF;

  DELETE FROM public.pin_attempts WHERE created_at < now() - interval '1 day';

  SELECT count(*) INTO v_ip_misses FROM public.pin_attempts a
  WHERE a.ip = v_ip AND NOT a.ok AND a.created_at > now() - interval '15 minutes';
  IF v_ip_misses >= 20 THEN
    RETURN jsonb_build_object('result', 'slow');
  END IF;

  v_user := private.pin_user_for_email(v_mail);
  IF v_user IS NOT NULL THEN
    SELECT * INTO v_row FROM public.user_pins p WHERE p.user_id = v_user FOR UPDATE;
  END IF;

  IF v_user IS NULL OR v_row.user_id IS NULL THEN
    -- Same work and same answers as a real account, so nobody learns who has a PIN.
    PERFORM extensions.crypt(v_pin, extensions.gen_salt('bf', 10));
    INSERT INTO public.pin_attempts (email, ip, ok) VALUES (v_mail, v_ip, false);
    SELECT count(*) INTO v_mail_misses FROM public.pin_attempts a
    WHERE a.email = v_mail AND NOT a.ok AND a.created_at > now() - interval '15 minutes';
    RETURN jsonb_build_object('result', CASE WHEN v_mail_misses >= 5 THEN 'locked' ELSE 'wrong' END);
  END IF;

  IF v_row.locked_at IS NOT NULL THEN
    PERFORM extensions.crypt(v_pin, extensions.gen_salt('bf', 10));
    INSERT INTO public.pin_attempts (email, ip, ok) VALUES (v_mail, v_ip, false);
    RETURN jsonb_build_object('result', 'locked');
  END IF;

  IF v_pin ~ '^\d{4}$' AND extensions.crypt(v_pin, v_row.pin_hash) = v_row.pin_hash THEN
    UPDATE public.user_pins SET failed_count = 0, last_used_at = now() WHERE user_id = v_user;
    INSERT INTO public.pin_attempts (email, ip, ok) VALUES (v_mail, v_ip, true);
    RETURN jsonb_build_object('result', 'ok', 'user_id', v_user, 'email', v_mail);
  END IF;

  INSERT INTO public.pin_attempts (email, ip, ok) VALUES (v_mail, v_ip, false);
  UPDATE public.user_pins
  SET failed_count = failed_count + 1,
      locked_at = CASE WHEN failed_count + 1 >= 5 THEN now() ELSE NULL END
  WHERE user_id = v_user
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('result', CASE WHEN v_row.locked_at IS NOT NULL THEN 'locked' ELSE 'wrong' END);
END;
$$;

-- The Edge Function records each session it opens with a PIN.
CREATE OR REPLACE FUNCTION private.pin_record_session(p_user uuid, p_session uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH cleanup AS (
    DELETE FROM public.pin_sessions s
    WHERE s.created_at < now() - interval '400 days'
       OR NOT EXISTS (SELECT 1 FROM auth.sessions a WHERE a.id = s.session_id)
  ), ins AS (
    INSERT INTO public.pin_sessions (session_id, user_id) VALUES (p_session, p_user)
    ON CONFLICT (session_id) DO NOTHING
    RETURNING 1
  )
  SELECT jsonb_build_object('ok', true);
$$;

-- Called right after sign-in and from Settings. If this session came from the
-- emailed code (not a PIN), a lockout is cleared: the code proved the email.
CREATE OR REPLACE FUNCTION private.pin_status(p_user uuid, p_session uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pin_session boolean := p_session IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pin_sessions s WHERE s.session_id = p_session AND s.user_id = p_user
  );
  v_row public.user_pins%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.user_pins p WHERE p.user_id = p_user;
  IF v_row.user_id IS NOT NULL AND NOT v_pin_session
     AND (v_row.locked_at IS NOT NULL OR v_row.failed_count > 0) THEN
    UPDATE public.user_pins SET failed_count = 0, locked_at = NULL WHERE user_id = p_user
    RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object(
    'has_pin', v_row.user_id IS NOT NULL,
    'locked', v_row.locked_at IS NOT NULL,
    'pin_session', v_pin_session,
    'needs_current', v_row.user_id IS NOT NULL AND v_pin_session
  );
END;
$$;

-- Set or change a PIN. From a PIN-opened session the current PIN is required
-- (wrong current PINs count toward the lockout). From a code-verified session
-- it is not, which is how "forgot my PIN" works.
CREATE OR REPLACE FUNCTION private.pin_set(p_user uuid, p_session uuid, p_pin text, p_current text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pin text := COALESCE(p_pin, '');
  v_pin_session boolean := p_session IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pin_sessions s WHERE s.session_id = p_session AND s.user_id = p_user
  );
  v_row public.user_pins%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_user AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signin');
  END IF;
  IF v_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'format');
  END IF;
  IF private.pin_is_weak(v_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'weak');
  END IF;

  SELECT * INTO v_row FROM public.user_pins p WHERE p.user_id = p_user FOR UPDATE;
  IF v_row.user_id IS NOT NULL AND v_pin_session THEN
    IF v_row.locked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'locked');
    END IF;
    IF COALESCE(p_current, '') !~ '^\d{4}$'
       OR extensions.crypt(p_current, v_row.pin_hash) <> v_row.pin_hash THEN
      UPDATE public.user_pins
      SET failed_count = failed_count + 1,
          locked_at = CASE WHEN failed_count + 1 >= 5 THEN now() ELSE NULL END
      WHERE user_id = p_user
      RETURNING * INTO v_row;
      RETURN jsonb_build_object('ok', false, 'error', CASE WHEN v_row.locked_at IS NOT NULL THEN 'locked' ELSE 'current' END);
    END IF;
  END IF;

  INSERT INTO public.user_pins (user_id, pin_hash, failed_count, locked_at, updated_at)
  VALUES (p_user, extensions.crypt(v_pin, extensions.gen_salt('bf', 10)), 0, NULL, now())
  ON CONFLICT (user_id) DO UPDATE
  SET pin_hash = EXCLUDED.pin_hash, failed_count = 0, locked_at = NULL, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Public wrappers for the service role only (service_role has no USAGE on private).
CREATE OR REPLACE FUNCTION public.pin_login_check(p_email text, p_pin text, p_ip text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.pin_login_check(p_email, p_pin, p_ip); $$;
CREATE OR REPLACE FUNCTION public.pin_record_session(p_user uuid, p_session uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.pin_record_session(p_user, p_session); $$;
CREATE OR REPLACE FUNCTION public.pin_status(p_user uuid, p_session uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.pin_status(p_user, p_session); $$;
CREATE OR REPLACE FUNCTION public.pin_set(p_user uuid, p_session uuid, p_pin text, p_current text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.pin_set(p_user, p_session, p_pin, p_current); $$;

REVOKE ALL ON FUNCTION private.pin_is_weak(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pin_user_for_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pin_login_check(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pin_record_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pin_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pin_set(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pin_login_check(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pin_record_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pin_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pin_set(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pin_login_check(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pin_record_session(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pin_status(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pin_set(uuid, uuid, text, text) TO service_role;
