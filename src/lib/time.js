const TZ = 'America/Chicago'

function partsFrom(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  let hour = Number(map.hour)
  let day = Number(map.day)
  let month = Number(map.month)
  let year = Number(map.year)
  if (hour === 24) {
    hour = 0
    const next = new Date(Date.UTC(year, month - 1, day + 1))
    year = next.getUTCFullYear()
    month = next.getUTCMonth() + 1
    day = next.getUTCDate()
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    iso,
  }
}

export function chicagoParts(date = new Date()) {
  return partsFrom(date, TZ)
}

export function chicagoTodayIso(date = new Date()) {
  return chicagoParts(date).iso
}

export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

function zoneOffsetMs(instant, timeZone) {
  const wall = partsFrom(instant, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - instant.getTime()
}

/** Wall-clock time in America/Chicago → UTC Date. */
export function zonedWallToUtc(isoDate, hhmm = '00:00', timeZone = TZ) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0))
  let utc = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone))
  const adjust = zoneOffsetMs(utc, timeZone)
  utc = new Date(guess.getTime() - adjust)
  return utc
}

export function mondayOnOrBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const diff = weekday === 0 ? -6 : 1 - weekday
  return addDaysIso(iso, diff)
}

export function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i))
}
