import { Link } from 'react-router-dom'
import { PARTY } from '../data/seed.js'
import { countdownCopy } from '../lib/format.js'
import { useBell } from '../lib/store.jsx'

export default function Family() {
  const { state } = useBell()
  const guest = state.memberRole === 'guest'
  const giftGuest = state.memberRole === 'gift'
  const events = guest ? state.eventAccess || [] : null

  return (
    <div>
      <div className="kicker">Family & friends</div>
      <h1>Shared planning</h1>
      <p className="lede">
        {giftGuest
          ? 'You can manage the gift list you were invited to. The rest of the house stays with Andrew and Megan.'
          : guest
            ? 'You can see the events you were invited to, RSVP, and add to the bring list.'
            : 'Events and gift lists are for people outside the daily house. Invite them with a link. They only see what you invited them to.'}
      </p>

      {!giftGuest && (
        <Link to={guest ? `/parties/${PARTY.id}` : '/parties'} className="card pad family-card">
          <div className="kicker">Events</div>
          <h2>Parties and holidays</h2>
          <p className="muted">
            {guest
              ? (events || []).map((event) => event.label).join(', ') || 'Your invitation'
              : `${PARTY.headline}. ${countdownCopy(PARTY.date)}. Guests can RSVP and say what they will bring.`}
          </p>
          <span className="btn small primary">Open events</span>
        </Link>
      )}

      {!guest && (
        <Link to="/gifts" className="card pad family-card">
          <div className="kicker">Gift lists</div>
          <h2>Christmas lists and Secret Santa</h2>
          <p className="muted">
            Each person keeps their own list. A bought gift is hidden from the person it is for.
          </p>
          <span className="btn small primary">Open gift lists</span>
        </Link>
      )}

      {giftGuest && (
        <Link to="/gifts" className="card pad family-card">
          <div className="kicker">Your list</div>
          <h2>Manage your gifts</h2>
          <span className="btn small primary">Open my list</span>
        </Link>
      )}
    </div>
  )
}
