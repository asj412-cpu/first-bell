import { createClient } from '@supabase/supabase-js'
import {
  clientIp,
  createMemoryLimiter,
  missingServerEnv,
  normalizeEmail,
  readBody,
  verificationType,
} from './reentryCore.js'

const memory = createMemoryLimiter()

async function userIsConfirmed(admin, email) {
  for (let page = 1; page <= 5; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (listed.error) return false
    const users = listed.data?.users || []
    const match = users.find((user) => String(user.email || '').toLowerCase() === email)
    if (match) return Boolean(match.email_confirmed_at) && !match.banned_until
    if (users.length < 200) return false
  }
  return false
}

async function verifiedEmail(admin, email) {
  const gate = await admin.rpc('reentry_gate', { p_email: email, p_ip: 'server-check' })
  if (!gate.error && gate.data && typeof gate.data.verified === 'boolean') {
    return { verified: gate.data.verified, allowed: gate.data.allowed !== false, fromGate: true }
  }
  const row = await admin.from('verified_emails').select('verified_at').eq('email', email).maybeSingle()
  if (!row.error && row.data?.verified_at) return { verified: true, allowed: true, fromGate: false }
  const confirmed = await userIsConfirmed(admin, email)
  return { verified: confirmed, allowed: true, fromGate: false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const { url, serviceKey, missing } = missingServerEnv()
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
  if (memory.limited(email, ip)) {
    res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' })
    return
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  let check
  try {
    check = await verifiedEmail(admin, email)
  } catch {
    res.status(200).json({ mode: 'otp' })
    return
  }

  if (!check.allowed) {
    res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' })
    return
  }
  if (!check.verified) {
    res.status(200).json({ mode: 'otp' })
    return
  }

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link.data?.properties?.hashed_token
  const type = verificationType(link.data?.properties)
  if (link.error || !tokenHash || !type) {
    res.status(200).json({ mode: 'otp' })
    return
  }

  const verified = await admin.auth.verifyOtp({ token_hash: tokenHash, type })
  const session = verified.data?.session
  if (verified.error || !session?.access_token || !session?.refresh_token) {
    res.status(200).json({ mode: 'otp' })
    return
  }

  res.status(200).json({
    mode: 'session',
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
}
