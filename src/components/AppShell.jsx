import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useBell } from '../lib/store.jsx'
import BackendBanner from './BackendBanner.jsx'
import { IconCal, IconGear, IconGift, IconHistory, IconHome, IconInbox, IconLearn, IconMeal, IconParty } from './Icons.jsx'

const HOUSEHOLD = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/calendar', label: 'Calendar', icon: IconCal },
  { to: '/meals', label: 'Meals', icon: IconMeal },
  { to: '/learning', label: 'Learning', icon: IconLearn },
]

const FAMILY = [
  { to: '/family', label: 'Family', icon: IconParty, match: ['/family', '/parties'] },
  { to: '/gifts', label: 'Gifts', icon: IconGift, match: ['/gifts'] },
]

const HOUSE = [
  { to: '/inbox', label: 'Inbox', icon: IconInbox },
  { to: '/history', label: 'History', icon: IconHistory },
  { to: '/settings', label: 'Settings', icon: IconGear },
]

const BOTTOM = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/calendar', label: 'Calendar', icon: IconCal },
  { to: '/family', label: 'Family', icon: IconParty, match: ['/family', '/parties', '/gifts'] },
  { to: '/meals', label: 'Meals', icon: IconMeal },
  { to: '/more', label: 'More', icon: IconGear, match: ['/more', '/learning', '/history', '/inbox', '/settings'] },
]

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

function isOn(link, pathname) {
  if (link.match) {
    return link.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  }
  if (link.end) return pathname === link.to
  return pathname === link.to || pathname.startsWith(`${link.to}/`)
}

function Item({ link, pathname }) {
  const active = isOn(link, pathname)
  return (
    <NavLink to={link.to} end={link.end} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
      <link.icon />
      {link.label}
    </NavLink>
  )
}

function allowedPath(role, pathname) {
  if (role === 'gift') {
    return pathname.startsWith('/gifts') || pathname.startsWith('/settings') || pathname === '/more' || pathname === '/family'
  }
  if (role === 'guest') {
    return (
      pathname.startsWith('/family') ||
      pathname.startsWith('/parties') ||
      pathname.startsWith('/settings') ||
      pathname === '/more'
    )
  }
  return true
}

export default function AppShell() {
  const loc = useLocation()
  const { state } = useBell()
  const role = state.memberRole
  if (!allowedPath(role, loc.pathname)) {
    return <Navigate to={role === 'guest' ? '/family' : '/gifts'} replace />
  }
  const modeLabel = state.backend === 'live' ? 'Live' : state.backend === 'offline' ? 'Offline' : 'Demo'
  const bottom = role === 'gift'
    ? BOTTOM.filter((link) => link.to === '/family' || link.to === '/more')
    : role === 'guest'
      ? BOTTOM.filter((link) => link.to === '/family' || link.to === '/more')
      : BOTTOM

  return (
    <div className="app-shell">
      <div className="talavera" aria-hidden="true" />
      <nav className="side-nav" aria-label="Primary">
        <Brand />
        {role === 'gift' || role === 'guest' ? null : <div className="nav-label">Household</div>}
        {role === 'gift' || role === 'guest' ? null : HOUSEHOLD.map((link) => (
          <Item key={link.to} link={link} pathname={loc.pathname} />
        ))}
        <div className="nav-label">Family & friends</div>
        {(role === 'gift' ? FAMILY.filter((link) => link.to === '/gifts') : role === 'guest' ? FAMILY.filter((link) => link.to === '/family') : FAMILY).map((link) => (
          <Item key={link.to} link={link} pathname={loc.pathname} />
        ))}
        <div className="nav-label">House</div>
        {(role === 'gift' || role === 'guest' ? HOUSE.filter((link) => link.to === '/settings') : HOUSE).map((link) => (
          <Item key={link.to} link={link} pathname={loc.pathname} />
        ))}
      </nav>
      <header className="topbar">
        <Brand />
        <div className="topbar-meta">{modeLabel}</div>
      </header>
      <main className="page">
        <BackendBanner />
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Primary">
        {bottom.map((link) => (
          <Item key={link.to} link={link} pathname={loc.pathname} />
        ))}
      </nav>
    </div>
  )
}
