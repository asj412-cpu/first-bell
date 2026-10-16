import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CategoryArt } from '../components/KidArt.jsx'
import { findListBySlug, publicPayloadToList, safeHttp, visibleItems } from '../lib/gifts.js'
import { safeMedia } from '../lib/kidGifts.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

export default function PublicGift() {
  const { slug } = useParams()
  const { state, claimGift, toggleKidMode } = useBell()
  const local = findListBySlug(state.giftLists, slug)
  const [remote, setRemote] = useState(null)
  const [mode, setMode] = useState(supabase ? 'loading' : local ? 'local' : 'missing')
  const [claiming, setClaiming] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!supabase) {
      setMode(local ? 'local' : 'missing')
      return undefined
    }
    setMode('loading')
    supabase.rpc('get_public_gift_list', { p_slug: slug }).then(({ data, error: rpcError }) => {
      if (cancelled) return
      if (rpcError || !data) {
        setMode(local ? 'local' : 'missing')
        return
      }
      setRemote(publicPayloadToList(data))
      setMode('remote')
    })
    return () => {
      cancelled = true
    }
  }, [slug, local])

  const list = mode === 'remote' ? remote : local
  if (mode === 'loading') {
    return (
      <div className="guest-page">
        <div className="card guest-sheet"><h1>Opening the list…</h1></div>
      </div>
    )
  }
  if (!list || mode === 'missing') {
    return (
      <div className="guest-page">
        <div className="card guest-sheet">
          <div className="kicker">Mi Casa</div>
          <h1>That list isn’t here</h1>
          <p className="lede">Check the link with the family.</p>
        </div>
      </div>
    )
  }

  const items = visibleItems(list, state.kidMode)
  const hidden = list.items.length - items.length

  async function submit(item) {
    setBusy(true)
    setError('')
    try {
      if (mode === 'remote' && supabase) {
        const { error: rpcError } = await supabase.rpc('claim_gift_item', {
          p_slug: slug,
          p_item_id: item.id,
          p_name: name.trim() || null,
        })
        if (rpcError) throw rpcError
        const { data } = await supabase.rpc('get_public_gift_list', { p_slug: slug })
        if (data) setRemote(publicPayloadToList(data))
      } else {
        claimGift({ slug, itemId: item.id, name })
      }
      setClaiming(null)
      setName('')
    } catch (err) {
      setError(err.message || 'Could not claim that wish')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="guest-page">
      <div className="card guest-sheet">
        <img className="bell" src="/icons/icon-192.png" alt="" style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 10 }} />
        <div className="kicker">{list.occasion}</div>
        <h1>{list.displayName}’s list</h1>
        <p className="lede">Take a wish if you want to be the one who gives it. A name is optional.</p>
        <button className={`btn small ${state.kidMode ? 'primary' : ''}`} aria-pressed={state.kidMode} onClick={toggleKidMode}>
          {state.kidMode ? 'Kid mode on' : 'Kid mode'}
        </button>
        {state.kidMode && hidden > 0 && (
          <p className="dim">Some wishes are hidden so the surprise stays a surprise.</p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="gift-public">
          {items.map((item) => (
            <article key={item.id} className="wish">
              {(safeMedia(item.image, 'image') || item.category) && (
                <div className="wish-art">
                  {safeMedia(item.image, 'image') ? <img src={safeMedia(item.image, 'image')} alt="" /> : <CategoryArt id={item.category} />}
                </div>
              )}
              {safeMedia(item.audio, 'audio') && <audio controls src={safeMedia(item.audio, 'audio')} />}
              <h3>{item.title}</h3>
              {item.clothingSize && <p className="muted">Size {item.clothingSize}</p>}
              {item.notes && <p className="muted">{item.notes}</p>}
              <div className="meta-row">
                {safeHttp(item.url) && <a className="btn small ghost" href={safeHttp(item.url)} target="_blank" rel="noreferrer">Link</a>}
                {safeHttp(item.urlSecondary) && <a className="btn small ghost" href={safeHttp(item.urlSecondary)} target="_blank" rel="noreferrer">Another link</a>}
              </div>
              {item.claimedAt ? (
                <span className="chip yes">Claimed{item.claimedByName ? ` · ${item.claimedByName}` : ''}</span>
              ) : claiming === item.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    submit(item)
                  }}
                >
                  <label className="field">
                    <span>Your name</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
                  </label>
                  <div className="meta-row">
                    <button className="btn small primary" disabled={busy}>I’ll get this</button>
                    <button type="button" className="btn small ghost" onClick={() => setClaiming(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <button className="btn small primary" onClick={() => { setClaiming(item.id); setError('') }}>I’ll get this</button>
              )}
            </article>
          ))}
        </div>
        <p className="gate-note"><Link to="/enter">Family sign-in</Link></p>
      </div>
    </div>
  )
}
