-- Kid iPad links for gift lists.
-- Additive: existing wishes stay approved and parent-added.
-- Anon still has no table grants. A kid token can read one list and insert a wish.
-- The server stores hashes, not the link secret or the parent PIN.

ALTER TABLE public.gift_items
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS added_by text NOT NULL DEFAULT 'parent',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS audio text;

ALTER TABLE public.gift_items
  DROP CONSTRAINT IF EXISTS gift_items_review_status_check;
ALTER TABLE public.gift_items
  ADD CONSTRAINT gift_items_review_status_check
  CHECK (review_status IN ('pending', 'approved'));

ALTER TABLE public.gift_items
  DROP CONSTRAINT IF EXISTS gift_items_added_by_check;
ALTER TABLE public.gift_items
  ADD CONSTRAINT gift_items_added_by_check
  CHECK (added_by IN ('parent', 'kid'));

CREATE TABLE IF NOT EXISTS public.gift_kid_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.gift_lists (id) ON DELETE CASCADE,
  secret_hash text NOT NULL,
  pin_hash text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_kid_links_secret_unique UNIQUE (secret_hash),
  CONSTRAINT gift_kid_links_hash_len CHECK (
    char_length(secret_hash) = 64 AND char_length(pin_hash) = 64
  )
);

CREATE INDEX IF NOT EXISTS gift_kid_links_active_idx
  ON public.gift_kid_links (list_id)
  WHERE revoked_at IS NULL;

-- Rate-limit buckets. No client grants.
CREATE TABLE IF NOT EXISTS public.gift_kid_rate (
  bucket text PRIMARY KEY,
  hits integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_kid_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_kid_rate ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gift_kid_rate FROM PUBLIC;
REVOKE ALL ON TABLE public.gift_kid_rate FROM anon;
REVOKE ALL ON TABLE public.gift_kid_rate FROM authenticated;

REVOKE ALL ON TABLE public.gift_kid_links FROM PUBLIC;
REVOKE ALL ON TABLE public.gift_kid_links FROM anon;
GRANT SELECT ON TABLE public.gift_kid_links TO authenticated;

DROP POLICY IF EXISTS gift_kid_links_member_select ON public.gift_kid_links;
CREATE POLICY gift_kid_links_member_select
  ON public.gift_kid_links
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.gift_lists l
      WHERE l.id = list_id
        AND (SELECT private.is_household_member(l.household_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers. Not granted to anon.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.kid_digest(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(extensions.digest(convert_to(p_value, 'utf8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION private.kid_rate_count(p_bucket text, p_window interval)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN r.window_start < now() - p_window THEN 0
      ELSE r.hits
    END
    FROM public.gift_kid_rate r
    WHERE r.bucket = p_bucket
  ), 0);
$$;

CREATE OR REPLACE FUNCTION private.kid_rate_bump(p_bucket text, p_window interval)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_bucket IS NULL OR char_length(p_bucket) > 120 THEN
    RETURN;
  END IF;

  INSERT INTO public.gift_kid_rate AS r (bucket, hits, window_start)
  VALUES (p_bucket, 1, now())
  ON CONFLICT (bucket) DO UPDATE
  SET
    hits = CASE
      WHEN r.window_start < now() - p_window THEN 1
      ELSE r.hits + 1
    END,
    window_start = CASE
      WHEN r.window_start < now() - p_window THEN now()
      ELSE r.window_start
    END;
END;
$$;

CREATE OR REPLACE FUNCTION private.kid_secret_ok(p_secret text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_secret IS NOT NULL
    AND char_length(p_secret) BETWEEN 16 AND 80
    AND p_secret ~ '^[A-Za-z0-9_-]+$';
$$;

-- ---------------------------------------------------------------------------
-- Family share hides wishes a parent has not approved.
-- ---------------------------------------------------------------------------

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
          'added_by', i.added_by
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

CREATE OR REPLACE FUNCTION private.claim_gift_item(
  p_slug text,
  p_item_id uuid,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lid uuid;
  item public.gift_items;
  cname text;
BEGIN
  IF p_item_id IS NULL OR p_slug IS NULL OR trim(p_slug) = '' THEN
    RAISE EXCEPTION 'List and item are required';
  END IF;

  SELECT l.id INTO lid
  FROM public.gift_lists l
  WHERE l.share_slug = trim(p_slug);

  IF lid IS NULL THEN
    RAISE EXCEPTION 'List not found';
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

-- ---------------------------------------------------------------------------
-- Kid token. Read one list. Insert one wish. Check the parent PIN.
-- ---------------------------------------------------------------------------

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
          'review_status', i.review_status
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

CREATE OR REPLACE FUNCTION private.add_kid_wish(
  p_secret text,
  p_kind text,
  p_label text,
  p_image text,
  p_audio text,
  p_category text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash text;
  lid uuid;
  kid_name text;
  wish_title text;
  v_image text;
  v_audio text;
  v_category text;
  v_notes text;
  next_sort integer;
  item_id uuid;
BEGIN
  IF NOT private.kid_secret_ok(p_secret) THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF p_kind NOT IN ('voice', 'photo', 'picture') THEN
    RAISE EXCEPTION 'Wish kind is not allowed';
  END IF;

  v_hash := private.kid_digest(p_secret);
  IF private.kid_rate_count('wish10:' || v_hash, interval '10 minutes') >= 8
     OR private.kid_rate_count('wishday:' || v_hash, interval '1 day') >= 40 THEN
    RAISE EXCEPTION 'Slow down';
  END IF;

  SELECT l.id, l.display_name
  INTO lid, kid_name
  FROM public.gift_kid_links k
  JOIN public.gift_lists l ON l.id = k.list_id
  WHERE k.secret_hash = v_hash
    AND k.revoked_at IS NULL;

  IF lid IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  v_image := NULLIF(p_image, '');
  v_audio := NULLIF(p_audio, '');
  v_category := NULLIF(trim(COALESCE(p_category, '')), '');
  v_notes := NULLIF(left(trim(COALESCE(p_label, '')), 160), '');

  IF p_kind = 'picture' THEN
    IF v_category IS NULL OR v_category NOT IN (
      'dolls', 'lego', 'art', 'books', 'games', 'outdoors', 'dressup', 'stuffed'
    ) THEN
      RAISE EXCEPTION 'Picture is not allowed';
    END IF;
    v_image := NULL;
    v_audio := NULL;
    v_notes := NULL;
  ELSIF p_kind = 'photo' THEN
    v_audio := NULL;
    v_category := NULL;
    v_notes := NULL;
    IF v_image IS NULL
       OR v_image !~ '^data:image/(jpeg|png|webp);base64,'
       OR octet_length(v_image) > 400000 THEN
      RAISE EXCEPTION 'Picture is too big';
    END IF;
  ELSE
    v_image := NULL;
    v_category := NULL;
    IF v_audio IS NULL
       OR v_audio !~ '^data:audio/[a-zA-Z0-9.+-]+(;[^,]*)?;base64,'
       OR octet_length(v_audio) > 500000 THEN
      RAISE EXCEPTION 'Recording is too big';
    END IF;
  END IF;

  wish_title := left('New from ' || kid_name, 160);
  SELECT COALESCE(MAX(i.sort), -1) + 1
  INTO next_sort
  FROM public.gift_items i
  WHERE i.list_id = lid;

  INSERT INTO public.gift_items (
    list_id, title, notes, image, audio, category, sort, review_status, added_by
  )
  VALUES (
    lid, wish_title, v_notes, v_image, v_audio, v_category, next_sort, 'pending', 'kid'
  )
  RETURNING id INTO item_id;

  PERFORM private.kid_rate_bump('wish10:' || v_hash, interval '10 minutes');
  PERFORM private.kid_rate_bump('wishday:' || v_hash, interval '1 day');

  RETURN jsonb_build_object(
    'id', item_id,
    'title', wish_title,
    'notes', v_notes,
    'image', v_image,
    'audio', v_audio,
    'category', v_category,
    'sort', next_sort,
    'review_status', 'pending',
    'added_by', 'kid'
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.check_kid_pin(p_secret text, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash text;
  stored text;
  ok boolean;
BEGIN
  IF NOT private.kid_secret_ok(p_secret) OR p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    IF private.kid_rate_count('pin:unknown', interval '10 minutes') >= 30 THEN
      RETURN false;
    END IF;
    PERFORM private.kid_rate_bump('pin:unknown', interval '10 minutes');
    RETURN false;
  END IF;

  v_hash := private.kid_digest(p_secret);

  SELECT k.pin_hash
  INTO stored
  FROM public.gift_kid_links k
  WHERE k.secret_hash = v_hash
    AND k.revoked_at IS NULL;

  IF stored IS NULL THEN
    IF private.kid_rate_count('pin:unknown', interval '10 minutes') >= 30 THEN
      RETURN false;
    END IF;
    PERFORM private.kid_rate_bump('pin:unknown', interval '10 minutes');
    RETURN false;
  END IF;

  IF private.kid_rate_count('pin:' || v_hash, interval '10 minutes') >= 5 THEN
    RETURN false;
  END IF;

  ok := stored = private.kid_digest(p_secret || ':' || p_pin);
  IF NOT ok THEN
    PERFORM private.kid_rate_bump('pin:' || v_hash, interval '10 minutes');
  END IF;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION private.create_kid_link(
  p_list_id uuid,
  p_secret text,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_list_id IS NULL OR NOT private.kid_secret_ok(p_secret) OR COALESCE(p_pin, '') !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'Link needs a list, a secret, and a 4-digit PIN';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.gift_lists l
    WHERE l.id = p_list_id
      AND (SELECT private.is_household_member(l.household_id))
  ) THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  UPDATE public.gift_kid_links
  SET revoked_at = now()
  WHERE list_id = p_list_id
    AND revoked_at IS NULL;

  INSERT INTO public.gift_kid_links (list_id, secret_hash, pin_hash)
  VALUES (
    p_list_id,
    private.kid_digest(p_secret),
    private.kid_digest(p_secret || ':' || p_pin)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION private.revoke_kid_link(p_list_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_list_id IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.gift_lists l
    WHERE l.id = p_list_id
      AND (SELECT private.is_household_member(l.household_id))
  ) THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  UPDATE public.gift_kid_links
  SET revoked_at = now()
  WHERE list_id = p_list_id
    AND revoked_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Public wrappers stay SECURITY INVOKER. Privileges live on the private functions.
CREATE OR REPLACE FUNCTION public.get_kid_gift_list(p_secret text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.get_kid_gift_list(p_secret);
$$;

CREATE OR REPLACE FUNCTION public.add_kid_wish(
  p_secret text,
  p_kind text,
  p_label text DEFAULT '',
  p_image text DEFAULT '',
  p_audio text DEFAULT '',
  p_category text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.add_kid_wish(p_secret, p_kind, p_label, p_image, p_audio, p_category);
$$;

CREATE OR REPLACE FUNCTION public.check_kid_pin(p_secret text, p_pin text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.check_kid_pin(p_secret, p_pin);
$$;

CREATE OR REPLACE FUNCTION public.create_kid_link(
  p_list_id uuid,
  p_secret text,
  p_pin text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.create_kid_link(p_list_id, p_secret, p_pin);
$$;

CREATE OR REPLACE FUNCTION public.revoke_kid_link(p_list_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.revoke_kid_link(p_list_id);
$$;

REVOKE ALL ON FUNCTION private.kid_digest(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kid_rate_count(text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kid_rate_bump(text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.kid_secret_ok(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_kid_gift_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.add_kid_wish(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.check_kid_pin(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.create_kid_link(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.revoke_kid_link(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_kid_gift_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_kid_wish(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_kid_pin(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_kid_link(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_kid_link(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.get_kid_gift_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.add_kid_wish(text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.check_kid_pin(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.create_kid_link(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.revoke_kid_link(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_kid_gift_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_kid_wish(text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_kid_pin(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_kid_link(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_kid_link(uuid) TO authenticated;

-- Supabase grants new public tables and functions to anon by default.
-- Household members keep the grants from the earlier gift migration.
REVOKE ALL ON TABLE public.gift_items FROM anon;
REVOKE ALL ON TABLE public.gift_lists FROM anon;
REVOKE ALL ON TABLE public.gift_kid_links FROM authenticated;
GRANT SELECT ON TABLE public.gift_kid_links TO authenticated;
REVOKE ALL ON FUNCTION public.create_kid_link(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_kid_link(uuid) FROM anon;
REVOKE ALL ON FUNCTION private.create_kid_link(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION private.revoke_kid_link(uuid) FROM anon;
