import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import ShareLink from '../components/ShareLink.jsx'
import { HOUSEHOLD, PARTY } from '../data/seed.js'
import { formatLongDate, formatTimeRange } from '../lib/format.js'
import { downloadIcs, partyIcs } from '../lib/ics.js'
import { inviteCopy, inviteUrl, rpcMissing } from '../lib/invites.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'
import { IconBack, IconLink } from '../components/Icons.jsx'

const STATUSES = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
  { id: 'maybe', label: 'Maybe' },
  { id: 'none', label: 'No response' },
]

export default function PartyDetail() {
  const { id } = useParams()
  const { state, setRsvp, notify, createFamilyInvite, addContribution, setContribution } = useBell()
  const [copied, setCopied] = useState('')
  const [invite, setInvite] = useState(null)
  const [inviteError, setInviteError] = useState('')
  const [inviting, setInviting] = useState(false)
  const [bring, setBring] = useState('')
  const [help, setHelp] = useState('')
  const [shareNote, setShareNote] = useState('')
  const guest = state.memberRole === 'guest'

  const counts = useMemo(() => {
    const c = { yes: 0, no: 0, maybe: 0, none: 0 }
    state.guests.forEach((g) => {
      c[g.status] = (c[g.status] || 0) + 1
    })
    return c
  }, [state.guests])

  if (id !== PARTY.id) return <Navigate to="/parties" replace />

  const guestLink = `${window.location.origin}/r/${PARTY.slug}`

  function copy(text, key) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key)
      notify('Link copied')
      setTimeout(() => setCopied(''), 1600)
    }).catch(() => notify('Select the link and copy it'))
  }

  async function inviteGuest() {
    setInviteError('')
    setInviting(true)
    try {
      const created = await createFamilyInvite({
        kind: 'event',
        partySlug: PARTY.slug,
        label: PARTY.headline,
      })
      setInvite(created)
      notify('Invite ready. Send the link from this phone.')
    } catch (err) {
      setInvite(null)
      setInviteError(
        rpcMissing(err)
          ? 'Personal event invites need the new database update. It is in the pull request and is not applied yet. You can still copy the public RSVP link below.'
          : err.message || 'Could not create an invite.',
      )
    } finally {
      setInviting(false)
    }
  }

  async function addBoardItem(kind, title, clear) {
    const row = addContribution(PARTY.id, kind, title)
    if (!row) return
    clear('')
    if (!supabase || state.backend !== 'live') return
    const { error } = await supabase.rpc('add_event_contribution', {
      p_slug: PARTY.slug,
      p_kind: kind,
      p_title: title.trim(),
    })
    if (error && rpcMissing(error)) {
      setShareNote('The shared bring list starts after the database update. Until then it stays on this phone.')
    } else if (error) {
      notify(error.message)
    }
  }

  const board = (state.contributions || []).filter((row) => row.partyId === PARTY.id)
  const share = invite ? inviteCopy('event', invite.label || PARTY.headline) : null

  return (
    <div>
      <Link to="/parties" className="back-link">
        <IconBack /> Parties
      </Link>
      <div className="kicker">{PARTY.theme}</div>
      <h1>{PARTY.headline}</h1>
      <p className="lede">Birthday is Tuesday, October 13 · party is the Saturday before.</p>

      <div className="card invite-hero" style={{ marginTop: 16 }}>
        <img src="/invites/chloe-mario.jpg" alt="Princess Chloe is turning 5 invite" />
        <div className="detail-block">
          <div className="meta-row">
            <span className="chip gold">{PARTY.venue.package} · paid</span>
            <span className="chip teal">Kuykendahl SNAP</span>
          </div>
          <dl className="kv">
            <dt>When</dt>
            <dd>
              {formatLongDate(PARTY.date)}
              <br />
              {formatTimeRange(PARTY.start, PARTY.end)}
            </dd>
            <dt>Where</dt>
            <dd>
              {PARTY.venue.name}
              <br />
              {PARTY.venue.address}
            </dd>
            <dt>Package</dt>
            <dd>{PARTY.venue.packageDetail}</dd>
            <dt>Host</dt>
            <dd>
              {HOUSEHOLD.contact.name} · {HOUSEHOLD.contact.phone}
              <br />
              {HOUSEHOLD.contact.email}
            </dd>
          </dl>
          <p className="dim">{PARTY.venue.notes}</p>
          <div className="meta-row" style={{ marginTop: 12 }}>
            <button
              className="btn small"
              onClick={() => downloadIcs('chloe-turns-5.ics', partyIcs({ ...PARTY, contactPhone: HOUSEHOLD.contact.phone }))}
            >
              Add to calendar
            </button>
            <a className="btn small ghost" href={`https://maps.google.com/?q=${encodeURIComponent(PARTY.venue.address)}`} target="_blank" rel="noreferrer">
              Map
            </a>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>RSVP board</h2>
        <span className="dim">
          {state.guests.length} invited
          {state.backend === 'live' ? ' · live' : ''}
        </span>
      </div>
      <div className="rsvp-summary">
        {STATUSES.map((s) => (
          <div className="cell" key={s.id}>
            <span className="n" style={{ color: s.id === 'yes' ? 'var(--yes)' : s.id === 'no' ? 'var(--no)' : s.id === 'maybe' ? 'var(--maybe)' : 'var(--gold)' }}>
              {counts[s.id]}
            </span>
            <span className="dim">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="rsvp-board">
        {STATUSES.map((col) => (
          <div className="col" key={col.id}>
            <h3>{col.label}</h3>
            {state.guests.filter((g) => g.status === col.id).length === 0 && (
              <div className="dim">None yet</div>
            )}
            {state.guests
              .filter((g) => g.status === col.id)
              .map((g) => (
                <div className="guest" key={g.id}>
                  <strong>{g.child}</strong>
                  <span>{g.parent}{g.note ? ` · ${g.note}` : ''}</span>
                  {!guest && (
                    <div className="status-row">
                      {STATUSES.map((s) => (
                        <button
                          key={s.id}
                          className={`status ${g.status === s.id ? `on-${s.id}` : ''}`}
                          onClick={() => {
                            setRsvp(g.id, s.id).then(() => notify(`${g.child} marked ${s.label}`)).catch((err) => notify(err.message || 'Could not update the RSVP'))
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>

      {!guest && (
        <>
          <div className="section-head">
            <h2>Invite a guest</h2>
          </div>
          <div className="card pad invite-card">
            <p className="muted" style={{ marginTop: 0 }}>
              Creates a one-time link. They sign in, RSVP, and can add to the bring list. Mi Casa does not text or email them.
            </p>
            <button className="btn primary" type="button" onClick={inviteGuest} disabled={inviting}>
              {inviting ? 'Creating invite…' : 'Invite'}
            </button>
            {inviteError && <p className="form-error" role="alert">{inviteError}</p>}
            {invite && share && (
              <ShareLink url={inviteUrl(invite.token)} subject={share.subject} text={share.text} onDone={notify} />
            )}
          </div>
        </>
      )}

      <div className="section-head">
        <h2>Bring list and tasks</h2>
      </div>
      <div className="card pad">
        {shareNote && <p className="dim">{shareNote}</p>}
        {board.length === 0 && <p className="muted">Nothing to bring yet. Add a dish, a game, or a job.</p>}
        <ul className="chore-list">
          {board.map((row) => (
            <li key={row.id}>
              <label>
                <input
                  type="checkbox"
                  checked={row.done}
                  onChange={() => {
                    const done = !row.done
                    const ownerName = done ? (state.session?.name || 'Me') : ''
                    setContribution(row.id, { done, ownerName })
                    if (row.remoteId && supabase) {
                      supabase.rpc('set_event_contribution', { p_id: row.remoteId, p_owner: ownerName, p_done: done }).then(() => {}, () => {})
                    }
                  }}
                />
                <span className={row.done ? 'done' : ''}>
                  {row.title}
                  <em> · {row.kind === 'bring' ? 'Bring' : 'Task'}{row.ownerName ? ` · ${row.ownerName}` : ''}</em>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <form
          className="chore-add"
          onSubmit={(event) => {
            event.preventDefault()
            addBoardItem('bring', bring, setBring)
          }}
        >
          <label className="field">
            <span className="sr">Something to bring</span>
            <input value={bring} onChange={(event) => setBring(event.target.value)} placeholder="Something to bring" />
          </label>
          <button className="btn small primary" type="submit">Add</button>
        </form>
        <form
          className="chore-add"
          onSubmit={(event) => {
            event.preventDefault()
            addBoardItem('task', help, setHelp)
          }}
        >
          <label className="field">
            <span className="sr">A job for the party</span>
            <input value={help} onChange={(event) => setHelp(event.target.value)} placeholder="A job for the party" />
          </label>
          <button className="btn small" type="submit">Add task</button>
        </form>
      </div>

      <div className="section-head">
        <h2>Registry</h2>
      </div>
      <div className="card pad">
        <div className="kicker">Amazon</div>
        <h3 style={{ margin: '6px 0 8px' }}>Chloe’s birthday list</h3>
        <p className="muted">Guest view. Families who ask “what should we bring?” get this link — not a group text thread.</p>
        <div className="meta-row">
          <a className="btn small primary" href={PARTY.registry.url} target="_blank" rel="noreferrer">
            Open Amazon registry
          </a>
          <button className="btn small" onClick={() => copy(PARTY.registry.url, 'reg')}>
            <IconLink style={{ width: 16, height: 16 }} /> Copy link
          </button>
          {copied === 'reg' && <span className="copy-ok">Copied</span>}
        </div>
      </div>

      <div className="section-head">
        <h2>Invite assets</h2>
      </div>
      <div className="card pad" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Guest RSVP page: <code>/r/{PARTY.slug}</code>
        </p>
        <div className="meta-row">
          <Link className="btn small primary" to={`/r/${PARTY.slug}`}>
            Open guest page
          </Link>
          <button className="btn small" onClick={() => copy(guestLink, 'rsvp')}>
            Copy guest link
          </button>
          {copied === 'rsvp' && <span className="copy-ok">Copied</span>}
        </div>
      </div>
      <div className="asset-grid">
        {PARTY.assets.map((a) => (
          <div className="card asset" key={a.id}>
            <img src={a.src} alt={a.title} />
            <div className="pad">
              <strong>{a.title}</strong>
              <p className="dim" style={{ margin: '4px 0 10px' }}>{a.caption}</p>
              <a className="btn small" href={a.download} download>
                Download PNG
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
