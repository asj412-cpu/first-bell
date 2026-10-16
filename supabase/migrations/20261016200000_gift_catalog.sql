-- Picture catalog for the kid iPad. Placeholder rows until the real catalog arrives.
-- Anon cannot read the table. A kid token receives only active rows that fit that kid's age.

CREATE TABLE IF NOT EXISTS public.gift_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  category text NOT NULL CHECK (category IN ('toys', 'clothes', 'learning')),
  age_fit text NOT NULL CHECK (age_fit ~ '^[0-9]+(-[0-9]+)?$'),
  retailer text,
  price numeric(10, 2),
  url text,
  image text,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_catalog_household_idx
  ON public.gift_catalog (household_id, active, sort);

ALTER TABLE public.gift_items
  ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES public.gift_catalog (id) ON DELETE SET NULL;

ALTER TABLE public.gift_catalog ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gift_catalog FROM PUBLIC;
REVOKE ALL ON TABLE public.gift_catalog FROM anon;
REVOKE ALL ON TABLE public.gift_catalog FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gift_catalog TO authenticated;

DROP POLICY IF EXISTS gift_catalog_member_all ON public.gift_catalog;
CREATE POLICY gift_catalog_member_all
  ON public.gift_catalog
  FOR ALL
  TO authenticated
  USING ((SELECT private.is_household_member(household_id)))
  WITH CHECK ((SELECT private.is_household_member(household_id)));

CREATE OR REPLACE FUNCTION private.kid_years(p_birth date)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_birth IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM age(
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date,
      p_birth
    ))::integer
  END;
$$;

CREATE OR REPLACE FUNCTION private.catalog_age_fits(p_fit text, p_years integer)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  fit text := regexp_replace(COALESCE(p_fit, ''), '\s', '', 'g');
  lo integer;
  hi integer;
BEGIN
  IF p_years IS NULL OR fit = '' THEN
    RETURN false;
  END IF;
  IF fit ~ '^[0-9]+$' THEN
    RETURN p_years = fit::integer;
  END IF;
  IF fit ~ '^[0-9]+-[0-9]+$' THEN
    lo := split_part(fit, '-', 1)::integer;
    hi := split_part(fit, '-', 2)::integer;
    RETURN p_years BETWEEN LEAST(lo, hi) AND GREATEST(lo, hi);
  END IF;
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
      'age_fit', c.age_fit
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
    AND private.catalog_age_fits(c.age_fit, private.kid_years(p.birth_date));

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
    END
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

-- Include the catalog id so a filled heart can match a picture already chosen.
CREATE OR REPLACE FUNCTION private.get_kid_gift_list(p_secret text)
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
    RETURN NULL;
  END IF;

  v_hash := private.kid_digest(p_secret);
  IF private.kid_rate_count('read:' || v_hash, interval '1 minute') >= 60 THEN
    RETURN NULL;
  END IF;
  PERFORM private.kid_rate_bump('read:' || v_hash, interval '1 minute');

  SELECT jsonb_build_object(
    'list', jsonb_build_object(
      'id', l.id,
      'kid_key', l.kid_key,
      'display_name', l.display_name,
      'occasion', l.occasion
    ),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'title', i.title,
          'notes', i.notes,
          'image', i.image,
          'audio', i.audio,
          'category', i.category,
          'sort', i.sort,
          'review_status', i.review_status,
          'added_by', i.added_by,
          'catalog_id', i.catalog_id
        )
        ORDER BY i.sort, i.created_at
      )
      FROM public.gift_items i
      WHERE i.list_id = l.id
        AND i.claimed_at IS NULL
        AND (
          i.review_status = 'approved'
          OR (i.review_status = 'pending' AND i.added_by = 'kid')
        )
    ), '[]'::jsonb)
  )
  INTO result
  FROM public.gift_kid_links k
  JOIN public.gift_lists l ON l.id = k.list_id
  WHERE k.secret_hash = v_hash
    AND k.revoked_at IS NULL;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_kid_catalog(p_secret text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_kid_catalog(p_secret);
$$;

CREATE OR REPLACE FUNCTION public.add_kid_catalog_wish(p_secret text, p_catalog_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.add_kid_catalog_wish(p_secret, p_catalog_id);
$$;

REVOKE ALL ON FUNCTION private.kid_years(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.catalog_age_fits(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_kid_catalog(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.add_kid_catalog_wish(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kid_catalog(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_kid_catalog_wish(text, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION private.get_kid_catalog(text) FROM anon;
REVOKE ALL ON FUNCTION private.add_kid_catalog_wish(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_kid_catalog(text) FROM anon;
REVOKE ALL ON FUNCTION public.add_kid_catalog_wish(text, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION private.get_kid_catalog(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.add_kid_catalog_wish(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_kid_catalog(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_kid_catalog_wish(text, uuid) TO anon, authenticated;

INSERT INTO public.gift_catalog (id, household_id, name, category, age_fit, retailer, price, url, image, active, sort)
VALUES
  ('66666666-6666-4666-8666-666666666601', '11111111-1111-4111-8111-111111111111', 'Wooden train', 'toys', '2-6', 'Target', 28, 'https://www.target.com/s?searchTerm=wooden+train', '/catalog/train.jpg', true, 0),
  ('66666666-6666-4666-8666-666666666602', '11111111-1111-4111-8111-111111111111', 'Dollhouse', 'toys', '4-8', 'Target', 45, 'https://www.target.com/s?searchTerm=dollhouse', '/catalog/dollhouse.jpg', true, 1),
  ('66666666-6666-4666-8666-666666666603', '11111111-1111-4111-8111-111111111111', 'Baby rattle', 'toys', '0-1', 'Target', 8, 'https://www.target.com/s?searchTerm=baby+rattle', '/catalog/rattle.jpg', true, 2),
  ('66666666-6666-4666-8666-666666666604', '11111111-1111-4111-8111-111111111111', 'Rain boots', 'clothes', '4-8', 'Target', 22, 'https://www.target.com/s?searchTerm=kids+rain+boots', '/catalog/boots.jpg', true, 3),
  ('66666666-6666-4666-8666-666666666605', '11111111-1111-4111-8111-111111111111', 'Soft sleeper', 'clothes', '0-1', 'Target', 16, 'https://www.target.com/s?searchTerm=baby+sleeper', '/catalog/sleeper.jpg', true, 4),
  ('66666666-6666-4666-8666-666666666606', '11111111-1111-4111-8111-111111111111', 'Picture book', 'learning', '3-7', 'Barnes & Noble', 12, 'https://www.barnesandnoble.com/s/picture+book', '/catalog/picture-book.jpg', true, 5),
  ('66666666-6666-4666-8666-666666666607', '11111111-1111-4111-8111-111111111111', 'First reader', 'learning', '6-8', 'Barnes & Noble', 10, 'https://www.barnesandnoble.com/s/first+reader', '/catalog/reader.jpg', true, 6),
  ('66666666-6666-4666-8666-666666666608', '11111111-1111-4111-8111-111111111111', 'Sticker book', 'learning', '4-5', 'Barnes & Noble', 7, 'https://www.barnesandnoble.com/s/sticker+book', '/catalog/stickers.jpg', true, 7)
ON CONFLICT (id) DO NOTHING;
