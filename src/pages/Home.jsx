import { Link } from 'react-router-dom'
import { PARTY } from '../data/seed.js'
import { turnsLabel } from '../lib/birthdays.js'
import { eventWhenLabel, isFinished, splitEvents } from '../lib/events.js'
import { formatShortDate } from '../lib/format.js'
import { greeting, todayLabel } from '../lib/format.js'
import { buildNextUp } from '../lib/nextup.js'
import { hostDisplayName } from '../lib/rsvps.js'
import { useBell } from '../lib/store.jsx'
import { useVault } from '../lib/vault/VaultProvider.jsx'
import { IconArrow } from '../components/Icons.jsx'

function Suggestion({ item, planned, onPlan }) {
  return (
    <div className="card pad next-card">
      <div className="row-between">
        <span className={`chip ${item.source === 'birthday' ? 'rose' : item.source === 'import' ? 'teal' : item.source === 'vault' ? 'vault' : 'gold'}`}>
          {item.sourceLabel}
        </span>
        <span className="dim">{formatShortDate(item.date)}</span>
      </div>
      <h3 style={{ margin: '8px 0 4px' }}>{item.title}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {item.source === 'birthday' ? turnsLabel(item.turns) : item.allDay ? 'All day' : eventWhenLabel(item)}
        {item.location ? ` · ${item.location}` : ''}
      </p>
      {item.source === 'vault' ? (
        <Link to="/vault" className="btn small" style={{ marginTop: 12 }}>
          Open vault
        </Link>
      ) : planned ? (
        <Link to="/calendar" className="btn small" style={{ marginTop: 12 }}>
          On the calendar
        </Link>
      ) : (
        <button className="btn small" style={{ marginTop: 12 }} onClick={() => onPlan(item)}>
          Plan this
        </button>
      )}
    </div>
  )
}

export default function Home() {
  const { state, planSuggestion } = useBell()
  const vault = useVault()
  const openRsvps = state.guests.filter((guest) => guest.status === 'none').length
  const inboxN = state.messages.filter((message) => message.folder === 'inbox' && message.attention).length
  const { upcoming, history } = splitEvents(state.events)
  const nextUp = buildNextUp({
    imports: state.imports,
    profiles: state.profiles,
    reminders: vault.reminders,
  })
  const party = state.events.find((event) => event.partyId === PARTY.id)
  const partyDone = party ? isFinished(party) : true
  const nextEvent = upcoming[0]
  const connected = (state.imports || []).length > 0

  return (
    <div>
      <div className="kicker">{todayLabel()}</div>
      <h1>
        {greeting()}, {hostDisplayName(state.session)}
      </h1>
      <p className="lede">Household ops at a glance. Holidays and birthdays are calculated. Family plans show up when the calendar is connected.</p>

      <div className="section-head">
        <h2>Next up</h2>
        <Link to="/calendar" className="dim">Calendar</Link>
      </div>
      {!connected && (
        <div className="banner">
          Connect family calendar. Imported events show up here after the COO adds them. Nothing on this list is made up.
        </div>
      )}
      <div className="next-strip">
        {nextUp.soon.map((item) => (
          <Suggestion
            key={item.key}
            item={item}
            planned={state.events.some((event) => event.id === `plan-${item.key}`)}
            onPlan={planSuggestion}
          />
        ))}
      </div>

      {nextUp.renewals?.length > 0 && (
        <>
          <div className="section-head">
            <h2>Renewals</h2>
          </div>
          <div className="next-strip">
            {nextUp.renewals.map((item) => (
              <Suggestion key={item.key} item={item} planned={false} onPlan={() => {}} />
            ))}
          </div>
        </>
      )}

      {nextUp.birthdays.length > 0 && (
        <>
          <div className="section-head">
            <h2>Family birthdays</h2>
          </div>
          <div className="next-strip">
            {nextUp.birthdays.map((item) => (
              <Suggestion
                key={item.key}
                item={item}
                planned={state.events.some((event) => event.id === `plan-${item.key}`)}
                onPlan={planSuggestion}
              />
            ))}
          </div>
        </>
      )}

      {nextEvent && (
        <Link to={nextEvent.partyId ? `/parties/${nextEvent.partyId}` : '/calendar'} className="card pad" style={{ marginTop: 14, display: 'block' }}>
          <div className="kicker">On your calendar</div>
          <h2 style={{ marginTop: 4 }}>{nextEvent.title}</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>{eventWhenLabel(nextEvent)}</p>
        </Link>
      )}

      {partyDone && (
        <Link to="/history" className="card pad history-teaser">
          <div className="kicker">History</div>
          <div className="row-between">
            <div>
              <strong>Chloe’s party has moved to History</strong>
              <div className="dim">RSVPs stay on the party desk. {history.length} finished.</div>
            </div>
            <IconArrow style={{ width: 18, height: 18, color: 'var(--gold)' }} />
          </div>
        </Link>
      )}

      <div className="meta-row" style={{ marginTop: 14 }}>
        <Link className="btn small" to="/meals">Meal plan</Link>
        <Link className="btn small" to="/gifts">Gift lists</Link>
        <Link className="btn small ghost" to="/history">History</Link>
      </div>

      <div className="stats" style={{ marginTop: 14 }}>
        <Link to="/parties" className="card pad stat">
          <div className="kicker">Parties</div>
          <div className="num">{partyDone ? history.filter((event) => event.partyId).length : upcoming.filter((event) => event.partyId).length}</div>
          <div className="lbl">{partyDone ? 'In history' : 'Coming up'}</div>
        </Link>
        <Link to={`/parties/${PARTY.id}`} className="card pad stat">
          <div className="kicker">Open RSVPs</div>
          <div className="num">{openRsvps}</div>
          <div className="lbl">No response yet</div>
        </Link>
        <Link to="/inbox" className="card pad stat">
          <div className="kicker">Inbox</div>
          <div className="num">{inboxN}</div>
          <div className="lbl">Need the agent</div>
        </Link>
        <Link to="/calendar" className="card pad stat">
          <div className="kicker">Next up</div>
          <div className="num" style={{ fontSize: 18, paddingTop: 6 }}>
            {nextUp.soon[0] ? formatShortDate(nextUp.soon[0].date).replace(/^.+, /, '') : '—'}
          </div>
          <div className="lbl">{nextUp.soon[0]?.title || 'Connect family calendar'}</div>
        </Link>
      </div>

      <div className="section-head">
        <h2>Needs attention</h2>
      </div>
      <div className="attention">
        <Link to={`/parties/${PARTY.id}`}>
          <span className="dot rose" />
          <div>
            <strong>{openRsvps} families still haven’t RSVP’d</strong>
            <div className="dim">The board is on the party desk, including Leila.</div>
          </div>
        </Link>
        <Link to="/inbox">
          <span className="dot teal" />
          <div>
            <strong>{inboxN} notes waiting to be filed</strong>
            <div className="dim">COO / agent files Bills, Shopping, and School. You confirm.</div>
          </div>
        </Link>
        <Link to="/meals">
          <span className="dot" />
          <div>
            <strong>This week’s meals</strong>
            <div className="dim">School lunches on weekdays. Infants stay on baby foods.</div>
          </div>
        </Link>
      </div>
    </div>
  )
}
