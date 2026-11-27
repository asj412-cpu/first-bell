import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { friendlyLinkError, heldEmailLink, releaseHeldEmailLink, safeNextPath } from '../lib/authLink.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

export default function AuthConfirm() {
  const { state, markEmailLinkWorking, failEmailLink, finishEmailLink } = useBell()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [working, setWorking] = useState(false)

  if (state.authLinkFailed && !state.session) return <Navigate to="/enter" replace />
  if (state.session) return <Navigate to={next} replace />

  const waitingForTap = Boolean(heldEmailLink()) && !working

  async function finish() {
    setWorking(true)
    markEmailLinkWorking()
    const started = releaseHeldEmailLink(supabase)
    if (!started) {
      failEmailLink(friendlyLinkError(''))
      return
    }
    const result = await started.promise
    started.settled = true
    if (result?.error) failEmailLink(friendlyLinkError(result.error.message))
    else finishEmailLink()
  }

  return (
    <div className="gate">
      <div className="gate-bg" aria-hidden="true" />
      <div className="card gate-card">
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="eyebrow">Mi Casa</div>
        {waitingForTap ? (
          <>
            <h1>One tap to finish</h1>
            <p className="lede">Tap the button to finish signing in.</p>
            <button className="btn primary big full" type="button" onClick={finish}>
              Finish signing in
            </button>
          </>
        ) : (
          <>
            <h1>Signing you in…</h1>
            <p className="lede">Checking the link from your email.</p>
          </>
        )}
      </div>
    </div>
  )
}
