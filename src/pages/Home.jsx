import { Link } from 'react-router-dom'
import { PARTY } from '../data/seed.js'
import Avatar from '../components/Avatar.jsx'
import { turnsLabel } from '../lib/birthdays.js'
import { eventWhenLabel, isFinished, splitEvents } from '../lib/events.js'
import { formatShortDate, greeting, parseLocalDate } from '../lib/format.js'
import { ordinal } from '../lib/milestones.js'
import { addDaysIso } from '../lib/time.js'
import { motifFor } from '../lib/motifs.js'
import { buildNextUp, MILESTONE_CHECKLIST } from '../lib/nextup.js'
import { useBell } from '../lib/store.jsx'
import { IconArrow } from '../components/Icons.jsx'

function weekdayDate(iso) {
  return parseLocalDate(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function planLabel(item) {
  if (item.source === 'birthday') return turnsLabel(item.turns)
  if (item.allDay) return 'All day'
  return eventWhenLabel(item)
}

function countdownCopy(days) {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${days} days`
}

function MilestoneCard({ group, events, onStep }) {
  const { lead, milestones, companions, days, countdownOpen, date } = group
  const opens = addDaysIso(date, -90)
  return (
    <article className={`milestone-hero ${countdownOpen ? 'open' : ''}`}>
      <div className="confetti" aria-hidden="true">
        <span /><span /><span /><span /><span /><span /><span />
      </div>
      <div className="milestone-copy">
        <span className="milestone-badge">Milestone</span>
        {milestones.map((person) => (
          <h2 key={person.key}>{person.who}’s {ordinal(person.turns)}</h2>
        ))}
        <p className="when">{weekdayDate(date)}</p>
        <p className="milestone-count">{countdownCopy(days)}</p>
        <p className="milestone-window">
          {countdownOpen
            ? 'Countdown is on for the 90 days before.'
            : `The 90-day countdown starts ${weekdayDate(opens)}.`}
        </p>
        {companions.length > 0 && (
          <p className="shared-day">
            {companions.map((person) => `${person.who} turns ${person.turns}`).join(' and ')} the same day.
          </p>
        )}
        <div className="milestone-actions">
          {milestones.map((person) => {
            const plan = events.find((event) => event.id === `plan-${person.key}`)
            return MILESTONE_CHECKLIST.map((step) => {
              const done = plan?.checklist?.some((item) => item.id === step.id && item.done)
              return (
                <button
                  key={`${person.key}-${step.id}`}
                  className={`btn small ${done ? 'done' : ''}`}
                  type="button"
                  onClick={() => onStep({ ...person, milestone: true, milestoneTitle: `${person.who}’s ${ordinal(person.turns)}` }, step.id)}
                >
                  {done ? `${step.text} · on the calendar` : step.text}
                </button>
              )
            })
          })}
        </div>
      </div>
      <img src={motifFor(lead)} alt="" />
    </article>
  )
}

export default function Home() {
  const { state, planSuggestion, markMilestoneStep } = useBell()
  const openRsvps = state.guests.filter((guest) => guest.status === 'none').length
  const inboxN = state.messages.filter((message) => message.folder === 'inbox' && message.attention).length
  const { upcoming, history } = splitEvents(state.events)
  const nextUp = buildNextUp({ imports: state.imports, profiles: state.profiles })
  const party = state.events.find((event) => event.partyId === PARTY.id)
  const partyDone = party ? isFinished(party) : true
  const nextEvent = upcoming[0]
  const connected = (state.imports || []).length > 0
  const [featured, ...rest] = nextUp.soon
  const featuredPlanned = featured ? state.events.some((event) => event.id === `plan-${featured.key}`) : false

  return (
    <div>
      <h1 className="casa-greet">{greeting()}, Johnsons</h1>
      <div className="casa-hero" role="img" aria-label="The house at dusk" />

      {nextUp.milestones?.length > 0 && (
        <section className="milestone-list" aria-label="Milestone birthdays">
          {nextUp.milestones.map((group) => (
            <MilestoneCard
              key={group.date}
              group={group}
              events={state.events}
              onStep={markMilestoneStep}
            />
          ))}
        </section>
      )}

      {!connected && (
        <div className="banner">
          Connect family calendar. Imported events show up here after the COO adds them. Nothing on this list is made up.
        </div>
      )}

      {featured ? (
        <article className="featured-next">
          <img src={motifFor(featured)} alt="" />
          <div>
            <h2>{featured.title}</h2>
            <p className="when">{weekdayDate(featured.date)}</p>
          </div>
          {featuredPlanned ? (
            <Link to="/calendar" className="btn small">On the calendar</Link>
          ) : (
            <button className="btn small" type="button" onClick={() => planSuggestion(featured)}>
              Plan this
            </button>
          )}
        </article>
      ) : (
        <div className="card pad empty">
          <p className="muted" style={{ margin: 0 }}>Connect family calendar</p>
        </div>
      )}

      {rest.length > 0 && (
        <div className="season-row">
          {rest.map((item) => {
            const planned = state.events.some((event) => event.id === `plan-${item.key}`)
            return (
              <button key={item.key} className="season-card" type="button" onClick={() => !planned && planSuggestion(item)}>
                <img src={motifFor(item)} alt="" />
                <strong>{item.title}</strong>
                <span>{formatShortDate(item.date)} · {planned ? 'On the calendar' : planLabel(item)}</span>
              </button>
            )
          })}
        </div>
      )}

      {nextUp.birthdays.length > 0 && (
        <>
          <div className="section-head">
            <h2>Family birthdays</h2>
          </div>
          <div className="bday-row">
            {nextUp.birthdays.map((item) => {
              const planned = state.events.some((event) => event.id === `plan-${item.key}`)
              return (
                <button key={item.key} className="bday-chip" type="button" onClick={() => !planned && planSuggestion(item)}>
                  <Avatar name={item.who || item.title} seed={item.memberKey || item.who} />
                  <strong>{item.who || item.title}</strong>
                  <span>{turnsLabel(item.turns)}{planned ? ' · planned' : ''}</span>
                </button>
              )
            })}
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
            <IconArrow style={{ width: 18, height: 18, color: 'var(--terracotta)' }} />
          </div>
        </Link>
      )}

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
