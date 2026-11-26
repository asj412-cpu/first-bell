-- Rollback-only test for 20261126233000_family_profiles_and_manual_santa.sql and
-- supabase/seeds/20261126_offline_santa_pairings.sql. Run: migration + seed + this,
-- in one transaction. Always ends with RAISE EXCEPTION 'ROLLBACK_OK ...'.
DO $t$
DECLARE
  andrew uuid := '3255aa03-c5f0-459a-8c8f-e7accf3e3997';
  sam uuid := 'dddddddd-0000-4000-8000-00000000a001';
  tom uuid := 'dddddddd-0000-4000-8000-00000000b002';
  hid uuid; tok text; tok2 text; r jsonb; n int; out text[] := '{}';
  paul uuid; ryan uuid; noah uuid; ev uuid; pairs text; kid text;
BEGIN
  SELECT household_id INTO hid FROM public.household_members WHERE user_id = andrew;
  SELECT id INTO ev FROM public.secret_santa_events WHERE household_id = hid AND occasion = 'Christmas 2026';
  SELECT string_agg(split_part(g.display_name, ' ', 1) || '>' || split_part(rc.display_name, ' ', 1), ', ' ORDER BY g.display_name)
    INTO pairs FROM public.secret_santa_assignments a
    JOIN public.gift_participants g ON g.id = a.giver_id JOIN public.gift_participants rc ON rc.id = a.receiver_id
    WHERE a.event_id = ev;
  out := out || format('1 seed loaded: status=%s in_draw=%s profiles=%s pairs=%s',
    (SELECT status FROM public.secret_santa_events WHERE id = ev),
    (SELECT count(*) FROM public.gift_participants WHERE household_id = hid AND in_draw),
    (SELECT count(*) FROM public.gift_profiles WHERE household_id = hid), pairs);
  SELECT id INTO paul FROM public.gift_participants WHERE household_id = hid AND display_name = 'Paul';
  SELECT id INTO ryan FROM public.gift_participants WHERE household_id = hid AND display_name = 'Ryan';
  SELECT id INTO noah FROM public.gift_participants WHERE household_id = hid AND display_name = 'Noah';
  out := out || format('1b Paul label: %s', (SELECT manager_name FROM public.gift_managed_members m JOIN public.gift_participants p ON p.list_id = m.list_id WHERE p.id = paul));

  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) VALUES
    (sam, 'zz-sam@example.invalid', 'authenticated', 'authenticated', now(), now(), now()),
    (tom, 'zz-tom@example.invalid', 'authenticated', 'authenticated', now(), now(), now());

  -- Andrew gets the shared link
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  tok := public.admin_family_link('get') ->> 'token';
  r := public.admin_list_profiles();
  out := out || format('2 andrew link len=%s profiles=%s unclaimed=%s', char_length(tok), jsonb_array_length(r->'profiles'),
    (SELECT count(*) FROM jsonb_array_elements(r->'profiles') e WHERE NOT (e->>'claimed')::boolean));
  BEGIN r := public.admin_add_profile('paul', NULL, NULL); out := out || 'FAIL 3 duplicate name'::text;
  EXCEPTION WHEN others THEN out := out || ('3 duplicate name refused: ' || SQLERRM); END;
  BEGIN r := public.save_manual_secret_santa(jsonb_build_array(jsonb_build_object('giver', paul, 'receiver', paul))); out := out || 'FAIL 4 self'::text;
  EXCEPTION WHEN others THEN out := out || ('4 self pair refused: ' || SQLERRM); END;
  BEGIN r := public.save_manual_secret_santa(jsonb_build_array(jsonb_build_object('giver', paul, 'receiver', ryan), jsonb_build_object('giver', paul, 'receiver', noah))); out := out || 'FAIL 5 twice'::text;
  EXCEPTION WHEN others THEN out := out || ('5 gives twice refused: ' || SQLERRM); END;
  BEGIN r := public.save_manual_secret_santa(jsonb_build_array(jsonb_build_object('giver', paul, 'receiver', ryan), jsonb_build_object('giver', noah, 'receiver', ryan))); out := out || 'FAIL 6 receives twice'::text;
  EXCEPTION WHEN others THEN out := out || ('6 receives twice refused: ' || SQLERRM); END;
  BEGIN r := public.save_manual_secret_santa(jsonb_build_array(jsonb_build_object('giver', paul, 'receiver', ryan))); out := out || 'FAIL 7 incomplete'::text;
  EXCEPTION WHEN others THEN out := out || ('7 incomplete refused: ' || SQLERRM); END;
  RESET ROLE;
  out := out || format('7b pairs unchanged after refusals: %s', (SELECT count(*) FROM public.secret_santa_assignments WHERE event_id = ev));

  -- Outsiders: no tokens, no profiles, no admin functions
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sam, 'email', 'zz-sam@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.gift_profiles;
  out := out || format('8 sam reads gift_profiles rows=%s', n);
  BEGIN PERFORM count(*) FROM public.gift_invites; out := out || 'FAIL 9 sam read invites'::text;
  EXCEPTION WHEN others THEN out := out || ('9 sam read gift_invites blocked: ' || SQLERRM); END;
  BEGIN r := public.admin_family_link('get'); out := out || 'FAIL 10 sam got link'::text;
  EXCEPTION WHEN others THEN out := out || ('10 sam admin_family_link blocked: ' || SQLERRM); END;
  out := out || format('11 sam admin_list_profiles=%s', COALESCE(public.admin_list_profiles()::text, 'null'));
  BEGIN r := public.save_manual_secret_santa('[]'::jsonb); out := out || 'FAIL 12 sam saved pairs'::text;
  EXCEPTION WHEN others THEN out := out || ('12 sam manual santa blocked: ' || SQLERRM); END;
  BEGIN r := public.list_claimable_profiles('zz-wrong-token-0000000000'); out := out || 'FAIL 13 wrong token'::text;
  EXCEPTION WHEN others THEN out := out || ('13 wrong token refused: ' || SQLERRM); END;
  BEGIN r := public.claim_gift_profile('zz-wrong-token-0000000000', paul); out := out || 'FAIL 14 claim without token'::text;
  EXCEPTION WHEN others THEN out := out || ('14 claim with wrong token refused: ' || SQLERRM); END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  out := out || format('15 anon link info: %s', public.family_link_info(tok));
  BEGIN r := public.list_claimable_profiles(tok); out := out || 'FAIL 16 anon names'::text;
  EXCEPTION WHEN others THEN out := out || ('16 anon names blocked: ' || SQLERRM); END;
  RESET ROLE;

  -- Sam opens the shared link, picks Paul
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sam, 'email', 'zz-sam@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.list_claimable_profiles(tok);
  out := out || format('17 sam picker: %s names, keys=%s', jsonb_array_length(r->'profiles'),
    (SELECT string_agg(DISTINCT k, ',') FROM jsonb_array_elements(r->'profiles') e, jsonb_object_keys(e) k));
  r := public.claim_gift_profile(tok, paul);
  kid := r->>'kid_key';
  out := out || format('18 sam claimed %s kid=%s', r->>'name', kid IS NOT NULL);
  out := out || format('19 sam access=%s assignment=%s lists=%s', public.get_my_gift_access()->>'display_name',
    public.get_my_assignment()->'receiver'->>'name', jsonb_array_length(public.get_my_gift_lists()));
  out := out || format('20 picker now %s names; sam already=%s', jsonb_array_length(public.list_claimable_profiles(tok)->'profiles'), public.list_claimable_profiles(tok)->'already'->>'name');
  BEGIN r := public.claim_gift_profile(tok, ryan); out := out || 'FAIL 21 second claim'::text;
  EXCEPTION WHEN others THEN out := out || ('21 second claim refused: ' || SQLERRM); END;
  RESET ROLE;
  out := out || format('22 Paul managed label removed=%s list owner=sam %s',
    NOT EXISTS (SELECT 1 FROM public.gift_managed_members m JOIN public.gift_participants p ON p.list_id = m.list_id WHERE p.id = paul),
    (SELECT l.owner_user_id = sam FROM public.gift_lists l JOIN public.gift_participants p ON p.list_id = l.id WHERE p.id = paul));

  -- Tom tries Paul (taken), then takes Ryan
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tom, 'email', 'zz-tom@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN r := public.claim_gift_profile(tok, paul); out := out || 'FAIL 23 double claim'::text;
  EXCEPTION WHEN others THEN out := out || ('23 taken name refused: ' || SQLERRM); END;
  r := public.claim_gift_profile(tok, ryan);
  out := out || format('24 tom claimed %s, sees assignment %s', r->>'name', public.get_my_assignment()->'receiver'->>'name');
  SELECT count(*) INTO n FROM public.gift_profiles;
  out := out || format('25 tom reads gift_profiles rows=%s', n);
  RESET ROLE;

  -- Andrew: wrong pick fix (Paul -> Noah), undo Ryan, new link
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.admin_reassign_profile(paul, noah);
  out := out || format('26 moved: Paul claimed=%s Noah claimed=%s by %s', r->'from'->>'claimed', r->'to'->>'claimed', r->'to'->>'claimed_email');
  r := public.admin_unclaim_profile(ryan);
  out := out || format('27 undo Ryan: claimed=%s', r->>'claimed');
  tok2 := public.admin_family_link('rotate') ->> 'token';
  out := out || format('28 rotate gives new token=%s', tok2 <> tok);
  RESET ROLE;
  out := out || format('29 Paul back to Andrew-managed=%s', EXISTS (SELECT 1 FROM public.gift_managed_members m JOIN public.gift_participants p ON p.list_id = m.list_id WHERE p.id = paul));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tom, 'email', 'zz-tom@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN r := public.claim_gift_profile(tok, ryan); out := out || 'FAIL 30 old link worked'::text;
  EXCEPTION WHEN others THEN out := out || ('30 old link refused: ' || SQLERRM); END;
  out := out || format('31 tom access after undo=%s; new link picker=%s names', COALESCE(public.get_my_gift_access()::text, 'none'),
    jsonb_array_length(public.list_claimable_profiles(tok2)->'profiles'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.admin_family_link('revoke');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  out := out || format('32 after revoke, link info=%s', public.family_link_info(tok2));
  RESET ROLE;
  out := out || format('33 assignments intact after claims=%s', (SELECT count(*) FROM public.secret_santa_assignments WHERE event_id = ev));

  RAISE EXCEPTION 'ROLLBACK_OK %', array_to_string(out, E'\n');
END
$t$;
