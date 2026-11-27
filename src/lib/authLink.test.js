import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authConfirmUrl,
  emailLinkAction,
  friendlyAuthError,
  friendlyLinkError,
  readEmailLink,
  resetEmailLinkForTests,
  safeNextPath,
  verifyEmailLink,
} from './authLink.js'

const PKCE =
  'PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device, or if the storage was cleared.'

test('token_hash links verify without a stored code verifier', () => {
  const href =
    'https://first-bell-seven.vercel.app/auth/confirm?token_hash=abc123abc123abc123&type=email&next=%2F'
  const action = emailLinkAction(href)
  assert.equal(action.action, 'verifyOtp')
  assert.deepEqual(action.params, { token_hash: 'abc123abc123abc123', type: 'email' })
  assert.equal(JSON.stringify(action).includes('code_verifier'), false)
  assert.equal(readEmailLink(href).next, '/')
})

test('a PKCE callback becomes a send-a-new-link message', () => {
  const action = emailLinkAction(
    `https://first-bell-seven.vercel.app/enter?error_code=400&error_description=${encodeURIComponent(PKCE)}`,
  )
  assert.equal(action.action, 'recover')
  assert.equal(action.notice, friendlyLinkError(PKCE))
  assert.doesNotMatch(action.notice, /code verifier|same browser|PKCE/i)
  assert.match(action.notice, /Send a new link/)
  assert.equal(friendlyAuthError(PKCE), action.notice)
})

test('confirm redirect keeps a same-site path and drops other sites', () => {
  assert.equal(safeNextPath('/join/abc'), '/join/abc')
  assert.equal(safeNextPath('https://evil.example/phish'), '/')
  assert.equal(safeNextPath('//evil.example'), '/')
  assert.equal(safeNextPath('/\\evil'), '/')
  assert.equal(safeNextPath('/auth/confirm?next=%2Fjoin%2Fabc'), '/join/abc')
  const redirectTo = authConfirmUrl('https://preview.vercel.app', 'https://preview.vercel.app/join/abc?x=1')
  assert.equal(
    redirectTo,
    'https://preview.vercel.app/auth/confirm?next=' + encodeURIComponent('/join/abc?x=1'),
  )
  const href = `${redirectTo}&token_hash=abc123abc123abc123&type=email`
  const link = readEmailLink(href)
  assert.equal(link.tokenHash, 'abc123abc123abc123')
  assert.equal(link.type, 'email')
  assert.equal(link.next, '/join/abc?x=1')
})

test('verifyEmailLink calls verifyOtp once and ignores a second claim', async () => {
  resetEmailLinkForTests()
  const calls = []
  const client = {
    auth: {
      verifyOtp: async (params) => {
        calls.push(params)
        return { data: { session: { access_token: 'a' }, user: { id: '1' } }, error: null }
      },
    },
    rpc: async (name) => {
      calls.push(name)
      return { data: null, error: null }
    },
  }
  const storage = {
    getItem() {
      throw new Error('code verifier storage should not be read')
    },
  }
  const first = verifyEmailLink(client, 'abc123abc123abc123', 'not-a-type')
  const second = verifyEmailLink(client, 'abc123abc123abc123', 'email')
  const result = await first
  assert.equal(second, first)
  await second
  assert.equal(result.error, null)
  assert.deepEqual(calls[0], { token_hash: 'abc123abc123abc123', type: 'email' })
  assert.equal(calls.filter((call) => call === 'mark_email_verified').length, 1)
  assert.equal(storage.getItem, storage.getItem)
})

test('email templates carry the code and a token_hash link', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
  for (const file of ['supabase/templates/magic_link.html', 'supabase/templates/confirmation.html']) {
    const html = readFileSync(join(root, file), 'utf8')
    assert.match(html, /\{\{\s*\.TokenHash\s*\}\}/)
    assert.match(html, /\{\{\s*\.Token\s*\}\}/)
    assert.match(html, /type=email/)
    assert.doesNotMatch(html, /\{\{\s*\.ConfirmationURL\s*\}\}/)
  }
})

test('email link is held on open and only verified on tap (scanner-safe)', async () => {
  const { holdEmailLink, heldEmailLink, releaseHeldEmailLink, resetEmailLinkForTests } = await import('./authLink.js')
  resetEmailLinkForTests()
  const calls = []
  const client = { auth: { verifyOtp: async (p) => { calls.push(p); return { data: { session: null }, error: null } } } }
  const hash = 'a'.repeat(56)
  holdEmailLink(`https://x.test/auth/confirm?next=%2Fjoin%2Fabcdefgh12&token_hash=${hash}&type=email`)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(calls.length, 0)
  assert.equal(heldEmailLink().link.next, '/join/abcdefgh12')
  const started = releaseHeldEmailLink(client)
  await started.promise
  assert.equal(calls.length, 1)
  assert.equal(calls[0].token_hash, hash)
  assert.equal(heldEmailLink(), null)
  resetEmailLinkForTests()
})
