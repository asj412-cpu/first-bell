import { HOUSEHOLD } from '../data/seed.js'
import { ageLabel } from '../lib/planner.js'
import { hostDisplayName } from '../lib/rsvps.js'
import { useBell } from '../lib/store.jsx'

export default function Settings() {
  const { state, signOut, resetDemo, configured, updateProfile } = useBell()
  const live = state.backend === 'live'
  const name = hostDisplayName(state.session)

  return (
    <div>
      <div className="kicker">Settings</div>
      <h1>Household</h1>
      <p className="lede">
        {live
          ? 'Hosts sign in with email. Guest RSVPs sync here from every phone.'
          : configured
            ? 'Backend is configured but unreachable. This device is on the local seed until Supabase is back.'
            : 'Demo mode is on. Nothing leaves this browser until Vercel has Supabase env vars.'}
      </p>

      <div className="card pad" style={{ marginTop: 16 }}>
        <div className="settings-list">
          <div className="row">
            <span>Household</span>
            <strong>{HOUSEHOLD.name}</strong>
          </div>
          <div className="row">
            <span>Signed in as</span>
            <strong>
              {name}
              {state.session?.email ? (
                <>
                  <br />
                  <span className="dim">{state.session.email}</span>
                </>
              ) : (
                ' (demo)'
              )}
            </strong>
          </div>
          <div className="row">
            <span>Role</span>
            <strong>{state.memberRole || (state.session?.demo ? 'demo host' : 'host')}</strong>
          </div>
          <div className="row">
            <span>Time zone</span>
            <strong>{HOUSEHOLD.timezone}</strong>
          </div>
          <div className="row">
            <span>Host contact</span>
            <strong>
              {HOUSEHOLD.contact.phone}
              <br />
              {HOUSEHOLD.contact.email}
            </strong>
          </div>
          <div className="row">
            <span>RSVP sync</span>
            <strong>{live ? 'Supabase · live' : state.backend === 'offline' ? 'Offline seed' : 'This browser only'}</strong>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>Birthdays and meals</h2>
      </div>
      <p className="dim">Ages update from the birth date. Allergies stay blank until you type them. Claire’s grade is open — kindergarten or 1st.</p>
      {state.vnextNote && <div className="banner">{state.vnextNote}</div>}
      {state.profiles.map((profile) => (
        <div className="card pad kid-card" key={profile.memberKey}>
          <div className="kicker">{profile.role === 'parent' ? 'Parent' : 'Kid'}</div>
          <h3>{profile.fullName || profile.name}</h3>
          <p className="muted" style={{ marginTop: 4 }}>{profile.birthDate ? ageLabel(profile.birthDate) : 'No birthday yet'}</p>
          <label className="field">
            <span>Birthday</span>
            <input
              type="date"
              value={profile.birthDate || ''}
              onChange={(event) => updateProfile(profile.memberKey, { birthDate: event.target.value || null })}
            />
          </label>
          {profile.role === 'kid' && (
            <label className="field">
              <span>Grade</span>
              <input
                value={profile.grade || ''}
                placeholder={profile.memberKey === 'claire' ? 'Kindergarten or 1st' : 'Leave blank if unknown'}
                onChange={(event) => updateProfile(profile.memberKey, { grade: event.target.value || null })}
              />
            </label>
          )}
          <label className="field">
            <span>Allergies and dislikes</span>
            <textarea
              value={profile.notes || ''}
              placeholder="Unknown — leave blank"
              onChange={(event) => updateProfile(profile.memberKey, { notes: event.target.value })}
            />
          </label>
        </div>
      ))}

      <div className="section-head">
        <h2>What this is</h2>
      </div>
      <div className="card pad">
        <p className="muted" style={{ marginTop: 0 }}>
          First Bell is household ops for parents. Party planning is the wedge, not the whole product. Inbox and calendar are in the shell now; Family sync is next. We never collect Apple or Google passwords.
        </p>
        <p className="muted">
          This build is the Johnson household desk — Chloe’s fifth, Cypress Academy Kuykendahl, SNAP Package A paid.
        </p>
      </div>

      <div className="meta-row" style={{ marginTop: 18 }}>
        {!live && (
          <button className="btn" onClick={resetDemo}>
            Reset seed
          </button>
        )}
        <button className="btn ghost" onClick={() => signOut()}>
          {live ? 'Sign out' : 'Sign out of demo'}
        </button>
      </div>
    </div>
  )
}
