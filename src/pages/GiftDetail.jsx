import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { IconBack } from '../components/Icons.jsx'
import { safeHttp, visibleItems } from '../lib/gifts.js'
import { useBell } from '../lib/store.jsx'

export default function GiftDetail() {
  const { kidKey } = useParams()
  const { state, toggleKidMode, updateGiftItem, addGiftItem, deleteGiftItem, moveGiftItem, releaseClaim } = useBell()
  const list = state.giftLists.find((row) => row.kidKey === kidKey)
  const [copied, setCopied] = useState(false)
  if (!list) return <Navigate to="/gifts" replace />
  const items = visibleItems(list, state.kidMode)
  const hidden = list.items.length - items.length
  const link = `${window.location.origin}/g/${list.shareSlug}`

  function copy() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">{list.occasion}</div>
      <h1>{list.displayName}</h1>
      <p className="lede">Edit the wishes, then send the link. Claims show here unless kid mode is on.</p>
      <div className="meta-row" style={{ margin: '12px 0 16px' }}>
        <button className="btn small primary" onClick={copy}>Copy share link</button>
        <button className={`btn small ${state.kidMode ? 'primary' : ''}`} aria-pressed={state.kidMode} onClick={toggleKidMode}>
          {state.kidMode ? 'Kid mode on' : 'Kid mode'}
        </button>
        {copied && <span className="copy-ok">Copied</span>}
      </div>
      <p className="dim">{link}</p>
      {state.kidMode && hidden > 0 && (
        <div className="banner">Kid mode is hiding {hidden} claimed {hidden === 1 ? 'wish' : 'wishes'}.</div>
      )}
      {items.map((item) => (
        <article className="card pad gift-edit" key={item.id}>
          <label className="field">
            <span>Wish</span>
            <input value={item.title} onChange={(event) => updateGiftItem(list.id, item.id, { title: event.target.value })} />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea value={item.notes} onChange={(event) => updateGiftItem(list.id, item.id, { notes: event.target.value })} />
          </label>
          <label className="field">
            <span>Link</span>
            <input value={item.url} placeholder="https://" onChange={(event) => updateGiftItem(list.id, item.id, { url: event.target.value })} />
          </label>
          <label className="field">
            <span>Second link</span>
            <input value={item.urlSecondary} placeholder="https://" onChange={(event) => updateGiftItem(list.id, item.id, { urlSecondary: event.target.value })} />
          </label>
          {item.claimedAt ? (
            <div className="row-between">
              <span className="chip yes">Claimed{item.claimedByName ? ` · ${item.claimedByName}` : ''}</span>
              <button className="btn small ghost" onClick={() => releaseClaim(list.id, item.id)}>Release</button>
            </div>
          ) : (
            <span className="chip wait">Open</span>
          )}
          <div className="meta-row" style={{ marginTop: 10 }}>
            <button className="btn small ghost" onClick={() => moveGiftItem(list.id, item.id, -1)}>Up</button>
            <button className="btn small ghost" onClick={() => moveGiftItem(list.id, item.id, 1)}>Down</button>
            <button className="btn small ghost" onClick={() => deleteGiftItem(list.id, item.id)}>Remove</button>
            {safeHttp(item.url) && <a className="btn small" href={safeHttp(item.url)} target="_blank" rel="noreferrer">Open link</a>}
          </div>
        </article>
      ))}
      <button className="btn" onClick={() => addGiftItem(list.id)}>Add a wish</button>
    </div>
  )
}
