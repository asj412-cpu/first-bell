const SECRET_FIELDS = ['name', 'number', 'dob', 'issuedOn', 'expiresOn', 'issuer', 'notes', 'fileName', 'memberKey', 'docType', 'who']

export function secretsFromRecord(record, fileText = '') {
  const secrets = []
  for (const field of SECRET_FIELDS) {
    const value = record?.[field]
    if (typeof value === 'string' && value.length >= 3) secrets.push(value)
  }
  if (fileText && fileText.length >= 3) secrets.push(fileText)
  return secrets
}

export function assertNoSecrets(serialized, secrets) {
  const haystack = typeof serialized === 'string' ? serialized : JSON.stringify(serialized)
  for (const secret of secrets || []) {
    if (secret && haystack.includes(secret)) {
      throw new Error('Refusing to send vault plaintext')
    }
  }
}
