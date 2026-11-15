import { Link } from 'react-router-dom'
import { PARTY } from '../data/seed.js'
import { countdownCopy, formatLongDate, formatTimeRange } from '../lib/format.js'
import { useBell } from '../lib/store.jsx'

export default function Parties() {
  const { state } = useBell()
  const yes = state.guests.filter((g) => g.status === 'yes').length
  const waiting = state.guests.filter((g) => g.status === 'none').length

  return (
    <div>
      <div className="kicker">Parties</div>
      <h1>The desk</h1>
      <p className="lede">Party planning is the wedge. One live event is seeded — Chloe’s fifth.</p>

      <Link to={`/parties/${PARTY.id}`} className="card hero-party" style={{ marginTop: 18 }}>
        <img className="cover" src="/invites/chloe-mario.jpg" alt="" />
        <div className="body">
          <div className="kicker">{countdownCopy(PARTY.date)} · {PARTY.theme}</div>
          <h2>{PARTY.headline}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {formatLongDate(PARTY.date)} · {formatTimeRange(PARTY.start, PARTY.end)}
          </p>
          <p className="muted" style={{ margin: '4px 0 10px' }}>
            {PARTY.venue.name}, {PARTY.venue.address}
          </p>
          <div className="meta-row">
            <span className="chip gold">{PARTY.venue.package} · {PARTY.venue.status}</span>
            <span className="chip yes">{yes} yes</span>
            <span className="chip wait">{waiting} no response</span>
          </div>
        </div>
      </Link>

      <div className="card pad empty" style={{ marginTop: 14 }}>
        <div className="kicker">Next event</div>
        <h3 style={{ marginTop: 6 }}>Plan the next one from the calendar.</h3>
        <p className="muted">Birthdays and holidays already on the calendar can become an event. Guest invites use the same link you send for gift lists.</p>
        <Link className="btn small primary" to="/calendar">Open the calendar</Link>
      </div>
    </div>
  )
}
