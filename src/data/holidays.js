/** US + Texas holidays. Dates are computed; nothing here is a family event. */

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const delta = (weekday - first.getUTCDay() + 7) % 7
  return 1 + delta + (n - 1) * 7
}

function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0))
  const delta = (last.getUTCDay() - weekday + 7) % 7
  return last.getUTCDate() - delta
}

/** Anonymous Gregorian computus. Month is 3 or 4. */
export function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

export function holidaysForYear(year) {
  const easter = easterSunday(year)
  const rows = [
    ['new-year', 'New Year’s Day', 1, 1],
    ['mlk', 'Martin Luther King Jr. Day', 1, nthWeekday(year, 1, 1, 3)],
    ['valentines', 'Valentine’s Day', 2, 14],
    ['presidents', 'Presidents Day', 2, nthWeekday(year, 2, 1, 3)],
    ['texas-independence', 'Texas Independence Day', 3, 2],
    ['easter', 'Easter', easter.month, easter.day],
    ['mothers', 'Mother’s Day', 5, nthWeekday(year, 5, 0, 2)],
    ['memorial', 'Memorial Day', 5, lastWeekday(year, 5, 1)],
    ['fathers', 'Father’s Day', 6, nthWeekday(year, 6, 0, 3)],
    ['juneteenth', 'Juneteenth', 6, 19],
    ['july-4', 'Independence Day', 7, 4],
    ['labor', 'Labor Day', 9, nthWeekday(year, 9, 1, 1)],
    ['halloween', 'Halloween', 10, 31],
    ['veterans', 'Veterans Day', 11, 11],
    ['thanksgiving', 'Thanksgiving', 11, nthWeekday(year, 11, 4, 4)],
    ['christmas-eve', 'Christmas Eve', 12, 24],
    ['christmas', 'Christmas Day', 12, 25],
    ['nye', 'New Year’s Eve', 12, 31],
  ]
  return rows.map(([key, title, month, day]) => ({
    id: `holiday-${key}-${year}`,
    key,
    title,
    date: iso(year, month, day),
    kind: 'holiday',
  }))
}
