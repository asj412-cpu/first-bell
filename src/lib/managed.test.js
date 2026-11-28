import assert from 'node:assert/strict'
import test from 'node:test'
import { validateGiftItems } from './exchange.js'
import { cleanManagedRows, managedDrawLines, managedFor, managedLabel } from './managed.js'

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
  const withNote = cleanManagedRows(
    [{ description: 'Fishing reel', url: '', notes: '  Left-handed  ' }],
    validateGiftItems,
  )
  assert.equal(withNote.ok, true)
  assert.equal(withNote.items[0].notes, 'Left-handed')
  const noteOnly = cleanManagedRows([{ description: '', url: '', notes: 'Size M' }], validateGiftItems)
  assert.equal(noteOnly.ok, false)
})

test('managedDrawLines shows who each managed person drew', () => {
  const lines = managedDrawLines([
    { list_id: 'a', name: 'Mike', status: 'locked', in_draw: true, receiver: { name: 'Bob', list: { share_slug: 'fbob' } } },
    { list_id: 'b', name: 'Lily', status: 'open', in_draw: true, receiver: null },
    { list_id: 'c', name: 'Zed', status: 'locked', in_draw: false, receiver: null },
    { list_id: 'd', name: 'Ann', status: 'draft', in_draw: true, receiver: null },
  ])
  assert.equal(lines[0].text, 'Mike is buying for Bob')
  assert.equal(lines[0].slug, 'fbob')
  assert.match(lines[1].text, /after the draw/)
  assert.equal(lines[2].text, 'Zed is not in this drawing')
  assert.match(lines[3].text, /draw again/)
  assert.deepEqual(managedDrawLines(null), [])
})
