import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import ShareLink from '../components/ShareLink.jsx'
import { IconBack } from '../components/Icons.jsx'
import { inviteUrl } from '../lib/invites.js'
import { FAMILY_LINK_COPY, profileCounts, profileStatus } from '../lib/profiles.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

/**
 * Andrew's people list: add everyone as pre-made profiles, share ONE family
 * link into the group text, and see who has claimed which name.
 */
export default function FamilyProfiles() {
  const navigate = useNavigate()
  const { state, notify, refreshAccess } = useBell()
  const isOwner = state.memberRole === 'owner'
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', group: '', email: '' })
  const [moving, setMoving] = useState(null)
  const [editing, setEditing] = useState(null)
  const [edit, setEdit] = useState({ name: '', group: '', email: '' })

  async function load() {
    const { data: rows, error: rpcError } = await supabase.rpc('admin_list_profiles')
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setData(rows || { link: null, groups: [], profiles: [] })
  }

  useEffect(() => {
    if (!supabase || !isOwner) return
    load().catch(() => setError('Could not load the family list'))
  }, [isOwner])

  async function run(fn, done) {
    setBusy(true)
    setError('')
    const { data: out, error: rpcError } = await fn()
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return null
    }
    if (done) notify(done)
    await load()
    return out
  }

  async function add(event) {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Enter a name')
      return
    }
    const out = await run(
      () => supabase.rpc('admin_add_profile', { p_name: form.name, p_group: form.group || null, p_email: form.email || null }),
      `${form.name.trim()} added`,
    )
    if (out) {
      setForm((prev) => ({ name: '', group: prev.group, email: '' }))
      await refreshAccess()
    }
  }

  async function link(action) {
    if (action === 'rotate' && !window.confirm('Make a new link? The old link stops working.')) return
    if (action === 'revoke' && !window.confirm('Turn off the family link? Nobody can use it until you make a new one.')) return
    await run(() => supabase.rpc('admin_family_link', { p_action: action }),
      action === 'rotate' ? 'New link ready' : action === 'revoke' ? 'Link turned off' : null)
  }

  async function unclaim(profile) {
    if (!window.confirm(`Undo ${profile.name}’s claim? Their sign-in is unlinked. Their list and Secret Santa spot stay.`)) return
    await run(() => supabase.rpc('admin_unclaim_profile', { p_participant: profile.participant_id }), 'Claim undone')
  }

  async function move(from, toId) {
    if (!toId) return
    await run(() => supabase.rpc('admin_reassign_profile', { p_from: from.participant_id, p_to: toId }), 'Claim moved')
    setMoving(null)
  }

  function startEdit(profile) {
    setMoving(null)
    setError('')
    setEdit({ name: profile.name || '', group: profile.group_label || '', email: profile.email || '' })
    setEditing(profile.participant_id)
  }

  async function saveEdit(event, profile) {
    event.preventDefault()
    if (!edit.name.trim()) {
      setError('Enter a name')
      return
    }
    const out = await run(
      () => supabase.rpc('admin_update_profile', {
        p_participant: profile.participant_id,
        p_name: edit.name,
        p_group: edit.group || null,
        p_email: edit.email || null,
      }),
      `${edit.name.trim()} saved`,
    )
    if (out) {
      setEditing(null)
      await refreshAccess()
    }
  }

  async function keepList(profile, keep) {
    await run(
      () => supabase.rpc('admin_set_wont_sign_up', { p_participant: profile.participant_id, p_wont: keep }),
      keep ? `You’ll keep ${profile.name}’s list` : `${profile.name} is back in the name picker`,
    )
  }

  async function remove(profile) {
    if (!window.confirm(`Remove ${profile.name} and their list?`)) return
    await run(() => supabase.rpc('admin_remove_profile', { p_participant: profile.participant_id }), `${profile.name} removed`)
    await refreshAccess()
  }

  if (!isOwner) {
    return (
      <div>
        <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
        <h1>Family list</h1>
        <p className="lede">Only Andrew can set up the family list.</p>
      </div>
    )
  }

  const profiles = data?.profiles || []
  const counts = profileCounts(profiles)
  const unclaimed = profiles.filter((p) => !p.claimed && !p.wont_sign_up)

  return (
    <div className="people-page">
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <header className="people-hero">
        <div className="kicker">Christmas 2026</div>
        <h1>Family list</h1>
        <p className="lede">
          Add everyone, then drop one link in the family group text. Each person signs in and taps their own name.
        </p>
        <div className="people-tally" aria-label="Claim progress">
          <span><strong>{counts.total}</strong> people</span>
          <span><strong>{counts.claimed}</strong> claimed</span>
          <span><strong>{counts.waiting}</strong> waiting</span>
          {counts.kept > 0 && <span><strong>{counts.kept}</strong> you keep</span>}
        </div>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="card pad people-link">
        <div className="kicker">Family link</div>
        <h2 style={{ marginTop: 4 }}>One link for the group text</h2>
        {data?.link?.token ? (
          <>
            <ShareLink
              url={inviteUrl(data.link.token)}
              subject={FAMILY_LINK_COPY.subject}
              text={FAMILY_LINK_COPY.text}
              onDone={notify}
            />
            <div className="share-actions">
              <button className="btn small" type="button" disabled={busy} onClick={() => link('rotate')}>New link</button>
              <button className="btn small ghost" type="button" disabled={busy} onClick={() => link('revoke')}>Turn off link</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">No family link is on right now.</p>
            <button className="btn primary big" type="button" disabled={busy} onClick={() => link('get')}>
              Make the family link
            </button>
          </>
        )}
      </section>

      <form className="card pad people-add" onSubmit={add}>
        <div className="kicker">Add a person</div>
        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="First name is fine" />
        </label>
        <label className="field">
          <span>Household (optional)</span>
          <input
            value={form.group}
            onChange={(e) => setForm({ ...form, group: e.target.value })}
            list="people-groups"
            placeholder="e.g. The Smiths"
          />
          <datalist id="people-groups">
            {(data?.groups || []).map((label) => <option key={label} value={label} />)}
          </datalist>
        </label>
        <label className="field">
          <span>Email (optional, only you see it)</span>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" />
        </label>
        <button className="btn primary big" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add to the list'}</button>
      </form>

      <h2 className="section-label">People</h2>
      <p className="dim people-help">
        Someone who won’t sign up? Tap <strong>They won’t sign up</strong> to keep their list yourself. They drop off the
        “Who are you on the list?” names, and you can put them back any time.
      </p>
      {data && profiles.length === 0 && <p className="dim">Nobody yet. Add the first person above.</p>}
      <ul className="people-list" role="list">
        {profiles.map((profile) => {
          const status = profileStatus(profile)
          return (
            <li key={profile.participant_id} className={`card pad people-card${profile.claimed ? ' is-claimed' : ''}`}>
              <div className="people-row">
                <Avatar name={profile.name} seed={profile.participant_id} />
                <div className="people-main">
                  <h3>{profile.name}</h3>
                  <p className="dim">
                    {[profile.group_label && profile.group_label !== profile.name ? profile.group_label : null,
                      `${profile.item_count} ${Number(profile.item_count) === 1 ? 'idea' : 'ideas'}`,
                      profile.in_draw ? 'In Secret Santa' : 'Not in Secret Santa'].filter(Boolean).join(' · ')}
                  </p>
                  <span className={`chip ${status.tone}`}>{status.label}</span>
                </div>
              </div>
              <div className="people-actions">
                <button className="btn small" type="button" onClick={() => navigate(`/gifts/${profile.kid_key}`)}>
                  {profile.claimed ? 'View list' : 'Edit list'}
                </button>
                <button className="btn small" type="button" disabled={busy} onClick={() => (editing === profile.participant_id ? setEditing(null) : startEdit(profile))}>
                  Edit details
                </button>
                {profile.claimed ? (
                  <>
                    <button className="btn small" type="button" disabled={busy} onClick={() => setMoving(moving === profile.participant_id ? null : profile.participant_id)}>
                      Move claim
                    </button>
                    <button className="btn small ghost" type="button" disabled={busy} onClick={() => unclaim(profile)}>Undo claim</button>
                  </>
                ) : (
                  <>
                    <button className="btn small" type="button" disabled={busy} onClick={() => keepList(profile, !profile.wont_sign_up)}>
                      {profile.wont_sign_up ? 'Put back in the picker' : 'They won’t sign up'}
                    </button>
                    <button className="btn small ghost" type="button" disabled={busy} onClick={() => remove(profile)}>Remove</button>
                  </>
                )}
              </div>
              {editing === profile.participant_id && (
                <form className="people-edit" onSubmit={(event) => saveEdit(event, profile)}>
                  <label className="field">
                    <span>Name</span>
                    <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} />
                  </label>
                  <label className="field">
                    <span>Household</span>
                    <input
                      value={edit.group}
                      onChange={(e) => setEdit({ ...edit, group: e.target.value })}
                      list="people-groups"
                      placeholder="e.g. The Smiths"
                    />
                  </label>
                  <label className="field">
                    <span>Email (optional, only you see it)</span>
                    <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} type="email" />
                  </label>
                  <div className="meta-row">
                    <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                    <button className="btn ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </form>
              )}
              {moving === profile.participant_id && (
                <label className="field people-move">
                  <span>{profile.claimed_email || 'This person'} is really…</span>
                  <select defaultValue="" onChange={(e) => move(profile, e.target.value)} disabled={busy}>
                    <option value="" disabled>Pick the right name</option>
                    {unclaimed.map((p) => <option key={p.participant_id} value={p.participant_id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </li>
          )
        })}
      </ul>
      <div className="stack-links">
        <Link className="btn big" to="/gifts/santa">Secret Santa</Link>
      </div>
    </div>
  )
}
