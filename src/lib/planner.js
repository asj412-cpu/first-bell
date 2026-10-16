import { MEALS, mealById } from '../data/meals.js'
import { addDaysIso, chicagoParts, mondayOnOrBefore, weekDates } from './time.js'

export const SEASON_PRODUCE = {
  fall: ['sweet potatoes', 'pumpkin', 'pecans', 'apples', 'greens'],
  winter: ['Rio Red grapefruit', 'oranges', 'cabbage', 'broccoli'],
  spring: ['strawberries', 'peaches', 'asparagus'],
  summer: ['watermelon', 'peaches', 'corn', 'tomatoes', 'okra'],
}

export const AISLE_ORDER = ['Produce', 'Dairy', 'Protein', 'Bakery', 'Pantry', 'Frozen', 'Snacks', 'Baby']

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

/** Shared-table bands. Infants eat from the baby menu, not this list. */
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

export function slotCategory(dateIso, slot) {
  if (String(slot).startsWith('baby')) return 'baby'
  const school = isSchoolDay(dateIso)
  if (slot === 'breakfast') return 'breakfast'
  if (slot === 'lunch') return school ? 'school-lunch' : 'weekend'
  return school ? 'weeknight' : 'weekend'
}

export const FAMILY_SLOTS = ['breakfast', 'lunch', 'dinner']
export const BABY_SLOTS = ['babyBreakfast', 'babyLunch', 'babyDinner']

function poolFor({ recipes = MEALS, category, season, bands, allergens }) {
  const eligible = recipes.filter((recipe) => {
    if (recipe.category !== category) return false
    if ((recipe.allergens || []).some((key) => allergens.includes(key))) return false
    if (category === 'baby') return recipe.ageBands.includes('infant')
    if (bands.length && !bands.every((band) => recipe.ageBands.includes(band))) return false
    if (!bands.length && !recipe.ageBands.includes('preschool')) return false
    return true
  })
  const seasonal = eligible.filter((recipe) => recipe.seasons.includes(season))
  const anytime = eligible.filter((recipe) => recipe.seasons.includes('any'))
  const ordered = []
  for (const recipe of [...seasonal, ...anytime]) {
    if (!ordered.some((item) => item.id === recipe.id)) ordered.push(recipe)
  }
  return ordered
}

function pickFrom(pool, used) {
  if (!pool.length) return null
  const fresh = pool.filter((recipe) => !used.includes(recipe.id))
  if (fresh.length) return fresh[0]
  const index = used.length % pool.length
  return pool[index]
}

export function suggestWeek({ weekStart, profiles, existing, recipes = MEALS, now = new Date() }) {
  const dates = weekDates(weekStart)
  const season = seasonForIso(weekStart)
  const bands = tableBands(profiles, now)
  const allergens = allergenKeys(profiles)
  const includeBaby = infantProfiles(profiles, now).length > 0
  const slots = {}
  const used = []
  const usedBaby = []
  for (const date of dates) {
    slots[date] = {}
    const names = includeBaby ? [...FAMILY_SLOTS, ...BABY_SLOTS] : FAMILY_SLOTS
    for (const slot of names) {
      const prev = existing?.[date]?.[slot]
      if (prev?.locked && prev.mealId && mealById(prev.mealId)) {
        slots[date][slot] = { mealId: prev.mealId, locked: true }
        ;(String(slot).startsWith('baby') ? usedBaby : used).push(prev.mealId)
        continue
      }
      const category = slotCategory(date, slot)
      const meal = pickFrom(
        poolFor({ recipes, category, season, bands, allergens }),
        category === 'baby' ? usedBaby : used,
      )
      slots[date][slot] = { mealId: meal?.id || null, locked: false }
      if (meal) (category === 'baby' ? usedBaby : used).push(meal.id)
    }
  }
  return slots
}

export function swapInPool({ slots, date, slot, profiles, recipes = MEALS, now = new Date(), weekStart }) {
  const current = slots?.[date]?.[slot]
  if (!current || current.locked) return slots
  const season = seasonForIso(weekStart || date)
  const pool = poolFor({
    recipes,
    category: slotCategory(date, slot),
    season,
    bands: tableBands(profiles, now),
    allergens: allergenKeys(profiles),
  })
  if (!pool.length) return slots
  const index = pool.findIndex((recipe) => recipe.id === current.mealId)
  const next = pool[(index + 1) % pool.length]
  return {
    ...slots,
    [date]: {
      ...slots[date],
      [slot]: { mealId: next.id, locked: false },
    },
  }
}

export function groceryFromSlots(slots, recipes = MEALS) {
  const map = new Map()
  for (const day of Object.values(slots || {})) {
    for (const slot of Object.values(day || {})) {
      const meal = recipes.find((recipe) => recipe.id === slot.mealId)
      if (!meal) continue
      for (const ingredient of meal.ingredients) {
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
    }
  }
  return [...map.values()].sort((a, b) => {
    const aisle = AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle)
    if (aisle !== 0) return aisle
    return a.name.localeCompare(b.name)
  })
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
