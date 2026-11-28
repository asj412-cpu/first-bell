import { useCallback, useEffect, useState } from 'react'
import { publicPayloadToList } from './gifts.js'
import { supabase } from './supabase.js'

// Purchase marks for one list, straight from the database rules.
//
// get_shared_gift_list decides what this person may see: if their sign-in email
// belongs to the list's owner, `purchasesVisible` is false and the items carry no
// purchase fields at all. Marking and undoing go through the same RPCs the
// shared-link page uses, so the same rules apply on every screen.
export function usePurchaseMarks(slug, enabled) {
  const [list, setList] = useState(null)
  const [myName, setMyName] = useState('')
  const [naming, setNaming] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = Boolean(enabled && supabase && slug)

  const refresh = useCallback(async () => {
    if (!active) return
    const { data } = await supabase.rpc('get_shared_gift_list', { p_slug: slug })
    setList(data?.list ? publicPayloadToList(data) : null)
  }, [active, slug])

  useEffect(() => {
    if (!active) {
      setList(null)
      return undefined
    }
    let cancelled = false
    supabase.rpc('get_shared_gift_list', { p_slug: slug }).then(
      ({ data }) => {
        if (!cancelled) setList(data?.list ? publicPayloadToList(data) : null)
      },
      () => {},
    )
    supabase.rpc('get_my_gift_access').then(
      ({ data }) => {
        if (!cancelled) setMyName(data?.display_name || '')
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [active, slug])

  const mark = useCallback(
    async (itemId, typedName) => {
      setBusy(true)
      setError('')
      try {
        const { error: rpcError } = await supabase.rpc('mark_gift_purchased', {
          p_slug: slug,
          p_item_id: itemId,
          p_name: (typedName || '').trim() || null,
        })
        if (rpcError) throw rpcError
        await refresh()
        setNaming(null)
        setName('')
      } catch (err) {
        setError(err.message || 'Could not mark that gift')
      } finally {
        setBusy(false)
      }
    },
    [refresh, slug],
  )

  const release = useCallback(
    async (itemId) => {
      setBusy(true)
      setError('')
      try {
        const { error: rpcError } = await supabase.rpc('release_gift_purchase', { p_item_id: itemId })
        if (rpcError) throw rpcError
        await refresh()
      } catch (err) {
        setError(err.message || 'Could not undo that')
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  // Tap on "Mark as purchased": one tap when we already know who they are.
  const start = useCallback(
    (itemId) => {
      setError('')
      if (myName) mark(itemId, '')
      else setNaming(itemId)
    },
    [mark, myName],
  )

  return { active, list, myName, naming, setNaming, name, setName, busy, error, setError, mark, release, start, refresh }
}
