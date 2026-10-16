import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useBell } from '../lib/store.jsx'
import BackendBanner from './BackendBanner.jsx'
import { IconCal, IconGear, IconGift, IconHistory, IconHome, IconInbox, IconMeal, IconParty } from './Icons.jsx'

const TABS = [
  { to: '/', label: 'Next up', icon: IconHome, end: true },
  { to: '/calendar', label: 'Calendar', icon: IconCal },
  { to: '/gifts', label: 'Gifts', icon: IconGift },
  { to: '/meals', label: 'Meals', icon: IconMeal },
  { to: '/history', label: 'History', icon: IconHistory },
]

const MORE = [
  { to: '/parties', label: 'Parties', icon: IconParty },
  { to: '/inbox', label: 'Inbox', icon: IconInbox },
  { to: '/settings', label: 'Settings', icon: IconGear },
]

const LINKS = [...TABS, ...MORE]

function Brand() {
  return (
    <div className="brand-lockup">
      <img src="/icons/icon-192.png" alt="" />
      <div className="brand-copy">
        <strong>Mi Casa</strong>
      </div>
    </div>
  )
}

function Item({ link, pathname }) {
  return (
    <NavLink
      to={link.to}
      end={link.end}
      className={({ isActive }) => (isActive || (link.also && pathname.startsWith(link.also)) ? 'active' : '')}
    >
      <link.icon />
      {link.label}
    </NavLink>
  )
}

export default function AppShell() {
  const loc = useLocation()
  const { state } = useBell()
  const title = LINKS.find((l) => (l.end ? loc.pathname === '/' : loc.pathname.startsWith(l.to)))?.label || 'Mi Casa'
  const modeLabel =
    state.backend === 'live' ? 'Live' : state.backend === 'offline' ? 'Offline' : 'Demo'

  return (
    <div className="app-shell">
      <div className="talavera" aria-hidden="true" />
      <nav className="side-nav" aria-label="Primary">
        <Brand />
        {TABS.map((l) => (
          <Item key={l.to} link={l} pathname={loc.pathname} />
        ))}
        <div className="nav-label">House</div>
        {MORE.map((l) => (
          <Item key={l.to} link={l} pathname={loc.pathname} />
        ))}
      </nav>
      <header className="topbar">
        <Brand />
        <div className="topbar-meta">{modeLabel} · {title}</div>
      </header>
      <main className="page">
        <BackendBanner />
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Primary">
        {TABS.map((l) => (
          <Item key={l.to} link={l} pathname={loc.pathname} />
        ))}
      </nav>
    </div>
  )
}
