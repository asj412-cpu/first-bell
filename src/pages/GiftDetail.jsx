import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import GiftItemFields from '../components/GiftItemFields.jsx'
import { IconBack } from '../components/Icons.jsx'
import WishCard from '../components/WishCard.jsx'
import { blankGiftItem, categoryLabel, PRICE_AS_OF, validateGiftItems, withGiftImages } from '../lib/exchange.js'
import { isUuid, listUsesLocalCatalog, presentItems } from '../lib/gifts.js'
import { cleanManagedRows, managedFor, managedLabel } from '../lib/managed.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

const FILTERS = ['All', 'Toys', 'Doll clothes', 'Clothes', 'Learning']

function matchesFilter(item, filter, dollSize) {
  if (filter === 'All') return true
  if (categoryLabel(item.category) !== filter) return false
  if (filter === 'Doll clothes' && dollSize) return item.dollSize === dollSize
  return true
}

export default function GiftDetail() {
  const { kidKey } = useParams()
  const { state, toggleKidMode, releaseClaim, saveOwnItems, saveManagedItems, updateManagedMember, removeManagedMember, notify } = useBell()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const list = state.giftLists.find((row) => row.kidKey === kidKey)
  const managed = list ? managedFor(state.managedMembers, list.id) : null
  const [saveError, setSaveError] = useState('')
  const [details, setDetails] = useState(null)
  const [detailsError, setDetailsError] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('All')
  const [dollSize, setDollSize] = useState('')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState(null)
  const [rowErrors, setRowErrors] = useState({})
  const [saving, setSaving] = useState(false)
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
  const openEditor = search.get('add') === '1'
  useEffect(() => {
    // Opened right after "Add a family member": go straight to adding gifts.
    if (openEditor && managed?.can_edit && !editing) {
      setRows([blankGiftItem()])
      setRowErrors({})
      setEditing(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEditor, managed?.can_edit])
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

  const catalog = items.some((item) => item.category && item.category !== 'Idea')
  const canEdit = managed
    ? Boolean(managed.can_edit)
    : list.listKind === 'exchange' && (guest || state.session?.demo || state.memberRole === 'owner')

  function startEdit() {
    const ideas = items.filter((item) => !item.sourceSlug)
    setRows(
      ideas.length
        ? ideas.map((item) => ({
            key: item.id,
            id: item.id,
            description: item.title,
            url: item.url || '',
          }))
        : [blankGiftItem()],
    )
    setRowErrors({})
    setEditing(true)
  }

  async function saveEdits(event) {
    event.preventDefault()
    const result = managed ? cleanManagedRows(rows, validateGiftItems) : validateGiftItems(rows)
    setRowErrors(result.errors)
    setSaveError('')
    if (!result.ok) {
      setSaveError(result.errors.items || 'Check the highlighted rows.')
      return
    }
    setSaving(true)
    try {
      const stored = await withGiftImages(result.items)
      if (managed) {
        await saveManagedItems(list.id, stored)
        notify(`Saved ${list.displayName}’s list`)
        setEditing(false)
        return
      }
      saveOwnItems(list.id, stored)
      if (supabase && state.backend === 'live' && isUuid(list.id)) {
        await supabase.rpc('save_my_gift_items', {
          p_list: list.id,
          p_items: stored.map((item) => ({
            id: isUuid(item.id) ? item.id : null,
            description: item.description,
            url: item.url,
            image: item.image,
          })),
        })
      }
      setEditing(false)
    } catch (err) {
      setSaveError(err?.message || 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function saveDetails(event) {
    event.preventDefault()
    if (!details.name.trim()) {
      setDetailsError('Enter their name.')
      return
    }
    setBusy(true)
    setDetailsError('')
    try {
      await updateManagedMember(list.id, details)
      notify('Saved')
      setDetails(null)
    } catch (err) {
      setDetailsError(err?.message || 'Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember() {
    if (!window.confirm(`Remove ${list.displayName} and their gift list?`)) return
    setBusy(true)
    setDetailsError('')
    try {
      await removeManagedMember(list.id)
      notify(`${list.displayName} was removed`)
      navigate('/gifts', { replace: true })
    } catch (err) {
      setDetailsError(err?.message || 'Could not remove them. Try again.')
      setBusy(false)
    }
  }

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">{list.occasion}</div>
      <h1>{list.displayName}</h1>
      {managed && (
        <p className="managed-by chip-row" style={{ margin: '4px 0 0' }}>
          <span className="chip">{managedLabel(managed)}</span>
        </p>
      )}
      {managed ? (
        <p className="lede">
          {managed.can_edit
            ? `${list.displayName} doesn’t need an account. Add, change, or remove their gift ideas here any time.`
            : `${list.displayName}’s gift ideas, kept by ${managed.manager_name}.`}
        </p>
      ) : list.kidKey === 'drew' ? (
        <p className="lede">Drew was born in February 2026. There are no catalog ideas for him yet. Add one when you think of it.</p>
      ) : (
        <p className="lede">
          {list.listKind === 'exchange'
            ? 'Your gifts. Open a link to see the page, and come back here any time to add or change a row.'
            : conceal
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
      {catalog && items.length > 0 && (
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
      {canEdit && !editing && (
        <button className="btn big" type="button" onClick={startEdit}>
          Add or edit items
        </button>
      )}
      {canEdit && editing && (
        <form className="card pad" onSubmit={saveEdits}>
          <h2>{managed ? `${list.displayName}’s items` : 'Your items'}</h2>
          <GiftItemFields
            items={rows}
            errors={rowErrors}
            onChange={(index, patch) => {
              const next = rows.slice()
              next[index] = { ...next[index], ...patch }
              setRows(next)
            }}
            onAdd={() => setRows([...rows, blankGiftItem()])}
            onRemove={(index) => {
              const next = rows.filter((_, item) => item !== index)
              setRows(next.length ? next : [blankGiftItem()])
            }}
          />
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          <div className="meta-row">
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save items'}
            </button>
            <button className="btn ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {managed?.can_edit && !editing && !details && (
        <div className="meta-row" style={{ marginTop: 12 }}>
          <button
            className="btn"
            type="button"
            onClick={() => setDetails({ name: list.displayName, relationship: managed.relationship || '', age: managed.age_label || '' })}
          >
            Edit {list.displayName}’s details
          </button>
          <button className="btn ghost" type="button" onClick={removeMember} disabled={busy}>
            Remove {list.displayName}
          </button>
        </div>
      )}
      {managed?.can_edit && details && (
        <form className="card pad" onSubmit={saveDetails}>
          <h2 style={{ marginTop: 0 }}>Details</h2>
          <label className="field">
            <span>Name</span>
            <input value={details.name} maxLength={80} onChange={(event) => setDetails({ ...details, name: event.target.value })} />
          </label>
          <label className="field">
            <span>Who they are (optional)</span>
            <input value={details.relationship} maxLength={40} onChange={(event) => setDetails({ ...details, relationship: event.target.value })} />
          </label>
          <label className="field">
            <span>Age (optional)</span>
            <input value={details.age} maxLength={20} inputMode="numeric" onChange={(event) => setDetails({ ...details, age: event.target.value })} />
          </label>
          <div className="meta-row">
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn ghost" type="button" onClick={() => setDetails(null)}>Cancel</button>
          </div>
        </form>
      )}
      {detailsError && <p className="form-error" role="alert">{detailsError}</p>}
    </div>
  )
}
