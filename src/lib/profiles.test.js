import assert from 'node:assert/strict'
import test from 'node:test'
import { checkManualPairs, freeReceivers, profileCounts, profileStatus } from './profiles.js'

const roster = [
  { id: 'a', name: 'Andrew' },
  { id: 'm', name: 'Megan' },
  { id: 'p', name: 'Paul' },
]

test('checkManualPairs accepts a full one-to-one drawing', () => {
  const out = checkManualPairs(roster, { a: 'm', m: 'p', p: 'a' })
  assert.equal(out.complete, true)
  assert.equal(out.pairs.length, 3)
  assert.deepEqual(out.problems, [])
})

test('checkManualPairs flags self, double receive, and missing picks', () => {
  assert.match(checkManualPairs(roster, { a: 'a' }).errors.a, /can’t draw themselves/)
  const dup = checkManualPairs(roster, { a: 'p', m: 'p', p: 'a' })
  assert.match(dup.errors.m, /already gives to Paul/)
  assert.equal(dup.complete, false)
  const partial = checkManualPairs(roster, { a: 'm' })
  assert.match(partial.problems[0], /Still to pick: Megan, Paul/)
  assert.equal(partial.complete, false)
  assert.equal(checkManualPairs([{ id: 'a', name: 'A' }], {}).complete, false)
})

test('freeReceivers hides the giver and names already taken', () => {
  assert.deepEqual(freeReceivers(roster, { m: 'p' }, 'a').map((p) => p.id), ['m'])
  assert.deepEqual(freeReceivers(roster, { a: 'm' }, 'a').map((p) => p.id), ['m', 'p'])
})

test('profile status and counts', () => {
  assert.equal(profileStatus({ claimed: true, claimed_email: 'x@y.co' }).label, 'Claimed · x@y.co')
  assert.equal(profileStatus({ claimed: false }).tone, 'wait')
  assert.deepEqual(profileCounts([{ claimed: true }, { claimed: false }]), { total: 2, claimed: 1, waiting: 1 })
})
