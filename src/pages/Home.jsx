import { Link } from 'react-router-dom'
import { EVENTS, PARTY } from '../data/seed.js'
import { countdownCopy, formatLongDate, formatTimeRange, greeting, todayLabel } from '../lib/format.js'
import { useBell } from '../lib/store.jsx'
import { IconArrow } from '../components/Icons.jsx'

export default function Home() {
  const { state } = useBell()
  const openRsvps = state.guests.filter((g) => g.status === 'none').length
  const inboxN = state.messages.filter((m) => m.folder === 'inbox' && m.attention).length
  const next = [...EVENTS].sort((a, b) => a.date.localeCompare(b.date))[0]

  return (
    <div>
      <div className="kicker">{todayLabel()}</div>
      <h1>
        {greeting()}, Andrew
      </h1>
      <p className="lede">Household ops at a glance. Chloe’s party is the live event.</p>

      <Link to={`/parties/${PARTY.id}`} className="card hero-party">
        <img className="cover" src="/invites/chloe-mario.jpg" alt="" />
        <div className="body">
          <div className="kicker">Upcoming party · {countdownCopy(PARTY.date)}</div>
          <h2>{PARTY.headline}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {formatLongDate(PARTY.date)} · {formatTimeRange(PARTY.start, PARTY.end)}
          </p>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {PARTY.venue.name} · {PARTY.venue.campus}
          </p>
          <div className="meta-row">
            <span className="chip gold">{PARTY.venue.package} · paid</span>
            <span className="chip yes">Leila · Yes</span>
            <span className="chip wait">{openRsvps} waiting</span>
          </div>
          <div className="row-between">
            <span className="dim">Open the party desk</span>
            <IconArrow style={{ width: 18, height: 18, color: 'var(--gold)' }} />
          </div>
        </div>
      </Link>

      <div className="stats" style={{ marginTop: 14 }}>
        <Link to="/parties" className="card pad stat">
          <div className="kicker">Parties</div>
          <div className="num">1</div>
          <div className="lbl">Live this fall</div>
        </Link>
        <Link to={`/parties/${PARTY.id}`} className="card pad stat">
          <div className="kicker">Open RSVPs</div>
          <div className="num">{openRsvps}</div>
          <div className="lbl">No response yet</div>
        </Link>
        <Link to="/inbox" className="card pad stat">
          <div className="kicker">Inbox</div>
          <div className="num">{inboxN}</div>
          <div className="lbl">Need the agent</div>
        </Link>
        <Link to="/calendar" className="card pad stat">
          <div className="kicker">Next up</div>
          <div className="num" style={{ fontSize: 18, paddingTop: 6 }}>
            Oct 10
          </div>
          <div className="lbl">{next.title}</div>
        </Link>
      </div>

      <div className="section-head">
        <h2>Needs attention</h2>
      </div>
      <div className="attention">
        <Link to={`/parties/${PARTY.id}`}>
          <span className="dot rose" />
          <div>
            <strong>{openRsvps} families still haven’t RSVP’d</strong>
            <div className="dim">Leila is in as Yes. Nudge the rest from the board.</div>
          </div>
        </Link>
        <Link to="/inbox">
          <span className="dot teal" />
          <div>
            <strong>{inboxN} notes waiting to be filed</strong>
            <div className="dim">COO / agent files Bills, Shopping, and School. You confirm.</div>
          </div>
        </Link>
        <Link to="/calendar">
          <span className="dot" />
          <div>
            <strong>Next calendar item: {next.title}</strong>
            <div className="dim">{formatLongDate(next.date)} · Family sync is next.</div>
          </div>
        </Link>
      </div>
    </div>
  )
}
