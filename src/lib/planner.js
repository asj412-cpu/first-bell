import { GRAB_AND_GO, MEALS, mealById } from '../data/meals.js'
import { addDaysIso, chicagoParts, mondayOnOrBefore, weekDates } from './time.js'

export const SEASON_PRODUCE = {
  fall: ['sweet potatoes', 'pumpkin', 'pecans', 'apples', 'greens'],
  winter: ['Rio Red grapefruit', 'oranges', 'cabbage', 'broccoli'],
  spring: ['strawberries', 'peaches', 'asparagus'],
  summer: ['watermelon', 'peaches', 'corn', 'tomatoes', 'okra'],
}

export const AISLE_ORDER = ['Produce', 'Dairy', 'Protein', 'Bakery', 'Pantry', 'Frozen', 'Snacks']

/**
 * Share of planned meals (not weekday grab-and-go) that may carry a seasonal
 * or holiday flavor. Andrew, Nov 13 2026: keep that share about 20–25%.
 * This is the only knob. 16 planned meals × 0.22 rounds to 4 (25%).
 */
export const SEASONAL_MEAL_SHARE = 0.22

export const GRAB_AND_GO_COUNT = 4

export const FLAVOR_LABEL = {
  pumpkin: 'Pumpkin',
  cranberry: 'Cranberry',
  pecan: 'Pecan',
  peppermint: 'Peppermint',
}

export function seasonalMealCap(plannedCount) {
  if (!plannedCount || plannedCount < 1) return 0
  return Math.round(plannedCount * SEASONAL_MEAL_SHARE)
}

export function seasonForIso(iso) {
  const month = Number(iso.slice(5, 7))
  if (month === 12 || month <= 2) return 'winter'
  if (month <= 5) return 'spring'
  if (month <= 8) return 'summer'
  return 'fall'
}

export function ageParts(birthDate, now = new Date()) {
  if (!birthDate) return null
  const today = chicagoParts(now)
  const [year, month, day] = birthDate.split('-').map(Number)
  if (!year || !month || !day) return null
  let years = today.year - year
  let months = today.month - month
  if (today.day < day) months -= 1
  if (months < 0) {
    years -= 1
    months += 12
  }
  if (years < 0) return { years: 0, months: 0, totalMonths: 0 }
  return { years, months, totalMonths: years * 12 + months }
}

export function ageInYears(birthDate, now = new Date()) {
  const parts = ageParts(birthDate, now)
  return parts ? parts.years : null
}

export function ageLabel(birthDate, now = new Date()) {
  const parts = ageParts(birthDate, now)
  if (!parts) return ''
  if (parts.totalMonths < 12) {
    return parts.totalMonths === 1 ? '1 month' : `${parts.totalMonths} months`
  }
  return parts.years === 1 ? '1 year' : `${parts.years} years`
}

export function bandForAge(age) {
  if (age == null) return null
  if (typeof age === 'object') {
    if (age.totalMonths < 12) return 'infant'
    return bandForAge(age.years)
  }
  if (Number.isNaN(age)) return null
  if (age < 1) return 'infant'
  if (age <= 5) return 'preschool'
  if (age <= 10) return 'elementary'
  return 'tween'
}

export function kidProfiles(profiles) {
  return (profiles || []).filter((profile) => profile.role !== 'parent')
}

/** Shared-table bands. Infants eat the family meal, mashed when it is soft. */
export function tableBands(profiles, now = new Date()) {
  const bands = new Set()
  for (const profile of kidProfiles(profiles)) {
    const band = bandForAge(ageParts(profile.birthDate, now))
    if (band && band !== 'infant') bands.add(band)
  }
  return [...bands]
}

export function infantProfiles(profiles, now = new Date()) {
  return kidProfiles(profiles).filter((profile) => bandForAge(ageParts(profile.birthDate, now)) === 'infant')
}

export function knownBands(profiles, now = new Date()) {
  return tableBands(profiles, now)
}

export function allergenKeys(profiles) {
  const notes = (profiles || []).map((profile) => (profile.notes || '').toLowerCase()).join('\n')
  const keys = []
  if (/nut|pecan|peanut|almond|walnut/.test(notes)) keys.push('nut')
  if (/dairy|milk|cheese|lactose|yogurt/.test(notes)) keys.push('dairy')
  if (/\begg/.test(notes)) keys.push('egg')
  if (/gluten|wheat/.test(notes)) keys.push('gluten')
  return keys
}

export function isSchoolDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return weekday >= 1 && weekday <= 5
}

export function isWeekdayBreakfast(dateIso, slot) {
  return slot === 'breakfast' && isSchoolDay(dateIso)
}

export const FAMILY_SLOTS = ['breakfast', 'lunch', 'dinner']

export function categoriesForSlot(slot) {
  if (slot === 'breakfast') return ['breakfast']
  if (slot === 'lunch') return ['school-lunch']
  return ['weeknight', 'weekend']
}

export function grabAndGoForWeek(weekStart, options = GRAB_AND_GO, allergens = []) {
  const pool = options.filter((item) => !(item.allergens || []).some((key) => allergens.includes(key)))
  if (!pool.length) return []
  const count = Math.min(GRAB_AND_GO_COUNT, pool.length)
  let start = 0
  for (const ch of String(weekStart || '')) start = (start + ch.charCodeAt(0)) % pool.length
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length])
}

function matchesBands(recipe, bands) {
  if (bands.length && !bands.every((band) => (recipe.ageBands || []).includes(band))) return false
  if (!bands.length && !(recipe.ageBands || []).includes('preschool')) return false
  return true
}

function inSeason(recipe, season) {
  const seasons = recipe.seasons || []
  return seasons.includes(season) || seasons.includes('any')
}

function candidates({ recipes, categories, season, bands, allergens, seasonal }) {
  return recipes.filter((recipe) => {
    if (recipe.plan === false || recipe.highlyProcessed) return false
    if (!categories.includes(recipe.category)) return false
    if ((recipe.allergens || []).some((key) => allergens.includes(key))) return false
    if (!matchesBands(recipe, bands)) return false
    if (!recipe.proteinAnchor || recipe.proteinGrams == null) return false
    if (seasonal) {
      return Boolean(recipe.seasonalTheme && recipe.flavor && (recipe.seasons || []).includes(season))
    }
    if (recipe.seasonalTheme) return false
    return inSeason(recipe, season)
  })
}

function scoreRecipe(recipe, season) {
  let score = recipe.proteinGrams || 0
  if (recipe.refinedGrain) score -= 25
  if ((recipe.seasons || []).includes(season)) score += 3
  return score
}

function rankPool(pool, used, season, flavorCounts = {}) {
  return [...pool].sort((a, b) => {
    const aUsed = used.includes(a.id) ? 1 : 0
    const bUsed = used.includes(b.id) ? 1 : 0
    if (aUsed !== bUsed) return aUsed - bUsed
    const aFlavor = flavorCounts[a.flavor] || 0
    const bFlavor = flavorCounts[b.flavor] || 0
    if (aFlavor !== bFlavor) return aFlavor - bFlavor
    const scored = scoreRecipe(b, season) - scoreRecipe(a, season)
    if (scored !== 0) return scored
    return a.title.localeCompare(b.title)
  })
}

function weekCells(dates) {
  const cells = []
  for (const date of dates) {
    for (const slot of FAMILY_SLOTS) {
      cells.push({
        date,
        slot,
        grabAndGo: isWeekdayBreakfast(date, slot),
        locked: false,
        recipe: null,
      })
    }
  }
  return cells
}

function flavorClash(cells, index, flavor) {
  if (!flavor) return false
  for (const neighbor of [cells[index - 1], cells[index + 1]]) {
    if (neighbor?.recipe?.flavor && neighbor.recipe.flavor === flavor) return true
  }
  return false
}

function flavorCounts(cells) {
  const counts = {}
  for (const cell of cells) {
    if (cell.recipe?.flavor) counts[cell.recipe.flavor] = (counts[cell.recipe.flavor] || 0) + 1
  }
  return counts
}

function seasonalCount(cells) {
  return cells.filter((cell) => cell.recipe?.seasonalTheme).length
}

function writeSlots(cells) {
  const slots = {}
  for (const cell of cells) {
    slots[cell.date] = slots[cell.date] || {}
    if (cell.grabAndGo) {
      slots[cell.date][cell.slot] = { mealId: null, grabAndGo: true, locked: false }
      continue
    }
    slots[cell.date][cell.slot] = {
      mealId: cell.recipe?.id || null,
      locked: Boolean(cell.locked),
    }
  }
  return slots
}

function spreadIndexes(count, picks) {
  if (picks <= 0 || count <= 0) return []
  const chosen = []
  for (let i = 0; i < picks; i += 1) {
    const idx = Math.min(count - 1, Math.floor(((i + 0.5) * count) / picks))
    if (!chosen.includes(idx)) chosen.push(idx)
  }
  return chosen
}

export function suggestWeek({ weekStart, profiles, existing, recipes = MEALS, now = new Date() }) {
  const dates = weekDates(weekStart)
  const season = seasonForIso(weekStart)
  const bands = tableBands(profiles, now)
  const allergens = allergenKeys(profiles)
  const cells = weekCells(dates)
  const used = []
  const context = { recipes, season, bands, allergens }

  for (const cell of cells) {
    if (cell.grabAndGo) continue
    const prev = existing?.[cell.date]?.[cell.slot]
    if (!prev?.locked || !prev.mealId) continue
    const recipe = recipes.find((item) => item.id === prev.mealId) || mealById(prev.mealId)
    if (!recipe || String(cell.slot).startsWith('baby')) continue
    cell.locked = true
    cell.recipe = recipe
    used.push(recipe.id)
  }

  const open = cells.filter((cell) => !cell.grabAndGo && !cell.locked)
  for (const cell of open) {
    const pool = rankPool(
      candidates({ ...context, categories: categoriesForSlot(cell.slot), seasonal: false }),
      used,
      season,
    )
    const recipe = pool[0] || null
    cell.recipe = recipe
    if (recipe) used.push(recipe.id)
  }

  const cap = seasonalMealCap(cells.filter((cell) => !cell.grabAndGo).length)
  const preferred = new Set(spreadIndexes(open.length, Math.max(0, cap - seasonalCount(cells))))
  const order = open
    .map((cell, index) => index)
    .sort((a, b) => {
      const aPref = preferred.has(a) ? 0 : 1
      const bPref = preferred.has(b) ? 0 : 1
      if (aPref !== bPref) return aPref - bPref
      return a - b
    })

  for (const index of order) {
    if (seasonalCount(cells) >= cap) break
    const cell = open[index]
    const cellIndex = cells.findIndex((item) => item.date === cell.date && item.slot === cell.slot)
    const pool = rankPool(
      candidates({ ...context, categories: categoriesForSlot(cell.slot), seasonal: true }),
      used,
      season,
      flavorCounts(cells),
    )
    const recipe = pool.find((item) => !flavorClash(cells, cellIndex, item.flavor))
    if (!recipe) continue
    const previousId = cell.recipe?.id
    if (previousId) {
      const at = used.indexOf(previousId)
      if (at >= 0) used.splice(at, 1)
    }
    cell.recipe = recipe
    used.push(recipe.id)
  }

  return writeSlots(cells)
}

function cellsFromSlots(slots, dates, recipes) {
  const cells = weekCells(dates)
  for (const cell of cells) {
    const saved = slots?.[cell.date]?.[cell.slot]
    if (cell.grabAndGo) {
      cell.recipe = null
      continue
    }
    if (!saved) continue
    cell.locked = Boolean(saved.locked)
    cell.recipe = saved.mealId ? recipes.find((item) => item.id === saved.mealId) || mealById(saved.mealId) : null
  }
  return cells
}

export function swapInPool({ slots, date, slot, profiles, recipes = MEALS, now = new Date(), weekStart }) {
  const current = slots?.[date]?.[slot]
  if (!current || current.locked || current.grabAndGo || isWeekdayBreakfast(date, slot)) return slots
  const start = weekStart || mondayOnOrBefore(date)
  const dates = weekDates(start)
  const season = seasonForIso(start)
  const bands = tableBands(profiles, now)
  const allergens = allergenKeys(profiles)
  const cells = cellsFromSlots(slots, dates, recipes)
  const cellIndex = cells.findIndex((cell) => cell.date === date && cell.slot === slot)
  if (cellIndex < 0) return slots
  const context = { recipes, season, bands, allergens }
  const pool = [
    ...rankPool(candidates({ ...context, categories: categoriesForSlot(slot), seasonal: false }), [], season),
    ...rankPool(candidates({ ...context, categories: categoriesForSlot(slot), seasonal: true }), [], season),
  ]
  if (!pool.length) return slots
  const cap = seasonalMealCap(cells.filter((cell) => !cell.grabAndGo).length)
  const startAt = Math.max(0, pool.findIndex((recipe) => recipe.id === current.mealId))
  for (let step = 1; step <= pool.length; step += 1) {
    const recipe = pool[(startAt + step) % pool.length]
    if (recipe.id === current.mealId) continue
    const previous = cells[cellIndex].recipe
    cells[cellIndex].recipe = recipe
    const themed = seasonalCount(cells)
    const clash = flavorClash(cells, cellIndex, recipe.flavor)
    if (themed <= cap && !clash) {
      return writeSlots(cells)
    }
    cells[cellIndex].recipe = previous
  }
  return slots
}

function addIngredient(map, ingredient) {
  const id = `${ingredient.aisle}|${ingredient.name}`.toLowerCase()
  const row = map.get(id) || {
    id,
    name: ingredient.name,
    aisle: ingredient.aisle,
    qty: [],
    checked: false,
  }
  if (ingredient.qty && !row.qty.includes(ingredient.qty)) row.qty.push(ingredient.qty)
  map.set(id, row)
}

export function groceryFromSlots(slots, recipes = MEALS, weekStart, allergens = []) {
  const map = new Map()
  const dates = Object.keys(slots || {}).sort()
  const start = weekStart || (dates[0] ? mondayOnOrBefore(dates[0]) : null)
  let includeGrab = false
  for (const [date, day] of Object.entries(slots || {})) {
    for (const [key, slot] of Object.entries(day || {})) {
      if (String(key).startsWith('baby')) continue
      if (slot?.grabAndGo || isWeekdayBreakfast(date, key)) {
        includeGrab = true
        continue
      }
      const meal = recipes.find((recipe) => recipe.id === slot?.mealId)
      if (!meal) continue
      for (const ingredient of meal.ingredients || []) addIngredient(map, ingredient)
    }
  }
  if (includeGrab && start) {
    for (const option of grabAndGoForWeek(start, GRAB_AND_GO, allergens)) {
      for (const ingredient of option.ingredients || []) addIngredient(map, ingredient)
    }
  }
  return [...map.values()].sort((a, b) => {
    const aisle = AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle)
    if (aisle !== 0) return aisle
    return a.name.localeCompare(b.name)
  })
}

export function planStats(slots, recipes = MEALS) {
  let planned = 0
  let seasonal = 0
  const flavors = {}
  for (const day of Object.values(slots || {})) {
    for (const [key, cell] of Object.entries(day || {})) {
      if (String(key).startsWith('baby') || cell?.grabAndGo) continue
      if (!FAMILY_SLOTS.includes(key)) continue
      planned += 1
      const recipe = cell?.mealId
        ? recipes.find((item) => item.id === cell.mealId) || mealById(cell.mealId)
        : null
      if (recipe?.seasonalTheme) {
        seasonal += 1
        if (recipe.flavor) flavors[recipe.flavor] = (flavors[recipe.flavor] || 0) + 1
      }
    }
  }
  return { planned, seasonal, cap: seasonalMealCap(planned), share: SEASONAL_MEAL_SHARE, flavors }
}

export function flavorRuns(slots, weekStart) {
  const dates = weekDates(weekStart)
  const cells = cellsFromSlots(slots, dates, MEALS)
  const runs = []
  for (let i = 1; i < cells.length; i += 1) {
    const prev = cells[i - 1].recipe?.flavor
    const next = cells[i].recipe?.flavor
    if (prev && next && prev === next) runs.push({ flavor: prev, date: cells[i].date, slot: cells[i].slot })
  }
  return runs
}

export function mergeChecks(next, prev) {
  const checks = new Map((prev || []).map((item) => [item.id, item.checked]))
  return next.map((item) => ({ ...item, checked: Boolean(checks.get(item.id)) }))
}

export function currentWeekStart(now = new Date()) {
  return mondayOnOrBefore(chicagoParts(now).iso)
}

export function shiftWeek(weekStart, delta) {
  return addDaysIso(weekStart, delta * 7)
}

export function planningNote(profiles, now = new Date()) {
  const kids = kidProfiles(profiles).map((profile) => {
    const parts = ageParts(profile.birthDate, now)
    const band = bandForAge(parts)
    return {
      ...profile,
      parts,
      band,
      label: ageLabel(profile.birthDate, now),
    }
  })
  return {
    kids,
    infants: kids.filter((kid) => kid.band === 'infant'),
    schoolKids: kids.filter((kid) => kid.band && kid.band !== 'infant'),
    unknown: kids.filter((kid) => !kid.birthDate).map((kid) => kid.name),
    bands: tableBands(profiles, now),
  }
}
