import { rememberDevice } from './reentry.js'
const OTP_TYPES = new Set(['email', 'signup', 'magiclink', 'invite', 'recovery', 'email_change'])

let confirmation = null
let held = null
const verifications = new Map()

export function resetEmailLinkForTests() {
  confirmation = null
  held = null
  verifications.clear()
}

// Email security scanners open links (and run their JavaScript) before the
// person does. Verifying on page load let a scanner use up the one-time token,
// which also kills the 6-digit code in the same email. So an email link is only
// held when the page opens, and verified when the person taps "Finish signing in".
export function holdEmailLink(href) {
  const link = readEmailLink(href)
  if (link.tokenHash) held = { href, link }
  return held
}

export function heldEmailLink() {
  return held
}

export function releaseHeldEmailLink(client) {
  if (!held) return null
  const started = startEmailLinkConfirmation(held.href, client)
  held = null
  return started
}

export function isPlausibleTokenHash(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~+/-]+=*$/.test(value) && value.length >= 16 && value.length <= 512
}

export function safeNextPath(value, depth = 0) {
  if (depth > 2) return '/'
  const raw = String(value || '').trim()
  if (!raw) return '/'
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return '/'
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.startsWith('/\\')) return '/'
  if (decoded.includes('\\') || decoded.includes('://') || decoded.includes('\0')) return '/'
  let url
  try {
    url = new URL(decoded, 'https://micasa.local')
  } catch {
    return '/'
  }
  if (url.origin !== 'https://micasa.local') return '/'
  if (url.pathname === '/auth/confirm') return safeNextPath(url.searchParams.get('next') || '/', depth + 1)
  for (const key of ['token_hash', 'type', 'code', 'error', 'error_code', 'error_description']) {
    url.searchParams.delete(key)
  }
  return `${url.pathname}${url.search}${url.hash}` || '/'
}

function pathFromRedirect(next) {
  const value = String(next || '').trim()
  if (!value) return '/'
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      return `${url.pathname}${url.search}${url.hash}`
    } catch {
      return '/'
    }
  }
  return value
}

/** App route passed to signInWithOtp. Always contains `?` so the email template can append `&token_hash=`. */
export function authConfirmUrl(origin, next) {
  const base = String(origin || '').replace(/\/$/, '')
  const path = safeNextPath(pathFromRedirect(next))
  return `${base}/auth/confirm?next=${encodeURIComponent(path)}`
}

export function readEmailLink(href) {
  const current = new URL(href, 'http://localhost')
  const hash = new URLSearchParams(current.hash.startsWith('#') ? current.hash.slice(1) : '')
  const tokenHash = current.searchParams.get('token_hash') || ''
  const rawType = current.searchParams.get('type') || hash.get('type') || ''
  const type = OTP_TYPES.has(rawType) ? rawType : ''
  return {
    tokenHash: isPlausibleTokenHash(tokenHash) ? tokenHash : '',
    type: type || (isPlausibleTokenHash(tokenHash) ? 'email' : ''),
    next: safeNextPath(current.searchParams.get('next') || '/'),
    hasCode: current.searchParams.has('code'),
    errorDescription: current.searchParams.get('error_description') || hash.get('error_description') || '',
    errorCode: current.searchParams.get('error_code') || hash.get('error_code') || '',
  }
}

export function isPkceBrowserError(message) {
  return /code verifier|code_verifier|both auth code and code verifier|pkce/i.test(message || '')
}

export function friendlyLinkError(message) {
  if (/only request this after|for security purposes|too many requests|rate limit/i.test(message || '')) {
    return 'Wait a minute, then ask for another email.'
  }
  return 'That sign-in link didn’t work. It may have expired, or it was already used. Send a new link, or type the 6-digit code from the email.'
}

export function friendlyAuthError(message) {
  if (!message) return null
  if (/only request this after|for security purposes|too many requests|rate limit/i.test(message)) {
    return 'Wait a minute, then ask for another email.'
  }
  if (isPkceBrowserError(message)) return friendlyLinkError(message)
  if (/redirect/i.test(message) && /allow|valid/i.test(message)) {
    return 'Sign-in from this address isn’t allowed yet. Open the house from https://first-bell-seven.vercel.app, or add this site to the redirect allow list.'
  }
  if (/token has expired|otp.?expired|email link is invalid|is invalid or has expired/i.test(message)) {
    return 'That code didn’t work. Check the latest email, or send a new link.'
  }
  return message
}

/** What a fresh browser should do with this URL. Token-hash links never read a stored code verifier. */
export function emailLinkAction(href) {
  const link = readEmailLink(href)
  if (link.tokenHash) {
    return {
      action: 'verifyOtp',
      params: { token_hash: link.tokenHash, type: link.type || 'email' },
    }
  }
  if (link.hasCode || link.errorDescription || link.errorCode) {
    return { action: 'recover', notice: friendlyLinkError(link.errorDescription) }
  }
  return { action: 'none' }
}

export function stripAuthCallbackParams(href) {
  const current = new URL(href, 'http://localhost')
  for (const key of ['code', 'error', 'error_code', 'error_description']) {
    current.searchParams.delete(key)
  }
  if (current.hash && /(error|access_token|refresh_token|type)=/.test(current.hash)) {
    current.hash = ''
  }
  return `${current.pathname}${current.search}${current.hash}`
}

export function hasPendingEmailLink() {
  return Boolean(confirmation && !confirmation.settled)
}

export function startEmailLinkConfirmation(href, client) {
  const parsed = readEmailLink(href)
  if (parsed.tokenHash) {
    if (!confirmation || confirmation.link.tokenHash !== parsed.tokenHash) {
      confirmation = {
        link: parsed,
        settled: false,
        promise: verifyEmailLink(client, parsed.tokenHash, parsed.type || 'email'),
      }
    }
    return confirmation
  }
  return confirmation
}

export function verifyEmailLink(client, tokenHash, type) {
  const otpType = OTP_TYPES.has(type) ? type : 'email'
  if (!isPlausibleTokenHash(tokenHash)) {
    return Promise.resolve({
      data: { user: null, session: null },
      error: { message: 'Email link is invalid or has expired' },
    })
  }
  const key = `${otpType}:${tokenHash}`
  if (!verifications.has(key)) {
    const promise = Promise.resolve()
      .then(() => client.auth.verifyOtp({ token_hash: tokenHash, type: otpType }))
      .then(async (result) => {
        if (!result?.error && client.rpc) {
          await client.rpc('mark_email_verified').then(() => {}, () => {})
          await rememberDevice(result?.data?.session?.access_token)
        }
        return result
      })
      .catch((error) => ({ data: { user: null, session: null }, error }))
    verifications.set(key, promise)
  }
  return verifications.get(key)
}
