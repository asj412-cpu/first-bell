import { decryptBytes, encryptBytes, importAes } from './crypto.js'
import { wipe } from './bytes.js'

export async function prfSalt() {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('first-bell.vault.prf.v1'))
  return new Uint8Array(digest)
}

function bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function passkeySupported() {
  return typeof navigator !== 'undefined' && !!navigator.credentials?.create
}

export async function registerPasskey(rawDek, credentials = navigator.credentials) {
  const salt = await prfSalt()
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId = crypto.getRandomValues(new Uint8Array(16))
  const created = await credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'First Bell' },
      user: { id: userId, name: 'vault', displayName: 'Family vault' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  })
  let prf = created.getClientExtensionResults?.()?.prf?.results?.first
  if (!prf) {
    const next = await credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: created.rawId }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: salt } } },
      },
    })
    prf = next.getClientExtensionResults?.()?.prf?.results?.first
  }
  if (!prf) throw new Error('This device cannot wrap the vault key with a passkey')
  const prfBytes = new Uint8Array(prf)
  const kek = await importAes(prfBytes)
  const wrapped = await encryptBytes(kek, rawDek)
  wipe(prfBytes)
  return {
    credentialId: bytesToB64url(new Uint8Array(created.rawId)),
    wrapIv: wrapped.iv,
    wrappedDek: wrapped.ciphertext,
  }
}

export async function unlockWithPasskey(passkey, credentials = navigator.credentials) {
  const salt = await prfSalt()
  const assertion = await credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  })
  const prf = assertion.getClientExtensionResults?.()?.prf?.results?.first
  if (!prf) throw new Error('Passkey did not return a vault key')
  const prfBytes = new Uint8Array(prf)
  const kek = await importAes(prfBytes)
  const raw = await decryptBytes(kek, { iv: passkey.wrapIv, ciphertext: passkey.wrappedDek })
  wipe(prfBytes)
  try {
    return importAes(raw)
  } finally {
    wipe(raw)
  }
}
