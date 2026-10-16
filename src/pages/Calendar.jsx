import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CalendarTabs from '../components/CalendarTabs.jsx'
import { birthdaysInYear } from '../lib/birthdays.js'
import { turnsLabel } from '../lib/birthdays.js'
import { eventDateIso, eventWhenLabel, isFinished } from '../lib/events.js'
import { chicagoParts, chicagoTodayIso } from '../lib/time.js'
import { useBell } from '../lib/store.jsx'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isoFrom(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export default function CalendarPage() {
  const { state, toggleChecklist } = useBell()
  const today = chicagoTodayIso()
  const [cursor, setCursor] = useState(() => {
    const parts = chicagoParts()
    return { y: parts.year, m: parts.month - 1 }
  })
  const [mode, setMode] = useState('month')
  const [selected, setSelected] = useState(today)

  function eventsOn(iso) {
    const year = Number(iso.slice(0, 4))
    const stored = state.events.filter((event) => eventDateIso(event) === iso && !isFinished(event))
    const birthdays = birthdaysInYear(state.profiles, year).filter((event) => event.date === iso && !isFinished(event))
    const ids = new Set(stored.map((event) => event.id))
    return [...stored, ...birthdays.filter((event) => !ids.has(event.id))]
  }

  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1)
    const start = first.getDay()
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate()
    const out = []
    for (let i = 0; i < start; i++) out.push(null)
    for (let d = 1; d <= days; d++) out.push(d)
    while (out.length % 7) out.push(null)
    return out
  }, [cursor])

  const weekStart = useMemo(() => {
    const [y, m, d] = selected.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    date.setDate(date.getDate() - date.getDay())
    return date
  }, [selected])

  const weekDays = [...Array(7)].map((_, i) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
    return date
  })

  function shift(delta) {
    if (mode === 'week') {
      const [y, m, d] = selected.split('-').map(Number)
      const date = new Date(y, m - 1, d + delta * 7)
      const iso = isoFrom(date.getFullYear(), date.getMonth(), date.getDate())
      setSelected(iso)
      setCursor({ y: date.getFullYear(), m: date.getMonth() })
      return
    }
    const date = new Date(cursor.y, cursor.m + delta, 1)
    setCursor({ y: date.getFullYear(), m: date.getMonth() })
  }

  const selectedEvents = eventsOn(selected)
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="kicker">Calendar</div>
      <h1>Family time</h1>
      <p className="lede">Upcoming plans only. Finished days live in History. Birthdays come from Settings.</p>
      <CalendarTabs />
      <div className="banner">
        Connect family calendar for school and sports. Holidays and Johnson birthdays are already on the list. A family event appears only after it is imported.
      </div>

      <div className="cal-toolbar">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous">‹</button>
        <h2>{mode === 'month' ? monthLabel : `Week of ${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</h2>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next">›</button>
      </div>
      <div className="meta-row" style={{ marginTop: -4, marginBottom: 12 }}>
        <button className={`btn small ${mode === 'month' ? 'primary' : ''}`} onClick={() => setMode('month')}>Month</button>
        <button className={`btn small ${mode === 'week' ? 'primary' : ''}`} onClick={() => setMode('week')}>Week</button>
        <button className="btn small ghost" onClick={() => { setCursor({ y: 2026, m: 9 }); setSelected('2026-10-10') }}>Jump to Chloe</button>
      </div>

      <div className="section-head" style={{ marginTop: 8 }}>
        <h2>{new Date(selected + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      </div>
      {selectedEvents.length === 0 && (
        <div className="card pad empty" style={{ marginBottom: 14 }}>
          <p className="muted" style={{ margin: 0 }}>
            Nothing upcoming this day. Finished items are in <Link to="/history">History</Link>.
          </p>
        </div>
      )}
      {selectedEvents.map((event) => (
        <div className="card pad" key={event.id} style={{ marginBottom: 14 }}>
          <div className="kicker">{event.draft ? 'Draft' : event.sourceLabel || event.kind}</div>
          <h3 style={{ margin: '4px 0 6px' }}>{event.title}</h3>
          <p className="muted" style={{ margin: 0 }}>
            {event.allDay ? 'All day' : eventWhenLabel(event)}
            {event.place ? ` · ${event.place}` : ''}
          </p>
          {event.turns != null && <p className="dim">{turnsLabel(event.turns)}</p>}
          {event.partyId && (
            <Link to={`/parties/${event.partyId}`} className="btn small" style={{ marginTop: 12 }}>Open party desk</Link>
          )}
          {event.checklist?.length > 0 && (
            <ul className="check-list">
              {event.checklist.map((item) => (
                <li key={item.id}>
                  <label>
                    <input type="checkbox" checked={item.done} onChange={() => toggleChecklist(event.id, item.id)} />
                    <span>{item.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {mode === 'month' && (
        <>
          <div className="weekdays">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="month-grid">
            {cells.map((day, index) => {
              if (!day) return <div key={index} />
              const iso = isoFrom(cursor.y, cursor.m, day)
              const ev = eventsOn(iso)
              return (
                <button key={iso} className={`day ${ev.length ? 'has' : ''} ${iso === today ? 'today' : ''} ${iso === selected ? 'has' : ''}`} onClick={() => setSelected(iso)}>
                  <span className="n">{day}</span>
                  {ev.map((event) => (
                    <span key={event.id} className={`pip ${event.kind === 'birthday' ? 'bday' : ''} ${event.draft ? 'draft' : ''}`} title={event.title} />
                  ))}
                </button>
              )
            })}
          </div>
        </>
      )}

      {mode === 'week' && (
        <div className="week-grid">
          {weekDays.map((date) => {
            const iso = isoFrom(date.getFullYear(), date.getMonth(), date.getDate())
            const ev = eventsOn(iso)
            return (
              <button key={iso} className="card week-row" onClick={() => setSelected(iso)} style={{ textAlign: 'left', borderColor: iso === selected ? 'var(--line-strong)' : undefined }}>
                <div>
                  <div className="kicker">{WEEKDAYS[date.getDay()]}</div>
                  <strong>{date.getDate()}</strong>
                </div>
                <div>
                  {ev.length === 0 && <span className="dim">Open</span>}
                  {ev.map((event) => (
                    <div key={event.id}>
                      <strong>{event.title}</strong>
                      <div className="dim">{eventWhenLabel(event)}</div>
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
