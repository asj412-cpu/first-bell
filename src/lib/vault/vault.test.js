import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { canUseVault } from './access.js'
import { ARGON2_PARAMS, PBKDF2_ITERATIONS, decryptJson, encryptJson, openVault, randomDek, setupVault } from './crypto.js'
import { shouldLock } from './lock.js'
import { maskNumber } from './mask.js'
import { checkDigit, parseMrz, parseTd3 } from './mrz.js'
import { OCR_PATHS } from './ocr.js'
import { registerPasskey, unlockWithPasskey } from './passkey.js'
import { inRenewalWindow, safeReminders } from './reminders.js'
import { writeSealed } from './sealedStore.js'
import { auditEvent, prepareAndSend, sendAudit } from './transport.js'

const here = dirname(fileURLToPath(import.meta.url))
const fast = { kdf: 'argon2id', m: 8, t: 1, p: 1 }
const NUMBER = 'CANARY-SSN-123-45-6789-UNIQUE'
const NAME = 'CANARY-NAME-CLAIRE-LYNN-JOHNSON'
const FILE = 'CANARY-FILE-SCAN-PASSPORT-IMAGE'

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  }
}

function mockClient() {
  const calls = []
  return {
    calls,
    from(table) {
      return {
        upsert(row) {
          calls.push({ op: 'upsert', table, row })
          return Promise.resolve({ error: null })
        },
        insert(row) {
          calls.push({ op: 'insert', table, row })
          return Promise.resolve({ error: null })
        },
      }
    },
    storage: {
      from(bucket) {
        return {
          upload(path, body, opts) {
            calls.push({ op: 'upload', bucket, path, body, opts })
            return Promise.resolve({ error: null })
          },
          createSignedUrl() {
            throw new Error('signed urls are forbidden')
          },
          getPublicUrl() {
            throw new Error('public urls are forbidden')
          },
        }
      },
    },
  }
}

function record() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    memberKey: 'member-canary-claire',
    who: 'who-canary-claire',
    docType: 'doctype-canary-passport',
    name: NAME,
    number: NUMBER,
    dob: 'dob-canary-2020-02-10',
    issuedOn: 'issued-canary-2022-01-01',
    expiresOn: 'expires-canary-2027-04-01',
    issuer: 'issuer-canary-utopia',
    notes: 'notes-canary-none',
    fileName: 'filename-canary-passport.jpg',
  }
}

test('production KDF settings meet the published minimums', () => {
  assert.equal(ARGON2_PARAMS.kdf, 'argon2id')
  assert.ok(ARGON2_PARAMS.m >= 19456)
  assert.ok(ARGON2_PARAMS.t >= 2)
  assert.ok(PBKDF2_ITERATIONS >= 600_000)
})

test('a sealed record round-trips and a wrong passphrase does not', async () => {
  const created = await setupVault('correct horse battery', fast)
  const secret = { number: NUMBER, name: NAME }
  const sealed = await encryptJson(created.key, secret)
  assert.equal(JSON.stringify(sealed).includes(NUMBER), false)
  assert.deepEqual(await decryptJson(created.key, sealed), secret)
  const opened = await openVault('correct horse battery', created.envelope)
  assert.deepEqual(await decryptJson(opened.key, sealed), secret)
  await assert.rejects(() => openVault('wrong passphrase!!', created.envelope))
})

test('the server payload and local sealed store contain no plaintext', async () => {
  const created = await setupVault('family vault phrase', fast)
  const body = record()
  const fileBytes = new TextEncoder().encode(FILE)
  const client = mockClient()
  const { sealed, secrets } = await prepareAndSend(client, {
    key: created.key,
    householdId: '22222222-2222-4222-8222-222222222222',
    record: body,
    fileBytes,
  })
  const serialized = JSON.stringify(client.calls)
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, secret)
  }
  assert.equal(serialized.includes('createSignedUrl'), false)
  assert.equal(client.calls.some((call) => call.op === 'upload' && call.bucket === 'vault'), true)
  assert.equal(client.calls.some((call) => call.table === 'vault_records'), true)
  const upload = client.calls.find((call) => call.op === 'upload')
  assert.equal(String(upload.body).includes(FILE), false)
  assert.notEqual(sealed.ciphertext, JSON.stringify(body))

  const storage = memoryStorage()
  writeSealed(storage, { ...created.envelope, records: [sealed] }, secrets)
  const stored = storage.getItem('first-bell.vault.sealed.v1')
  for (const secret of secrets) assert.equal(stored.includes(secret), false, secret)

  const event = auditEvent({
    householdId: '22222222-2222-4222-8222-222222222222',
    actorId: '33333333-3333-4333-8333-333333333333',
    action: 'add',
    recordId: body.id,
    number: NUMBER,
    name: NAME,
  })
  assert.equal(JSON.stringify(event).includes(NUMBER), false)
  await sendAudit(client, event, secrets)
  const auditCall = client.calls.find((call) => call.table === 'vault_audit')
  assert.deepEqual(Object.keys(auditCall.row).sort(), ['action', 'actor_id', 'household_id', 'record_id'])
  assert.equal(JSON.stringify(auditCall.row).includes(NUMBER), false)
})

test('masked social security numbers keep only the last four', () => {
  assert.equal(maskNumber('123-45-6789', 'ssn'), '***-**-6789')
  const masked = maskNumber('L898902C3', 'passport')
  assert.equal(masked.endsWith('9023'), true)
  assert.equal(masked.includes('L898902C3'), false)
})

function buildTd3Line2(number, nationality, birth, expiry, optional) {
  const num = number.padEnd(9, '<').slice(0, 9)
  const opt = optional.padEnd(14, '<').slice(0, 14)
  const numCheck = checkDigit(num)
  const birthCheck = checkDigit(birth)
  const expiryCheck = checkDigit(expiry)
  const optCheck = checkDigit(opt)
  const composite = checkDigit(num + numCheck + birth + birthCheck + expiry + expiryCheck + opt + optCheck)
  return num + numCheck + nationality + birth + birthCheck + 'F' + expiry + expiryCheck + opt + optCheck + composite
}

test('passport MRZ parses on device and renewal text omits the number', () => {
  const line1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
  const number = 'L898902C3'
  const line2 = buildTd3Line2(number, 'UTO', '740812', '120415', 'ZE184226B')
  const parsed = parseTd3(line1, line2, new Date('2026-10-16T12:00:00Z'))
  assert.equal(parsed.number, number)
  assert.equal(parsed.name.includes('Anna Maria'), true)
  assert.equal(parsed.docType, 'passport')
  assert.equal(parsed.dob, '1974-08-12')
  assert.equal(parsed.expiresOn, '2012-04-15')
  assert.equal(parseMrz(`${line1}\n${line2}`, new Date('2026-10-16T12:00:00Z')).number, number)

  const reminders = safeReminders([
    { id: 'rec', docType: 'passport', who: 'Claire', number: NUMBER, expiresOn: '2027-04-01' },
  ], '2026-10-16')
  assert.equal(reminders.length, 1)
  assert.equal(JSON.stringify(reminders).includes(NUMBER), false)
  assert.equal(reminders[0].title.includes('Claire'), true)
  assert.equal(inRenewalWindow('2035-01-01', '2026-10-16'), false)
})

test('the vault locks when the tab is hidden or idle for five minutes', () => {
  assert.equal(shouldLock({ hidden: true, lastActivity: 0, now: 1000 }), true)
  assert.equal(shouldLock({ hidden: false, lastActivity: 0, now: 5 * 60 * 1000 - 1 }), false)
  assert.equal(shouldLock({ hidden: false, lastActivity: 0, now: 5 * 60 * 1000 }), true)
})

test('kids and ordinary members cannot open the vault', () => {
  assert.equal(canUseVault({ demo: true }), true)
  assert.equal(canUseVault({ memberRole: 'owner' }), true)
  assert.equal(canUseVault({ memberRole: 'member' }), false)
  assert.equal(canUseVault({ memberRole: 'member', vaultParent: true }), true)
  assert.equal(canUseVault({}), false)
})

test('a passkey wraps the same key without storing the passphrase', async () => {
  const raw = randomDek()
  const prf = crypto.getRandomValues(new Uint8Array(32))
  const credentials = {
    async create() {
      return {
        rawId: crypto.getRandomValues(new Uint8Array(16)),
        getClientExtensionResults() {
          return { prf: { results: { first: prf } } }
        },
      }
    },
  }
  const passkey = await registerPasskey(raw, credentials)
  assert.equal(JSON.stringify(passkey).includes('family vault phrase'), false)
  const key = await unlockWithPasskey(passkey, {
    async get() {
      return {
        getClientExtensionResults() {
          return { prf: { results: { first: prf.slice() } } }
        },
      }
    },
  })
  const sealed = await encryptJson(key, { number: NUMBER })
  assert.equal(sealed.ciphertext.includes(NUMBER), false)
  assert.equal((await decryptJson(key, sealed)).number, NUMBER)
})

test('vault code does not call the network, signed urls, or browser databases', () => {
  const files = readdirSync(here).filter((name) => (name.endsWith('.js') || name.endsWith('.jsx')) && !name.endsWith('.test.js'))
  const page = readFileSync(join(here, '../../pages/Vault.jsx'), 'utf8')
  const app = readFileSync(join(here, '../../App.jsx'), 'utf8')
  const blob = files.map((name) => readFileSync(join(here, name), 'utf8')).join('\n') + page
  assert.equal(blob.includes('createSignedUrl'), false)
  assert.equal(blob.includes('getPublicUrl'), false)
  assert.equal(blob.includes('navigator.share'), false)
  assert.equal(blob.includes('indexedDB'), false)
  assert.equal(blob.includes('serviceWorker'), false)
  assert.equal(blob.includes('console.log'), false)
  assert.equal(/https?:\/\//.test(readFileSync(join(here, 'ocr.js'), 'utf8')), false)
  for (const value of Object.values(OCR_PATHS)) {
    if (typeof value === 'string') assert.equal(value.startsWith('/ocr'), true)
  }
  assert.equal(app.includes('/v/:'), false)
  assert.equal(app.includes('path="/vault"'), true)
})

test('pbkdf2 fallback also round-trips', async () => {
  const created = await setupVault('fallback passphrase', { kdf: 'pbkdf2', iterations: 1000 })
  const opened = await openVault('fallback passphrase', created.envelope)
  const sealed = await encryptJson(created.key, { number: NUMBER })
  assert.equal((await decryptJson(opened.key, sealed)).number, NUMBER)
  assert.equal(JSON.stringify(created.envelope).includes(NUMBER), false)
})
