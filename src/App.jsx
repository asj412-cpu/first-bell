import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import { useBell } from './lib/store.jsx'
import Calendar from './pages/Calendar.jsx'
import Gate from './pages/Gate.jsx'
import GiftDetail from './pages/GiftDetail.jsx'
import Gifts from './pages/Gifts.jsx'
import GuestRsvp from './pages/GuestRsvp.jsx'
import History from './pages/History.jsx'
import Home from './pages/Home.jsx'
import Inbox from './pages/Inbox.jsx'
import Meals from './pages/Meals.jsx'
import Parties from './pages/Parties.jsx'
import PartyDetail from './pages/PartyDetail.jsx'
import PublicGift from './pages/PublicGift.jsx'
import Settings from './pages/Settings.jsx'
import Vault from './pages/Vault.jsx'

function BootScreen() {
  return (
    <div className="gate">
      <div className="gate-bg" aria-hidden="true" />
      <div className="card gate-card">
        <img className="bell" src="/brand/bell.jpg" alt="" />
        <div className="eyebrow">First Bell</div>
        <h1>Opening the house…</h1>
      </div>
    </div>
  )
}

function Protected({ children }) {
  const { entered, ready } = useBell()
  if (!ready) return <BootScreen />
  if (!entered) return <Navigate to="/enter" replace />
  return children
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
    <Routes>
      <Route path="/enter" element={<Gate />} />
      <Route path="/r/:slug" element={<GuestRsvp />} />
      <Route path="/g/:slug" element={<PublicGift />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/parties" element={<Parties />} />
        <Route path="/parties/:id" element={<PartyDetail />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/history" element={<History />} />
        <Route path="/meals" element={<Meals />} />
        <Route path="/gifts" element={<Gifts />} />
        <Route path="/gifts/:kidKey" element={<GiftDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/vault" element={<Vault />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
