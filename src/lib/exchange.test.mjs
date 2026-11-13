import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPublicHttpUrl, extractPreviewImage } from '../../api/giftImage.js'
import { drawAssignments, presentItems, validateJoin } from './exchange.js'
import { sendReminder } from './reminderAdapter.js'
import { readFileSync } from 'node:fs'

test('drawing never gives someone themself', () => {
  const people = [
    { id: 'a', groupId: '1', inDraw: true },
    { id: 'b', groupId: '1', inDraw: true },
    { id: 'c', groupId: '2', inDraw: true },
    { id: 'd', groupId: '2', inDraw: true },
  ]
  const result = drawAssignments(people, { avoidSameGroup: true, random: Math.random })
  assert.equal(result.ok, true)
  const givers = result.assignments.map((row) => row.giverId).sort()
  const receivers = result.assignments.map((row) => row.receiverId).sort()
  assert.deepEqual(givers, ['a', 'b', 'c', 'd'])
  assert.deepEqual(receivers, ['a', 'b', 'c', 'd'])
  for (const row of result.assignments) {
    assert.notEqual(row.giverId, row.receiverId)
    const giver = people.find((person) => person.id === row.giverId)
    const receiver = people.find((person) => person.id === row.receiverId)
    assert.notEqual(giver.groupId, receiver.groupId)
  }
})

test('two people in one household cannot avoid that household', () => {
  const result = drawAssignments(
    [
      { id: 'andrew', groupId: 'johnson', inDraw: true },
      { id: 'megan', groupId: 'johnson', inDraw: true },
    ],
    { avoidSameGroup: true, random: () => 0.1 },
  )
  assert.equal(result.ok, false)
})

test('two people can draw when same household is allowed', () => {
  const result = drawAssignments(
    [
      { id: 'andrew', groupId: 'johnson', inDraw: true },
      { id: 'megan', groupId: 'johnson', inDraw: true },
    ],
    { avoidSameGroup: false },
  )
  assert.equal(result.ok, true)
  assert.equal(result.assignments.length, 2)
})

test('a recipient view hides purchase marks', () => {
  const items = presentItems(
    { items: [{ id: '1', title: 'Book', sort: 0, claimedAt: '2026-12-01', claimedByName: 'Rosa' }] },
    { conceal: true },
  )
  assert.equal(items[0].claimedAt, null)
  assert.equal(items[0].claimedByName, '')
  assert.equal(items[0].title, 'Book')
})

test('joining requires a description on each row and an http link', () => {
  const missing = validateJoin({
    name: 'A',
    phone: '123',
    email: 'nope',
    group: '',
    items: [{ description: '', url: 'notaurl' }],
  })
  assert.equal(missing.ok, false)
  const ok = validateJoin({
    name: 'Rosa',
    phone: '(713) 555-0136',
    email: 'rosa@example.com',
    group: 'Quiroga',
    items: [
      { description: 'A wool scarf', url: 'https://example.com/scarf' },
      { description: 'A book', url: '' },
    ],
    others: [{ name: 'Luis', items: [{ description: 'Coffee', url: 'ftp://files.example/x' }] }],
  })
  assert.equal(ok.ok, false)
  assert.equal(ok.errors['other-0-url-0'], 'Link must start with http:// or https://.')
  const fixed = validateJoin({
    name: 'Rosa',
    phone: '(713) 555-0136',
    email: 'rosa@example.com',
    group: 'Quiroga',
    items: [
      { description: 'A wool scarf', url: 'https://example.com/scarf' },
      { description: 'A book', url: '' },
    ],
    others: [{ name: 'Luis', items: [{ description: 'Coffee', url: '' }] }],
  })
  assert.equal(fixed.ok, true)
  assert.equal(fixed.value.items[0].url, 'https://example.com/scarf')
  assert.equal(fixed.value.items[1].url, '')
})

test('a product page preview image is read from og:image', () => {
  const html = '<meta property="og:image" content="/cdn/scarf.jpg">'
  assert.equal(extractPreviewImage(html, 'https://shop.example/item'), 'https://shop.example/cdn/scarf.jpg')
  assert.equal(extractPreviewImage('<p>No photo</p>', 'https://example.com'), '')
  assert.throws(() => assertPublicHttpUrl('http://127.0.0.1/secret'), /not allowed/)
  assert.throws(() => assertPublicHttpUrl('ftp://shop.example/item'), /http/)
})

test('the send adapter refuses to deliver', () => {
  assert.throws(() => sendReminder(), /not connected/)
})

test('seeded lists match the age rules and leave Drew empty', () => {
  const seed = JSON.parse(readFileSync(new URL('../data/christmas-2026-seed.json', import.meta.url)))
  const byKey = Object.fromEntries(seed.lists.map((list) => [list.kidKey, list]))
  assert.equal(byKey.drew.items.length, 0)
  assert.ok(byKey.chloe.items.length > 50)
  assert.ok(byKey.claire.items.length > 50)
  assert.ok(byKey.chloe.items.every((item) => item.ageFit === '5' || item.ageFit === 'both'))
  assert.ok(byKey.claire.items.every((item) => item.ageFit === '6-7' || item.ageFit === 'both'))
  assert.ok(byKey.chloe.items.every((item) => item.priceLabel.startsWith('about $')))
  assert.ok(byKey.claire.items.some((item) => item.category === 'Doll Clothes'))
  assert.ok(byKey.chloe.items.some((item) => item.category === 'Doll Clothes'))
  assert.equal(byKey.andrew.items.length, 0)
  assert.equal(byKey.megan.items.length, 0)
})
