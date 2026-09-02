import { HOUSEHOLD } from '../data/seed.js'
import { useBell } from '../lib/store.jsx'

export default function Settings() {
  const { state, signOut, resetDemo } = useBell()

  return (
    <div>
      <div className="kicker">Settings</div>
      <h1>Household</h1>
      <p className="lede">Demo mode is on. Nothing leaves this browser.</p>

      <div className="card pad" style={{ marginTop: 16 }}>
        <div className="settings-list">
          <div className="row">
            <span>Household</span>
            <strong>{HOUSEHOLD.name}</strong>
          </div>
          <div className="row">
            <span>Signed in as</span>
            <strong>{state.session?.name || 'Andrew'} (demo)</strong>
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
        </div>
      </div>

      <div className="section-head">
        <h2>People</h2>
      </div>
      <div className="card pad">
        <div className="settings-list">
          {HOUSEHOLD.members.map((m) => (
            <div className="row" key={m.id}>
              <span>{m.role}</span>
              <strong>{m.name}</strong>
            </div>
          ))}
        </div>
      </div>

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
        <button className="btn" onClick={resetDemo}>
          Reset seed
        </button>
        <button className="btn ghost" onClick={signOut}>
          Sign out of demo
        </button>
      </div>
    </div>
  )
}
