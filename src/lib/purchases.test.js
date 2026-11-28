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

import { overlayMarks } from './purchases.js'

test('overlayMarks puts the database marks on the screen items', () => {
  const items = [{ id: 'a', title: 'Socks' }, { id: 'b', title: 'Mug' }]
  const remote = { purchasesVisible: true, items: [{ id: 'a', purchased: true, claimedByName: 'Debbie', claimedAt: 't', markedByMe: false }, { id: 'b', purchased: false }] }
  const out = overlayMarks(items, remote)
  assert.equal(out[0].purchased, true)
  assert.equal(out[0].claimedByName, 'Debbie')
  assert.equal(out[1].purchased, false)
})

test('overlayMarks never adds marks when the database says they are hidden', () => {
  const items = [{ id: 'a', title: 'Socks' }]
  assert.deepEqual(overlayMarks(items, { purchasesVisible: false, items: [{ id: 'a', purchased: true, claimedByName: 'X' }] }), items)
  assert.deepEqual(overlayMarks(items, null), items)
})

import { purchaseLabel } from './purchases.js'

test('purchaseLabel: others see Purchased (by X), the marker sees by you', () => {
  assert.equal(purchaseLabel({ purchased: true, claimedByName: 'Stephanie' }), 'Purchased (by Stephanie)')
  assert.equal(purchaseLabel({ purchased: true, claimedByName: 'Stephanie', markedByMe: true }), 'Purchased (by you)')
  assert.equal(purchaseLabel({ purchased: true }), 'Purchased')
})
