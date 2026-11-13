/**
 * Andrew chose iCloud SMTP (smtp.mail.me.com) for reminder delivery.
 * This file still does not send anything. An app-specific password for
 * asj412@me.com has to be saved as a server secret before a message can go out.
 * Do not put that password in the app or the repo.
 */

export const REMINDER_ADAPTER = {
  id: 'icloud-smtp',
  delivers: false,
  label:
    'Reminders will go through iCloud mail (smtp.mail.me.com). Nothing is sent yet. An app-specific password has to be saved on the server first.',
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
