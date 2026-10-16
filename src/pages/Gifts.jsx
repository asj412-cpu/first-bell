import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import { visibleItems } from '../lib/gifts.js'
import { useBell } from '../lib/store.jsx'

export default function Gifts() {
  const { state, toggleKidMode } = useBell()
  return (
    <div>
      <div className="kicker">Christmas</div>
      <h1>Gift lists</h1>
      <p className="lede">One list per kid. Share a family link, or open a private iPad link for that kid. Kid mode hides anything already claimed.</p>
      <div className="meta-row" style={{ margin: '14px 0' }}>
        <Link to="/gifts/catalog" className="btn small">Picture catalog</Link>
        <button className={`btn small ${state.kidMode ? 'primary' : ''}`} aria-pressed={state.kidMode} onClick={toggleKidMode}>
          {state.kidMode ? 'Kid mode on' : 'Kid mode'}
        </button>
      </div>
      <div className="gift-index">
        {state.giftLists.map((list) => {
          const shown = visibleItems(list, state.kidMode)
          const claimed = list.items.filter((item) => item.claimedAt && item.reviewStatus !== 'pending').length
          const fresh = list.items.filter((item) => item.reviewStatus === 'pending').length
          return (
            <Link key={list.id} to={`/gifts/${list.kidKey}`} className="card pad gift-kid">
              <Avatar name={list.displayName} seed={list.kidKey} />
              <div>
                <div className="kicker">{list.occasion}</div>
                <h2 style={{ marginTop: 2 }}>{list.displayName}</h2>
                <p className="dim" style={{ margin: '4px 0 0' }}>
                  {shown.length} showing · {claimed} claimed
                </p>
                {fresh > 0 && <span className="chip wait">{fresh} new from {list.displayName}</span>}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
