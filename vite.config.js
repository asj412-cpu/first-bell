import { lookupGiftImage } from './api/giftImage.js'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function giftImageDev() {
  return {
    name: 'gift-image-dev',
    configureServer(server) {
      server.middlewares.use('/api/gift-image', async (req, res) => {
        const target = new URL(req.url || '/', 'http://localhost').searchParams.get('url') || ''
        try {
          const image = await lookupGiftImage(target)
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'public, max-age=86400')
          res.end(JSON.stringify({ image: image || null }))
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ image: null }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), giftImageDev()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
})
