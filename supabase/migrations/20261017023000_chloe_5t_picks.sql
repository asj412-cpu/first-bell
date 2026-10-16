-- Chloe's 5T clothes. Posh Peanut 5T-6T covers toddler 5T.
-- Age fit is 5, so these pictures are for Chloe, not Claire or Drew.
-- 5T stock is verified, so check_size stays false.

INSERT INTO public.gift_catalog (
  id, household_id, slug, name, category, age_fit, retailer, price, url, image, active, in_stock, trending, check_size, sizes, sort
)
VALUES
  ('960566f9-11b1-501a-bf9f-78021664a718'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-disney-holiday-pooh-ruffled-twirl-dress', 'Disney Holiday Pooh Ruffled Twirl Dress', 'clothes', '5', 'Posh Peanut', 54.0, 'https://poshpeanut.com/products/disney-holiday-pooh-ruffled-long-sleeve-scoop-neck-ruffled-hem-twirl-dress', '/catalog/5t-disney-holiday-pooh-ruffled-twirl-dress.jpg', true, true, false, false, '2T,3T-4T,5T-6T,7Y-8Y,10Y-12Y', 76),
  ('bbf56bbc-737d-58f8-be4c-4ee0a8c06c77'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-disney-holly-hunny-classic-sweater-cardigan', 'Disney Holly & Hunny Classic Sweater Cardigan', 'clothes', '5', 'Posh Peanut', 42.0, 'https://poshpeanut.com/products/disney-holly-hunny-long-sleeve-sweater-knit-drop-shoulder-cardigan', '/catalog/5t-disney-holly-hunny-classic-sweater-cardigan.jpg', true, true, false, false, '2T,3T-4T,5T-6T,7Y-8Y,10Y-12Y', 77),
  ('d5f21aee-6232-5d90-aa6b-1490c4c4f7f3'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-disney-holiday-pooh-classic-pajama-set', 'Disney Holiday Pooh Classic Pajama Set', 'clothes', '5', 'Posh Peanut', 46.0, 'https://poshpeanut.com/products/disney-holiday-pooh-long-sleeve-classic-pajama-set', '/catalog/5t-disney-holiday-pooh-classic-pajama-set.jpg', true, true, false, false, '2T,3T-4T,5T-6T,7Y-8Y,10Y-12Y', 78),
  ('6dcbc645-b9e7-5535-8ec7-abcd265efbf1'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-icing-pink-pointelle-sweater-cardigan', 'Icing Pink Pointelle Sweater Cardigan', 'clothes', '5', 'Posh Peanut', 34.0, 'https://poshpeanut.com/products/icing-pink-pointelle-long-sleeve-sweater-knit-cardigan', '/catalog/5t-icing-pink-pointelle-sweater-cardigan.jpg', true, true, false, false, '2T,3T-4T,5T-6T,7Y-8Y,10Y-12Y', 79),
  ('486f9bb8-c055-5716-a62e-f4ac3f05176b'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-long-sleeve-pajamas-in-peppermint-stripes', 'Long Sleeve Pajamas in Peppermint Stripes', 'clothes', '5', 'Kyte Baby', 40.0, 'https://kytebaby.com/products/printed-toddler-pajama-set-in-peppermint-stripes', '/catalog/5t-long-sleeve-pajamas-in-peppermint-stripes.jpg', true, true, false, false, '2T,3T,4T,5T,6T,7,8,10,12', 80),
  ('e3ec0367-3540-5d3e-9947-a7be664ae4d5'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-pointelle-long-sleeve-set-in-candy-cane', 'Pointelle Long Sleeve Set in Candy Cane', 'clothes', '5', 'Kyte Baby', 50.0, 'https://kytebaby.com/products/pointelle-long-sleeve-set-in-candy-cane', '/catalog/5t-pointelle-long-sleeve-set-in-candy-cane.jpg', true, true, false, false, '2T,3T,4T,5T,6T,7', 81),
  ('9255d68c-5714-5736-92ca-7259b914d5b5'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-long-sleeve-jogger-set-in-holiday-pups', 'Long Sleeve Jogger Set in Holiday Pups', 'clothes', '5', 'Kyte Baby', 55.0, 'https://kytebaby.com/products/bamboo-cotton-long-sleeve-jogger-set-in-holiday-pups', '/catalog/5t-long-sleeve-jogger-set-in-holiday-pups.jpg', true, true, false, false, '2T,3T,4T,5T,6T,7,8,10', 82),
  ('2c41ea13-6f0b-5466-be25-cec21ce1f10e'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-if-you-give-a-mouse-a-cookie-christmas-bamboo-kids-paja', 'If You Give A Mouse A Cookie Christmas Bamboo Kids Pajamas', 'clothes', '5', 'Bellabu Bear', 39.0, 'https://bellabubear.com/products/if-you-give-a-mouse-a-cookie-holiday-bamboo-kids-pajamas', '/catalog/5t-if-you-give-a-mouse-a-cookie-christmas-bamboo-kids-paja.jpg', true, true, false, false, '2T,3T,4T,5T,6Y,7,8Y,9,10Y,12,14Y', 83),
  ('93de38c8-0a80-5543-84ed-786e2fe65218'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-elegant-snowflake-girl-tunic-set', 'Elegant Snowflake Girl Tunic Set', 'clothes', '5', 'Burt''s Bees Baby', 32.95, 'https://www.burtsbeesbaby.com/products/elegant-snowflake-tunic-set', '/catalog/5t-elegant-snowflake-girl-tunic-set.jpg', true, true, false, false, '2T,3T,4T,5T', 84),
  ('b9c3552e-0c18-5951-8bfa-aed7c2bddd7e'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, '5t-painted-snowflakes-rosewater-mommy-me-organic-cotton-tw', 'Painted Snowflakes Rosewater Mommy & Me Organic Cotton Two-Piece Pajamas', 'clothes', '5', 'Burt''s Bees Baby', 21.95, 'https://www.burtsbeesbaby.com/products/painted-snowflakes-rosewater-organic-cotton-two-piece-pajamas', '/catalog/5t-painted-snowflakes-rosewater-mommy-me-organic-cotton-tw.jpg', true, true, false, false, '2T,3T,4T,5T,6Y,8Y,10Y,12Y', 85)
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
  sort = EXCLUDED.sort;
