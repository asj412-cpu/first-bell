// "Put it back" shows on a taken gift for whoever marked it, and for Andrew
// (household admin). The database enforces the same rule.
export function canPutBack(item, { admin = false } = {}) {
  if (!item || !(item.purchased || item.claimedAt)) return false
  return Boolean(item.markedByMe || admin)
}

// Put the database's purchase fields onto the items a screen already has.
export function overlayMarks(items, remoteList) {
  if (!remoteList || remoteList.purchasesVisible === false) return items
  const byId = new Map((remoteList.items || []).map((item) => [item.id, item]))
  return items.map((item) => {
    const remote = byId.get(item.id)
    if (!remote) return item
    return {
      ...item,
      purchased: remote.purchased,
      claimedByName: remote.claimedByName,
      claimedAt: remote.claimedAt,
      markedByMe: remote.markedByMe,
    }
  })
}
