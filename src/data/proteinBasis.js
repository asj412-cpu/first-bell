/**
 * Protein for the anchor food only, not a full plate.
 *
 * Densities are USDA FoodData Central values retrieved 2026-11-13 from
 * https://api.nal.usda.gov/fdc/v1 (SR Legacy or Foundation). Portions use
 * gram weights that record publishes (3 oz cooked = 85 g on these meats
 * and fish, 1 large egg = 50 g, Greek yogurt RACC = 170 g, 1 cup beans or
 * lentils as listed, ½ cup creamed cottage cheese).
 *
 * Display grams are Math.round(per100g * portionGrams / 100). Do not add
 * figures that are not in this table.
 */

export const USDA_PROTEIN = {
  chickenBreast: {
    fdcId: 171477,
    per100: 31.02,
    food: 'roasted chicken breast, meat only',
  },
  chickenThigh: {
    fdcId: 172388,
    per100: 24.8,
    food: 'roasted chicken thigh, meat only',
  },
  beef90: {
    fdcId: 171794,
    per100: 28.45,
    food: '90% lean ground beef, cooked',
  },
  sirloin: {
    fdcId: 169458,
    per100: 29,
    food: 'broiled top sirloin, trimmed',
  },
  turkeyBreast: {
    fdcId: 171496,
    per100: 30.13,
    food: 'roasted turkey breast, meat only',
  },
  porkTenderloin: {
    fdcId: 168250,
    per100: 26.2,
    food: 'roasted pork tenderloin, lean',
  },
  salmon: {
    fdcId: 175168,
    per100: 22.1,
    food: 'cooked Atlantic salmon, farmed',
  },
  tunaLight: {
    fdcId: 334194,
    per100: 19,
    food: 'canned light tuna in water, drained',
  },
  eggHard: {
    fdcId: 173424,
    per100: 12.58,
    food: 'large egg, cooked',
  },
  greekYogurt: {
    fdcId: 2259794,
    per100: 8.77888,
    food: 'plain whole-milk Greek yogurt',
  },
  cottage: {
    fdcId: 172179,
    per100: 11.12,
    food: 'creamed cottage cheese',
  },
  wholeMilk: {
    fdcId: 746782,
    per100: 3.27,
    food: 'whole milk, 3.25% milkfat',
  },
  mozzarella: {
    fdcId: 171244,
    per100: 23.75,
    food: 'part-skim mozzarella',
  },
  peanutButter: {
    fdcId: 172470,
    per100: 22.21,
    food: 'smooth peanut butter, no salt',
  },
  wholeWheatBread: {
    fdcId: 172688,
    per100: 12.45,
    food: 'whole-wheat bread',
  },
  blackBeans: {
    fdcId: 175237,
    per100: 8.86,
    food: 'cooked black beans',
  },
  lentils: {
    fdcId: 172421,
    per100: 9.02,
    food: 'cooked lentils',
  },
}

export function proteinServing(id, portionG, portionLabel) {
  const row = USDA_PROTEIN[id]
  if (!row || !portionG || !portionLabel) return null
  const grams = Math.round((row.per100 * portionG) / 100)
  return {
    grams,
    fdcId: row.fdcId,
    basis: `${portionLabel} ${row.food} · USDA FoodData Central ${row.fdcId}`,
  }
}

/** Sum of documented portions, rounded once. Not a lab analysis of a mixed recipe. */
export function proteinFromParts(parts) {
  if (!parts?.length) return null
  let raw = 0
  const bits = []
  for (const part of parts) {
    const row = USDA_PROTEIN[part.id]
    if (!row || !part.portionG || !part.portionLabel) return null
    raw += (row.per100 * part.portionG) / 100
    bits.push(`${part.portionLabel} ${row.food} · FDC ${row.fdcId}`)
  }
  return {
    grams: Math.round(raw),
    basis: bits.join('; '),
  }
}
