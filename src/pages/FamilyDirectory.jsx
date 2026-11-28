import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import { IconBack } from '../components/Icons.jsx'
import { directoryLine, directoryLink, sortDirectoryGroups } from '../lib/profiles.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

/**
 * Everyone's list, grouped by household. Shows names and idea counts only. It never
 * shows who bought what and never shows who is buying for whom: marking happens on each
 * list's own page, where the usual rules for marks and Secret Santa secrecy apply.
 */
export default function FamilyDirectory() {
  const { state } = useBell()
  const live = Boolean(supabase) && state.backend === 'live'
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!live) return undefined
    let cancelled = false
    supabase.rpc('get_family_directory').then(({ data: rows, error: rpcError }) => {
      if (cancelled) return
      if (rpcError) setError(rpcError.message || 'Could not load the family lists')
      else setData(rows)
    })
    return () => {
      cancelled = true
    }
  }, [live])

  const groups = sortDirectoryGroups(data?.groups, data?.mine_label)
  const total = groups.reduce((sum, group) => sum + (group.lists || []).length, 0)

  return (
    <div className="directory-page">
      <Link to="/gifts" className="back-link"><IconBack /> Gift lists</Link>
      <div className="kicker">Christmas 2026</div>
      <h1>Everyone’s lists</h1>
      <p className="lede">
        Tap a name to see their list and mark what you’re buying. They never see what you mark.
      </p>
      {!live && <p className="dim">The family lists need the live family site.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {live && !data && !error && <p className="dim">Loading the family…</p>}
      {data && total === 0 && <p className="dim">No lists yet.</p>}
      {groups.map((group) => (
        <section key={group.label} className="directory-group" aria-label={group.label}>
          <h2 className="section-label">{group.label}</h2>
          <div className="gift-index">
            {(group.lists || []).map((entry) => (
              <Link key={entry.list_id} to={directoryLink(entry)} className="card pad gift-kid directory-card">
                <Avatar name={entry.display_name} seed={entry.kid_key} />
                <div>
                  <h3 style={{ margin: 0 }}>{entry.display_name}</h3>
                  <p className="dim" style={{ margin: '4px 0 0' }}>{directoryLine(entry)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
