import assert from 'node:assert/strict'
import test from 'node:test'
import { validateGiftItems } from './exchange.js'
import { cleanManagedRows, managedFor, managedLabel } from './managed.js'

test('managedLabel names the manager and the relationship', () => {
  assert.equal(managedLabel({ manager_name: 'Sarah', relationship: 'husband' }), 'Managed by Sarah · husband')
  assert.equal(managedLabel({ manager_name: 'Sarah', relationship: 'son', age_label: '7' }), 'Managed by Sarah · son, 7')
  assert.equal(managedLabel({ manager_name: 'Sarah', mine: true }), 'Managed by you')
  assert.equal(managedLabel(null), '')
})

test('managedFor finds a row by list id', () => {
  const rows = [{ list_id: 'a' }, { list_id: 'b', manager_name: 'Sarah' }]
  assert.equal(managedFor(rows, 'b').manager_name, 'Sarah')
  assert.equal(managedFor(rows, 'c'), null)
  assert.equal(managedFor(undefined, 'c'), null)
})

test('cleanManagedRows allows an empty list but still checks real rows', () => {
  assert.deepEqual(cleanManagedRows([{ description: '', url: '' }], validateGiftItems), { ok: true, errors: {}, items: [] })
  const good = cleanManagedRows([{ description: 'Fishing reel', url: 'https://example.com/r' }], validateGiftItems)
  assert.equal(good.ok, true)
  assert.equal(good.items.length, 1)
  const bad = cleanManagedRows([{ description: 'Socks', url: 'ftp://nope' }], validateGiftItems)
  assert.equal(bad.ok, false)
})
