import { Navigate, useSearchParams } from 'react-router-dom'
import { safeNextPath } from '../lib/authLink.js'
import { useBell } from '../lib/store.jsx'

export default function AuthConfirm() {
  const { state } = useBell()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))

  if (state.authLinkFailed && !state.session) return <Navigate to="/enter" replace />
  if (state.session) return <Navigate to={next} replace />

  return (
    <div className="gate">
      <div className="gate-bg" aria-hidden="true" />
      <div className="card gate-card">
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="eyebrow">Mi Casa</div>
        <h1>Signing you in…</h1>
        <p className="lede">Checking the link from your email.</p>
      </div>
    </div>
  )
}
