import { b64ToBytes, bytesToB64, wipe } from './bytes.js'

/** OWASP password-storage minimum for Argon2id. Tests may pass smaller params. */
export const ARGON2_PARAMS = { kdf: 'argon2id', m: 19456, t: 2, p: 1 }

/** WebCrypto fallback when Argon2id cannot run. OWASP PBKDF2-HMAC-SHA256 minimum. */
export const PBKDF2_ITERATIONS = 600_000

const AES = { name: 'AES-GCM', length: 256 }

export async function importAes(raw, usages = ['encrypt', 'decrypt']) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages)
}

async function derivePbkdf2(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    AES,
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function deriveKek(passphrase, salt, params = ARGON2_PARAMS) {
  const saltBytes = salt instanceof Uint8Array ? salt : b64ToBytes(salt)
  if (params.kdf === 'argon2id') {
    const { argon2idAsync } = await import('@noble/hashes/argon2')
    const hash = await argon2idAsync(passphrase, saltBytes, {
      m: params.m,
      t: params.t,
      p: params.p,
      dkLen: 32,
    })
    return importAes(hash)
  }
  return derivePbkdf2(passphrase, saltBytes, params.iterations || PBKDF2_ITERATIONS)
}

export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  return { iv: bytesToB64(iv), ciphertext: bytesToB64(cipher) }
}

export async function decryptBytes(key, packed) {
  const iv = b64ToBytes(packed.iv)
  const cipher = b64ToBytes(packed.ciphertext)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher))
  return plain
}

export async function encryptJson(key, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  try {
    return await encryptBytes(key, bytes)
  } finally {
    wipe(bytes)
  }
}

export async function decryptJson(key, packed) {
  const bytes = await decryptBytes(key, packed)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } finally {
    wipe(bytes)
  }
}

export function randomDek() {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function setupVault(passphrase, params = ARGON2_PARAMS) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const kek = await deriveKek(passphrase, salt, params)
  const dek = randomDek()
  const wrapped = await encryptBytes(kek, dek)
  const key = await importAes(dek)
  return {
    key,
    rawDek: dek,
    envelope: {
      v: 1,
      kdf: params.kdf,
      salt: bytesToB64(salt),
      params: params.kdf === 'argon2id'
        ? { m: params.m, t: params.t, p: params.p }
        : { iterations: params.iterations || PBKDF2_ITERATIONS },
      wrapIv: wrapped.iv,
      wrappedDek: wrapped.ciphertext,
      passkeys: [],
      records: [],
    },
  }
}

export async function openVault(passphrase, envelope) {
  const params = envelope.kdf === 'argon2id'
    ? { kdf: 'argon2id', ...envelope.params }
    : { kdf: 'pbkdf2', iterations: envelope.params?.iterations || PBKDF2_ITERATIONS }
  const kek = await deriveKek(passphrase, envelope.salt, params)
  const raw = await decryptBytes(kek, { iv: envelope.wrapIv, ciphertext: envelope.wrappedDek })
  if (raw.length !== 32) {
    wipe(raw)
    throw new Error('Vault key is the wrong length')
  }
  const key = await importAes(raw)
  return { key, rawDek: raw }
}

export async function wrapDekWithKey(kek, rawDek) {
  return encryptBytes(kek, rawDek)
}
