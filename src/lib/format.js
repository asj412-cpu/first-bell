const TZ = 'America/Chicago'

export function parseLocalDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatLongDate(isoDate) {
  return parseLocalDate(isoDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatShortDate(isoDate) {
  return parseLocalDate(isoDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  const mins = String(m).padStart(2, '0')
  return `${hr}:${mins}${ampm}`
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)}–${formatTime(end)} CT`
}

export function daysUntil(isoDate, from = new Date()) {
  const target = parseLocalDate(isoDate)
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  return Math.round((target - start) / 86400000)
}

export function greeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }).format(now),
  )
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function todayLabel(now = new Date()) {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: TZ,
  })
}

export function monthLabel(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function relativeMail(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function countdownCopy(isoDate) {
  const n = daysUntil(isoDate)
  if (n > 1) return `${n} days`
  if (n === 1) return 'Tomorrow'
  if (n === 0) return 'Today'
  if (n === -1) return 'Yesterday'
  return `${Math.abs(n)} days ago`
}
