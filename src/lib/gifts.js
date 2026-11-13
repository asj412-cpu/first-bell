import christmasSeed from '../data/christmas-2026-seed.json'
import { isStarterItem } from './exchange.js'

export function cloneGiftLists(seed = christmasSeed) {
  return seed.lists.map(cloneList)
}

function cloneList(list) {
  return {
    id: list.id,
    kidKey: list.kidKey,
    displayName: list.displayName,
    occasion: list.occasion,
    shareSlug: list.shareSlug,
    listKind: list.listKind || 'wish',
    items: (list.items || []).map(cloneItem),
  }
}

function cloneItem(item) {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes || '',
    url: item.url || '',
    urlSecondary: item.urlSecondary || '',
    image: item.image || '',
    availability: item.availability || '',
    category: item.category || '',
    priceLabel: item.priceLabel || '',
    retailer: item.retailer || '',
    ageFit: item.ageFit || '',
    dollSize: item.dollSize || '',
    sourceSlug: item.sourceSlug || '',
    sort: item.sort ?? 0,
    claimedByName: item.claimedByName || '',
    claimedAt: item.claimedAt || null,
  }
}

export function findListBySlug(lists, slug) {
  return (lists || []).find((list) => list.shareSlug === slug) || null
}

export function safeHttp(url) {
  const value = (url || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href
  } catch {
    return ''
  }
  return ''
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')
}

export function listUsesLocalCatalog(list) {
  return (list?.items || []).some((item) => item.sourceSlug && !isUuid(item.id))
}

function sameList(remote, seed) {
  return remote.kidKey === seed.kidKey || remote.shareSlug === seed.shareSlug
}

function withoutStarters(list) {
  return (list?.items || []).filter((item) => !isStarterItem(item) && item.title && item.title !== 'New wish')
}

export function mergeGiftLists(saved, bundled = cloneGiftLists()) {
  if (!Array.isArray(saved) || saved.length === 0) return bundled
  const seen = new Set()
  const merged = bundled.map((seed) => {
    const prev = saved.find((list) => sameList(list, seed))
    if (!prev) return seed
    seen.add(prev.id)
    const custom = withoutStarters(prev)
    const remoteHasCatalog = custom.some((item) => item.sourceSlug || item.priceLabel)
    if (remoteHasCatalog && custom.length) {
      return { ...seed, ...prev, items: prev.items.map(cloneItem) }
    }
    const extras = custom.filter((item) => !seed.items.some((row) => row.title === item.title || row.id === item.id))
    return {
      ...seed,
      id: prev.id || seed.id,
      shareSlug: prev.shareSlug || seed.shareSlug,
      displayName: prev.displayName || seed.displayName,
      items: [
        ...seed.items,
        ...extras.map((item, index) => cloneItem({ ...item, sort: seed.items.length + index })),
      ],
    }
  })
  for (const prev of saved) {
    if (!seen.has(prev.id) && !bundled.some((seed) => sameList(prev, seed))) merged.push(cloneList(prev))
  }
  return merged
}

export function presentItems(list, { conceal = false } = {}) {
  const items = [...(list?.items || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  if (!conceal) return items
  return items.map((item) => ({ ...item, claimedByName: '', claimedAt: null, purchased: false }))
}

export function visibleItems(list, kidMode) {
  return presentItems(list, { conceal: Boolean(kidMode) })
}

export function fromDbList(row, items) {
  return {
    id: row.id,
    kidKey: row.kid_key,
    displayName: row.display_name,
    occasion: row.occasion,
    shareSlug: row.share_slug,
    listKind: row.list_kind || 'wish',
    items: (items || [])
      .filter((item) => item.list_id === row.id)
      .map(fromDbItem)
      .sort((a, b) => a.sort - b.sort),
  }
}

export function fromDbItem(row) {
  const purchased = Boolean(row.purchased || row.claimed_at)
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || '',
    url: row.url || '',
    urlSecondary: row.url_secondary || '',
    image: row.image || '',
    availability: row.availability || '',
    category: row.category || '',
    priceLabel: row.price_label || '',
    retailer: row.retailer || '',
    ageFit: row.age_fit || '',
    dollSize: row.doll_size || '',
    sourceSlug: row.source_slug || '',
    sort: row.sort ?? 0,
    claimedByName: row.claimed_by_name || '',
    claimedAt: row.claimed_at || null,
    purchased,
  }
}

export function publicPayloadToList(payload) {
  if (!payload?.list) return null
  const list = payload.list
  return {
    id: list.id,
    kidKey: list.kid_key,
    displayName: list.display_name,
    occasion: list.occasion,
    shareSlug: list.share_slug,
    listKind: list.list_kind || 'wish',
    purchasesVisible: payload.purchases_visible !== false,
    items: (payload.items || []).map(fromDbItem),
  }
}

export function wishLists(lists) {
  return (lists || []).filter((list) => (list.listKind || 'wish') === 'wish')
}

export function exchangeLists(lists) {
  return (lists || []).filter((list) => list.listKind === 'exchange')
}
