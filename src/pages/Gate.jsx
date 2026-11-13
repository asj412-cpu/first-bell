import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import BackendBanner from '../components/BackendBanner.jsx'
import { useBell } from '../lib/store.jsx'

export default function Gate() {
  const {
    entered,
    ready,
    configured,
    enterDemo,
    sendOtp,
    verifyOtp,
    signOut,
    resetAuthForm,
    state,
  } = useBell()
  const [email, setEmail] = useState(state.pendingEmail || '')
  const [code, setCode] = useState('')
  const codeRef = useRef(null)

  useEffect(() => {
    setEmail(state.pendingEmail || '')
  }, [state.pendingEmail])

  useEffect(() => {
    if (state.authStep === 'code') codeRef.current?.focus()
  }, [state.authStep])

  if (!ready) {
    return (
      <div className="gate">
        <div className="gate-bg" aria-hidden="true" />
        <div className="card gate-card">
          <img className="bell" src="/icons/icon-192.png" alt="" />
          <div className="eyebrow">Mi Casa</div>
          <h1>Opening the house…</h1>
          <p className="lede">Checking your session.</p>
        </div>
      </div>
    )
  }

  if (entered) return <Navigate to="/" replace />

  const signedInNoHouse = Boolean(state.session && configured && !state.householdId)
  const onCodeStep = state.authStep === 'code'
  const digits = code.replace(/\D/g, '')

  async function onSend(e) {
    e.preventDefault()
    const address = email.trim() || state.pendingEmail
    if (!address || state.authBusy) return
    try {
      await sendOtp(address)
      setCode('')
    } catch {
      /* authError is set on the store */
    }
  }

  async function onVerify(e) {
    e.preventDefault()
    if (digits.length < 6 || state.authBusy) return
    try {
      await verifyOtp(digits)
    } catch {
      /* authError is set on the store */
    }
  }

  return (
    <div className="gate">
      <div className="gate-bg" aria-hidden="true" />
      <div className="card gate-card">
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="eyebrow">Mi Casa</div>
        <h1>{onCodeStep && !signedInNoHouse ? 'Check your email' : 'The house, handled.'}</h1>
        {configured && !signedInNoHouse && onCodeStep ? (
          <p className="lede">
            We emailed <strong>{state.pendingEmail}</strong>. If it shows a code, type it here. You
            can also tap the link.
          </p>
        ) : configured && !signedInNoHouse ? (
          <p className="lede">We’ll email you a sign-in code (or a link you can tap).</p>
        ) : (
          <p className="lede">
            Parties, inbox, calendar. Open the house on this browser — no password.
          </p>
        )}

        <BackendBanner />

        {state.authNotice && !signedInNoHouse && (
          <p className="gate-hint" role="status">
            {state.authNotice}
          </p>
        )}

        {signedInNoHouse && (
          <div className="gate-alert">
            <p>
              Signed in as <strong>{state.session.email}</strong>, but this email isn’t on the Johnson
              household yet.
            </p>
            <p className="dim">
              Use asj412@me.com or asj412@icloud.com after the seed migration, or add this address to{' '}
              <code>households.host_emails</code>.
            </p>
            <button className="btn ghost full" type="button" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        )}

        {!configured && (
          <>
            <button className="btn primary full" onClick={enterDemo}>
              Enter Johnson household
            </button>
            <p className="gate-note">Demo mode · no password · stays in this browser</p>
          </>
        )}

        {configured && !signedInNoHouse && !onCodeStep && (
          <form onSubmit={onSend}>
            <div className="field">
              <label htmlFor="host-email">Email</label>
              <input
                id="host-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@email.com"
                required
              />
            </div>
            {state.authError && (
              <p className="form-error" role="alert">
                {state.authError}
              </p>
            )}
            <button className="btn primary full" type="submit" disabled={state.authBusy}>
              {state.authBusy ? 'Sending…' : 'Email me a sign-in'}
            </button>
            <p className="gate-note">
              No password. On an iPhone or iPad home-screen app, type the code — a link opens Safari.
              Guest RSVPs never need this.
            </p>
          </form>
        )}

        {configured && !signedInNoHouse && onCodeStep && (
          <form onSubmit={onVerify}>
            <p className="gate-hint">
              On a home-screen app, type the code so you stay in Mi Casa. Tapping the link opens
              Safari instead.
            </p>
            <div className="field">
              <label htmlFor="otp">Sign-in code</label>
              <input
                ref={codeRef}
                id="otp"
                className="otp"
                name="one-time-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="done"
                pattern="[0-9]*"
                maxLength={10}
                value={digits}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                required
              />
            </div>
            {state.authError && (
              <p className="form-error" role="alert">
                {state.authError}
              </p>
            )}
            <div className="gate-actions">
              <button className="btn primary full" type="submit" disabled={state.authBusy || digits.length < 6}>
                {state.authBusy ? 'Please wait…' : 'Sign in'}
              </button>
              <button className="btn ghost full" type="button" disabled={state.authBusy} onClick={onSend}>
                {state.authBusy ? 'Please wait…' : 'Send the email again'}
              </button>
              <button className="btn ghost full" type="button" onClick={resetAuthForm}>
                Use a different email
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
