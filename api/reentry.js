import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  clientIp,
  createMemoryLimiter,
  deviceCookie,
  deviceTokenFrom,
  hashDeviceToken,
  missingServerEnv,
  normalizeEmail,
  readBody,
  reentryMode,
  verificationType,
} from './reentryCore.js'

// Email-only sign-in for people who have signed in before (see docs/EMAIL-REENTRY.md).
// Runs only on the server. The service role key comes from the server-only
// SUPABASE_SERVICE_ROLE_KEY env var and never reaches the browser.
//
// Every "no" looks the same: { mode: 'otp' }, and the screen sends the normal code.
// Unknown emails, never-verified emails, and devices that are not remembered all
// get that answer, so the screen does not show who is on the list.

const memory = createMemoryLimiter()
const TOO_MANY = 'Too many tries. Wait a few minutes and try again.'

export async function mintSession(admin, email) {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link.data?.properties?.hashed_token
  const type = verificationType(link.data?.properties)
  if (link.error || !tokenHash || !type) return null
  const verified = await admin.auth.verifyOtp({ token_hash: tokenHash, type })
  const session = verified.data?.session
  if (verified.error || !session?.access_token || !session?.refresh_token) return null
  return { access_token: session.access_token, refresh_token: session.refresh_token }
}

export function createHandler({ env = process.env, makeClient = createClient, limiter = memory } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      res.status(405).json({ error: 'Use POST.' })
      return
    }

    const mode = reentryMode(env)
    if (mode === 'off') {
      res.status(200).json({ mode: 'otp' })
      return
    }

    const { url, serviceKey, missing } = missingServerEnv(env)
    if (missing.length) {
      res.status(503).json({
        error: 'missing_env',
        missing,
        message: `Set ${missing.join(' and ')} in Vercel project environment variables for Production and Preview. Do not prefix the service role key with VITE_.`,
      })
      return
    }

    const email = normalizeEmail(readBody(req).email)
    if (!email) {
      res.status(400).json({ error: 'Enter an email address.' })
      return
    }

    const ip = clientIp(req)
    if (limiter.limited(email, ip)) {
      res.status(429).json({ error: TOO_MANY })
      return
    }

    const device = mode === 'device' ? deviceTokenFrom(req) : ''
    const deviceHash = device ? hashDeviceToken(device, createHash) : null

    const admin = makeClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    // Rate limit (per email and per IP, shared across instances) and the
    // verified / remembered-device check, in one database call.
    let check
    try {
      const result = await admin.rpc('reentry_check', {
        p_email: email,
        p_ip: ip,
        p_device_hash: deviceHash,
        p_mode: mode,
      })
      if (result.error) throw result.error
      check = result.data || {}
    } catch {
      // Fail closed: send the normal code.
      res.status(200).json({ mode: 'otp' })
      return
    }

    if (check.allowed === false) {
      res.status(429).json({ error: TOO_MANY })
      return
    }
    if (check.ok !== true) {
      res.status(200).json({ mode: 'otp' })
      return
    }

    let session = null
    try {
      session = await mintSession(admin, email)
    } catch {
      session = null
    }
    if (!session) {
      res.status(200).json({ mode: 'otp' })
      return
    }

    // Slide the remembered device forward another 180 days.
    if (device) res.setHeader('Set-Cookie', deviceCookie(device))
    res.status(200).json({ mode: 'session', ...session })
  }
}

export default createHandler()
