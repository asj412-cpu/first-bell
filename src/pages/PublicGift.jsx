import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IconBack } from '../components/Icons.jsx'
import WishCard from '../components/WishCard.jsx'
import { isStarterItem } from '../lib/exchange.js'
import { findListBySlug, listUsesLocalCatalog, presentItems, publicPayloadToList } from '../lib/gifts.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'
import { managedLabel } from '../lib/managed.js'
import { canPutBack } from '../lib/purchases.js'

export default function PublicGift() {
  const { slug } = useParams()
  const { state, claimGift } = useBell()
  const local = findListBySlug(state.giftLists, slug)
  const [remote, setRemote] = useState(null)
  const [mode, setMode] = useState(supabase ? 'loading' : local ? 'local' : 'missing')
  const [naming, setNaming] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [managedBy, setManagedBy] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!supabase) return undefined
    // "Managed by Sarah" for a husband or kid added under an invited member.
    supabase
      .rpc('get_managed_label', { p_slug: slug })
      .then(({ data }) => {
        if (!cancelled) setManagedBy(data && data.manager_name ? data : null)
      }, () => {})
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false
    if (!supabase) {
      setMode(local ? 'local' : 'missing')
      return undefined
    }
    setMode('loading')
    supabase.rpc('get_shared_gift_list', { p_slug: slug }).then(({ data, error: rpcError }) => {
      if (cancelled) return
      if (!rpcError && data?.list) {
        const next = publicPayloadToList(data)
        if ((next.items || []).length && (next.items || []).every(isStarterItem)) {
          setMode(local ? 'local' : 'missing')
          return
        }
        setRemote(next)
        setMode('remote')
        return
      }
      supabase.rpc('get_public_gift_list', { p_slug: slug }).then((fallback) => {
        if (cancelled) return
        const next = fallback.data ? publicPayloadToList(fallback.data) : null
        if (next && !(next.items || []).every(isStarterItem)) {
          setRemote(next)
          setMode('remote')
          return
        }
        setMode(local ? 'local' : 'missing')
      })
    })
    return () => {
      cancelled = true
    }
  }, [slug, local])

  const list = mode === 'remote' ? remote : local
  if (mode === 'loading') {
    return (
      <div className="guest-page gift-guest">
        <div className="gift-guest-head"><h1>Opening the list…</h1></div>
      </div>
    )
  }
  if (!list || mode === 'missing') {
    return (
      <div className="guest-page gift-guest">
        <div className="gift-guest-head">
          <div className="kicker">Mi Casa</div>
          <h1>That list isn’t here</h1>
          <p className="lede">Check the link with the family.</p>
        </div>
      </div>
    )
  }

  const conceal = mode === 'remote' && list.purchasesVisible === false
  const items = presentItems(list, { conceal })
  const signedIn = Boolean(state.session && state.backend === 'live')
  const admin = state.memberRole === 'owner'

  async function putBack(item) {
    setBusy(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('release_gift_purchase', { p_item_id: item.id })
      if (rpcError) throw rpcError
      const { data } = await supabase.rpc('get_shared_gift_list', { p_slug: slug })
      if (data) setRemote(publicPayloadToList(data))
    } catch (err) {
      setError(err.message || 'Could not put that gift back')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(item) {
    setBusy(true)
    setError('')
    try {
      if (mode === 'remote' && supabase && !listUsesLocalCatalog(list)) {
        const { error: rpcError } = await supabase.rpc('mark_gift_purchased', {
          p_slug: slug,
          p_item_id: item.id,
          p_name: name.trim() || null,
        })
        if (rpcError) throw rpcError
        const { data } = await supabase.rpc('get_shared_gift_list', { p_slug: slug })
        if (data) setRemote(publicPayloadToList(data))
      } else {
        claimGift({ slug, itemId: item.id, name })
      }
      setNaming(null)
      setName('')
    } catch (err) {
      setError(err.message || 'Could not mark that gift')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="guest-page gift-guest">
      <header className="gift-guest-head">
        {signedIn && (state.memberRole === 'gift' || admin) && (
          <Link to={admin ? '/gifts' : '/gifts/family'} className="back-link">
            <IconBack /> {admin ? 'Gift lists' : 'Everyone’s lists'}
          </Link>
        )}
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="kicker">{list.occasion}</div>
        <h1>{list.displayName}’s list</h1>
        {managedBy && <p className="kicker managed-by">{managedLabel(managedBy)}</p>}
        <p className="lede">
          Pick something to buy. Once you mark it, the next person will see that it is taken.{' '}
          {list.displayName} does not see these marks on their own list.
        </p>
        {listUsesLocalCatalog(list) && (
          <div className="banner">On this preview, a mark stays on this phone until the database update is approved.</div>
        )}
        {conceal && !signedIn && (
          <div className="banner">
            <Link to="/enter">Sign in</Link> to see what’s already taken and to mark a gift.
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </header>
      <div className="wish-grid guest-grid">
        {items.map((item) => (
          <WishCard
            key={item.id}
            item={item}
            conceal={conceal}
            busy={busy}
            naming={naming === item.id}
            name={name}
            onName={setName}
            onStart={() => {
              setNaming(item.id)
              setError('')
            }}
            onCancel={() => setNaming(null)}
            onConfirm={() => confirm(item)}
            onRelease={mode === 'remote' && supabase && canPutBack(item, { admin }) ? () => putBack(item) : null}
          />
        ))}
      </div>
      {items.length === 0 && (
        <p className="lede" style={{ padding: '0 18px' }}>No ideas on this list yet.</p>
      )}
      <p className="gate-note"><Link to="/enter">Family sign-in</Link></p>
    </div>
  )
}
