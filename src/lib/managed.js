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

/**
 * Secret Santa results for the people you manage, from get_managed_assignments.
 * Each line says who a managed person is buying for, or why there is no match yet.
 */
export function managedDrawLines(rows) {
  return (rows || []).map((row) => {
    const name = row.name || 'Your family member'
    const receiver = row.receiver?.name || ''
    const drawn = row.status === 'draft' || row.status === 'locked'
    let text
    if (receiver) text = `${name} is buying for ${receiver}`
    else if (row.in_draw === false) text = `${name} is not in this drawing`
    else if (drawn) text = `${name} has no match yet. Andrew needs to draw again.`
    else text = `${name} is in the drawing. Their person shows up here after the draw.`
    return {
      key: row.list_id || row.participant_id || name,
      name,
      receiver,
      slug: row.receiver?.list?.share_slug || '',
      text,
    }
  })
}
