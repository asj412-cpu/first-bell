import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { freshState } from '../data/seed.js'

const KEY = 'first-bell.v1'
const BellContext = createContext(null)

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return freshState()
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return freshState()
    return {
      ...freshState(),
      ...parsed,
      guests: Array.isArray(parsed.guests) ? parsed.guests : freshState().guests,
      messages: Array.isArray(parsed.messages) ? parsed.messages : freshState().messages,
    }
  } catch {
    return freshState()
  }
}

function persist(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function BellProvider({ children }) {
  const [state, setState] = useState(load)

  useEffect(() => {
    persist(state)
  }, [state])

  const api = useMemo(() => {
    const update = (fn) => setState((prev) => fn({ ...prev }))

    return {
      state,
      entered: Boolean(state.session),
      enterDemo() {
        update((s) => ({
          ...s,
          session: {
            demo: true,
            household: 'Johnson',
            name: 'Andrew',
            enteredAt: new Date().toISOString(),
          },
        }))
      },
      signOut() {
        update((s) => ({ ...s, session: null }))
      },
      resetDemo() {
        const next = freshState()
        next.session = state.session
        setState(next)
      },
      setRsvp(guestId, status) {
        update((s) => ({
          ...s,
          guests: s.guests.map((g) => (g.id === guestId ? { ...g, status } : g)),
        }))
      },
      addOrUpdateRsvp({ child, parent, status }) {
        const key = child.trim().toLowerCase()
        update((s) => {
          const existing = s.guests.find((g) => g.child.trim().toLowerCase() === key)
          if (existing) {
            return {
              ...s,
              guests: s.guests.map((g) =>
                g.id === existing.id
                  ? { ...g, parent: parent.trim() || g.parent, status }
                  : g,
              ),
            }
          }
          return {
            ...s,
            guests: [
              ...s.guests,
              {
                id: `g-${Date.now()}`,
                child: child.trim(),
                parent: parent.trim() || 'Parent',
                status,
              },
            ],
          }
        })
      },
      moveMessage(id, folder) {
        update((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, folder, attention: folder === 'inbox' } : m,
          ),
        }))
      },
    }
  }, [state])

  return <BellContext.Provider value={api}>{children}</BellContext.Provider>
}

export function useBell() {
  const ctx = useContext(BellContext)
  if (!ctx) throw new Error('useBell must be used inside BellProvider')
  return ctx
}
