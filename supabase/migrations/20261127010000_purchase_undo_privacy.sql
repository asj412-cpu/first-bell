-- Purchase marks: undo from the Secret Santa and list-link pages, hide marks
-- from signed-out viewers of person lists, and stop telling a recipient that
-- their own list has anything on it.
--
-- Replacement function bodies only. No tables, columns, policies or grants
-- change (CREATE OR REPLACE keeps each function's existing grants).
--
-- "Person lists" are list_kind = 'exchange' (Secret Santa / family profiles).
-- A recipient can open their own list's link, so marks there are only shown to
-- signed-in viewers who do not own the list. Kids' wish lists ('wish') keep
-- showing marks to signed-out relatives, as before; kids don't sign in.

-- Who may see marks on this list.
CREATE OR REPLACE FUNCTION private.gift_purchase_visible(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN NOT EXISTS (
      SELECT 1 FROM public.gift_lists l WHERE l.id = p_list AND l.list_kind = 'exchange'
    )
    ELSE NOT (SELECT private.viewer_owns_list(p_list))
  END;
$$;

-- Item JSON. Adds marked_by_me (only when marks are revealed) so the app can
-- offer "Put it back" to the person who marked it.
CREATE OR REPLACE FUNCTION private.gift_item_json(p_item public.gift_items, p_reveal boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', p_item.id,
    'title', p_item.title,
    'notes', p_item.notes,
    'url', p_item.url,
    'url_secondary', p_item.url_secondary,
    'image', p_item.image,
    'category', p_item.category,
    'price_label', p_item.price_label,
    'retailer', p_item.retailer,
    'age_fit', p_item.age_fit,
    'doll_size', NULLIF(p_item.doll_size, ''),
    'sort', p_item.sort,
    'availability', p_item.availability
  )) || CASE
    WHEN p_reveal THEN jsonb_build_object(
      'purchased', EXISTS (SELECT 1 FROM public.gift_claims c WHERE c.item_id = p_item.id) OR p_item.claimed_at IS NOT NULL,
      'claimed_by_name', COALESCE(
        (SELECT c.claimed_by_name FROM public.gift_claims c WHERE c.item_id = p_item.id),
        p_item.claimed_by_name
      ),
      'claimed_at', COALESCE(
        (SELECT c.claimed_at FROM public.gift_claims c WHERE c.item_id = p_item.id),
        p_item.claimed_at
      ),
      'marked_by_me', (SELECT auth.uid()) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.gift_claims c
        WHERE c.item_id = p_item.id AND c.claimed_by = (SELECT auth.uid())
      )
    )
    ELSE '{}'::jsonb
  END;
$$;

-- Mark a gift. Same rules as before, except:
--   * the list's owner gets the same neutral refusal as any failure,
--   * signed-out visitors can't mark person lists (they can't see the marks),
--   * person lists never get the legacy columns stamped, even before the
--     person claims their profile, so nothing shows up later on their side.
CREATE OR REPLACE FUNCTION private.mark_gift_purchased(p_slug text, p_item_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lst public.gift_lists;
  item public.gift_items;
  cname text;
  claim_id uuid;
BEGIN
  IF p_item_id IS NULL OR p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'List and item are required';
  END IF;

  SELECT * INTO lst FROM public.gift_lists l WHERE l.share_slug = btrim(p_slug);
  IF lst.id IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  IF private.viewer_owns_list(lst.id) THEN
    RAISE EXCEPTION 'Could not mark that gift';
  END IF;

  IF (SELECT auth.uid()) IS NULL AND lst.list_kind = 'exchange' THEN
    RAISE EXCEPTION 'Sign in to mark a gift';
  END IF;

  SELECT * INTO item
  FROM public.gift_items i
  WHERE i.id = p_item_id
    AND i.list_id = lst.id
    AND i.review_status = 'approved';

  IF item.id IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  cname := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF cname IS NOT NULL AND char_length(cname) > 80 THEN
    RAISE EXCEPTION 'Name is too long';
  END IF;

  INSERT INTO public.gift_claims (item_id, claimed_by_name, claimed_by)
  VALUES (item.id, cname, (SELECT auth.uid()))
  ON CONFLICT (item_id) DO NOTHING
  RETURNING id INTO claim_id;

  IF claim_id IS NULL THEN
    RAISE EXCEPTION 'Someone already marked that gift';
  END IF;

  -- Kid lists have no owner. Stamp the old columns so the kid iPad view keeps hiding them.
  IF lst.list_kind IS DISTINCT FROM 'exchange' AND lst.owner_user_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.gift_participants p WHERE p.list_id = lst.id AND p.user_id IS NOT NULL
  ) THEN
    UPDATE public.gift_items
    SET claimed_by_name = cname,
        claimed_at = now()
    WHERE id = item.id
      AND claimed_at IS NULL;
  END IF;

  RETURN jsonb_build_object('id', item.id, 'purchased', true);
END;
$$;

-- Undo a mark. Only the person who marked it, or a household admin (Andrew).
-- Nobody can undo on their own list, and every refusal reads the same.
CREATE OR REPLACE FUNCTION private.release_gift_purchase(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lst public.gift_lists;
  claim public.gift_claims;
BEGIN
  SELECT l.* INTO lst
  FROM public.gift_items i
  JOIN public.gift_lists l ON l.id = i.list_id
  WHERE i.id = p_item_id;

  IF lst.id IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  SELECT * INTO claim FROM public.gift_claims c WHERE c.item_id = p_item_id;

  IF (SELECT private.viewer_owns_list(lst.id)) OR NOT (
    (SELECT private.is_household_admin(lst.household_id))
    OR (claim.claimed_by IS NOT NULL AND claim.claimed_by = (SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION 'You cannot put that gift back';
  END IF;

  DELETE FROM public.gift_claims WHERE item_id = p_item_id;
  UPDATE public.gift_items
  SET claimed_by_name = NULL, claimed_at = NULL
  WHERE id = p_item_id;

  RETURN jsonb_build_object('id', p_item_id, 'purchased', false);
END;
$$;

-- Old public list read (fallback). Person lists never expose mark columns here.
CREATE OR REPLACE FUNCTION private.get_public_gift_list(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'list', jsonb_build_object(
      'id', l.id,
      'kid_key', l.kid_key,
      'display_name', l.display_name,
      'occasion', l.occasion,
      'share_slug', l.share_slug
    ),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'title', i.title,
          'notes', i.notes,
          'url', i.url,
          'url_secondary', i.url_secondary,
          'image', i.image,
          'audio', i.audio,
          'category', i.category,
          'availability', i.availability,
          'sort', i.sort,
          'claimed_by_name', CASE WHEN l.list_kind = 'exchange' THEN NULL ELSE i.claimed_by_name END,
          'claimed_at', CASE WHEN l.list_kind = 'exchange' THEN NULL ELSE i.claimed_at END,
          'review_status', i.review_status,
          'added_by', i.added_by,
          'clothing_size', i.clothing_size
        )
        ORDER BY i.sort, i.created_at
      )
      FROM public.gift_items i
      WHERE i.list_id = l.id
        AND i.review_status = 'approved'
    ), '[]'::jsonb)
  )
  INTO result
  FROM public.gift_lists l
  WHERE l.share_slug = trim(p_slug);

  RETURN result;
END;
$$;

-- Old anonymous claim. Person lists use mark_gift_purchased only.
CREATE OR REPLACE FUNCTION private.claim_gift_item(p_slug text, p_item_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lid uuid;
  kind text;
  item public.gift_items;
  cname text;
BEGIN
  IF p_item_id IS NULL OR p_slug IS NULL OR trim(p_slug) = '' THEN
    RAISE EXCEPTION 'List and item are required';
  END IF;
  SELECT l.id, l.list_kind INTO lid, kind
  FROM public.gift_lists l
  WHERE l.share_slug = trim(p_slug);
  IF lid IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF kind = 'exchange' THEN
    RAISE EXCEPTION 'Could not mark that gift';
  END IF;
  cname := NULLIF(trim(COALESCE(p_name, '')), '');
  IF cname IS NOT NULL AND char_length(cname) > 80 THEN
    RAISE EXCEPTION 'Name is too long';
  END IF;
  UPDATE public.gift_items AS g
  SET claimed_by_name = cname,
      claimed_at = now()
  WHERE g.id = p_item_id
    AND g.list_id = lid
    AND g.claimed_at IS NULL
    AND g.review_status = 'approved'
  RETURNING * INTO item;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.gift_items g
      WHERE g.id = p_item_id AND g.list_id = lid AND g.review_status = 'approved'
    ) THEN
      RAISE EXCEPTION 'Already claimed';
    END IF;
    RAISE EXCEPTION 'Item not found';
  END IF;
  RETURN jsonb_build_object(
    'id', item.id,
    'claimed_by_name', item.claimed_by_name,
    'claimed_at', item.claimed_at
  );
END;
$$;
