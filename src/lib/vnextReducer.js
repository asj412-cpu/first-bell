import { drawAssignments, freshExchange, myAssignment, wishFromIdea } from './exchange.js'
import { cloneGiftLists, mergeGiftLists } from './gifts.js'
import { mergeEvents, seedCalendarEvents, wallEvent } from './events.js'
import { PLAN_CHECKLIST } from './nextup.js'
import { mergeProfiles } from '../data/profiles.js'
import { allergenKeys, groceryFromSlots, mergeChecks, suggestWeek, swapInPool } from './planner.js'

export function blankItem(sort) {
  const id = globalThis.crypto?.randomUUID?.() || `item-${Date.now()}`
  return {
    id,
    title: 'New wish',
    notes: '',
    url: '',
    urlSecondary: '',
    image: '',
    availability: '',
    sort,
    claimedByName: '',
    claimedAt: null,
  }
}

function mapList(state, listId, fn) {
  return {
    ...state,
    giftLists: state.giftLists.map((list) => (list.id === listId ? fn(list) : list)),
  }
}

export function vnextReducer(state, action) {
  switch (action.type) {
    case 'toggle-kid-mode':
      return { ...state, kidMode: !state.kidMode }
    case 'set-kid-mode':
      return { ...state, kidMode: Boolean(action.on) }
    case 'update-profile':
      return {
        ...state,
        profiles: state.profiles.map((profile) =>
          profile.memberKey === action.memberKey ? { ...profile, ...action.patch } : profile,
        ),
      }
    case 'add-gift-item': {
      return mapList(state, action.listId, (list) => ({
        ...list,
        items: [...list.items, action.item || blankItem(list.items.length)],
      }))
    }
    case 'update-gift-item':
      return mapList(state, action.listId, (list) => ({
        ...list,
        items: list.items.map((item) => (item.id === action.itemId ? { ...item, ...action.patch } : item)),
      }))
    case 'delete-gift-item':
      return mapList(state, action.listId, (list) => ({
        ...list,
        items: list.items.filter((item) => item.id !== action.itemId),
      }))
    case 'move-gift-item':
      return mapList(state, action.listId, (list) => {
        const items = [...list.items].sort((a, b) => a.sort - b.sort)
        const index = items.findIndex((item) => item.id === action.itemId)
        const nextIndex = index + action.dir
        if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return list
        const [row] = items.splice(index, 1)
        items.splice(nextIndex, 0, row)
        return { ...list, items: items.map((item, sort) => ({ ...item, sort })) }
      })
    case 'claim-gift': {
      const name = (action.name || '').trim()
      return {
        ...state,
        giftLists: state.giftLists.map((list) => {
          if (list.shareSlug !== action.slug) return list
          return {
            ...list,
            items: list.items.map((item) => {
              if (item.id !== action.itemId || item.claimedAt) return item
              return { ...item, claimedByName: name, claimedAt: action.at || new Date().toISOString() }
            }),
          }
        }),
      }
    }
    case 'release-claim':
      return mapList(state, action.listId, (list) => ({
        ...list,
        items: list.items.map((item) =>
          item.id === action.itemId ? { ...item, claimedByName: '', claimedAt: null, purchased: false } : item,
        ),
      }))
    case 'join-exchange': {
      const { value } = action
      const groupId = `group-${value.group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      const groups = state.exchange.groups.some((group) => group.label.toLowerCase() === value.group.toLowerCase())
        ? state.exchange.groups
        : [...state.exchange.groups, { id: groupId, label: value.group }]
      const resolvedGroup = groups.find((group) => group.label.toLowerCase() === value.group.toLowerCase())
      const returning = state.exchange.participants.find(
        (person) => person.email && person.email.toLowerCase() === value.email,
      )
      if (returning) {
        const list = state.giftLists.find((row) => row.kidKey === returning.listKey)
        return {
          ...state,
          giftLists: state.giftLists.map((row) =>
            row.kidKey === returning.listKey
              ? {
                  ...row,
                  displayName: value.name,
                  items: value.items.map((idea, sort) => {
                    const previous = list?.items?.find((item) => item.id === idea.id)
                    return {
                      ...wishFromIdea(idea, idea.id || `${returning.id}-${sort}`, sort),
                      claimedByName: previous?.claimedByName || '',
                      claimedAt: previous?.claimedAt || null,
                    }
                  }),
                }
              : row,
          ),
          exchange: {
            ...state.exchange,
            participants: state.exchange.participants.map((person) =>
              person.id === returning.id
                ? { ...person, name: value.name, phone: value.phone, submittedAt: new Date().toISOString() }
                : person,
            ),
          },
        }
      }
      const selfId = value.selfId || `person-${Date.now()}`
      const selfListKey = `guest-${selfId}`
      const selfList = {
        id: `list-${selfId}`,
        kidKey: selfListKey,
        displayName: value.name,
        occasion: 'Christmas 2026',
        shareSlug: `share-${selfId}`,
        listKind: 'exchange',
        items: value.items.map((idea, sort) => wishFromIdea(idea, `${selfId}-${sort}`, sort)),
      }
      const others = (value.others || []).map((person, index) => {
        const id = `${selfId}-other-${index}`
        return {
          participant: {
            id,
            name: person.name,
            groupId: resolvedGroup.id,
            listKey: `guest-${id}`,
            inDraw: false,
            submittedAt: person.items.length ? new Date().toISOString() : null,
            phone: '',
            email: '',
            admin: false,
          },
          list: {
            id: `list-${id}`,
            kidKey: `guest-${id}`,
            displayName: person.name,
            occasion: 'Christmas 2026',
            shareSlug: `share-${id}`,
            listKind: 'exchange',
            items: person.items.map((idea, sort) => wishFromIdea(idea, `${id}-${sort}`, sort)),
          },
        }
      })
      return {
        ...state,
        giftLists: [...state.giftLists, selfList, ...others.map((row) => row.list)],
        exchange: {
          ...state.exchange,
          groups,
          participants: [
            ...state.exchange.participants,
            {
              id: selfId,
              name: value.name,
              groupId: resolvedGroup.id,
              listKey: selfListKey,
              inDraw: true,
              submittedAt: new Date().toISOString(),
              phone: value.phone,
              email: value.email,
              admin: false,
            },
            ...others.map((row) => row.participant),
          ],
        },
      }
    }
    case 'set-in-draw': {
      if (state.exchange.eventStatus === 'locked') return state
      return {
        ...state,
        exchange: {
          ...state.exchange,
          eventStatus: state.exchange.eventStatus === 'draft' ? 'open' : state.exchange.eventStatus,
          assignments: state.exchange.eventStatus === 'draft' ? [] : state.exchange.assignments,
          participants: state.exchange.participants.map((person) =>
            person.id === action.participantId ? { ...person, inDraw: action.inDraw } : person,
          ),
        },
      }
    }
    case 'set-avoid-group':
      if (state.exchange.eventStatus === 'locked') return state
      return {
        ...state,
        exchange: {
          ...state.exchange,
          avoidSameGroup: Boolean(action.avoid),
          eventStatus: state.exchange.eventStatus === 'draft' ? 'open' : state.exchange.eventStatus,
          assignments: state.exchange.eventStatus === 'draft' ? [] : state.exchange.assignments,
        },
      }
    case 'draw-santa': {
      if (state.exchange.eventStatus === 'locked') return { ...state, exchangeError: 'Secret Santa is locked.' }
      const result = drawAssignments(state.exchange.participants, { avoidSameGroup: state.exchange.avoidSameGroup })
      if (!result.ok) return { ...state, exchangeError: result.reason }
      return {
        ...state,
        exchangeError: '',
        exchange: {
          ...state.exchange,
          eventStatus: 'draft',
          drawnAt: action.at || new Date().toISOString(),
          assignments: result.assignments,
        },
      }
    }
    case 'lock-santa': {
      if (state.exchange.eventStatus !== 'draft' || state.exchange.assignments.length < 2) {
        return { ...state, exchangeError: 'Draw Secret Santa before locking it.' }
      }
      const mine = myAssignment(state.exchange, 'andrew')
      return {
        ...state,
        exchangeError: '',
        exchange: {
          ...state.exchange,
          eventStatus: 'locked',
          lockedAt: action.at || new Date().toISOString(),
          assignments: mine ? [{ giverId: mine.giverId, receiverId: mine.receiverId }] : [],
        },
      }
    }
    case 'save-megan-contact':
      return {
        ...state,
        exchange: {
          ...state.exchange,
          participants: state.exchange.participants.map((person) =>
            person.memberKey === 'megan'
              ? { ...person, phone: action.phone, email: action.email }
              : person,
          ),
        },
      }
    case 'preview-reminder':
      return {
        ...state,
        exchange: {
          ...state.exchange,
          previews: [action.preview, ...state.exchange.previews].slice(0, 12),
        },
      }
    case 'save-own-items':
      return mapList(state, action.listId, (list) => ({
        ...list,
        items: action.items.map((idea, sort) => {
          const previous = list.items.find((item) => item.id === idea.id)
          return {
            ...wishFromIdea(idea, idea.id || previous?.id || `idea-${Date.now()}-${sort}`, sort),
            notes: previous?.notes || '',
            claimedByName: previous?.claimedByName || '',
            claimedAt: previous?.claimedAt || null,
          }
        }),
      }))
    case 'add-named-wish':
      return mapList(state, action.listId, (list) => ({
        ...list,
        items: [
          ...list.items,
          {
            id: action.itemId,
            title: action.title,
            notes: action.notes || '',
            url: action.url || '',
            urlSecondary: '',
            image: '',
            availability: '',
            category: 'Idea',
            priceLabel: '',
            retailer: '',
            ageFit: '',
            dollSize: '',
            sourceSlug: '',
            sort: list.items.length,
            claimedByName: '',
            claimedAt: null,
          },
        ],
      }))
    case 'plan-suggestion': {
      const suggestion = action.suggestion
      const id = `plan-${suggestion.key}`
      if (state.events.some((event) => event.id === id)) return state
      const event = wallEvent({
        id,
        title: suggestion.title,
        kind: 'plan',
        date: suggestion.date,
        allDay: true,
        place: suggestion.location || '',
        notes:
          suggestion.source === 'import'
            ? 'Planned from the family calendar.'
            : 'Planned from the holiday list.',
        draft: true,
        checklist: PLAN_CHECKLIST.map((item) => ({ ...item })),
        source: 'plan',
      })
      return { ...state, events: [...state.events, event] }
    }
    case 'toggle-checklist':
      return {
        ...state,
        events: state.events.map((event) => {
          if (event.id !== action.eventId) return event
          return {
            ...event,
            checklist: (event.checklist || []).map((item) =>
              item.id === action.checkId ? { ...item, done: !item.done } : item,
            ),
          }
        }),
      }
    case 'suggest-week': {
      const slots = suggestWeek({
        weekStart: action.weekStart,
        profiles: state.profiles,
        existing: state.mealPlans[action.weekStart],
        now: action.now,
      })
      const grocery = mergeChecks(
        groceryFromSlots(slots, undefined, action.weekStart, allergenKeys(state.profiles)),
        state.grocery[action.weekStart],
      )
      return {
        ...state,
        mealPlans: { ...state.mealPlans, [action.weekStart]: slots },
        grocery: { ...state.grocery, [action.weekStart]: grocery },
      }
    }
    case 'swap-meal': {
      const slots = swapInPool({
        slots: state.mealPlans[action.weekStart],
        date: action.date,
        slot: action.slot,
        profiles: state.profiles,
        weekStart: action.weekStart,
        now: action.now,
      })
      const grocery = mergeChecks(
        groceryFromSlots(slots, undefined, action.weekStart, allergenKeys(state.profiles)),
        state.grocery[action.weekStart],
      )
      return {
        ...state,
        mealPlans: { ...state.mealPlans, [action.weekStart]: slots },
        grocery: { ...state.grocery, [action.weekStart]: grocery },
      }
    }
    case 'toggle-lock': {
      const week = state.mealPlans[action.weekStart]
      if (!week?.[action.date]?.[action.slot]) return state
      const slot = week[action.date][action.slot]
      const slots = {
        ...week,
        [action.date]: {
          ...week[action.date],
          [action.slot]: { ...slot, locked: !slot.locked },
        },
      }
      return { ...state, mealPlans: { ...state.mealPlans, [action.weekStart]: slots } }
    }
    case 'toggle-grocery':
      return {
        ...state,
        grocery: {
          ...state.grocery,
          [action.weekStart]: (state.grocery[action.weekStart] || []).map((item) =>
            item.id === action.itemId ? { ...item, checked: !item.checked } : item,
          ),
        },
      }
    case 'toggle-learning-plan': {
      const byKid = state.learningProgress?.[action.kidKey] || {}
      const byWeek = byKid[action.weekStart] || {}
      const done = !planIsDone(state.learningProgress, action.kidKey, action.weekStart, action.planId)
      return {
        ...state,
        learningProgress: {
          ...state.learningProgress,
          [action.kidKey]: {
            ...byKid,
            [action.weekStart]: {
              ...byWeek,
              [action.planId]: done
                ? { done: true, doneAt: action.at || new Date().toISOString() }
                : { done: false, doneAt: null },
            },
          },
        },
      }
    }
    case 'replace-gifts':
      return { ...state, giftLists: action.giftLists }
    default:
      return state
  }
}

export function planIsDone(progress, kidKey, weekStart, planId) {
  const row = progress?.[kidKey]?.[weekStart]?.[planId]
  if (!row) return false
  if (typeof row === 'boolean') return row
  return Boolean(row.done)
}

export function mergeLearning(local, remote) {
  const out = { ...(local || {}) }
  for (const [kid, weeks] of Object.entries(remote || {})) {
    if (!weeks || typeof weeks !== 'object') continue
    const nextWeeks = { ...(out[kid] || {}) }
    for (const [week, plans] of Object.entries(weeks)) {
      if (!plans || typeof plans !== 'object') continue
      nextWeeks[week] = { ...(nextWeeks[week] || {}), ...plans }
    }
    out[kid] = nextWeeks
  }
  return out
}

export function initialVnext() {
  return {
    events: seedCalendarEvents(),
    imports: [],
    giftLists: cloneGiftLists(),
    profiles: mergeProfiles(null),
    mealPlans: {},
    grocery: {},
    learningProgress: {},
    learningRemote: false,
    kidMode: false,
    exchange: freshExchange(),
    exchangeError: '',
    vnextReady: false,
    vnextNote: '',
  }
}

export function hydrateVnext(saved) {
  const base = initialVnext()
  if (!saved || typeof saved !== 'object') return base
  return {
    ...base,
    events: mergeEvents(saved.events),
    imports: Array.isArray(saved.imports) ? saved.imports : [],
    giftLists: mergeGiftLists(saved.giftLists, base.giftLists),
    exchange: saved.exchange && typeof saved.exchange === 'object'
      ? { ...freshExchange(), ...saved.exchange, participants: saved.exchange.participants || freshExchange().participants }
      : freshExchange(),
    profiles: mergeProfiles(saved.profiles),
    mealPlans: saved.mealPlans && typeof saved.mealPlans === 'object' ? saved.mealPlans : {},
    grocery: saved.grocery && typeof saved.grocery === 'object' ? saved.grocery : {},
    learningProgress:
      saved.learningProgress && typeof saved.learningProgress === 'object' ? saved.learningProgress : {},
    kidMode: Boolean(saved.kidMode),
  }
}
