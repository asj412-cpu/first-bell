import { EVENTS } from '../data/seed.js'
import { formatLongDate, formatTime, formatTimeRange } from './format.js'
import { addDaysIso, chicagoParts, zonedWallToUtc } from './time.js'

/** Timed events with no end use one hour. All-day events end at the next Chicago midnight. */
export const DEFAULT_DURATION_MS = 60 * 60 * 1000

export function wallEvent({
  id,
  title,
  kind = 'plan',
  date,
  start,
  end,
  allDay = false,
  place = '',
  partyId = null,
  notes = '',
  draft = false,
  checklist = [],
  archivedAt = null,
  source = 'seed',
}) {
  const startsAt = zonedWallToUtc(date, allDay ? '00:00' : start || '09:00').toISOString()
  let endsAt = null
  if (allDay) endsAt = zonedWallToUtc(addDaysIso(date, 1), '00:00').toISOString()
  else if (end) endsAt = zonedWallToUtc(date, end).toISOString()
  return {
    id,
    title,
    kind,
    startsAt,
    endsAt,
    allDay: Boolean(allDay),
    place,
    partyId,
    notes,
    draft: Boolean(draft),
    checklist,
    archivedAt,
    source,
  }
}

export function seedCalendarEvents() {
  return EVENTS.map((event) =>
    wallEvent({
      id: event.id,
      title: event.title,
      kind: event.kind,
      date: event.date,
      start: event.start,
      end: event.end,
      allDay: Boolean(event.allDay),
      place: event.place,
      partyId: event.partyId || null,
      source: 'seed',
    }),
  )
}

export function effectiveEndMs(event) {
  if (event.endsAt) return new Date(event.endsAt).getTime()
  return new Date(event.startsAt).getTime() + DEFAULT_DURATION_MS
}

/** Done when the end (or start + 1 hour) is before now. America/Chicago is baked into the timestamps. */
export function isFinished(event, now = new Date()) {
  if (!event?.startsAt) return false
  return effectiveEndMs(event) < now.getTime()
}

export function splitEvents(events, now = new Date()) {
  const upcoming = []
  const history = []
  for (const event of events || []) {
    if (isFinished(event, now)) history.push(event)
    else upcoming.push(event)
  }
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  history.sort((a, b) => effectiveEndMs(b) - effectiveEndMs(a))
  return { upcoming, history }
}

export function eventDateIso(event) {
  return chicagoParts(new Date(event.startsAt)).iso
}

export function eventWhenLabel(event) {
  const start = chicagoParts(new Date(event.startsAt))
  const dateLabel = formatLongDate(start.iso)
  if (event.allDay) return `${dateLabel} · All day`
  const startHm = `${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}`
  if (!event.endsAt) return `${dateLabel} · ${formatTime(startHm)} CT`
  const end = chicagoParts(new Date(event.endsAt))
  if (end.iso !== start.iso) return `${dateLabel} · ${formatTime(startHm)} CT`
  const endHm = `${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}`
  return `${dateLabel} · ${formatTimeRange(startHm, endHm)}`
}

export function mergeEvents(saved, seeds = seedCalendarEvents()) {
  const list = Array.isArray(saved) ? saved : []
  const seedIds = new Set(seeds.map((event) => event.id))
  const mergedSeeds = seeds.map((seed) => {
    const over = list.find((event) => event.id === seed.id)
    if (!over) return seed
    return { ...seed, archivedAt: over.archivedAt ?? null, checklist: over.checklist || [] }
  })
  const extras = []
  const seen = new Set()
  for (const event of list) {
    if (!event?.id || seedIds.has(event.id) || !event.startsAt || seen.has(event.id)) continue
    seen.add(event.id)
    extras.push(event)
  }
  return [...mergedSeeds, ...extras]
}

export function rsvpSummary(guests) {
  const counts = { yes: 0, no: 0, maybe: 0, none: 0 }
  for (const guest of guests || []) {
    const key = guest.status === 'no_response' ? 'none' : guest.status
    if (counts[key] == null) counts.none += 1
    else counts[key] += 1
  }
  return counts
}
