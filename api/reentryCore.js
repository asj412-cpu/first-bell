const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WINDOW_MS = 15 * 60 * 1000
const EMAIL_LIMIT = 5
const IP_LIMIT = 20

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return ''
  return email
}

export function missingServerEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim()
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const missing = []
  if (!url) missing.push('SUPABASE_URL')
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  return { url, serviceKey, missing }
}

export function clientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'] || req?.headers?.['X-Forwarded-For']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const ip = String(raw || req?.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  return ip.slice(0, 64) || 'unknown'
}

export function createMemoryLimiter({ now = Date.now, windowMs = WINDOW_MS, emailLimit = EMAIL_LIMIT, ipLimit = IP_LIMIT } = {}) {
  const buckets = new Map()

  function hit(key, limit) {
    const stamp = now()
    const prev = (buckets.get(key) || []).filter((time) => stamp - time < windowMs)
    prev.push(stamp)
    buckets.set(key, prev)
    return prev.length > limit
  }

  return {
    limited(email, ip) {
      const emailBlocked = hit(`email:${email}`, emailLimit)
      const ipBlocked = hit(`ip:${ip}`, ipLimit)
      return emailBlocked || ipBlocked
    },
  }
}

export function verificationType(properties) {
  const hinted = properties?.verification_type
  if (hinted === 'magiclink' || hinted === 'email') return hinted
  return ''
}

export function readBody(req) {
  if (req?.body && typeof req.body === 'object') return req.body
  if (typeof req?.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return {}
}

// ---- Remembered devices and the REENTRY_MODE switch (GJP-3) ----

export const DEVICE_COOKIE = 'micasa_device'
export const DEVICE_MAX_AGE = 180 * 24 * 60 * 60

/** device (default): email-only on a remembered device. email: any device. off: always send the code. */
export function reentryMode(env = process.env) {
  const value = String(env.REENTRY_MODE || '').trim().toLowerCase()
  return value === 'email' || value === 'off' ? value : 'device'
}

export function parseCookies(header) {
  const out = {}
  String(header || '')
    .split(';')
    .forEach((part) => {
      const at = part.indexOf('=')
      if (at < 1) return
      const key = part.slice(0, at).trim()
      const value = part.slice(at + 1).trim()
      if (key && !(key in out)) {
        try {
          out[key] = decodeURIComponent(value)
        } catch {
          out[key] = value
        }
      }
    })
  return out
}

/** The device token from the request cookie, if it looks like one we made. */
export function deviceTokenFrom(req) {
  const token = parseCookies(req?.headers?.cookie)[DEVICE_COOKIE] || ''
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''
}

export function hashDeviceToken(token, createHash) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function deviceCookie(token, maxAge = DEVICE_MAX_AGE) {
  return `${DEVICE_COOKIE}=${token}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
}

export function clearDeviceCookie() {
  return `${DEVICE_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

export function bearerToken(req) {
  const raw = String(req?.headers?.authorization || req?.headers?.Authorization || '')
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}
