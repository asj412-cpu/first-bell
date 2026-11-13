import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DEMO_INVITE_TOKEN, validateJoin } from '../lib/exchange.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

const DRAFT_KEY = 'micasa-join-draft'

const EMPTY = { name: '', phone: '', email: '', group: '', ideas: '', others: [] }

export default function JoinList() {
  const { token } = useParams()
  const { state, joinExchange } = useBell()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(false)
  const [code, setCode] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [message, setMessage] = useState('')
  const demo = !supabase || state.backend === 'demo' || state.session?.demo
  const known = demo ? token === (state.exchange?.inviteToken || DEMO_INVITE_TOKEN) : true

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
      if (saved?.token === token && saved.form) setForm({ ...EMPTY, ...saved.form })
    } catch {
      /* ignore a bad draft */
    }
  }, [token])

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function addOther() {
    update({ others: [...form.others, { name: '', ideas: '' }] })
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
    if (demo) {
      joinExchange(result.value)
      sessionStorage.removeItem(DRAFT_KEY)
      setDone(true)
      return
    }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ token, form, value: result.value }))
    if (!state.session) {
      setWaiting(true)
      setMessage('')
      const { error } = await supabase.auth.signInWithOtp({
        email: result.value.email,
        options: { emailRedirectTo: window.location.href, shouldCreateUser: true },
      })
      setMessage(error ? error.message : 'Check your email. Open the link on this phone, or enter the code if the email includes one.')
      return
    }
    await finish(result.value)
  }

  async function finish(value) {
    setMessage('')
    const { error } = await supabase.rpc('accept_gift_invite', {
      p_token: token,
      p_name: value.name,
      p_phone: value.phone,
      p_email: value.email,
      p_group: value.group,
      p_ideas: value.ideas,
      p_others: value.others,
    })
    if (error) {
      setMessage(error.message || 'Could not save the list.')
      return
    }
    sessionStorage.removeItem(DRAFT_KEY)
    setDone(true)
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
      if (draft?.value) await finish(draft.value)
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

  if (done) {
    return (
      <div className="guest-page gift-guest">
        <header className="gift-guest-head">
          <div className="kicker">Christmas 2026</div>
          <h1>You’re on the list</h1>
          <p className="lede">
            Andrew and Megan can see that you joined. Your phone and email stay with them, not with the rest of the family.
          </p>
          <Link className="btn primary big" to="/gifts">Open Mi Casa</Link>
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
          Tell us who you are and a few gift ideas. A household can include a couple and kids.
        </p>
        <label className="field">
          <span>Your name</span>
          <input value={form.name} onChange={(event) => update({ name: event.target.value })} autoComplete="name" required />
        </label>
        {errors.name && <p className="form-error">{errors.name}</p>}
        <label className="field">
          <span>Phone</span>
          <input value={form.phone} onChange={(event) => update({ phone: event.target.value })} inputMode="tel" autoComplete="tel" placeholder="(713) 555-0100" required />
        </label>
        {errors.phone && <p className="form-error">{errors.phone}</p>}
        <label className="field">
          <span>Email</span>
          <input value={form.email} onChange={(event) => update({ email: event.target.value })} type="email" autoComplete="email" inputMode="email" required />
        </label>
        {errors.email && <p className="form-error">{errors.email}</p>}
        <label className="field">
          <span>Household</span>
          <input value={form.group} onChange={(event) => update({ group: event.target.value })} placeholder="The Garcias" required />
        </label>
        {errors.group && <p className="form-error">{errors.group}</p>}
        <label className="field">
          <span>Gift ideas, one per line</span>
          <textarea value={form.ideas} onChange={(event) => update({ ideas: event.target.value })} placeholder={'A wool scarf\nA book of poems'} required />
        </label>
        {errors.ideas && <p className="form-error">{errors.ideas}</p>}
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
            <label className="field">
              <span>Their ideas</span>
              <textarea
                value={person.ideas}
                onChange={(event) => {
                  const others = form.others.slice()
                  others[index] = { ...person, ideas: event.target.value }
                  update({ others })
                }}
              />
            </label>
            <button
              className="btn small ghost"
              type="button"
              onClick={() => update({ others: form.others.filter((_, item) => item !== index) })}
            >
              Remove
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
          <button className="btn primary big" type="submit">
            {demo ? 'Save my list' : 'Save my list'}
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
