import { useState } from 'react'
import { Link } from 'react-router-dom'
import { IconBack } from '../components/Icons.jsx'
import { CATALOG_TABS, ageFits, moneyLabel, normalizeCatalogItem } from '../lib/catalog.js'
import { safeMedia } from '../lib/kidGifts.js'
import { ageInYears, ageLabel, kidProfiles } from '../lib/planner.js'
import { useBell } from '../lib/store.jsx'

const AGE_FIT = /^\d+(-\d+)?$/

function blankPicture(sort) {
  return normalizeCatalogItem({
    id: crypto.randomUUID(),
    name: 'New picture',
    category: 'toys',
    ageFit: '4-8',
    retailer: '',
    price: null,
    url: '',
    image: '',
    active: false,
    sort,
  })
}

function CatalogCard({ item, kids, onSave, onRemove }) {
  const [draft, setDraft] = useState(item)
  const [error, setError] = useState('')
  const image = safeMedia(draft.image, 'image')
  const fits = kids.filter((kid) => ageFits(draft.ageFit, ageInYears(kid.birthDate)))

  function patch(next) {
    setDraft((current) => ({ ...current, ...next }))
    setError('')
  }

  function save() {
    const next = normalizeCatalogItem(draft)
    if (!next.name) {
      setError('Add a name.')
      return
    }
    if (!AGE_FIT.test(next.ageFit)) {
      setError('Age looks like 4 or 4-7.')
      return
    }
    onSave(next)
    setDraft(next)
    setError('')
  }

  return (
    <article className="card pad catalog-card">
      <div className="catalog-head">
        {image ? <img className="catalog-photo" src={image} alt="" /> : <div className="catalog-photo empty" />}
        <div>
          <div className="kicker">{draft.category}</div>
          <h2 style={{ marginTop: 2 }}>{draft.name || 'Picture'}</h2>
          <p className="dim" style={{ margin: '4px 0 0' }}>
            {fits.length ? `Shows for ${fits.map((kid) => kid.name).join(', ')}` : 'Hidden by age'}
            {draft.active === false ? ' · off' : ''}
          </p>
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Name</span>
          <input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={draft.category} onChange={(event) => patch({ category: event.target.value })}>
            {CATALOG_TABS.map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.speak}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Ages</span>
          <input value={draft.ageFit} placeholder="4-7" onChange={(event) => patch({ ageFit: event.target.value.replace(/\s/g, '') })} />
        </label>
        <label className="field">
          <span>Store</span>
          <input value={draft.retailer} onChange={(event) => patch({ retailer: event.target.value })} />
        </label>
        <label className="field">
          <span>Price</span>
          <input
            inputMode="decimal"
            value={draft.price ?? ''}
            placeholder={moneyLabel(item.price)}
            onChange={(event) => patch({ price: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Picture</span>
          <input value={draft.image} placeholder="/catalog/train.jpg" onChange={(event) => patch({ image: event.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Link</span>
        <input value={draft.url} placeholder="https://" onChange={(event) => patch({ url: event.target.value })} />
      </label>
      <div className="meta-row">
        <button className={`btn small ${draft.active ? 'primary' : ''}`} type="button" aria-pressed={draft.active} onClick={() => patch({ active: !draft.active })}>
          {draft.active ? 'On the iPads' : 'Off the iPads'}
        </button>
        <button className="btn small primary" type="button" onClick={save}>Save</button>
        <button className="btn small ghost" type="button" onClick={onRemove}>Remove</button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </article>
  )
}

export default function Catalog() {
  const { state, saveCatalogItem, removeCatalogItem } = useBell()
  const kids = kidProfiles(state.profiles)
  const rows = [...(state.catalog || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">Christmas</div>
      <h1>Picture catalog</h1>
      <p className="lede">These are the pictures on the kids’ iPads. Each kid only sees pictures that fit their age. A heart adds that picture to their list, with the store link already attached. You still approve it before the family link.</p>
      <p className="dim">
        {kids.map((kid) => `${kid.name} ${ageLabel(kid.birthDate)}`).join(' · ')}
      </p>
      {rows.map((item) => (
        <CatalogCard
          key={item.id}
          item={item}
          kids={kids}
          onSave={saveCatalogItem}
          onRemove={() => removeCatalogItem(item.id)}
        />
      ))}
      <button
        className="btn"
        type="button"
        onClick={() => {
          const sort = rows.reduce((max, item) => Math.max(max, item.sort ?? 0), -1) + 1
          saveCatalogItem(blankPicture(sort))
        }}
      >
        Add a picture
      </button>
    </div>
  )
}
