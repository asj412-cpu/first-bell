// Email + 4-digit PIN sign-in. All checks run in the Supabase Edge Function
// `pin-auth` (server side, bcrypt + lockout in Postgres). This file only calls it.
// VITE_PIN_SIGNIN=off hides the PIN parts and brings back code-only sign-in.

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
const base = String(env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const anon = String(env.VITE_SUPABASE_ANON_KEY || '').trim()

export const pinEnabled = Boolean(base && anon) && String(env.VITE_PIN_SIGNIN || 'on').toLowerCase() !== 'off'

export function normalizePin(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 4)
}

export function isWeakPin(pin) {
  return /^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '4321'
}

async function call(action, body = {}, accessToken) {
  const headers = { 'Content-Type': 'application/json', apikey: anon }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  try {
    const response = await fetch(`${base}/functions/v1/pin-auth`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...body }),
    })
    const data = await response.json().catch(() => ({}))
    return { status: response.status, data }
  } catch {
    return { status: 0, data: { error: 'network' } }
  }
}

/** -> { mode: 'session', access_token, refresh_token } | { mode: 'wrong'|'locked'|'slow'|'error' } */
export async function pinLogin(email, pin) {
  const { status, data } = await call('login', { email, pin })
  if (status === 200 && data.access_token && data.refresh_token) {
    return { mode: 'session', access_token: data.access_token, refresh_token: data.refresh_token }
  }
  if (status === 423) return { mode: 'locked' }
  if (status === 429) return { mode: 'slow' }
  if (status === 401) return { mode: 'wrong' }
  return { mode: 'error' }
}

/** -> { hasPin, locked, needsCurrent } or null if the server could not be reached. */
export async function pinStatus(accessToken) {
  if (!accessToken) return null
  const { status, data } = await call('status', {}, accessToken)
  if (status !== 200) return null
  return { hasPin: !!data.has_pin, locked: !!data.locked, needsCurrent: !!data.needs_current }
}

export const SET_ERRORS = {
  format: 'Use exactly 4 numbers.',
  weak: 'That one is too easy to guess. Try different numbers.',
  current: 'Your current PIN didn’t match.',
  locked: 'Too many wrong PINs. Sign out, sign in with the emailed code, then set a new PIN.',
  signin: 'Sign in again, then set your PIN.',
}

/** -> { ok: true } | { ok: false, message } */
export async function pinSet(accessToken, pin, current) {
  const { status, data } = await call('set', { pin, current: current || null }, accessToken)
  if (status === 200 && data.ok) return { ok: true }
  return { ok: false, message: SET_ERRORS[data.error] || 'Could not save your PIN. Try again in a minute.' }
}

// After "Forgot PIN?" we remember the email so the next code sign-in goes
// straight to "Set a new PIN". Not a secret.
const RESET_KEY = 'micasa-pin-reset'
const SKIP_KEY = 'micasa-pin-skip'
const HINT_KEY = 'micasa-pin-email'

function store() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function markPinReset(email) {
  store()?.setItem(RESET_KEY, String(email || '').trim().toLowerCase())
}
export function pinResetPending(email) {
  const want = store()?.getItem(RESET_KEY)
  return Boolean(want) && want === String(email || '').trim().toLowerCase()
}
export function clearPinReset() {
  store()?.removeItem(RESET_KEY)
}

/** "Not now" on the set-a-PIN prompt hides it on this device for 3 days. */
export function skipPinPrompt(userId) {
  store()?.setItem(`${SKIP_KEY}:${userId}`, String(Date.now() + 3 * 24 * 60 * 60 * 1000))
}
export function pinPromptSkipped(userId) {
  const until = Number(store()?.getItem(`${SKIP_KEY}:${userId}`) || 0)
  return until > Date.now()
}

/** The last email that used a PIN on this device, to pre-fill the form. */
export function rememberPinEmail(email) {
  store()?.setItem(HINT_KEY, String(email || '').trim().toLowerCase())
}
export function pinEmailHint() {
  return store()?.getItem(HINT_KEY) || ''
}
