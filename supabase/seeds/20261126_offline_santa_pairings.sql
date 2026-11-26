-- Load Andrew's offline Secret Santa drawing (t1246u, corrected t1247u).
-- Run ONCE on prod, only AFTER Andrew approves merging the GJP-4 PR and the
-- migration 20261126233000_family_profiles_and_manual_santa is applied.
-- Runs as Andrew (household owner) through the same checked functions the app uses.
--
-- * Existing people are matched by first name: Andrew, Megan, Molly (Molly Cress).
--   A first name that matches more than one person stops the whole load.
-- * Everyone else becomes a pre-made, unclaimed profile (first name only).
-- * Existing unclaimed people (Megan) are made claimable from the family link.
-- * Pairings are saved as a draft. Andrew reviews and taps "Lock the drawing".
DO $seed$
DECLARE
  andrew uuid := '3255aa03-c5f0-459a-8c8f-e7accf3e3997';
  hid uuid;
  pairs text[][] := ARRAY[
    ['Paul', 'Ryan'], ['Michelle', 'Noah'], ['Debbie', 'Haley'], ['Scott', 'Andrew'],
    ['Stephanie', 'Megan'], ['Kevin', 'Michelle'], ['Haley', 'Kevin'], ['Ryan', 'Debbie'],
    ['Megan', 'Scott'], ['Andrew', 'Stephanie'], ['Molly', 'Paul'], ['Noah', 'Molly']
  ];
  names text[];
  nm text;
  hits integer;
  person uuid;
  ids jsonb := '{}'::jsonb;
  payload jsonb := '[]'::jsonb;
  i integer;
  in_draw_count integer;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', andrew, 'role', 'authenticated')::text, true);
  SELECT household_id INTO hid FROM public.household_members WHERE user_id = andrew AND role = 'owner';
  IF hid IS NULL THEN RAISE EXCEPTION 'Andrew is not a household owner'; END IF;

  SELECT array_agg(DISTINCT x) INTO names FROM unnest(pairs) AS x;
  FOREACH nm IN ARRAY names LOOP
    SELECT count(*) INTO hits FROM public.gift_participants gp
    WHERE gp.household_id = hid AND lower(split_part(btrim(gp.display_name), ' ', 1)) = lower(nm);
    IF hits > 1 THEN
      RAISE EXCEPTION 'Name % matches % people. Ask Andrew which one.', nm, hits;
    END IF;
    IF hits = 0 THEN
      person := (private.admin_add_profile(nm, NULL, NULL) ->> 'participant_id')::uuid;
    ELSE
      SELECT gp.id INTO person FROM public.gift_participants gp
      WHERE gp.household_id = hid AND lower(split_part(btrim(gp.display_name), ' ', 1)) = lower(nm);
      -- Unclaimed existing person: let them pick their name from the family link.
      INSERT INTO public.gift_profiles (participant_id, household_id, created_by)
      SELECT gp.id, hid, andrew FROM public.gift_participants gp WHERE gp.id = person AND gp.user_id IS NULL
      ON CONFLICT (participant_id) DO NOTHING;
      UPDATE public.gift_participants SET in_draw = true WHERE id = person AND NOT in_draw;
    END IF;
    ids := ids || jsonb_build_object(nm, person);
  END LOOP;

  SELECT count(*) INTO in_draw_count FROM public.gift_participants WHERE household_id = hid AND in_draw;
  IF in_draw_count <> 12 THEN
    RAISE EXCEPTION 'Expected 12 people in the drawing, found %. Check who else is in it before loading.', in_draw_count;
  END IF;

  FOR i IN 1..array_length(pairs, 1) LOOP
    payload := payload || jsonb_build_array(jsonb_build_object('giver', ids ->> pairs[i][1], 'receiver', ids ->> pairs[i][2]));
  END LOOP;
  PERFORM private.save_manual_secret_santa(payload);
  PERFORM set_config('request.jwt.claims', '', true);
END
$seed$;
