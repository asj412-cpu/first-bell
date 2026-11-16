export async function requestReentry(email) {
  try {
    const response = await fetch('/api/reentry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 429) {
      return { mode: 'limited', message: data.error || 'Too many tries. Wait a few minutes and try again.' }
    }
    if (data.mode === 'session' && data.access_token && data.refresh_token) {
      return {
        mode: 'session',
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      }
    }
    return { mode: 'otp' }
  } catch {
    return { mode: 'otp' }
  }
}
