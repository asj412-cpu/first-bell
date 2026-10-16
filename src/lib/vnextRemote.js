import { fromDbList } from './gifts.js'

function missing(error) {
  if (!error) return false
  const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' ||
    /does not exist|schema cache|could not find the function/i.test(text)
  )
}

function mapProfile(row) {
  return {
    id: row.id,
    memberKey: row.member_key,
    name: row.preferred_name || row.name,
    fullName: row.full_name || row.name,
    role: row.role || 'kid',
    birthDate: row.birth_date,
    grade: row.grade,
    notes: row.notes || '',
  }
}

function mapEvent(row) {
  return {
    id: row.client_id || row.id,
    dbId: row.id,
    title: row.title,
    kind: row.kind || 'plan',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: Boolean(row.all_day),
    place: row.location || '',
    partyId: null,
    notes: row.notes || '',
    draft: Boolean(row.draft),
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    archivedAt: row.archived_at,
    source: 'plan',
  }
}

export async function pullVnext(client, householdId) {
  const importsRes = await client
    .from('calendar_events_import')
    .select('id, source, external_uid, title, starts_at, ends_at, all_day, location, notes, imported_at')
    .eq('household_id', householdId)
    .order('starts_at', { ascending: true })
  if (importsRes.error) {
    return {
      available: false,
      missing: missing(importsRes.error),
      message: importsRes.error.message,
    }
  }

  const [listsRes, profilesRes, plansRes, groceryRes, eventsRes] = await Promise.all([
    client.from('gift_lists').select('*').eq('household_id', householdId),
    client.from('household_profiles').select('*').eq('household_id', householdId),
    client.from('meal_plans').select('*').eq('household_id', householdId),
    client.from('grocery_items').select('*').eq('household_id', householdId),
    client.from('household_events').select('*').eq('household_id', householdId),
  ])
  const failed = [listsRes, profilesRes, plansRes, groceryRes, eventsRes].find((res) => res.error)
  if (failed?.error) {
    return { available: false, missing: missing(failed.error), message: failed.error.message }
  }

  const listIds = (listsRes.data || []).map((list) => list.id)
  let itemRows = []
  if (listIds.length) {
    const itemsRes = await client.from('gift_items').select('*').in('list_id', listIds).order('sort')
    if (itemsRes.error) {
      return { available: false, missing: missing(itemsRes.error), message: itemsRes.error.message }
    }
    itemRows = itemsRes.data || []
  }

  const mealPlans = {}
  for (const row of plansRes.data || []) mealPlans[row.week_start] = row.slots || {}

  const grocery = {}
  for (const row of groceryRes.data || []) {
    const week = row.week_start
    grocery[week] = grocery[week] || []
    grocery[week].push({
      id: `${row.aisle || ''}|${row.name}`.toLowerCase(),
      name: row.name,
      aisle: row.aisle || 'Pantry',
      qty: row.qty ? [row.qty] : [],
      checked: Boolean(row.checked),
    })
  }

  return {
    available: true,
    imports: importsRes.data || [],
    giftLists: (listsRes.data || []).map((list) => fromDbList(list, itemRows)),
    profiles: (profilesRes.data || []).map(mapProfile),
    mealPlans,
    grocery,
    events: (eventsRes.data || []).map(mapEvent),
  }
}

async function quiet(promise) {
  try {
    const result = await promise
    if (result?.error) return false
    return true
  } catch {
    return false
  }
}

export async function mirrorVnext(client, action, snapshot) {
  if (!client || !snapshot?.vnextReady || !snapshot.householdId) return
  const householdId = snapshot.householdId

  if (action.type === 'update-profile') {
    const profile = snapshot.profiles.find((row) => row.memberKey === action.memberKey)
    if (!profile) return
    await quiet(
      client.from('household_profiles').upsert(
        {
          household_id: householdId,
          member_key: profile.memberKey,
          name: profile.name,
          full_name: profile.fullName || profile.name,
          role: profile.role || 'kid',
          birth_date: profile.birthDate || null,
          grade: profile.grade || null,
          notes: profile.notes || null,
        },
        { onConflict: 'household_id,member_key' },
      ),
    )
  }

  if (action.type === 'update-gift-item' || action.type === 'release-claim' || action.type === 'move-gift-item') {
    const list = snapshot.giftLists.find((row) => row.id === action.listId)
    if (!list) return
    await quiet(
      client.from('gift_items').upsert(
        list.items.map((item) => ({
          id: item.id,
          list_id: list.id,
          title: item.title || 'Wish',
          notes: item.notes || null,
          url: item.url || null,
          url_secondary: item.urlSecondary || null,
          image: item.image || null,
          availability: item.availability || null,
          sort: item.sort ?? 0,
          claimed_by_name: item.claimedByName || null,
          claimed_at: item.claimedAt,
        })),
      ),
    )
  }

  if (action.type === 'add-gift-item') {
    const list = snapshot.giftLists.find((row) => row.id === action.listId)
    const item = list?.items[list.items.length - 1]
    if (!list || !item) return
    await quiet(
      client.from('gift_items').insert({
        id: item.id,
        list_id: list.id,
        title: item.title || 'New wish',
        notes: item.notes || null,
        sort: item.sort ?? list.items.length - 1,
      }),
    )
  }

  if (action.type === 'delete-gift-item') {
    await quiet(client.from('gift_items').delete().eq('id', action.itemId))
  }

  if (action.type === 'plan-suggestion' || action.type === 'toggle-checklist') {
    const event =
      action.type === 'plan-suggestion'
        ? snapshot.events.find((row) => row.id === `plan-${action.suggestion.key}`)
        : snapshot.events.find((row) => row.id === action.eventId)
    if (!event) return
    await quiet(
      client.from('household_events').upsert(
        {
          household_id: householdId,
          client_id: event.id,
          title: event.title,
          kind: event.kind,
          starts_at: event.startsAt,
          ends_at: event.endsAt,
          all_day: event.allDay,
          location: event.place || null,
          notes: event.notes || null,
          draft: event.draft,
          checklist: event.checklist || [],
          archived_at: event.archivedAt,
        },
        { onConflict: 'client_id' },
      ),
    )
  }

  if (action.type === 'suggest-week' || action.type === 'swap-meal' || action.type === 'toggle-lock') {
    const weekStart = action.weekStart
    const slots = snapshot.mealPlans[weekStart]
    if (!slots) return
    await quiet(
      client.from('meal_plans').upsert(
        { household_id: householdId, week_start: weekStart, slots },
        { onConflict: 'household_id,week_start' },
      ),
    )
    if (action.type !== 'toggle-lock') {
      await quiet(client.from('grocery_items').delete().eq('household_id', householdId).eq('week_start', weekStart))
      const rows = (snapshot.grocery[weekStart] || []).map((item, sort) => ({
        household_id: householdId,
        week_start: weekStart,
        name: item.name,
        aisle: item.aisle,
        qty: (item.qty || []).join(' + ') || null,
        checked: Boolean(item.checked),
        sort,
      }))
      if (rows.length) await quiet(client.from('grocery_items').insert(rows))
    }
  }

  if (action.type === 'toggle-grocery') {
    const item = (snapshot.grocery[action.weekStart] || []).find((row) => row.id === action.itemId)
    if (!item) return
    await quiet(
      client
        .from('grocery_items')
        .update({ checked: item.checked })
        .eq('household_id', householdId)
        .eq('week_start', action.weekStart)
        .eq('name', item.name),
    )
  }
}
