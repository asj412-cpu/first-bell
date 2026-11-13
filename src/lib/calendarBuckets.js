/**
 * Calendar noise filter. Edit the lists in this file to change what counts
 * as a major event versus a daily family activity.
 *
 * Order:
 * 1. Built-in holidays, birthdays, and parties are always major.
 * 2. MAJOR_FIRST matches the title (birthday, party, deadline, Wonderland, …)
 *    even when a routine word is also present ("class party deadline").
 * 3. DAILY_KEYWORDS match practices, games, PE, classes, appointments, and
 *    other routine items.
 * 4. MAJOR_ALSO matches one-offs that should not steal the word "game"
 *    (field trip, tournament, school break).
 * 5. Anything left with a clock time is daily. This is the default for
 *    imported timed events. All-day leftovers are major.
 */

export const CALENDAR_FILTER_KEY = 'first-bell.calendar-filters'

/** Checked before daily keywords. */
export const MAJOR_FIRST = [
  [/\bbirthdays?\b/i, 'birthday'],
  [/\bholidays?\b/i, 'holiday'],
  [/\bchristmas\b/i, 'christmas'],
  [/\bthanksgiving\b/i, 'thanksgiving'],
  [/\bhalloween\b/i, 'halloween'],
  [/\beaster\b/i, 'easter'],
  [/\bnew year/i, 'new year'],
  [/\bvalentine/i, 'valentine'],
  [/\bjuneteenth\b/i, 'juneteenth'],
  [/\bindependence day\b/i, 'independence day'],
  [/\bparties\b|\bparty\b/i, 'party'],
  [/\bshowers?\b/i, 'shower'],
  [/\bwedding\b/i, 'wedding'],
  [/\bbaptisms?\b/i, 'baptism'],
  [/\btrips?\b/i, 'trip'],
  [/\btravels?\b|\bvacation\b/i, 'travel'],
  [/\bflights?\b/i, 'flight'],
  [/\bwonderland\b/i, 'wonderland'],
  [/\bfestivals?\b/i, 'festival'],
  [/\bconcerts?\b/i, 'concert'],
  [/\bdeadlines?\b/i, 'deadline'],
  [/\bdue\b/i, 'due'],
  [/\bband\b/i, 'band'],
]

/** Routine family activity. Loses to MAJOR_FIRST, beats MAJOR_ALSO. */
export const DAILY_KEYWORDS = [
  [/\bpractices?\b/i, 'practice'],
  [/\bgames?\b/i, 'game'],
  [/\bjamborees?\b/i, 'jamboree'],
  [/\bpe\b/i, 'PE'],
  [/\bclasses?\b/i, 'class'],
  [/\bappointments?\b/i, 'appointment'],
  [/\bconferences?\b/i, 'conference'],
  [/\bphysicals?\b/i, 'physical'],
  [/\bcheck-?ups?\b/i, 'checkup'],
  [/\bdoctors?\b/i, 'doctor'],
  [/\blessons?\b/i, 'lesson'],
  [/\bwear\b/i, 'wear'],
  [/\bspirit\b/i, 'spirit'],
  [/\bno visitors\b/i, 'no visitors'],
  [/\btesting\b/i, 'testing'],
  [/\bred ribbon\b/i, 'red ribbon'],
  [/\bpajamas?\b/i, 'pajama'],
  [/\bpicture days?\b/i, 'picture day'],
  [/\bretakes?\b/i, 'retake'],
  [/\blab draws?\b/i, 'lab draw'],
]

/** One-offs that should stay when daily activities are hidden. */
export const MAJOR_ALSO = [
  [/\bfield trips?\b/i, 'field trip'],
  [/\btournaments?\b/i, 'tournament'],
  [/\bkids off\b/i, 'kids off'],
  [/\bno school\b/i, 'no school'],
  [/\b(winter|spring|summer|fall) break\b/i, 'break'],
  [/\bclosed\b/i, 'closed'],
  [/\bstaff development\b/i, 'staff development'],
  [/\bearly release\b/i, 'early release'],
  [/\bparades?\b/i, 'parade'],
  [/\bceremon(?:y|ies)\b/i, 'ceremony'],
]

function titleOf(event) {
  return `${event?.title || ''} ${event?.notes || ''}`
}

function matches(rules, text) {
  return rules.some(([pattern]) => pattern.test(text))
}

/** @returns {'major' | 'daily'} */
export function eventBucket(event) {
  const kind = event?.kind
  const source = event?.source
  if (
    kind === 'holiday' ||
    kind === 'birthday' ||
    kind === 'party' ||
    source === 'holiday' ||
    source === 'birthday'
  ) {
    return 'major'
  }
  const title = titleOf(event)
  if (matches(MAJOR_FIRST, title)) return 'major'
  if (matches(DAILY_KEYWORDS, title)) return 'daily'
  if (matches(MAJOR_ALSO, title)) return 'major'
  return event?.allDay ? 'major' : 'daily'
}

export function readCalendarFilters() {
  const fallback = { major: true, daily: true }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = JSON.parse(localStorage.getItem(CALENDAR_FILTER_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return fallback
    return {
      major: raw.major !== false,
      daily: raw.daily !== false,
    }
  } catch {
    return fallback
  }
}

export function writeCalendarFilters(filters) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    CALENDAR_FILTER_KEY,
    JSON.stringify({
      major: filters.major !== false,
      daily: filters.daily !== false,
    }),
  )
}

export function passesCalendarFilter(event, filters) {
  const on = filters || { major: true, daily: true }
  return on[eventBucket(event)] !== false
}
