import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryLimiter, missingServerEnv, normalizeEmail, verificationType } from './reentryCore.js'

test('normalizeEmail accepts a plain address and rejects junk', () => {
  assert.equal(normalizeEmail('  Asj412@Me.com '), 'asj412@me.com')
  assert.equal(normalizeEmail('not-an-email'), '')
  assert.equal(normalizeEmail(''), '')
})

test('missingServerEnv names the service role key and never treats it as optional noise', () => {
  assert.deepEqual(missingServerEnv({ VITE_SUPABASE_URL: 'https://example.supabase.co' }).missing, [
    'SUPABASE_SERVICE_ROLE_KEY',
  ])
  assert.deepEqual(missingServerEnv({}).missing, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
  const ready = missingServerEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
  })
  assert.deepEqual(ready.missing, [])
  assert.equal(ready.serviceKey, 'secret')
})

test('memory limiter blocks the 6th try for one email inside the window', () => {
  let clock = 1_000
  const limiter = createMemoryLimiter({ now: () => clock })
  for (let i = 0; i < 5; i += 1) {
    assert.equal(limiter.limited('a@b.co', '1.1.1.1'), false)
  }
  assert.equal(limiter.limited('a@b.co', '8.8.8.8'), true)
  clock += 16 * 60 * 1000
  assert.equal(limiter.limited('a@b.co', '8.8.8.8'), false)
})

test('verificationType only accepts magiclink and email', () => {
  assert.equal(verificationType({ verification_type: 'magiclink' }), 'magiclink')
  assert.equal(verificationType({ verification_type: 'email' }), 'email')
  assert.equal(verificationType({ verification_type: 'signup' }), '')
  assert.equal(verificationType(null), '')
})
