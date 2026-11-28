import { lookupGiftPreview } from './giftImage.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ image: null, source: null, domain: null })
    return
  }
  const pageUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url
  try {
    const preview = await lookupGiftPreview(String(pageUrl || ''))
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    res.status(200).json({
      image: preview.image || null,
      source: preview.source || null,
      domain: preview.domain || null,
    })
  } catch {
    res.status(400).json({ image: null, source: null, domain: null })
  }
}
