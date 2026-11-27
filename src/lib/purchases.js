// "Put it back" shows on a taken gift for whoever marked it, and for Andrew
// (household admin). The database enforces the same rule.
export function canPutBack(item, { admin = false } = {}) {
  if (!item || !(item.purchased || item.claimedAt)) return false
  return Boolean(item.markedByMe || admin)
}
