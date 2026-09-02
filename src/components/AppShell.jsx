import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { IconCal, IconGear, IconHome, IconInbox, IconParty } from './Icons.jsx'

const LINKS = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/parties', label: 'Parties', icon: IconParty },
  { to: '/inbox', label: 'Inbox', icon: IconInbox },
  { to: '/calendar', label: 'Calendar', icon: IconCal },
  { to: '/settings', label: 'Settings', icon: IconGear },
]

function Brand() {
  return (
    <div className="brand-lockup">
      <img src="/brand/bell.jpg" alt="" />
      <div className="brand-copy">
        <div className="eyebrow">First Bell</div>
        <strong>Johnson household</strong>
      </div>
    </div>
  )
}

export default function AppShell() {
  const loc = useLocation()
  const title = LINKS.find((l) => (l.end ? loc.pathname === '/' : loc.pathname.startsWith(l.to)))?.label || 'First Bell'

  return (
    <div className="app-shell">
      <nav className="side-nav" aria-label="Primary">
        <Brand />
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <l.icon />
            {l.label}
          </NavLink>
        ))}
      </nav>
      <header className="topbar">
        <Brand />
        <div className="topbar-meta">Demo · {title}</div>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Primary">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <l.icon />
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
