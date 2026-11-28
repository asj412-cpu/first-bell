import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import BackendBanner from '../components/BackendBanner.jsx'
import { friendlyLinkError } from '../lib/authLink.js'
import { codeInputProps, emailInputProps, normalizeCode, readAuthForm, useLiveField } from '../lib/authFields.js'
import { pendingJoin } from '../lib/pendingJoin.js'
import { markPinReset, normalizePin, pinEmailHint, pinEnabled } from '../lib/pin.js'
import { pinInputProps } from '../components/PinSetup.jsx'
import { useBell } from '../lib/store.jsx'

export default function Gate() {
  const {
    entered,
    ready,
    configured,
    enterDemo,
    sendOtp,
    verifyOtp,
    pinSignIn,
    signOut,
    resetAuthForm,
    state,
  } = useBell()
  const [email, setEmail, emailRef] = useLiveField(state.pendingEmail || (pinEnabled ? pinEmailHint() : ''))
  const [code, setCode, codeRef] = useLiveField('')
  const [pin, setPin, pinRef] = useLiveField('')
  const [haveCode, setHaveCode] = useState(false)
  const [pinError, setPinError] = useState('')

  useEffect(() => {
    if (state.pendingEmail) setEmail(state.pendingEmail)
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
  const digits = normalizeCode(code)
  const address = (email.trim() || state.pendingEmail || '').trim().toLowerCase()

  function syncFromForm(event) {
    const name = event.target?.name
    if (name === 'email') setEmail(event.target.value)
    if (name === 'one-time-code') setCode(event.target.value)
    if (name === 'pin' || name === 'email') setPinError('')
  }

  async function onSend(e, liveEmail) {
    e.preventDefault?.()
    const nextEmail = typeof liveEmail === 'string' && liveEmail
      ? liveEmail
      : readAuthForm(e, { email: address }).email
    if (!nextEmail || state.authBusy) return
    try {
      await sendOtp(nextEmail)
      setCode('')
      setHaveCode(false)
    } catch {
      /* authError is set on the store */
    }
  }

  async function onVerify(e, live) {
    e.preventDefault?.()
    const got = live || readAuthForm(e, { email: address, code })
    if (got.code.length < 6 || !got.email || state.authBusy) return
    try {
      await verifyOtp(got.code, got.email)
    } catch {
      /* authError is set on the store */
    }
  }

  async function onAuthSubmit(e) {
    e.preventDefault()
    const live = readAuthForm(e, { email: address, code })
    if (live.email) setEmail(live.email)
    if (live.code) setCode(live.code)
    const pinField = (e.currentTarget?.elements || e.target?.form?.elements)?.namedItem?.('pin')
    const livePin = normalizePin(pinField?.value || pin)
    setPinError('')
    if (live.code.length >= 6) await onVerify(e, live)
    else if (pinEnabled && livePin.length === 4 && live.email) await onPin(live.email, livePin)
    else await onSend(e, live.email)
  }

  async function onPin(nextEmail, nextPin) {
    if (state.authBusy) return
    const got = await pinSignIn(nextEmail, nextPin)
    if (got.mode === 'session') return
    setPin('')
    if (got.mode === 'wrong') {
      setPinError('That email and PIN don’t match. Try again, or tap “Forgot PIN?” for an emailed code.')
      pinRef.current?.focus()
      return
    }
    if (got.mode === 'slow') {
      setPinError('Too many tries from here. Wait 15 minutes, or tap “Forgot PIN?” for an emailed code.')
      return
    }
    // Locked (5 wrong in a row) or the PIN service is down: fall back to the code.
    if (got.mode === 'locked') markPinReset(nextEmail)
    try {
      await sendOtp(nextEmail)
      setCode('')
      setHaveCode(false)
    } catch {
      /* authError is set on the store */
    }
    setPinError(
      got.mode === 'locked'
        ? 'Too many wrong PINs, so PIN sign-in is paused. We emailed you a code — after you sign in, pick a new PIN.'
        : 'PIN sign-in isn’t available right now, so we emailed you a code.',
    )
  }

  async function forgotPin(e) {
    const form = e.currentTarget?.form
    const live = readAuthForm({ currentTarget: form }, { email: address })
    if (!live.email) {
      setPinError('Type your email first, then tap “Forgot PIN?”.')
      emailRef.current?.focus()
      return
    }
    setPinError('')
    markPinReset(live.email)
    await onSend(e, live.email)
  }

  function useDifferentEmail() {
    setPinError('')
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
            We emailed <strong>{state.pendingEmail}</strong>. Type the code from the email, or open the link.
            The link works even if Mail opens a different browser.
          </p>
        ) : configured && !signedInNoHouse && haveCode ? (
          <p className="lede">Type the code from the email, and the address it was sent to.</p>
        ) : configured && !signedInNoHouse && pinEnabled ? (
          <p className="lede">
            Sign in with your email and your 4-digit PIN. No PIN yet? Leave it blank and we’ll email you a code.
          </p>
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
          <form onSubmit={onAuthSubmit} noValidate onInput={syncFromForm}>
            <div className="field">
              <label htmlFor="host-email">Email</label>
              <input
                id="host-email"
                {...emailInputProps}
                ref={emailRef}
                defaultValue={email}
                onBlur={(e) => setEmail(e.target.value.trim())}
                placeholder="name@email.com"
              />
            </div>
            {pinEnabled && (
              <div className="field">
                <label htmlFor="pin">PIN</label>
                <input
                  id="pin"
                  name="pin"
                  className="pin-input"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  placeholder="••••"
                  aria-describedby="pin-help"
                  {...pinInputProps}
                  ref={pinRef}
                  defaultValue=""
                />
                <span id="pin-help" className="pin-help">4 numbers. Leave blank to get an emailed code.</span>
              </div>
            )}
            {(pinError || state.authError) && (
              <p className="form-error" role="alert">
                {pinError || state.authError}
              </p>
            )}
            <button className="btn primary full" type="submit" disabled={state.authBusy}>
              {state.authBusy
                ? 'Please wait…'
                : pinEnabled
                  ? normalizePin(pin).length === 4 ? 'Sign in' : 'Email me a code'
                  : 'Continue'}
            </button>
            {pinEnabled ? (
              <div className="gate-links">
                <button className="btn ghost" type="button" disabled={state.authBusy} onClick={forgotPin}>
                  Forgot PIN?
                </button>
                <button className="btn ghost" type="button" onClick={() => setHaveCode(true)}>
                  I have a code
                </button>
              </div>
            ) : (
              <button className="btn ghost full" type="button" onClick={() => setHaveCode(true)}>
                I have a code
              </button>
            )}
            <p className="gate-note">
              {pinEnabled
                ? 'First time? Leave the PIN blank. We’ll email a code, then you can pick a PIN so next time is just email + PIN. On a home-screen app, type the code so you stay in Mi Casa.'
                : 'No password. A returning email opens the house on this phone. A new email gets a sign-in code and a link — either one works in any browser. On a home-screen app, type the code so you stay in Mi Casa.'}
            </p>
          </form>
        )}

        {configured && !signedInNoHouse && showCode && (
          <form onSubmit={onAuthSubmit} noValidate onInput={syncFromForm}>
            {pinError && (
              <p className="gate-hint" role="status">
                {pinError}
              </p>
            )}
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
                  {...emailInputProps}
                  ref={emailRef}
                  defaultValue={email}
                  onBlur={(e) => setEmail(e.target.value.trim())}
                  placeholder="name@email.com"
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="otp">Code from the email</label>
              <input
                id="otp"
                className="otp"
                {...codeInputProps}
                ref={codeRef}
                defaultValue=""
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
