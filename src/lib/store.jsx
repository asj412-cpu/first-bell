import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { mergeProfiles } from '../data/profiles.js'
import { isUuid, mergeGiftLists, publicPayloadToList, safeHttp } from './gifts.js'
import { freshState, HOUSEHOLD, PARTY } from '../data/seed.js'
import { mergeEvents } from './events.js'
import { fromDbRsvp, hostDisplayName, toDbStatus } from './rsvps.js'
import { newInviteToken } from './invites.js'
import { forgetDevice, rememberDevice, requestReentry } from './reentry.js'
import { pinLogin, rememberPinEmail } from './pin.js'
import { authConfirmUrl, friendlyAuthError, friendlyLinkError } from './authLink.js'
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
    authLinkFailed: false,
    authStep: 'email',
    pendingEmail: '',
    eventAccess: [],
    giftAccess: null,
    toast: '',
  }))
  const toastTimer = useRef(null)
  const partyUuidRef = useRef(null)
  partyUuidRef.current = state.partyUuid
  const pulledFor = useRef(null)

  const notify = useCallback((message) => {
    setState((prev) => ({ ...prev, toast: message || '' }))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      setState((prev) => ({ ...prev, toast: '' }))
    }, 2600)
  }, [])

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
      exchange: state.exchange,
      profiles: state.profiles,
      mealPlans: state.mealPlans,
      grocery: state.grocery,
      learningProgress: state.learningProgress,
      kidMode: state.kidMode,
      tasks: state.tasks,
      contributions: state.contributions,
    })
  }, [state.session, state.guests, state.messages, state.backend, state.events, state.imports, state.giftLists, state.exchange, state.profiles, state.mealPlans, state.grocery, state.learningProgress, state.kidMode, state.tasks, state.contributions])

  const loadRsvps = useCallback(async (partyUuid, shouldApply = () => true) => {
    if (!supabase || !partyUuid) return
    const { data, error } = await supabase
      .from('rsvps')
      .select('id, guest_name, parent_name, status, note, created_at, updated_at')
      .eq('party_id', partyUuid)
      .order('created_at', { ascending: true })
    if (error) throw error
    if (!shouldApply()) return
    patch({ guests: (data || []).map(fromDbRsvp) })
  }, [patch])

  const bootstrapGen = useRef(0)

  const bootstrapLive = useCallback(
    async (user) => {
      const gen = ++bootstrapGen.current
      const current = () => bootstrapGen.current === gen
      try {
        const { data: party, error: partyErr } = await supabase
          .from('parties')
          .select('id, household_id, slug')
          .eq('slug', CHLOE_SLUG)
          .maybeSingle()
        if (partyErr) throw partyErr
        if (!current()) return

        let householdId = null
        let memberRole = null
        let giftLists = null
        let eventAccess = []
        let managedMembers = []
        let giftAccess = null
        if (user) {
          const { data: membership, error: memErr } = await supabase.rpc('ensure_host_membership')
          if (memErr) throw memErr
          if (!current()) return
          householdId = membership?.household_id || null
          memberRole = membership?.role || null
          await supabase.rpc('link_gift_participant').then(() => {}, () => {})
          if (!current()) return
          if (!householdId) {
            const access = await supabase.rpc('get_my_gift_access').then((result) => result.data, () => null)
            if (!current()) return
            if (access?.household_id) {
              householdId = access.household_id
              memberRole = 'gift'
              // Is this person in the drawing? Is it locked? (undefined on older databases.)
              giftAccess = { inDraw: access.in_draw, drawingLocked: access.drawing_locked }
              const lists = await supabase.rpc('get_my_gift_lists').then((result) => result.data, () => null)
              if (!current()) return
              if (Array.isArray(lists)) {
                giftLists = lists.map((row) => publicPayloadToList({ list: row, items: row.items, purchases_visible: false }))
              }
            }
          }
          if (!householdId) {
            const events = await supabase.rpc('get_my_event_access').then((result) => result.data, () => null)
            if (!current()) return
            if (Array.isArray(events) && events.length) {
              eventAccess = events
              memberRole = 'guest'
            }
          }
          if (householdId && memberRole !== 'gift') {
            const tasks = await supabase.rpc('list_household_tasks').then((result) => result.data, () => null)
            if (!current()) return
            if (Array.isArray(tasks)) {
              setState((prev) => ({ ...prev, tasks }))
            }
          }
        }

        if (user && householdId) {
          // Family members added under an invited member (husband, kids). Older
          // databases without the RPC simply return nothing.
          managedMembers = await supabase
            .rpc('get_managed_members')
            .then((result) => (Array.isArray(result.data) ? result.data : []), () => [])
        }

        if (!current()) return
        patch({
          backend: 'live',
          backendMessage: '',
          partyUuid: party?.id || null,
          householdId,
          memberRole,
          eventAccess,
          managedMembers,
          giftAccess,
          ...(giftLists ? { giftLists } : {}),
          session: user
            ? sessionFromUser(user, { householdId, role: memberRole })
            : null,
        })

        if (user && householdId && party?.id) {
          if (!current()) return
          await loadRsvps(party.id, current)
        } else if (!user) {
          if (!current()) return
          patch({ guests: load().guests })
        }
      } catch (err) {
        if (!current()) return
        patch({
          backend: 'offline',
          backendMessage: err.message || 'Supabase is unreachable.',
          session: user ? sessionFromUser(user) : null,
          guests: load().guests,
        })
      } finally {
        if (current()) setReady(true)
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
      const linkFailed =
        !user &&
        !authCallback.tokenHash &&
        (authCallback.hasCode || authCallback.errorDescription || authCallback.errorCode)
      if (linkFailed) {
        patch({
          authLinkFailed: true,
          authNotice: friendlyLinkError(authCallback.errorDescription),
          authError: null,
          authStep: 'email',
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
    if (!supabase || state.backend !== 'live' || !state.householdId || state.memberRole === 'gift') return undefined
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
        giftLists: result.giftLists.length ? mergeGiftLists(result.giftLists) : prev.giftLists,
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
  }, [state.backend, state.householdId, state.memberRole, patch])

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

  const markEmailLinkWorking = useCallback(() => {
    patch({ authBusy: true, authLinkFailed: false, authError: null })
  }, [patch])

  const failEmailLink = useCallback((message) => {
    patch({
      authBusy: false,
      authLinkFailed: true,
      authNotice: message || friendlyLinkError(''),
      authError: null,
      authStep: 'email',
    })
  }, [patch])

  const finishEmailLink = useCallback(() => {
    patch({ authBusy: false, authLinkFailed: false, authError: null, authNotice: null })
  }, [patch])

  const api = useMemo(() => {
    const live = state.backend === 'live' && Boolean(supabase)

    return {
      state,
      ready,
        entered: Boolean(
          state.session &&
            (state.session.demo ||
              state.householdId ||
              (state.eventAccess && state.eventAccess.length) ||
              !configured ||
              state.backend === 'offline'),
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
      async sendOtp(email, redirectTo) {
        if (!supabase) throw new Error('Supabase is not configured')
        const trimmed = email.trim().toLowerCase()
        patch({ authBusy: true, authError: null })
        const reentry = await requestReentry(trimmed)
        if (reentry.mode === 'limited') {
          patch({ authBusy: false, authError: reentry.message, authStep: 'email' })
          throw new Error(reentry.message)
        }
        if (reentry.mode === 'session') {
          const { error } = await supabase.auth.setSession({
            access_token: reentry.access_token,
            refresh_token: reentry.refresh_token,
          })
          patch({
            authBusy: false,
            authError: error ? friendlyAuthError(error.message) : null,
            authLinkFailed: false,
            authStep: 'email',
            pendingEmail: trimmed,
          })
          if (error) throw error
          return { mode: 'session' }
        }
        const { error } = await supabase.auth.signInWithOtp({
          email: trimmed,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: authConfirmUrl(window.location.origin, redirectTo || '/'),
          },
        })
        update((prev) => ({
          ...prev,
          authBusy: false,
          authError: error ? friendlyAuthError(error.message) : null,
          authNotice: error ? prev.authNotice : null,
          authLinkFailed: error ? prev.authLinkFailed : false,
          authStep: error ? (prev.authStep === 'code' ? 'code' : 'email') : 'code',
          pendingEmail: error ? prev.pendingEmail : trimmed,
        }))
        if (error) throw error
        return { mode: 'otp' }
      },
      async pinSignIn(email, pin) {
        if (!supabase) throw new Error('Supabase is not configured')
        const address = String(email || '').trim().toLowerCase()
        patch({ authBusy: true, authError: null, authNotice: null, pendingEmail: address })
        const got = await pinLogin(address, pin)
        if (got.mode !== 'session') {
          patch({ authBusy: false })
          return got
        }
        const { error } = await supabase.auth.setSession({
          access_token: got.access_token,
          refresh_token: got.refresh_token,
        })
        if (!error) rememberPinEmail(address)
        patch({
          authBusy: false,
          authError: error ? friendlyAuthError(error.message) : null,
          authLinkFailed: false,
          authStep: 'email',
        })
        return error ? { mode: 'error' } : { mode: 'session' }
      },
      async verifyOtp(token, email) {
        if (!supabase) throw new Error('Supabase is not configured')
        const address = String(email || state.pendingEmail || '').trim().toLowerCase()
        const code = String(token || '').replace(/\D/g, '')
        if (!address) {
          patch({ authBusy: false, authError: 'Enter the email address the code was sent to.' })
          throw new Error('Enter the email address the code was sent to.')
        }
        patch({ authBusy: true, authError: null, pendingEmail: address })
        const { data: verified, error } = await supabase.auth.verifyOtp({
          email: address,
          token: code,
          type: 'email',
        })
        if (!error) {
          await supabase.rpc('mark_email_verified').then(() => {}, () => {})
          await rememberDevice(verified?.session?.access_token)
        }
        patch({
          authBusy: false,
          authError: error ? friendlyAuthError(error.message) : null,
          authLinkFailed: error ? state.authLinkFailed : false,
        })
        if (error) throw error
        return { mode: 'session' }
      },
      async signOut() {
        if (live) {
          await forgetDevice()
          await supabase.auth.signOut()
        }
        update((s) => ({
          ...s,
          session: null,
          householdId: null,
          memberRole: null,
          giftAccess: null,
          eventAccess: [],
          authStep: 'email',
          pendingEmail: '',
          authError: null,
          authNotice: null,
          authLinkFailed: false,
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
        if (live && isUuid(itemId)) {
          supabase.rpc('release_gift_purchase', { p_item_id: itemId }).then(() => {}, () => {})
        }
      },
      notify,
      joinExchange(value) {
        applyVnext({ type: 'join-exchange', value })
      },
      markInviteUsed(token, email) {
        if (!token) return
        update((prev) => ({
          ...prev,
          exchange: {
            ...prev.exchange,
            invites: (prev.exchange.invites || []).map((invite) =>
              invite.token === token ? { ...invite, usedAt: new Date().toISOString(), usedByEmail: email || '' } : invite,
            ),
          },
        }))
      },
      async createFamilyInvite({ kind, partySlug, label }) {
        if (!(live && supabase)) {
          const token = newInviteToken()
          const invite = {
            token,
            kind,
            label: label || (kind === 'event' ? 'Family event' : 'Christmas 2026'),
            partySlug: partySlug || null,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            singleUse: true,
            usedAt: null,
          }
          update((prev) => ({
            ...prev,
            exchange: { ...prev.exchange, invites: [...(prev.exchange.invites || []), invite] },
          }))
          return invite
        }
        const { data, error } = await supabase.rpc('create_family_invite', {
          p_kind: kind,
          p_party_slug: partySlug || null,
          p_label: label || null,
        })
        if (error) throw error
        return data
      },
      addTask(title) {
        const clean = title.trim()
        if (clean.length < 2) return
        const task = { id: newInviteToken().slice(0, 16), title: clean.slice(0, 120), done: false }
        update((prev) => ({ ...prev, tasks: [...(prev.tasks || []), task] }))
        if (live && supabase) {
          supabase.rpc('save_household_task', { p_client_id: task.id, p_title: task.title, p_done: false }).then(() => {}, () => {})
        }
        notify('Chore added')
      },
      toggleTask(id) {
        let next = null
        update((prev) => {
          const tasks = (prev.tasks || []).map((task) => {
            if (task.id !== id) return task
            next = { ...task, done: !task.done }
            return next
          })
          return { ...prev, tasks }
        })
        if (next && live && supabase) {
          supabase
            .rpc('save_household_task', { p_client_id: next.id, p_title: next.title, p_done: next.done })
            .then(() => {}, () => {})
        }
      },
      addContribution(partyId, kind, title) {
        const clean = title.trim()
        if (clean.length < 2) return
        const row = {
          id: newInviteToken().slice(0, 16),
          partyId,
          kind,
          title: clean.slice(0, 120),
          ownerName: '',
          done: false,
        }
        update((prev) => ({ ...prev, contributions: [...(prev.contributions || []), row] }))
        notify(kind === 'bring' ? 'Added to the bring list' : 'Task added')
        return row
      },
      setContribution(id, patchRow) {
        update((prev) => ({
          ...prev,
          contributions: (prev.contributions || []).map((row) => (row.id === id ? { ...row, ...patchRow } : row)),
        }))
      },
      saveOwnItems(listId, items) {
        applyVnext({ type: 'save-own-items', listId, items })
      },
      async fillMissingGiftImage(itemId, image) {
        const next = safeHttp(image)
        if (!next || !itemId) return
        update((prev) => {
          let changed = false
          const giftLists = (prev.giftLists || []).map((list) => ({
            ...list,
            items: (list.items || []).map((item) => {
              if (item.id !== itemId || item.image) return item
              changed = true
              return { ...item, image: next }
            }),
          }))
          return changed ? { ...prev, giftLists } : prev
        })
        if (!(live && isUuid(itemId))) return
        const { error } = await supabase
          .from('gift_items')
          .update({ image: next })
          .eq('id', itemId)
          .or('image.is.null,image.eq.')
        if (error) {
          /* signed-out viewers and non-members cannot write; the card still shows the preview */
        }
      },
      setInDraw(participantId, inDraw) {
        applyVnext({ type: 'set-in-draw', participantId, inDraw })
      },
      setAvoidGroup(avoid) {
        applyVnext({ type: 'set-avoid-group', avoid })
      },
      drawSanta() {
        applyVnext({ type: 'draw-santa' })
      },
      lockSanta() {
        applyVnext({ type: 'lock-santa' })
      },
      saveMeganContact(phone, email) {
        applyVnext({ type: 'save-megan-contact', phone, email })
      },
      previewReminder(preview) {
        applyVnext({ type: 'preview-reminder', preview })
      },
      addNamedWish(listId, title) {
        const itemId = globalThis.crypto?.randomUUID?.() || `wish-${Date.now()}`
        applyVnext({ type: 'add-named-wish', listId, itemId, title })
        return itemId
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
        patch({ authStep: 'email', authError: null, authNotice: null, authLinkFailed: false, pendingEmail: '' })
      },
      /** Re-read household / gift / event access after an invite is accepted. */
      async addManagedMember({ name, relationship, age }) {
        if (!(live && supabase)) throw new Error('Adding family members needs the live family list.')
        const { data, error } = await supabase.rpc('add_managed_member', {
          p_name: String(name || '').trim(),
          p_relationship: String(relationship || '').trim() || null,
          p_age: String(age || '').trim() || null,
        })
        if (error) throw error
        const { data: auth } = await supabase.auth.getUser()
        await bootstrapLive(auth?.user ?? null)
        if (data?.list_id) {
          // Household owners load lists separately; make sure the new one shows.
          setState((prev) => {
            if (prev.giftLists.some((list) => list.id === data.list_id)) return prev
            return {
              ...prev,
              giftLists: [
                ...prev.giftLists,
                {
                  id: data.list_id,
                  kidKey: data.kid_key,
                  displayName: data.display_name,
                  occasion: data.occasion,
                  shareSlug: data.share_slug,
                  listKind: 'exchange',
                  items: [],
                },
              ],
            }
          })
        }
        return data
      },
      async updateManagedMember(listId, { name, relationship, age }) {
        if (!(live && supabase)) throw new Error('Editing family members needs the live family list.')
        const { data, error } = await supabase.rpc('update_managed_member', {
          p_list: listId,
          p_name: String(name || '').trim(),
          p_relationship: String(relationship || '').trim() || null,
          p_age: String(age || '').trim() || null,
        })
        if (error) throw error
        setState((prev) => ({
          ...prev,
          giftLists: prev.giftLists.map((list) => (list.id === listId ? { ...list, displayName: data.display_name } : list)),
          managedMembers: (prev.managedMembers || []).map((row) => (row.list_id === listId ? { ...row, ...data } : row)),
        }))
        return data
      },
      async removeManagedMember(listId) {
        if (!(live && supabase)) throw new Error('Removing family members needs the live family list.')
        const { error } = await supabase.rpc('remove_managed_member', { p_list: listId })
        if (error) throw error
        setState((prev) => ({
          ...prev,
          giftLists: prev.giftLists.filter((list) => list.id !== listId),
          managedMembers: (prev.managedMembers || []).filter((row) => row.list_id !== listId),
        }))
      },
      async saveManagedItems(listId, items) {
        if (!(live && supabase)) throw new Error('Saving needs the live family list.')
        const { error } = await supabase.rpc('save_managed_member_items', {
          p_list: listId,
          p_items: items.map((item) => ({
            id: isUuid(item.id) ? item.id : null,
            description: item.description,
            url: item.url,
            image: item.image,
            notes: item.notes || '',
          })),
        })
        if (error) throw error
        if (state.memberRole === 'gift') {
          const { data: auth } = await supabase.auth.getUser()
          await bootstrapLive(auth?.user ?? null)
        } else {
          applyVnext({ type: 'save-own-items', listId, items })
        }
      },
      async refreshAccess() {
        if (!supabase) return
        const { data } = await supabase.auth.getUser()
        await bootstrapLive(data?.user ?? null)
      },
      markEmailLinkWorking,
      failEmailLink,
      finishEmailLink,
    }
  }, [bootstrapLive, state, ready, configured, update, patch, loadRsvps, applyVnext, notify, markEmailLinkWorking, failEmailLink, finishEmailLink])

  return <BellContext.Provider value={api}>{children}</BellContext.Provider>
}

export function useBell() {
  const ctx = useContext(BellContext)
  if (!ctx) throw new Error('useBell must be used inside BellProvider')
  return ctx
}

