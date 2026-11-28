import assert from 'node:assert/strict'
import test from 'node:test'
import { faviconUrlFor, isFallbackGiftImage, linkPreviewDomain } from './giftPreview.js'

test('a gift link shows the site domain without www', () => {
  assert.equal(linkPreviewDomain('https://www.basspro.com/shop/en/gift-card'), 'basspro.com')
  assert.equal(linkPreviewDomain('https://store.example.co.uk/p/1'), 'store.example.co.uk')
  assert.equal(linkPreviewDomain('not a url'), '')
})

test('the logo fallback is a large Google favicon for that domain', () => {
  assert.equal(
    faviconUrlFor('https://www.basspro.com/shop/en/gift-card'),
    'https://www.google.com/s2/favicons?domain=basspro.com&sz=128',
  )
  assert.equal(faviconUrlFor('nope'), '')
})

test('favicon and apple-touch URLs are treated as logo tiles, not product photos', () => {
  assert.equal(isFallbackGiftImage('https://www.google.com/s2/favicons?domain=basspro.com&sz=128'), true)
  assert.equal(isFallbackGiftImage('https://t2.gstatic.com/faviconV2?url=http://shop.example&size=128'), true)
  assert.equal(isFallbackGiftImage('https://shop.example/apple-touch-icon.png'), true)
  assert.equal(isFallbackGiftImage('https://shop.example/favicon.ico'), true)
  assert.equal(isFallbackGiftImage('https://cdn.example/products/scarf.jpg'), false)
  assert.equal(isFallbackGiftImage(''), false)
})
