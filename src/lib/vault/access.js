/** Demo sign-in is the parent host. Live access is the owner plus vault_parents rows. */
export function canUseVault({ demo = false, memberRole = null, vaultParent = false } = {}) {
  if (demo) return true
  if (memberRole === 'owner') return true
  return Boolean(vaultParent)
}
