import { safeHttp } from '../lib/gifts.js'

export default function WishCard({ item, conceal, busy, naming, name, onName, onStart, onCancel, onConfirm, onRelease }) {
  const bought = !conceal && Boolean(item.claimedAt || item.purchased)
  const buyer = item.claimedByName
  return (
    <article className="wish-card">
      <div className={`wish-photo ${item.image ? '' : 'wish-photo-empty'}`}>
        {item.image ? (
          <img src={item.image} alt="" />
        ) : (
          <div className="wish-placeholder">
            <span className="wish-emoji" aria-hidden="true">🎁</span>
            <span>No photo</span>
          </div>
        )}
      </div>
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
