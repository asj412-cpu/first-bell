/**
 * Reminder delivery is a stub on purpose.
 * Nothing in this file opens a network request or talks to an email or SMS provider.
 * Andrew has to choose a delivery option and say yes before any message can be sent.
 */

export const REMINDER_ADAPTER = {
  id: 'stub',
  delivers: false,
  label: 'Nothing is sent. No email or text provider is connected.',
}

export function previewReminder({ reminder, recipients, previewedAt }) {
  return {
    adapter: REMINDER_ADAPTER.id,
    delivered: false,
    reminderId: reminder.id || reminder.kind,
    kind: reminder.kind,
    subject: reminder.subject,
    body: reminder.body,
    recipients,
    previewedAt: previewedAt || new Date().toISOString(),
  }
}

export function sendReminder() {
  throw new Error('Reminder sending is not connected. Nothing was sent.')
}
