import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import BackendBanner from '../components/BackendBanner.jsx'
import { friendlyLinkError } from '../lib/authLink.js'
import { pendingJoin } from '../lib/pendingJoin.js'
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
  const [haveCode, setHaveCode] = useState(false)
  const codeRef = useRef(null)

  useEffect(() => {
    setEmail(state.pendingEmail || '')
  }, [state.pendingEmail])

  const linkFailed = Boolean(state.authLinkFailed)
  const onCodeStep = state.authStep === 'code'
  const showCode = onCodeStep || haveCode || linkFailed

  useEffect(() => {
    if (onCodeStep) codeRef.current?.focus()
  }, [onCodeStep])

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
  // Signed in but not in the house yet, and they opened the family link earlier
  // on this browser: take them back to "Who are you on the list?".
  const joinToken = signedInNoHouse ? pendingJoin() : null
  if (joinToken) return <Navigate to={`/join/${joinToken}`} replace />
  const digits = code.replace(/\D/g, '')
  const address = (email.trim() || state.pendingEmail || '').trim()

  async function onSend(e) {
    e.preventDefault()
    if (!address || state.authBusy) return
    try {
      await sendOtp(address)
      setCode('')
      setHaveCode(false)
    } catch {
      /* authError is set on the store */
    }
  }

  async function onVerify(e) {
    e.preventDefault()
    if (digits.length < 6 || !address || state.authBusy) return
    try {
      await verifyOtp(digits, address)
    } catch {
      /* authError is set on the store */
    }
  }

  function useDifferentEmail() {
    setCode('')
    setHaveCode(false)
    setEmail('')
    resetAuthForm()
  }

  const failureCopy = state.authNotice || friendlyLinkError('')
  let title = 'The house, handled.'
  if (showCode && linkFailed && !onCodeStep) title = 'That link didn’t work'
  else if (showCode && !signedInNoHouse) title = onCodeStep ? 'Check your email' : 'Enter your code'

  return (
    <div className="gate">
      <div className="gate-bg" aria-hidden="true" />
      <div className="card gate-card">
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="eyebrow">Mi Casa</div>
        <h1>{title}</h1>
        {configured && !signedInNoHouse && linkFailed && !onCodeStep ? (
          <p className="lede" role="alert">
            {failureCopy}
          </p>
        ) : configured && !signedInNoHouse && onCodeStep ? (
          <p className="lede">
            We emailed <strong>{state.pendingEmail}</strong>. Type the 6-digit code, or open the link.
            The link works even if Mail opens a different browser.
          </p>
        ) : configured && !signedInNoHouse && haveCode ? (
          <p className="lede">Type the 6-digit code from the email, and the address it was sent to.</p>
        ) : configured && !signedInNoHouse ? (
          <p className="lede">
            If you have signed in with this email before, we’ll open the house. A new email still gets a code.
          </p>
        ) : (
          <p className="lede">
            Parties, inbox, calendar. Open the house on this browser — no password.
          </p>
        )}

        <BackendBanner />

        {state.authNotice && !signedInNoHouse && !linkFailed && (
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
              Household admins use asj412@me.com or asj412@icloud.com. If someone invited you, open that invite link instead of this screen.
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

        {configured && !signedInNoHouse && !showCode && (
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
              {state.authBusy ? 'Please wait…' : 'Continue'}
            </button>
            <button className="btn ghost full" type="button" onClick={() => setHaveCode(true)}>
              I have a code
            </button>
            <p className="gate-note">
              No password. A returning email opens the house on this phone. A new email gets a 6-digit code and a link — either one works in any browser. On a home-screen app, type the code so you stay in Mi Casa.
            </p>
          </form>
        )}

        {configured && !signedInNoHouse && showCode && (
          <form onSubmit={digits.length >= 6 ? onVerify : onSend}>
            {onCodeStep && (
              <p className="gate-hint">
                On a home-screen app, type the code so you stay in Mi Casa. The link opens Safari, and that session stays in Safari.
              </p>
            )}
            {!onCodeStep && (
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
            )}
            <div className="field">
              <label htmlFor="otp">6-digit code</label>
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
              />
            </div>
            {state.authError && (
              <p className="form-error" role="alert">
                {state.authError}
              </p>
            )}
            <div className="gate-actions">
              <button className="btn primary full" type="submit" disabled={state.authBusy || !address}>
                {state.authBusy ? 'Please wait…' : digits.length >= 6 ? 'Sign in' : 'Send a new link'}
              </button>
              {digits.length >= 6 && (
                <button className="btn ghost full" type="button" disabled={state.authBusy || !address} onClick={onSend}>
                  {state.authBusy ? 'Please wait…' : 'Send a new link'}
                </button>
              )}
              <button className="btn ghost full" type="button" onClick={useDifferentEmail}>
                Use a different email
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
