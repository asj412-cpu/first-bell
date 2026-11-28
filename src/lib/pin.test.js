import assert from 'node:assert/strict'
import test from 'node:test'
import { isWeakPin, normalizePin, pinLogin, pinSet, pinStatus } from './pin.js'

function mockFetch(status, body) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { status, json: async () => body }
  }
  return calls
}

test('normalizePin keeps 4 digits only', () => {
  assert.equal(normalizePin(' 25-80 '), '2580')
  assert.equal(normalizePin('123456'), '1234')
  assert.equal(normalizePin(null), '')
})

test('isWeakPin blocks repeats and 1234/4321', () => {
  for (const pin of ['0000', '7777', '1234', '4321']) assert.equal(isWeakPin(pin), true)
  for (const pin of ['2580', '1357', '9021']) assert.equal(isWeakPin(pin), false)
})

test('pinLogin maps server answers', async () => {
  const calls = mockFetch(200, { ok: true, access_token: 'a', refresh_token: 'r' })
  assert.deepEqual(await pinLogin('x@y.com', '2580'), { mode: 'session', access_token: 'a', refresh_token: 'r' })
  assert.equal(JSON.parse(calls[0].init.body).action, 'login')
  assert.equal(calls[0].init.headers.Authorization, undefined)
  mockFetch(401, { error: 'wrong' })
  assert.deepEqual(await pinLogin('x@y.com', '2580'), { mode: 'wrong' })
  mockFetch(423, { error: 'locked' })
  assert.deepEqual(await pinLogin('x@y.com', '2580'), { mode: 'locked' })
  mockFetch(429, { error: 'slow' })
  assert.deepEqual(await pinLogin('x@y.com', '2580'), { mode: 'slow' })
  mockFetch(503, { error: 'server' })
  assert.deepEqual(await pinLogin('x@y.com', '2580'), { mode: 'error' })
  globalThis.fetch = async () => { throw new Error('offline') }
  assert.deepEqual(await pinLogin('x@y.com', '2580'), { mode: 'error' })
})

test('pinStatus and pinSet send the access token', async () => {
  let calls = mockFetch(200, { has_pin: true, locked: false, needs_current: true })
  assert.deepEqual(await pinStatus('tok'), { hasPin: true, locked: false, needsCurrent: true })
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok')
  assert.equal(await pinStatus(''), null)
  calls = mockFetch(400, { error: 'current' })
  assert.deepEqual(await pinSet('tok', '2580', '1111'), { ok: false, message: 'Your current PIN didn’t match.' })
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'set', pin: '2580', current: '1111' })
  mockFetch(200, { ok: true })
  assert.deepEqual(await pinSet('tok', '2580'), { ok: true })
})
