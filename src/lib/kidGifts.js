import { moneyLabel } from './catalog.js'
import { safeHttp } from './gifts.js'

export const KID_CATEGORIES = [
  { id: 'dolls', speak: 'Dolls' },
  { id: 'lego', speak: 'Lego' },
  { id: 'art', speak: 'Art' },
  { id: 'books', speak: 'Books' },
  { id: 'games', speak: 'Games' },
  { id: 'outdoors', speak: 'Outdoors' },
  { id: 'dressup', speak: 'Dress up' },
  { id: 'stuffed', speak: 'Stuffed animals' },
]

export const KID_PROMPTS = {
  home: (name) => `Hi ${name}. Tap a heart.`,
  mic: 'Tap and say what you want.',
  camera: 'Take a picture of the toy.',
  pictures: 'Pick a picture.',
  saved: 'I saved it.',
  pin: 'Grown ups, enter the pin.',
  pinNo: 'That pin did not open the door.',
  wait: 'Let us wait a minute.',
  retry: 'Try again.',
  missing: 'Ask a grown up.',
}

const SECRET_KEY = 'first-bell.kid-secrets'
const PIN_WINDOW = 10 * 60 * 1000
const WISH_WINDOW = 10 * 60 * 1000
const DAY_WINDOW = 24 * 60 * 60 * 1000

export function kidIcon(kidKey) {
  if (kidKey === 'claire' || kidKey === 'chloe' || kidKey === 'drew') return `/kids/${kidKey}.png`
  return '/kids/kid.png'
}

export function randomSecret() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function readSecrets() {
  const parsed = readJson(SECRET_KEY)
  return parsed && typeof parsed === 'object' ? parsed : {}
}

export function rememberKidSecret(listId, secret) {
  const all = readSecrets()
  all[listId] = secret
  localStorage.setItem(SECRET_KEY, JSON.stringify(all))
}

export function forgetKidSecret(listId) {
  const all = readSecrets()
  delete all[listId]
  localStorage.setItem(SECRET_KEY, JSON.stringify(all))
}

export function attachKidLink(list, linkRows) {
  const active = (linkRows || []).find((row) => row.list_id === list.id && !row.revoked_at)
  if (!active) return { ...list, kidLink: null }
  return {
    ...list,
    kidLink: {
      secret: readSecrets()[list.id] || '',
      pinHash: '',
      revokedAt: null,
      active: true,
      createdAt: active.created_at,
    },
  }
}

export function findKidList(lists, secret) {
  if (!secret) return null
  return (
    (lists || []).find((list) => list.kidLink && !list.kidLink.revokedAt && list.kidLink.secret === secret) || null
  )
}

export function makeKidItem(list, fields) {
  const sort = (list.items || []).reduce((max, item) => Math.max(max, item.sort ?? 0), -1) + 1
  return {
    id: crypto.randomUUID(),
    title: `New from ${list.displayName}`,
    notes: (fields.label || '').trim().slice(0, 160),
    url: '',
    urlSecondary: '',
    image: fields.image || '',
    audio: fields.audio || '',
    category: fields.category || '',
    availability: '',
    sort,
    claimedByName: '',
    claimedAt: null,
    reviewStatus: 'pending',
    addedBy: 'kid',
    catalogId: '',
  }
}

export function makeCatalogItem(list, product) {
  const sort = (list.items || []).reduce((max, item) => Math.max(max, item.sort ?? 0), -1) + 1
  const price = moneyLabel(product.price)
  return {
    id: crypto.randomUUID(),
    title: product.name,
    notes: [product.retailer, price, product.inStock === false ? 'Ask a grown-up' : '', product.checkSize ? 'Check size' : ''].filter(Boolean).join(' · '),
    url: product.url || '',
    urlSecondary: '',
    image: product.image || '',
    audio: '',
    category: product.category || '',
    catalogId: product.id,
    availability: '',
    sort,
    claimedByName: '',
    claimedAt: null,
    reviewStatus: 'pending',
    addedBy: 'kid',
  }
}

export function kidVisibleItems(list) {
  return [...(list?.items || [])]
    .filter((item) => !item.claimedAt)
    .filter((item) => item.reviewStatus !== 'pending' || item.addedBy === 'kid')
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
}

export function pendingItems(list) {
  return [...(list?.items || [])]
    .filter((item) => item.reviewStatus === 'pending')
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
}

export function safeMedia(url, kind) {
  const value = (url || '').trim()
  if (!value) return ''
  if (kind === 'image' && value.startsWith('data:image/')) return value
  if (kind === 'audio' && value.startsWith('data:audio/')) return value
  if (kind === 'image' && value.startsWith('/') && !value.startsWith('//') && !value.includes('..')) return value
  if (kind === 'image') return safeHttp(value)
  return ''
}

export function payloadToKidList(payload) {
  if (!payload?.list) return null
  const list = payload.list
  return {
    id: list.id,
    kidKey: list.kid_key,
    displayName: list.display_name,
    occasion: list.occasion,
    items: (payload.items || []).map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes || '',
      image: row.image || '',
      audio: row.audio || '',
      category: row.category || '',
      sort: row.sort ?? 0,
      reviewStatus: row.review_status || 'approved',
      addedBy: row.added_by || 'kid',
      catalogId: row.catalog_id || '',
      claimedAt: null,
      claimedByName: '',
    })),
  }
}

function pinKey(secret) {
  return `first-bell.kid-pin.${secret}`
}

export function pinBlocked(secret) {
  const row = readJson(pinKey(secret))
  if (!row?.start) return false
  if (Date.now() - row.start > PIN_WINDOW) return false
  return row.hits >= 5
}

export function notePinFail(secret) {
  const key = pinKey(secret)
  const now = Date.now()
  let row = readJson(key)
  if (!row?.start || now - row.start > PIN_WINDOW) row = { start: now, hits: 0 }
  row.hits += 1
  localStorage.setItem(key, JSON.stringify(row))
  return row.hits
}

export function clearPinFail(secret) {
  localStorage.removeItem(pinKey(secret))
}

export async function localPinOk(link, secret, pin) {
  if (!link || link.revokedAt || link.secret !== secret || !/^\d{4}$/.test(pin || '')) return false
  const hash = await sha256(`${secret}:${pin}`)
  return hash === link.pinHash
}

export function bumpLimit(key, limit, windowMs) {
  const now = Date.now()
  let row = readJson(key)
  if (!row?.start || now - row.start > windowMs) row = { start: now, hits: 0 }
  row.hits += 1
  localStorage.setItem(key, JSON.stringify(row))
  return row.hits <= limit
}

export function wishAllowed(secret) {
  return (
    bumpLimit(`first-bell.wish10.${secret}`, 8, WISH_WINDOW) &&
    bumpLimit(`first-bell.wishday.${secret}`, 40, DAY_WINDOW)
  )
}

export function speak(text) {
  const synth = window.speechSynthesis
  if (!synth || !text) return
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.rate = 0.92
  utterance.pitch = 1.05
  synth.speak(utterance)
}

export function chime() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return
  const ctx = new AudioCtx()
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const start = ctx.currentTime + index * 0.08
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.3)
  })
  window.setTimeout(() => ctx.close().catch(() => {}), 1200)
}

export function shrinkImage(file, maxChars = 390000) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 960
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      let quality = 0.72
      let data = canvas.toDataURL('image/jpeg', quality)
      while (data.length > maxChars && quality > 0.42) {
        quality -= 0.08
        data = canvas.toDataURL('image/jpeg', quality)
      }
      if (data.length > maxChars) reject(new Error('Picture is too big'))
      else resolve(data)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Picture is too big'))
    }
    img.src = url
  })
}

export function blobToDataUrl(blob, maxChars = 490000) {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size > 500000) {
      reject(new Error('Recording is too big'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      if (!text.startsWith('data:audio/') || text.length > maxChars) reject(new Error('Recording is too big'))
      else resolve(text)
    }
    reader.onerror = () => reject(new Error('Recording is too big'))
    reader.readAsDataURL(blob)
  })
}
