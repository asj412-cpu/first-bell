import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import { mealById } from '../data/meals.js'
import { HOUSEHOLD } from '../data/seed.js'
import {
  BABY_SLOTS,
  FAMILY_SLOTS,
  SEASON_PRODUCE,
  ageLabel,
  currentWeekStart,
  isSchoolDay,
  planningNote,
  seasonForIso,
  shiftWeek,
} from '../lib/planner.js'
import { weekDates } from '../lib/time.js'
import { formatShortDate } from '../lib/format.js'
import { useBell } from '../lib/store.jsx'

const SLOT_LABEL = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  babyBreakfast: 'Breakfast',
  babyLunch: 'Lunch',
  babyDinner: 'Dinner',
}

export default function Meals() {
  const { state, suggestWeek, swapMeal, toggleMealLock, toggleGrocery } = useBell()
  const [weekStart, setWeekStart] = useState(() => currentWeekStart())
  const [picked, setPicked] = useState(null)
  const note = useMemo(() => planningNote(state.profiles), [state.profiles])
  const slots = state.mealPlans[weekStart]
  const dates = weekDates(weekStart)
  const season = seasonForIso(weekStart)
  const grocery = state.grocery[weekStart] || []
  const grouped = grocery.reduce((acc, item) => {
    acc[item.aisle] = acc[item.aisle] || []
    acc[item.aisle].push(item)
    return acc
  }, {})

  function shareList() {
    const lines = [`Mi Casa grocery · week of ${formatShortDate(weekStart)}`, '']
    for (const [aisle, items] of Object.entries(grouped)) {
      lines.push(aisle)
      for (const item of items) {
        lines.push(`${item.checked ? '[x]' : '[ ]'} ${item.name}${item.qty?.length ? ` — ${item.qty.join(' + ')}` : ''}`)
      }
      lines.push('')
    }
    const text = lines.join('\n')
    if (navigator.share) {
      navigator.share({ title: 'Mi Casa grocery', text }).catch(() => {})
      return
    }
    navigator.clipboard?.writeText(text)
  }

  useEffect(() => {
    if (!state.mealPlans[weekStart]) suggestWeek(weekStart)
  }, [weekStart, state.mealPlans, suggestWeek])

  const meal = picked ? mealById(picked) : null

  return (
    <div className="meals-page">
      <div className="kicker">Meals</div>
      <h1>This week</h1>
      <p className="lede">
        {season[0].toUpperCase() + season.slice(1)} in Texas
        {' · '}
        {SEASON_PRODUCE[season].join(', ')}.
      </p>

      <div className="card pad" style={{ marginTop: 14 }}>
        {note.kids.map((kid) => (
          <div className="row-between" key={kid.memberKey} style={{ marginBottom: 6 }}>
            <span className="kid-line">
              <Avatar name={kid.name || kid.fullName} seed={kid.memberKey} />
              <strong>{kid.fullName}</strong>
            </span>
            <span className="dim">
              {kid.label || 'Birthday not set'}
              {kid.grade ? ` · ${kid.grade}` : ''}
              {kid.band === 'infant' ? ' · baby foods' : kid.band ? ` · ${kid.band}` : ''}
            </span>
          </div>
        ))}
        <p className="dim" style={{ margin: '8px 0 0' }}>
          {note.schoolKids.length
            ? `School lunches on weekdays are for ${note.schoolKids.map((kid) => kid.name).join(' and ')}.`
            : 'No school-age kids on file.'}
          {note.infants.length
            ? ` ${note.infants.map((kid) => kid.name).join(' and ')} ${note.infants.length === 1 ? 'gets' : 'get'} baby foods only, including on school days.`
            : ''}
          {' '}
          Allergies are blank until you add them in <Link to="/settings">Settings</Link>.
        </p>
      </div>

      <div className="cal-toolbar" style={{ marginTop: 16 }}>
        <button className="icon-btn" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} aria-label="Previous week">‹</button>
        <h2>Week of {formatShortDate(weekStart)}</h2>
        <button className="icon-btn" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} aria-label="Next week">›</button>
      </div>
      <div className="meta-row">
        <button className="btn small primary" onClick={() => suggestWeek(weekStart)}>Suggest week</button>
        <button className="btn small ghost" onClick={() => setWeekStart(currentWeekStart())}>This week</button>
      </div>

      {!slots && (
        <div className="card pad empty" style={{ marginTop: 14 }}>
          <p className="muted" style={{ margin: 0 }}>Suggest a week to fill breakfast, lunch, and dinner. Locked meals stay put.</p>
        </div>
      )}

      {slots && (
        <>
          <PlanGrid title="Family table" dates={dates} slots={slots} names={FAMILY_SLOTS} onPick={setPicked} onSwap={(date, slot) => swapMeal(weekStart, date, slot)} onLock={(date, slot) => toggleMealLock(weekStart, date, slot)} />
          {note.infants.length > 0 && slots[dates[0]]?.babyBreakfast && (
            <PlanGrid
              title={`${note.infants.map((kid) => `${kid.name} · ${kid.label}`).join(', ')} · baby foods`}
              dates={dates}
              slots={slots}
              names={BABY_SLOTS}
              baby
              onPick={setPicked}
              onSwap={(date, slot) => swapMeal(weekStart, date, slot)}
              onLock={(date, slot) => toggleMealLock(weekStart, date, slot)}
            />
          )}
        </>
      )}

      {meal && (
        <div className="card pad" style={{ marginTop: 14 }}>
          <div className="kicker">{meal.minutes} min · {meal.category.replace('-', ' ')}</div>
          <h2 style={{ marginTop: 4 }}>{meal.title}</h2>
          <p className="muted">{meal.blurb}</p>
          <ol className="meal-steps">
            {meal.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}

      <div className="section-head" id="grocery">
        <h2>Grocery list</h2>
        <span className="dim">{HOUSEHOLD.name}</span>
      </div>
      <div className="meta-row no-print">
        <button className="btn small" onClick={shareList} disabled={!grocery.length}>Share</button>
        <button className="btn small ghost" onClick={() => window.print()} disabled={!grocery.length}>Print</button>
      </div>
      {!grocery.length && <div className="card pad empty"><p className="muted" style={{ margin: 0 }}>The list fills in when you suggest a week.</p></div>}
      <div className="grocery-print">
        {Object.entries(grouped).map(([aisle, items]) => (
          <div key={aisle} className="card pad" style={{ marginBottom: 10 }}>
            <div className="kicker">{aisle}</div>
            {items.map((item) => (
              <label className={`grocery-row ${item.checked ? 'done' : ''}`} key={item.id}>
                <input type="checkbox" checked={item.checked} onChange={() => toggleGrocery(weekStart, item.id)} />
                <span>
                  {item.name}
                  {item.qty?.length ? <em> · {item.qty.join(' + ')}</em> : null}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanGrid({ title, dates, slots, names, onPick, onSwap, onLock, baby = false }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 20 }}>{title}</h2>
      <div className="planner" role="table">
        <div />
        {dates.map((date) => (
          <div key={date} className="planner-head">
            {formatShortDate(date).replace(/, /, ' ').split(' ').slice(0, 2).join(' ')}
            {!baby && isSchoolDay(date) ? <span className="dim"> school</span> : null}
          </div>
        ))}
        {names.map((slot) => (
          <FragmentRow key={slot} slot={slot} dates={dates} slots={slots} onPick={onPick} onSwap={onSwap} onLock={onLock} baby={baby} />
        ))}
      </div>
    </section>
  )
}

function FragmentRow({ slot, dates, slots, onPick, onSwap, onLock, baby }) {
  return (
    <>
      <div className="planner-label">{SLOT_LABEL[slot]}</div>
      {dates.map((date) => {
        const cell = slots[date]?.[slot]
        const recipe = cell ? mealById(cell.mealId) : null
        const school = !baby && slot === 'lunch' && isSchoolDay(date)
        return (
          <div key={date + slot} className={`plan-cell ${cell?.locked ? 'locked' : ''}`}>
            {recipe ? (
              <button className="plan-name" onClick={() => onPick(recipe.id)}>{recipe.title}</button>
            ) : (
              <span className="dim">Open</span>
            )}
            {school && <span className="chip gold">School lunch</span>}
            {recipe && (
              <div className="plan-actions">
                <button onClick={() => onSwap(date, slot)} disabled={cell.locked}>Swap</button>
                <button onClick={() => onLock(date, slot)}>{cell.locked ? 'Locked' : 'Lock'}</button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
