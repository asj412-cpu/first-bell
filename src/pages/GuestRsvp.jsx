import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BackendBanner from '../components/BackendBanner.jsx'
import { HOUSEHOLD, PARTY } from '../data/seed.js'
import { formatLongDate, formatTimeRange } from '../lib/format.js'
import { mapPartyRow } from '../lib/rsvps.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

export default function GuestRsvp() {
  const { slug } = useParams()
  const { addOrUpdateRsvp, state, ready, configured } = useBell()
  const seeded = slug === PARTY.slug
  const [party, setParty] = useState(() => (seeded ? PARTY : null))
  const [lookup, setLookup] = useState(seeded ? 'ready' : supabase ? 'loading' : 'missing')
  const [child, setChild] = useState('')
  const [parent, setParent] = useState('')
  const [status, setStatus] = useState('yes')
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (slug === PARTY.slug) {
      setParty(PARTY)
      setLookup('ready')
      return undefined
    }
    if (!supabase) {
      setLookup('missing')
      return undefined
    }
    setLookup('loading')
    supabase
      .from('parties')
      .select('*')
      .eq('slug', slug)
      .eq('is_public', true)
      .maybeSingle()
      .then(({ data, error: fetchErr }) => {
        if (cancelled) return
        if (fetchErr || !data) {
          setLookup('missing')
          return
        }
        setParty(mapPartyRow(data))
        setLookup('ready')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (lookup === 'loading') {
    return (
      <div className="gate">
        <div className="card gate-card">
          <div className="eyebrow">First Bell</div>
          <h1>Opening the invite…</h1>
          <p className="lede">One moment.</p>
        </div>
      </div>
    )
  }

  if (lookup === 'missing' || !party) {
    return (
      <div className="gate">
        <div className="card gate-card">
          <h1>Invite not found</h1>
          <p className="lede">This party link isn’t live.</p>
        </div>
      </div>
    )
  }

  const contact = party.contact || HOUSEHOLD.contact
  const venue = party.venue

  async function submit(e) {
    e.preventDefault()
    if (!child.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await addOrUpdateRsvp({ child, parent, status, slug: party.slug || slug })
      setDone({ child: child.trim(), status })
    } catch (err) {
      setError(err.message || 'Could not save RSVP. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="guest-page">
      <img
        className="cover"
        src={party.assets?.[0]?.src || '/invites/chloe-mario.jpg'}
        alt={party.headline}
      />
      <div className="card guest-sheet">
        <BackendBanner />
        <div className="kicker">You’re invited</div>
        <h1>{party.headline}</h1>
        <p className="lede">
          {formatLongDate(party.date)} · {formatTimeRange(party.start, party.end)}
        </p>
        <dl className="kv">
          <dt>Where</dt>
          <dd>
            {venue.name}
            <br />
            {venue.address}
          </dd>
          <dt>Theme</dt>
          <dd>{party.theme}</dd>
          <dt>RSVP</dt>
          <dd>
            {contact.name} · {contact.phone}
            <br />
            {contact.email}
          </dd>
        </dl>

        {done ? (
          <div className="thanks">
            <h2 style={{ marginBottom: 8 }}>Got it — {done.child} is {label(done.status)}.</h2>
            <p className="muted">If plans change, submit again with the same first name.</p>
            {state.backend === 'live' && (
              <p className="dim">Saved to the household board — the host sees this on every device.</p>
            )}
            {party.registry?.url && (
              <a className="btn primary" style={{ marginTop: 12 }} href={party.registry.url} target="_blank" rel="noreferrer">
                Amazon registry
              </a>
            )}
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
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary full" type="submit" disabled={busy || (configured && !ready)}>
              {busy ? 'Sending…' : 'Send RSVP'}
            </button>
          </form>
        )}

        <div className="section-head" style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 18 }}>Registry</h2>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Gifts are optional. If you want a list:{' '}
          {party.registry?.url ? (
            <a href={party.registry.url} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
              Amazon guest view
            </a>
          ) : (
            'ask the host'
          )}
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
