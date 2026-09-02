import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { freshState, HOUSEHOLD, PARTY } from '../data/seed.js'
import { fromDbRsvp, hostDisplayName, toDbStatus } from './rsvps.js'
import { isSupabaseConfigured, supabase } from './supabase.js'

const KEY = 'first-bell.v1'
const CHLOE_SLUG = PARTY.slug
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

function sessionFromUser(user, extra = {}) {
  if (!user) return null
  const base = {
    demo: false,
    household: HOUSEHOLD.name,
    email: user.email,
    userId: user.id,
    enteredAt: new Date().toISOString(),
  }
  base.name = hostDisplayName({ ...base, ...extra })
  return { ...base, ...extra }
}

export function BellProvider({ children }) {
  const configured = isSupabaseConfigured
  const local = useMemo(() => load(), [])
  const [ready, setReady] = useState(!configured)
  const [state, setState] = useState(() => ({
    ...local,
    session: configured ? null : local.session,
    backend: configured ? 'connecting' : 'demo',
    backendMessage: configured
      ? 'Connecting to First Bell…'
      : 'Demo mode — RSVPs stay in this browser until Supabase env vars are set.',
    partyUuid: null,
    householdId: null,
    memberRole: null,
    authError: null,
    authBusy: false,
    authStep: 'email',
    pendingEmail: '',
  }))
  const partyUuidRef = useRef(null)
  partyUuidRef.current = state.partyUuid

  const patch = useCallback((partial) => {
    setState((prev) => ({ ...prev, ...partial }))
  }, [])

  const update = useCallback((fn) => {
    setState((prev) => fn({ ...prev }))
  }, [])

  useEffect(() => {
    const live = state.backend === 'live'
    persist({
      version: 1,
      session: live ? null : state.session,
      guests: live ? load().guests : state.guests,
      messages: state.messages,
    })
  }, [state.session, state.guests, state.messages, state.backend])

  const loadRsvps = useCallback(async (partyUuid) => {
    if (!supabase || !partyUuid) return
    const { data, error } = await supabase
      .from('rsvps')
      .select('id, guest_name, parent_name, status, note, created_at, updated_at')
      .eq('party_id', partyUuid)
      .order('created_at', { ascending: true })
    if (error) throw error
    patch({ guests: (data || []).map(fromDbRsvp) })
  }, [patch])

  const bootstrapLive = useCallback(
    async (user) => {
      try {
        const { data: party, error: partyErr } = await supabase
          .from('parties')
          .select('id, household_id, slug')
          .eq('slug', CHLOE_SLUG)
          .maybeSingle()
        if (partyErr) throw partyErr

        let householdId = null
        let memberRole = null
        if (user) {
          const { data: membership, error: memErr } = await supabase.rpc('ensure_host_membership')
          if (memErr) throw memErr
          householdId = membership?.household_id || null
          memberRole = membership?.role || null
        }

        patch({
          backend: 'live',
          backendMessage: '',
          partyUuid: party?.id || null,
          householdId,
          memberRole,
          session: user
            ? sessionFromUser(user, { householdId, role: memberRole })
            : null,
        })

        if (user && householdId && party?.id) {
          await loadRsvps(party.id)
        } else if (!user) {
          patch({ guests: load().guests })
        }
      } catch (err) {
        patch({
          backend: 'offline',
          backendMessage: err.message || 'Supabase is unreachable.',
          session: user ? sessionFromUser(user) : null,
          guests: load().guests,
        })
      } finally {
        setReady(true)
      }
    },
    [loadRsvps, patch],
  )

  useEffect(() => {
    if (!configured || !supabase) {
      setReady(true)
      return
    }

    let cancelled = false
    let channel

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      return bootstrapLive(data.session?.user ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return
      bootstrapLive(session?.user ?? null)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
      if (channel) supabase.removeChannel(channel)
    }
  }, [configured, bootstrapLive])

  useEffect(() => {
    if (!supabase || state.backend !== 'live' || !state.partyUuid || !state.householdId) return undefined
    const channel = supabase
      .channel(`rsvps:${state.partyUuid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rsvps', filter: `party_id=eq.${state.partyUuid}` },
        () => {
          loadRsvps(partyUuidRef.current).catch(() => {})
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [state.backend, state.partyUuid, state.householdId, loadRsvps])

  const api = useMemo(() => {
    const live = state.backend === 'live' && Boolean(supabase)

    return {
      state,
      ready,
        entered: Boolean(
          state.session &&
            (state.session.demo || state.householdId || !configured || state.backend === 'offline'),
        ),
      configured,
      enterDemo() {
        if (configured) return
        update((s) => ({
          ...s,
          session: {
            demo: true,
            household: HOUSEHOLD.name,
            name: 'Andrew',
            enteredAt: new Date().toISOString(),
          },
        }))
      },
      async sendOtp(email) {
        if (!supabase) throw new Error('Supabase is not configured')
        const trimmed = email.trim().toLowerCase()
        patch({ authBusy: true, authError: null })
        const { error } = await supabase.auth.signInWithOtp({
          email: trimmed,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: `${window.location.origin}/enter`,
          },
        })
        patch({
          authBusy: false,
          authError: error ? error.message : null,
          authStep: error ? 'email' : 'code',
          pendingEmail: error ? state.pendingEmail : trimmed,
        })
        if (error) throw error
      },
      async verifyOtp(token) {
        if (!supabase) throw new Error('Supabase is not configured')
        patch({ authBusy: true, authError: null })
        const { error } = await supabase.auth.verifyOtp({
          email: state.pendingEmail,
          token: token.trim(),
          type: 'email',
        })
        patch({ authBusy: false, authError: error ? error.message : null })
        if (error) throw error
      },
      async signOut() {
        if (live) {
          await supabase.auth.signOut()
        }
        update((s) => ({
          ...s,
          session: null,
          householdId: null,
          memberRole: null,
          authStep: 'email',
          pendingEmail: '',
          authError: null,
        }))
      },
      resetDemo() {
        if (live) return
        const next = freshState()
        next.session = state.session
        next.backend = state.backend
        next.backendMessage = state.backendMessage
        setState((prev) => ({ ...prev, ...next, session: prev.session }))
      },
      async setRsvp(guestId, status) {
        update((s) => ({
          ...s,
          guests: s.guests.map((g) => (g.id === guestId ? { ...g, status } : g)),
        }))
        if (!live) return
        const { error } = await supabase
          .from('rsvps')
          .update({ status: toDbStatus(status) })
          .eq('id', guestId)
        if (error) {
          await loadRsvps(partyUuidRef.current)
          throw error
        }
      },
      async addOrUpdateRsvp({ child, parent, status, slug, note }) {
        const partySlug = slug || CHLOE_SLUG
        const tryRemote = Boolean(supabase && configured && state.backend !== 'offline' && state.backend !== 'demo')
        if (tryRemote) {
          const { data, error } = await supabase.rpc('submit_public_rsvp', {
            p_slug: partySlug,
            p_guest_name: child.trim(),
            p_parent_name: parent?.trim() || null,
            p_status: status,
            p_note: note?.trim() || null,
          })
          if (error) throw error
          const mapped = fromDbRsvp(data)
          update((s) => {
            const existing = s.guests.find((g) => g.id === mapped.id)
            if (existing) {
              return { ...s, guests: s.guests.map((g) => (g.id === mapped.id ? mapped : g)) }
            }
            const byName = s.guests.find((g) => g.child.trim().toLowerCase() === mapped.child.trim().toLowerCase())
            if (byName) {
              return { ...s, guests: s.guests.map((g) => (g.id === byName.id ? mapped : g)) }
            }
            return { ...s, guests: [...s.guests, mapped] }
          })
          return mapped
        }

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
        return null
      },
      moveMessage(id, folder) {
        update((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, folder, attention: folder === 'inbox' } : m,
          ),
        }))
      },
      resetAuthForm() {
        patch({ authStep: 'email', authError: null, pendingEmail: '' })
      },
    }
  }, [state, ready, configured, update, patch, loadRsvps])

  return <BellContext.Provider value={api}>{children}</BellContext.Provider>
}

export function useBell() {
  const ctx = useContext(BellContext)
  if (!ctx) throw new Error('useBell must be used inside BellProvider')
  return ctx
}
