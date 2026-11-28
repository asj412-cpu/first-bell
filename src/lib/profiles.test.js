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
  assert.deepEqual(profileCounts([{ claimed: true }, { claimed: false }]), { total: 2, claimed: 1, kept: 0, waiting: 1 })
  // Andrew keeps a list for someone who won't sign up: not "waiting", and out of the picker
  assert.deepEqual(profileCounts([{ claimed: true }, { claimed: false, wont_sign_up: true }, { claimed: false }]), { total: 3, claimed: 1, kept: 1, waiting: 1 })
  assert.equal(profileStatus({ claimed: false, wont_sign_up: true }).tone, 'keep')
  assert.match(profileStatus({ claimed: false, wont_sign_up: true }).label, /You keep this list/)
  assert.equal(profileStatus({ claimed: true, wont_sign_up: true }).tone, 'yes')
})

test('directory links, lines and order', async () => {
  const { directoryLink, directoryLine, sortDirectoryGroups, notInDrawing, yourFamilyCopy } = await import('./profiles.js')
  assert.equal(directoryLink({ mine: true, kid_key: 'guest-1', share_slug: 'fabc' }), '/gifts/guest-1')
  assert.equal(directoryLink({ mine: false, kid_key: 'claire', share_slug: 'fxyz' }), '/g/fxyz')
  assert.equal(directoryLine({ item_count: 1 }), '1 idea')
  assert.equal(directoryLine({ item_count: 0 }), '0 ideas')
  assert.equal(directoryLine({ item_count: 3, mine: true }), '3 ideas · yours')
  assert.equal(directoryLine({ item_count: 2, managed_by: 'Paul' }), '2 ideas · kept by Paul')
  const groups = [{ label: 'The Wafford' }, { label: 'The Cress' }, { label: 'Johnson' }]
  assert.deepEqual(sortDirectoryGroups(groups, 'The Wafford').map((g) => g.label), ['The Wafford', 'Johnson', 'The Cress'])
  assert.deepEqual(sortDirectoryGroups(groups, null).map((g) => g.label), ['Johnson', 'The Cress', 'The Wafford'])
  assert.equal(notInDrawing({ inDraw: false }), true)
  assert.equal(notInDrawing({ inDraw: true }), false)
  assert.equal(notInDrawing({}), false)
  assert.equal(notInDrawing(null), false)
  assert.match(yourFamilyCopy({ drawingLocked: true }), /already locked.*aren’t in this year’s drawing/)
  assert.match(yourFamilyCopy({ drawingLocked: false }), /join Secret Santa too until Andrew locks/)
  assert.doesNotMatch(yourFamilyCopy(null), /they’re in Secret Santa too/)
})
