import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import { DEMO_INVITE_TOKEN, ideaCount } from '../lib/exchange.js'
import { exchangeLists, listUsesLocalCatalog, presentItems, wishLists } from '../lib/gifts.js'
import { useBell } from '../lib/store.jsx'

export default function Gifts() {
  const { state, toggleKidMode } = useBell()
  const kids = wishLists(state.giftLists)
  const grownups = exchangeLists(state.giftLists)
  const guest = state.memberRole === 'gift'
  const localCatalog = kids.some(listUsesLocalCatalog)
  return (
    <div>
      <div className="kicker">Christmas 2026</div>
      <h1>Gift lists</h1>
      <p className="lede">
        {guest
          ? 'Your ideas, and the person you are buying for once names are drawn.'
          : 'Claire, Chloe, and Drew each have a list. Share a link so family can claim a gift without telling the kids.'}
      </p>
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
                  <div className="kicker">Secret Santa</div>
                  <h2 style={{ marginTop: 2 }}>{list.displayName}</h2>
                  <p className="dim" style={{ margin: '4px 0 0' }}>
                    {ideaCount(list) ? `${ideaCount(list)} ideas` : 'Add a few ideas'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          <h2 className="section-label">Family</h2>
          <div className="stack-links">
            <Link className="btn big" to={`/join/${state.exchange?.inviteToken || DEMO_INVITE_TOKEN}`}>
              Invite family to add a list
            </Link>
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
