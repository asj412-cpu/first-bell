import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  bearerToken,
  clearDeviceCookie,
  deviceCookie,
  deviceTokenFrom,
  hashDeviceToken,
  missingServerEnv,
  normalizeEmail,
} from './reentryCore.js'

// POST: right after a successful code or link sign-in, remember this device.
//   The browser sends its fresh access token. The server checks it with Supabase,
//   makes a random device token, stores only its SHA-256 hash, and sets an
//   httpOnly cookie the page's JavaScript cannot read.
// DELETE: sign out on this device. The token stops working and the cookie is cleared.

export function createHandler({ env = process.env, makeClient = createClient, random = randomBytes } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      res.setHeader('Allow', 'POST, DELETE')
      res.status(405).json({ error: 'Use POST or DELETE.' })
      return
    }

    const { url, serviceKey, missing } = missingServerEnv(env)
    if (missing.length) {
      if (req.method === 'DELETE') res.setHeader('Set-Cookie', clearDeviceCookie())
      res.status(503).json({ error: 'missing_env', missing })
      return
    }
    const admin = makeClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    if (req.method === 'DELETE') {
      const token = deviceTokenFrom(req)
      if (token) {
        await Promise.resolve(
          admin.rpc('reentry_device_forget', { p_token_hash: hashDeviceToken(token, createHash) }),
        ).catch(() => {})
      }
      res.setHeader('Set-Cookie', clearDeviceCookie())
      res.status(200).json({ ok: true })
      return
    }

    const jwt = bearerToken(req)
    if (!jwt) {
      res.status(401).json({ error: 'Sign in first.' })
      return
    }
    let user = null
    try {
      const got = await admin.auth.getUser(jwt)
      user = got.error ? null : got.data?.user
    } catch {
      user = null
    }
    const email = normalizeEmail(user?.email)
    if (!user?.id || !email || !user.email_confirmed_at) {
      res.status(401).json({ error: 'Sign in first.' })
      return
    }

    const token = random(32).toString('base64url')
    const result = await Promise.resolve(
      admin.rpc('reentry_device_register', {
        p_user: user.id,
        p_email: email,
        p_token_hash: hashDeviceToken(token, createHash),
        p_user_agent: String(req.headers?.['user-agent'] || '').slice(0, 300),
      }),
    ).catch((error) => ({ error }))
    if (result?.error) {
      res.status(500).json({ error: 'Could not remember this device.' })
      return
    }

    res.setHeader('Set-Cookie', deviceCookie(token))
    res.status(200).json({ ok: true })
  }
}

export default createHandler()
