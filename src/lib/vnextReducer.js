import { cloneGiftLists } from './gifts.js'
import { mergeEvents, seedCalendarEvents, wallEvent } from './events.js'
import { PLAN_CHECKLIST } from './nextup.js'
import { mergeProfiles } from '../data/profiles.js'
import { groceryFromSlots, mergeChecks, suggestWeek, swapInPool } from './planner.js'

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
          item.id === action.itemId ? { ...item, claimedByName: '', claimedAt: null } : item,
        ),
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
      const grocery = mergeChecks(groceryFromSlots(slots), state.grocery[action.weekStart])
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
      const grocery = mergeChecks(groceryFromSlots(slots), state.grocery[action.weekStart])
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
    case 'replace-gifts':
      return { ...state, giftLists: action.giftLists }
    default:
      return state
  }
}

export function initialVnext() {
  return {
    events: seedCalendarEvents(),
    imports: [],
    giftLists: cloneGiftLists(),
    profiles: mergeProfiles(null),
    mealPlans: {},
    grocery: {},
    kidMode: false,
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
    giftLists: Array.isArray(saved.giftLists) ? saved.giftLists : base.giftLists,
    profiles: mergeProfiles(saved.profiles),
    mealPlans: saved.mealPlans && typeof saved.mealPlans === 'object' ? saved.mealPlans : {},
    grocery: saved.grocery && typeof saved.grocery === 'object' ? saved.grocery : {},
    kidMode: Boolean(saved.kidMode),
  }
}
