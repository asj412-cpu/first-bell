import { HOUSEHOLD } from '../data/seed.js'
import { useBell } from '../lib/store.jsx'

export default function BackendBanner() {
  const { state } = useBell()
  const mode = state.backend
  if (mode === 'live' || mode === 'connecting') return null

  const demo = mode === 'demo'
  return (
    <div className={`sync-banner ${demo ? 'demo' : 'offline'}`} role="status">
      {demo ? (
        <>
          <strong>Demo mode.</strong> Supabase env vars aren’t set, so RSVPs stay in this
          browser only. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> on
          Vercel to sync across devices.
        </>
      ) : (
        <>
          <strong>Offline / unreachable.</strong> {state.backendMessage || 'Couldn’t reach Supabase.'}{' '}
          Showing the {HOUSEHOLD.name} seed on this device until the backend is back.
        </>
      )}
    </div>
  )
}
