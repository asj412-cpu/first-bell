import { Link } from 'react-router-dom'
import CalendarTabs from '../components/CalendarTabs.jsx'
import { birthdaysInYear } from '../lib/birthdays.js'
import { turnsLabel } from '../lib/birthdays.js'
import { eventWhenLabel, isFinished, rsvpSummary, splitEvents } from '../lib/events.js'
import { chicagoParts } from '../lib/time.js'
import { useBell } from '../lib/store.jsx'

const RSVP_LABELS = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['maybe', 'Maybe'],
  ['none', 'Waiting'],
]

export default function History() {
  const { state } = useBell()
  const { history } = splitEvents(state.events)
  const year = chicagoParts().year
  const pastBirthdays = [year - 1, year]
    .flatMap((value) => birthdaysInYear(state.profiles, value))
    .filter((event) => isFinished(event))
  const seen = new Set(history.map((event) => event.id))
  const rows = [...history, ...pastBirthdays.filter((event) => !seen.has(event.id))].sort(
    (a, b) => new Date(b.endsAt || b.startsAt) - new Date(a.endsAt || a.startsAt),
  )

  return (
    <div>
      <div className="kicker">Calendar</div>
      <h1>History</h1>
      <p className="lede">Finished events, newest first. This list is read-only.</p>
      <CalendarTabs />
      {rows.length === 0 && (
        <div className="card pad empty">
          <p className="muted" style={{ margin: 0 }}>Nothing has finished yet.</p>
        </div>
      )}
      <div className="history-list">
        {rows.map((event) => {
          const summary = event.partyId ? rsvpSummary(state.guests) : null
          return (
            <article className="card pad history-card" key={event.id}>
              <div className="kicker">{event.kind === 'birthday' ? 'Birthday' : event.kind}</div>
              <h3 style={{ margin: '4px 0 6px' }}>{event.title}</h3>
              <p className="muted" style={{ margin: 0 }}>
                {eventWhenLabel(event)}
                {event.place ? ` · ${event.place}` : ''}
              </p>
              {event.turns != null && <p className="dim">{turnsLabel(event.turns)}</p>}
              {summary && (
                <div className="rsvp-summary" style={{ marginTop: 12 }}>
                  {RSVP_LABELS.map(([id, label]) => (
                    <div className="cell" key={id}>
                      <span className="n">{summary[id]}</span>
                      <span className="dim">{label}</span>
                    </div>
                  ))}
                </div>
              )}
              {event.partyId && (
                <Link to={`/parties/${event.partyId}`} className="btn small" style={{ marginTop: 8 }}>
                  Party desk
                </Link>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
