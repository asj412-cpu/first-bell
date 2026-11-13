import assert from 'node:assert/strict'
import test from 'node:test'
import { GRAB_AND_GO, MEALS } from '../data/meals.js'
import { defaultProfiles } from '../data/profiles.js'
import {
  FAMILY_SLOTS,
  SEASONAL_MEAL_SHARE,
  flavorRuns,
  grabAndGoForWeek,
  groceryFromSlots,
  isSchoolDay,
  planStats,
  seasonalMealCap,
  suggestWeek,
  swapInPool,
} from './planner.js'

const NOW = new Date('2026-11-13T18:00:00Z')
const WEEK = '2026-11-09'

function weekFor(profiles = defaultProfiles(), recipes) {
  return suggestWeek({
    weekStart: WEEK,
    profiles,
    existing: {},
    recipes,
    now: NOW,
  })
}

test('seasonal share is one constant in the 20–25% range', () => {
  assert.equal(SEASONAL_MEAL_SHARE, 0.22)
  assert.equal(seasonalMealCap(16), 4)
})

test('November week for the Johnsons', () => {
  const slots = weekFor()
  assert.equal(MEALS.some((meal) => meal.category === 'baby'), false)
  for (const date of Object.keys(slots)) {
    assert.equal(slots[date].babyBreakfast, undefined)
    assert.equal(slots[date].babyLunch, undefined)
    assert.equal(slots[date].babyDinner, undefined)
    for (const slot of FAMILY_SLOTS) {
      const cell = slots[date][slot]
      if (slot === 'breakfast' && isSchoolDay(date)) {
        assert.equal(cell.grabAndGo, true)
        assert.equal(cell.mealId, null)
        continue
      }
      assert.equal(cell.grabAndGo, undefined)
      const meal = MEALS.find((item) => item.id === cell.mealId)
      assert.ok(meal, `${date} ${slot} missing meal`)
      assert.ok(meal.proteinAnchor, `${meal.title} has no protein anchor`)
      assert.equal(typeof meal.proteinGrams, 'number')
      if (slot === 'dinner' || slot === 'breakfast') {
        assert.ok(meal.proteinGrams >= 6, meal.title)
      }
    }
  }
  const stats = planStats(slots)
  assert.equal(stats.planned, 16)
  assert.equal(stats.cap, 4)
  assert.ok(stats.seasonal > 0 && stats.seasonal <= stats.cap)
  assert.deepEqual(flavorRuns(slots, WEEK), [])
  const grabs = grabAndGoForWeek(WEEK)
  assert.equal(grabs.length, 4)
  assert.ok(grabs.every((item) => item.proteinGrams > 0))
  const dinnerStyle = /tuna|lentil|bean|salmon|beef|pork|shrimp/i
  for (const item of GRAB_AND_GO) {
    const text = `${item.title} ${item.blurb} ${(item.ingredients || []).map((row) => row.name).join(' ')}`
    assert.equal(dinnerStyle.test(text), false, item.title)
  }
  const grocery = groceryFromSlots(slots, MEALS, WEEK)
  const names = grocery.map((item) => item.name)
  assert.equal(names.includes('Infant oatmeal'), false)
  assert.equal(names.includes('Honey'), false)
  assert.equal(names.includes('Canned light tuna in water'), false)
  assert.ok(grabs.some((item) => item.ingredients.some((ingredient) => names.includes(ingredient.name))))
  const nutFree = grabAndGoForWeek(WEEK, GRAB_AND_GO, ['nut'])
  assert.equal(nutFree.some((item) => item.id === 'grab-pb-toast'), false)
  const cookedBreakfastIds = new Set(
    ['2026-11-14', '2026-11-15'].map((date) => slots[date].breakfast.mealId),
  )
  for (const date of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
    assert.equal(cookedBreakfastIds.has(slots[date].breakfast.mealId), false)
  }
})

test('swap keeps the cap and does not seat the same flavor back to back', () => {
  let slots = weekFor()
  const dates = Object.keys(slots).sort()
  for (const date of dates) {
    for (const slot of ['lunch', 'dinner']) {
      slots = swapInPool({
        slots,
        date,
        slot,
        profiles: defaultProfiles(),
        weekStart: WEEK,
        now: NOW,
      })
    }
  }
  const stats = planStats(slots)
  assert.ok(stats.seasonal <= stats.cap)
  assert.deepEqual(flavorRuns(slots, WEEK), [])
  assert.equal(slots['2026-11-09'].breakfast.grabAndGo, true)
})

test('peppermint and pumpkin do not sit back to back and stay under the cap', () => {
  const plain = (id, category) => ({
    id,
    title: id,
    category,
    ageBands: ['preschool', 'elementary', 'tween'],
    seasons: ['any'],
    allergens: [],
    proteinAnchor: 'Eggs',
    proteinGrams: 13,
    plan: true,
    ingredients: [],
  })
  const themed = (id, category, flavor) => ({
    ...plain(id, category),
    seasons: ['fall'],
    flavor,
    seasonalTheme: true,
    proteinGrams: 20,
  })
  const recipes = [
    ...['b1', 'b2', 'b3'].map((id) => plain(id, 'breakfast')),
    ...['l1', 'l2', 'l3', 'l4', 'l5'].map((id) => plain(id, 'school-lunch')),
    ...['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((id) => plain(id, 'weeknight')),
    themed('pump-b', 'breakfast', 'pumpkin'),
    themed('pump-l', 'school-lunch', 'pumpkin'),
    themed('pump-d', 'weeknight', 'pumpkin'),
    themed('mint-b', 'breakfast', 'peppermint'),
    themed('mint-l', 'school-lunch', 'peppermint'),
    themed('mint-d', 'weeknight', 'peppermint'),
  ]
  const slots = weekFor(defaultProfiles(), recipes)
  const stats = planStats(slots, recipes)
  assert.ok(stats.seasonal <= stats.cap)
  assert.ok(stats.seasonal >= 1)
  const runs = []
  const dates = Object.keys(slots).sort()
  const sequence = []
  for (const date of dates) {
    for (const slot of FAMILY_SLOTS) sequence.push(slots[date][slot])
  }
  for (let i = 1; i < sequence.length; i += 1) {
    const prev = recipes.find((item) => item.id === sequence[i - 1].mealId)
    const next = recipes.find((item) => item.id === sequence[i].mealId)
    if (prev?.flavor && next?.flavor && prev.flavor === next.flavor) runs.push(prev.flavor)
  }
  assert.deepEqual(runs, [])
})
