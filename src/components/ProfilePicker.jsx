import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar.jsx'
import { friendlyAuthError } from '../lib/authLink.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

/**
 * The shared family link: sign in, then tap who you are on Andrew's list.
 * Shows display names only. Claiming is one atomic database call, so if two
 * people tap the same name, the second one is told and the list refreshes.
 */
export default function ProfilePicker({ token, label, onNotListed }) {
  const navigate = useNavigate()
  const { state, sendOtp, verifyOtp, refreshAccess } = useBell()
  const signedIn = Boolean(state.session)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [names, setNames] = useState(null)
  const [already, setAlready] = useState(null)
  const [chosen, setChosen] = useState(null)

  async function loadNames() {
    const { data, error } = await supabase.rpc('list_claimable_profiles', { p_token: token })
    if (error) {
      setMessage(error.message)
      setNames([])
      return
    }
    setAlready(data?.already || null)
    setNames(data?.profiles || [])
  }

  useEffect(() => {
    if (!signedIn) return
    setWaiting(false)
    loadNames().catch(() => setMessage('Could not load the names. Try again.'))
  }, [signedIn, token])

  async function begin(event) {
    event.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const sent = await sendOtp(email.trim(), window.location.href)
      if (sent?.mode === 'otp') {
        setWaiting(true)
        setMessage('Check your email for a 6-digit code.')
      }
    } catch (err) {
      setMessage(friendlyAuthError(err?.message) || 'Could not start sign-in.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmCode(event) {
    event.preventDefault()
    if (!code.replace(/\D/g, '')) {
      setMessage('Type the 6-digit code from the email.')
      return
    }
    setBusy(true)
    try {
      await verifyOtp(code, email.trim())
      setMessage('')
    } catch (err) {
      setMessage(friendlyAuthError(err?.message) || 'That code did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function claim() {
    if (!chosen) return
    setBusy(true)
    setMessage('')
    const { data, error } = await supabase.rpc('claim_gift_profile', { p_token: token, p_participant: chosen.id })
    if (error) {
      setBusy(false)
      setChosen(null)
      setMessage(error.message)
      await loadNames()
      return
    }
    await refreshAccess()
    setBusy(false)
    navigate(data?.kid_key ? `/gifts/${data.kid_key}` : '/gifts')
  }

  return (
    <div className="guest-page gift-guest picker-page">
      <header className="picker-hero">
        <div className="picker-ribbon" aria-hidden="true" />
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="kicker">{label || 'Christmas 2026'}</div>
        <h1>Who are you on the list?</h1>
        <p className="lede">
          Andrew set up everyone’s spot. Sign in, tap your name, and your gift list and Secret Santa are yours.
        </p>
      </header>

      {!signedIn && (
        <form className="picker-card" onSubmit={waiting ? confirmCode : begin}>
          <div className="picker-step">Step 1 of 2 · Sign in</div>
          <label className="field">
            <span>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              placeholder="name@email.com"
              disabled={waiting}
            />
          </label>
          {waiting && (
            <label className="field">
              <span>6-digit code</span>
              <input
                className="otp"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
          )}
          <button className="btn primary big" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : waiting ? 'Sign in' : 'Continue'}
          </button>
          <p className="gate-note">We email you a code. Nothing else is sent.</p>
        </form>
      )}

      {signedIn && already && (
        <section className="picker-card picker-done">
          <div className="picker-step">You’re all set</div>
          <h2>You’re on the list as {already.name}</h2>
          <button
            className="btn primary big"
            type="button"
            onClick={() => navigate(already.kid_key ? `/gifts/${already.kid_key}` : '/gifts')}
          >
            Open my list
          </button>
          <p className="gate-note">Picked the wrong name? Ask Andrew to fix it.</p>
        </section>
      )}

      {signedIn && !already && (
        <section className="picker-card" aria-labelledby="picker-title">
          <div className="picker-step">Step 2 of 2 · Tap your name</div>
          <h2 id="picker-title" className="sr-only">Names on the list</h2>
          {names === null && <p className="dim">Loading names…</p>}
          {names && names.length > 0 && (
            <ul className="picker-grid" role="list">
              {names.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className={`picker-tile${chosen?.id === person.id ? ' is-chosen' : ''}`}
                    aria-pressed={chosen?.id === person.id}
                    onClick={() => setChosen(person)}
                  >
                    <Avatar name={person.name} seed={person.id} />
                    <span>{person.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {names && names.length === 0 && (
            <p className="lede">Everyone on Andrew’s list has picked their name already.</p>
          )}
          <button className="btn ghost full picker-not-listed" type="button" onClick={onNotListed}>
            I’m not on the list
          </button>
        </section>
      )}

      {message && <p className="form-error picker-message" role="alert">{message}</p>}

      {chosen && (
        <div className="picker-sheet" role="dialog" aria-modal="true" aria-labelledby="picker-confirm">
          <div className="picker-sheet-card">
            <Avatar name={chosen.name} seed={chosen.id} className="big" />
            <h2 id="picker-confirm">You’re {chosen.name}?</h2>
            <p className="lede">
              This links your sign-in to {chosen.name}’s list and Secret Santa spot. Only Andrew can change it after.
            </p>
            <button className="btn primary big" type="button" onClick={claim} disabled={busy}>
              {busy ? 'Linking…' : `Yes, I’m ${chosen.name}`}
            </button>
            <button className="btn ghost full" type="button" onClick={() => setChosen(null)} disabled={busy}>
              Not me
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
