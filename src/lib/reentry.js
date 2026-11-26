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

/**
 * After a successful code or link sign-in, ask the server to remember this
 * device. The server sets an httpOnly cookie; this page never sees the token.
 * Failures are ignored: sign-in already worked, the next visit just asks for a code.
 */
export async function rememberDevice(accessToken) {
  if (!accessToken) return false
  try {
    const response = await fetch('/api/remember-device', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'same-origin',
    })
    return response.ok
  } catch {
    return false
  }
}

/** Sign-out: this device stops skipping the code. */
export async function forgetDevice() {
  try {
    await fetch('/api/remember-device', { method: 'DELETE', credentials: 'same-origin' })
  } catch {
    // ignore
  }
}
