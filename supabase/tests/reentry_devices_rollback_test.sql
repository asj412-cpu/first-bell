-- Rollback-only test for 20261126220000_reentry_devices.sql.
-- Run after the migration in the same transaction. Always ends with
-- RAISE EXCEPTION 'ROLLBACK_OK ...' so nothing is kept.
DO $t$
DECLARE
  ua uuid := 'bbbbbbbb-0000-4000-8000-00000000a001';
  ub uuid := 'bbbbbbbb-0000-4000-8000-00000000b002';
  uc uuid := 'bbbbbbbb-0000-4000-8000-00000000c003';
  ud uuid := 'bbbbbbbb-0000-4000-8000-00000000d004';
  h1 text := encode(sha256('zz-device-one'::bytea), 'hex');
  h2 text := encode(sha256('zz-device-two'::bytea), 'hex');
  hx text := encode(sha256('zz-never-registered'::bytea), 'hex');
  out text[] := '{}';
  r jsonb; i int; n int;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at, banned_until) VALUES
    (ua, 'zz-a@example.invalid', 'authenticated', 'authenticated', now(), now(), now(), NULL),
    (ub, 'zz-b@example.invalid', 'authenticated', 'authenticated', now(), now(), now(), NULL),
    (uc, 'zz-c@example.invalid', 'authenticated', 'authenticated', now(), now(), NULL, NULL),
    (ud, 'zz-d@example.invalid', 'authenticated', 'authenticated', now(), now(), now(), now() + interval '1 day');

  -- Browsers cannot call any of it
  SET LOCAL ROLE anon;
  BEGIN r := public.reentry_check('zz-a@example.invalid', '198.51.100.1', NULL, 'email'); out := out || 'FAIL 1 anon check'::text;
  EXCEPTION WHEN others THEN out := out || ('1 anon check blocked: ' || SQLERRM); END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN r := public.reentry_device_register(ua, 'zz-a@example.invalid', h1, 'x'); out := out || 'FAIL 2 authenticated register'::text;
  EXCEPTION WHEN others THEN out := out || ('2 authenticated register blocked: ' || SQLERRM); END;
  BEGIN PERFORM count(*) FROM public.reentry_devices; out := out || 'FAIL 3 authenticated read devices'::text;
  EXCEPTION WHEN others THEN out := out || ('3 authenticated read devices blocked: ' || SQLERRM); END;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  -- (a) email mode
  out := out || format('4 email mode: verified=%s unknown=%s never-confirmed=%s banned=%s',
    public.reentry_check('zz-a@example.invalid', '198.51.100.2', NULL, 'email'),
    public.reentry_check('zz-nobody@example.invalid', '198.51.100.2', NULL, 'email'),
    public.reentry_check('zz-c@example.invalid', '198.51.100.2', NULL, 'email'),
    public.reentry_check('zz-d@example.invalid', '198.51.100.2', NULL, 'email'));
  out := out || format('5 off mode for verified: %s', public.reentry_check('zz-b@example.invalid', '198.51.100.3', NULL, 'off'));

  -- (b) device mode
  out := out || format('6 device mode, no cookie: %s', public.reentry_check('zz-a@example.invalid', '198.51.100.4', NULL, 'device'));
  r := public.reentry_device_register(ua, 'ZZ-A@example.invalid', h1, 'Test phone');
  out := out || format('7 register: %s; verified_emails row=%s; stored hash only=%s', r,
    (SELECT count(*) FROM public.verified_emails WHERE email = 'zz-a@example.invalid'),
    (SELECT token_hash = h1 FROM public.reentry_devices WHERE user_id = ua));
  out := out || format('8 device mode, this device: %s', public.reentry_check('zz-a@example.invalid', '198.51.100.4', h1, 'device'));
  out := out || format('9 same cookie, other email: %s', public.reentry_check('zz-b@example.invalid', '198.51.100.4', h1, 'device'));
  out := out || format('10 unknown token: %s', public.reentry_check('zz-a@example.invalid', '198.51.100.4', hx, 'device'));
  BEGIN r := public.reentry_device_register(uc, 'zz-c@example.invalid', h2, NULL); out := out || 'FAIL 11 unconfirmed registered'::text;
  EXCEPTION WHEN others THEN out := out || ('11 unconfirmed user cannot register: ' || SQLERRM); END;
  BEGIN r := public.reentry_device_register(ub, 'zz-a@example.invalid', h2, NULL); out := out || 'FAIL 12 mismatched email registered'::text;
  EXCEPTION WHEN others THEN out := out || ('12 token for another email refused: ' || SQLERRM); END;
  r := public.reentry_device_forget(h1);
  out := out || format('13 after sign-out forget %s: %s', r, public.reentry_check('zz-a@example.invalid', '198.51.100.5', h1, 'device'));

  -- Rate limits: 6th try for one email, 21st try from one IP, same shape for unknown emails
  out := out || format('14 6th try for zz-a: %s', public.reentry_check('zz-a@example.invalid', '198.51.100.6', NULL, 'email'));
  FOR i IN 1..20 LOOP
    r := public.reentry_check(format('zz-spray-%s@example.invalid', i), '203.0.113.50', NULL, 'email');
  END LOOP;
  out := out || format('15 21st try from one IP (unknown email): %s; other IP still fine: %s',
    public.reentry_check('zz-spray-21@example.invalid', '203.0.113.50', NULL, 'email'),
    public.reentry_check('zz-b@example.invalid', '203.0.113.51', NULL, 'email'));

  -- Device cap: 10 active per person
  FOR i IN 1..12 LOOP
    r := public.reentry_device_register(ub, 'zz-b@example.invalid', encode(sha256(('zz-b-dev-' || i)::bytea), 'hex'), NULL);
  END LOOP;
  SELECT count(*) INTO n FROM public.reentry_devices WHERE user_id = ub AND revoked_at IS NULL;
  out := out || format('16 active devices after 12 sign-ins: %s; newest works: %s; oldest revoked: %s', n,
    public.reentry_check('zz-b@example.invalid', '203.0.113.52', encode(sha256('zz-b-dev-12'::bytea), 'hex'), 'device'),
    public.reentry_check('zz-b@example.invalid', '203.0.113.52', encode(sha256('zz-b-dev-1'::bytea), 'hex'), 'device'));
  RESET ROLE;

  RAISE EXCEPTION 'ROLLBACK_OK %', array_to_string(out, E'\n');
END
$t$;
