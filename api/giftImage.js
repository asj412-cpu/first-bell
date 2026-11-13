import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const CACHE_MS = 24 * 60 * 60 * 1000
const MISS_MS = 10 * 60 * 1000
const MAX_BYTES = 500_000
const HOP_TIMEOUT_MS = 4500
const MAX_HOPS = 3
const cache = new Map()

const IMAGE_KEYS = new Set(['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'])

export function assertPublicHttpUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value || '').trim())
  } catch {
    const error = new Error('Link must start with http:// or https://')
    error.status = 400
    throw error
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const error = new Error('Link must start with http:// or https://')
    error.status = 400
    throw error
  }
  if (parsed.username || parsed.password) {
    const error = new Error('That link is not allowed')
    error.status = 400
    throw error
  }
  const port = parsed.port
  if (port && port !== '80' && port !== '443') {
    const error = new Error('That link is not allowed')
    error.status = 400
    throw error
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    const error = new Error('That link is not allowed')
    error.status = 400
    throw error
  }
  if (isIP(host) && isPrivateAddress(host)) {
    const error = new Error('That link is not allowed')
    error.status = 400
    throw error
  }
  return parsed
}

export function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(mapped) === 4) {
    const parts = mapped.split('.').map((part) => Number(part))
    const [a, b] = parts
    if (parts.some((part) => Number.isNaN(part))) return true
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (isIP(ip) === 6) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')
  }
  return false
}

function metaContent(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(pattern)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

function resolveImage(value, base) {
  const raw = String(value || '').trim().replace(/&amp;/g, '&')
  if (!raw || raw.startsWith('data:')) return ''
  try {
    const absolute = new URL(raw, base)
    if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') return ''
    return absolute.href
  } catch {
    return ''
  }
}

export function extractPreviewImage(html, pageUrl) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const key = (metaContent(tag, 'property') || metaContent(tag, 'name')).toLowerCase()
    if (!IMAGE_KEYS.has(key)) continue
    const image = resolveImage(metaContent(tag, 'content'), pageUrl)
    if (image) return image
  }
  const blocks = String(html || '').match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []
  for (const block of blocks) {
    const json = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '')
    try {
      const found = []
      collectImages(JSON.parse(json), found)
      for (const value of found) {
        const image = resolveImage(value, pageUrl)
        if (image) return image
      }
    } catch {
      /* ignore a broken product block */
    }
  }
  return ''
}

function collectImages(node, found) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((entry) => collectImages(entry, found))
    return
  }
  const image = node.image
  if (typeof image === 'string') found.push(image)
  else if (Array.isArray(image)) {
    image.forEach((entry) => {
      if (typeof entry === 'string') found.push(entry)
      else if (entry && typeof entry.url === 'string') found.push(entry.url)
    })
  } else if (image && typeof image.url === 'string') found.push(image.url)
  if (node['@graph']) collectImages(node['@graph'], found)
}

async function assertResolvedHost(hostname) {
  const records = await lookup(hostname, { all: true, verbatim: true })
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    const error = new Error('That link is not allowed')
    error.status = 400
    throw error
  }
}

async function readLimited(response) {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    return text.slice(0, MAX_BYTES)
  }
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    chunks.push(value)
  }
  try {
    await reader.cancel()
  } catch {
    /* the extra bytes are not needed */
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, MAX_BYTES).toString('utf8')
}

async function fetchPage(target) {
  let current = target
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    await assertResolvedHost(current.hostname)
    const response = await fetch(current, {
      redirect: 'manual',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (compatible; MiCasaGiftPreview/1.0)',
      },
      signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
    })
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) return { finalUrl: current.href, html: '' }
      current = assertPublicHttpUrl(new URL(next, current).href)
      continue
    }
    if (!response.ok) return { finalUrl: current.href, html: '' }
    const type = response.headers.get('content-type') || ''
    if (type.startsWith('image/')) return { finalUrl: current.href, image: current.href, html: '' }
    const html = await readLimited(response)
    return { finalUrl: current.href, html }
  }
  return { finalUrl: current.href, html: '' }
}

export async function lookupGiftImage(pageUrl) {
  const target = assertPublicHttpUrl(pageUrl)
  const key = target.href
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.image
  let image = ''
  try {
    const page = await fetchPage(target)
    image = page.image || extractPreviewImage(page.html, page.finalUrl)
    if (image) assertPublicHttpUrl(image)
  } catch (error) {
    if (error.status === 400) throw error
    image = ''
  }
  if (cache.size > 200) cache.clear()
  cache.set(key, { image, expires: Date.now() + (image ? CACHE_MS : MISS_MS) })
  return image
}
