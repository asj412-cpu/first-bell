import { DEMO_INVITE_TOKEN } from './exchange.js'

export function newInviteToken() {
  const bytes = new Uint8Array(20)
  const cryptoRef = globalThis.crypto
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes)
  else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function invitePath(token) {
  return `/join/${token}`
}

export function inviteUrl(token, origin = '') {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}${invitePath(token)}`
}

export function inviteCopy(kind, label) {
  if (kind === 'event') {
    const name = label || 'a family event'
    return {
      subject: `You're invited — ${name}`,
      text: `You're invited to ${name} in Mi Casa. Open the link to sign in, RSVP, and see what to bring.`,
    }
  }
  return {
    subject: "You're invited to the Johnson family gift list",
    text: 'Please add your Christmas list in Mi Casa. Open the link, sign in with your email, and enter your name and phone. You can change the list later. What has been bought stays hidden from the person the gift is for.',
  }
}

export function shareLinks({ url, subject, text }) {
  const message = `${text}\n\n${url}`
  return {
    sms: `sms:?&body=${encodeURIComponent(message)}`,
    mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
    message,
  }
}

export function consumeInvite(exchange, token, email) {
  if (!token) return exchange
  const invites = exchange?.invites || []
  const found = invites.some((invite) => invite.token === token)
  const usedAt = new Date().toISOString()
  const next = found
    ? invites.map((invite) =>
        invite.token === token
          ? { ...invite, singleUse: true, usedAt: invite.usedAt || usedAt, usedByEmail: email || invite.usedByEmail || '' }
          : invite,
      )
    : [
        ...invites,
        {
          token,
          kind: 'gift_list',
          label: 'Christmas 2026',
          partySlug: null,
          expiresAt: null,
          singleUse: true,
          usedAt,
          usedByEmail: email || '',
        },
      ]
  return { ...exchange, invites: next }
}

export function previewLocalInvite(token, exchange) {
  const standing = token === DEMO_INVITE_TOKEN || token === exchange?.inviteToken
  if (standing) {
    return { status: 'active', kind: 'gift_list', label: 'Christmas 2026', party_slug: null, legacy: true }
  }
  const row = (exchange?.invites || []).find((invite) => invite.token === token)
  if (!row) return { status: 'missing', kind: null, label: '', party_slug: null }
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    return { status: 'expired', kind: row.kind, label: row.label, party_slug: row.partySlug || null }
  }
  if (row.singleUse && row.usedAt) {
    return { status: 'used', kind: row.kind, label: row.label, party_slug: row.partySlug || null }
  }
  return {
    status: 'active',
    kind: row.kind,
    label: row.label,
    party_slug: row.partySlug || null,
  }
}

export function inviteStatusCopy(status) {
  if (status === 'expired') {
    return {
      title: 'This invite expired',
      body: 'Ask Andrew or Megan for a fresh link. This one is no longer active.',
    }
  }
  if (status === 'used') {
    return {
      title: 'This invite has already been used',
      body: 'Each new link works once. If this was you, sign in from the house and open your list. Otherwise ask for a new link.',
    }
  }
  return {
    title: 'That invite is not active',
    body: 'Ask Andrew or Megan for a fresh link.',
  }
}

export function rpcMissing(error) {
  const message = `${error?.message || ''} ${error?.code || ''}`
  return /schema cache|could not find the function|PGRST202|42883/i.test(message)
}
