import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import GiftItemFields from '../components/GiftItemFields.jsx'
import { blankGiftItem, DEMO_INVITE_TOKEN, validateJoin, withGiftImages } from '../lib/exchange.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

const DRAFT_KEY = 'micasa-join-draft'

function emptyForm() {
  return { name: '', phone: '', email: '', group: '', items: [blankGiftItem()], others: [] }
}

export default function JoinList() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { state, joinExchange } = useBell()
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [code, setCode] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const demo = !supabase || state.backend === 'demo' || state.session?.demo
  const known = demo ? token === (state.exchange?.inviteToken || DEMO_INVITE_TOKEN) : true

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
      if (saved?.token === token && saved.form) setForm({ ...emptyForm(), ...saved.form })
    } catch {
      /* ignore a bad draft */
    }
  }, [token])

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function changeItem(index, patch) {
    const items = form.items.slice()
    items[index] = { ...items[index], ...patch }
    update({ items })
  }

  function addItem() {
    update({ items: [...form.items, blankGiftItem()] })
  }

  function removeItem(index) {
    const items = form.items.filter((_, item) => item !== index)
    update({ items: items.length ? items : [blankGiftItem()] })
  }

  function addOther() {
    update({ others: [...form.others, { name: '', items: [blankGiftItem()] }] })
  }

  async function persist(value) {
    const items = await withGiftImages(value.items)
    const others = await Promise.all(
      (value.others || []).map(async (person) => ({ ...person, items: await withGiftImages(person.items) })),
    )
    const ready = { ...value, items, others }
    if (demo) {
      const returning = state.exchange.participants.find(
        (person) => person.email && person.email.toLowerCase() === value.email,
      )
      const selfId = returning ? null : value.selfId || globalThis.crypto?.randomUUID?.() || `person-${Date.now()}`
      joinExchange({ ...ready, selfId })
      sessionStorage.removeItem(DRAFT_KEY)
      const listKey = returning?.listKey || `guest-${selfId}`
      navigate(`/gifts/${listKey}`)
      return
    }
    const { error } = await supabase.rpc('accept_gift_invite', {
      p_token: token,
      p_name: ready.name,
      p_phone: ready.phone,
      p_email: ready.email,
      p_group: ready.group,
      p_ideas: ready.items.map((item) => ({
        description: item.description,
        url: item.url,
        image: item.image,
      })),
      p_others: ready.others.map((person) => ({
        name: person.name,
        ideas: person.items.map((item) => ({
          description: item.description,
          url: item.url,
          image: item.image,
        })),
      })),
    })
    if (error) {
      setMessage(error.message || 'Could not save the list.')
      return
    }
    sessionStorage.removeItem(DRAFT_KEY)
    const access = await supabase.rpc('get_my_gift_lists')
    const mine = Array.isArray(access.data)
      ? access.data.find((list) => (list.display_name || '').toLowerCase() === ready.name.toLowerCase())
      : null
    navigate(mine?.kid_key ? `/gifts/${mine.kid_key}` : '/gifts')
  }

  async function save(event) {
    event?.preventDefault()
    const result = validateJoin(form)
    setErrors(result.errors)
    if (!result.ok) return
    if (!known && demo) {
      setMessage('That invite link is not active.')
      return
    }
    setSaving(true)
    setMessage(demo ? 'Looking up photos…' : '')
    try {
      if (demo || state.session) {
        await persist(result.value)
        return
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ token, form, value: result.value }))
      setWaiting(true)
      const { error } = await supabase.auth.signInWithOtp({
        email: result.value.email,
        options: { emailRedirectTo: window.location.href, shouldCreateUser: true },
      })
      setMessage(error ? error.message : 'Check your email. Open the link on this phone, or enter the code if the email includes one.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmCode(event) {
    event.preventDefault()
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: form.email.trim().toLowerCase(),
        token: code.trim(),
        type: 'email',
      })
      if (error) throw error
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
      if (draft?.value) await persist(draft.value)
    } catch (err) {
      setMessage(err.message || 'That sign-in did not work.')
    }
  }

  if (!known) {
    return (
      <div className="guest-page gift-guest">
        <header className="gift-guest-head">
          <div className="kicker">Mi Casa</div>
          <h1>That invite is not active</h1>
          <p className="lede">Ask Andrew or Megan for a fresh link.</p>
        </header>
      </div>
    )
  }

  return (
    <div className="guest-page gift-guest">
      <form className="gift-guest-head" onSubmit={save}>
        <img className="bell" src="/icons/icon-192.png" alt="" />
        <div className="kicker">Johnson family</div>
        <h1>Add my Christmas list</h1>
        <p className="lede">
          Tell us who you are, then add each gift as its own row. A link is optional. You can come back and change the list later.
        </p>
        <label className="field">
          <span>Your name</span>
          <input value={form.name} onChange={(event) => update({ name: event.target.value })} autoComplete="name" />
        </label>
        {errors.name && <p className="form-error">{errors.name}</p>}
        <label className="field">
          <span>Phone</span>
          <input value={form.phone} onChange={(event) => update({ phone: event.target.value })} inputMode="tel" autoComplete="tel" placeholder="(713) 555-0100" />
        </label>
        {errors.phone && <p className="form-error">{errors.phone}</p>}
        <label className="field">
          <span>Email</span>
          <input value={form.email} onChange={(event) => update({ email: event.target.value })} type="email" autoComplete="email" inputMode="email" />
        </label>
        {errors.email && <p className="form-error">{errors.email}</p>}
        <label className="field">
          <span>Household</span>
          <input value={form.group} onChange={(event) => update({ group: event.target.value })} placeholder="The Garcias" />
        </label>
        {errors.group && <p className="form-error">{errors.group}</p>}
        <h2>Your gifts</h2>
        <GiftItemFields
          items={form.items}
          errors={errors}
          onChange={changeItem}
          onAdd={addItem}
          onRemove={removeItem}
        />
        {form.others.map((person, index) => (
          <fieldset key={index} className="other-person">
            <legend>Someone in your household</legend>
            <label className="field">
              <span>Name</span>
              <input
                value={person.name}
                onChange={(event) => {
                  const others = form.others.slice()
                  others[index] = { ...person, name: event.target.value }
                  update({ others })
                }}
              />
            </label>
            {errors[`other-${index}`] && <p className="form-error">{errors[`other-${index}`]}</p>}
            <GiftItemFields
              items={person.items}
              errors={Object.fromEntries(
                Object.entries(errors)
                  .filter(([key]) => key.startsWith(`other-${index}-`))
                  .map(([key, message]) => [key.replace(`other-${index}-`, ''), message]),
              )}
              onChange={(itemIndex, patch) => {
                const others = form.others.slice()
                const items = person.items.slice()
                items[itemIndex] = { ...items[itemIndex], ...patch }
                others[index] = { ...person, items }
                update({ others })
              }}
              onAdd={() => {
                const others = form.others.slice()
                others[index] = { ...person, items: [...person.items, blankGiftItem()] }
                update({ others })
              }}
              onRemove={(itemIndex) => {
                const others = form.others.slice()
                const items = person.items.filter((_, item) => item !== itemIndex)
                others[index] = { ...person, items: items.length ? items : [blankGiftItem()] }
                update({ others })
              }}
            />
            <button
              className="btn small ghost"
              type="button"
              onClick={() => update({ others: form.others.filter((_, item) => item !== index) })}
            >
              Remove this person
            </button>
          </fieldset>
        ))}
        <button className="btn" type="button" onClick={addOther}>
          Add someone in my household
        </button>
        {message && <p className="lede">{message}</p>}
        {waiting && (
          <label className="field">
            <span>Code from the email</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </label>
        )}
        {waiting ? (
          <button className="btn primary big" type="button" onClick={confirmCode}>
            Finish and save my list
          </button>
        ) : (
          <button className="btn primary big" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save my list'}
          </button>
        )}
        <p className="gate-note">
          Phone and email are visible only to Andrew and Megan.
          {demo ? ' This demo stays in this browser.' : ''}
        </p>
        <p className="gate-note"><Link to="/enter">Family sign-in</Link></p>
      </form>
    </div>
  )
}
