export function linkPreviewDomain(value) {
  try {
    const host = new URL(String(value || '').trim()).hostname.toLowerCase()
    return host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function faviconUrlFor(value) {
  const domain = linkPreviewDomain(value)
  if (!domain) return ''
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
}

export function isFallbackGiftImage(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return false
  return (
    raw.includes('google.com/s2/favicons') ||
    raw.includes('gstatic.com/faviconv2') ||
    raw.includes('t0.gstatic.com/favicon') ||
    raw.includes('t1.gstatic.com/favicon') ||
    raw.includes('t2.gstatic.com/favicon') ||
    raw.includes('t3.gstatic.com/favicon') ||
    /\/favicon\.ico(?:$|\?)/.test(raw) ||
    raw.includes('apple-touch-icon')
  )
}
