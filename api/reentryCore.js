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
