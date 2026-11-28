-- Rollback-only test for 20261128174158_pin_signin.sql.
-- Run after the migration in the same transaction. Always ends with
-- RAISE EXCEPTION 'ROLLBACK_OK ...' so nothing is kept.
DO $t$
DECLARE
  ua uuid := 'cccccccc-0000-4000-8000-00000000a001';
  ub uuid := 'cccccccc-0000-4000-8000-00000000b002';
  uc uuid := 'cccccccc-0000-4000-8000-00000000c003';
  sa_pin uuid := 'cccccccc-1111-4000-8000-00000000a001';
  sa_mail uuid := 'cccccccc-2222-4000-8000-00000000a001';
  out text[] := '{}';
  r jsonb; i int; h text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) VALUES
    (ua, 'zz-pin-a@example.invalid', 'authenticated', 'authenticated', now(), now(), now()),
    (ub, 'zz-pin-b@example.invalid', 'authenticated', 'authenticated', now(), now(), now()),
    (uc, 'zz-pin-c@example.invalid', 'authenticated', 'authenticated', now(), now(), NULL);
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES
    (sa_pin, ua, now(), now()), (sa_mail, ua, now(), now());

  -- Browsers cannot call any of it or read the tables
  SET LOCAL ROLE anon;
  BEGIN r := public.pin_login_check('zz-pin-a@example.invalid', '2580', '198.51.100.1'); out := out || 'FAIL 1 anon login'::text;
  EXCEPTION WHEN others THEN out := out || ('1 anon login blocked: ' || SQLERRM); END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN r := public.pin_set(ua, NULL, '2580', NULL); out := out || 'FAIL 2 authenticated set'::text;
  EXCEPTION WHEN others THEN out := out || ('2 authenticated set blocked: ' || SQLERRM); END;
  BEGIN PERFORM count(*) FROM public.user_pins; out := out || 'FAIL 3 authenticated read pins'::text;
  EXCEPTION WHEN others THEN out := out || ('3 authenticated read pins blocked: ' || SQLERRM); END;
  BEGIN r := private.pin_status(ua, NULL); out := out || 'FAIL 3b authenticated private'::text;
  EXCEPTION WHEN others THEN out := out || ('3b authenticated private blocked: ' || SQLERRM); END;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  out := out || format('4 status before: %s', public.pin_status(ua, sa_mail));
  out := out || format('5 bad formats: %s %s %s; weak: %s %s',
    public.pin_set(ua, sa_mail, '12a4', NULL), public.pin_set(ua, sa_mail, '12345', NULL), public.pin_set(ua, sa_mail, '', NULL),
    public.pin_set(ua, sa_mail, '1111', NULL), public.pin_set(ua, sa_mail, '1234', NULL));
  out := out || format('6 unconfirmed user set: %s', public.pin_set(uc, NULL, '2580', NULL));
  out := out || format('7 set 2580: %s', public.pin_set(ua, sa_mail, '2580', NULL));
  RESET ROLE;
  SELECT pin_hash INTO h FROM public.user_pins WHERE user_id = ua;
  out := out || format('8 stored bcrypt, not plaintext: prefix=%s len=%s contains-2580=%s', left(h, 7), length(h), position('2580' IN h) > 0);
  SET LOCAL ROLE service_role;

  out := out || format('9 login right PIN (caps email): %s', public.pin_login_check('ZZ-Pin-A@example.invalid ', '2580', '198.51.100.2'));
  out := out || format('10 wrong PIN: %s', public.pin_login_check('zz-pin-a@example.invalid', '0001', '198.51.100.2'));
  out := out || format('11 unknown email: %s; no-PIN user: %s',
    public.pin_login_check('zz-nobody@example.invalid', '2580', '198.51.100.2'),
    public.pin_login_check('zz-pin-b@example.invalid', '2580', '198.51.100.2'));
  out := out || format('12 right PIN resets count: %s', public.pin_login_check('zz-pin-a@example.invalid', '2580', '198.51.100.2'));

  -- Lockout after 5 wrong in a row, then right PIN still refused
  FOR i IN 1..4 LOOP r := public.pin_login_check('zz-pin-a@example.invalid', '9990', '198.51.100.3'); END LOOP;
  out := out || format('13 4th wrong: %s; 5th wrong: %s; right PIN while locked: %s', r,
    public.pin_login_check('zz-pin-a@example.invalid', '9990', '198.51.100.3'),
    public.pin_login_check('zz-pin-a@example.invalid', '2580', '198.51.100.4'));

  -- PIN session cannot unlock or change without current PIN; code session can
  r := public.pin_record_session(ua, sa_pin);
  out := out || format('14 status from PIN session while locked: %s', public.pin_status(ua, sa_pin));
  out := out || format('15 change from PIN session while locked: %s', public.pin_set(ua, sa_pin, '3690', '2580'));
  out := out || format('16 status from code session (unlocks): %s', public.pin_status(ua, sa_mail));
  out := out || format('17 login after unlock: %s', public.pin_login_check('zz-pin-a@example.invalid', '2580', '198.51.100.5'));
  out := out || format('18 change from PIN session, no current: %s; wrong current: %s; right current: %s',
    public.pin_set(ua, sa_pin, '3690', NULL), public.pin_set(ua, sa_pin, '3690', '0000'), public.pin_set(ua, sa_pin, '3690', '2580'));
  out := out || format('19 old PIN now: %s; new PIN: %s',
    public.pin_login_check('zz-pin-a@example.invalid', '2580', '198.51.100.6'),
    public.pin_login_check('zz-pin-a@example.invalid', '3690', '198.51.100.6'));
  out := out || format('20 forgot PIN: code session sets new without current: %s; login: %s',
    public.pin_set(ua, sa_mail, '4826', NULL), public.pin_login_check('zz-pin-a@example.invalid', '4826', '198.51.100.7'));

  -- Unknown email locks the same way after 5 misses
  FOR i IN 1..4 LOOP r := public.pin_login_check('zz-ghost@example.invalid', '5555', '198.51.100.8'); END LOOP;
  out := out || format('21 unknown email 4th: %s; 5th: %s', r, public.pin_login_check('zz-ghost@example.invalid', '5555', '198.51.100.8'));

  -- IP cooldown: 20 misses from one IP across emails
  FOR i IN 1..20 LOOP r := public.pin_login_check(format('zz-spray-%s@example.invalid', i), '7777', '203.0.113.90'); END LOOP;
  out := out || format('22 21st try from sprayed IP (even right PIN): %s; other IP fine: %s',
    public.pin_login_check('zz-pin-a@example.invalid', '4826', '203.0.113.90'),
    public.pin_login_check('zz-pin-a@example.invalid', '4826', '203.0.113.91'));
  RESET ROLE;

  RAISE EXCEPTION 'ROLLBACK_OK %', array_to_string(out, E'\n');
END
$t$;
