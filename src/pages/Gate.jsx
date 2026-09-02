import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (state.pendingEmail) setEmail(state.pendingEmail)
  }, [state.pendingEmail])

  if (!ready) {
    return (
      <div className="gate">
        <div className="gate-bg" aria-hidden="true" />
        <div className="card gate-card">
          <img className="bell" src="/brand/bell.jpg" alt="" />
          <div className="eyebrow">First Bell</div>
          <h1>Opening the house…</h1>
          <p className="lede">Checking your session.</p>
        </div>
      </div>
    )
  }

  if (entered) return <Navigate to="/" replace />

  const signedInNoHouse = Boolean(state.session && configured && !state.householdId)

  async function onSend(e) {
    e.preventDefault()
    if (!email.trim()) return
    try {
      await sendOtp(email)
    } catch {
      /* authError is set on the store */
    }
  }

  async function onVerify(e) {
    e.preventDefault()
    if (!code.trim()) return
    try {
      await verifyOtp(code)
    } catch {
      /* authError is set on the store */
    }
  }

  return (
    <div className="gate">
      <div className="gate-bg" aria-hidden="true" />
      <div className="card gate-card">
        <img className="bell" src="/brand/bell.jpg" alt="" />
        <div className="eyebrow">First Bell</div>
        <h1>The house, handled.</h1>
        <p className="lede">
          Parties, inbox, calendar. Party planning is the wedge — the product is household ops for
          parents.
        </p>

        <BackendBanner />

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

        {configured && !signedInNoHouse && state.authStep === 'email' && (
          <form onSubmit={onSend}>
            <div className="field">
              <label htmlFor="host-email">Host email</label>
              <input
                id="host-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="asj412@me.com"
                required
              />
            </div>
            {state.authError && <p className="form-error">{state.authError}</p>}
            <button className="btn primary full" type="submit" disabled={state.authBusy}>
              {state.authBusy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
            <p className="gate-note">
              Magic link + 6-digit code via Supabase Auth. No password. Guest RSVPs never need this.
            </p>
          </form>
        )}

        {configured && !signedInNoHouse && state.authStep === 'code' && (
          <form onSubmit={onVerify}>
            <p className="lede" style={{ marginBottom: 16 }}>
              We sent a code to <strong>{state.pendingEmail}</strong>. Use the 6-digit code, or tap
              the magic link in the same email.
            </p>
            <div className="field">
              <label htmlFor="otp">One-time code</label>
              <input
                id="otp"
                className="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
                placeholder="123456"
                required
              />
            </div>
            {state.authError && <p className="form-error">{state.authError}</p>}
            <button className="btn primary full" type="submit" disabled={state.authBusy || code.length < 6}>
              {state.authBusy ? 'Checking…' : 'Enter the house'}
            </button>
            <button
              className="btn ghost full"
              type="button"
              style={{ marginTop: 10 }}
              onClick={resetAuthForm}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
