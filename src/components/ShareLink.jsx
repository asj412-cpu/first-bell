import { useState } from 'react'
import { shareLinks } from '../lib/invites.js'

export default function ShareLink({ url, subject, text, onDone }) {
  const [copied, setCopied] = useState(false)
  const links = shareLinks({ url, subject, text })
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      onDone?.('Link copied')
    } catch {
      setCopied(false)
      onDone?.('Select the link and copy it')
    }
    setTimeout(() => setCopied(false), 1600)
  }

  async function share() {
    try {
      await navigator.share({ title: subject, text, url })
      onDone?.('Share sheet opened')
    } catch (err) {
      if (err?.name === 'AbortError') return
      onDone?.('Could not open the share sheet')
    }
  }

  return (
    <div className="share-sheet">
      <label className="field">
        <span>Invite link</span>
        <input readOnly value={url} onFocus={(event) => event.target.select()} />
      </label>
      <div className="share-actions">
        <button className="btn primary" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {canShare && (
          <button className="btn" type="button" onClick={share}>
            Share
          </button>
        )}
        <a className="btn" href={links.sms}>
          Text
        </a>
        <a className="btn" href={links.mailto}>
          Email
        </a>
      </div>
      <p className="gate-note">Nothing is sent from Mi Casa. The link goes out from your phone.</p>
    </div>
  )
}
