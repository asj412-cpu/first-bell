export const IDLE_MS = 5 * 60 * 1000

export function shouldLock({ lastActivity, now, hidden }) {
  if (hidden) return true
  if (lastActivity == null || now == null) return false
  return now - lastActivity >= IDLE_MS
}
