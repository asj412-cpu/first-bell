import { NavLink } from 'react-router-dom'

export default function CalendarTabs() {
  return (
    <div className="folders" role="tablist" aria-label="Calendar views">
      <NavLink to="/calendar" end role="tab">
        {({ isActive }) => <span className={isActive ? 'on' : ''}>Upcoming</span>}
      </NavLink>
      <NavLink to="/history" role="tab">
        {({ isActive }) => <span className={isActive ? 'on' : ''}>History</span>}
      </NavLink>
    </div>
  )
}
