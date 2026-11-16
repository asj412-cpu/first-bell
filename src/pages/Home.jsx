import { Link } from 'react-router-dom'
import { useState } from 'react'
import { currentWeeks, planForDate } from '../data/learning/index.js'
import { PARTY } from '../data/seed.js'
import Avatar from '../components/Avatar.jsx'
import { turnsLabel } from '../lib/birthdays.js'
import { eventClockLabel, eventWhenLabel, isFinished, splitEvents } from '../lib/events.js'
import { formatShortDate, greeting, parseLocalDate } from '../lib/format.js'
import { motifFor } from '../lib/motifs.js'
import { buildNextUp } from '../lib/nextup.js'
import { currentWeekStart } from '../lib/planner.js'
import { useBell } from '../lib/store.jsx'
import { chicagoTodayIso } from '../lib/time.js'
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
  return eventClockLabel(item)
}

export default function Home() {
  const { state, planSuggestion, notify, addTask, toggleTask, suggestWeek } = useBell()
  const [chore, setChore] = useState('')
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
  const today = chicagoTodayIso()
  const learningNow = currentWeeks(today)

  return (
    <div>
      <h1 className="casa-greet">{greeting()}, Johnsons</h1>
      {learningNow.map((week) => {
        const kid = state.profiles.find((profile) => profile.memberKey === week.kidKey)
        const plan = planForDate(week, today)
        return (
          <Link key={week.id} to={`/learning/${week.kidKey}?week=${week.weekStart}`} className="card pad learn-home">
            <div className="kicker">This week’s learning</div>
            <h2>{kid?.name || week.kidKey}</h2>
            <p className="when">{week.title}</p>
            {plan && <p className="muted">{plan.label}. {plan.doTogether}</p>}
          </Link>
        )
      })}
      <div className="casa-hero" role="img" aria-label="The house at dusk" />

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
            <p className="when">{weekdayDate(featured.date)} · {eventClockLabel(featured)}</p>
          </div>
          {featuredPlanned ? (
            <Link to="/calendar" className="btn small primary">On the calendar</Link>
          ) : (
            <button
              className="btn small primary"
              type="button"
              onClick={() => {
                planSuggestion(featured)
                notify('Added to the calendar')
              }}
            >
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
            if (planned) {
              return (
                <Link key={item.key} to="/calendar" className="season-card">
                  <img src={motifFor(item)} alt="" />
                  <strong>{item.title}</strong>
                  <span>{formatShortDate(item.date)} · On the calendar</span>
                </Link>
              )
            }
            return (
              <button
                key={item.key}
                className="season-card"
                type="button"
                onClick={() => {
                  planSuggestion(item)
                  notify('Added to the calendar')
                }}
              >
                <img src={motifFor(item)} alt="" />
                <strong>{item.title}</strong>
                <span>{formatShortDate(item.date)} · {planLabel(item)}</span>
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
              const body = (
                <>
                  <Avatar name={item.who || item.title} seed={item.memberKey || item.who} />
                  <strong>{item.who || item.title}</strong>
                  <span>{turnsLabel(item.turns)}{planned ? ' · on the calendar' : ''}</span>
                </>
              )
              if (planned) {
                return (
                  <Link key={item.key} to="/calendar" className="bday-chip">
                    {body}
                  </Link>
                )
              }
              return (
                <button
                  key={item.key}
                  className="bday-chip"
                  type="button"
                  onClick={() => {
                    planSuggestion(item)
                    notify('Birthday added to the calendar')
                  }}
                >
                  {body}
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
        <h2>Tasks</h2>
        <Link to="/settings" className="dim">Household</Link>
      </div>
      <form
        className="chore-add"
        onSubmit={(event) => {
          event.preventDefault()
          addTask(chore)
          setChore('')
        }}
      >
        <label className="field">
          <span className="sr">New chore</span>
          <input
            value={chore}
            onChange={(event) => setChore(event.target.value)}
            placeholder="Add a chore for the house"
          />
        </label>
        <button className="btn small primary" type="submit">Add</button>
      </form>
      {(state.tasks || []).length === 0 ? (
        <div className="card pad empty">
          <p className="muted" style={{ margin: 0 }}>Nothing on the list yet. Add the next thing the house needs done.</p>
        </div>
      ) : (
        <ul className="chore-list">
          {(state.tasks || []).map((task) => (
            <li key={task.id}>
              <label>
                <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
                <span className={task.done ? 'done' : ''}>{task.title}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="section-head">
        <h2>Meals</h2>
        <Link to="/meals">This week</Link>
      </div>
      <div className="card pad">
        <p className="muted" style={{ marginTop: 0 }}>
          Weekday breakfasts are grab-and-go. Drew eats with the family.
        </p>
        <button
          className="btn small primary"
          type="button"
          onClick={() => {
            suggestWeek(currentWeekStart())
            notify('This week’s meals are ready')
          }}
        >
          Plan this week
        </button>
      </div>

      <div className="section-head">
        <h2>Family & friends</h2>
      </div>
      <div className="stats">
        <Link to="/family" className="card pad stat">
          <div className="kicker">Shared planning</div>
          <div className="lbl">Events, gift lists, and invites</div>
        </Link>
        <Link to="/parties" className="card pad stat">
          <div className="kicker">Events</div>
          <div className="num">{partyDone ? history.filter((event) => event.partyId).length : upcoming.filter((event) => event.partyId).length}</div>
          <div className="lbl">{partyDone ? 'In history' : 'Coming up'}</div>
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
            <div className="dim">Weekday breakfasts are grab-and-go. Drew eats with the family.</div>
          </div>
        </Link>
      </div>
    </div>
  )
}
