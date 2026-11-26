-- Rollback-only RLS test for 20261126160000_gift_managed_members.sql.
-- Run AFTER the migration in the same transaction (or paste the migration above it).
-- It always ends with RAISE EXCEPTION 'ROLLBACK_OK ...' so nothing is kept.
DO $t$
DECLARE
  hh uuid;
  andrew uuid := '3255aa03-c5f0-459a-8c8f-e7accf3e3997';
  sarah uuid := 'aaaaaaaa-0000-4000-8000-00000000a001';
  bob   uuid := 'aaaaaaaa-0000-4000-8000-00000000b002';
  meg   uuid := 'aaaaaaaa-0000-4000-8000-00000000c003';
  andrew_mail text;
  out text[] := '{}';
  claire_list uuid; r jsonb; husband jsonb; kid jsonb; n int; ok boolean; slug text; item uuid; msg text;
BEGIN
  SELECT household_id INTO hh FROM public.household_members WHERE user_id = andrew;
  SELECT email INTO andrew_mail FROM auth.users WHERE id = andrew;
  SELECT id INTO claire_list FROM public.gift_lists WHERE household_id = hh AND kid_key = 'claire' LIMIT 1;
  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at) VALUES
    (sarah, 'zz-sarah@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (bob,   'zz-bob@example.invalid',   'authenticated', 'authenticated', now(), now()),
    (meg,   'zz-meg@example.invalid',   'authenticated', 'authenticated', now(), now());
  INSERT INTO public.household_members (household_id, user_id, role) VALUES (hh, meg, 'member');
  INSERT INTO public.gift_invites (household_id, token, label, single_use, expires_at) VALUES
    (hh, 'zz-rls-test-token-sarah-000001', 'Christmas 2026', true, now() + interval '1 day'),
    (hh, 'zz-rls-test-token-bob-00000001', 'Christmas 2026', true, now() + interval '1 day');

  -- Sarah and Bob join as ordinary invited members
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  PERFORM public.accept_gift_invite('zz-rls-test-token-sarah-000001', 'Sarah Test', '7135550100', 'zz-sarah@example.invalid', 'The Testers', '[]'::jsonb, '[]'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-bob@example.invalid', 'role', 'authenticated')::text, true);
  PERFORM public.accept_gift_invite('zz-rls-test-token-bob-00000001', 'Bob Test', '7135550101', 'zz-bob@example.invalid', 'The Bobs', '[]'::jsonb, '[]'::jsonb);

  -- ===== As Sarah (authenticated role, RLS on)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  husband := public.add_managed_member('Mike Test', 'husband', NULL);
  kid := public.add_managed_member('Lily Test', 'daughter', '7');
  out := out || format('1 sarah add husband+kid: %s / %s mine=%s can_edit=%s', husband->>'display_name', kid->>'display_name', husband->>'mine', husband->>'can_edit');
  r := public.save_managed_member_items((husband->>'list_id')::uuid, '[{"description":"Fishing reel","url":"https://example.com/reel"},{"description":"Wool socks"}]'::jsonb);
  r := public.save_managed_member_items((kid->>'list_id')::uuid, '[{"description":"Lego Friends set"}]'::jsonb);
  out := out || format('2 sarah saved items: husband=%s kid=%s', (SELECT count(*) FROM jsonb_array_elements(public.get_my_gift_lists()) e WHERE e->>'display_name'='Mike Test' AND jsonb_array_length(e->'items')=2), (SELECT count(*) FROM jsonb_array_elements(public.get_my_gift_lists()) e WHERE e->>'display_name'='Lily Test' AND jsonb_array_length(e->'items')=1));
  r := public.update_managed_member((kid->>'list_id')::uuid, 'Lily T', 'daughter', '8');
  out := out || format('3 sarah edit kid -> %s age %s', r->>'display_name', r->>'age_label');
  out := out || format('4 sarah get_managed_members count=%s', jsonb_array_length(public.get_managed_members()));
  SELECT count(*) INTO n FROM public.gift_managed_members;
  out := out || format('5 sarah direct select own managed rows=%s', n);
  BEGIN
    INSERT INTO public.gift_managed_members (list_id, household_id, manager_user_id, manager_name)
      VALUES (claire_list, hh, sarah, 'Sarah');
    out := out || 'FAIL 6 sarah could hijack claire list'::text;
  EXCEPTION WHEN others THEN out := out || ('6 sarah direct insert managed row blocked: ' || SQLERRM); END;
  RESET ROLE;

  -- ===== As Bob (another invited member, third party)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-bob@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN r := public.save_managed_member_items((husband->>'list_id')::uuid, '[{"description":"hacked"}]'::jsonb); out := out || 'FAIL 7 bob edited items'::text;
  EXCEPTION WHEN others THEN out := out || ('7 bob save items blocked: ' || SQLERRM); END;
  BEGIN r := public.update_managed_member((husband->>'list_id')::uuid, 'hacked', NULL, NULL); out := out || 'FAIL 8 bob renamed'::text;
  EXCEPTION WHEN others THEN out := out || ('8 bob rename blocked: ' || SQLERRM); END;
  BEGIN r := public.remove_managed_member((husband->>'list_id')::uuid); out := out || 'FAIL 9 bob removed'::text;
  EXCEPTION WHEN others THEN out := out || ('9 bob remove blocked: ' || SQLERRM); END;
  BEGIN r := public.save_my_gift_items((husband->>'list_id')::uuid, '[{"description":"hacked"}]'::jsonb); out := out || 'FAIL 10 bob old rpc edit'::text;
  EXCEPTION WHEN others THEN out := out || ('10 bob old save_my_gift_items blocked: ' || SQLERRM); END;
  UPDATE public.gift_items SET title = 'hacked' WHERE list_id = (husband->>'list_id')::uuid; GET DIAGNOSTICS n = ROW_COUNT;
  out := out || format('11 bob direct update rows=%s', n);
  out := out || format('12 bob sees managed members=%s', jsonb_array_length(public.get_managed_members()));
  -- Bob claims a gift for Mike the same way as any list (shared link)
  RESET ROLE;
  SELECT l.share_slug INTO slug FROM public.gift_lists l WHERE l.id = (husband->>'list_id')::uuid;
  out := out || format('12b husband titles now=%s', (SELECT string_agg(i.title || '/' || i.review_status, ', ') FROM public.gift_items i WHERE i.list_id = (husband->>'list_id')::uuid));
  SELECT i.id INTO item FROM public.gift_items i WHERE i.list_id = (husband->>'list_id')::uuid ORDER BY i.sort, i.created_at LIMIT 1;
  SET LOCAL ROLE authenticated;
  r := public.get_shared_gift_list(slug);
  out := out || format('13 bob shared page: %s items=%s label=%s', r->'list'->>'display_name', jsonb_array_length(r->'items'), public.get_managed_label(slug)::text);
  BEGIN
    r := public.mark_gift_purchased(slug, item, 'Bob');
    out := out || format('14 bob claimed first gift ok=%s', r IS NOT NULL);
  EXCEPTION WHEN others THEN out := out || ('FAIL 14 claim: ' || SQLERRM || ' slug=' || COALESCE(slug,'null') || ' item=' || COALESCE(item::text,'null')); END;
  RESET ROLE;

  -- ===== Anonymous visitor on the shared link
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  out := out || format('15 anon label=%s', public.get_managed_label(slug)::text);
  BEGIN r := public.get_managed_members(); out := out || 'FAIL 16 anon listed members'::text;
  EXCEPTION WHEN others THEN out := out || ('16 anon get_managed_members blocked: ' || SQLERRM); END;
  RESET ROLE;

  -- ===== Non-owner household member (Megan-style) direct table writes
  PERFORM set_config('request.jwt.claims', json_build_object('sub', meg, 'email', 'zz-meg@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.gift_managed_members; out := out || format('17 member can read managed rows=%s', n);
  UPDATE public.gift_items SET title = 'hacked' WHERE list_id = (kid->>'list_id')::uuid; GET DIAGNOSTICS n = ROW_COUNT;
  out := out || format('18 member direct item update rows=%s', n);
  DELETE FROM public.gift_lists WHERE id = (kid->>'list_id')::uuid; GET DIAGNOSTICS n = ROW_COUNT;
  out := out || format('19 member direct list delete rows=%s', n);
  BEGIN INSERT INTO public.gift_items (list_id, title, review_status) VALUES ((kid->>'list_id')::uuid, 'hacked', 'approved'); out := out || 'FAIL 20 member inserted'::text;
  EXCEPTION WHEN others THEN out := out || ('20 member direct item insert blocked: ' || SQLERRM); END;
  SELECT count(*) INTO n FROM public.gift_items WHERE list_id = (SELECT id FROM public.gift_lists WHERE kid_key='claire' LIMIT 1);
  UPDATE public.gift_lists SET display_name = display_name WHERE id = claire_list; GET DIAGNOSTICS n = ROW_COUNT;
  out := out || format('21 member can still update an ordinary list rows=%s', n);
  RESET ROLE;

  -- ===== Andrew (owner)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'email', andrew_mail, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  out := out || format('22 andrew sees members=%s', jsonb_array_length(public.get_managed_members()));
  r := public.update_managed_member((husband->>'list_id')::uuid, 'Mike Tester', 'husband', NULL);
  out := out || format('23 andrew renamed -> %s', r->>'display_name');
  UPDATE public.gift_items SET notes = 'size L' WHERE list_id = (husband->>'list_id')::uuid AND title = 'Wool socks'; GET DIAGNOSTICS n = ROW_COUNT;
  out := out || format('24 andrew direct item update rows=%s', n);
  RESET ROLE;

  -- ===== Sarah removes: kid (nothing bought) ok, husband (has a bought gift) refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.save_managed_member_items((kid->>'list_id')::uuid, '[]'::jsonb);
  out := out || format('25 sarah cleared kid items count=%s', r->>'count');
  r := public.save_managed_member_items((husband->>'list_id')::uuid, '[]'::jsonb);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.gift_items WHERE list_id = (husband->>'list_id')::uuid;
  out := out || format('26 bought gift kept after sarah cleared husband list: items=%s', n);
  SET LOCAL ROLE authenticated;
  r := public.remove_managed_member((kid->>'list_id')::uuid);
  out := out || format('27 sarah removed kid=%s', r->>'removed');
  BEGIN r := public.remove_managed_member((husband->>'list_id')::uuid); out := out || 'FAIL 28 removed with claim'::text;
  EXCEPTION WHEN others THEN out := out || ('28 sarah remove husband (has bought gift) refused: ' || SQLERRM); END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.gift_lists WHERE id = (kid->>'list_id')::uuid;
  out := out || format('29 kid list gone=%s', n = 0);

  RAISE EXCEPTION E'ROLLBACK_OK\n%', array_to_string(out, E'\n');
END
$t$;
