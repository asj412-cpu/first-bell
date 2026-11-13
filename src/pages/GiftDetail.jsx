import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { IconBack } from '../components/Icons.jsx'
import WishCard from '../components/WishCard.jsx'
import { categoryLabel, PRICE_AS_OF } from '../lib/exchange.js'
import { listUsesLocalCatalog, presentItems, safeHttp } from '../lib/gifts.js'
import { useBell } from '../lib/store.jsx'

const FILTERS = ['All', 'Toys', 'Doll clothes', 'Clothes', 'Learning']

function matchesFilter(item, filter, dollSize) {
  if (filter === 'All') return true
  if (categoryLabel(item.category) !== filter) return false
  if (filter === 'Doll clothes' && dollSize) return item.dollSize === dollSize
  return true
}

export default function GiftDetail() {
  const { kidKey } = useParams()
  const { state, toggleKidMode, addNamedWish, releaseClaim } = useBell()
  const list = state.giftLists.find((row) => row.kidKey === kidKey)
  const [filter, setFilter] = useState('All')
  const [dollSize, setDollSize] = useState('')
  const [query, setQuery] = useState('')
  const [wish, setWish] = useState('')
  const [copied, setCopied] = useState(false)
  const guest = state.memberRole === 'gift'
  const ownExchange = Boolean(list && list.listKind === 'exchange' && (guest || (state.session?.demo && list.kidKey === 'andrew')))
  const conceal = state.kidMode || ownExchange || guest
  const items = presentItems(list, { conceal })
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (!matchesFilter(item, filter, dollSize)) return false
      if (!q) return true
      return `${item.title} ${item.retailer} ${item.notes}`.toLowerCase().includes(q)
    })
  }, [items, filter, dollSize, query])
  if (!list || ['santa', 'assignment', 'reminders'].includes(kidKey)) {
    if (kidKey && ['santa', 'assignment', 'reminders'].includes(kidKey)) return <Navigate to={`/gifts/${kidKey}`} replace />
    return <Navigate to="/gifts" replace />
  }
  const link = `${window.location.origin}/g/${list.shareSlug}`

  function copy() {
    const node = document.getElementById('share-link')
    node?.focus()
    node?.select?.()
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }).catch(() => setCopied(false))
  }

  function addWish(event) {
    event.preventDefault()
    const title = wish.trim()
    if (!title) return
    addNamedWish(list.id, title)
    setWish('')
  }

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">{list.occasion}</div>
      <h1>{list.displayName}</h1>
      {list.kidKey === 'drew' ? (
        <p className="lede">Drew was born in February 2026. There are no catalog ideas for him yet. Add one when you think of it.</p>
      ) : (
        <p className="lede">
          {conceal
            ? 'Ideas for Christmas. Nothing here shows what has already been bought.'
            : `Prices say “about” because they were checked on ${PRICE_AS_OF}, not today.`}
        </p>
      )}
      {!guest && (
        <div className="share-box">
          <label className="field" htmlFor="share-link">
            <span>Link for family</span>
            <input id="share-link" readOnly value={link} onFocus={(event) => event.target.select()} />
          </label>
          <button className="btn primary big" type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy the link'}
          </button>
          {list.listKind !== 'exchange' && (
            <button className={`btn ${state.kidMode ? 'primary' : ''}`} type="button" aria-pressed={state.kidMode} onClick={toggleKidMode}>
              {state.kidMode ? 'Kid view on' : 'Switch to kid view'}
            </button>
          )}
        </div>
      )}
      {listUsesLocalCatalog(list) && !conceal && (
        <div className="banner">Marks on this preview stay on this phone until the database update is approved.</div>
      )}
      {items.length > 0 && (
        <>
          <label className="field">
            <span>Find a gift</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Doll, book, sweater…" />
          </label>
          <div className="chip-row" role="tablist" aria-label="Categories">
            {FILTERS.map((name) => (
              <button
                key={name}
                type="button"
                className={`chip-btn ${filter === name ? 'on' : ''}`}
                aria-pressed={filter === name}
                onClick={() => {
                  setFilter(name)
                  setDollSize('')
                }}
              >
                {name}
              </button>
            ))}
          </div>
          {filter === 'Doll clothes' && (
            <div className="chip-row" aria-label="Doll size">
              <button type="button" className={`chip-btn ${dollSize === '' ? 'on' : ''}`} aria-pressed={dollSize === ''} onClick={() => setDollSize('')}>
                Any doll
              </button>
              <button type="button" className={`chip-btn ${dollSize === 'baby' ? 'on' : ''}`} aria-pressed={dollSize === 'baby'} onClick={() => setDollSize('baby')}>
                Baby doll
              </button>
              <button type="button" className={`chip-btn ${dollSize === 'toddler' ? 'on' : ''}`} aria-pressed={dollSize === 'toddler'} onClick={() => setDollSize('toddler')}>
                Bigger doll
              </button>
            </div>
          )}
          <p className="dim">{filtered.length} showing</p>
        </>
      )}
      <div className="wish-grid">
        {filtered.map((item) => (
          <WishCard
            key={item.id}
            item={item}
            conceal={conceal}
            onRelease={conceal ? null : () => releaseClaim(list.id, item.id)}
          />
        ))}
      </div>
      {filtered.length === 0 && items.length > 0 && <p className="lede">Nothing in this filter. Try another one.</p>}
      {(!state.kidMode || list.listKind === 'exchange') && (
        <form className="card pad" onSubmit={addWish}>
          <h2>Add an idea</h2>
          <label className="field">
            <span>Wish</span>
            <input value={wish} onChange={(event) => setWish(event.target.value)} placeholder="A soft book" />
          </label>
          <button className="btn primary" type="submit">Add to {list.displayName}</button>
          {safeHttp(items[0]?.url) ? null : null}
        </form>
      )}
    </div>
  )
}
