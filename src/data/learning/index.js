import claireWeek from './weeks/2026-11-09-claire.json'

/**
 * Monday Peek weeks. To add one:
 * 1. Drop src/data/learning/weeks/YYYY-MM-DD-<kidKey>.json (Monday date).
 * 2. Import it below and append it to WEEKS.
 * 3. Rebuild. No other code change.
 * Field list: src/data/learning/schema.md
 */
const WEEKS = [claireWeek]

for (const week of WEEKS) {
  if (!week?.id || !week.kidKey || !week.weekStart || !week.weekEnd) {
    throw new Error('A learning week file is missing id, kidKey, weekStart, or weekEnd')
  }
}

export function allWeeks() {
  return WEEKS
}

export function weeksFor(kidKey) {
  return WEEKS.filter((week) => week.kidKey === kidKey).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart),
  )
}

export function weekById(id) {
  return WEEKS.find((week) => week.id === id) || null
}

export function weekFor(kidKey, weekStart) {
  return WEEKS.find((week) => week.kidKey === kidKey && week.weekStart === weekStart) || null
}

export function currentWeeks(todayIso) {
  return WEEKS.filter((week) => week.weekStart <= todayIso && todayIso <= week.weekEnd)
}

export function planForDate(week, iso) {
  if (!week || !iso) return null
  return (
    (week.plan || []).find((row) => {
      const end = row.endDate || row.date
      return row.date <= iso && iso <= end
    }) || null
  )
}
