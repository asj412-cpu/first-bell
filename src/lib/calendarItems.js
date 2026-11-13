import { holidaysForYear } from '../data/holidays.js'
import { birthdaysInYear } from './birthdays.js'
import { eventOccupies, isFinished } from './events.js'
import { holidaySuggestion, importSuggestion } from './nextup.js'

function pushUnique(into, seen, event) {
  if (!event?.id || seen.has(event.id) || !event.startsAt) return
  seen.add(event.id)
  into.push(event)
}

export function importedEvents(rows) {
  return (rows || [])
    .filter((row) => row && row.title && (row.starts_at || row.startsAt))
    .map(importSuggestion)
}

/**
 * Household plans, iCloud imports, birthdays, and built-in holidays.
 * Imports stay read-only. Nothing here is invented.
 */
export function gatherCalendarEvents({
  events = [],
  imports = [],
  profiles = [],
  years = [],
  now = new Date(),
  includeFinished = false,
} = {}) {
  const seen = new Set()
  const out = []
  for (const event of events || []) pushUnique(out, seen, event)
  for (const event of importedEvents(imports)) pushUnique(out, seen, event)
  for (const year of years) {
    for (const event of birthdaysInYear(profiles, year)) pushUnique(out, seen, event)
    for (const holiday of holidaysForYear(year)) pushUnique(out, seen, holidaySuggestion(holiday))
  }
  const visible = includeFinished ? out : out.filter((event) => !isFinished(event, now))
  visible.sort(byWhen)
  return visible
}

function byWhen(a, b) {
  if (Boolean(a.allDay) !== Boolean(b.allDay)) return a.allDay ? -1 : 1
  return String(a.startsAt).localeCompare(String(b.startsAt)) || String(a.title).localeCompare(String(b.title))
}

export function eventsOnDay(events, iso) {
  return (events || []).filter((event) => eventOccupies(event, iso)).sort(byWhen)
}
