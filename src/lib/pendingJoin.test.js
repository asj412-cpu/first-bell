import assert from 'node:assert/strict'
import test from 'node:test'
import { clearJoin, pendingJoin, rememberJoin } from './pendingJoin.js'

function mem() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

test('remembers a family link token and returns it', () => {
  const s = mem()
  rememberJoin('ae99a2993b96495884001d2b254f050757d2', s, 1000)
  assert.equal(pendingJoin(s, 2000), 'ae99a2993b96495884001d2b254f050757d2')
})

test('forgets after 14 days, on clear, and ignores junk', () => {
  const s = mem()
  rememberJoin('ae99a2993b96495884001d2b254f050757d2', s, 0)
  assert.equal(pendingJoin(s, 15 * 24 * 3600 * 1000), null)
  rememberJoin('ae99a2993b96495884001d2b254f050757d2', s, 0)
  clearJoin(s)
  assert.equal(pendingJoin(s, 1), null)
  rememberJoin('../evil?x=1', s, 0)
  assert.equal(pendingJoin(s, 1), null)
  s.setItem('micasa-pending-join', '{bad json')
  assert.equal(pendingJoin(s, 1), null)
})
