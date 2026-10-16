import { useRef, useState } from 'react'
import { DOC_LABELS } from '../lib/vault/reminders.js'
import { parseMrz } from '../lib/vault/mrz.js'
import { maskNumber, REMASK_MS, REVEAL_HOLD_MS } from '../lib/vault/mask.js'
import { recognizeLocal } from '../lib/vault/ocr.js'
import { useVault } from '../lib/vault/VaultProvider.jsx'
import { useBell } from '../lib/store.jsx'

const DOC_OPTIONS = Object.entries(DOC_LABELS)

function HoldSecret({ value, docType, onReveal }) {
  const [shown, setShown] = useState(false)
  const timer = useRef(null)
  const hide = useRef(null)

  function reveal() {
    setShown(true)
    onReveal()
    window.clearTimeout(hide.current)
    hide.current = window.setTimeout(() => setShown(false), REMASK_MS)
  }

  function start(event) {
    event.preventDefault()
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(reveal, REVEAL_HOLD_MS)
  }

  function cancel() {
    window.clearTimeout(timer.current)
  }

  return (
    <button
      type="button"
      className={`secret ${shown ? 'shown' : ''}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      {shown ? value : maskNumber(value, docType)}
      <span className="dim">{shown ? 'Hides on its own' : 'Press and hold to reveal'}</span>
    </button>
  )
}

function RecoveryKit() {
  return (
    <section className="card pad vault-kit">
      <div className="kicker">Recovery kit</div>
      <h2>Write this down. We cannot reset it.</h2>
      <p className="muted">
        The vault passphrase never leaves this device. If Andrew and Megan both lose it, the documents cannot be opened. There is no share link and no backup on the server.
      </p>
      <p className="kit-line">Passphrase</p>
      <p className="kit-line">Written down by</p>
      <p className="kit-line">Stored where</p>
      <button type="button" className="btn small" onClick={() => window.print()}>Print kit</button>
    </section>
  )
}

function Setup({ busy, error, onSetup }) {
  const [passphrase, setPassphrase] = useState('')
  const [again, setAgain] = useState('')
  const [wrote, setWrote] = useState(false)
  const mismatch = again && passphrase !== again
  const ready = passphrase.length >= 12 && passphrase === again && wrote
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSetup(passphrase)
      }}
    >
      <RecoveryKit />
      <label className="field">
        <span>Vault passphrase</span>
        <input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
      </label>
      <label className="field">
        <span>Type it again</span>
        <input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
      </label>
      {passphrase && passphrase.length < 12 && <p className="form-error">Use at least 12 characters.</p>}
      {mismatch && <p className="form-error">Those don’t match.</p>}
      <label className="check-row">
        <input type="checkbox" checked={wrote} onChange={(event) => setWrote(event.target.checked)} />
        <span>I wrote the passphrase on the recovery kit.</span>
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary" disabled={!ready || busy}>{busy ? 'Sealing…' : 'Create the vault'}</button>
    </form>
  )
}

function Unlock({ busy, error, onUnlock }) {
  const [passphrase, setPassphrase] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onUnlock(passphrase)
      }}
    >
      <div className="card pad">
        <h2>Vault is locked</h2>
        <p className="muted">This is a separate passphrase from the household sign-in. It stays on this device.</p>
        <label className="field">
          <span>Vault passphrase</span>
          <input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" disabled={busy || passphrase.length < 12}>{busy ? 'Opening…' : 'Unlock'}</button>
      </div>
    </form>
  )
}

const EMPTY = {
  memberKey: 'claire',
  who: 'Claire',
  docType: 'passport',
  name: '',
  number: '',
  dob: '',
  issuedOn: '',
  expiresOn: '',
  issuer: '',
  notes: '',
  fileName: '',
}

export default function VaultPage() {
  const vault = useVault()
  const { state } = useBell()
  const [form, setForm] = useState(EMPTY)
  const [fileBytes, setFileBytes] = useState(null)
  const [ocrNote, setOcrNote] = useState('')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [saveError, setSaveError] = useState('')

  if (!vault.canUse) {
    return (
      <div>
        <div className="kicker">Vault</div>
        <h1>Parents only</h1>
        <p className="lede">Kids’ accounts never see the vault. There is nothing to share.</p>
      </div>
    )
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function applyParsed(parsed) {
    if (!parsed) return
    setForm((prev) => ({
      ...prev,
      docType: parsed.docType || prev.docType,
      name: parsed.name || prev.name,
      number: parsed.number || prev.number,
      dob: parsed.dob || prev.dob,
      expiresOn: parsed.expiresOn || prev.expiresOn,
      issuer: parsed.issuer || parsed.nationality || prev.issuer,
    }))
  }

  async function onFile(file) {
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    setFileBytes(bytes)
    setField('fileName', file.name)
    setOcrNote('Reading the image on this device…')
    try {
      const text = await recognizeLocal(file)
      const parsed = parseMrz(text)
      if (parsed) {
        applyParsed(parsed)
        setOcrNote('Found a passport MRZ on this device. Check every field before saving.')
      } else {
        setOcrNote('No MRZ in that image. Type the fields, or paste the two MRZ lines.')
      }
    } catch {
      setOcrNote('On-device OCR could not read that image. Paste the MRZ or type the fields. Nothing was sent out.')
    }
  }

  async function save(event) {
    event.preventDefault()
    setSaveError('')
    const person = state.profiles.find((profile) => profile.memberKey === form.memberKey)
    const record = {
      ...form,
      id: crypto.randomUUID(),
      who: person?.name || form.who,
    }
    try {
      await vault.addRecord(record, fileBytes)
      setForm({ ...EMPTY, memberKey: form.memberKey, who: person?.name || form.who })
      setFileBytes(null)
      setAdding(false)
      setOcrNote('')
    } catch (err) {
      setSaveError(err.message || 'Could not seal that document')
    }
  }

  return (
    <div className="vault-page">
      <div className="kicker">Family vault</div>
      <div className="row-between">
        <h1>Sealed documents</h1>
        {vault.status === 'unlocked' && (
          <button className="btn small ghost" onClick={() => vault.lock()}>Lock</button>
        )}
      </div>
      <p className="lede">Social Security cards, passports, and IDs stay encrypted on this device. The server stores scrambled files only.</p>

      {vault.status === 'setup' && <Setup busy={vault.busy} error={vault.error} onSetup={vault.setup} />}
      {vault.status === 'locked' && <Unlock busy={vault.busy} error={vault.error} onUnlock={vault.unlock} />}

      {vault.status === 'unlocked' && (
        <>
          <div className="banner">Locks after 5 minutes idle, and when you leave this tab. No share links.</div>
          <div className="meta-row">
            <button className="btn small primary" onClick={() => setAdding((value) => !value)}>{adding ? 'Close' : 'Add a document'}</button>
            <button className="btn small" onClick={() => vault.addPasskey().catch((err) => setSaveError(err.message))}>Add a passkey</button>
          </div>
          {saveError && <p className="form-error">{saveError}</p>}

          {adding && (
            <form className="card pad" onSubmit={save}>
              <label className="field">
                <span>Person</span>
                <select value={form.memberKey} onChange={(event) => setField('memberKey', event.target.value)}>
                  {state.profiles.map((profile) => (
                    <option key={profile.memberKey} value={profile.memberKey}>{profile.fullName || profile.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Document</span>
                <select value={form.docType} onChange={(event) => setField('docType', event.target.value)}>
                  {DOC_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Photo or scan</span>
                <input type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0])} />
              </label>
              <label className="field">
                <span>Or paste a passport MRZ</span>
                <textarea
                  placeholder="Two lines from the bottom of the passport"
                  onChange={(event) => applyParsed(parseMrz(event.target.value))}
                />
              </label>
              {ocrNote && <p className="dim">{ocrNote}</p>}
              <label className="field"><span>Name on document</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
              <label className="field"><span>Number</span><input value={form.number} onChange={(event) => setField('number', event.target.value)} autoComplete="off" /></label>
              <label className="field"><span>Date of birth</span><input type="date" value={form.dob} onChange={(event) => setField('dob', event.target.value)} /></label>
              <label className="field"><span>Issued</span><input type="date" value={form.issuedOn} onChange={(event) => setField('issuedOn', event.target.value)} /></label>
              <label className="field"><span>Expires</span><input type="date" value={form.expiresOn} onChange={(event) => setField('expiresOn', event.target.value)} /></label>
              <label className="field"><span>Issuer</span><input value={form.issuer} onChange={(event) => setField('issuer', event.target.value)} /></label>
              <p className="dim">Check the fields. Saving seals them before anything is stored.</p>
              <button className="btn primary" disabled={!form.number || !form.name}>Save sealed</button>
            </form>
          )}

          <div className="vault-list">
            {vault.records.length === 0 && <div className="card pad empty"><p className="muted" style={{ margin: 0 }}>No sealed documents yet.</p></div>}
            {state.profiles.map((profile) => {
              const rows = vault.records.filter((record) => record.memberKey === profile.memberKey)
              if (!rows.length) return null
              return (
                <section key={profile.memberKey}>
                  <h2>{profile.name}</h2>
                  {rows.map((record) => (
                    <article className="card pad" key={record.id}>
                      <div className="kicker">{DOC_LABELS[record.docType] || 'Document'}</div>
                      <h3>{record.name}</h3>
                      <HoldSecret
                        value={record.number}
                        docType={record.docType}
                        onReveal={() => vault.noteReveal(record.id)}
                      />
                      <p className="dim">
                        {record.expiresOn ? `Expires ${record.expiresOn}` : 'No expiry'}
                        {record.issuer ? ` · ${record.issuer}` : ''}
                      </p>
                      <div className="meta-row">
                        <button className="btn small ghost" onClick={() => { setOpenId(record.id); vault.noteView(record.id) }}>
                          {openId === record.id ? 'Details' : 'View details'}
                        </button>
                        <button className="btn small ghost" onClick={() => vault.deleteRecord(record.id)}>Delete</button>
                      </div>
                      {openId === record.id && (
                        <dl className="vault-details">
                          <div><dt>Born</dt><dd>{record.dob || '—'}</dd></div>
                          <div><dt>Issued</dt><dd>{record.issuedOn || '—'}</dd></div>
                          <div><dt>Issuer</dt><dd>{record.issuer || '—'}</dd></div>
                        </dl>
                      )}
                    </article>
                  ))}
                </section>
              )
            })}
          </div>

          <div className="section-head"><h2>Audit</h2></div>
          <div className="card pad">
            {vault.audit.length === 0 && <p className="muted" style={{ margin: 0 }}>No vault activity yet.</p>}
            <ul className="audit-list">
              {vault.audit.map((row, index) => (
                <li key={`${row.at}-${index}`}>
                  <strong>{row.action}</strong>
                  <span className="dim">{row.actor} · {new Date(row.at).toLocaleString()}</span>
                  {row.recordId && <span className="dim">{row.recordId.slice(0, 8)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
