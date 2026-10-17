-- Real gift catalog. Images live in the app at /catalog/<slug>.jpg.
-- age_fit: both (ages 5 and 6), a single age, or a min-max range.
-- in_stock false still shows the picture, with an ask-a-grown-up badge.

ALTER TABLE public.gift_catalog
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trending boolean NOT NULL DEFAULT false;

ALTER TABLE public.gift_catalog DROP CONSTRAINT IF EXISTS gift_catalog_name_check;
ALTER TABLE public.gift_catalog
  ADD CONSTRAINT gift_catalog_name_check
  CHECK (char_length(trim(name)) BETWEEN 1 AND 160);

ALTER TABLE public.gift_catalog DROP CONSTRAINT IF EXISTS gift_catalog_age_fit_check;
ALTER TABLE public.gift_catalog
  ADD CONSTRAINT gift_catalog_age_fit_check
  CHECK (age_fit ~ '^(both|[0-9]+(-[0-9]+)?)$');

CREATE UNIQUE INDEX IF NOT EXISTS gift_catalog_slug_idx
  ON public.gift_catalog (household_id, slug);

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
  -- both: the shared pictures for Claire (6) and Chloe (5).
  IF fit = 'both' THEN
    RETURN p_years IN (5, 6);
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
    END,
    CASE WHEN product.in_stock THEN NULL ELSE 'Ask a grown-up' END
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

DELETE FROM public.gift_catalog
WHERE household_id = '11111111-1111-4111-8111-111111111111';

INSERT INTO public.gift_catalog (
  id, household_id, slug, name, category, age_fit, retailer, price, url, image, active, in_stock, trending, sort
)
VALUES
  ('40b7c6af-63a0-5f5b-a382-9e531c7ac0fc'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kpop-demon-hunters-huntr-x-rumi-golden-singing-doll-in-remov', 'KPop Demon Hunters HUNTR/X Rumi “Golden” Singing Doll in Removable Outfit & 5 Posable Joints', 'toys', 'both', 'Mattel Shop', 32.39, 'https://shop.mattel.com/products/kpop-demon-hunters-huntrx-rumi-golden-singing-doll-jrn40', '/catalog/kpop-demon-hunters-huntr-x-rumi-golden-singing-doll-in-remov.jpg', true, false, true, 0),
  ('df9730f7-23ef-5bc7-86a2-0d743e442fa5'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kpop-demon-hunters-huntr-x-zoey-golden-singing-doll-in-remov', 'KPop Demon Hunters HUNTR/X Zoey “Golden” Singing Doll in Removable Outfit & 5 Posable Joints', 'toys', 'both', 'Mattel Shop', 32.39, 'https://shop.mattel.com/products/kpop-demon-hunters-huntrx-zoey-golden-singing-doll-jrn42', '/catalog/kpop-demon-hunters-huntr-x-zoey-golden-singing-doll-in-remov.jpg', true, false, true, 1),
  ('9a5933fc-af91-5ff4-97c6-7eae2356db0a'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'stickerbox', 'Stickerbox', 'toys', '6-7', 'Stickerbox', 129.99, 'https://stickerbox.com/products/stickerbox', '/catalog/stickerbox.jpg', true, true, true, 2),
  ('abcab1f6-2e4e-50dd-819e-1bf25ad761bd'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'paw-patrol-the-dino-movie-megasaurus-dino-vehicle', 'PAW Patrol: The Dino Movie Megasaurus Dino Vehicle', 'toys', '5', 'Spin Master Shop', 59.99, 'https://shop.spinmaster.com/products/paw-patrol-the-dino-movie-megasaurus-dino-vehicle-6075999', '/catalog/paw-patrol-the-dino-movie-megasaurus-dino-vehicle.jpg', true, true, true, 3),
  ('a850df90-dd4b-50d0-9c2c-04a2dd18f46a'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'cheery-lane-house-play-set', 'Cheery Lane™  House Play Set', 'toys', '5', 'Melissa & Doug', 34.99, 'https://melissaanddoug.com/products/cheery-lane-house-play-set', '/catalog/cheery-lane-house-play-set.jpg', true, true, true, 4),
  ('688b9e30-cd43-5297-86da-a71bec8097bf'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kpop-demon-hunters-derpy-and-sussie-bundle', 'KPop Demon Hunters Derpy and Sussie Bundle', 'toys', 'both', 'Squishmallows (Jazwares Shop)', 29.99, 'https://shop.jazwares.com/products/kpop-demon-hunters-derpy-and-sussie-bundle', '/catalog/kpop-demon-hunters-derpy-and-sussie-bundle.jpg', true, true, true, 5),
  ('ba5ea322-e691-5e93-a910-f41e9f2ef590'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kpop-demon-hunters-18-inch-sleeping-derpy-tiger', 'KPop Demon Hunters 18-Inch Sleeping Derpy Tiger', 'toys', 'both', 'Squishmallows (Jazwares Shop)', 25.0, 'https://shop.jazwares.com/products/kpop-demon-hunters-18-inch-sleeping-derpy-tiger', '/catalog/kpop-demon-hunters-18-inch-sleeping-derpy-tiger.jpg', true, true, false, 6),
  ('fd87a7bb-cb8d-5901-be11-2f80967aee11'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'squishmallows-24-day-micromallows-holiday-plush-advent-calen', 'Squishmallows 24-Day Micromallows Holiday Plush Advent Calendar', 'toys', 'both', 'Squishmallows (Jazwares Shop)', 69.99, 'https://shop.jazwares.com/products/squishmallows-24-day-micromallows-holiday-plush-advent-calendar', '/catalog/squishmallows-24-day-micromallows-holiday-plush-advent-calen.jpg', true, true, true, 7),
  ('0033ff5e-5aae-5725-9747-70e080bbc317'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'polly-pocket-x-kpop-demon-hunters-miniature-dolls-toy-collec', 'Polly Pocket X Kpop Demon Hunters Miniature Dolls, Toy Collectible Characters, Ramen Cup Keychain', 'toys', '6-7', 'Mattel Shop', 5.39, 'https://shop.mattel.com/products/polly-pocket-x-kpop-demon-hunters-tiny-capsule-assortment-jrx58', '/catalog/polly-pocket-x-kpop-demon-hunters-miniature-dolls-toy-collec.jpg', true, false, true, 8),
  ('0a9dcd57-7def-5751-844a-769d842726e4'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'uno-kpop-demon-hunters-card-game-in-a-decorative-tin-for-kid', 'UNO Kpop Demon Hunters Card Game in A Decorative Tin For Kid, Adult & Family Nights With Movie-Inspired Deck', 'toys', '6-7', 'Mattel Shop', 11.87, 'https://shop.mattel.com/products/uno-kpop-demon-hunters-card-game-in-a-decorative-tin-jtt40', '/catalog/uno-kpop-demon-hunters-card-game-in-a-decorative-tin-for-kid.jpg', true, false, false, 9),
  ('45e3f308-0cd0-5cb3-a1cb-66e8628d9d08'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'polly-pocket-micro-dolls-playset-bluey-compact-with-7-access', 'Polly Pocket Micro Dolls & Playset, Bluey Compact With 7 Accessories Including Bluey & Bingo Figures', 'toys', '5', 'Mattel Shop', 21.59, 'https://shop.mattel.com/products/polly-pocket-bluey-compact-playset-jmg96', '/catalog/polly-pocket-micro-dolls-playset-bluey-compact-with-7-access.jpg', true, false, true, 10),
  ('90a19790-3fbe-5283-b341-c9a4a64d78cc'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'polly-pocket-dreamhouse-compact-playset-with-micro-barbie-br', 'Polly Pocket Dreamhouse Compact Playset With Micro Barbie & Brooklyn Dolls, Puppy, Pool & Accessories', 'toys', 'both', 'Mattel Shop', 21.59, 'https://shop.mattel.com/products/polly-pocket-dreamhouse-compact-playset-jnl22', '/catalog/polly-pocket-dreamhouse-compact-playset-with-micro-barbie-br.jpg', true, false, false, 11),
  ('71475249-eafb-53d6-bd76-b9decc4d899c'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'barbie-in-the-nutcracker-daisy-ballerina-doll-with-articulat', 'Barbie in The Nutcracker Daisy Ballerina Doll With Articulated Ankles And Candy Cane Baton', 'toys', 'both', 'Mattel Shop', 21.59, 'https://shop.mattel.com/products/barbie-in-the-nutcracker-daisy-ballerina-doll-jlw52', '/catalog/barbie-in-the-nutcracker-daisy-ballerina-doll-with-articulat.jpg', true, false, false, 12),
  ('cef104a1-2d1a-562a-8885-3eec205ba903'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'barbie-in-the-nutcracker-land-of-sweets-horse-sled-with-colo', 'Barbie in The Nutcracker Land Of Sweets Horse & Sled With Colorful Scented Hair And Candy-Scented Accessories', 'toys', 'both', 'Mattel Shop', 43.19, 'https://shop.mattel.com/products/barbie-in-the-nutcracker-land-of-sweets-horse-sled-jnh63', '/catalog/barbie-in-the-nutcracker-land-of-sweets-horse-sled-with-colo.jpg', true, false, false, 13),
  ('73023d2f-7952-575f-aaf6-e727d73f18bd'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'disney-princess-jewel-reveal-rapunzel-fashion-doll-w-8-surpr', 'Disney Princess Jewel Reveal Rapunzel Fashion Doll W/ 8 Surprises Including Gem Box & 10 Accessories', 'toys', 'both', 'Mattel Shop', 21.59, 'https://shop.mattel.com/products/disney-princess-jewel-reveal-rapunzel-fashion-doll-jlk28', '/catalog/disney-princess-jewel-reveal-rapunzel-fashion-doll-w-8-surpr.jpg', true, false, false, 14),
  ('0894d4f6-88a7-549f-8103-ffb433afcdca'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'polly-pocket-unicorn-travel-backpack-playset-with-2-micro-do', 'Polly Pocket Unicorn Travel Backpack Playset With 2 Micro Dolls & Fantasy Accessories, On-The-Go Play', 'toys', 'both', 'Mattel Shop', 32.39, 'https://shop.mattel.com/products/polly-pocket-unicorn-travel-backpack-playset-jmp31', '/catalog/polly-pocket-unicorn-travel-backpack-playset-with-2-micro-do.jpg', true, false, false, 15),
  ('e38a6bf5-294e-5519-b6aa-b8054a672e9e'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'polly-pocket-axolotl-adventure-compact-playset-with-1-micro-', 'Polly Pocket Axolotl Adventure Compact Playset With 1 Micro Doll And Pet, Travel Toy With Themed Accessories', 'toys', 'both', 'Mattel Shop', 16.19, 'https://shop.mattel.com/products/polly-pocket-axolotl-adventure-compact-playset-jkc51', '/catalog/polly-pocket-axolotl-adventure-compact-playset-with-1-micro-.jpg', true, false, false, 16),
  ('7de6b338-8a27-549a-9315-20e626102196'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'disney-and-pixar-toy-story-5-interactables-figures-7-inch-pl', 'Disney And Pixar Toy Story 5 Interactables Figures 7 Inch Playscale Movie Phrases & Interact Chat', 'toys', '5', 'Mattel Shop', 21.59, 'https://shop.mattel.com/products/disney-and-pixar-toy-story-5-interactables-buzz-lightyear-figure-jkv30', '/catalog/disney-and-pixar-toy-story-5-interactables-figures-7-inch-pl.jpg', true, false, true, 17),
  ('cb90dcae-af61-54ed-8b3b-581003657cef'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'polly-pocket-micro-dolls-playset-the-grinch-compact-with-6-a', 'Polly Pocket Micro Dolls & Playset, The Grinch Compact With 6 Accessories, Winter Holiday Themed', 'toys', 'both', 'Mattel Shop', 10.79, 'https://shop.mattel.com/products/polly-pocket-the-grinch-compact-jmj98', '/catalog/polly-pocket-micro-dolls-playset-the-grinch-compact-with-6-a.jpg', true, false, false, 18),
  ('59c47e81-2acb-53d4-89b0-3ac414cb87e4'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'uno-junior-bluey-card-game-for-kid-adult-family-nights-with-', 'UNO Junior Bluey Card Game For Kid, Adult & Family Nights With Show-Inspired Deck', 'toys', '5', 'Mattel Shop', 5.93, 'https://shop.mattel.com/products/uno-junior-bluey-card-game-jnd90', '/catalog/uno-junior-bluey-card-game-for-kid-adult-family-nights-with-.jpg', true, false, false, 19),
  ('05968a53-90f7-5caa-a692-459fc7047943'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kinetic-sand-squishmotion-playset', 'Kinetic Sand, SquishMotion Playset', 'toys', 'both', 'Spin Master Shop', 19.99, 'https://shop.spinmaster.com/products/kinetic-sand-squishmotion-playset-6069401', '/catalog/kinetic-sand-squishmotion-playset.jpg', true, true, true, 20),
  ('9a3e37bc-71f3-51c8-b1ec-95d892de85df'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kinetic-sand-mermaid-palace-playset', 'Kinetic Sand, Mermaid Palace Playset', 'toys', 'both', 'Spin Master Shop', 39.99, 'https://shop.spinmaster.com/products/kinetic-sand-mermaid-palace-playset-6065181', '/catalog/kinetic-sand-mermaid-palace-playset.jpg', true, true, false, 21),
  ('d31459f4-090c-56b2-a791-25dfeaa44d61'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'gabby-s-dollhouse-move-groovedj-catnip-10-inch-plush', 'Gabby’s Dollhouse, Move & GrooveDJ Catnip 10-inch Plush', 'toys', '5', 'Spin Master Shop', 14.99, 'https://shop.spinmaster.com/products/gabbys-dollhouse-move-groovedj-catnip-10-inch-plush-6073716', '/catalog/gabby-s-dollhouse-move-groovedj-catnip-10-inch-plush.jpg', true, true, false, 22),
  ('dcbb652c-fbd6-5dfa-b3f8-6a07669c23b8'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'peek-a-boo-flora-the-bunny-7-in', 'Peek-a-Boo Flora the Bunny, 7 in', 'toys', '5', 'Spin Master Shop', 20.0, 'https://shop.spinmaster.com/products/peek-a-boo-flora-the-bunny-7-in-6071302', '/catalog/peek-a-boo-flora-the-bunny-7-in.jpg', true, true, false, 23),
  ('9e267419-f67f-57cd-8a1c-e6c0d08d9e90'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'animated-peeki-the-puppy-12-in', 'Animated Peeki the Puppy, 12 in', 'toys', '5', 'Spin Master Shop', 40.0, 'https://shop.spinmaster.com/products/animated-peeki-the-puppy-12-in-6072443', '/catalog/animated-peeki-the-puppy-12-in.jpg', true, true, false, 24),
  ('68cf0b9f-8b31-58e8-b210-316ccf077c36'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'hatchimals-alive-neon-rainbow-spring-basket', 'Hatchimals Alive, Neon Rainbow Spring Basket', 'toys', 'both', 'Spin Master Shop', 16.99, 'https://shop.spinmaster.com/products/hatchimals-alive-neon-rainbow-spring-basket-6072741', '/catalog/hatchimals-alive-neon-rainbow-spring-basket.jpg', true, true, false, 25),
  ('1ff53847-765a-5730-b826-1897d2b96f48'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'paw-patrol-the-dino-movie-super-lava-blast-volcano-playset', 'PAW Patrol: The Dino Movie Super Lava Blast Volcano Playset', 'toys', '5', 'Spin Master Shop', 49.99, 'https://shop.spinmaster.com/products/paw-patrol-the-dino-movie-super-lava-blast-volcano-playset-6076370', '/catalog/paw-patrol-the-dino-movie-super-lava-blast-volcano-playset.jpg', true, true, false, 26),
  ('1d792cef-beae-5e31-b931-c7bcdb8fcd30'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'tonieplay-bluey-play-all-day-game-controller', 'Tonieplay Bluey: Play All Day Game & Controller', 'toys', '5', 'Tonies', 39.98, 'https://us.tonies.com/products/tonieplay-bluey-your-playful-day-with-bluey-game-controller', '/catalog/tonieplay-bluey-play-all-day-game-controller.jpg', true, true, true, 27),
  ('5d51a0e6-5a0c-500e-b675-6898f3344bbb'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'pok-mon-pikachu-toniebox-2-starter-set-lightning-yellow', 'Pokémon Pikachu Toniebox 2 Starter Set - Lightning Yellow', 'toys', 'both', 'Tonies', 149.99, 'https://us.tonies.com/products/toniebox2-pikachu-starter-set', '/catalog/pok-mon-pikachu-toniebox-2-starter-set-lightning-yellow.jpg', true, true, true, 28),
  ('9a844c05-ef92-5268-af78-8e583d496793'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'yoto-mini-4th-gen-kpop-demon-hunters-bundle', 'Yoto Mini 4th Gen + Kpop Demon Hunters Bundle', 'toys', '6-7', 'Yoto', 133.17, 'https://us.yotoplay.com/products/yoto-mini-4-gen-kpop-demon-hunters-bundle', '/catalog/yoto-mini-4th-gen-kpop-demon-hunters-bundle.jpg', true, true, true, 29),
  ('210440d4-b359-5170-a724-a8f468a20376'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'hello-kitty-and-friends-12-inch-tuxedosam-holiday-hat-squish', 'Hello Kitty and Friends 12-Inch Tuxedosam Holiday Hat Squishmallows', 'toys', 'both', 'Squishmallows (Jazwares Shop)', 19.99, 'https://shop.jazwares.com/products/hello-kitty-and-friends-12-inch-tuxedosam-holiday-hat-squishmallows', '/catalog/hello-kitty-and-friends-12-inch-tuxedosam-holiday-hat-squish.jpg', true, true, false, 30),
  ('f3191074-0099-5a41-895d-1a60f4e86a32'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'love-your-look-makeup-kit-play-set', 'LOVE YOUR LOOK - Makeup Kit Play Set', 'toys', 'both', 'Melissa & Doug', 29.99, 'https://melissaanddoug.com/products/love-your-look-makeup-kit-play-set', '/catalog/love-your-look-makeup-kit-play-set.jpg', true, true, false, 31),
  ('dc7d13cc-246d-5206-84d5-a236689883aa'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'velour-ballet-dress', 'Velour Ballet Dress', 'clothes', 'both', 'Tea Collection', 55.0, 'https://www.teacollection.com/products/velour-ballet-dress-red-wagon-26w12307', '/catalog/velour-ballet-dress.jpg', true, true, false, 32),
  ('2c33daf1-8ae4-5b08-b232-a07f80ea83ed'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'puff-sleeve-sash-dress', 'Puff Sleeve Sash Dress', 'clothes', 'both', 'Tea Collection', 75.5, 'https://www.teacollection.com/products/puff-sleeve-sash-dress-holiday-market-plaid-26w13300', '/catalog/puff-sleeve-sash-dress.jpg', true, true, false, 33),
  ('ebd4d3b3-4e6c-5a28-a3fc-f49fdbd4c8ed'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'ruffle-shoulder-ballet-dress', 'Ruffle Shoulder Ballet Dress', 'clothes', 'both', 'Tea Collection', 46.5, 'https://www.teacollection.com/products/ruffle-shoulder-ballet-dress-tea-party-floral-26w12301', '/catalog/ruffle-shoulder-ballet-dress.jpg', true, true, false, 34),
  ('c8001d09-be2e-546d-81fa-c86ca0640bb5'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'goodnight-pajama-set', 'Goodnight Pajama Set', 'clothes', 'both', 'Tea Collection', 52.0, 'https://www.teacollection.com/products/goodnight-pajama-set-candy-cane-bows-26w12700', '/catalog/goodnight-pajama-set.jpg', true, true, false, 35),
  ('cd13b988-3a9a-5d7b-a9f9-9a31fc17f2ad'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'velour-twirl-skirt', 'Velour Twirl Skirt', 'clothes', 'both', 'Tea Collection', 41.5, 'https://www.teacollection.com/products/velour-twirl-skirt-jet-black-26w12201', '/catalog/velour-twirl-skirt.jpg', true, true, false, 36),
  ('28403d16-cb74-5482-b7f9-2e8d2b761c9c'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'very-velour-flare-pants', 'Very Velour Flare Pants', 'clothes', '6-7', 'Tea Collection', 46.5, 'https://www.teacollection.com/products/very-velour-flare-pants-naval-blue-26w12202', '/catalog/very-velour-flare-pants.jpg', true, true, false, 37),
  ('6a386ee8-5ee5-5be3-ab24-ab70ee497288'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'party-polka-dot-velvet-twirl-dress', 'Party Polka Dot Velvet Twirl Dress', 'clothes', 'both', 'Little Sleepies', 54.0, 'https://www.littlesleepies.com/products/party-polka-dot-velvet-twirl-dress', '/catalog/party-polka-dot-velvet-twirl-dress.jpg', true, true, false, 38),
  ('04bca8b5-ce9c-520c-be91-4a4c2e7cef34'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'northern-night-plaid-tiered-tutu-dress', 'Northern Night Plaid Tiered Tutu Dress', 'clothes', '5', 'Little Sleepies', 44.0, 'https://www.littlesleepies.com/products/northern-night-plaid-tiered-tutu-dress', '/catalog/northern-night-plaid-tiered-tutu-dress.jpg', true, true, false, 39),
  ('95860450-38bd-54e4-b1af-b9704ce1f692'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'holiday-rose-garden-legging', 'Holiday Rose Garden Legging', 'clothes', 'both', 'Little Sleepies', 20.0, 'https://www.littlesleepies.com/products/holiday-rose-garden-legging', '/catalog/holiday-rose-garden-legging.jpg', true, true, false, 40),
  ('625302d9-4a48-57d8-8688-eef5af20b012'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'holiday-red-drop-shoulder-bow-sweater', 'Holiday Red Drop Shoulder Bow Sweater', 'clothes', '6-7', 'Little Sleepies', 38.0, 'https://www.littlesleepies.com/products/holiday-red-bow-drop-shoulder-bow-sweater', '/catalog/holiday-red-drop-shoulder-bow-sweater.jpg', true, true, false, 41),
  ('cad85c14-bbeb-53e3-a45f-a6c132fdde4d'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'pop-stripe-sweater-beanie', 'Pop Stripe Sweater Beanie', 'clothes', 'both', 'Little Sleepies', 22.0, 'https://www.littlesleepies.com/products/pop-stripe-sweater-beanie', '/catalog/pop-stripe-sweater-beanie.jpg', true, true, false, 42),
  ('36af5bb4-8843-59f4-ba05-0d67f7ef9c93'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kids-shawl-cardigan-in-frosty-friends', 'Kids shawl cardigan in frosty friends', 'clothes', 'both', 'Primary', 55.5, 'https://primary.com/products/kids-shawl-cardigan-in-snowman', '/catalog/kids-shawl-cardigan-in-frosty-friends.jpg', true, true, false, 43),
  ('e354d62b-0484-5862-9aac-b97fba3e5255'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kids-cardigan-in-fair-isle-hearts', 'Kids cardigan in fair isle hearts', 'clothes', 'both', 'Primary', 62.5, 'https://primary.com/products/cardigan-in-heart-fair-isle', '/catalog/kids-cardigan-in-fair-isle-hearts.jpg', true, true, false, 44),
  ('ac170953-74ec-5a1a-a2e1-eec6dbf4b683'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kids-long-sleeve-flannel-dress-in-plaid', 'Kids long sleeve flannel dress in plaid', 'clothes', 'both', 'Primary', 33.5, 'https://primary.com/products/kids-long-sleeve-popover-dress-in-plaid', '/catalog/kids-long-sleeve-flannel-dress-in-plaid.jpg', true, true, false, 45),
  ('dc00eef4-21b5-5beb-9819-3dee407a3ed3'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'kids-rainbow-snowflake-fair-isle-sweater', 'Kids rainbow snowflake fair isle sweater', 'clothes', 'both', 'Primary', 41.5, 'https://primary.com/products/kids-rainbow-snowflake-fair-isle-sweater', '/catalog/kids-rainbow-snowflake-fair-isle-sweater.jpg', true, true, false, 46),
  ('1414259d-32cd-597e-9db2-9df71dc273c1'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'undersea-adventure-58-piece-set', 'Undersea Adventure 58 Piece Set', 'learning', 'both', 'Magna-Tiles', 89.99, 'https://magnatiles.com/products/undersea-adventure-58-piece-set', '/catalog/undersea-adventure-58-piece-set.jpg', true, true, true, 47),
  ('a615b3cf-4dad-582d-8d7b-4c21e452c5a7'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'dino-world-40-piece-set', 'Dino World 40 Piece Set', 'learning', '5', 'Magna-Tiles', 79.99, 'https://magnatiles.com/products/dino-world-40-piece-set', '/catalog/dino-world-40-piece-set.jpg', true, true, false, 48),
  ('bc4a19db-708c-5a1d-8f1e-21d108caf424'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'holiday-village-bundle', 'Holiday Village Bundle', 'learning', 'both', 'Magna-Tiles', 89.97, 'https://magnatiles.com/products/holiday-village-bundle', '/catalog/holiday-village-bundle.jpg', true, true, false, 49),
  ('2c905e14-0fe6-5f73-964c-d55805e3c28f'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'seasonal-favorites-bundle', 'Seasonal Favorites Bundle', 'learning', '6-7', 'Magna-Tiles', 59.98, 'https://magnatiles.com/products/seasonal-favorites-bundle', '/catalog/seasonal-favorites-bundle.jpg', true, true, false, 50),
  ('86547f44-136a-54d4-80b8-b31bf405d871'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'take-along-activity-easel', 'Take-Along Activity Easel', 'learning', 'both', 'Melissa & Doug', 32.99, 'https://melissaanddoug.com/products/take-along-activity-easel', '/catalog/take-along-activity-easel.jpg', true, true, false, 51),
  ('7d45b6a0-3c8a-53a2-819b-57e2663fd14b'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'glow-in-the-dark-unicorn-floor-puzzle-48-pieces', 'Glow-in-the-Dark Unicorn Floor Puzzle - 48 Pieces', 'learning', '5', 'Melissa & Doug', 24.99, 'https://melissaanddoug.com/products/glow-in-the-dark-unicorn-floor-puzzle', '/catalog/glow-in-the-dark-unicorn-floor-puzzle-48-pieces.jpg', true, true, false, 52),
  ('01c5cb2e-e2f9-5fc1-ad8a-9054773d9f0c'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'design-your-own-railroad-floor-puzzle', 'Design Your Own Railroad Floor Puzzle', 'learning', 'both', 'Melissa & Doug', 24.99, 'https://melissaanddoug.com/products/design-your-own-railroad-floor-puzzle', '/catalog/design-your-own-railroad-floor-puzzle.jpg', true, true, false, 53),
  ('3c1d1f1c-9801-56de-874b-ba2d16fd220f'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'sticker-wow-activity-pad-sticker-stamper-unicorn', 'Sticker WOW!™ Activity Pad & Sticker Stamper - Unicorn', 'learning', 'both', 'Melissa & Doug', 12.99, 'https://melissaanddoug.com/products/sticker-wow-activity-pad-set-unicorn', '/catalog/sticker-wow-activity-pad-sticker-stamper-unicorn.jpg', true, true, false, 54),
  ('b751cfa8-6e04-5b3d-a3d4-7cd7a4e72a98'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'disney-tiana-wooden-magnetic-dress-up-play-set', 'Disney Tiana Wooden Magnetic Dress-Up Play Set', 'learning', '5', 'Melissa & Doug', 17.99, 'https://melissaanddoug.com/products/disney-magnetic-dress-up-tiana', '/catalog/disney-tiana-wooden-magnetic-dress-up-play-set.jpg', true, true, false, 55),
  ('112dcb0f-87f1-54f8-93a4-af50992af0e2'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'pet-vet-gift-bundle', 'Pet Vet Gift Bundle', 'learning', '5', 'Melissa & Doug', 64.99, 'https://melissaanddoug.com/products/pet-vet-gift-bundle', '/catalog/pet-vet-gift-bundle.jpg', true, true, false, 56),
  ('43b4c633-f035-5fe3-b1da-1eca5a229763'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'yoto-mini-4th-gen', 'Yoto Mini 4th Gen', 'learning', 'both', 'Yoto', 109.99, 'https://us.yotoplay.com/products/yoto-mini-4', '/catalog/yoto-mini-4th-gen.jpg', true, true, false, 57),
  ('4c939fdd-054f-5040-bfa1-dd1290cfd9b6'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'yoto-jingle-jams', 'Yoto Jingle Jams', 'learning', 'both', 'Yoto', 8.49, 'https://us.yotoplay.com/products/yoto-jingle-jams', '/catalog/yoto-jingle-jams.jpg', true, true, false, 58),
  ('dcb4ae1c-ba5d-53c3-b4b2-9799a2eb4ba2'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'playtime-puppy-toniebox-2-starter-set-sky-blue', 'Playtime Puppy Toniebox 2 Starter Set - Sky Blue', 'learning', '5', 'Tonies', 149.99, 'https://us.tonies.com/products/toniebox2-starter-set-playtime-puppy-sky-blue', '/catalog/playtime-puppy-toniebox-2-starter-set-sky-blue.jpg', true, true, false, 59),
  ('68399767-88ca-52ca-98d2-f319a8317f7b'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'weather-station-meteorologist-s-weather-station', 'Weather Station - Meteorologist''s Weather Station', 'learning', '6-7', 'CrunchLabs', 32.95, 'https://crunchlabs.com/products/meteorologists-weather-station', '/catalog/weather-station-meteorologist-s-weather-station.jpg', true, true, false, 60),
  ('38b7128c-94e0-5fea-832d-3c61ca21ce10'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'botanist-s-greenhouse-the-botanist-s-greenhouse', 'Botanist''s Greenhouse - The Botanist''s Greenhouse', 'learning', '6-7', 'CrunchLabs', 32.95, 'https://crunchlabs.com/products/botanists-greenhouse', '/catalog/botanist-s-greenhouse-the-botanist-s-greenhouse.jpg', true, true, false, 61)
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
  sort = EXCLUDED.sort;
