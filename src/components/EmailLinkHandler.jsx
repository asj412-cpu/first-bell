import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  friendlyLinkError,
  hasPendingEmailLink,
  heldEmailLink,
  holdEmailLink,
  readEmailLink,
} from '../lib/authLink.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

// Holds the token from an email link and moves to /auth/confirm, which asks the
// person to tap before anything is verified (see holdEmailLink).
export default function EmailLinkHandler() {
  const location = useLocation()
  const navigate = useNavigate()
  const { failEmailLink } = useBell()

  useEffect(() => {
    const href = window.location.href
    const onConfirm = location.pathname === '/auth/confirm'
    const parsed = readEmailLink(href)
    if (parsed.tokenHash) {
      if (!supabase) {
        failEmailLink('Email sign-in is not turned on in this copy of Mi Casa.')
        return
      }
      holdEmailLink(href)
      navigate(
        { pathname: '/auth/confirm', search: `?next=${encodeURIComponent(parsed.next || '/')}` },
        { replace: true },
      )
      return
    }
    if (onConfirm && !heldEmailLink() && !hasPendingEmailLink()) failEmailLink(friendlyLinkError(''))
  }, [location.pathname, location.search, navigate, failEmailLink])

  return null
}
