import { previewReminder } from './reminderAdapter.js'

export const CHRISTMAS = '2026-12-25'
export const PRICE_AS_OF = 'October 16, 2026'
export const DEMO_INVITE_TOKEN = 'demo-casa-christmas'
export const HOUSEHOLD_GROUP = 'johnson-house'

const CATEGORY_LABELS = {
  Toy: 'Toys',
  Clothes: 'Clothes',
  Educational: 'Learning',
  'Doll Clothes': 'Doll clothes',
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category || 'Gift'
}

export function aboutPrice(usd) {
  const n = Number(usd)
  if (!Number.isFinite(n)) return ''
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
  return `about $${text}`
}

export const REMINDERS = [
  {
    kind: 'lists_due',
    sendAt: '2026-12-01T15:00:00.000Z',
    sendLabel: 'Tue Dec 1, 2026 · 9:00 AM',
    audience: 'missing_lists',
    subject: 'Christmas lists are due',
    body: 'Hi {name}, Christmas is December 25. Please add your gift ideas in Mi Casa today so the family knows what to look for.',
  },
  {
    kind: 'assigned',
    sendAt: '2026-12-08T15:00:00.000Z',
    sendLabel: 'Tue Dec 8, 2026 · 9:00 AM',
    audience: 'assigned',
    subject: 'You have someone for Secret Santa',
    body: 'Hi {name}, you have been assigned someone for the Johnson family Secret Santa. Open Mi Casa to see their list, and please keep it a surprise.',
  },
  {
    kind: 'buy_by',
    sendAt: '2026-12-18T15:00:00.000Z',
    sendLabel: 'Fri Dec 18, 2026 · 9:00 AM',
    audience: 'participants',
    subject: 'A week left to buy',
    body: 'Hi {name}, Christmas is one week from today. This is a good day to order gifts so they arrive by December 25. Mark an item in Mi Casa once you have it, so nobody else buys the same one.',
  },
  {
    kind: 'final',
    sendAt: '2026-12-23T15:00:00.000Z',
    sendLabel: 'Wed Dec 23, 2026 · 9:00 AM',
    audience: 'participants',
    subject: 'Final Christmas reminder',
    body: 'Hi {name}, Christmas Eve is tomorrow. If a gift is still on the way, you still have a day. Mi Casa will not remind you again after this.',
  },
]

export function freshExchange() {
  return {
    inviteToken: DEMO_INVITE_TOKEN,
    avoidSameGroup: true,
    eventStatus: 'open',
    drawnAt: null,
    lockedAt: null,
    groups: [{ id: HOUSEHOLD_GROUP, label: 'Johnson' }],
    participants: [
      {
        id: 'andrew',
        name: 'Andrew',
        groupId: HOUSEHOLD_GROUP,
        memberKey: 'andrew',
        listKey: 'andrew',
        inDraw: true,
        submittedAt: null,
        phone: '936-355-1281',
        email: 'asj412@me.com',
        admin: true,
      },
      {
        id: 'megan',
        name: 'Megan',
        groupId: HOUSEHOLD_GROUP,
        memberKey: 'megan',
        listKey: 'megan',
        inDraw: true,
        submittedAt: null,
        phone: '',
        email: '',
        admin: true,
      },
    ],
    assignments: [],
    previews: [],
  }
}

function shuffle(list, random) {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const swap = arr[i]
    arr[i] = arr[j]
    arr[j] = swap
  }
  return arr
}

export function drawAssignments(people, options = {}) {
  const avoid = options.avoidSameGroup !== false
  const random = options.random || Math.random
  const roster = (people || []).filter((person) => person.inDraw !== false)
  if (roster.length < 2) {
    return { ok: false, reason: 'Add at least two people to the drawing.' }
  }
  const ids = roster.map((person) => person.id)
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const receivers = shuffle(ids, random)
    let valid = true
    for (let i = 0; i < ids.length; i += 1) {
      if (receivers[i] === ids[i]) {
        valid = false
        break
      }
      if (!avoid) continue
      const giver = roster.find((person) => person.id === ids[i])
      const receiver = roster.find((person) => person.id === receivers[i])
      if (giver.groupId && giver.groupId === receiver.groupId) {
        valid = false
        break
      }
    }
    if (!valid) continue
    return {
      ok: true,
      assignments: ids.map((id, index) => ({ giverId: id, receiverId: receivers[index] })),
    }
  }
  return {
    ok: false,
    reason: avoid
      ? 'Nobody can be matched without drawing someone in their own household. Invite another household, or allow same-household pairs.'
      : 'Could not make a drawing. Try again.',
  }
}

export function isStarterItem(item) {
  const notes = item?.notes || ''
  return notes.includes('Starter wish') || notes.includes('Not pulled from a store')
}

export function concealItem(item) {
  return {
    ...item,
    claimedByName: '',
    claimedAt: null,
    purchased: false,
  }
}

export function presentItems(list, { conceal = false } = {}) {
  const items = [...(list?.items || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  if (!conceal) return items
  return items.map(concealItem)
}

export function ideaCount(list) {
  return (list?.items || []).filter((item) => (item.title || '').trim() && item.title !== 'New wish').length
}

export function reminderRecipients(reminder, exchange) {
  const people = exchange.participants || []
  const inDraw = people.filter((person) => person.inDraw !== false)
  let chosen = inDraw
  if (reminder.audience === 'missing_lists') {
    chosen = inDraw.filter((person) => !person.submittedAt)
  } else if (reminder.audience === 'assigned') {
    const givers = new Set((exchange.assignments || []).map((row) => row.giverId))
    chosen = inDraw.filter((person) => exchange.eventStatus !== 'open' && givers.has(person.id))
  }
  return chosen.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email || '',
    phone: person.phone || '',
    reachable: Boolean(person.email),
    note: person.email ? '' : 'No email on file, so this preview would not go out.',
  }))
}

export function fillReminder(body, name) {
  return String(body || '').replaceAll('{name}', name || 'there')
}

export function buildPreview(reminder, exchange, previewedAt) {
  const recipients = reminderRecipients(reminder, exchange).map((person) => ({
    ...person,
    message: fillReminder(reminder.body, person.name),
  }))
  return previewReminder({ reminder, recipients, previewedAt })
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function blankGiftItem() {
  const key = globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return { key, description: '', url: '' }
}

export function giftUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

export function validateGiftItems(items) {
  const errors = {}
  const clean = []
  ;(items || []).forEach((item, index) => {
    const description = String(item.description || '').trim()
    const urlRaw = String(item.url || '').trim()
    if (!description && !urlRaw) return
    if (!description) {
      errors[`item-${index}`] = 'Add a description, or remove this row.'
      return
    }
    if (description.length > 160) {
      errors[`item-${index}`] = 'Keep the description under 160 characters.'
      return
    }
    const url = giftUrl(urlRaw)
    if (urlRaw && !url) {
      errors[`url-${index}`] = 'Link must start with http:// or https://.'
      return
    }
    clean.push({
      id: item.id,
      description,
      url: url || '',
      image: item.image || '',
    })
  })
  if (!clean.length) errors.items = 'Add at least one gift.'
  if (clean.length > 40) errors.items = 'Forty gifts is the limit for one list.'
  return { ok: Object.keys(errors).length === 0 && clean.length > 0 && clean.length <= 40, errors, items: clean }
}

export async function withGiftImages(items) {
  return Promise.all(
    (items || []).map(async (item) => {
      if (!item.url) return { ...item, image: '' }
      try {
        const response = await fetch(`/api/gift-image?url=${encodeURIComponent(item.url)}`, {
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) return { ...item, image: '' }
        const data = await response.json()
        const image = giftUrl(data?.image)
        return { ...item, image: image || '' }
      } catch {
        return { ...item, image: '' }
      }
    }),
  )
}

export function wishFromIdea(idea, id, sort) {
  return {
    id,
    title: idea.description,
    notes: '',
    url: idea.url || '',
    urlSecondary: '',
    image: idea.image || '',
    availability: '',
    category: 'Idea',
    priceLabel: '',
    retailer: '',
    ageFit: '',
    dollSize: '',
    sourceSlug: '',
    sort,
    claimedByName: '',
    claimedAt: null,
  }
}

export function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

export function validateJoin(input) {
  const errors = {}
  const name = (input.name || '').trim()
  const phone = (input.phone || '').trim()
  const email = (input.email || '').trim().toLowerCase()
  const group = (input.group || '').trim()
  const mine = validateGiftItems(input.items)
  Object.assign(errors, mine.errors)
  if (name.length < 2) errors.name = 'Enter your name.'
  if (digits(phone).length < 10) errors.phone = 'Enter a phone number we can reach you at.'
  if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter your email.'
  if (group.length < 2) errors.group = 'Name your household, even if it is just you.'
  const others = (input.others || [])
    .map((person) => {
      const ideas = validateGiftItems(person.items || [])
      return {
        name: (person.name || '').trim(),
        items: ideas.items,
        itemErrors: ideas.errors,
        touched: Boolean((person.name || '').trim() || (person.items || []).some((item) => item.description || item.url)),
      }
    })
    .filter((person) => person.touched)
  others.forEach((person, index) => {
    if (person.name.length < 2) errors[`other-${index}`] = 'Enter their name, or remove them.'
    Object.entries(person.itemErrors).forEach(([key, message]) => {
      errors[`other-${index}-${key}`] = message
    })
  })
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      name,
      phone,
      email,
      group,
      items: mine.items,
      others: others.map((person) => ({ name: person.name, items: person.items })),
    },
  }
}

export function participantByList(exchange, list) {
  if (!exchange || !list) return null
  return (
    exchange.participants.find((person) => person.listKey === list.kidKey || person.listId === list.id) || null
  )
}

export function myAssignment(exchange, giverId) {
  const row = (exchange.assignments || []).find((item) => item.giverId === giverId)
  if (!row) return null
  const receiver = exchange.participants.find((person) => person.id === row.receiverId)
  return receiver ? { ...row, receiver } : null
}
