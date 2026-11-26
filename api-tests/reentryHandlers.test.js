import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createHandler as createReentry } from '../api/reentry.js'
import { createHandler as createRemember } from '../api/remember-device.js'
import { createMemoryLimiter, deviceCookie, hashDeviceToken, parseCookies, reentryMode } from '../api/reentryCore.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }
const TOKEN = 'A'.repeat(43)

function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

// A stand-in database: verified emails, remembered device hashes, simple limits.
function fakeAdmin({ verified = ['mom@example.com'], devices = {}, users = {} } = {}) {
  const calls = []
  const tries = {}
  return {
    calls,
    rpc(name, args) {
      calls.push([name, args])
      if (name === 'reentry_check') {
        tries[args.p_email] = (tries[args.p_email] || 0) + 1
        if (tries[args.p_email] > 5) return Promise.resolve({ data: { allowed: false, ok: false } })
        const known = verified.includes(args.p_email)
        const ok = known && (args.p_mode === 'email' || (args.p_mode === 'device' && devices[args.p_device_hash] === args.p_email))
        return Promise.resolve({ data: { allowed: true, ok } })
      }
      if (name === 'reentry_device_register') { devices[args.p_token_hash] = args.p_email; return Promise.resolve({ data: { ok: true } }) }
      if (name === 'reentry_device_forget') { delete devices[args.p_token_hash]; return Promise.resolve({ data: { ok: true } }) }
      return Promise.resolve({ error: { message: 'unknown' } })
    },
    auth: {
      admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'h', verification_type: 'magiclink' } } }) },
      verifyOtp: async () => ({ data: { session: { access_token: 'at', refresh_token: 'rt' } } }),
      getUser: async (jwt) => (users[jwt] ? { data: { user: users[jwt] } } : { error: { message: 'bad jwt' } }),
    },
  }
}

const post = (email, cookie, ip = '1.2.3.4') => ({ method: 'POST', body: { email }, headers: { cookie: cookie || '', 'x-forwarded-for': ip } })

test('REENTRY_MODE defaults to device and accepts email/off', () => {
  assert.equal(reentryMode({}), 'device')
  assert.equal(reentryMode({ REENTRY_MODE: 'EMAIL' }), 'email')
  assert.equal(reentryMode({ REENTRY_MODE: 'off' }), 'off')
  assert.equal(reentryMode({ REENTRY_MODE: 'yes' }), 'device')
})

test('device cookie is httpOnly, Secure, SameSite=Strict and scoped to /api', () => {
  const c = deviceCookie(TOKEN)
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api', 'Max-Age=15552000']) assert.ok(c.includes(part), part)
  assert.equal(parseCookies(`a=1; micasa_device=${TOKEN}`).micasa_device, TOKEN)
})

test('missing service role key: 503 naming only the variable, never a value', async () => {
  const res = fakeRes()
  await createReentry({ env: { VITE_SUPABASE_URL: 'https://x.supabase.co' }, makeClient: () => fakeAdmin(), limiter: createMemoryLimiter() })(post('mom@example.com'), res)
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body.missing, ['SUPABASE_SERVICE_ROLE_KEY'])
})

test('email mode: verified email gets a session; unknown gets the same otp answer as unverified', async () => {
  const admin = fakeAdmin()
  const h = createReentry({ env: { ...ENV, REENTRY_MODE: 'email' }, makeClient: () => admin, limiter: createMemoryLimiter() })
  let res = fakeRes(); await h(post('mom@example.com'), res)
  assert.deepEqual(res.body, { mode: 'session', access_token: 'at', refresh_token: 'rt' })
  res = fakeRes(); await h(post('stranger@example.com'), res)
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { mode: 'otp' })
  assert.equal(admin.calls[0][1].p_ip, '1.2.3.4', 'real client IP is passed for the IP limit')
})

test('device mode: email alone on a new device falls back to the code; remembered device gets in', async () => {
  const hash = hashDeviceToken(TOKEN, createHash)
  const admin = fakeAdmin({ devices: { [hash]: 'mom@example.com' } })
  const h = createReentry({ env: ENV, makeClient: () => admin, limiter: createMemoryLimiter() })
  let res = fakeRes(); await h(post('mom@example.com'), res)
  assert.deepEqual(res.body, { mode: 'otp' })
  res = fakeRes(); await h(post('mom@example.com', `micasa_device=${TOKEN}`), res)
  assert.equal(res.body.mode, 'session')
  assert.ok(String(res.headers['set-cookie']).includes('HttpOnly'))
  res = fakeRes(); await h(post('dad@example.com', `micasa_device=${TOKEN}`), res)
  assert.deepEqual(res.body, { mode: 'otp' }, 'a remembered device does not open other emails')
})

test('off mode never mints a session', async () => {
  const admin = fakeAdmin()
  const res = fakeRes()
  await createReentry({ env: { ...ENV, REENTRY_MODE: 'off' }, makeClient: () => admin, limiter: createMemoryLimiter() })(post('mom@example.com'), res)
  assert.deepEqual(res.body, { mode: 'otp' }); assert.equal(admin.calls.length, 0)
})

test('database limit gives 429 for known and unknown emails alike; db error fails closed to otp', async () => {
  const admin = fakeAdmin()
  const h = createReentry({ env: { ...ENV, REENTRY_MODE: 'email' }, makeClient: () => admin, limiter: createMemoryLimiter({ emailLimit: 100, ipLimit: 100 }) })
  for (const email of ['mom@example.com', 'nobody@example.com']) {
    let res
    for (let i = 0; i < 6; i += 1) { res = fakeRes(); await h(post(email), res) }
    assert.equal(res.statusCode, 429)
  }
  const broken = { rpc: async () => ({ error: { message: 'down' } }), auth: {} }
  const res = fakeRes()
  await createReentry({ env: { ...ENV, REENTRY_MODE: 'email' }, makeClient: () => broken, limiter: createMemoryLimiter() })(post('mom@example.com'), res)
  assert.deepEqual(res.body, { mode: 'otp' })
})

test('remember-device: needs a real signed-in token, stores only a hash, sets the cookie; DELETE forgets', async () => {
  const devices = {}
  const admin = fakeAdmin({ devices, users: { good: { id: 'u1', email: 'Mom@Example.com', email_confirmed_at: '2026-11-01' } } })
  const h = createRemember({ env: ENV, makeClient: () => admin, random: () => Buffer.alloc(32, 7) })
  let res = fakeRes(); await h({ method: 'POST', headers: { authorization: 'Bearer forged' } }, res)
  assert.equal(res.statusCode, 401)
  res = fakeRes(); await h({ method: 'POST', headers: { authorization: 'Bearer good' } }, res)
  assert.equal(res.statusCode, 200)
  const token = Buffer.alloc(32, 7).toString('base64url')
  assert.ok(res.headers['set-cookie'].startsWith(`micasa_device=${token};`))
  const stored = Object.keys(devices)
  assert.deepEqual(stored, [hashDeviceToken(token, createHash)])
  assert.ok(!stored.includes(token))
  assert.equal(devices[stored[0]], 'mom@example.com')
  res = fakeRes(); await h({ method: 'DELETE', headers: { cookie: `micasa_device=${token}` } }, res)
  assert.ok(res.headers['set-cookie'].includes('Max-Age=0'))
  assert.deepEqual(Object.keys(devices), [])
})
