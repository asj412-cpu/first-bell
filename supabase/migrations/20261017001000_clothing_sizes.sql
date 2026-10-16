-- Parent-editable clothing size. Kid clothes pickers match that size.
-- 5T does not match kids numeric 5 or Abercrombie's 5/6 floor.
-- check_size stays a parent note and is not returned to the iPad.

ALTER TABLE public.household_profiles
  ADD COLUMN IF NOT EXISTS clothing_size text;

ALTER TABLE public.gift_catalog
  ADD COLUMN IF NOT EXISTS sizes text;

ALTER TABLE public.gift_items
  ADD COLUMN IF NOT EXISTS clothing_size text;

CREATE OR REPLACE FUNCTION private.clothing_size_key(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  raw text;
BEGIN
  raw := lower(btrim(COALESCE(p_value, '')));
  raw := regexp_replace(raw, 'girls''?\s*', '', 'g');
  raw := regexp_replace(raw, 'size\s*', '', 'g');
  raw := regexp_replace(raw, '\s+', '', 'g');
  RETURN raw;
END;
$$;

CREATE OR REPLACE FUNCTION private.clothing_token_covers(p_token text, p_kid text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  token text := private.clothing_size_key(p_token);
  kid text := private.clothing_size_key(p_kid);
  lo text;
  hi text;
  lo_n integer;
  hi_n integer;
  kid_n integer;
  floor_n integer;
BEGIN
  IF token = '' OR kid = '' THEN
    RETURN false;
  END IF;
  IF token = kid THEN
    RETURN true;
  END IF;
  IF token ~ '^[0-9]+/[0-9]+(\+|-up)$' THEN
    IF kid !~ '^[0-9]+$' THEN
      RETURN false;
    END IF;
    floor_n := split_part(token, '/', 1)::integer;
    RETURN kid::integer >= floor_n;
  END IF;
  IF token ~ '^[0-9]+/[0-9]+$' THEN
    RETURN kid = split_part(token, '/', 1) OR kid = split_part(token, '/', 2);
  END IF;
  IF token ~ '^[0-9]+t?-[0-9]+t?$' THEN
    lo := split_part(token, '-', 1);
    hi := split_part(token, '-', 2);
    lo_n := regexp_replace(lo, 't$', '')::integer;
    hi_n := regexp_replace(hi, 't$', '')::integer;
    IF kid ~ '^[0-9]+t$' THEN
      IF position('t' in token) = 0 THEN
        RETURN false;
      END IF;
      kid_n := regexp_replace(kid, 't$', '')::integer;
      RETURN kid_n BETWEEN LEAST(lo_n, hi_n) AND GREATEST(lo_n, hi_n);
    END IF;
    IF kid ~ '^[0-9]+$' THEN
      RETURN kid::integer BETWEEN LEAST(lo_n, hi_n) AND GREATEST(lo_n, hi_n);
    END IF;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.clothing_size_fits(p_sizes text, p_kid text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  token text;
BEGIN
  IF private.clothing_size_key(p_kid) = '' OR btrim(COALESCE(p_sizes, '')) = '' THEN
    RETURN false;
  END IF;
  FOREACH token IN ARRAY string_to_array(p_sizes, ',')
  LOOP
    IF private.clothing_token_covers(token, p_kid) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

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
      'trending', c.trending
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
    CASE WHEN product.check_size THEN 'Check size' ELSE NULL END
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
          'claimed_by_name', i.claimed_by_name,
          'claimed_at', i.claimed_at,
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

UPDATE public.household_profiles
SET clothing_size = '7'
WHERE household_id = '11111111-1111-4111-8111-111111111111'::uuid
  AND member_key = 'claire'
  AND COALESCE(clothing_size, '') = '';

UPDATE public.household_profiles
SET clothing_size = '5T'
WHERE household_id = '11111111-1111-4111-8111-111111111111'::uuid
  AND member_key = 'chloe'
  AND COALESCE(clothing_size, '') = '';

UPDATE public.gift_catalog AS c
SET sizes = v.sizes
FROM (VALUES
  ('velour-ballet-dress', '5,6,7'),
  ('puff-sleeve-sash-dress', '5,6,7'),
  ('ruffle-shoulder-ballet-dress', '5,6,7'),
  ('goodnight-pajama-set', '5,6,7'),
  ('velour-twirl-skirt', '5,6,7'),
  ('very-velour-flare-pants', '5,6,7'),
  ('party-polka-dot-velvet-twirl-dress', '5,6,7'),
  ('northern-night-plaid-tiered-tutu-dress', '5,6,7'),
  ('holiday-rose-garden-legging', '5,6,7'),
  ('holiday-red-drop-shoulder-bow-sweater', '5,6,7'),
  ('pop-stripe-sweater-beanie', '2T-5,6-10'),
  ('kids-shawl-cardigan-in-frosty-friends', '5,6-7'),
  ('kids-cardigan-in-fair-isle-hearts', '5,6-7'),
  ('kids-long-sleeve-flannel-dress-in-plaid', '5,6-7'),
  ('kids-rainbow-snowflake-fair-isle-sweater', '5,6-7'),
  ('new-york-crew-sweatshirt', '5/6+'),
  ('lace-trim-satin-top', '5/6+'),
  ('easy-crew-sweater', '5/6+'),
  ('bootcut-sweatpant', '5/6+'),
  ('kids-oversized-waffle-t-shirt', '5,6,7'),
  ('kids-recycled-mockneck-puffer-jacket', '5,6,7'),
  ('kids-cashsoft-oversized-fair-isle-sweater-dress', '5,6,7'),
  ('cozeplush-cardigan-sweater-for-girls', '5,6,7'),
  ('long-sleeve-cable-knit-sweater-for-girls', '5,6,7'),
  ('long-sleeve-graphic-t-shirt-for-girls', '5,6,7')
) AS v(slug, sizes)
WHERE c.household_id = '11111111-1111-4111-8111-111111111111'::uuid
  AND c.slug = v.slug;

REVOKE ALL ON FUNCTION private.clothing_size_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.clothing_token_covers(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.clothing_size_fits(text, text) FROM PUBLIC, anon, authenticated;
