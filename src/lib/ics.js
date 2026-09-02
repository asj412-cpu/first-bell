import { PARTY } from '../data/seed.js'

function stamp(date, time) {
  const compact = `${date.replaceAll('-', '')}T${time.replace(':', '')}00`
  return compact
}

export function partyIcs(party = PARTY) {
  const uid = `${party.id}@firstbell.local`
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//First Bell//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:First Bell',
    'X-WR-TIMEZONE:America/Chicago',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:20260901T120000Z`,
    `DTSTART;TZID=America/Chicago:${stamp(party.date, party.start)}`,
    `DTEND;TZID=America/Chicago:${stamp(party.date, party.end)}`,
    `SUMMARY:${party.headline}`,
    `LOCATION:${party.venue.name}\\, ${party.venue.address}`,
    `DESCRIPTION:${party.theme}. ${party.venue.package} ${party.venue.packageDetail}. RSVP Andrew ${party.contactPhone || '936-355-1281'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  return ics
}

export function downloadIcs(filename, body) {
  const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
