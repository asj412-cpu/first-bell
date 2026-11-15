import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMO_INVITE_TOKEN, freshExchange, validateJoin } from './exchange.js'
import { consumeInvite, inviteStatusCopy, previewLocalInvite, shareLinks } from './invites.js'

test('standing demo invite stays active and a used personal invite does not', () => {
  const exchange = freshExchange()
  exchange.invites = [
    {
      token: 'abc123abc123abc123abc123',
      kind: 'gift_list',
      label: 'Christmas 2026',
      singleUse: true,
      usedAt: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-12-01T00:00:00.000Z',
    },
  ]
  assert.equal(previewLocalInvite(DEMO_INVITE_TOKEN, exchange).status, 'active')
  assert.equal(previewLocalInvite('abc123abc123abc123abc123', exchange).status, 'used')
  assert.equal(previewLocalInvite('missing-token-value-xxxx', exchange).status, 'missing')
  assert.match(inviteStatusCopy('expired').title, /expired/i)
})

test('accepting an invite marks that token used', () => {
  const exchange = freshExchange()
  exchange.invites = [
    {
      token: 'abc123abc123abc123abc123',
      kind: 'gift_list',
      label: 'Christmas 2026',
      singleUse: true,
      usedAt: null,
      expiresAt: '2026-12-01T00:00:00.000Z',
    },
  ]
  const next = consumeInvite(exchange, 'abc123abc123abc123abc123', 'rosa@example.com')
  assert.equal(previewLocalInvite('abc123abc123abc123abc123', next).status, 'used')
  assert.match(inviteStatusCopy('used').title, /already been used/i)
})

test('share links stay on the device', () => {
  const links = shareLinks({
    url: 'https://first-bell-seven.vercel.app/join/abc',
    subject: 'Join us',
    text: 'Add your list.',
  })
  assert.match(links.mailto, /^mailto:\?subject=/)
  assert.match(links.sms, /^sms:\?&body=/)
  assert.match(links.message, /Add your list/)
})

test('joining does not require a gift idea yet', () => {
  const result = validateJoin({
    name: 'Rosa Garcia',
    phone: '(713) 555-0100',
    email: 'rosa@example.com',
    group: 'The Garcias',
    items: [{ description: '', url: '' }],
    others: [],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.items, [])
})
