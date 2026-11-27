import assert from 'node:assert/strict'
import test from 'node:test'
import { canPutBack } from './purchases.js'

test('canPutBack: only the marker or Andrew, only on taken gifts', () => {
  assert.equal(canPutBack({ purchased: true, markedByMe: true }), true)
  assert.equal(canPutBack({ purchased: true, markedByMe: false }), false)
  assert.equal(canPutBack({ purchased: true, markedByMe: false }, { admin: true }), true)
  assert.equal(canPutBack({ claimedAt: '2026-11-27', markedByMe: true }), true)
  assert.equal(canPutBack({ purchased: false, markedByMe: true }, { admin: true }), false)
  assert.equal(canPutBack(null, { admin: true }), false)
})

test('signed-out plain list items never offer Put it back', () => {
  // A concealed payload has no purchased / marked_by_me fields at all.
  assert.equal(canPutBack({ id: 'a', title: 'Socks' }, { admin: true }), false)
})
