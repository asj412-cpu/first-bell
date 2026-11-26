-- Rollback-only test for 20261126190000_secret_santa_managed_members.sql.
-- Run after both managed-member migrations in the same transaction.
-- Always ends with RAISE EXCEPTION 'ROLLBACK_OK ...' so nothing is kept.
DO $t$
DECLARE
  hh uuid;
  andrew uuid := '3255aa03-c5f0-459a-8c8f-e7accf3e3997';
  sarah uuid := 'aaaaaaaa-0000-4000-8000-00000000a001';
  bob   uuid := 'aaaaaaaa-0000-4000-8000-00000000b002';
  andrew_mail text;
  out text[] := '{}';
  mike jsonb; lily jsonb; ann jsonb; zed jsonb; r jsonb; n int; bad int; total int; ev uuid;
  sarah_group uuid; bob_group uuid; mike_group uuid; i int; mike_in int := 0; lily_in int := 0;
BEGIN
  SELECT household_id INTO hh FROM public.household_members WHERE user_id = andrew;
  SELECT email INTO andrew_mail FROM auth.users WHERE id = andrew;
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at) VALUES
    (sarah, 'zz-sarah@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (bob,   'zz-bob@example.invalid',   'authenticated', 'authenticated', now(), now());
  INSERT INTO public.gift_invites (household_id, token, label, single_use, expires_at) VALUES
    (hh, 'zz-rls-test-token-sarah-000001', 'Christmas 2026', true, now() + interval '1 day'),
    (hh, 'zz-rls-test-token-bob-00000001', 'Christmas 2026', true, now() + interval '1 day');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  PERFORM public.accept_gift_invite('zz-rls-test-token-sarah-000001', 'Sarah Test', '7135550100', 'zz-sarah@example.invalid', 'The Testers', '[]'::jsonb, '[]'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-bob@example.invalid', 'role', 'authenticated')::text, true);
  PERFORM public.accept_gift_invite('zz-rls-test-token-bob-00000001', 'Bob Test', '7135550101', 'zz-bob@example.invalid', 'The Bobs', '[]'::jsonb, '[]'::jsonb);

  -- Sarah adds her husband and daughter
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  mike := public.add_managed_member('Mike Test', 'husband', NULL);
  lily := public.add_managed_member('Lily Test', 'daughter', '7');
  RESET ROLE;
  SELECT group_id INTO sarah_group FROM public.gift_participants WHERE user_id = sarah;
  SELECT group_id INTO bob_group FROM public.gift_participants WHERE user_id = bob;
  out := out || format('1 managed in_draw: mike=%s lily=%s; same group as sarah: %s',
    (SELECT in_draw FROM public.gift_participants WHERE list_id = (mike->>'list_id')::uuid),
    (SELECT in_draw FROM public.gift_participants WHERE list_id = (lily->>'list_id')::uuid),
    (SELECT bool_and(group_id = sarah_group) FROM public.gift_participants WHERE list_id IN ((mike->>'list_id')::uuid, (lily->>'list_id')::uuid)));

  -- Trigger: Sarah's group changes, her people follow, then back
  UPDATE public.gift_participants SET group_id = bob_group WHERE user_id = sarah;
  SELECT group_id INTO mike_group FROM public.gift_participants WHERE list_id = (mike->>'list_id')::uuid;
  out := out || format('2 trigger follows manager group: %s', mike_group = bob_group);
  UPDATE public.gift_participants SET group_id = sarah_group WHERE user_id = sarah;
  SELECT group_id INTO mike_group FROM public.gift_participants WHERE list_id = (mike->>'list_id')::uuid;
  out := out || format('2b trigger back: %s', mike_group = sarah_group);

  -- Andrew draws 40 times with "avoid same household" on
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'email', andrew_mail, 'role', 'authenticated')::text, true);
  bad := 0;
  FOR i IN 1..40 LOOP
    SET LOCAL ROLE authenticated;
    r := public.draw_secret_santa(true);
    RESET ROLE;
    SELECT id INTO ev FROM public.secret_santa_events WHERE household_id = hh AND occasion = 'Christmas 2026';
    SELECT count(*) INTO n FROM public.secret_santa_assignments a
      JOIN public.gift_participants g ON g.id = a.giver_id
      JOIN public.gift_participants rc ON rc.id = a.receiver_id
      WHERE a.event_id = ev AND (a.giver_id = a.receiver_id OR (g.group_id IS NOT NULL AND g.group_id = rc.group_id));
    bad := bad + n;
    SELECT count(*) INTO n FROM public.secret_santa_assignments a WHERE a.event_id = ev;
    SELECT count(*) INTO total FROM public.gift_participants WHERE household_id = hh AND in_draw;
    IF n <> total THEN bad := bad + 1000; END IF;
    mike_in := mike_in + (SELECT count(*) FROM public.secret_santa_assignments a JOIN public.gift_participants p ON p.id = a.giver_id WHERE a.event_id = ev AND p.list_id = (mike->>'list_id')::uuid)::int;
    lily_in := lily_in + (SELECT count(*) FROM public.secret_santa_assignments a JOIN public.gift_participants p ON p.id = a.receiver_id WHERE a.event_id = ev AND p.list_id = (lily->>'list_id')::uuid)::int;
  END LOOP;
  out := out || format('3 40 draws, %s people each: self/same-household violations=%s, mike drew in %s/40, lily drawn in %s/40', total, bad, mike_in, lily_in);

  -- Same-household off: still nobody draws themselves
  bad := 0;
  FOR i IN 1..20 LOOP
    SET LOCAL ROLE authenticated;
    r := public.draw_secret_santa(false);
    RESET ROLE;
    SELECT count(*) INTO n FROM public.secret_santa_assignments a WHERE a.event_id = ev AND a.giver_id = a.receiver_id;
    bad := bad + n;
  END LOOP;
  SET LOCAL ROLE authenticated;
  r := public.draw_secret_santa(true);
  RESET ROLE;
  out := out || format('4 20 draws with household rule off: self draws=%s', bad);

  -- Sarah sees who Mike and Lily drew
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.get_managed_assignments();
  RESET ROLE;
  out := out || format('5 sarah managed assignments: count=%s status=%s mike->%s matches=%s has_slug=%s',
    jsonb_array_length(r), r->0->>'status', r->0->'receiver'->>'name',
    (r->0->'receiver'->>'id')::uuid = (SELECT a.receiver_id FROM public.secret_santa_assignments a JOIN public.gift_participants p ON p.id = a.giver_id WHERE a.event_id = ev AND p.list_id = (mike->>'list_id')::uuid)
    AND (r->1->'receiver'->>'id')::uuid = (SELECT a.receiver_id FROM public.secret_santa_assignments a JOIN public.gift_participants p ON p.id = a.giver_id WHERE a.event_id = ev AND p.list_id = (lily->>'list_id')::uuid),
    r->0->'receiver'->'list'->>'share_slug' IS NOT NULL);
  SET LOCAL ROLE authenticated;
  r := public.get_my_assignment();
  RESET ROLE;
  out := out || format('5b sarah own assignment still works: %s', r->'receiver'->>'name' IS NOT NULL);

  -- Bob sees none of Sarah's people's results; anon is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-bob@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  out := out || format('6 bob managed assignments=%s', jsonb_array_length(public.get_managed_assignments()));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN r := public.get_managed_assignments(); out := out || 'FAIL 7 anon read'::text;
  EXCEPTION WHEN others THEN out := out || ('7 anon blocked: ' || SQLERRM); END;
  RESET ROLE;

  -- Adding someone after a draft draw clears it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ann := public.add_managed_member('Ann Test', 'son', '4');
  RESET ROLE;
  out := out || format('8 add during draft: event=%s assignments=%s ann in_draw=%s',
    (SELECT status FROM public.secret_santa_events WHERE id = ev), (SELECT count(*) FROM public.secret_santa_assignments WHERE event_id = ev),
    (SELECT in_draw FROM public.gift_participants WHERE list_id = (ann->>'list_id')::uuid));

  -- Andrew draws and locks
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'email', andrew_mail, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.draw_secret_santa(true);
  r := public.lock_secret_santa();
  RESET ROLE;
  out := out || format('9 locked: %s', r->>'status');

  -- After lock: Sarah cannot remove Mike; a new person stays out of the draw
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN r := public.remove_managed_member((mike->>'list_id')::uuid); out := out || 'FAIL 10 removed while locked'::text;
  EXCEPTION WHEN others THEN out := out || ('10 remove after lock blocked: ' || SQLERRM); END;
  zed := public.add_managed_member('Zed Test', 'cousin', NULL);
  r := public.get_managed_assignments();
  out := out || format('11 after lock: zed in_draw=%s statuses=%s zed receiver=%s',
    zed->>'participant_id' IS NOT NULL, (SELECT string_agg(e->>'name' || ':' || (e->>'status') || ':' || COALESCE(e->>'in_draw','?'), ', ') FROM jsonb_array_elements(r) e),
    COALESCE(r->3->>'receiver', 'none'));
  r := public.remove_managed_member((zed->>'list_id')::uuid);
  out := out || format('12 removing zed (not in draw) after lock ok=%s', r->>'removed');
  RESET ROLE;

  RAISE EXCEPTION 'ROLLBACK_OK %', array_to_string(out, E'\n');
END
$t$;
