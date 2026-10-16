export function maskNumber(value, docType) {
  const raw = String(value || '')
  const digits = raw.replace(/\D/g, '')
  if (!raw) return ''
  if (docType === 'ssn') {
    const last4 = (digits || raw).slice(-4).padStart(4, '•')
    return `***-**-${last4}`
  }
  const visible = (digits || raw).slice(-4)
  const hidden = Math.max((digits || raw).length - visible.length, 4)
  return `${'•'.repeat(hidden)}${visible}`
}

export const REVEAL_HOLD_MS = 600
export const REMASK_MS = 8000
