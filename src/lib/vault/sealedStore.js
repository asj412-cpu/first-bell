import { assertNoSecrets } from './secrets.js'

export const SEALED_KEY = 'first-bell.vault.sealed.v1'
export const AUDIT_KEY = 'first-bell.vault.audit.v1'

export function readSealed(storage) {
  try {
    const raw = storage.getItem(SEALED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== 1 || !parsed.wrappedDek) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSealed(storage, envelope, secrets) {
  const payload = {
    v: 1,
    kdf: envelope.kdf,
    salt: envelope.salt,
    params: envelope.params,
    wrapIv: envelope.wrapIv,
    wrappedDek: envelope.wrappedDek,
    passkeys: (envelope.passkeys || []).map((row) => ({
      credentialId: row.credentialId,
      wrapIv: row.wrapIv,
      wrappedDek: row.wrappedDek,
    })),
    records: (envelope.records || []).map((row) => ({
      id: row.id,
      iv: row.iv,
      ciphertext: row.ciphertext,
      fileIv: row.fileIv || null,
      fileCiphertext: row.fileCiphertext || null,
    })),
  }
  assertNoSecrets(payload, secrets)
  storage.setItem(SEALED_KEY, JSON.stringify(payload))
  return payload
}

export function readAudit(storage) {
  try {
    const raw = storage.getItem(AUDIT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function appendAudit(storage, event, secrets = []) {
  const row = {
    action: event.action,
    recordId: event.recordId || null,
    actor: event.actor || 'parent',
    at: event.at || new Date().toISOString(),
  }
  assertNoSecrets(row, secrets)
  const next = [row, ...readAudit(storage)].slice(0, 200)
  storage.setItem(AUDIT_KEY, JSON.stringify(next))
  return next
}
