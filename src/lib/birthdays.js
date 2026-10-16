import { wallEvent } from './events.js'
import { chicagoParts, chicagoTodayIso } from './time.js'

export function turningAge(birthDate, onIso) {
  if (!birthDate || !onIso) return null
  return Number(onIso.slice(0, 4)) - Number(birthDate.slice(0, 4))
}

export function turnsLabel(turns) {
  if (turns == null) return ''
  if (turns <= 0) return 'Born'
  if (turns === 1) return 'Turns 1'
  return `Turns ${turns}`
}

function birthdayEvent(profile, date) {
  const turns = turningAge(profile.birthDate, date)
  const year = date.slice(0, 4)
  const event = wallEvent({
    id: `birthday-${profile.memberKey}-${year}`,
    title: `${profile.fullName || profile.name}'s birthday`,
    kind: 'birthday',
    date,
    allDay: true,
    place: 'Home',
    source: 'birthday',
    notes: turnsLabel(turns),
  })
  return {
    ...event,
    key: event.id,
    date,
    turns,
    sourceLabel: 'Birthday',
    location: 'Home',
    memberKey: profile.memberKey,
    who: profile.name,
  }
}

export function birthdaysInYear(profiles, year) {
  return (profiles || [])
    .filter((profile) => profile.birthDate)
    .map((profile) => {
      const turns = year - Number(profile.birthDate.slice(0, 4))
      if (turns < 0) return null
      return birthdayEvent(profile, `${year}-${profile.birthDate.slice(5)}`)
    })
    .filter(Boolean)
}

/** Next occurrence that has not ended yet, including today. */
export function nextBirthday(profile, now = new Date()) {
  if (!profile?.birthDate) return null
  const today = chicagoTodayIso(now)
  const year = chicagoParts(now).year
  const md = profile.birthDate.slice(5)
  const date = `${year}-${md}` < today ? `${year + 1}-${md}` : `${year}-${md}`
  return birthdayEvent(profile, date)
}

export function upcomingBirthdays(profiles, now = new Date()) {
  return (profiles || [])
    .map((profile) => nextBirthday(profile, now))
    .filter(Boolean)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))
}
