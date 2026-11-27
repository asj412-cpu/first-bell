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
do $$
declare tok text := 'ae99a2993b96495884001d2b254f050757d2';
 paul uuid := gen_random_uuid(); ryan uuid := gen_random_uuid(); deb uuid := gen_random_uuid(); andrew uuid;
 paul_p uuid; ryan_p uuid; deb_p uuid; ryan_l uuid; ryan_slug text; kid_slug text; kid_item uuid;
 out jsonb := '{}'; j jsonb; i1 uuid; i2 uuid; i3 uuid; n int; before text; after text;
 fails text[] := '{}';
 procedure_ok boolean;
begin
 select (select status||locked_at from public.secret_santa_events)||(select string_agg(giver_id||'>'||receiver_id, ',' order by giver_id) from public.secret_santa_assignments) into before;
 select user_id into andrew from public.gift_participants where id='77777777-7777-4777-8777-777777777701';
 select id into paul_p from public.gift_participants where display_name='Paul Quiroga';
 select id, list_id into ryan_p, ryan_l from public.gift_participants where display_name='Ryan Stalder';
 select id into deb_p from public.gift_participants where display_name='Debbie Wafford';
 select share_slug into ryan_slug from public.gift_lists where id=ryan_l;
 select l.share_slug, i.id into kid_slug, kid_item from public.gift_lists l join public.gift_items i on i.list_id=l.id
   where l.list_kind='wish' and i.review_status='approved' and i.claimed_at is null
     and not exists (select 1 from public.gift_claims c where c.item_id=i.id) limit 1;
 insert into auth.users (id, aud, role, email) values (paul,'authenticated','authenticated','sim-paul@example.invalid'),(ryan,'authenticated','authenticated','sim-ryan@example.invalid'),(deb,'authenticated','authenticated','sim-deb@example.invalid');

 -- Ryan's list gets items BEFORE Ryan claims (pre-made profile), Paul marks one then
 perform set_config('request.jwt.claims', json_build_object('sub',andrew,'role','authenticated')::text, true); set local role authenticated;
 perform public.save_managed_member_items(ryan_l, '[{"description":"R1 socks"},{"description":"R2 book"},{"description":"R3 mug"}]'::jsonb);
 reset role;
 select id into i1 from public.gift_items where list_id=ryan_l and title='R1 socks';
 select id into i2 from public.gift_items where list_id=ryan_l and title='R2 book';
 select id into i3 from public.gift_items where list_id=ryan_l and title='R3 mug';

 perform set_config('request.jwt.claims', json_build_object('sub',paul,'role','authenticated')::text, true); set local role authenticated;
 perform public.claim_gift_profile(tok, paul_p);
 perform public.mark_gift_purchased(ryan_slug, i1, 'Paul');   -- before Ryan claims
 reset role;
 select count(*) into n from public.gift_items where id=i1 and claimed_at is not null;
 out := out || jsonb_build_object('legacy_stamp_on_person_list', n);
 if n <> 0 then fails := fails || 'legacy stamp on person list'; end if;

 perform set_config('request.jwt.claims', json_build_object('sub',ryan,'role','authenticated')::text, true); set local role authenticated;
 perform public.claim_gift_profile(tok, ryan_p); reset role;
 perform set_config('request.jwt.claims', json_build_object('sub',deb,'role','authenticated')::text, true); set local role authenticated;
 perform public.claim_gift_profile(tok, deb_p); reset role;

 -- (a) Paul marks a second, sees marked_by_me, undoes one from either page's data
 perform set_config('request.jwt.claims', json_build_object('sub',paul,'role','authenticated')::text, true); set local role authenticated;
 perform public.mark_gift_purchased(ryan_slug, i2, 'Paul');
 j := public.get_my_assignment();
 out := out || jsonb_build_object('a_paul_assignment', (select jsonb_agg((x->>'title')||' purchased='||coalesce(x->>'purchased','-')||' mine='||coalesce(x->>'marked_by_me','-')) from jsonb_array_elements(j->'receiver'->'list'->'items') x));
 if (select count(*) from jsonb_array_elements(j->'receiver'->'list'->'items') x where (x->>'marked_by_me')::boolean) <> 2 then fails := fails || 'paul marked_by_me'; end if;
 perform public.release_gift_purchase(i1);
 j := public.get_shared_gift_list(ryan_slug);
 out := out || jsonb_build_object('a_paul_linkpage_after_undo', (select jsonb_agg((x->>'title')||' purchased='||coalesce(x->>'purchased','-')||' mine='||coalesce(x->>'marked_by_me','-')) from jsonb_array_elements(j->'items') x));
 if (select count(*) from jsonb_array_elements(j->'items') x where (x->>'purchased')::boolean) <> 1 then fails := fails || 'paul undo'; end if;
 reset role;

 -- (a) Debbie sees Paul's mark, not as hers, cannot undo it
 perform set_config('request.jwt.claims', json_build_object('sub',deb,'role','authenticated')::text, true); set local role authenticated;
 j := public.get_shared_gift_list(ryan_slug);
 out := out || jsonb_build_object('a_debbie_view', (select jsonb_agg((x->>'title')||' purchased='||coalesce(x->>'purchased','-')||' mine='||coalesce(x->>'marked_by_me','-')) from jsonb_array_elements(j->'items') x));
 if (select count(*) from jsonb_array_elements(j->'items') x where (x->>'marked_by_me')::boolean) <> 0 then fails := fails || 'debbie marked_by_me'; end if;
 begin perform public.release_gift_purchase(i2); fails := fails || 'debbie undid pauls'; exception when others then out := out || jsonb_build_object('a_debbie_undo', sqlerrm); end;
 reset role;

 -- (a) Andrew (admin) can undo someone else's mark
 perform set_config('request.jwt.claims', json_build_object('sub',andrew,'role','authenticated')::text, true); set local role authenticated;
 perform public.mark_gift_purchased(ryan_slug, i3, 'Andrew');
 reset role;
 perform set_config('request.jwt.claims', json_build_object('sub',paul,'role','authenticated')::text, true); set local role authenticated;
 begin perform public.release_gift_purchase(i3); fails := fails || 'paul undid andrews'; exception when others then null; end;
 reset role;
 perform set_config('request.jwt.claims', json_build_object('sub',andrew,'role','authenticated')::text, true); set local role authenticated;
 perform public.release_gift_purchase(i3);
 out := out || jsonb_build_object('a_admin_undo_ok', true);
 reset role;

 -- (b) signed-out viewer of a person list: plain list, cannot mark
 perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
 j := public.get_shared_gift_list(ryan_slug);
 out := out || jsonb_build_object('b_anon_person_list', jsonb_build_object('visible', j->'purchases_visible', 'items', (select jsonb_agg((x->>'title')||' purchased='||coalesce(x->>'purchased','hidden')) from jsonb_array_elements(j->'items') x)));
 if (j->>'purchases_visible')::boolean or exists (select 1 from jsonb_array_elements(j->'items') x where x ? 'purchased') then fails := fails || 'anon sees marks'; end if;
 j := public.get_public_gift_list(ryan_slug);
 if exists (select 1 from jsonb_array_elements(j->'items') x where x->>'claimed_at' is not null) then fails := fails || 'fallback leaks'; end if;
 begin perform public.mark_gift_purchased(ryan_slug, i3, 'x'); fails := fails || 'anon marked person list'; exception when others then out := out || jsonb_build_object('b_anon_mark', sqlerrm); end;
 begin perform public.claim_gift_item(ryan_slug, i2, 'x'); fails := fails || 'anon legacy claim'; exception when others then out := out || jsonb_build_object('b_anon_legacy_claim_on_marked', sqlerrm); end;
 begin perform public.claim_gift_item(ryan_slug, i3, 'x'); fails := fails || 'anon legacy claim'; exception when others then out := out || jsonb_build_object('b_anon_legacy_claim_on_unmarked', sqlerrm); end;
 -- kids' wish list unchanged for signed-out relatives
 perform public.mark_gift_purchased(kid_slug, kid_item, 'Grandma');
 j := public.get_shared_gift_list(kid_slug);
 out := out || jsonb_build_object('b_anon_kid_list_visible', j->'purchases_visible', 'b_anon_kid_item_marked', (select x->'purchased' from jsonb_array_elements(j->'items') x where (x->>'id')::uuid = kid_item));
 if not (j->>'purchases_visible')::boolean then fails := fails || 'kid list hidden from anon'; end if;
 reset role;

 -- (c) Ryan: neutral answers on his own list, marked or not
 perform set_config('request.jwt.claims', json_build_object('sub',ryan,'role','authenticated')::text, true); set local role authenticated;
 begin perform public.mark_gift_purchased(ryan_slug, i2, 'r'); fails := fails || 'ryan marked own'; exception when others then out := out || jsonb_build_object('c_ryan_mark_marked_item', sqlerrm); end;
 begin perform public.mark_gift_purchased(ryan_slug, i3, 'r'); fails := fails || 'ryan marked own'; exception when others then out := out || jsonb_build_object('c_ryan_mark_unmarked_item', sqlerrm); end;
 begin perform public.release_gift_purchase(i2); fails := fails || 'ryan released own'; exception when others then out := out || jsonb_build_object('c_ryan_undo_marked', sqlerrm); end;
 begin perform public.release_gift_purchase(i3); fails := fails || 'ryan released own'; exception when others then out := out || jsonb_build_object('c_ryan_undo_unmarked', sqlerrm); end;
 j := public.get_shared_gift_list(ryan_slug);
 if (j->>'purchases_visible')::boolean or exists (select 1 from jsonb_array_elements(j->'items') x where x ? 'purchased' or x ? 'marked_by_me') then fails := fails || 'ryan sees marks'; end if;
 j := public.get_my_gift_lists();
 if exists (select 1 from jsonb_array_elements(j->0->'items') x where x ? 'purchased') then fails := fails || 'ryan my lists marks'; end if;
 reset role;
 -- Andrew cannot undo on his own list either (he's a recipient)
 select (select status||locked_at from public.secret_santa_events)||(select string_agg(giver_id||'>'||receiver_id, ',' order by giver_id) from public.secret_santa_assignments) into after;
 if before is distinct from after then fails := fails || 'santa changed'; end if;
 out := out || jsonb_build_object('FAILS', to_jsonb(fails));
 raise exception 'ROLLBACK_OK %', out;
end $$;
