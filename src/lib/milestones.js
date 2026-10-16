import { addDaysIso, chicagoTodayIso } from './time.js'

/** Ages Andrew asked to celebrate. Decades continue past 30. */
export const MILESTONE_WINDOW_DAYS = 90

const NAMED_MILESTONES = new Set([1, 5, 10, 13, 16, 18, 21])

export function isMilestoneAge(age) {
  if (age == null || age < 1) return false
  if (NAMED_MILESTONES.has(age)) return true
  return age >= 30 && age % 10 === 0
}

export function ordinal(age) {
  const n = Math.abs(Number(age))
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** Whole days from a Chicago calendar day to an ISO date. */
export function daysUntilIso(isoDate, todayIso) {
  if (!isoDate || !todayIso) return null
  const [y, m, d] = isoDate.split('-').map(Number)
  const [Y, M, D] = todayIso.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(Y, M - 1, D)) / 86400000)
}

export function withMilestone(birthday, todayIso) {
  const days = daysUntilIso(birthday.date, todayIso)
  const milestone = isMilestoneAge(birthday.turns)
  return {
    ...birthday,
    milestone,
    days,
    countdownOpen: milestone && days != null && days >= 0 && days <= MILESTONE_WINDOW_DAYS,
  }
}

/**
 * Next milestone birthdays, plus anyone sharing that calendar day.
 * A milestone the following day stays in the same cluster (Megan on the 9th, Drew and Claire on the 10th).
 * The 90-day countdown is longer than the normal Next up list of five.
 */
export function milestoneSpotlight(birthdays, now = new Date()) {
  const today = chicagoTodayIso(now)
  const upcoming = (birthdays || [])
    .map((birthday) => withMilestone(birthday, today))
    .filter((birthday) => birthday.days != null && birthday.days >= 0)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.who).localeCompare(String(b.who)))

  const first = upcoming.find((birthday) => birthday.milestone)
  if (!first) return []

  const through = addDaysIso(first.date, 1)
  const cluster = upcoming.filter((birthday) => birthday.date >= first.date && birthday.date <= through)
  const dates = [...new Set(cluster.map((birthday) => birthday.date))]

  return dates.map((date) => {
    const people = cluster.filter((birthday) => birthday.date === date)
    const milestones = people.filter((birthday) => birthday.milestone)
    const companions = people.filter((birthday) => !birthday.milestone)
    const lead = milestones[0] || people[0]
    return {
      date,
      people,
      milestones,
      companions,
      lead,
      days: lead.days,
      countdownOpen: milestones.some((birthday) => birthday.countdownOpen),
    }
  })
}
