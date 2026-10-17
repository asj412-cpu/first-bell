-- Doll clothes are their own category. They are not filtered by a kid's clothing size.
-- doll_size drives the baby-doll and bigger-doll chips. The fit note is for parents.

ALTER TABLE public.gift_catalog
  ADD COLUMN IF NOT EXISTS doll_size text,
  ADD COLUMN IF NOT EXISTS doll_fit_note text;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'gift_catalog'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%category%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.gift_catalog DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.gift_catalog
  DROP CONSTRAINT IF EXISTS gift_catalog_category_check;
ALTER TABLE public.gift_catalog
  ADD CONSTRAINT gift_catalog_category_check
  CHECK (category IN ('toys', 'clothes', 'learning', 'dolls'));

ALTER TABLE public.gift_catalog
  DROP CONSTRAINT IF EXISTS gift_catalog_doll_size_check;
ALTER TABLE public.gift_catalog
  ADD CONSTRAINT gift_catalog_doll_size_check
  CHECK (doll_size IS NULL OR doll_size IN ('baby', 'toddler'));

CREATE OR REPLACE FUNCTION private.get_kid_catalog(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  v_hash text;
BEGIN
  IF NOT private.kid_secret_ok(p_secret) THEN
    RETURN '[]'::jsonb;
  END IF;

  v_hash := private.kid_digest(p_secret);
  IF private.kid_rate_count('read:' || v_hash, interval '1 minute') >= 60 THEN
    RETURN '[]'::jsonb;
  END IF;
  PERFORM private.kid_rate_bump('read:' || v_hash, interval '1 minute');

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'category', c.category,
      'image', c.image,
      'age_fit', c.age_fit,
      'in_stock', c.in_stock,
      'trending', c.trending,
      'doll_size', c.doll_size
    )
    ORDER BY c.sort, c.name
  ), '[]'::jsonb)
  INTO result
  FROM public.gift_kid_links k
  JOIN public.gift_lists l ON l.id = k.list_id
  JOIN public.gift_catalog c ON c.household_id = l.household_id AND c.active
  LEFT JOIN public.household_profiles p
    ON p.household_id = l.household_id
   AND p.member_key = l.kid_key
  WHERE k.secret_hash = v_hash
    AND k.revoked_at IS NULL
    AND private.catalog_age_fits(c.age_fit, private.kid_years(p.birth_date))
    AND (
      c.category IS DISTINCT FROM 'clothes'
      OR private.clothing_size_fits(c.sizes, p.clothing_size)
    );

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION private.add_kid_catalog_wish(p_secret text, p_catalog_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash text;
  lid uuid;
  years integer;
  v_size text;
  product public.gift_catalog;
  existing public.gift_items;
  next_sort integer;
  item_id uuid;
  note text;
  saved_size text;
BEGIN
  IF NOT private.kid_secret_ok(p_secret) OR p_catalog_id IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  v_hash := private.kid_digest(p_secret);
  IF private.kid_rate_count('wish10:' || v_hash, interval '10 minutes') >= 8
     OR private.kid_rate_count('wishday:' || v_hash, interval '1 day') >= 40 THEN
    RAISE EXCEPTION 'Slow down';
  END IF;

  SELECT l.id, private.kid_years(p.birth_date), p.clothing_size
  INTO lid, years, v_size
  FROM public.gift_kid_links k
  JOIN public.gift_lists l ON l.id = k.list_id
  LEFT JOIN public.household_profiles p
    ON p.household_id = l.household_id
   AND p.member_key = l.kid_key
  WHERE k.secret_hash = v_hash
    AND k.revoked_at IS NULL;

  IF lid IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  SELECT * INTO product
  FROM public.gift_catalog c
  WHERE c.id = p_catalog_id
    AND c.active
    AND c.household_id = (
      SELECT l.household_id FROM public.gift_lists l WHERE l.id = lid
    );

  IF product.id IS NULL OR NOT private.catalog_age_fits(product.age_fit, years) THEN
    RAISE EXCEPTION 'Picture is not allowed';
  END IF;
  IF product.category = 'clothes' AND NOT private.clothing_size_fits(product.sizes, v_size) THEN
    RAISE EXCEPTION 'Picture is not allowed';
  END IF;

  SELECT * INTO existing
  FROM public.gift_items i
  WHERE i.list_id = lid
    AND i.catalog_id = product.id
    AND i.claimed_at IS NULL
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', existing.id,
      'title', existing.title,
      'url', existing.url,
      'image', existing.image,
      'catalog_id', existing.catalog_id,
      'review_status', existing.review_status,
      'already', true
    );
  END IF;

  note := NULLIF(concat_ws(' · ',
    NULLIF(btrim(COALESCE(product.retailer, '')), ''),
    CASE
      WHEN product.price IS NULL THEN NULL
      WHEN product.price = trunc(product.price) THEN '$' || trunc(product.price)::integer::text
      ELSE '$' || trim(to_char(product.price, 'FM999990.00'))
    END,
    CASE WHEN product.in_stock THEN NULL ELSE 'Ask a grown-up' END,
    CASE WHEN product.check_size THEN 'Check size' ELSE NULL END,
    CASE WHEN product.category = 'dolls' THEN NULLIF(btrim(COALESCE(product.doll_fit_note, '')), '') ELSE NULL END
  ), '');

  saved_size := CASE
    WHEN product.category = 'clothes' THEN NULLIF(btrim(COALESCE(v_size, '')), '')
    ELSE NULL
  END;

  SELECT COALESCE(MAX(i.sort), -1) + 1 INTO next_sort
  FROM public.gift_items i
  WHERE i.list_id = lid;

  INSERT INTO public.gift_items (
    list_id, title, notes, url, image, category, sort, review_status, added_by, catalog_id, clothing_size
  )
  VALUES (
    lid,
    left(product.name, 160),
    note,
    NULLIF(product.url, ''),
    NULLIF(product.image, ''),
    product.category,
    next_sort,
    'pending',
    'kid',
    product.id,
    saved_size
  )
  RETURNING id INTO item_id;

  PERFORM private.kid_rate_bump('wish10:' || v_hash, interval '10 minutes');
  PERFORM private.kid_rate_bump('wishday:' || v_hash, interval '1 day');

  RETURN jsonb_build_object(
    'id', item_id,
    'title', left(product.name, 160),
    'notes', note,
    'url', NULLIF(product.url, ''),
    'image', NULLIF(product.image, ''),
    'category', product.category,
    'catalog_id', product.id,
    'clothing_size', saved_size,
    'sort', next_sort,
    'review_status', 'pending',
    'added_by', 'kid',
    'already', false
  );
END;
$$;


INSERT INTO public.gift_catalog (
  id, household_id, slug, name, category, age_fit, retailer, price, url, image, active, in_stock, trending, check_size, sizes, doll_size, doll_fit_note, sort
)
VALUES
  ('73ec84a2-6fd7-5b63-afbe-4fabb102b6c1'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-12-15-baby-doll-outfit-set', 'JC Toys Pink Elephant 4-Piece Baby Doll Outfit (fits 12–15 in. baby dolls)', 'dolls', 'both', 'JC Toys', 9.99, 'https://www.jctoys.com/products/jc-toys-pink-elephant-4-piece-doll-outfit-hat-top-diaper-and-booties-set-fits-12-15-dolls-soft-fabric-easy-velcro-closure', '/catalog/doll-12-15-baby-doll-outfit-set.jpg', true, true, false, false, '', 'baby', 'Fits 12-15 in. baby dolls', 86),
  ('444a3678-4d72-5355-9ccf-aba1a8a7a694'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-jc-toys-blue-bear-onesie-baby-doll-outfit-hat-pacifier-', 'JC Toys Lots to Cuddle Blue Bear Onesie, Hat & Pacifier (fits 12–14 in. baby dolls)', 'dolls', 'both', 'JC Toys', 12.99, 'https://www.jctoys.com/products/lots-to-cuddle-13-clothing-in-blue', '/catalog/doll-jc-toys-blue-bear-onesie-baby-doll-outfit-hat-pacifier-.jpg', true, true, false, false, '', 'baby', 'Fits 12-14 in. baby dolls', 87),
  ('8dbd676b-b381-59b3-8f92-7d3b1fb95dc6'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-berenguer-pink-striped-tulle-dress', 'Berenguer Boutique Pink Striped Tulle Dress, Shorts, Headband & Booties (fits 14–18 in. dolls)', 'dolls', 'both', 'JC Toys', 12.99, 'https://www.jctoys.com/products/jc-toys-berenguer-boutique-baby-doll-outfit-pink-striped-dress-with-tulle-skirt', '/catalog/doll-berenguer-pink-striped-tulle-dress.jpg', true, true, false, false, '', 'toddler', 'Fits 14-18 in. baby/toddler dolls (Berenguer Boutique)', 88),
  ('ad85aa93-5eec-5164-837b-cd72b538349d'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-berenguer-pink-stripe-overall-shorts', 'Berenguer Boutique Pink Stripe Overall Shorts, Headband & Booties (fits 14–18 in. dolls)', 'dolls', 'both', 'JC Toys', 12.99, 'https://www.jctoys.com/products/jc-toys-berenguer-boutique-baby-doll-outfit-pink-stripes-and-white-overall-shorts-includes-headband-and-bootiesjc-toys-berenguer-boutique-baby-doll-outfit-pink-stripes-and-white-overall-shorts', '/catalog/doll-berenguer-pink-stripe-overall-shorts.jpg', true, true, false, false, '', 'toddler', 'Fits 14-18 in. baby/toddler dolls (Berenguer Boutique)', 89),
  ('6cad7b10-d5cb-5097-906d-949e34465505'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-berenguer-boutique-fashion-clothing-for-14-16-dolls-hot', 'Berenguer Boutique Hot Pink Stripe 2-Piece Romper (fits 13–16 in. baby dolls)', 'dolls', 'both', 'JC Toys', 12.99, 'https://www.jctoys.com/products/hot-pink-romper-for-13-16-dolls', '/catalog/doll-berenguer-boutique-fashion-clothing-for-14-16-dolls-hot.jpg', true, true, false, false, '', 'baby', 'Fits 13-16 in. baby dolls', 90),
  ('1990fdf5-d982-5f91-8f4b-f0754861f3bd'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-for-keeps-clothing-for-15-dolls-special-bedtime-set', 'For Keeps! Special Bedtime Pink Pajama Set (fits 14–16 in. baby dolls)', 'dolls', 'both', 'JC Toys', 9.99, 'https://www.jctoys.com/products/for-keeps-clothing-for-15-dolls-special-bedtime-set', '/catalog/doll-for-keeps-clothing-for-15-dolls-special-bedtime-set.jpg', true, true, false, false, '', 'baby', 'Fits 14-16 in. baby dolls', 91),
  ('fa5b8a7a-b6ad-506a-8aff-1dfb1be9c205'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-mine-to-love-mix-match-playtime-doll-clothes', 'Mine to Love Mix & Match Playtime Doll Clothes, 6 pieces (fits 12–18 in. dolls)', 'dolls', 'both', 'Melissa & Doug', 30.99, 'https://www.melissaanddoug.com/products/mine-to-love-mix-match-playtime-doll-clothes', '/catalog/doll-mine-to-love-mix-match-playtime-doll-clothes.jpg', true, true, false, false, '', 'baby', 'Fits 12-18 in. dolls (Mine to Love 12 in. babies)', 92),
  ('10213509-34aa-5864-a883-623015b880b8'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-american-girl-x-j-crew-bubble-skirt-party-outfit-for-bi', 'American Girl x J.Crew Bubble-Skirt Party Outfit (fits 15 in. Bitty Baby)', 'dolls', 'both', 'American Girl', 40.0, 'https://www.americangirl.com/products/american-girl-x-j-crew-bubble-skirt-party-outfit-for-bitty-baby-dolls-jnl20', '/catalog/doll-american-girl-x-j-crew-bubble-skirt-party-outfit-for-bi.jpg', true, true, false, false, '', 'toddler', 'Fits 15 in. Bitty Baby / toddler dolls', 93),
  ('7f721778-f899-5e55-88f1-44c0a5a09436'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-american-girl-x-hanna-andersson-berry-bright-stars-paja', 'American Girl x Hanna Andersson Berry Bright Stars Pajamas (fits 15 in. Bitty Baby)', 'dolls', 'both', 'American Girl', 40.0, 'https://www.americangirl.com/products/american-girl-x-hanna-andersson-berry-bright-stars-pajamas-for-bitty-baby-dolls-jnl94', '/catalog/doll-american-girl-x-hanna-andersson-berry-bright-stars-paja.jpg', true, true, false, false, '', 'toddler', 'Fits 15 in. Bitty Baby / toddler dolls', 94),
  ('df6f35c9-a8b7-566d-af84-57f2383b7eef'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-rainbow-corduroy-outfit-for-bitty-baby-dolls', 'Rainbow Corduroy Outfit (fits 15 in. Bitty Baby)', 'dolls', 'both', 'American Girl', 30.0, 'https://www.americangirl.com/products/rainbow-corduroy-outfit-for-bitty-baby-dolls-jly52', '/catalog/doll-rainbow-corduroy-outfit-for-bitty-baby-dolls.jpg', true, true, false, false, '', 'toddler', 'Fits 15 in. Bitty Baby / toddler dolls', 95),
  ('62a876ce-097d-52ed-b7c3-6dcd66c192bf'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-playful-pink-bunny-one-piece-outfit-for-bitty-baby-doll', 'Playful Pink Bunny One-Piece Outfit (fits 15 in. Bitty Baby)', 'dolls', 'both', 'American Girl', 42.0, 'https://www.americangirl.com/products/playful-pink-bunny-one-piece-outfit-for-bitty-baby-dolls-jdc69', '/catalog/doll-playful-pink-bunny-one-piece-outfit-for-bitty-baby-doll.jpg', true, true, false, false, '', 'toddler', 'Fits 15 in. Bitty Baby / toddler dolls', 96),
  ('c3bd42e7-5b96-5dcc-80d1-ebe71ea94566'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'doll-adora-adoption-fashion-pig-out-baby-doll-clothes-set-fo', 'Adora “Pig Out” Doll Clothes Set (fits 16 in. dolls)', 'dolls', 'both', 'Adora', 18.99, 'https://adora.com/products/baby-doll-clothes-adoption-fashion-pig-out', '/catalog/doll-adora-adoption-fashion-pig-out-baby-doll-clothes-set-fo.jpg', true, true, false, false, '', 'toddler', 'Fits 16 in. Adora / toddler dolls', 97)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  age_fit = EXCLUDED.age_fit,
  retailer = EXCLUDED.retailer,
  price = EXCLUDED.price,
  url = EXCLUDED.url,
  image = EXCLUDED.image,
  active = EXCLUDED.active,
  in_stock = EXCLUDED.in_stock,
  trending = EXCLUDED.trending,
  check_size = EXCLUDED.check_size,
  sizes = EXCLUDED.sizes,
  doll_size = EXCLUDED.doll_size,
  doll_fit_note = EXCLUDED.doll_fit_note,
  sort = EXCLUDED.sort;
