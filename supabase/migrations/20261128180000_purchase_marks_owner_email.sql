-- Purchase marks, round 3: match the list owner by email, and always say who bought.
--
-- Replacement function bodies only. No tables, columns, policies or grants
-- change (CREATE OR REPLACE keeps each function's existing grants). Secret Santa
-- pairings, drawing state and existing marks are not touched.
--
-- 1. viewer_owns_list: a signed-in person is the owner of a list when they own
--    it, are linked to it, OR their sign-in email is the email saved for the
--    person the list belongs to (the contact email they gave when joining, or
--    the email Andrew typed on their profile). That covers the first minutes
--    after someone signs in, before their profile is linked. Every purchase
--    privacy rule (shared list read, mark, undo, claims row security) already
--    goes through this one function, so all of them now follow the email too.
--    If two people share one email, each is treated as owning the other's list,
--    which hides marks: the safe direction.
-- 2. mark_gift_purchased: when the buyer does not type a name, use the name on
--    their own family profile. If neither exists, refuse, so every mark shows
--    who bought it.
-- 3. gift_item_json: for a mark without a saved name (older marks), fall back to
--    the name on the buyer's family profile.

CREATE OR REPLACE FUNCTION private.viewer_owns_list(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.gift_lists l
    WHERE l.id = p_list
      AND (SELECT auth.uid()) IS NOT NULL
      AND (
        l.owner_user_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.gift_participants p
          WHERE p.list_id = l.id
            AND (
              p.user_id = (SELECT auth.uid())
              OR (
                COALESCE((SELECT auth.jwt() ->> 'email'), '') <> ''
                AND (
                  EXISTS (
                    SELECT 1 FROM public.gift_participant_contacts c
                    WHERE c.participant_id = p.id
                      AND lower(btrim(c.email)) = lower(btrim((SELECT auth.jwt() ->> 'email')))
                  )
                  OR EXISTS (
                    SELECT 1 FROM public.gift_profiles pr
                    WHERE pr.participant_id = p.id
                      AND lower(btrim(pr.email)) = lower(btrim((SELECT auth.jwt() ->> 'email')))
                  )
                )
              )
            )
        )
      )
  );
$$;

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
        (SELECT NULLIF(btrim(c.claimed_by_name), '') FROM public.gift_claims c WHERE c.item_id = p_item.id),
        (
          SELECT gp.display_name
          FROM public.gift_claims c
          JOIN public.gift_participants gp ON gp.user_id = c.claimed_by
          WHERE c.item_id = p_item.id
          ORDER BY gp.created_at
          LIMIT 1
        ),
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

  -- The list's owner (by link or by email) gets the same neutral refusal as any failure.
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

  IF cname IS NULL AND (SELECT auth.uid()) IS NOT NULL THEN
    SELECT NULLIF(btrim(gp.display_name), '') INTO cname
    FROM public.gift_participants gp
    WHERE gp.user_id = (SELECT auth.uid())
    ORDER BY gp.created_at
    LIMIT 1;
  END IF;

  IF cname IS NULL THEN
    RAISE EXCEPTION 'Add your name so the family knows who bought it';
  END IF;

  INSERT INTO public.gift_claims (item_id, claimed_by_name, claimed_by)
  VALUES (item.id, cname, (SELECT auth.uid()))
  ON CONFLICT (item_id) DO NOTHING
  RETURNING id INTO claim_id;

  IF claim_id IS NULL THEN
    RAISE EXCEPTION 'Someone already marked that gift';
  END IF;

  -- Kid lists have no owner. Stamp the old columns so the kid iPad view keeps hiding them.
  -- Person lists never get them stamped, so a direct read of gift_items shows an owner nothing.
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
