import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCode, normalizeEmail, normalizeName, readAuthForm } from './authFields.js'

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Paul@PaulQuiroga.com  '), 'paul@paulquiroga.com')
  assert.equal(normalizeEmail(''), '')
  assert.equal(normalizeEmail(null), '')
})

test('normalizeCode strips spaces, dashes and extra characters, keeps 8 digits', () => {
  assert.equal(normalizeCode('4201 8475'), '42018475')
  assert.equal(normalizeCode('420-184-75'), '42018475')
  assert.equal(normalizeCode('  42-01 84 75 \n'), '42018475')
  assert.equal(normalizeCode('12345678901'), '1234567890')
  assert.equal(normalizeCode(''), '')
})

test('normalizeName trims only', () => {
  assert.equal(normalizeName('  Paul Quiroga  '), 'Paul Quiroga')
})

function fakeForm(values) {
  const elements = {
    namedItem(name) {
      if (!(name in values)) return null
      return { value: values[name] }
    },
  }
  return { currentTarget: { elements } }
}

test('readAuthForm uses the live DOM, not fallback, and normalizes', () => {
  const got = readAuthForm(fakeForm({
    email: '  Paul@PaulQuiroga.com ',
    'one-time-code': '4201 8475',
    name: '  Paul  ',
  }), { email: 'stale@example.com', code: '00000000', name: 'Stale' })
  assert.deepEqual(got, {
    email: 'paul@paulquiroga.com',
    code: '42018475',
    name: 'Paul',
    phone: '',
    group: '',
  })
})

test('readAuthForm falls back when a field is missing (hidden email on the code step)', () => {
  const got = readAuthForm(fakeForm({ 'one-time-code': '12-34-56-78' }), {
    email: '  Paul@Host.COM ',
    code: '',
  })
  assert.equal(got.email, 'paul@host.com')
  assert.equal(got.code, '12345678')
})
