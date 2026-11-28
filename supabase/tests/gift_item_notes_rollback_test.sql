-- Rollback-only test for 20261128120000_gift_item_notes.sql.
-- Run AFTER the migration in the same transaction (or paste the migration above it).
-- Ends with RAISE EXCEPTION 'ROLLBACK_OK ...' so nothing is kept.
-- Does not touch the locked drawing, pairings, family link, or anyone's marks.
DO $t$
DECLARE
  hh uuid;
  andrew uuid := '3255aa03-c5f0-459a-8c8f-e7accf3e3997';
  sarah uuid := 'aaaaaaaa-0000-4000-8000-00000000a011';
  bob   uuid := 'aaaaaaaa-0000-4000-8000-00000000a012';
  rosa  uuid := 'aaaaaaaa-0000-4000-8000-00000000a013';
  out text[] := '{}';
  r jsonb;
  v_list uuid;
  v_item uuid;
  v_slug text;
  n int;
  v_note text;
  managed jsonb;
  v_managed uuid;
  v_managed_slug text;
  shared jsonb;
BEGIN
  SELECT household_id INTO hh FROM public.household_members WHERE user_id = andrew;
  IF hh IS NULL THEN
    RAISE EXCEPTION 'FAIL no household';
  END IF;

  INSERT INTO auth.users (id, email, aud, role, created_at, updated_at) VALUES
    (sarah, 'zz-notes-sarah@example.invalid', 'authenticated', 'authenticated', now(), now()),
    (bob,   'zz-notes-bob@example.invalid',   'authenticated', 'authenticated', now(), now()),
    (rosa,  'zz-notes-rosa@example.invalid',  'authenticated', 'authenticated', now(), now());
  INSERT INTO public.gift_invites (household_id, token, label, single_use, expires_at) VALUES
    (hh, 'zz-notes-token-sarah-00000001', 'Christmas 2026', true, now() + interval '1 day'),
    (hh, 'zz-notes-token-bob-000000001',  'Christmas 2026', true, now() + interval '1 day'),
    (hh, 'zz-notes-token-rosa-00000001',  'Christmas 2026', true, now() + interval '1 day');

  -- Rosa joins with a note on the invite form
  PERFORM set_config('request.jwt.claims', json_build_object('sub', rosa, 'email', 'zz-notes-rosa@example.invalid', 'role', 'authenticated')::text, true);
  r := public.accept_gift_invite(
    'zz-notes-token-rosa-00000001',
    'Rosa Notes',
    '7135550199',
    'zz-notes-rosa@example.invalid',
    'The Noters',
    '[{"description":"Wool scarf","url":"https://example.com/scarf","notes":"  Navy, size M  "}]'::jsonb,
    '[]'::jsonb
  );
  SELECT i.notes, i.list_id INTO v_note, v_list
  FROM public.gift_items i
  JOIN public.gift_lists l ON l.id = i.list_id
  JOIN public.gift_participants p ON p.list_id = l.id AND p.user_id = rosa
  WHERE i.title = 'Wool scarf';
  IF v_note IS DISTINCT FROM 'Navy, size M' THEN
    RAISE EXCEPTION 'FAIL invite notes: %', v_note;
  END IF;
  out := out || '1 invite join saved trimmed notes'::text;

  -- Sarah joins with an empty list, then saves her own items with a note
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-notes-sarah@example.invalid', 'role', 'authenticated')::text, true);
  r := public.accept_gift_invite('zz-notes-token-sarah-00000001', 'Sarah Notes', '7135550100', 'zz-notes-sarah@example.invalid', 'The Sarahs', '[]'::jsonb, '[]'::jsonb);
  SELECT p.list_id, l.share_slug INTO v_list, v_slug
  FROM public.gift_participants p
  JOIN public.gift_lists l ON l.id = p.list_id
  WHERE p.user_id = sarah;
  SET LOCAL ROLE authenticated;
  r := public.save_my_gift_items(v_list, '[{"description":"Coffee beans","url":"https://example.com/beans","notes":"Whole bean, medium roast"}]'::jsonb);
  RESET ROLE;
  SELECT i.id, i.notes INTO v_item, v_note FROM public.gift_items i WHERE i.list_id = v_list AND i.title = 'Coffee beans';
  IF v_note IS DISTINCT FROM 'Whole bean, medium roast' THEN
    RAISE EXCEPTION 'FAIL save_my_gift_items notes: %', v_note;
  END IF;
  out := out || '2 own list add with notes'::text;

  -- Giver / signed-out views include the note
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-notes-bob@example.invalid', 'role', 'authenticated')::text, true);
  r := public.accept_gift_invite('zz-notes-token-bob-000000001', 'Bob Notes', '7135550101', 'zz-notes-bob@example.invalid', 'The Bobs', '[]'::jsonb, '[]'::jsonb);
  SET LOCAL ROLE authenticated;
  shared := public.get_shared_gift_list(v_slug);
  RESET ROLE;
  IF shared->'items'->0->>'notes' IS DISTINCT FROM 'Whole bean, medium roast' THEN
    RAISE EXCEPTION 'FAIL shared list notes: %', shared->'items'->0->>'notes';
  END IF;
  shared := public.get_public_gift_list(v_slug);
  IF shared->'items'->0->>'notes' IS DISTINCT FROM 'Whole bean, medium roast' THEN
    RAISE EXCEPTION 'FAIL public list notes: %', shared->'items'->0->>'notes';
  END IF;
  out := out || '3 shared and signed-out views show notes'::text;

  -- Edit, then clear
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-notes-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.save_my_gift_items(v_list, jsonb_build_array(jsonb_build_object(
    'id', v_item, 'description', 'Coffee beans', 'url', 'https://example.com/beans', 'notes', 'Dark roast'
  )));
  RESET ROLE;
  SELECT notes INTO v_note FROM public.gift_items WHERE id = v_item;
  IF v_note IS DISTINCT FROM 'Dark roast' THEN
    RAISE EXCEPTION 'FAIL edit notes: %', v_note;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-notes-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.save_my_gift_items(v_list, jsonb_build_array(jsonb_build_object(
    'id', v_item, 'description', 'Coffee beans', 'url', 'https://example.com/beans', 'notes', '  '
  )));
  RESET ROLE;
  SELECT notes INTO v_note FROM public.gift_items WHERE id = v_item;
  IF v_note IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL clear notes: %', v_note;
  END IF;
  out := out || '4 owner can edit and clear notes'::text;

  -- Long notes truncate to 500 (and satisfy the check)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-notes-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.save_my_gift_items(v_list, jsonb_build_array(jsonb_build_object(
    'id', v_item, 'description', 'Coffee beans', 'notes', repeat('x', 520)
  )));
  RESET ROLE;
  SELECT char_length(notes) INTO n FROM public.gift_items WHERE id = v_item;
  IF n IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'FAIL truncate notes length: %', n;
  END IF;
  out := out || '5 notes longer than 500 are truncated'::text;

  -- Direct insert over 500 is blocked
  BEGIN
    INSERT INTO public.gift_items (list_id, title, notes, sort, review_status, category)
    VALUES (v_list, 'Too long', repeat('y', 501), 99, 'approved', 'Idea');
    RAISE EXCEPTION 'FAIL 501-char notes check did not fire';
  EXCEPTION
    WHEN check_violation THEN
      out := out || '6 check rejects notes over 500'::text;
  END;

  -- Managed member list
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sarah, 'email', 'zz-notes-sarah@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  managed := public.add_managed_member('Mike Notes', 'husband', NULL);
  v_managed := (managed->>'list_id')::uuid;
  r := public.save_managed_member_items(v_managed, '[{"description":"Fishing reel","notes":"Left-handed"}]'::jsonb);
  RESET ROLE;
  SELECT i.notes, l.share_slug INTO v_note, v_managed_slug
  FROM public.gift_items i
  JOIN public.gift_lists l ON l.id = i.list_id
  WHERE i.list_id = v_managed AND i.title = 'Fishing reel';
  IF v_note IS DISTINCT FROM 'Left-handed' THEN
    RAISE EXCEPTION 'FAIL managed notes: %', v_note;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', bob, 'email', 'zz-notes-bob@example.invalid', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  shared := public.get_shared_gift_list(v_managed_slug);
  BEGIN
    r := public.save_managed_member_items(v_managed, '[{"description":"Fishing reel","notes":"hacked"}]'::jsonb);
    RAISE EXCEPTION 'FAIL bob edited managed notes';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'FAIL bob%' THEN RAISE; END IF;
      out := out || ('7 bob cannot edit managed notes: ' || SQLERRM)::text;
  END;
  RESET ROLE;
  IF shared->'items'->0->>'notes' IS DISTINCT FROM 'Left-handed' THEN
    RAISE EXCEPTION 'FAIL managed shared notes: %', shared->'items'->0->>'notes';
  END IF;
  SELECT notes INTO v_note FROM public.gift_items WHERE list_id = v_managed AND title = 'Fishing reel';
  IF v_note IS DISTINCT FROM 'Left-handed' THEN
    RAISE EXCEPTION 'FAIL managed notes mutated: %', v_note;
  END IF;
  out := out || '8 managed list notes show to a giver and stay private to the manager'::text;

  RAISE EXCEPTION 'ROLLBACK_OK %', array_to_string(out, ' | ');
END;
$t$;
