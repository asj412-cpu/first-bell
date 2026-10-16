import { encryptBytes, encryptJson } from './crypto.js'
import { assertNoSecrets, secretsFromRecord } from './secrets.js'
import { bytesToB64 } from './bytes.js'

export async function sealRecord(key, record, fileBytes) {
  const sealedBody = await encryptJson(key, record)
  let file = null
  if (fileBytes && fileBytes.length) {
    file = await encryptBytes(key, fileBytes)
  }
  return {
    id: record.id,
    iv: sealedBody.iv,
    ciphertext: sealedBody.ciphertext,
    fileIv: file?.iv || null,
    fileCiphertext: file?.ciphertext || null,
  }
}

export function fileText(fileBytes) {
  if (!fileBytes || !fileBytes.length) return ''
  return new TextDecoder().decode(fileBytes)
}

/**
 * Sends ciphertext only. Signed URLs and public URLs are not part of this client.
 */
export async function sendSealedRecord(client, { householdId, sealed, secrets }) {
  const row = {
    id: sealed.id,
    household_id: householdId,
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
    file_iv: sealed.fileIv,
    file_path: sealed.fileCiphertext ? `${householdId}/${sealed.id}` : null,
  }
  assertNoSecrets(row, secrets)
  if (sealed.fileCiphertext) {
    assertNoSecrets(sealed.fileCiphertext, secrets)
    const { error } = await client.storage.from('vault').upload(row.file_path, sealed.fileCiphertext, {
      contentType: 'application/octet-stream',
      upsert: true,
    })
    if (error) throw error
  }
  const { error } = await client.from('vault_records').upsert(row)
  if (error) throw error
  return row
}

export async function sendWrappedKey(client, { householdId, envelope, secrets = [] }) {
  const row = {
    household_id: householdId,
    kdf: envelope.kdf,
    kdf_salt: envelope.salt,
    kdf_params: envelope.params,
    wrapped_dek: envelope.wrappedDek,
    wrap_iv: envelope.wrapIv,
  }
  assertNoSecrets(row, secrets)
  const { error } = await client.from('vault_keys').upsert(row)
  if (error) throw error
  return row
}

export async function sendAudit(client, event, secrets = []) {
  const row = {
    household_id: event.householdId,
    actor_id: event.actorId,
    action: event.action,
    record_id: event.recordId || null,
  }
  assertNoSecrets(row, secrets)
  const { error } = await client.from('vault_audit').insert(row)
  if (error) throw error
  return row
}

export function auditEvent({ householdId, actorId, action, recordId }) {
  const allowed = ['unlock', 'lock', 'add', 'view', 'delete', 'reveal']
  if (!allowed.includes(action)) throw new Error('Unknown vault audit action')
  return { householdId, actorId, action, recordId: recordId || null }
}

export async function prepareAndSend(client, { key, householdId, record, fileBytes }) {
  const secrets = secretsFromRecord(record, fileText(fileBytes))
  const sealed = await sealRecord(key, record, fileBytes)
  assertNoSecrets(sealed, secrets)
  if (fileBytes && bytesToB64(fileBytes).length > 8) {
    assertNoSecrets(sealed.fileCiphertext || '', [fileText(fileBytes)])
  }
  await sendSealedRecord(client, { householdId, sealed, secrets })
  return { sealed, secrets }
}
