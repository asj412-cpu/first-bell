import { wallEvent } from '../events.js'
import { addDaysIso } from '../time.js'

export const DOC_LABELS = {
  ssn: 'Social Security card',
  passport: 'Passport',
  'birth-certificate': 'Birth certificate',
  id: 'ID',
  insurance: 'Insurance card',
}

const RENEWAL_DAYS = 274

export function reminderTitle(record) {
  const kind = DOC_LABELS[record.docType] || 'Document'
  const who = record.who || 'family member'
  return `${kind} renewal · ${who}`
}

export function inRenewalWindow(expiresOn, nowIso) {
  if (!expiresOn || !nowIso) return false
  const start = addDaysIso(expiresOn, -RENEWAL_DAYS)
  const end = addDaysIso(expiresOn, 30)
  return nowIso >= start && nowIso <= end
}

/** Titles only. Document numbers are not copied onto the reminder. */
export function safeReminders(records, nowIso) {
  return (records || [])
    .filter((record) => inRenewalWindow(record.expiresOn, nowIso))
    .map((record) => {
      const title = reminderTitle(record)
      const event = wallEvent({
        id: `vault-${record.id}`,
        title,
        kind: 'vault',
        date: record.expiresOn,
        allDay: true,
        source: 'vault',
      })
      return {
        ...event,
        key: `vault-${record.id}`,
        date: record.expiresOn,
        sourceLabel: 'Renewal',
        location: '',
      }
    })
}
