import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconBack } from '../components/Icons.jsx'
import WishCard from '../components/WishCard.jsx'
import { myAssignment } from '../lib/exchange.js'
import { fromDbItem } from '../lib/gifts.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

export default function Assignment() {
  const { state, claimGift } = useBell()
  const demo = !supabase || state.backend !== 'live'
  const [remote, setRemote] = useState(null)
  const [naming, setNaming] = useState(null)
  const [name, setName] = useState(state.session?.name || 'Andrew')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (demo) return undefined
    let cancelled = false
    supabase.rpc('get_my_assignment').then(({ data, error: rpcError }) => {
      if (cancelled) return
      if (rpcError) setError(rpcError.message)
      else setRemote(data)
    })
    return () => {
      cancelled = true
    }
  }, [demo])

  const demoRow = myAssignment(state.exchange, 'andrew')
  const receiverName = remote?.receiver?.name || demoRow?.receiver?.name
  const items = remote?.receiver?.list?.items
    ? remote.receiver.list.items.map(fromDbItem)
    : demoRow
      ? (state.giftLists.find((list) => list.kidKey === demoRow.receiver.listKey)?.items || [])
      : []
  const status = remote?.status || state.exchange.eventStatus
  const slug = remote?.receiver?.list?.share_slug || state.giftLists.find((list) => list.kidKey === demoRow?.receiver?.listKey)?.shareSlug

  async function confirm(item) {
    setBusy(true)
    setError('')
    try {
      if (!demo && supabase) {
        const { error: rpcError } = await supabase.rpc('mark_gift_purchased', {
          p_slug: slug,
          p_item_id: item.id,
          p_name: name.trim() || null,
        })
        if (rpcError) throw rpcError
        const { data } = await supabase.rpc('get_my_assignment')
        if (data) setRemote(data)
      } else if (slug) {
        claimGift({ slug, itemId: item.id, name })
      }
      setNaming(null)
    } catch (err) {
      setError(err.message || 'Could not mark that gift')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">Secret Santa</div>
      <h1>Your person</h1>
      {!receiverName && (
        <p className="lede">
          {status === 'locked' || status === 'draft'
            ? 'Your name is not in this drawing.'
            : 'When the drawing is made, the person you are buying for shows up here. You will not see anyone else’s match.'}
        </p>
      )}
      {receiverName && (
        <>
          <p className="lede">You are buying for</p>
          <p className="assignment-name">{receiverName}</p>
          <p className="dim">Mark a gift once you have it, so nobody else buys the same one. {receiverName} cannot see these marks.</p>
          {error && <p className="form-error">{error}</p>}
          <div className="wish-grid">
            {items.map((item) => (
              <WishCard
                key={item.id}
                item={item}
                conceal={false}
                busy={busy}
                naming={naming === item.id}
                name={name}
                onName={setName}
                onStart={() => setNaming(item.id)}
                onCancel={() => setNaming(null)}
                onConfirm={() => confirm(item)}
              />
            ))}
          </div>
          {items.length === 0 && <p className="lede">{receiverName} has not added ideas yet.</p>}
        </>
      )}
    </div>
  )
}
