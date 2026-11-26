/** The managed-member record for a list (a husband or kid added under an invited member), if any. */
export function managedFor(managedMembers, listId) {
  return (managedMembers || []).find((row) => row.list_id === listId) || null
}

/** "Managed by Sarah · husband" (or "Managed by you · son, 7"). */
export function managedLabel(managed, { mine = false } = {}) {
  if (!managed) return ''
  const who = mine || managed.mine ? 'you' : managed.manager_name || 'family'
  const extra = [managed.relationship, managed.age_label].filter(Boolean).join(', ')
  return extra ? `Managed by ${who} · ${extra}` : `Managed by ${who}`
}

/** Gift rows for a managed person. Unlike validateGiftItems, an empty list is allowed. */
export function cleanManagedRows(rows, validate) {
  const blank = (rows || []).every((row) => !String(row?.description || '').trim() && !String(row?.url || '').trim())
  if (blank) return { ok: true, errors: {}, items: [] }
  const result = validate(rows)
  const errors = { ...result.errors }
  delete errors.items
  const ok = Object.keys(errors).length === 0 && result.items.length <= 40
  if (result.items.length > 40) errors.items = 'Forty gifts is the limit for one list.'
  return { ok, errors, items: result.items }
}
