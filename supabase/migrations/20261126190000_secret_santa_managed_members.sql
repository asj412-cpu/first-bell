-- Secret Santa includes managed family members (GJP-2 follow-up).
-- Additive only: replaces functions created by 20261126160000_gift_managed_members
-- (not used anywhere else), and adds one trigger and one read function.
-- No existing table, column, row, policy, or pre-GJP-2 function is changed.
-- No service role key belongs in the app or this repo.
--
-- Rules:
--   * A managed person (say Mike, added by Sarah) is an ordinary gift_participants
--     row, so private.draw_secret_santa already draws them like anyone else:
--     nobody draws themselves, and with "avoid same household" on, nobody draws
--     someone in their own gift_groups group.
--   * A managed person shares the manager's group_id, so they count as part of
--     the manager's household. The trigger below keeps that true if the
--     manager's group changes later.
--   * New managed people join the drawing (in_draw = true) unless it is locked.
--     Adding or removing one clears a draft draw, like set_participant_in_draw.
--   * Results for a managed person go to their manager:
--     get_managed_assignments() returns who each of the caller's people drew.

CREATE OR REPLACE FUNCTION private.add_managed_member(p_name text, p_relationship text, p_age text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  manager public.gift_participants;
  clean_name text := btrim(COALESCE(p_name, ''));
  clean_rel text := NULLIF(left(btrim(COALESCE(p_relationship, '')), 40), '');
  clean_age text := NULLIF(left(btrim(COALESCE(p_age, '')), 20), '');
  occasion text;
  event public.secret_santa_events;
  joins_draw boolean;
  new_list uuid;
  new_person uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;
  IF char_length(clean_name) < 1 OR char_length(clean_name) > 80 THEN
    RAISE EXCEPTION 'Enter a name';
  END IF;

  SELECT * INTO manager
  FROM public.gift_participants p
  WHERE p.user_id = uid
  ORDER BY p.created_at
  LIMIT 1;
  IF manager.id IS NULL THEN
    RAISE EXCEPTION 'Join the family list first';
  END IF;

  IF (SELECT count(*) FROM public.gift_managed_members m WHERE m.manager_user_id = uid) >= 12 THEN
    RAISE EXCEPTION 'Twelve family members is the limit for one person';
  END IF;

  SELECT l.occasion INTO occasion FROM public.gift_lists l WHERE l.id = manager.list_id;

  -- Secret Santa: a new family member joins the drawing like anyone else,
  -- unless the drawing is already locked. A draft draw is cleared so Andrew
  -- draws again with them in it (same as set_participant_in_draw).
  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = manager.household_id AND e.occasion = 'Christmas 2026';
  joins_draw := event.status IS DISTINCT FROM 'locked';
  IF event.status = 'draft' THEN
    DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
    UPDATE public.secret_santa_events SET status = 'open', drawn_at = NULL WHERE id = event.id;
  END IF;

  INSERT INTO public.gift_lists (
    household_id, kid_key, display_name, occasion, share_slug, list_kind, owner_user_id, created_by
  )
  VALUES (
    manager.household_id,
    'guest-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    clean_name,
    COALESCE(occasion, 'Christmas 2026'),
    'f' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
    'exchange',
    NULL,
    uid
  )
  RETURNING id INTO new_list;

  INSERT INTO public.gift_participants (
    household_id, group_id, user_id, display_name, list_id, in_draw, submitted_at
  )
  -- Same group as the manager, so "avoid same household" keeps them apart.
  VALUES (manager.household_id, manager.group_id, NULL, clean_name, new_list, joins_draw, NULL)
  RETURNING id INTO new_person;

  INSERT INTO public.gift_managed_members (
    list_id, household_id, participant_id, manager_participant_id, manager_user_id,
    manager_name, relationship, age_label
  )
  VALUES (
    new_list, manager.household_id, new_person, manager.id, uid,
    left(btrim(manager.display_name), 80), clean_rel, clean_age
  );

  RETURN private.managed_member_json(new_list);
END;
$$;

CREATE OR REPLACE FUNCTION private.remove_managed_member(p_list uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hid uuid;
  person uuid;
  event public.secret_santa_events;
BEGIN
  IF NOT (SELECT private.manages_gift_list(p_list)) THEN
    RAISE EXCEPTION 'Only the person who added them, or Andrew, can remove them';
  END IF;
  SELECT m.household_id INTO hid FROM public.gift_managed_members m WHERE m.list_id = p_list;

  -- A gift someone already bought stays put unless Andrew removes the person.
  -- The message does not say a gift was bought, to keep claims secret.
  IF NOT (SELECT private.is_household_admin(hid)) AND EXISTS (
    SELECT 1 FROM public.gift_items i WHERE i.list_id = p_list AND i.claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Ask Andrew to remove this person';
  END IF;

  -- Secret Santa: once locked, someone in the drawing stays (removing them
  -- would erase another person's assignment). A draft draw is cleared.
  SELECT m.participant_id INTO person FROM public.gift_managed_members m WHERE m.list_id = p_list;
  SELECT * INTO event
  FROM public.secret_santa_events e
  WHERE e.household_id = hid AND e.occasion = 'Christmas 2026';
  IF person IS NOT NULL AND event.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.secret_santa_assignments a
    WHERE a.event_id = event.id AND (a.giver_id = person OR a.receiver_id = person)
  ) THEN
    IF event.status = 'locked' THEN
      RAISE EXCEPTION 'Secret Santa is locked, so they stay in the drawing. Ask Andrew.';
    END IF;
    DELETE FROM public.secret_santa_assignments WHERE event_id = event.id;
    UPDATE public.secret_santa_events SET status = 'open', drawn_at = NULL WHERE id = event.id;
  END IF;

  DELETE FROM public.gift_participants WHERE list_id = p_list AND user_id IS NULL;
  DELETE FROM public.gift_lists WHERE id = p_list;  -- cascades items and the managed row

  RETURN jsonb_build_object('removed', true, 'list_id', p_list);
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_managed_member_groups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.gift_participants p
  SET group_id = NEW.group_id
  FROM public.gift_managed_members m
  WHERE m.manager_participant_id = NEW.id
    AND p.id = m.participant_id
    AND p.group_id IS DISTINCT FROM NEW.group_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS gift_participants_sync_managed_groups ON public.gift_participants;
CREATE TRIGGER gift_participants_sync_managed_groups
  AFTER UPDATE OF group_id ON public.gift_participants
  FOR EACH ROW
  WHEN (OLD.group_id IS DISTINCT FROM NEW.group_id)
  EXECUTE FUNCTION private.sync_managed_member_groups();

-- Who each of my managed people drew. Same shape per person as
-- get_my_assignment, plus the managed person's name and list.
CREATE OR REPLACE FUNCTION private.get_managed_assignments()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'list_id', m.list_id,
    'participant_id', giver.id,
    'name', giver.display_name,
    'in_draw', giver.in_draw,
    'status', COALESCE(e.status, 'open'),
    'receiver', CASE
      WHEN e.status IN ('draft', 'locked') AND recv.id IS NOT NULL THEN jsonb_build_object(
        'id', recv.id,
        'name', recv.display_name,
        'list', CASE WHEN lst.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', lst.id,
          'display_name', lst.display_name,
          'share_slug', lst.share_slug,
          'occasion', lst.occasion
        ) END
      )
      ELSE NULL
    END
  ) ORDER BY m.created_at), '[]'::jsonb)
  FROM public.gift_managed_members m
  JOIN public.gift_participants giver ON giver.id = m.participant_id
  LEFT JOIN public.secret_santa_events e
    ON e.household_id = m.household_id AND e.occasion = 'Christmas 2026'
  LEFT JOIN public.secret_santa_assignments a
    ON a.event_id = e.id AND a.giver_id = giver.id
  LEFT JOIN public.gift_participants recv ON recv.id = a.receiver_id
  LEFT JOIN public.gift_lists lst ON lst.id = recv.list_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND m.manager_user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.get_managed_assignments()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT private.get_managed_assignments(); $$;

REVOKE ALL ON FUNCTION private.sync_managed_member_groups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_managed_assignments() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_managed_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_managed_assignments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_assignments() TO authenticated;
