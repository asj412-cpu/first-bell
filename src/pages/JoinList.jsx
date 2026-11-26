import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import GiftItemFields from '../components/GiftItemFields.jsx'
import ProfilePicker from '../components/ProfilePicker.jsx'
import { PARTY } from '../data/seed.js'
import { blankGiftItem, validateJoin, withGiftImages } from '../lib/exchange.js'
import { inviteStatusCopy, previewLocalInvite, rpcMissing } from '../lib/invites.js'
import { friendlyAuthError } from '../lib/authLink.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

const DRAFT_KEY = 'micasa-join-draft'

function emptyForm() {
  return { name: '', phone: '', email: '', group: '', items: [blankGiftItem()], others: [] }
}

export default function JoinList() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { state, joinExchange, sendOtp, verifyOtp, notify, markInviteUsed, addOrUpdateRsvp, refreshAccess } = useBell()
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [code, setCode] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(null)
  const statusRef = useRef(null)
  // Shared family link: if Andrew pre-made profiles, people pick their name
  // first. "I'm not on the list" falls back to the normal join form below.
  const [linkInfo, setLinkInfo] = useState(null)
  const [notListed, setNotListed] = useState(false)
  const demo = !supabase || state.backend === 'demo' || state.session?.demo
  const signedInEmail = (state.session?.email || '').toLowerCase()

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (demo) {
        if (!cancelled) setPreview(previewLocalInvite(token, state.exchange))
        return
      }
      const { data, error } = await supabase.rpc('preview_family_invite', { p_token: token })
      if (cancelled) return
      if (error) {
        setPreview(rpcMissing(error)
          ? { status: 'active', kind: 'gift_list', label: 'Christmas 2026', party_slug: null, legacy: true }
          : { status: 'missing', kind: null, label: '', party_slug: null })
        return
      }
      setPreview(data)
    }
    load().catch(() => {
      if (!cancelled) setPreview({ status: 'missing', kind: null, label: '', party_slug: null })
    })
    return () => {
      cancelled = true
    }
  }, [demo, token, state.exchange])

  useEffect(() => {
    if (demo || !supabase) return undefined
    let cancelled = false
    supabase.rpc('family_link_info', { p_token: token }).then(({ data, error }) => {
      if (!cancelled && !error && data) setLinkInfo(data)
    })
    return () => {
      cancelled = true
    }
  }, [demo, token])

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
      if (saved?.token === token && saved.form) setForm({ ...emptyForm(), ...saved.form })
    } catch {
      /* ignore a bad draft */
    }
  }, [token])

  useEffect(() => {
    if (signedInEmail) setForm((prev) => ({ ...prev, email: signedInEmail }))
  }, [signedInEmail])

  // Once a session exists (code accepted here, or the email link opened in
  // another tab), leave the code step so the button saves the form instead of
  // re-checking a code that has already been used.
  useEffect(() => {
    if (state.session && waiting) {
      setWaiting(false)
      setCode('')
    }
  }, [state.session, waiting])

  // Keep any status or error next to the button and on screen, so a tap never
  // looks like it did nothing.
  useEffect(() => {
    if (message && statusRef.current?.scrollIntoView) {
      statusRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [message])

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function changeItem(index, patch) {
    const items = form.items.slice()
    items[index] = { ...items[index], ...patch }
    update({ items })
  }

  async function persistGift(value) {
    const items = await withGiftImages(value.items)
    const others = await Promise.all(
      (value.others || []).map(async (person) => ({ ...person, items: await withGiftImages(person.items) })),
    )
    const ready = { ...value, items, others, token }
    if (demo) {
      const returning = state.exchange.participants.find(
        (person) => person.email && person.email.toLowerCase() === value.email,
      )
      const selfId = returning ? null : value.selfId || globalThis.crypto?.randomUUID?.() || `person-${Date.now()}`
      joinExchange({ ...ready, selfId })
      sessionStorage.removeItem(DRAFT_KEY)
      const listKey = returning?.listKey || `guest-${selfId}`
      notify('You are on the family list')
      navigate(`/gifts/${listKey}`)
      return
    }
    const { data, error } = await supabase.rpc('accept_gift_invite', {
      p_token: token,
      p_name: ready.name,
      p_phone: ready.phone,
      p_email: ready.email,
      p_group: ready.group,
      p_ideas: ready.items.map((item) => ({
        description: item.description,
        url: item.url,
        image: item.image,
      })),
      p_others: ready.others.map((person) => ({
        name: person.name,
        ideas: person.items.map((item) => ({
          description: item.description,
          url: item.url,
          image: item.image,
        })),
      })),
    })
    if (error) {
      setMessage(error.message || 'Could not save the list.')
      return
    }
    sessionStorage.removeItem(DRAFT_KEY)
    // The session was loaded before this person joined, so it has no gift
    // access yet. Reload access first or the list page bounces to sign-in.
    await refreshAccess?.().catch(() => {})
    notify('You are on the family list')
    const kidKey = data?.kid_key
    if (kidKey) {
      navigate(`/gifts/${kidKey}`)
      return
    }
    const access = await supabase.rpc('get_my_gift_lists')
    const mine = Array.isArray(access.data)
      ? access.data.find((list) => (list.display_name || '').toLowerCase() === ready.name.toLowerCase())
      : null
    navigate(mine?.kid_key ? `/gifts/${mine.kid_key}` : '/gifts')
  }

  async function persistEvent(name, rsvp) {
    if (demo) {
      markInviteUsed(token, 'guest@demo.local')
      await addOrUpdateRsvp({ child: name, parent: 'Guest', status: rsvp === 'none' ? 'yes' : rsvp, slug: PARTY.slug })
      notify('You are on the guest list')
      navigate(`/parties/${PARTY.id}`)
      return
    }
    const { error } = await supabase.rpc('accept_event_invite', {
      p_token: token,
      p_name: name,
      p_rsvp: rsvp,
    })
    if (error) {
      setMessage(error.message || 'Could not save your RSVP.')
      return
    }
    await refreshAccess?.().catch(() => {})
    notify('RSVP saved')
    navigate(`/parties/${PARTY.id}`)
  }

  async function save(event) {
    event?.preventDefault()
    if (preview?.kind === 'event') {
      if (form.name.trim().length < 2) {
        setErrors({ name: 'Enter your name.' })
        setMessage('Enter your name.')
        return
      }
      if (!demo && !state.session) {
        setMessage('Sign in with your email first.')
        return
      }
      setSaving(true)
      try {
        await persistEvent(form.name.trim(), form.rsvp || 'yes')
      } catch (err) {
        setMessage(err?.message || 'Could not save your RSVP. Try again.')
      } finally {
        setSaving(false)
      }
      return
    }
    const result = validateJoin({ ...form, email: signedInEmail || form.email })
    setErrors(result.errors)
    if (!result.ok) {
      const first = Object.values(result.errors || {}).find(Boolean)
      setMessage(typeof first === 'string' ? `Check the form: ${first}` : 'Check the highlighted fields above.')
      return
    }
    if (preview && preview.status !== 'active') {
      setMessage(inviteStatusCopy(preview.status).body)
      return
    }
    setSaving(true)
    setMessage('')
    try {
      if (demo || state.session) {
        await persistGift(result.value)
        return
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ token, form, value: result.value }))
      const sent = await sendOtp(result.value.email, window.location.href)
      if (sent?.mode === 'session') {
        await persistGift(result.value)
        return
      }
      setWaiting(true)
      setMessage('Check your email for a 6-digit code, or open the link. The link works in any browser. The code keeps your place in this form.')
    } catch (err) {
      setMessage(friendlyAuthError(err?.message) || 'Could not start sign-in.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmCode(event) {
    event?.preventDefault()
    // Already signed in (for example the email link opened in another tab):
    // there is no code left to check, so just go on to the details step.
    if (state.session) {
      setWaiting(false)
      setCode('')
      setMessage('')
      return
    }
    if (!code.replace(/\D/g, '')) {
      setMessage('Type the 6-digit code from the email.')
      return
    }
    setSaving(true)
    try {
      await verifyOtp(code)
      setWaiting(false)
      setCode('')
      let draft = null
      try {
        draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
      } catch {
        draft = null
      }
      if (preview?.kind === 'event') {
        if (form.name.trim().length >= 2) {
          await persistEvent(form.name.trim(), form.rsvp || 'yes')
          return
        }
        setMessage('You are signed in. Add your name and RSVP, then tap Save my RSVP.')
        return
      }
      if (draft?.token === token && draft?.value) {
        await persistGift(draft.value)
        return
      }
      setMessage('You are signed in. Add your name, phone, and household, then tap Join and open my list.')
    } catch (err) {
      setMessage(friendlyAuthError(err?.message) || 'That sign-in did not work. Try again or send a new code.')
    } finally {
      setSaving(false)
    }
  }

  async function beginSignIn(event) {
    event.preventDefault()
    const address = form.email.trim()
    if (!address) return
    setSaving(true)
    setMessage('')
    try {
      const sent = await sendOtp(address, window.location.href)
      if (sent?.mode === 'otp') {
        setWaiting(true)
        setMessage('Check your email for a 6-digit code, or open the link. The link works in any browser.')
      }
    } catch (err) {
      setMessage(friendlyAuthError(err?.message) || 'Could not start sign-in.')
    } finally {
      setSaving(false)
    }
  }

  if (!preview) {
    return (
      <div className="guest-page gift-guest">
        <header className="gift-guest-head">
          <div className="kicker">Mi Casa</div>
          <h1>Opening the invite…</h1>
        </header>
      </div>
    )
  }

  if (preview.status === 'active' && preview.kind === 'gift_list' && linkInfo?.has_profiles && !notListed) {
    return <ProfilePicker token={token} label={preview.label} onNotListed={() => setNotListed(true)} />
  }

  if (preview.status !== 'active') {
    const copy = inviteStatusCopy(preview.status)
    return (
      <div className="guest-page gift-guest">
        <header className="gift-guest-head">
          <img className="bell" src="/icons/icon-192.png" alt="" />
          <div className="kicker">Mi Casa</div>
          <h1>{copy.title}</h1>
          <p className="lede">{copy.body}</p>
          <p className="gate-note"><Link to="/enter">Family sign-in</Link></p>
        </header>
      </div>
    )
  }

  const eventInvite = preview.kind === 'event'
  const needsSignIn = !demo && !state.session

  return (
    <div className="guest-page gift-guest">
      <form className="gift-guest-head" onSubmit={needsSignIn ? (waiting ? confirmCode : beginSignIn) : save}>
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="kicker">{preview.label || 'Johnson family'}</div>
        <h1>{eventInvite ? 'You are invited' : 'Join the family list'}</h1>
        <p className="lede">
          {eventInvite
            ? 'Sign in with your email, then tell us your name and whether you can come. You can also add something to bring once you are in.'
            : 'Sign in with your email, then add your name and phone. You will get your own list. Bought gifts stay hidden from the person they are for.'}
        </p>

        {needsSignIn && (
          <label className="field">
            <span>Email</span>
            <input
              value={form.email}
              onChange={(event) => update({ email: event.target.value })}
              type="email"
              autoComplete="email"
              inputMode="email"
              required
            />
          </label>
        )}

        {!needsSignIn && (
          <>
            <label className="field">
              <span>Your name</span>
              <input value={form.name} onChange={(event) => update({ name: event.target.value })} autoComplete="name" />
            </label>
            {errors.name && <p className="form-error">{errors.name}</p>}
            {eventInvite ? (
              <label className="field">
                <span>RSVP</span>
                <select value={form.rsvp || 'yes'} onChange={(event) => update({ rsvp: event.target.value })}>
                  <option value="yes">Yes, I’ll be there</option>
                  <option value="maybe">Maybe</option>
                  <option value="no">I can’t come</option>
                </select>
              </label>
            ) : (
              <>
                <label className="field">
                  <span>Phone</span>
                  <input value={form.phone} onChange={(event) => update({ phone: event.target.value })} inputMode="tel" autoComplete="tel" placeholder="(713) 555-0100" />
                </label>
                {errors.phone && <p className="form-error">{errors.phone}</p>}
                <label className="field">
                  <span>Email</span>
                  <input
                    value={signedInEmail || form.email}
                    readOnly={Boolean(signedInEmail)}
                    onChange={(event) => {
                      if (!signedInEmail) update({ email: event.target.value })
                    }}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                  />
                </label>
                {errors.email && <p className="form-error">{errors.email}</p>}
                <label className="field">
                  <span>Your household</span>
                  <input value={form.group} onChange={(event) => update({ group: event.target.value })} placeholder="The Garcias" />
                </label>
                {errors.group && <p className="form-error">{errors.group}</p>}
                <h2>Gift ideas</h2>
                <p className="dim">Optional. You can add them now or later from your list.</p>
                <GiftItemFields
                  items={form.items}
                  errors={errors}
                  onChange={changeItem}
                  onAdd={() => update({ items: [...form.items, blankGiftItem()] })}
                  onRemove={(index) => {
                    const items = form.items.filter((_, item) => item !== index)
                    update({ items: items.length ? items : [blankGiftItem()] })
                  }}
                />
              </>
            )}
          </>
        )}

        {waiting && needsSignIn && (
          <label className="field">
            <span>Code from the email</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </label>
        )}
        {waiting && needsSignIn ? (
          <button className="btn primary big" type="submit" disabled={saving}>
            {saving ? 'Please wait…' : 'Finish and join'}
          </button>
        ) : (
          <button className="btn primary big" type="submit" disabled={saving}>
            {saving ? 'Please wait…' : needsSignIn ? 'Continue' : eventInvite ? 'Save my RSVP' : 'Join and open my list'}
          </button>
        )}
        <p ref={statusRef} className="lede" role="alert" aria-live="assertive" hidden={!message}>{message}</p>
        <p className="gate-note">
          {eventInvite
            ? 'This invite works once.'
            : 'Phone and email are visible only to Andrew and Megan.'}
          {demo ? ' This demo stays in this browser.' : ''}
        </p>
        <p className="gate-note"><Link to="/enter">Already in the family? Sign in</Link></p>
      </form>
    </div>
  )
}
