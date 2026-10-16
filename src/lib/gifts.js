import christmasSeed from '../data/christmas-2026-seed.json'

export function cloneGiftLists(seed = christmasSeed) {
  return seed.lists.map((list) => ({
    id: list.id,
    kidKey: list.kidKey,
    displayName: list.displayName,
    occasion: list.occasion,
    shareSlug: list.shareSlug,
    items: list.items.map((item) => ({
      id: item.id,
      title: item.title,
      notes: item.notes || '',
      url: item.url || '',
      urlSecondary: item.urlSecondary || '',
      image: item.image || '',
      availability: item.availability || '',
      sort: item.sort ?? 0,
      claimedByName: item.claimedByName || '',
      claimedAt: item.claimedAt || null,
      reviewStatus: item.reviewStatus || 'approved',
      addedBy: item.addedBy || 'parent',
      category: item.category || '',
      audio: item.audio || '',
    })),
  }))
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

export function visibleItems(list, kidMode) {
  const items = [...(list?.items || [])]
    .filter((item) => item.reviewStatus !== 'pending')
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  if (!kidMode) return items
  return items.filter((item) => !item.claimedAt)
}

export function fromDbList(row, items) {
  return {
    id: row.id,
    kidKey: row.kid_key,
    displayName: row.display_name,
    occasion: row.occasion,
    shareSlug: row.share_slug,
    items: (items || [])
      .filter((item) => item.list_id === row.id)
      .map(fromDbItem)
      .sort((a, b) => a.sort - b.sort),
  }
}

export function fromDbItem(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || '',
    url: row.url || '',
    urlSecondary: row.url_secondary || '',
    image: row.image || '',
    availability: row.availability || '',
    sort: row.sort ?? 0,
    claimedByName: row.claimed_by_name || '',
    claimedAt: row.claimed_at || null,
    reviewStatus: row.review_status || 'approved',
    addedBy: row.added_by || 'parent',
    category: row.category || '',
    audio: row.audio || '',
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
    items: (payload.items || []).map(fromDbItem),
  }
}
