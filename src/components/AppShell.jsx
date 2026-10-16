import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useBell } from '../lib/store.jsx'
import BackendBanner from './BackendBanner.jsx'
import { IconCal, IconGear, IconGift, IconHome, IconInbox, IconLock, IconMeal, IconParty } from './Icons.jsx'
import { useVault } from '../lib/vault/VaultProvider.jsx'

const LINKS = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/parties', label: 'Parties', icon: IconParty },
  { to: '/calendar', label: 'Calendar', icon: IconCal, also: '/history' },
  { to: '/meals', label: 'Meals', icon: IconMeal },
  { to: '/gifts', label: 'Gifts', icon: IconGift },
  { to: '/inbox', label: 'Inbox', icon: IconInbox },
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
  const { state } = useBell()
  const vault = useVault()
  const links = vault.canUse ? [...LINKS.slice(0, 5), { to: '/vault', label: 'Vault', icon: IconLock }, ...LINKS.slice(5)] : LINKS
  const title = links.find((l) => (l.end ? loc.pathname === '/' : loc.pathname.startsWith(l.to)))?.label || 'First Bell'
  const modeLabel =
    state.backend === 'live' ? 'Live' : state.backend === 'offline' ? 'Offline' : 'Demo'

  return (
    <div className="app-shell">
      <nav className="side-nav" aria-label="Primary">
        <Brand />
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive || (l.also && loc.pathname.startsWith(l.also)) ? 'active' : '')}
          >
            <l.icon />
            {l.label}
          </NavLink>
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
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive || (l.also && loc.pathname.startsWith(l.also)) ? 'active' : '')}
          >
            <l.icon />
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
