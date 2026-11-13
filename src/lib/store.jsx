import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { mergeProfiles } from '../data/profiles.js'
import { freshState, HOUSEHOLD, PARTY } from '../data/seed.js'
import { mergeEvents } from './events.js'
import { fromDbRsvp, hostDisplayName, toDbStatus } from './rsvps.js'
import { authCallback, clearAuthCallbackParams, isSupabaseConfigured, supabase } from './supabase.js'
import { hydrateVnext, mergeLearning, vnextReducer } from './vnextReducer.js'
import { mirrorVnext, pullVnext } from './vnextRemote.js'

const KEY = 'first-bell.v1'
const CHLOE_SLUG = PARTY.slug
const BellContext = createContext(null)

function load() {
  const base = { ...freshState(), ...hydrateVnext(null) }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return base
    return {
      ...base,
      ...hydrateVnext(parsed),
      session: parsed.session ?? null,
      guests: Array.isArray(parsed.guests) ? parsed.guests : base.guests,
      messages: Array.isArray(parsed.messages) ? parsed.messages : base.messages,
    }
  } catch {
    return base
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
      ? 'Connecting to Mi Casa…'
      : 'Demo mode — RSVPs stay in this browser until Supabase env vars are set.',
    partyUuid: null,
    householdId: null,
    memberRole: null,
    authError: null,
    authNotice: null,
    authBusy: false,
    authStep: 'email',
    pendingEmail: '',
  }))
  const partyUuidRef = useRef(null)
  partyUuidRef.current = state.partyUuid
  const pulledFor = useRef(null)

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
      events: state.events,
      imports: state.imports,
      giftLists: state.giftLists,
      profiles: state.profiles,
      mealPlans: state.mealPlans,
      grocery: state.grocery,
      learningProgress: state.learningProgress,
      kidMode: state.kidMode,
    })
  }, [state.session, state.guests, state.messages, state.backend, state.events, state.imports, state.giftLists, state.profiles, state.mealPlans, state.grocery, state.learningProgress, state.kidMode])

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
      const user = data.session?.user ?? null
      const linkFailed = !user && (authCallback.hasCode || authCallback.errorDescription || authCallback.errorCode)
      if (linkFailed) {
        patch({
          authNotice:
            'That link didn’t finish in this browser. Links only work in the same browser that asked for the email. Type the code if the message has one, or ask for a new email from this screen.',
        })
      }
      if (authCallback.hasCode || authCallback.errorDescription || authCallback.errorCode) {
        clearAuthCallbackParams()
      }
      return bootstrapLive(user)
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

  useEffect(() => {
    if (!supabase || state.backend !== 'live' || !state.householdId) return undefined
    const householdId = state.householdId
    if (pulledFor.current === householdId) return undefined
    let cancelled = false
    pullVnext(supabase, householdId).then((result) => {
      if (cancelled) return
      pulledFor.current = householdId
      if (!result.available) {
        patch({
          vnextReady: false,
          vnextNote: result.missing
            ? 'Calendar imports, gifts, and meals stay on this device until the new Supabase migration is applied.'
            : result.message || 'Could not load the new tables.',
        })
        return
      }
      setState((prev) => ({
        ...prev,
        vnextReady: true,
        imports: result.imports,
        giftLists: result.giftLists.length ? result.giftLists : prev.giftLists,
        profiles: result.profiles.length ? mergeProfiles(result.profiles) : prev.profiles,
        mealPlans: Object.keys(result.mealPlans).length ? { ...prev.mealPlans, ...result.mealPlans } : prev.mealPlans,
        grocery: Object.keys(result.grocery).length ? { ...prev.grocery, ...result.grocery } : prev.grocery,
        events: mergeEvents([...(prev.events || []), ...result.events]),
        learningRemote: Boolean(result.learningRemote),
        learningProgress: result.learningProgress
          ? mergeLearning(prev.learningProgress, result.learningProgress)
          : prev.learningProgress,
        vnextNote: result.learningNote || '',
      }))
    })
    return () => {
      cancelled = true
    }
  }, [state.backend, state.householdId, patch])

  const applyVnext = useCallback((action) => {
    let snapshot = null
    update((prev) => {
      snapshot = vnextReducer(prev, action)
      return snapshot
    })
    queueMicrotask(() => {
      if (snapshot) void mirrorVnext(supabase, action, snapshot)
    })
  }, [update])

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
        update((prev) => ({
          ...prev,
          authBusy: false,
          authError: error ? friendlyAuthError(error.message) : null,
          authNotice: error ? prev.authNotice : null,
          authStep: error ? (prev.authStep === 'code' ? 'code' : 'email') : 'code',
          pendingEmail: error ? prev.pendingEmail : trimmed,
        }))
        if (error) throw error
      },
      async verifyOtp(token) {
        if (!supabase) throw new Error('Supabase is not configured')
        const code = String(token || '').replace(/\D/g, '')
        patch({ authBusy: true, authError: null })
        const { error } = await supabase.auth.verifyOtp({
          email: state.pendingEmail,
          token: code,
          type: 'email',
        })
        patch({ authBusy: false, authError: error ? friendlyAuthError(error.message) : null })
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
          authNotice: null,
        }))
      },
      resetDemo() {
        if (live) return
        const next = { ...freshState(), ...hydrateVnext(null) }
        setState((prev) => ({
          ...prev,
          ...next,
          session: prev.session,
          backend: prev.backend,
          backendMessage: prev.backendMessage,
          vnextReady: prev.vnextReady,
          vnextNote: prev.vnextNote,
        }))
      },
      toggleKidMode() {
        applyVnext({ type: 'toggle-kid-mode' })
      },
      updateProfile(memberKey, profilePatch) {
        applyVnext({ type: 'update-profile', memberKey, patch: profilePatch })
      },
      addGiftItem(listId) {
        applyVnext({ type: 'add-gift-item', listId })
      },
      updateGiftItem(listId, itemId, itemPatch) {
        applyVnext({ type: 'update-gift-item', listId, itemId, patch: itemPatch })
      },
      deleteGiftItem(listId, itemId) {
        applyVnext({ type: 'delete-gift-item', listId, itemId })
      },
      moveGiftItem(listId, itemId, dir) {
        applyVnext({ type: 'move-gift-item', listId, itemId, dir })
      },
      claimGift({ slug, itemId, name }) {
        applyVnext({ type: 'claim-gift', slug, itemId, name })
      },
      releaseClaim(listId, itemId) {
        applyVnext({ type: 'release-claim', listId, itemId })
      },
      planSuggestion(suggestion) {
        applyVnext({ type: 'plan-suggestion', suggestion })
      },
      toggleChecklist(eventId, checkId) {
        applyVnext({ type: 'toggle-checklist', eventId, checkId })
      },
      suggestWeek(weekStart) {
        applyVnext({ type: 'suggest-week', weekStart })
      },
      swapMeal(weekStart, date, slot) {
        applyVnext({ type: 'swap-meal', weekStart, date, slot })
      },
      toggleMealLock(weekStart, date, slot) {
        applyVnext({ type: 'toggle-lock', weekStart, date, slot })
      },
      toggleGrocery(weekStart, itemId) {
        applyVnext({ type: 'toggle-grocery', weekStart, itemId })
      },
      toggleLearningPlan(kidKey, weekStart, planId) {
        applyVnext({ type: 'toggle-learning-plan', kidKey, weekStart, planId })
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
        patch({ authStep: 'email', authError: null, authNotice: null, pendingEmail: '' })
      },
    }
  }, [state, ready, configured, update, patch, loadRsvps, applyVnext])

  return <BellContext.Provider value={api}>{children}</BellContext.Provider>
}

export function useBell() {
  const ctx = useContext(BellContext)
  if (!ctx) throw new Error('useBell must be used inside BellProvider')
  return ctx
}

function friendlyAuthError(message) {
  if (!message) return null
  if (/only request this after/i.test(message)) {
    return 'Wait a minute, then ask for another email.'
  }
  if (/token has expired or is invalid/i.test(message) || /otp.?expired/i.test(message)) {
    return 'That code didn’t work. Check the email for the latest code, or tap the link.'
  }
  return message
}
