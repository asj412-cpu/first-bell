import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconBack } from '../components/Icons.jsx'
import { ideaCount } from '../lib/exchange.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

function peopleOf(group, participants) {
  return participants.filter((person) => person.groupId === group.id)
}

export default function SecretSanta() {
  const {
    state,
    drawSanta,
    lockSanta,
    setInDraw,
    setAvoidGroup,
    saveMeganContact,
  } = useBell()
  const demo = !supabase || state.backend !== 'live'
  const isAdmin = demo || state.memberRole === 'owner' || state.session?.demo
  const [remote, setRemote] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [error, setError] = useState('')
  const [meganPhone, setMeganPhone] = useState('')
  const [meganEmail, setMeganEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [avoidChoice, setAvoidChoice] = useState(null)

  async function loadLive() {
    if (demo || !isAdmin) return
    const overview = await supabase.rpc('get_exchange_overview')
    if (!overview.error) setRemote(overview.data)
    const rows = await supabase.rpc('get_participant_contacts')
    if (!rows.error) setContacts(rows.data || [])
  }

  useEffect(() => {
    loadLive().catch((err) => setError(err.message || 'Could not open Secret Santa'))
  }, [demo, isAdmin])

  if (!isAdmin) {
    return (
      <div>
        <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
        <h1>Secret Santa</h1>
        <p className="lede">Andrew or Megan runs the drawing. You only see the person you are assigned.</p>
        <Link className="btn primary big" to="/gifts/assignment">Your person</Link>
      </div>
    )
  }

  const exchange = state.exchange
  const status = remote?.event?.status || exchange.eventStatus
  const avoid = avoidChoice ?? remote?.event?.avoid_same_group ?? exchange.avoidSameGroup
  const groups = remote
    ? (remote.groups || []).map((group) => ({
        id: group.id,
        label: group.label,
        people: group.people || [],
      }))
    : exchange.groups.map((group) => ({
        id: group.id,
        label: group.label,
        people: peopleOf(group, exchange.participants).map((person) => ({
          id: person.id,
          name: person.name,
          in_draw: person.inDraw,
          submitted: Boolean(person.submittedAt) || ideaCount(state.giftLists.find((list) => list.kidKey === person.listKey)) > 0,
          linked: Boolean(person.email),
          idea_count: ideaCount(state.giftLists.find((list) => list.kidKey === person.listKey)),
        })),
      }))
  const assignments = status === 'draft' ? remote?.assignments || exchange.assignments.map((row) => ({
    giver_id: row.giverId,
    giver: exchange.participants.find((person) => person.id === row.giverId)?.name,
    receiver_id: row.receiverId,
    receiver: exchange.participants.find((person) => person.id === row.receiverId)?.name,
  })) : null

  async function draw() {
    setError('')
    if (demo) {
      drawSanta()
      setError(state.exchangeError || '')
      return
    }
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('draw_secret_santa', { p_avoid: avoid })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await loadLive()
  }

  async function lock() {
    setError('')
    if (demo) {
      lockSanta()
      return
    }
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('lock_secret_santa')
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setRemote((prev) => (prev ? { ...prev, assignments: null, event: { ...prev.event, status: 'locked' } } : prev))
    await loadLive()
  }

  async function togglePerson(person) {
    if (status === 'locked') return
    if (demo) {
      setInDraw(person.id, !person.in_draw)
      return
    }
    await supabase.rpc('set_participant_in_draw', { p_participant: person.id, p_in_draw: !person.in_draw })
    await loadLive()
  }

  async function saveMegan(event) {
    event.preventDefault()
    if (demo) {
      saveMeganContact(meganPhone, meganEmail)
      setMeganPhone('')
      setMeganEmail('')
      return
    }
    const megan = (contacts || []).find((person) => person.name === 'Megan') || groups.flatMap((group) => group.people).find((person) => person.name === 'Megan')
    if (!megan) return
    const { error: rpcError } = await supabase.rpc('save_participant_contact', {
      p_participant: megan.id,
      p_phone: meganPhone,
      p_email: meganEmail,
      p_make_admin: true,
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setMeganPhone('')
    setMeganEmail('')
    await loadLive()
  }

  const contactRows = demo
    ? exchange.participants.map((person) => ({
        id: person.id,
        name: person.name,
        phone: person.phone,
        email: person.email,
      }))
    : contacts || []

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">Christmas 2026</div>
      <h1>Secret Santa</h1>
      <p className="lede">
        Check that everyone who should be in the drawing has a list. Draw names, look them over, then lock.
        After it is locked, this screen no longer shows who has whom.
      </p>
      {(error || state.exchangeError) && <p className="form-error">{error || state.exchangeError}</p>}
      <p className="status-pill">{status === 'locked' ? 'Locked' : status === 'draft' ? 'Drawn, not locked' : 'Not drawn yet'}</p>

      {groups.map((group) => (
        <section key={group.id} className="card pad">
          <h2>{group.label}</h2>
          <ul className="santa-roster">
            {group.people.map((person) => (
              <li key={person.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(person.in_draw)}
                    disabled={status === 'locked'}
                    onChange={() => togglePerson(person)}
                  />
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.submitted || person.idea_count ? 'List started' : 'No ideas yet'}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <label className="check-line">
        <input
          type="checkbox"
          checked={Boolean(avoid)}
          disabled={status === 'locked'}
          onChange={() => {
            if (demo) setAvoidGroup(!avoid)
            else setAvoidChoice(!avoid)
          }}
        />
        <span>Don’t draw someone in your own household</span>
      </label>
      <p className="dim">Andrew and Megan are one household. With only the two of them, turn this off or invite another household first.</p>

      <div className="stack-links">
        <button className="btn primary big" type="button" disabled={busy || status === 'locked'} onClick={draw}>
          {status === 'draft' ? 'Re-roll' : 'Draw names'}
        </button>
        <button className="btn big" type="button" disabled={busy || status !== 'draft'} onClick={lock}>
          Lock the drawing
        </button>
        <Link className="btn big" to="/gifts/assignment">Your person</Link>
      </div>

      {status === 'draft' && assignments && (
        <section className="card pad">
          <h2>This drawing</h2>
          <p className="lede">Locking hides this list. Each person then sees only their own name.</p>
          <ul className="pair-list">
            {assignments.map((row) => (
              <li key={row.giver_id}>
                <strong>{row.giver}</strong> draws <strong>{row.receiver}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {status === 'locked' && (
        <div className="banner">The drawing is locked. The full list is hidden here, including for Andrew and Megan.</div>
      )}

      <section className="card pad">
        <h2>Phone and email</h2>
        <p className="lede">Only Andrew and Megan can see this. It is how we reach people about the list.</p>
        <ul className="contact-list">
          {contactRows.map((person) => (
            <li key={person.id}>
              <strong>{person.name}</strong>
              <span>{person.phone || 'No phone yet'}</span>
              <span>{person.email || 'No email yet'}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={saveMegan}>
          <h3>Megan’s contact</h3>
          <p className="dim">Saving her email also makes that login an admin, once she signs in.</p>
          <label className="field">
            <span>Phone</span>
            <input value={meganPhone} onChange={(event) => setMeganPhone(event.target.value)} inputMode="tel" autoComplete="tel" />
          </label>
          <label className="field">
            <span>Email</span>
            <input value={meganEmail} onChange={(event) => setMeganEmail(event.target.value)} type="email" autoComplete="email" />
          </label>
          <button className="btn" type="submit">Save for Megan</button>
        </form>
      </section>
    </div>
  )
}
