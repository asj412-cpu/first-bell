/** Family profiles (pre-made people Andrew adds) and offline Secret Santa helpers. */

export const FAMILY_LINK_COPY = {
  subject: 'Christmas 2026 family list',
  text: 'Here is our family gift list. Open the link, sign in with your email, and tap your name.',
}

/** Status line for one profile card. */
export function profileStatus(profile) {
  if (!profile) return { tone: 'wait', label: '' }
  if (profile.claimed) {
    return { tone: 'yes', label: profile.claimed_email ? `Claimed · ${profile.claimed_email}` : 'Claimed' }
  }
  return { tone: 'wait', label: 'Waiting for them to pick their name' }
}

export function profileCounts(profiles) {
  const list = profiles || []
  const claimed = list.filter((p) => p.claimed).length
  return { total: list.length, claimed, waiting: list.length - claimed }
}

/**
 * Check Andrew's offline pairings before saving.
 * roster: [{ id, name }] everyone in the drawing. picks: { [giverId]: receiverId }.
 * Returns { pairs, errors: { [giverId]: message }, problems: [message], complete }.
 */
export function checkManualPairs(roster, picks) {
  const people = roster || []
  const byId = new Map(people.map((p) => [p.id, p]))
  const errors = {}
  const problems = []
  const receivedBy = new Map()
  const pairs = []
  for (const person of people) {
    const receiver = (picks || {})[person.id]
    if (!receiver) continue
    if (!byId.has(receiver)) {
      errors[person.id] = 'Pick someone in the drawing'
      continue
    }
    if (receiver === person.id) {
      errors[person.id] = `${person.name} can’t draw themselves`
      continue
    }
    if (receivedBy.has(receiver)) {
      const other = byId.get(receivedBy.get(receiver))
      errors[person.id] = `${other.name} already gives to ${byId.get(receiver).name}`
      continue
    }
    receivedBy.set(receiver, person.id)
    pairs.push({ giver: person.id, receiver })
  }
  const missing = people.filter((p) => !(picks || {})[p.id])
  if (missing.length) problems.push(`Still to pick: ${missing.map((p) => p.name).join(', ')}`)
  const unreceived = people.filter((p) => !receivedBy.has(p.id))
  if (!missing.length && unreceived.length) {
    problems.push(`Nobody is giving to ${unreceived.map((p) => p.name).join(', ')}`)
  }
  const complete = people.length >= 2 && pairs.length === people.length && !Object.keys(errors).length
  return { pairs, errors, problems, complete }
}

/** Receivers still free for a giver's dropdown (keeps the giver's current pick). */
export function freeReceivers(roster, picks, giverId) {
  const taken = new Set(
    Object.entries(picks || {})
      .filter(([giver, receiver]) => giver !== giverId && receiver)
      .map(([, receiver]) => receiver),
  )
  return (roster || []).filter((p) => p.id !== giverId && !taken.has(p.id))
}
