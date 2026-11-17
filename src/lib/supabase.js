import { createClient } from '@supabase/supabase-js'
import { readEmailLink, stripAuthCallbackParams } from './authLink.js'

const url = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const isSupabaseConfigured = Boolean(url && key && /^https?:\/\//i.test(url))

/** Read once, before the client consumes the URL. */
export const authCallback = readEmailLink(typeof window === 'undefined' ? 'http://localhost/' : window.location.href)

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // PKCE stays on for OAuth. Email links do not use it: the template sends
        // token_hash to /auth/confirm, and verifyOtp does not read a code verifier.
        flowType: 'pkce',
        storageKey: 'micasa-auth',
        storage: typeof window === 'undefined' ? undefined : window.localStorage,
      },
    })
  : null

export function clearAuthCallbackParams() {
  if (typeof window === 'undefined') return
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const next = stripAuthCallbackParams(window.location.href)
  if (next === current) return
  window.history.replaceState({}, '', next)
}
