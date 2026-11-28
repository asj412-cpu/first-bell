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
  if (profile.wont_sign_up) return { tone: 'keep', label: 'You keep this list · hidden from the name picker' }
  return { tone: 'wait', label: 'Waiting for them to pick their name' }
}

export function profileCounts(profiles) {
  const list = profiles || []
  const claimed = list.filter((p) => p.claimed).length
  const kept = list.filter((p) => !p.claimed && p.wont_sign_up).length
  return { total: list.length, claimed, kept, waiting: list.length - claimed - kept }
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

/** Where a directory entry goes: your own list opens the editor, anyone else's opens the shopping page. */
export function directoryLink(entry) {
  if (!entry) return '/gifts'
  return entry.mine ? `/gifts/${entry.kid_key}` : `/g/${entry.share_slug}`
}

/** One line under a name in the family directory. */
export function directoryLine(entry) {
  const count = Number(entry?.item_count) || 0
  const ideas = `${count} ${count === 1 ? 'idea' : 'ideas'}`
  if (entry?.mine) return `${ideas} · yours`
  if (entry?.managed_by) return `${ideas} · kept by ${entry.managed_by}`
  return ideas
}

/** Households in display order: yours first, then A to Z. */
export function sortDirectoryGroups(groups, mineLabel) {
  return [...(groups || [])].sort((a, b) => {
    if (mineLabel && a.label === mineLabel && b.label !== mineLabel) return -1
    if (mineLabel && b.label === mineLabel && a.label !== mineLabel) return 1
    return String(a.label).localeCompare(String(b.label))
  })
}

/**
 * Secret Santa copy for someone who is signed in as a family member.
 * inDraw === false means they are on the list but not in this year's drawing.
 */
export function notInDrawing(access) {
  return access?.inDraw === false
}

/** The "Your family" blurb: what happens to people a parent adds. */
export function yourFamilyCopy(access) {
  const base = 'Add your husband, wife, or kids here. They don’t need an email or their own invite. You keep their lists.'
  if (access?.drawingLocked) {
    return `${base} The Secret Santa drawing is already locked, so they get a list of their own but aren’t in this year’s drawing.`
  }
  return `${base} They join Secret Santa too until Andrew locks the drawing, and you’ll see who they draw.`
}
