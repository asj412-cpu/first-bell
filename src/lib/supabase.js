import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const isSupabaseConfigured = Boolean(url && key && /^https?:\/\//i.test(url))

/** Read once, before the client consumes the URL. */
export const authCallback = readAuthCallback()

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

function readAuthCallback() {
  if (typeof window === 'undefined') {
    return { hasCode: false, errorDescription: '', errorCode: '' }
  }
  const current = new URL(window.location.href)
  const hash = new URLSearchParams(current.hash.startsWith('#') ? current.hash.slice(1) : '')
  return {
    hasCode: current.searchParams.has('code'),
    errorDescription: current.searchParams.get('error_description') || hash.get('error_description') || '',
    errorCode: current.searchParams.get('error_code') || hash.get('error_code') || '',
  }
}

export function clearAuthCallbackParams() {
  if (typeof window === 'undefined') return
  const current = new URL(window.location.href)
  let changed = false
  for (const key of ['code', 'error', 'error_code', 'error_description']) {
    if (current.searchParams.has(key)) {
      current.searchParams.delete(key)
      changed = true
    }
  }
  if (current.hash && /(error|access_token|refresh_token|type)=/.test(current.hash)) {
    current.hash = ''
    changed = true
  }
  if (!changed) return
  const next = `${current.pathname}${current.search}${current.hash}`
  window.history.replaceState({}, '', next)
}
