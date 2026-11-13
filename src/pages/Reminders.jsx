import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconBack } from '../components/Icons.jsx'
import { buildPreview, fillReminder, REMINDERS, reminderRecipients } from '../lib/exchange.js'
import { REMINDER_ADAPTER } from '../lib/reminderAdapter.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

export default function Reminders() {
  const { state, previewReminder } = useBell()
  const demo = !supabase || state.backend !== 'live'
  const isAdmin = demo || state.memberRole === 'owner' || state.session?.demo
  const [rows, setRows] = useState(REMINDERS)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (demo || !isAdmin) return undefined
    supabase.rpc('list_gift_reminders').then(({ data, error: rpcError }) => {
      if (rpcError || !Array.isArray(data) || !data.length) return
      setRows(data.map((row) => ({
        id: row.id,
        kind: row.kind,
        sendAt: row.send_at,
        sendLabel: new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Chicago',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(row.send_at)),
        audience: row.audience,
        subject: row.subject,
        body: row.body,
      })))
    })
    return undefined
  }, [demo, isAdmin])

  if (!isAdmin) {
    return (
      <div>
        <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
        <h1>Reminders</h1>
        <p className="lede">Andrew or Megan previews the reminders. Nothing is sent from this app.</p>
      </div>
    )
  }

  async function preview(reminder) {
    setError('')
    if (!demo && reminder.id && supabase) {
      const { data, error: rpcError } = await supabase.rpc('preview_gift_reminder', { p_reminder: reminder.id })
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      setOpen({
        ...reminder,
        adapter: data.adapter,
        delivered: data.delivered,
        recipients: data.recipients || [],
      })
      return
    }
    const built = buildPreview(reminder, state.exchange)
    previewReminder(built)
    setOpen({ ...reminder, ...built })
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">Through December 25</div>
      <h1>Reminders</h1>
      <div className="stub-banner" role="note">
        <strong>Nothing is sent.</strong>
        <p>{REMINDER_ADAPTER.label} This screen only shows the words and who would get them. Sending needs Andrew’s yes, and a delivery option he picks.</p>
      </div>
      {error && <p className="form-error">{error}</p>}
      {rows.map((reminder) => {
        const count = reminderRecipients(reminder, state.exchange).length
        return (
          <article key={reminder.kind} className="card pad reminder-card">
            <div className="kicker">{reminder.sendLabel}</div>
            <h2>{reminder.subject}</h2>
            <p>{fillReminder(reminder.body, 'there')}</p>
            <p className="dim">{demo ? `${count} people on this phone` : 'Preview loads the real recipient list.'}</p>
            <button className="btn" type="button" onClick={() => preview(reminder)}>
              Preview
            </button>
          </article>
        )
      })}
      {open && (
        <section className="card pad">
          <h2>Preview · not sent</h2>
          <p className="dim">Adapter: {open.adapter || REMINDER_ADAPTER.id}. Delivered: no.</p>
          <p><strong>{open.subject}</strong></p>
          {(open.recipients || []).map((person) => (
            <article key={person.id || person.name} className="preview-person">
              <strong>{person.name}</strong>
              <span>{person.email || 'No email on file'}</span>
              {person.phone ? <span>{person.phone}</span> : <span>No phone on file</span>}
              <p>{person.message || fillReminder(open.body, person.name)}</p>
              {!person.email && <p className="dim">This person would be skipped until an email is saved.</p>}
              <button className="btn small" type="button" onClick={() => copy(person.message || fillReminder(open.body, person.name))}>
                Copy message
              </button>
            </article>
          ))}
          {(open.recipients || []).length === 0 && <p>No recipients for this one yet.</p>}
        </section>
      )}
    </div>
  )
}
