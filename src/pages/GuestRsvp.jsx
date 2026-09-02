import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HOUSEHOLD, PARTY } from '../data/seed.js'
import { formatLongDate, formatTimeRange } from '../lib/format.js'
import { useBell } from '../lib/store.jsx'

export default function GuestRsvp() {
  const { slug } = useParams()
  const { addOrUpdateRsvp, state } = useBell()
  const [child, setChild] = useState('')
  const [parent, setParent] = useState('')
  const [status, setStatus] = useState('yes')
  const [done, setDone] = useState(null)

  if (slug !== PARTY.slug) {
    return (
      <div className="gate">
        <div className="card gate-card">
          <h1>Invite not found</h1>
          <p className="lede">This party link isn’t live.</p>
        </div>
      </div>
    )
  }

  function submit(e) {
    e.preventDefault()
    if (!child.trim()) return
    addOrUpdateRsvp({ child, parent, status })
    setDone({ child: child.trim(), status })
  }

  return (
    <div className="guest-page">
      <img className="cover" src="/invites/chloe-mario.jpg" alt="Princess Chloe is turning 5!" />
      <div className="card guest-sheet">
        <div className="kicker">You’re invited</div>
        <h1>{PARTY.headline}</h1>
        <p className="lede">
          {formatLongDate(PARTY.date)} · {formatTimeRange(PARTY.start, PARTY.end)}
        </p>
        <dl className="kv">
          <dt>Where</dt>
          <dd>
            {PARTY.venue.name}
            <br />
            {PARTY.venue.address}
          </dd>
          <dt>Theme</dt>
          <dd>{PARTY.theme}</dd>
          <dt>RSVP</dt>
          <dd>
            {HOUSEHOLD.contact.name} · {HOUSEHOLD.contact.phone}
            <br />
            {HOUSEHOLD.contact.email}
          </dd>
        </dl>

        {done ? (
          <div className="thanks">
            <h2 style={{ marginBottom: 8 }}>Got it — {done.child} is {label(done.status)}.</h2>
            <p className="muted">If plans change, submit again with the same first name.</p>
            <a className="btn primary" style={{ marginTop: 12 }} href={PARTY.registry.url} target="_blank" rel="noreferrer">
              Amazon registry
            </a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="child">Kid’s first name</label>
              <input id="child" value={child} onChange={(e) => setChild(e.target.value)} placeholder="Leila" required />
            </div>
            <div className="field">
              <label htmlFor="parent">Parent name</label>
              <input id="parent" value={parent} onChange={(e) => setParent(e.target.value)} placeholder="Leila's Mom" />
            </div>
            <div className="kicker" style={{ marginTop: 4 }}>Can you come?</div>
            <div className="rsvp-choices">
              {[
                { id: 'yes', label: 'Yes' },
                { id: 'maybe', label: 'Maybe' },
                { id: 'no', label: 'No' },
              ].map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`${s.id} ${status === s.id ? `on ${s.id}` : ''}`}
                  onClick={() => setStatus(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button className="btn primary full" type="submit">
              Send RSVP
            </button>
          </form>
        )}

        <div className="section-head" style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 18 }}>Registry</h2>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Gifts are optional. If you want a list:{' '}
          <a href={PARTY.registry.url} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
            Amazon guest view
          </a>
          .
        </p>
        {state.session && (
          <p className="dim">
            Host? <Link to={`/parties/${PARTY.id}`} style={{ color: 'var(--gold)' }}>Back to the party desk</Link>
          </p>
        )}
      </div>
    </div>
  )
}

function label(status) {
  if (status === 'yes') return 'a Yes'
  if (status === 'no') return 'a No'
  return 'a Maybe'
}
