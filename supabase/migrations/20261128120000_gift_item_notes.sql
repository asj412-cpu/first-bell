-- Gift item notes (size, color, anything else).
-- gift_items.notes already exists (nullable text) and list/read RPCs already
-- return it. This adds a 500-character limit and lets people save and clear
-- a note when they add or edit items (own list, managed lists, invite join).
-- Replacement function bodies only besides the additive check. Grants stay.

ALTER TABLE public.gift_items
  ADD CONSTRAINT gift_items_notes_length
  CHECK (notes IS NULL OR char_length(notes) <= 500);

CREATE OR REPLACE FUNCTION private.add_invite_items(p_list uuid, p_ideas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entry jsonb;
  added integer := 0;
  description text;
  link text;
  photo text;
  item_notes text;
BEGIN
  IF jsonb_typeof(p_ideas) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_ideas) AS value LOOP
    EXIT WHEN added >= 40;
    IF jsonb_typeof(entry) = 'string' THEN
      description := left(btrim(entry #>> '{}'), 160);
      link := '';
      photo := NULL;
      item_notes := NULL;
    ELSIF jsonb_typeof(entry) = 'object' THEN
      description := left(btrim(COALESCE(entry->>'description', entry->>'title', '')), 160);
      link := COALESCE(entry->>'url', '');
      photo := NULLIF(entry->>'image', '');
      item_notes := NULLIF(left(btrim(COALESCE(entry->>'notes', '')), 500), '');
    ELSE
      CONTINUE;
    END IF;
    IF private.insert_wish(p_list, description, COALESCE(item_notes, ''), link, photo) IS NOT NULL THEN
      added := added + 1;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.save_my_gift_items(p_list uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entry jsonb;
  kept uuid[] := '{}';
  item_id uuid;
  description text;
  link text;
  photo text;
  item_notes text;
  added integer := 0;
BEGIN
  IF NOT (SELECT private.can_edit_gift_list(p_list)) THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'Add at least one gift';
  END IF;
  IF jsonb_array_length(p_items) > 40 THEN
    RAISE EXCEPTION 'Forty gifts is the limit for one list';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_items) AS value LOOP
    description := left(btrim(COALESCE(entry->>'description', entry->>'title', '')), 160);
    link := NULLIF(btrim(COALESCE(entry->>'url', '')), '');
    photo := NULLIF(btrim(COALESCE(entry->>'image', '')), '');
    item_notes := NULLIF(left(btrim(COALESCE(entry->>'notes', '')), 500), '');
    IF description = '' THEN
      RAISE EXCEPTION 'Each gift needs a description';
    END IF;
    IF link IS NOT NULL AND link !~ '^https?://' THEN
      RAISE EXCEPTION 'Link must start with http';
    END IF;
    IF photo IS NOT NULL AND photo !~ '^https?://' THEN
      photo := NULL;
    END IF;

    item_id := NULL;
    IF COALESCE(entry->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      UPDATE public.gift_items AS gift
      SET title = description,
          notes = item_notes,
          url = link,
          image = photo
      WHERE gift.id = (entry->>'id')::uuid
        AND gift.list_id = p_list
      RETURNING gift.id INTO item_id;
    END IF;

    IF item_id IS NULL THEN
      item_id := private.insert_wish(p_list, description, COALESCE(item_notes, ''), COALESCE(link, ''), photo);
    END IF;
    kept := kept || item_id;
    added := added + 1;
  END LOOP;

  DELETE FROM public.gift_items AS gift
  WHERE gift.list_id = p_list
    AND gift.claimed_at IS NULL
    AND gift.source_slug IS NULL
    AND NOT (gift.id = ANY (kept));

  UPDATE public.gift_participants
  SET submitted_at = COALESCE(submitted_at, now())
  WHERE list_id = p_list;

  RETURN jsonb_build_object('count', added);
END;
$$;

CREATE OR REPLACE FUNCTION private.save_managed_member_items(p_list uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entry jsonb;
  kept uuid[] := '{}';
  item_id uuid;
  description text;
  link text;
  photo text;
  item_notes text;
  added integer := 0;
  items jsonb := COALESCE(p_items, '[]'::jsonb);
BEGIN
  IF NOT (SELECT private.manages_gift_list(p_list)) THEN
    RAISE EXCEPTION 'Only the person who added them, or Andrew, can change their gifts';
  END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Gift ideas were not a list';
  END IF;
  IF jsonb_array_length(items) > 40 THEN
    RAISE EXCEPTION 'Forty gifts is the limit for one list';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(items) AS value LOOP
    description := left(btrim(COALESCE(entry->>'description', entry->>'title', '')), 160);
    link := NULLIF(btrim(COALESCE(entry->>'url', '')), '');
    photo := NULLIF(btrim(COALESCE(entry->>'image', '')), '');
    item_notes := NULLIF(left(btrim(COALESCE(entry->>'notes', '')), 500), '');
    IF description = '' THEN
      RAISE EXCEPTION 'Each gift needs a description';
    END IF;
    IF link IS NOT NULL AND link !~ '^https?://' THEN
      RAISE EXCEPTION 'Link must start with http';
    END IF;
    IF photo IS NOT NULL AND photo !~ '^https?://' THEN
      photo := NULL;
    END IF;

    item_id := NULL;
    IF COALESCE(entry->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      UPDATE public.gift_items AS gift
      SET title = description,
          notes = item_notes,
          url = link,
          image = photo
      WHERE gift.id = (entry->>'id')::uuid
        AND gift.list_id = p_list
      RETURNING gift.id INTO item_id;
    END IF;

    IF item_id IS NULL THEN
      item_id := private.insert_wish(p_list, description, COALESCE(item_notes, ''), COALESCE(link, ''), photo);
    END IF;
    kept := kept || item_id;
    added := added + 1;
  END LOOP;

  -- Bought gifts are never deleted here, same as save_my_gift_items.
  DELETE FROM public.gift_items AS gift
  WHERE gift.list_id = p_list
    AND gift.claimed_at IS NULL
    AND gift.source_slug IS NULL
    AND NOT (gift.id = ANY (kept));

  UPDATE public.gift_participants
  SET submitted_at = CASE WHEN added > 0 THEN COALESCE(submitted_at, now()) ELSE submitted_at END
  WHERE list_id = p_list AND user_id IS NULL;

  RETURN jsonb_build_object('count', added);
END;
$$;
