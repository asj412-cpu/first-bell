import { holidaysForYear } from '../data/holidays.js'
import { upcomingBirthdays } from './birthdays.js'
import { isFinished, wallEvent } from './events.js'
import { chicagoParts } from './time.js'

function holidaySuggestion(holiday) {
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
  const endsAt = row.ends_at || row.endsAt || null
  const date = chicagoParts(new Date(startsAt)).iso
  return {
    id: row.id || `import-${row.external_uid || row.externalUid}`,
    key: `import:${row.external_uid || row.externalUid}`,
    title: row.title,
    kind: 'import',
    startsAt,
    endsAt,
    allDay: Boolean(row.all_day ?? row.allDay),
    place: row.location || '',
    location: row.location || '',
    notes: row.notes || '',
    date,
    source: 'import',
    sourceLabel: row.source || 'Family calendar',
    draft: false,
    checklist: [],
    partyId: null,
    archivedAt: null,
  }
}

export function buildNextUp({ imports = [], profiles = [], reminders = [], now = new Date(), limit = 5 } = {}) {
  const year = chicagoParts(now).year
  const holidays = [...holidaysForYear(year), ...holidaysForYear(year + 1)].map(holidaySuggestion)
  const imported = (imports || []).filter((row) => row && row.title && (row.starts_at || row.startsAt)).map(importSuggestion)
  const birthdays = upcomingBirthdays(profiles, now)
  const merged = [...holidays, ...imported, ...birthdays, ...reminders]
    .filter((item) => !isFinished(item, now))
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)) || String(a.title).localeCompare(String(b.title)))
  const soon = merged.slice(0, limit)
  const soonKeys = new Set(soon.map((item) => item.key))
  return {
    soon,
    birthdays: birthdays.filter((item) => !soonKeys.has(item.key)),
    renewals: reminders.filter((item) => !soonKeys.has(item.key)),
  }
}

export const PLAN_CHECKLIST = [
  { id: 'when', text: 'Pick a time', done: false },
  { id: 'who', text: 'Decide who’s coming', done: false },
  { id: 'need', text: 'List what we need', done: false },
]
