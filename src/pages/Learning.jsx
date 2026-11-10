import { Link, useParams, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import { planForDate, weekFor, weeksFor } from '../data/learning/index.js'
import { IconBack } from '../components/Icons.jsx'
import { formatShortDate } from '../lib/format.js'
import { currentWeekStart, shiftWeek } from '../lib/planner.js'
import { useBell } from '../lib/store.jsx'
import { mondayOnOrBefore } from '../lib/time.js'
import { planIsDone } from '../lib/vnextReducer.js'

function kidName(profiles, kidKey) {
  return profiles.find((profile) => profile.memberKey === kidKey)?.name || kidKey
}

function parseWeekParam(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return mondayOnOrBefore(value)
}

export default function Learning() {
  const { kidKey } = useParams()
  if (!kidKey) return <LearningIndex />
  return <LearningWeek kidKey={kidKey} />
}

function LearningIndex() {
  const { state } = useBell()
  const kids = state.profiles.filter((profile) => profile.role === 'kid')
  return (
    <div className="learning-page">
      <div className="kicker">At-home learning</div>
      <h1>Learning</h1>
      <p className="lede">
        Parent-led practice from the Monday Peek. Open a child to see that week. A child with no file yet stays on this list.
      </p>
      <div className="gift-index" style={{ marginTop: 16 }}>
        {kids.map((kid) => {
          const weeks = weeksFor(kid.memberKey)
          const latest = weeks[weeks.length - 1]
          return (
            <Link key={kid.memberKey} to={`/learning/${kid.memberKey}`} className="card pad gift-kid">
              <Avatar name={kid.name} seed={kid.memberKey} />
              <div>
                <div className="kicker">{latest ? latest.title : 'No week yet'}</div>
                <h2 style={{ marginTop: 2 }}>{kid.name}</h2>
                <p className="dim" style={{ margin: '4px 0 0' }}>
                  {latest ? `${latest.teacher} · ${latest.school}` : `No Peek week for ${kid.name} yet.`}
                </p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function LearningWeek({ kidKey }) {
  const { state, toggleLearningPlan } = useBell()
  const [params, setParams] = useSearchParams()
  const weekStart = parseWeekParam(params.get('week')) || currentWeekStart()
  const name = kidName(state.profiles, kidKey)
  const known = state.profiles.some((profile) => profile.memberKey === kidKey)
  const week = weekFor(kidKey, weekStart)
  const savedWeeks = weeksFor(kidKey)

  function setWeek(next) {
    const copy = new URLSearchParams(params)
    copy.set('week', next)
    setParams(copy)
  }

  if (!known) {
    return (
      <div className="learning-page">
        <Link to="/learning" className="back-link">
          <IconBack />
          Learning
        </Link>
        <div className="card pad empty" style={{ marginTop: 14 }}>
          <p className="muted" style={{ margin: 0 }}>
            No Peek week for this child yet.
          </p>
        </div>
      </div>
    )
  }

  const showDeviceNote =
    state.backend === 'live' && !state.learningRemote && (state.vnextReady || Boolean(state.vnextNote))

  return (
    <div className="learning-page">
      <Link to="/learning" className="back-link no-print">
        <IconBack />
        Learning
      </Link>
      <div className="kicker">At-home learning</div>
      <h1>{name}</h1>
      <p className="lede">{week ? week.peekLabel : 'Peek of the Week'}</p>
      {week && (
        <p className="dim" style={{ marginTop: 6 }}>
          {week.teacher} · {week.school}
        </p>
      )}

      <div className="cal-toolbar">
        <button className="icon-btn" type="button" onClick={() => setWeek(shiftWeek(weekStart, -1))} aria-label="Previous week">
          ‹
        </button>
        <h2>Week of {formatShortDate(weekStart)}</h2>
        <button className="icon-btn" type="button" onClick={() => setWeek(shiftWeek(weekStart, 1))} aria-label="Next week">
          ›
        </button>
      </div>
      <div className="meta-row no-print">
        <button className="btn small ghost" type="button" onClick={() => setWeek(currentWeekStart())}>
          This week
        </button>
        <button className="btn small ghost" type="button" onClick={() => window.print()} disabled={!week}>
          Print
        </button>
      </div>

      {showDeviceNote && (
        <p className="dim no-print">Checkmarks stay on this device until the learning table is applied.</p>
      )}

      {!week && (
        <div className="card pad empty" style={{ marginTop: 14 }}>
          <p className="muted" style={{ margin: 0 }}>
            No Peek week for {name} yet.
          </p>
          {savedWeeks.length > 0 && (
            <button
              className="btn small"
              type="button"
              style={{ marginTop: 12 }}
              onClick={() => setWeek(savedWeeks[savedWeeks.length - 1].weekStart)}
            >
              Open {savedWeeks[savedWeeks.length - 1].title}
            </button>
          )}
        </div>
      )}

      {week && (
        <WeekBody
          week={week}
          doneFor={(planId) => planIsDone(state.learningProgress, kidKey, week.weekStart, planId)}
          onToggle={(planId) => toggleLearningPlan(kidKey, week.weekStart, planId)}
        />
      )}
    </div>
  )
}

function WeekBody({ week, doneFor, onToggle }) {
  const activities = new Map((week.activities || []).map((activity) => [activity.id, activity]))
  return (
    <>
      <p className="lede">{week.summary}</p>

      <section className="learn-block" id="focus">
        <h2>This week’s focus</h2>
        <div className="learn-callout">
          <strong>{week.focus.calloutLead}</strong>
          <p>{week.focus.lead}</p>
        </div>
        <p>{week.focus.body}</p>
        <blockquote className="learn-quote">
          <p>{week.focus.homeworkQuote}</p>
          {week.focus.homeworkCite && <cite>{week.focus.homeworkCite}</cite>}
        </blockquote>
        <p>{week.focus.standingRoutine}</p>
      </section>

      <section className="learn-block" id="how">
        <h2>How to use this at home</h2>
        <p>{week.howTo.intro}</p>
        <ul className="learn-bullets">
          {(week.howTo.bullets || []).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="learn-block" id="plan">
        <h2>Weekday plan</h2>
        {week.planNote && <p className="dim">{week.planNote}</p>}
        <div className="learn-plan-list">
          {(week.plan || []).map((row) => (
            <article key={row.id} className={`card pad learn-plan ${doneFor(row.id) ? 'done' : ''}`}>
              <div className="kicker">{row.label}</div>
              <h3>{row.about}</h3>
              <p>{row.doTogether}</p>
              {row.activityIds?.length > 0 && (
                <p className="learn-plan-links">
                  {row.activityIds.map((id) => {
                    const activity = activities.get(id)
                    if (!activity) return null
                    return (
                      <a key={id} href={`#activity-${id}`}>
                        {activity.number}. {activity.title}
                      </a>
                    )
                  })}
                </p>
              )}
              <label className="learn-check">
                <input
                  type="checkbox"
                  checked={doneFor(row.id)}
                  aria-label={`We did this, ${row.label}`}
                  onChange={() => onToggle(row.id)}
                />
                <span>We did this.</span>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="learn-block" id="words">
        <h2>Word lists from UFLI Home Practice</h2>
        {week.wordsNote && <p className="dim">{week.wordsNote}</p>}
        <table className="learn-words">
          <thead>
            <tr>
              <th>Lesson</th>
              <th>Sample words</th>
              <th>Word-work chains</th>
              <th>Heart words</th>
              <th>Practice sentences</th>
            </tr>
          </thead>
          <tbody>
            {(week.wordLists || []).map((row) => (
              <tr key={row.lesson}>
                <td data-label="Lesson">{row.lesson}</td>
                <td data-label="Sample words">{row.sampleWords.join(', ')}</td>
                <td data-label="Word-work chains">{row.chains.join('; ')}</td>
                <td data-label="Heart words">{row.heartWords.join(', ')}</td>
                <td data-label="Practice sentences">{row.sentences.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="learn-block" id="activities">
        <h2>Activities</h2>
        {(week.activities || []).map((activity) => (
          <article key={activity.id} id={`activity-${activity.id}`} className="card pad learn-activity">
            <div className="kicker">Activity {activity.number}</div>
            <h3>
              {activity.number}. {activity.title}
            </h3>
            <dl className="learn-props">
              <div>
                <dt>Goal</dt>
                <dd>{activity.goal}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{activity.time}</dd>
              </div>
              <div>
                <dt>Materials</dt>
                <dd>{activity.materials}</dd>
              </div>
            </dl>
            <ol className="learn-steps">
              {(activity.steps || []).map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </li>
              ))}
            </ol>
            <p className="learn-variant">
              <strong>Easier. </strong>
              {activity.easier}
            </p>
            <p className="learn-variant">
              <strong>Harder. </strong>
              {activity.harder}
            </p>
            <p className="learn-gotit">
              <strong>Got it. </strong>
              {activity.gotIt}
            </p>
          </article>
        ))}
      </section>

      <section className="learn-block" id="extras">
        <h2>Optional extras</h2>
        {week.extrasIntro && <p>{week.extrasIntro}</p>}
        <ol className="learn-extras">
          {(week.extras || []).map((item) => (
            <li key={item.text}>
              {item.official === false && !/^extra\b/i.test(item.text) && <span className="chip">Extra</span>}
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
        <ul className="learn-links">
          {(week.links || []).map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noreferrer">
                <strong>{link.title}</strong>
                <span>{link.site}</span>
              </a>
            </li>
          ))}
        </ul>
        {(week.sources || []).length > 0 && (
          <ul className="learn-sources">
            {week.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
