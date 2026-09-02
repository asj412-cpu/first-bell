import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import { useBell } from './lib/store.jsx'
import Calendar from './pages/Calendar.jsx'
import Gate from './pages/Gate.jsx'
import GuestRsvp from './pages/GuestRsvp.jsx'
import Home from './pages/Home.jsx'
import Inbox from './pages/Inbox.jsx'
import Parties from './pages/Parties.jsx'
import PartyDetail from './pages/PartyDetail.jsx'
import Settings from './pages/Settings.jsx'

function Protected({ children }) {
  const { entered } = useBell()
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
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
