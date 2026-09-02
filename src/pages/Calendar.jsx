import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EVENTS } from '../data/seed.js'
import { formatTimeRange, monthLabel, parseLocalDate } from '../lib/format.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function eventsOn(iso) {
  return EVENTS.filter((e) => e.date === iso)
}

function isoFrom(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState({ y: 2026, m: 9 }) // October 2026 — party month
  const [mode, setMode] = useState('month')
  const [selected, setSelected] = useState('2026-10-10')

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
    const d = parseLocalDate(selected)
    const sun = new Date(d)
    sun.setDate(d.getDate() - d.getDay())
    return sun
  }, [selected])

  const weekDays = [...Array(7)].map((_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  })

  const todayIso = (() => {
    const n = new Date()
    return isoFrom(n.getFullYear(), n.getMonth(), n.getDate())
  })()

  function shift(delta) {
    if (mode === 'week') {
      const d = parseLocalDate(selected)
      d.setDate(d.getDate() + delta * 7)
      const iso = isoFrom(d.getFullYear(), d.getMonth(), d.getDate())
      setSelected(iso)
      setCursor({ y: d.getFullYear(), m: d.getMonth() })
      return
    }
    const date = new Date(cursor.y, cursor.m + delta, 1)
    setCursor({ y: date.getFullYear(), m: date.getMonth() })
  }

  const selectedEvents = eventsOn(selected)

  return (
    <div>
      <div className="kicker">Calendar</div>
      <h1>Family time</h1>
      <p className="lede">Chloe’s party is seeded. Family sync is next.</p>

      <div className="banner" style={{ marginTop: 16 }}>
        Family sync next — events onto a shared Family calendar, or one ICS file you tap once. Never an Apple or Google password.
      </div>

      <div className="cal-toolbar">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous">
          ‹
        </button>
        <h2>{mode === 'month' ? monthLabel(cursor.y, cursor.m) : 'Week of ' + weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</h2>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next">
          ›
        </button>
      </div>
      <div className="meta-row" style={{ marginTop: -4, marginBottom: 12 }}>
        <button className={`btn small ${mode === 'month' ? 'primary' : ''}`} onClick={() => setMode('month')}>
          Month
        </button>
        <button className={`btn small ${mode === 'week' ? 'primary' : ''}`} onClick={() => setMode('week')}>
          Week
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            setCursor({ y: 2026, m: 9 })
            setSelected('2026-10-10')
          }}
        >
          Jump to Chloe
        </button>
      </div>

      <div className="section-head" style={{ marginTop: 8 }}>
        <h2>{parseLocalDate(selected).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      </div>
      {selectedEvents.length === 0 && (
        <div className="card pad empty" style={{ marginBottom: 14 }}>
          <p className="muted" style={{ margin: 0 }}>
            Nothing seeded this day. Family sync will fill school and sports next.
          </p>
        </div>
      )}
      {selectedEvents.map((e) => (
        <div className="card pad" key={e.id} style={{ marginBottom: 14 }}>
          <div className="kicker">{e.kind}</div>
          <h3 style={{ margin: '4px 0 6px' }}>{e.title}</h3>
          <p className="muted" style={{ margin: 0 }}>
            {e.allDay ? 'All day' : formatTimeRange(e.start, e.end)} · {e.place}
          </p>
          {e.partyId && (
            <Link to={`/parties/${e.partyId}`} className="btn small" style={{ marginTop: 12 }}>
              Open party desk
            </Link>
          )}
        </div>
      ))}

      {mode === 'month' && (
        <>
          <div className="weekdays">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="month-grid">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />
              const iso = isoFrom(cursor.y, cursor.m, d)
              const ev = eventsOn(iso)
              return (
                <button
                  key={iso}
                  className={`day ${ev.length ? 'has' : ''} ${iso === todayIso ? 'today' : ''} ${iso === selected ? 'has' : ''}`}
                  onClick={() => setSelected(iso)}
                >
                  <span className="n">{d}</span>
                  {ev.map((e) => (
                    <span key={e.id} className={`pip ${e.kind === 'birthday' ? 'bday' : ''}`} title={e.title} />
                  ))}
                </button>
              )
            })}
          </div>
        </>
      )}

      {mode === 'week' && (
        <div className="week-grid">
          {weekDays.map((d) => {
            const iso = isoFrom(d.getFullYear(), d.getMonth(), d.getDate())
            const ev = eventsOn(iso)
            return (
              <button
                key={iso}
                className="card week-row"
                onClick={() => setSelected(iso)}
                style={{ textAlign: 'left', borderColor: iso === selected ? 'var(--line-strong)' : undefined }}
              >
                <div>
                  <div className="kicker">{WEEKDAYS[d.getDay()]}</div>
                  <strong>{d.getDate()}</strong>
                </div>
                <div>
                  {ev.length === 0 && <span className="dim">Open</span>}
                  {ev.map((e) => (
                    <div key={e.id}>
                      <strong>{e.title}</strong>
                      <div className="dim">
                        {e.allDay ? 'All day' : formatTimeRange(e.start, e.end)} · {e.place}
                      </div>
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
