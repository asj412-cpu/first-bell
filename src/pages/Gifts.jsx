import { useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import ShareLink from '../components/ShareLink.jsx'
import { ideaCount } from '../lib/exchange.js'
import { exchangeLists, listUsesLocalCatalog, presentItems, wishLists } from '../lib/gifts.js'
import { inviteCopy, inviteUrl, rpcMissing } from '../lib/invites.js'
import { useBell } from '../lib/store.jsx'

export default function Gifts() {
  const { state, toggleKidMode, createFamilyInvite, notify, signOut } = useBell()
  const [invite, setInvite] = useState(null)
  const [inviteError, setInviteError] = useState('')
  const [inviting, setInviting] = useState(false)
  const kids = wishLists(state.giftLists)
  const grownups = exchangeLists(state.giftLists)
  const guest = state.memberRole === 'gift'
  const localCatalog = kids.some(listUsesLocalCatalog)
  const share = invite ? inviteCopy(invite.kind || 'gift_list', invite.label) : null

  async function inviteSomeone() {
    setInviteError('')
    setInviting(true)
    try {
      const created = await createFamilyInvite({ kind: 'gift_list', label: 'Christmas 2026' })
      setInvite(created)
      notify('Invite ready. Send the link from this phone.')
    } catch (err) {
      setInvite(null)
      setInviteError(
        rpcMissing(err)
          ? 'Personal invite links need the new database update. It is in the pull request and is not applied yet.'
          : err.message || 'Could not create an invite.',
      )
    } finally {
      setInviting(false)
    }
  }

  return (
    <div>
      <div className="kicker">Christmas 2026</div>
      <h1>Gift lists</h1>
      <p className="lede">
        {guest
          ? 'Your ideas, and the person you are buying for once names are drawn.'
          : 'Claire, Chloe, and Drew each have a list. Share a link so family can claim a gift without telling the kids.'}
      </p>
      {guest && (
        <div className="account-row">
          <span>Signed in as {state.session?.email || 'a guest'}</span>
          <button className="btn small ghost" type="button" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      )}
      {!guest && (
        <div className="meta-row" style={{ margin: '14px 0' }}>
          <button className={`btn small ${state.kidMode ? 'primary' : ''}`} aria-pressed={state.kidMode} type="button" onClick={toggleKidMode}>
            {state.kidMode ? 'Kid view on' : 'Kid view'}
          </button>
        </div>
      )}
      {state.kidMode && !guest && (
        <div className="banner">Kid view hides what has already been bought.</div>
      )}
      {localCatalog && !guest && (
        <div className="banner">
          These researched ideas are saved in the app. The shared family marks start working for everyone after Andrew approves the database update.
        </div>
      )}
      <div className="gift-index">
        {(guest ? state.giftLists : kids).map((list) => {
          const shown = presentItems(list, { conceal: state.kidMode || guest })
          const bought = state.kidMode || guest ? 0 : list.items.filter((item) => item.claimedAt).length
          return (
            <Link key={list.id} to={`/gifts/${list.kidKey}`} className="card pad gift-kid">
              <Avatar name={list.displayName} seed={list.kidKey} />
              <div>
                <div className="kicker">{list.occasion}</div>
                <h2 style={{ marginTop: 2 }}>{list.displayName}</h2>
                <p className="dim" style={{ margin: '4px 0 0' }}>
                  {list.kidKey === 'drew' && shown.length === 0
                    ? 'No ideas yet'
                    : bought
                      ? `${shown.length} ideas · ${bought} bought`
                      : `${shown.length} ${shown.length === 1 ? 'idea' : 'ideas'}`}
                </p>
              </div>
            </Link>
          )
        })}
      </div>

      {!guest && (
        <>
          <h2 className="section-label">Grown-up lists</h2>
          <div className="gift-index">
            {grownups.map((list) => (
              <Link key={list.id} to={`/gifts/${list.kidKey}`} className="card pad gift-kid">
                <Avatar name={list.displayName} seed={list.kidKey} />
                <div>
                  <div className="kicker">{String(list.kidKey).startsWith('guest-') ? 'Family list' : 'Secret Santa'}</div>
                  <h2 style={{ marginTop: 2 }}>{list.displayName}</h2>
                  <p className="dim" style={{ margin: '4px 0 0' }}>
                    {ideaCount(list) ? `${ideaCount(list)} ideas` : 'Add a few ideas'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          <h2 className="section-label">Family</h2>
          <div className="card pad invite-card">
            <div className="kicker">Invite</div>
            <h2 style={{ marginTop: 4 }}>Add someone to the family lists</h2>
            <p className="muted">
              Creates a one-time link. They sign in, enter a name and phone, and get a list of their own.
            </p>
            <button className="btn primary big" type="button" onClick={inviteSomeone} disabled={inviting}>
              {inviting ? 'Creating invite…' : 'Invite'}
            </button>
            {inviteError && <p className="form-error" role="alert">{inviteError}</p>}
            {invite && share && (
              <ShareLink
                url={inviteUrl(invite.token)}
                subject={share.subject}
                text={share.text}
                onDone={notify}
              />
            )}
          </div>
          <div className="stack-links">
            <Link className="btn big" to="/gifts/santa">
              Secret Santa
            </Link>
            <Link className="btn big" to="/gifts/assignment">
              Your person
            </Link>
            <Link className="btn big" to="/gifts/reminders">
              Reminders
            </Link>
          </div>
        </>
      )}

      {guest && (
        <div className="stack-links" style={{ marginTop: 16 }}>
          <Link className="btn big primary" to="/gifts/assignment">
            See who you are buying for
          </Link>
        </div>
      )}
    </div>
  )
}
