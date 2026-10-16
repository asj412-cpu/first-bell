-- Retailer picks. Clothing sizes are not verified, so check_size is a parent note only.
-- The kid catalog does not return this flag.

ALTER TABLE public.gift_catalog
  ADD COLUMN IF NOT EXISTS check_size boolean NOT NULL DEFAULT false;

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
  product public.gift_catalog;
  existing public.gift_items;
  next_sort integer;
  item_id uuid;
  note text;
BEGIN
  IF NOT private.kid_secret_ok(p_secret) OR p_catalog_id IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  v_hash := private.kid_digest(p_secret);
  IF private.kid_rate_count('wish10:' || v_hash, interval '10 minutes') >= 8
     OR private.kid_rate_count('wishday:' || v_hash, interval '1 day') >= 40 THEN
    RAISE EXCEPTION 'Slow down';
  END IF;

  SELECT l.id, private.kid_years(p.birth_date)
  INTO lid, years
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
    NULLIF(trim(COALESCE(product.retailer, '')), ''),
    CASE
      WHEN product.price IS NULL THEN NULL
      WHEN product.price = trunc(product.price) THEN '$' || trunc(product.price)::integer::text
      ELSE '$' || trim(to_char(product.price, 'FM999990.00'))
    END,
    CASE WHEN product.in_stock THEN NULL ELSE 'Ask a grown-up' END,
    CASE WHEN product.check_size THEN 'Check size' ELSE NULL END
  ), '');

  SELECT COALESCE(MAX(i.sort), -1) + 1 INTO next_sort
  FROM public.gift_items i
  WHERE i.list_id = lid;

  INSERT INTO public.gift_items (
    list_id, title, notes, url, image, category, sort, review_status, added_by, catalog_id
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
    product.id
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
    'sort', next_sort,
    'review_status', 'pending',
    'added_by', 'kid',
    'already', false
  );
END;
$$;

INSERT INTO public.gift_catalog (
  id, household_id, slug, name, category, age_fit, retailer, price, url, image, active, in_stock, trending, check_size, sort
)
VALUES
  ('a4b8ff44-c231-580e-b603-71d341571fc8'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'new-york-crew-sweatshirt', 'new york crew sweatshirt', 'clothes', '5-7', 'Abercrombie Kids', 37.46, 'https://www.abercrombie.com/shop/us/kids/p/new-york-crew-sweatshirt-63820923', '/catalog/new-york-crew-sweatshirt.jpg', true, true, false, true, 62),
  ('fe043094-2615-5af1-8228-457cd95b6c0b'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'lace-trim-satin-top', 'lace-trim satin top', 'clothes', '5-7', 'Abercrombie Kids', 29.96, 'https://www.abercrombie.com/shop/us/kids/p/lace-trim-satin-top-63820921', '/catalog/lace-trim-satin-top.jpg', true, true, false, true, 63),
  ('08952d84-61bc-5b2f-aef8-4a52d827ed74'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'easy-crew-sweater', 'easy crew sweater', 'clothes', '5-7', 'Abercrombie Kids', 33.71, 'https://www.abercrombie.com/shop/us/kids/p/easy-crew-sweater-63590319', '/catalog/easy-crew-sweater.jpg', true, true, false, true, 64),
  ('aa8e7ba7-0a61-5990-8478-b9461dfa4fcd'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'bootcut-sweatpant', 'bootcut sweatpant', 'clothes', '5-7', 'Abercrombie Kids', 26.97, 'https://www.abercrombie.com/shop/us/kids/p/bootcut-sweatpant-63751908', '/catalog/bootcut-sweatpant.jpg', true, true, false, true, 65),
  ('7a2d4b5a-32eb-59b0-b0c4-b99ceca623a7'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kids-oversized-waffle-t-shirt', 'Kids Oversized Waffle T-Shirt', 'clothes', '5-7', 'Gap Kids', 24.95, 'https://www.gap.com/browse/product.do?pid=911663032&vid=1&pcid=1127946&cid=1127946', '/catalog/kids-oversized-waffle-t-shirt.jpg', true, true, false, true, 66),
  ('f5624b2e-d311-5855-9725-d01b740f7118'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kids-recycled-mockneck-puffer-jacket', 'Kids Recycled Mockneck Puffer Jacket', 'clothes', '5-7', 'Gap Kids', 98.00, 'https://www.gap.com/browse/product.do?pid=1185779012&vid=1&pcid=1127946&cid=1127946', '/catalog/kids-recycled-mockneck-puffer-jacket.jpg', true, true, false, true, 67),
  ('aadaf32c-3f93-59b8-abb4-f99cdcead68f'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kids-cashsoft-oversized-fair-isle-sweater-dress', 'Kids CashSoft Oversized Fair Isle Sweater Dress', 'clothes', '5-7', 'Gap Kids', 59.95, 'https://www.gap.com/browse/product.do?pid=1184971012&vid=1&pcid=1127946&cid=1127946', '/catalog/kids-cashsoft-oversized-fair-isle-sweater-dress.jpg', true, true, false, true, 68),
  ('4a061ae0-cc7b-53bf-a3df-8fa8845e538c'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'cozeplush-cardigan-sweater-for-girls', 'CozePlush Cardigan Sweater for Girls', 'clothes', '5-7', 'Old Navy', 12.00, 'https://oldnavy.gap.com/browse/product.do?pid=903878022&vid=1&pcid=1185229&cid=1185229', '/catalog/cozeplush-cardigan-sweater-for-girls.jpg', true, true, false, true, 69),
  ('07c5f4f5-3aca-5f29-80a2-0d0ee562aa0d'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'long-sleeve-cable-knit-sweater-for-girls', 'Long-Sleeve Cable-Knit Sweater for Girls', 'clothes', '5-7', 'Old Navy', 14.99, 'https://oldnavy.gap.com/browse/product.do?pid=903200032&vid=1&pcid=1185229&cid=1185229', '/catalog/long-sleeve-cable-knit-sweater-for-girls.jpg', true, true, false, true, 70),
  ('acc9c88e-d223-5cb0-ac5c-07b40b21cd61'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'long-sleeve-graphic-t-shirt-for-girls', 'Long-Sleeve Graphic T-Shirt for Girls', 'clothes', '5-7', 'Old Navy', 6.49, 'https://oldnavy.gap.com/browse/product.do?pid=906172002&vid=1&pcid=1185229&cid=1185229', '/catalog/long-sleeve-graphic-t-shirt-for-girls.jpg', true, true, false, true, 71),
  ('a24d79ff-ceb3-5b7d-ac88-9cefb8822515'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'hot-wheels-rc-barbie-ford-bronco-remote-control-toy-car', 'Hot Wheels RC Barbie Ford Bronco, Remote-Control Toy Car', 'toys', '5-7', 'Amazon', 40.97, 'https://www.amazon.com/dp/B0G1V17DQR', '/catalog/hot-wheels-rc-barbie-ford-bronco-remote-control-toy-car.jpg', true, true, false, false, 72),
  ('0bf69006-675c-5f0e-a2a3-3fc11c099bbc'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'hot-wheels-barbie-rc-toy-car-remote-control-pink-convertible', 'Hot Wheels Barbie RC Toy Car, Remote-Control Pink Convertible', 'toys', '5-7', 'Amazon', 32.99, 'https://www.amazon.com/dp/B0D7PTHTGW', '/catalog/hot-wheels-barbie-rc-toy-car-remote-control-pink-convertible.jpg', true, true, false, false, 73),
  ('b589ec19-d7f6-5aa8-847a-7bf1f9dc9778'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'little-live-pets-mama-surprise-kittens-interactive-mama-surp', 'Little Live Pets Mama Surprise Kittens, Interactive Mama, Surprise Toys', 'toys', '5-7', 'Amazon', 19.97, 'https://www.amazon.com/dp/B0GBY1S3VG', '/catalog/little-live-pets-mama-surprise-kittens-interactive-mama-surp.jpg', true, true, false, false, 74),
  ('ce6e8afa-31f8-532e-92a4-6e5222846ccc'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'led-drawing-board-for-girls-arts-gifts-kit-and-crafts-toys-f', 'LED Drawing Board for Girls, Arts Gifts Kit and Crafts Toys for 3+ Year Old', 'toys', '5-7', 'Amazon', 15.29, 'https://www.amazon.com/dp/B0GDCX74KL', '/catalog/led-drawing-board-for-girls-arts-gifts-kit-and-crafts-toys-f.jpg', true, true, false, false, 75)
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
  sort = EXCLUDED.sort;
