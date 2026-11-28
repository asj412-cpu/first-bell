import { useEffect, useRef, useState } from 'react'
import {
  clearPinReset,
  isWeakPin,
  normalizePin,
  pinEnabled,
  pinPromptSkipped,
  pinResetPending,
  pinSet,
  pinStatus,
  rememberPinEmail,
  skipPinPrompt,
} from '../lib/pin.js'
import { supabase } from '../lib/supabase.js'
import { useBell } from '../lib/store.jsx'

export const pinInputProps = {
  type: 'password',
  inputMode: 'numeric',
  pattern: '[0-9]*',
  maxLength: 4,
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: 'false',
}

async function accessToken() {
  if (!supabase) return ''
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

function readPin(form, name) {
  const el = form?.elements?.namedItem(name)
  return normalizePin(el && typeof el.value === 'string' ? el.value : '')
}

/** New PIN + confirm (+ current PIN when the server asks for it). */
export function PinForm({ needsCurrent, submitLabel = 'Save PIN', onSaved, children }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formRef = useRef(null)

  async function onSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const pin = readPin(form, 'new-pin')
    const again = readPin(form, 'confirm-pin')
    const current = needsCurrent ? readPin(form, 'current-pin') : ''
    if (needsCurrent && current.length !== 4) return setError('Type your current 4-digit PIN.')
    if (pin.length !== 4) return setError('Use exactly 4 numbers.')
    if (isWeakPin(pin)) return setError('That one is too easy to guess. Try different numbers.')
    if (pin !== again) return setError('The two PINs don’t match.')
    setBusy(true)
    setError('')
    const result = await pinSet(await accessToken(), pin, current)
    setBusy(false)
    if (!result.ok) return setError(result.message)
    form.reset()
    onSaved?.()
  }

  return (
    <form ref={formRef} className="pin-form" onSubmit={onSubmit} onInput={() => error && setError('')} noValidate>
      {needsCurrent && (
        <div className="field">
          <label htmlFor="current-pin">Current PIN</label>
          <input id="current-pin" name="current-pin" className="pin-input" autoComplete="current-password" {...pinInputProps} />
        </div>
      )}
      <div className="pin-pair">
        <div className="field">
          <label htmlFor="new-pin">{needsCurrent ? 'New PIN' : '4-digit PIN'}</label>
          <input id="new-pin" name="new-pin" className="pin-input" autoComplete="new-password" {...pinInputProps} />
        </div>
        <div className="field">
          <label htmlFor="confirm-pin">Type it again</label>
          <input id="confirm-pin" name="confirm-pin" className="pin-input" autoComplete="new-password" {...pinInputProps} />
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary full" type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
      {children}
    </form>
  )
}

/**
 * After a verified sign-in: if this person has no PIN yet (or just used
 * "Forgot PIN?"), ask them to pick one so next time it's email + PIN.
 */
export function PinPrompt() {
  const { state, notify } = useBell()
  const userId = state.session?.userId
  const email = state.session?.email
  const live = state.backend === 'live'
  const [mode, setMode] = useState(null) // null | 'new' | 'reset'

  useEffect(() => {
    let cancelled = false
    setMode(null)
    if (!pinEnabled || !live || !userId) return undefined
    ;(async () => {
      const status = await pinStatus(await accessToken())
      if (cancelled || !status) return
      if (pinResetPending(email) && !status.needsCurrent) setMode('reset')
      else if (!status.hasPin && !pinPromptSkipped(userId)) setMode('new')
    })()
    return () => {
      cancelled = true
    }
  }, [live, userId, email])

  if (!mode) return null

  function notNow() {
    if (mode === 'new') skipPinPrompt(userId)
    else clearPinReset()
    setMode(null)
  }

  function saved() {
    clearPinReset()
    rememberPinEmail(email)
    setMode(null)
    notify('PIN saved. Next time, sign in with your email and PIN.')
  }

  return (
    <div className="picker-sheet pin-sheet" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <div className="picker-sheet-card pin-sheet-card">
        <div className="pin-badge" aria-hidden="true">
          🔒
        </div>
        <h2 id="pin-title">{mode === 'reset' ? 'Set a new PIN' : 'Skip the email code next time'}</h2>
        <p className="muted pin-copy">
          {mode === 'reset'
            ? 'You signed in with the emailed code. Pick a new 4-digit PIN.'
            : 'Pick a 4-digit PIN. Next time, sign in with your email and this PIN — no code to dig out of your email.'}
        </p>
        <PinForm needsCurrent={false} onSaved={saved}>
          <button className="btn ghost full" type="button" onClick={notNow}>
            Not now
          </button>
        </PinForm>
        <p className="gate-note">Forgot it later? Tap “Forgot PIN?” on the sign-in screen and we’ll email you a code.</p>
      </div>
    </div>
  )
}

/** Settings card: set or change the sign-in PIN. */
export function PinSettings() {
  const { state, notify } = useBell()
  const live = state.backend === 'live'
  const userId = state.session?.userId
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)

  async function refresh() {
    setStatus(await pinStatus(await accessToken()))
  }

  useEffect(() => {
    if (pinEnabled && live && userId) refresh()
  }, [live, userId])

  if (!pinEnabled || !live || !userId) return null

  const hasPin = Boolean(status?.hasPin)
  return (
    <>
      <div className="section-head">
        <h2>Sign-in PIN</h2>
      </div>
      <div className="card pad pin-settings">
        <p className="muted" style={{ marginTop: 0 }}>
          {status == null
            ? 'Checking…'
            : status.locked
              ? 'PIN sign-in is paused after too many wrong tries. Sign out and sign in with the emailed code to turn it back on.'
              : hasPin
                ? 'On. Sign in with your email and your 4-digit PIN. Forgot it? Tap “Forgot PIN?” on the sign-in screen.'
                : 'Off. Set a 4-digit PIN so you can sign in with your email and PIN instead of an emailed code.'}
        </p>
        {status && !status.locked && !open && (
          <button className="btn full" type="button" onClick={() => setOpen(true)}>
            {hasPin ? 'Change PIN' : 'Set a PIN'}
          </button>
        )}
        {status && open && (
          <PinForm
            needsCurrent={status.needsCurrent}
            submitLabel={hasPin ? 'Change PIN' : 'Save PIN'}
            onSaved={() => {
              setOpen(false)
              clearPinReset()
              rememberPinEmail(state.session?.email)
              notify(hasPin ? 'PIN changed.' : 'PIN saved. Next time, sign in with your email and PIN.')
              refresh()
            }}
          >
            <button className="btn ghost full" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </PinForm>
        )}
      </div>
    </>
  )
}
