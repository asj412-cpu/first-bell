import { holidaysForYear } from '../data/holidays.js'
import { upcomingBirthdays } from './birthdays.js'
import { eventDayIsos, isFinished, wallEvent } from './events.js'
import { addDaysIso, chicagoParts, zonedWallToUtc } from './time.js'

export function holidaySuggestion(holiday) {
  const event = wallEvent({
    id: holiday.id,
    title: holiday.title,
    kind: 'holiday',
    date: holiday.date,
    allDay: true,
    source: 'holiday',
  })
  return {
    ...event,
    key: holiday.id,
    date: holiday.date,
    sourceLabel: 'Holiday',
    location: '',
  }
}

export function importSuggestion(row) {
  const startsAt = row.starts_at || row.startsAt
  let endsAt = row.ends_at || row.endsAt || null
  const allDay = Boolean(row.all_day ?? row.allDay)
  if (allDay && startsAt && !endsAt) {
    const startIso = eventDayIsos({ startsAt, allDay: true })[0]
    if (startIso) endsAt = zonedWallToUtc(addDaysIso(startIso, 1), '00:00').toISOString()
  }
  const event = {
    startsAt,
    endsAt,
    allDay,
  }
  const date = eventDayIsos(event)[0] || null
  return {
    id: row.id || `import-${row.external_uid || row.externalUid}`,
    key: `import:${row.external_uid || row.externalUid}`,
    title: row.title,
    kind: 'import',
    startsAt,
    endsAt,
    allDay,
    place: row.location || '',
    location: row.location || '',
    notes: row.notes || '',
    date,
    source: 'import',
    sourceLabel: 'Family calendar',
    readOnly: true,
    draft: false,
    checklist: [],
    partyId: null,
    archivedAt: null,
  }
}

export function buildNextUp({ imports = [], profiles = [], now = new Date(), limit = 5 } = {}) {
  const year = chicagoParts(now).year
  const holidays = [...holidaysForYear(year), ...holidaysForYear(year + 1)].map(holidaySuggestion)
  const imported = (imports || []).filter((row) => row && row.title && (row.starts_at || row.startsAt)).map(importSuggestion)
  const birthdays = upcomingBirthdays(profiles, now)
  const merged = [...holidays, ...imported, ...birthdays]
    .filter((item) => !isFinished(item, now))
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)) || String(a.title).localeCompare(String(b.title)))
  const soon = merged.slice(0, limit)
  const soonKeys = new Set(soon.map((item) => item.key))
  return {
    soon,
    birthdays: birthdays.filter((item) => !soonKeys.has(item.key)),
  }
}

export const PLAN_CHECKLIST = [
  { id: 'when', text: 'Pick a time', done: false },
  { id: 'who', text: 'Decide who’s coming', done: false },
  { id: 'need', text: 'List what we need', done: false },
]
