/**
 * Make America Healthy Again / Dietary Guidelines for Americans, 2025–2030.
 * Figures below are quoted from those publications. Protein grams on a meal
 * come from USDA FoodData Central via src/data/proteinBasis.js, for the
 * anchor portion only.
 *
 * Sources (retrieved 2026-11-13):
 * - https://realfood.gov/
 * - https://cdn.realfood.gov/DGA.pdf
 * - https://www.usda.gov/about-usda/news/press-releases/2026/01/07/kennedy-rollins-unveil-historic-reset-us-nutrition-policy-put-real-food-back-center-health
 * - https://fdc.nal.usda.gov/
 */

export const GUIDANCE_SOURCES = [
  {
    id: 'realfood',
    label: 'realfood.gov',
    href: 'https://realfood.gov/',
  },
  {
    id: 'dga',
    label: 'Dietary Guidelines for Americans, 2025–2030 (PDF)',
    href: 'https://cdn.realfood.gov/DGA.pdf',
  },
  {
    id: 'usda',
    label: 'HHS and USDA announcement, January 7, 2026',
    href: 'https://www.usda.gov/about-usda/news/press-releases/2026/01/07/kennedy-rollins-unveil-historic-reset-us-nutrition-policy-put-real-food-back-center-health',
  },
  {
    id: 'fdc',
    label: 'USDA FoodData Central',
    href: 'https://fdc.nal.usda.gov/',
  },
]

/** Daily protein goal stated by the 2025–2030 Guidelines and realfood.gov. */
export const PROTEIN_GOAL = '1.2–1.6 grams of protein per kilogram of body weight per day'

/** Added-sugar ceiling for one meal, from the 2025–2030 Guidelines. */
export const ADDED_SUGAR_MEAL_CAP_G = 10
