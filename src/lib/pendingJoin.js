// Remembers the family link someone opened, so if they end up signing in from
// the main sign-in screen (new tab, link from the email, typed the site name),
// they are sent back to "Who are you on the list?" instead of a dead end.
const KEY = 'micasa-pending-join'
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/

function store(storage) {
  if (storage) return storage
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

export function rememberJoin(token, storage, now = Date.now()) {
  const s = store(storage)
  if (!s || !TOKEN_RE.test(String(token || ''))) return
  try {
    s.setItem(KEY, JSON.stringify({ token, at: now }))
  } catch {
    // private mode: nothing to remember
  }
}

export function pendingJoin(storage, now = Date.now()) {
  const s = store(storage)
  if (!s) return null
  try {
    const saved = JSON.parse(s.getItem(KEY) || 'null')
    if (!saved || !TOKEN_RE.test(String(saved.token || ''))) return null
    if (!(now - Number(saved.at) < MAX_AGE_MS)) return null
    return saved.token
  } catch {
    return null
  }
}

export function clearJoin(storage) {
  const s = store(storage)
  try {
    s?.removeItem(KEY)
  } catch {
    // ignore
  }
}
