import { Navigate } from 'react-router-dom'
import { useBell } from '../lib/store.jsx'

export default function Gate() {
  const { entered, enterDemo } = useBell()
  if (entered) return <Navigate to="/" replace />

  return (
    <div className="gate">
      <div className="gate-bg" aria-hidden="true" />
      <div className="card gate-card">
        <img className="bell" src="/brand/bell.jpg" alt="" />
        <div className="eyebrow">First Bell</div>
        <h1>The house, handled.</h1>
        <p className="lede">
          Parties, inbox, calendar. Party planning is the wedge — the product is household ops for parents.
        </p>
        <button className="btn primary full" onClick={enterDemo}>
          Enter Johnson household
        </button>
        <p className="gate-note">Demo mode · no password · stays in this browser</p>
      </div>
    </div>
  )
}
