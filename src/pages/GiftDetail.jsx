import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CategoryArt } from '../components/KidArt.jsx'
import { IconBack } from '../components/Icons.jsx'
import { safeHttp, visibleItems } from '../lib/gifts.js'
import { pendingItems, safeMedia } from '../lib/kidGifts.js'
import { useBell } from '../lib/store.jsx'

export default function GiftDetail() {
  const { kidKey } = useParams()
  const {
    state,
    toggleKidMode,
    updateGiftItem,
    addGiftItem,
    deleteGiftItem,
    moveGiftItem,
    releaseClaim,
    issueKidLink,
    revokeKidLink,
    reloadGifts,
  } = useBell()
  const list = state.giftLists.find((row) => row.kidKey === kidKey)
  const [copied, setCopied] = useState('')
  const [pin, setPin] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [revokeArmed, setRevokeArmed] = useState(false)

  if (!list) return <Navigate to="/gifts" replace />
  const items = visibleItems(list, state.kidMode)
  const waiting = pendingItems(list)
  const hidden = list.items.filter((item) => item.reviewStatus !== 'pending').length - items.length
  const familyLink = `${window.location.origin}/g/${list.shareSlug}`
  const active = Boolean(list.kidLink && !list.kidLink.revokedAt && list.kidLink.active !== false)
  const kidLink = active && list.kidLink.secret ? `${window.location.origin}/k/${list.kidLink.secret}` : ''

  function copy(value, which) {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(''), 1600)
    })
  }

  async function makeLink() {
    setLinkBusy(true)
    setLinkError('')
    try {
      await issueKidLink(list.id, pin)
      setPin('')
    } catch (error) {
      setLinkError(error.message || 'Could not make the iPad link')
    } finally {
      setLinkBusy(false)
    }
  }

  async function revoke() {
    setLinkBusy(true)
    setLinkError('')
    try {
      await revokeKidLink(list.id)
      setRevokeArmed(false)
    } catch (error) {
      setLinkError(error.message || 'Could not revoke the iPad link')
    } finally {
      setLinkBusy(false)
    }
  }

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">{list.occasion}</div>
      <h1>{list.displayName}</h1>
      <p className="lede">Edit the wishes, then send the family link. Claims show here unless kid mode is on.</p>
      <div className="meta-row" style={{ margin: '12px 0 16px' }}>
        <button className="btn small primary" onClick={() => copy(familyLink, 'family')}>Copy share link</button>
        <button className={`btn small ${state.kidMode ? 'primary' : ''}`} aria-pressed={state.kidMode} onClick={toggleKidMode}>
          {state.kidMode ? 'Kid mode on' : 'Kid mode'}
        </button>
        {copied === 'family' && <span className="copy-ok">Copied</span>}
      </div>
      <p className="dim">{familyLink}</p>
      {state.kidMode && hidden > 0 && (
        <div className="banner">Kid mode is hiding {hidden} claimed {hidden === 1 ? 'wish' : 'wishes'}.</div>
      )}

      <section className="card pad kid-parent">
        <div className="kicker">iPad</div>
        <h2>{list.displayName}’s iPad</h2>
        <p className="dim">A private link for this list only. On the iPad, open it and use Add to Home Screen. Leaving that screen takes this PIN.</p>
        {active ? (
          <>
            {kidLink ? (
              <>
                <p className="kid-url">{kidLink}</p>
                <div className="meta-row">
                  <button className="btn small primary" onClick={() => copy(kidLink, 'kid')}>Copy iPad link</button>
                  {copied === 'kid' && <span className="copy-ok">Copied</span>}
                </div>
              </>
            ) : (
              <p className="dim">A link is already on an iPad. Revoke it to make a new one.</p>
            )}
            {revokeArmed ? (
              <div className="meta-row" style={{ marginTop: 10 }}>
                <button className="btn small" disabled={linkBusy} onClick={revoke}>Revoke this link</button>
                <button className="btn small ghost" onClick={() => setRevokeArmed(false)}>Keep it</button>
              </div>
            ) : (
              <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => setRevokeArmed(true)}>Revoke</button>
            )}
          </>
        ) : (
          <>
            <label className="field">
              <span>Parent PIN</span>
              <input
                value={pin}
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="4 numbers"
                aria-label="Parent PIN"
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </label>
            <button className="btn small primary" disabled={linkBusy || pin.length !== 4} onClick={makeLink}>
              Make iPad link
            </button>
          </>
        )}
        {linkError && <p className="form-error">{linkError}</p>}
        <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => reloadGifts()}>Refresh</button>
      </section>

      {waiting.length > 0 && (
        <section className="kid-waiting">
          <div className="kicker">Waiting for you</div>
          <h2>New from {list.displayName}</h2>
          {waiting.map((item) => {
            const image = safeMedia(item.image, 'image')
            const audio = safeMedia(item.audio, 'audio')
            return (
              <article className="card pad gift-edit kid-review" key={item.id}>
                <div className="wish-art">
                  {image ? <img src={image} alt="" /> : item.category ? <CategoryArt id={item.category} /> : <span className="dim">Voice</span>}
                </div>
                {audio && <audio controls src={audio} />}
                <label className="field">
                  <span>Wish</span>
                  <input value={item.title} onChange={(event) => updateGiftItem(list.id, item.id, { title: event.target.value })} />
                </label>
                {item.notes && <p className="dim">{item.notes}</p>}
                <label className="field">
                  <span>Link</span>
                  <input value={item.url} placeholder="https://" onChange={(event) => updateGiftItem(list.id, item.id, { url: event.target.value })} />
                </label>
                <div className="meta-row">
                  <button className="btn small primary" onClick={() => updateGiftItem(list.id, item.id, { reviewStatus: 'approved' })}>
                    Show on the family link
                  </button>
                  <button className="btn small ghost" onClick={() => deleteGiftItem(list.id, item.id)}>Remove</button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {items.map((item) => (
        <article className="card pad gift-edit" key={item.id}>
          {(safeMedia(item.image, 'image') || item.category) && (
            <div className="wish-art">
              {safeMedia(item.image, 'image') ? <img src={safeMedia(item.image, 'image')} alt="" /> : <CategoryArt id={item.category} />}
            </div>
          )}
          {safeMedia(item.audio, 'audio') && <audio controls src={safeMedia(item.audio, 'audio')} />}
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
