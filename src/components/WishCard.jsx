import { useEffect, useState } from 'react'
import { safeHttp } from '../lib/gifts.js'
import { faviconUrlFor, isFallbackGiftImage, linkPreviewDomain } from '../lib/giftPreview.js'
import { useBell } from '../lib/store.jsx'

const previewCache = new Map()
const previewInflight = new Map()

async function fetchGiftPreview(url, signal) {
  const key = String(url || '').trim()
  if (!key) return null
  if (previewCache.has(key)) return previewCache.get(key)
  if (previewInflight.has(key)) return previewInflight.get(key)
  const job = (async () => {
    const response = await fetch(`/api/gift-image?url=${encodeURIComponent(key)}`, { signal })
    if (!response.ok) return null
    const data = await response.json()
    const image = safeHttp(data?.image)
    const preview = image
      ? { image, source: data?.source || '', domain: data?.domain || linkPreviewDomain(key) }
      : null
    if (preview) previewCache.set(key, preview)
    return preview
  })().finally(() => {
    previewInflight.delete(key)
  })
  previewInflight.set(key, job)
  return job
}

function LinkTile({ url, logoUrl }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const domain = linkPreviewDomain(url)
  const logo = logoUrl || faviconUrlFor(url)
  const initial = (domain || '?').charAt(0).toUpperCase()
  return (
    <div className="wish-photo wish-photo-link">
      <div className="wish-link-tile">
        <div className="wish-link-logo-wrap" aria-hidden="true">
          {logo && !logoFailed ? (
            <img className="wish-link-logo" src={logo} alt="" onError={() => setLogoFailed(true)} />
          ) : (
            <span className="wish-link-initial">{initial}</span>
          )}
        </div>
        {domain ? <span className="wish-link-domain">{domain}</span> : null}
      </div>
    </div>
  )
}

function WishPhoto({ item }) {
  const { fillMissingGiftImage } = useBell()
  const stored = item.image || ''
  const [failed, setFailed] = useState(false)
  const [liveImage, setLiveImage] = useState('')

  useEffect(() => {
    setFailed(false)
    setLiveImage('')
  }, [item.id, stored])

  useEffect(() => {
    if (!item.url || stored) return
    let cancelled = false
    const controller = new AbortController()
    fetchGiftPreview(item.url, controller.signal)
      .then((preview) => {
        if (cancelled || !preview?.image) return
        if (!isFallbackGiftImage(preview.image)) setLiveImage(preview.image)
        fillMissingGiftImage?.(item.id, preview.image)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [fillMissingGiftImage, item.id, item.url, stored])

  const candidate = stored || liveImage
  const useTile = Boolean(item.url) && (!candidate || failed || isFallbackGiftImage(candidate))
  if (useTile) {
    const logo = isFallbackGiftImage(candidate) ? candidate : ''
    return <LinkTile url={item.url} logoUrl={logo} />
  }
  if (candidate) {
    return (
      <div className="wish-photo">
        <img src={candidate} alt="" onError={() => setFailed(true)} />
      </div>
    )
  }
  return (
    <div className="wish-photo wish-photo-empty">
      <div className="wish-placeholder">
        <span className="wish-emoji" aria-hidden="true">
          🎁
        </span>
        <span>No photo</span>
      </div>
    </div>
  )
}

export default function WishCard({ item, conceal, busy, naming, name, onName, onStart, onCancel, onConfirm, onRelease }) {
  const bought = !conceal && Boolean(item.claimedAt || item.purchased)
  const buyer = item.claimedByName
  return (
    <article className="wish-card">
      <WishPhoto item={item} />
      <div className="wish-body">
        {item.category ? <div className="kicker">{item.category === 'Doll Clothes' ? 'Doll clothes' : item.category}</div> : null}
        <h3>{item.title}</h3>
        {item.priceLabel ? <p className="wish-price">{item.priceLabel}</p> : null}
        {item.retailer ? <p className="dim">{item.retailer}</p> : null}
        {item.dollSize ? (
          <p className="dim">{item.dollSize === 'baby' ? 'Baby doll, 12–16 in.' : 'Bigger doll, 14–18 in.'}</p>
        ) : null}
        {item.notes ? <p className="wish-notes">{item.notes}</p> : null}
        <div className="meta-row">
          {safeHttp(item.url) ? (
            <a className="btn small" href={safeHttp(item.url)} target="_blank" rel="noreferrer">
              {item.category === 'Idea' ? 'Open link' : 'See it at the store'}
            </a>
          ) : null}
        </div>
        {bought ? (
          <div className="row-between">
            <span className="chip yes">Already taken{buyer ? ` · ${buyer}` : ''}</span>
            {onRelease ? (
              <button className="btn small ghost" type="button" onClick={onRelease}>
                Put it back
              </button>
            ) : null}
          </div>
        ) : null}
        {!bought && !conceal && naming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            <label className="field">
              <span>Your name</span>
              <input value={name} onChange={(event) => onName(event.target.value)} placeholder="So the family knows" autoComplete="name" />
            </label>
            <div className="meta-row">
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : "I'll get this"}
              </button>
              <button className="btn ghost" type="button" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {!bought && !conceal && !naming && onStart ? (
          <button className="btn primary big" type="button" onClick={onStart}>
            I'll get this
          </button>
        ) : null}
      </div>
    </article>
  )
}
