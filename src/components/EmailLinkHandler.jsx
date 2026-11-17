import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  friendlyLinkError,
  hasPendingEmailLink,
  readEmailLink,
  startEmailLinkConfirmation,
} from '../lib/authLink.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

export default function EmailLinkHandler() {
  const location = useLocation()
  const navigate = useNavigate()
  const { markEmailLinkWorking, failEmailLink, finishEmailLink } = useBell()

  useEffect(() => {
    const href = window.location.href
    const onConfirm = location.pathname === '/auth/confirm'
    const parsed = readEmailLink(href)
    if (!onConfirm && !parsed.tokenHash && !hasPendingEmailLink()) return
    if (!supabase) {
      failEmailLink('Email sign-in is not turned on in this copy of Mi Casa.')
      return
    }

    const confirmation = startEmailLinkConfirmation(href, supabase)
    if (!confirmation || confirmation.settled) {
      if (onConfirm && !confirmation) failEmailLink(friendlyLinkError(''))
      return
    }

    markEmailLinkWorking()
    if (parsed.tokenHash) {
      navigate(
        {
          pathname: '/auth/confirm',
          search: `?next=${encodeURIComponent(confirmation.link.next || '/')}`,
        },
        { replace: true },
      )
    }

    let active = true
    confirmation.promise.then((result) => {
      confirmation.settled = true
      if (!active) return
      if (result?.error) failEmailLink(friendlyLinkError(result.error.message))
      else finishEmailLink()
    })
    return () => {
      active = false
    }
  }, [location.pathname, location.search, navigate, markEmailLinkWorking, failEmailLink, finishEmailLink])

  return null
}
