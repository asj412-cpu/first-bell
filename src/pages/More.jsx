import { Link } from 'react-router-dom'
import { useBell } from '../lib/store.jsx'

const LINKS = [
  { to: '/learning', title: 'At-home learning', note: 'This week’s plan for the kids.', house: true },
  { to: '/history', title: 'History', note: 'Events that have already finished.', house: true },
  { to: '/inbox', title: 'Inbox', note: 'Notes the agent filed for you to confirm.', house: true },
  { to: '/parties', title: 'Events', note: 'Parties, holidays, and guest RSVPs.', house: false },
  { to: '/gifts', title: 'Gift lists', note: 'Christmas lists and Secret Santa.', house: false },
  { to: '/settings', title: 'Settings', note: 'Household, birthdays, and sign out.', house: true },
]

export default function More() {
  const { state } = useBell()
  const limited = state.memberRole === 'gift' || state.memberRole === 'guest'
  const links = limited ? LINKS.filter((link) => link.to === '/settings' || (state.memberRole === 'guest' && link.to === '/parties') || (state.memberRole === 'gift' && link.to === '/gifts')) : LINKS

  return (
    <div>
      <div className="kicker">More</div>
      <h1>The rest of the house</h1>
      <p className="lede">Learning, history, and settings live here so the main tabs stay the day-to-day.</p>
      <div className="stack-links" style={{ marginTop: 16 }}>
        {links.map((link) => (
          <Link key={link.to} to={link.to} className="card pad more-link">
            <div className="kicker">{link.house ? 'Household' : 'Family & friends'}</div>
            <strong>{link.title}</strong>
            <p className="dim" style={{ margin: '4px 0 0' }}>{link.note}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
