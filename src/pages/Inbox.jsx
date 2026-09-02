import { useState } from 'react'
import { FOLDERS } from '../data/seed.js'
import { relativeMail } from '../lib/format.js'
import { useBell } from '../lib/store.jsx'

export default function Inbox() {
  const { state, moveMessage } = useBell()
  const [folder, setFolder] = useState('inbox')
  const items = state.messages.filter((m) => m.folder === folder)
  const attention = state.messages.filter((m) => m.folder === 'inbox').length

  return (
    <div>
      <div className="kicker">Inbox</div>
      <h1>The agent files this.</h1>
      <p className="lede">You don’t live in mail. First Bell’s COO / agent files Bills, Shopping, School, and Trash.</p>

      <div className="banner" style={{ marginTop: 16 }}>
        Filing is a First Bell job. Suggested folders are already on each card — tap to confirm. Demo cards only; the live concierge still never asks for your password.
      </div>

      <div className="folders" role="tablist" aria-label="Folders">
        {FOLDERS.map((f) => {
          const n = state.messages.filter((m) => m.folder === f.id).length
          return (
            <button
              key={f.id}
              data-folder={f.id}
              className={folder === f.id ? 'on' : ''}
              onClick={() => setFolder(f.id)}
            >
              {f.label}
              {n ? ` · ${n}` : ''}
            </button>
          )
        })}
      </div>

      {folder === 'inbox' && (
        <p className="dim" style={{ marginTop: 0 }}>
          {attention} in Inbox · {attention} waiting on the agent
        </p>
      )}

      {items.length === 0 && (
        <div className="card pad empty">
          <h3>Quiet in {FOLDERS.find((f) => f.id === folder)?.label}</h3>
          <p className="muted">
            {folder === 'trash'
              ? 'Nothing in Trash. Promo sludge gets filed here by the agent.'
              : 'When the agent files a note, it lands here.'}
          </p>
        </div>
      )}

      {items.map((m) => (
        <article className="card mail" key={m.id}>
          <div className="row-between">
            <div className="from">{m.from}</div>
            <span className="dim">{relativeMail(m.when)}</span>
          </div>
          <h3>{m.subject}</h3>
          <p>{m.snippet}</p>
          <div className="actions">
            {m.suggested && m.folder === 'inbox' && (
              <button className="btn small primary" onClick={() => moveMessage(m.id, m.suggested)}>
                File to {label(m.suggested)}
              </button>
            )}
            {m.folder !== 'inbox' && (
              <button className="btn small ghost" onClick={() => moveMessage(m.id, 'inbox')}>
                Back to Inbox
              </button>
            )}
            {m.folder !== 'trash' && (
              <button className="btn small ghost" onClick={() => moveMessage(m.id, 'trash')}>
                Trash
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}

function label(id) {
  return FOLDERS.find((f) => f.id === id)?.label || id
}
