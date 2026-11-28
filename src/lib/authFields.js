// Shared helpers for sign-in, family-link and join forms.
// Phone autofill often fills a field without keystrokes (and sometimes
// without a React change event), can add spaces or capitals, and may
// submit the form in the same tick. Always read the live DOM on submit.

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeCode(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 10)
}

export function normalizeName(value) {
  return String(value ?? '').trim()
}

function formOf(event) {
  const target = event?.currentTarget || event?.target
  if (target && target.elements) return target
  if (target && target.form) return target.form
  return null
}

function fieldValue(form, name) {
  if (!form?.elements) return ''
  const el = form.elements.namedItem(name)
  if (!el) return ''
  if (typeof el.value === 'string') return el.value
  if (typeof el.length === 'number' && el[0] && typeof el[0].value === 'string') return el[0].value
  return ''
}

/** Live values from the submitted form, not stale React state. */
export function readAuthForm(event, fallback = {}) {
  const form = formOf(event)
  return {
    email: normalizeEmail(fieldValue(form, 'email') || fallback.email),
    code: normalizeCode(fieldValue(form, 'one-time-code') || fallback.code),
    name: normalizeName(fieldValue(form, 'name') || fallback.name),
    phone: String(fieldValue(form, 'phone') || fallback.phone || ''),
    group: normalizeName(fieldValue(form, 'group') || fallback.group),
  }
}

export const emailInputProps = {
  type: 'email',
  name: 'email',
  autoComplete: 'email',
  inputMode: 'email',
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: 'false',
  enterKeyHint: 'next',
}

// type="text" + inputMode numeric: a full paste or autofill (spaces, dashes)
// is accepted. No pattern and no tight maxLength — those reject iOS/Android
// one-time-code fills before we can strip them.
export const codeInputProps = {
  type: 'text',
  name: 'one-time-code',
  autoComplete: 'one-time-code',
  inputMode: 'numeric',
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: 'false',
  enterKeyHint: 'done',
  maxLength: 16,
}

export const nameInputProps = {
  type: 'text',
  name: 'name',
  autoComplete: 'name',
  autoCapitalize: 'words',
}

export const phoneInputProps = {
  type: 'tel',
  name: 'phone',
  autoComplete: 'tel',
  inputMode: 'tel',
}
