-- Rollback-only test for 20261128140000_extended_family.sql. Run: the migration text, then
-- this DO block, in ONE statement batch. It always ends with RAISE EXCEPTION 'ROLLBACK_OK ...',
-- so nothing (migration included) persists. Uses throwaway auth users and real read-only data.
DO $t$
DECLARE
  andrew uuid := '3255aa03-c5f0-459a-8c8f-e7accf3e3997';
  ann uuid := 'eeeeeeee-0000-4000-8000-00000000a001';
  bob uuid := 'eeeeeeee-0000-4000-8000-00000000b002';
  hid uuid; ev uuid; tok text; r jsonb; n int; out text[] := '{}';
  steph uuid; kevin uuid; paulp uuid; michelle_list uuid; before_assign int; before_in_draw int; before_status text; before_parts int;
  ann_person uuid; stephp uuid; zzlist uuid; kid jsonb; dir jsonb; lists_in_dir int; lists_in_hh int; txt text; pk jsonb;
BEGIN
  SELECT household_id INTO hid FROM public.household_members WHERE user_id = andrew;
  SELECT id, status INTO ev, before_status FROM public.secret_santa_events WHERE household_id = hid AND occasion = 'Christmas 2026';
  SELECT count(*) INTO before_assign FROM public.secret_santa_assignments WHERE event_id = ev;
  SELECT count(*) INTO before_in_draw FROM public.gift_participants WHERE household_id = hid AND in_draw;
  SELECT count(*) INTO before_parts FROM public.gift_participants WHERE household_id = hid;
  out := out || format('0 baseline: status=%s pairings=%s in_draw=%s people=%s', before_status, before_assign, before_in_draw, before_parts);
  SELECT user_id INTO steph FROM public.gift_participants WHERE household_id = hid AND display_name = 'Stephanie Cress';
  SELECT id INTO kevin FROM public.gift_participants WHERE household_id = hid AND display_name = 'Kevin Cress';
  SELECT id INTO stephp FROM public.gift_participants WHERE household_id = hid AND display_name = 'Stephanie Cress';
  SELECT id INTO paulp FROM public.gift_participants WHERE household_id = hid AND display_name = 'Paul Quiroga';
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) VALUES
    (ann, 'zz-ann@example.invalid', 'authenticated', 'authenticated', now(), now(), now()),
    (bob, 'zz-bob@example.invalid', 'authenticated', 'authenticated', now(), now(), now());

  -- Andrew
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  tok := public.admin_family_link('get') ->> 'token';
  r := public.admin_add_profile('Zz Aunt', 'The Zz', NULL);
  out := out || format('1 Andrew adds Zz Aunt while locked: in_draw=%s (want false)', r->>'in_draw');
  -- 6/8 edit: rename + household, claimed manager keeps label in step
  r := public.admin_update_profile(kevin, 'Kevin Zz', 'The Zz', NULL);
  out := out || format('2 edit unclaimed Kevin: name=%s group=%s', r->>'name', r->>'group_label');
  BEGIN r := public.admin_update_profile(kevin, 'paul quiroga', NULL, NULL); out := out || 'FAIL 3 dup rename'::text;
  EXCEPTION WHEN others THEN out := out || ('3 rename to an existing name refused: ' || SQLERRM); END;
  r := public.admin_update_profile(paulp, 'Paul Zz', NULL, NULL);
  out := out || format('4 rename Paul: managed-by labels now %s', (SELECT string_agg(DISTINCT manager_name, ',') FROM public.gift_managed_members WHERE manager_participant_id = paulp));
  -- 5 won't sign up
  r := public.admin_set_wont_sign_up(kevin, true);
  out := out || format('5 Kevin kept by Andrew: wont_sign_up=%s; list shows %s', r->>'wont_sign_up',
    (SELECT e->>'wont_sign_up' FROM jsonb_array_elements(public.admin_list_profiles()->'profiles') e WHERE e->>'participant_id' = kevin::text));
  BEGIN r := public.admin_set_wont_sign_up(stephp, true); out := out || 'FAIL 6 claimed'::text;
  EXCEPTION WHEN others THEN out := out || ('6 claimed person cannot be hidden: ' || SQLERRM); END;
  out := out || format('6b groups offered for the household field: %s (empty households hidden)', jsonb_array_length(public.admin_list_profiles()->'groups'));
  RESET ROLE;

  -- Bob: signed in, no profile. Picker hides Kevin; claim refused.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-bob@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  pk := public.list_claimable_profiles(tok);
  out := out || format('7 picker for Bob: %s names; Kevin listed=%s (want false)', jsonb_array_length(pk->'profiles'),
    EXISTS (SELECT 1 FROM jsonb_array_elements(pk->'profiles') e WHERE e->>'id' = kevin::text));
  BEGIN r := public.claim_gift_profile(tok, kevin); out := out || 'FAIL 8 claimed hidden'::text;
  EXCEPTION WHEN others THEN out := out || ('8 claiming a kept name refused: ' || SQLERRM); END;
  BEGIN r := public.get_family_directory(); out := out || 'FAIL 9 bob sees directory'::text;
  EXCEPTION WHEN others THEN out := out || ('9 no-household user refused the directory: ' || SQLERRM); END;
  BEGIN r := public.admin_set_wont_sign_up(kevin, false); out := out || 'FAIL 10 bob admin'::text;
  EXCEPTION WHEN others THEN out := out || ('10 non-owner cannot use admin_set_wont_sign_up: ' || SQLERRM); END;
  BEGIN r := public.admin_update_profile(kevin, 'Hack', NULL, NULL); out := out || 'FAIL 10b bob edit'::text;
  EXCEPTION WHEN others THEN out := out || ('10b non-owner cannot edit: ' || SQLERRM); END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN r := public.get_family_directory(); out := out || 'FAIL 11 anon directory'::text;
  EXCEPTION WHEN others THEN out := out || ('11 anon refused the directory: ' || SQLERRM); END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.admin_set_wont_sign_up(kevin, false);
  RESET ROLE;

  -- Ann: "I'm not on the list" with the family link, after the lock
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ann, 'email', 'zz-ann@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  out := out || format('12 picker back after un-keep: Kevin listed=%s', EXISTS (SELECT 1 FROM jsonb_array_elements(public.list_claimable_profiles(tok)->'profiles') e WHERE e->>'id' = kevin::text));
  r := public.accept_gift_invite(tok, 'Zz Ann', '8325551212', 'zz-ann@example.invalid', 'The Zz', '[]'::jsonb, '[]'::jsonb);
  ann_person := (r->>'participant_id')::uuid;
  RESET ROLE;
  out := out || format('13 Ann joined after lock: in_draw=%s (want false); event=%s pairings=%s',
    (SELECT in_draw FROM public.gift_participants WHERE id = ann_person),
    (SELECT status FROM public.secret_santa_events WHERE id = ev), (SELECT count(*) FROM public.secret_santa_assignments WHERE event_id = ev));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ann, 'email', 'zz-ann@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  out := out || format('14 Ann access: in_draw=%s drawing_locked=%s', public.get_my_gift_access()->>'in_draw', public.get_my_gift_access()->>'drawing_locked');
  out := out || format('15 Ann assignment: %s', public.get_my_assignment());
  dir := public.get_family_directory();
  RESET ROLE;
  SELECT count(*) INTO lists_in_hh FROM public.gift_lists WHERE household_id = hid;
  SELECT sum(jsonb_array_length(g->'lists')) INTO lists_in_dir FROM jsonb_array_elements(dir->'groups') g;
  txt := dir::text;
  out := out || format('16 directory: %s households, %s lists (household has %s); mine_label=%s; groups=%s', jsonb_array_length(dir->'groups'), lists_in_dir, lists_in_hh, dir->>'mine_label',
    (SELECT string_agg(g->>'label', ' | ' ORDER BY g->>'label') FROM jsonb_array_elements(dir->'groups') g));
  out := out || format('17 directory leaks? assignment/receiver/giver/email/draw words: %s', (txt ~* '(assign|receiver|giver|email|in_draw|draw|claimed)'));
  out := out || format('17b keys in a list entry: %s', (SELECT string_agg(k, ',' ORDER BY k) FROM (SELECT DISTINCT jsonb_object_keys(l) k FROM jsonb_array_elements(dir->'groups'->0->'lists') l) s));
  out := out || format('18 Ann own list marked mine=%s; Ann sees kids lists: %s', (SELECT bool_or((l->>'mine')::boolean) FROM jsonb_array_elements(dir->'groups') g, jsonb_array_elements(g->'lists') l WHERE l->>'display_name' = 'Zz Ann'),
    (SELECT string_agg(l->>'display_name', ',') FROM jsonb_array_elements(dir->'groups') g, jsonb_array_elements(g->'lists') l WHERE l->>'list_kind' = 'wish'));

  -- Ann adds a family member (not in the drawing), duplicate names refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ann, 'email', 'zz-ann@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  kid := public.add_managed_member('Zz Kid', 'son', '6');
  zzlist := (kid->>'list_id')::uuid;
  out := out || format('19 Ann adds Zz Kid: ok list=%s', kid->>'display_name');
  BEGIN kid := public.add_managed_member('  kevin zz ', NULL, NULL); out := out || 'FAIL 20 dup'::text;
  EXCEPTION WHEN others THEN out := out || ('20 duplicate (case/space) refused: ' || SQLERRM); END;
  BEGIN kid := public.add_managed_member('Molly Cress', NULL, NULL); out := out || 'FAIL 21 dup'::text;
  EXCEPTION WHEN others THEN out := out || ('21 existing Molly refused: ' || SQLERRM); END;
  BEGIN kid := public.add_managed_member('claire', NULL, NULL); out := out || 'FAIL 22 dup kid list'::text;
  EXCEPTION WHEN others THEN out := out || ('22 existing kid list name refused: ' || SQLERRM); END;
  kid := public.update_managed_member(zzlist, 'Zz Kid', 'son', '7');
  out := out || format('23 edit age keeps the same name: age=%s', kid->>'age_label');
  BEGIN kid := public.update_managed_member(zzlist, 'Molly Cress', 'son', '7'); out := out || 'FAIL 24 rename dup'::text;
  EXCEPTION WHEN others THEN out := out || ('24 rename onto existing name refused: ' || SQLERRM); END;
  RESET ROLE;
  out := out || format('25 Zz Kid in_draw=%s', (SELECT in_draw FROM public.gift_participants WHERE display_name = 'Zz Kid' AND household_id = hid));

  -- Stephanie (real claimed Cress mom) adds a kid outside Secret Santa
  IF steph IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', steph, 'email', 'zz-steph@example.invalid', 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    kid := public.add_managed_member('Zz Cress Kid', 'daughter', '9');
    BEGIN kid := public.add_managed_member('Molly Cress', NULL, NULL); out := out || 'FAIL 26 molly dup'::text;
    EXCEPTION WHEN others THEN out := out || ('26 Stephanie cannot re-add Molly: ' || SQLERRM); END;
    out := out || format('27 Stephanie access in_draw=%s locked=%s', public.get_my_gift_access()->>'in_draw', public.get_my_gift_access()->>'drawing_locked');
    dir := public.get_family_directory();
    RESET ROLE;
    out := out || format('28 new Cress kid: in_draw=%s group=%s; in Cress directory group=%s', (SELECT in_draw FROM public.gift_participants WHERE display_name = 'Zz Cress Kid' AND household_id = hid),
      (SELECT g.label FROM public.gift_participants p JOIN public.gift_groups g ON g.id = p.group_id WHERE p.display_name = 'Zz Cress Kid' AND p.household_id = hid),
      (SELECT g->>'label' FROM jsonb_array_elements(dir->'groups') g, jsonb_array_elements(g->'lists') l WHERE l->>'display_name' = 'Zz Cress Kid'));
  END IF;

  out := out || format('29 locked drawing untouched so far: status=%s pairings=%s (was %s) in_draw=%s (was %s)',
    (SELECT status FROM public.secret_santa_events WHERE id = ev), (SELECT count(*) FROM public.secret_santa_assignments WHERE event_id = ev), before_assign,
    (SELECT count(*) FROM public.gift_participants WHERE household_id = hid AND in_draw), before_in_draw);

  -- Same rule while the drawing is NOT locked (rolled back with everything else): a new joiner goes in, a draft is cleared
  UPDATE public.secret_santa_events SET status = 'draft' WHERE id = ev;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-bob@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  out := out || format('30 preview while draft: locked=%s', public.preview_family_invite(tok)->>'drawing_locked');
  r := public.accept_gift_invite(tok, 'Zz Bob', '8325551213', 'zz-bob@example.invalid', 'The Zz', '[]'::jsonb, '[]'::jsonb);
  RESET ROLE;
  out := out || format('31 Bob joined during an unlocked draft: in_draw=%s event=%s pairings=%s', (SELECT in_draw FROM public.gift_participants WHERE id = (r->>'participant_id')::uuid),
    (SELECT status FROM public.secret_santa_events WHERE id = ev), (SELECT count(*) FROM public.secret_santa_assignments WHERE event_id = ev));
  UPDATE public.secret_santa_events SET status = 'locked' WHERE id = ev;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  out := out || format('32 anon preview of the family link: %s', public.preview_family_invite(tok));
  RESET ROLE;

  RAISE EXCEPTION 'ROLLBACK_OK %', array_to_string(out, E'\n');
END
$t$;
