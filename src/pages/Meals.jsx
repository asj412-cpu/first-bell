import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import { ADDED_SUGAR_MEAL_CAP_G, GUIDANCE_SOURCES, PROTEIN_GOAL } from '../data/guidance.js'
import { mealById } from '../data/meals.js'
import { HOUSEHOLD } from '../data/seed.js'
import {
  FAMILY_SLOTS,
  FLAVOR_LABEL,
  SEASON_PRODUCE,
  SEASONAL_MEAL_SHARE,
  allergenKeys,
  currentWeekStart,
  grabAndGoForWeek,
  isSchoolDay,
  planStats,
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
}

function proteinLabel(item) {
  if (!item?.proteinAnchor || item.proteinGrams == null) return null
  return `${item.proteinAnchor} · about ${item.proteinGrams} g`
}

export default function Meals() {
  const { state, suggestWeek, swapMeal, toggleMealLock, toggleGrocery } = useBell()
  const [weekStart, setWeekStart] = useState(() => currentWeekStart())
  const [picked, setPicked] = useState(null)
  const note = useMemo(() => planningNote(state.profiles), [state.profiles])
  const slots = state.mealPlans[weekStart]
  const dates = weekDates(weekStart)
  const season = seasonForIso(weekStart)
  const allergens = useMemo(() => allergenKeys(state.profiles), [state.profiles])
  const grabs = useMemo(() => grabAndGoForWeek(weekStart, undefined, allergens), [weekStart, allergens])
  const stats = useMemo(() => (slots ? planStats(slots) : null), [slots])
  const grocery = state.grocery[weekStart] || []
  const grouped = grocery.reduce((acc, item) => {
    acc[item.aisle] = acc[item.aisle] || []
    acc[item.aisle].push(item)
    return acc
  }, {})
  const infantNames = note.infants.map((kid) => kid.name)
  const meal = picked ? mealById(picked) : null

  function shareList() {
    const lines = [`Mi Casa grocery · week of ${formatShortDate(weekStart)}`, '']
    lines.push('Weekday breakfasts are grab-and-go, not cooked recipes.')
    lines.push('')
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

  return (
    <div className="meals-page">
      <div className="kicker">Meals</div>
      <h1>This week</h1>
      <p className="lede">
        {season[0].toUpperCase() + season.slice(1)} in Texas
        {' · '}
        {SEASON_PRODUCE[season].join(', ')}.
        {' '}
        Dinners and weekend breakfasts start with a protein. Monday through Friday breakfast is grab-and-go.
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
              {kid.band === 'infant' ? ' · eats with the family' : kid.band ? ` · ${kid.band}` : ''}
            </span>
          </div>
        ))}
        <p className="dim" style={{ margin: '8px 0 0' }}>
          {note.schoolKids.length
            ? `School lunches on weekdays are for ${note.schoolKids.map((kid) => kid.name).join(' and ')}.`
            : 'No school-age kids on file.'}
          {infantNames.length
            ? ` ${infantNames.join(' and ')} ${infantNames.length === 1 ? 'eats' : 'eat'} the family meal. Open a soft plate for a purée note. There is no separate baby menu.`
            : ''}
          {' '}
          Allergies are blank until you add them in <Link to="/settings">Settings</Link>.
        </p>
      </div>

      <section className="card pad grab-card">
        <div className="kicker">Monday–Friday breakfast</div>
        <h2>Grab-and-go</h2>
        <p className="muted">
          No cooking on the way out the door. Yogurt, milk, cheese, and toast are ready as they are. Eggs, egg bites, and muffins are made ahead. This week’s four options rotate. Saturday and Sunday breakfasts are cooked.
        </p>
        <ul className="grab-list">
          {grabs.map((option) => (
            <li key={option.id}>
              <button className="plan-name" onClick={() => setPicked(option.id)}>{option.title}</button>
              {proteinLabel(option) ? <span className="chip teal">{proteinLabel(option)}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="cal-toolbar" style={{ marginTop: 16 }}>
        <button className="icon-btn" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} aria-label="Previous week">‹</button>
        <h2>Week of {formatShortDate(weekStart)}</h2>
        <button className="icon-btn" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} aria-label="Next week">›</button>
      </div>
      <div className="meta-row">
        <button className="btn small primary" onClick={() => suggestWeek(weekStart)}>Suggest week</button>
        <button className="btn small ghost" onClick={() => setWeekStart(currentWeekStart())}>This week</button>
      </div>
      {stats && (
        <p className="dim season-share">
          Seasonal flavors: {stats.seasonal} of {stats.planned} planned meals
          {' '}
          (cap {stats.cap}, {Math.round(SEASONAL_MEAL_SHARE * 100)}%).
          {Object.keys(stats.flavors).length
            ? ` ${Object.entries(stats.flavors).map(([flavor, count]) => `${FLAVOR_LABEL[flavor] || flavor} ${count}`).join(', ')}.`
            : ''}
        </p>
      )}

      {!slots && (
        <div className="card pad empty" style={{ marginTop: 14 }}>
          <p className="muted" style={{ margin: 0 }}>Suggest a week to fill lunches, dinners, and weekend breakfasts. Locked meals stay put.</p>
        </div>
      )}

      {slots && dates.map((date) => (
        <DayCard
          key={date}
          date={date}
          slots={slots}
          onPick={setPicked}
          onSwap={(slot) => swapMeal(weekStart, date, slot)}
          onLock={(slot) => toggleMealLock(weekStart, date, slot)}
        />
      ))}

      {meal && (
        <div className="card pad" style={{ marginTop: 14 }}>
          <div className="kicker">
            {meal.minutes ? `${meal.minutes} min · ` : ''}
            {meal.category ? meal.category.replace('-', ' ') : 'Grab-and-go'}
          </div>
          <h2 style={{ marginTop: 4 }}>{meal.title}</h2>
          {proteinLabel(meal) ? <span className="chip teal">{proteinLabel(meal)}</span> : null}
          {meal.flavor ? <span className="chip gold" style={{ marginLeft: 6 }}>{FLAVOR_LABEL[meal.flavor] || meal.flavor}</span> : null}
          <p className="muted">{meal.blurb}</p>
          {meal.proteinBasis ? <p className="dim protein-basis">{meal.proteinBasis}</p> : null}
          {meal.pureeOk && infantNames.length > 0 && (
            <p className="puree-hint">Purée for {infantNames.join(' and ')}: mash a small spoon of the soft part. No honey and no added salt.</p>
          )}
          {meal.steps?.length > 0 && (
            <ol className="meal-steps">
              {meal.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}
        </div>
      )}

      <details className="about-meals" open>
        <summary>About these meals</summary>
        <p>
          Planned from the Dietary Guidelines for Americans, 2025–2030, the HHS and USDA Make America Healthy Again reset. The message is to eat real food: prioritize protein at every meal, choose whole or minimally processed foods, and limit highly processed foods and added sugars.
        </p>
        <p>
          Protein target in the Guidelines: {PROTEIN_GOAL}, adjusted for the person. Added sugars are not recommended; if any are used, one meal should contain no more than {ADDED_SUGAR_MEAL_CAP_G} grams. Full-fat dairy on this plan is plain, with no added sugar.
        </p>
        <p>
          Grams on a card are approximate for the protein anchor portion only, from USDA FoodData Central. They are not a laboratory analysis of the whole plate. Seasonal flavors such as pumpkin or peppermint stay at or under {Math.round(SEASONAL_MEAL_SHARE * 100)}% of planned meals, and the same flavor is not placed back to back.
        </p>
        <p className="dim">
          {GUIDANCE_SOURCES.map((source, index) => (
            <span key={source.id}>
              {index > 0 ? ' · ' : 'Sources: '}
              <a href={source.href}>{source.label}</a>
            </span>
          ))}
        </p>
      </details>

      <div className="section-head" id="grocery">
        <h2>Grocery list</h2>
        <span className="dim">{HOUSEHOLD.name}</span>
      </div>
      <p className="dim">Weekday breakfasts add the grab-and-go foods once. They do not add a cooked breakfast for every school morning.</p>
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

function DayCard({ date, slots, onPick, onSwap, onLock }) {
  const school = isSchoolDay(date)
  return (
    <section className="day-plan card">
      <h3>
        {formatShortDate(date)}
        {school ? <span className="dim"> · school day</span> : <span className="dim"> · weekend</span>}
      </h3>
      {FAMILY_SLOTS.map((slot) => {
        const cell = slots[date]?.[slot]
        const grab = Boolean(cell?.grabAndGo) || (slot === 'breakfast' && school)
        const recipe = !grab && cell?.mealId ? mealById(cell.mealId) : null
        return (
          <div key={slot} className={`slot-row ${cell?.locked ? 'locked' : ''}`}>
            <div className="slot-k">{SLOT_LABEL[slot]}</div>
            <div className="slot-body">
              {grab && (
                <>
                  <strong>Grab-and-go</strong>
                  <span className="dim">No recipe to cook</span>
                </>
              )}
              {!grab && recipe && (
                <>
                  <button className="plan-name" onClick={() => onPick(recipe.id)}>{recipe.title}</button>
                  <div className="slot-meta">
                    {proteinLabel(recipe) ? <span className="chip teal">{proteinLabel(recipe)}</span> : null}
                    {recipe.seasonalTheme && recipe.flavor ? (
                      <span className="chip gold">{FLAVOR_LABEL[recipe.flavor] || recipe.flavor}</span>
                    ) : null}
                    {school && slot === 'lunch' ? <span className="chip gold">School lunch</span> : null}
                  </div>
                  <div className="plan-actions">
                    <button onClick={() => onSwap(slot)} disabled={cell.locked}>Swap</button>
                    <button onClick={() => onLock(slot)}>{cell.locked ? 'Locked' : 'Lock'}</button>
                  </div>
                </>
              )}
              {!grab && !recipe && <span className="dim">Open</span>}
            </div>
          </div>
        )
      })}
    </section>
  )
}
