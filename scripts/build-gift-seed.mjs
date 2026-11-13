/**
 * Builds the Christmas 2026 wish seed from the researched files in src/data/sources.
 * Age fit: "5" is Chloe, "6-7" is Claire, "both" is both.
 * Chloe's verified 5T clothes are added to her list only.
 * Retailer clothes (size not verified) go to Claire, with a check-size note.
 * Retailer toys for ages 5–7 go to both girls.
 * Drew gets an empty list. Prices stay "about $X" as of Oct 16, 2026.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = join(root, 'src/data/sources')
const catalogDir = join(root, 'public/catalog')
const files = new Set(readdirSync(catalogDir))

const catalog = JSON.parse(readFileSync(join(sources, 'catalog.json'), 'utf8'))
const chloe5t = JSON.parse(readFileSync(join(sources, 'chloe-5t-picks.json'), 'utf8'))
const retailer = JSON.parse(readFileSync(join(sources, 'retailer-picks.json'), 'utf8'))

function uuidFrom(name) {
  const bytes = Buffer.from(createHash('sha256').update(`micasa-christmas-2026:${name}`).digest().subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function aboutPrice(usd) {
  const n = Number(usd)
  if (!Number.isFinite(n)) return ''
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
  return `about $${text}`
}

function parseMoney(value) {
  if (typeof value === 'number') return value
  if (!value) return null
  const n = Number(String(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90)
}

function localImage(slug, declared) {
  const candidates = []
  if (declared) candidates.push(declared.replace(/^img\//, ''))
  candidates.push(`${slug}.jpg`, `${slug}.png`, `${slug}.webp`, `${slug}.jpeg`)
  for (const name of candidates) {
    if (files.has(name)) return `/catalog/${name}`
  }
  const prefix = slug.slice(0, 48)
  const hit = [...files].find((name) => name.startsWith(prefix))
  return hit ? `/catalog/${hit}` : ''
}

function notesFor(parts) {
  return parts.filter(Boolean).join(' · ').slice(0, 500)
}

function normalizeCatalog(item) {
  const price = aboutPrice(item.price_usd)
  return {
    slug: item.slug,
    name: item.name,
    category: item.category,
    ageFit: item.age_fit,
    trending: Boolean(item.trending),
    retailer: item.retailer || '',
    priceUsd: item.price_usd,
    priceLabel: price,
    url: item.url || '',
    image: localImage(item.slug, item.image),
    dollSize: item.doll_size || '',
    notes: notesFor([
      item.retailer,
      price,
      'price as of Oct 16, 2026',
      item.doll_fit_note,
      item.sizes_5_7 ? `sizes listed: ${item.sizes_5_7}` : '',
      item.in_stock_online === false ? 'was out of stock online on Oct 16, 2026' : '',
    ]),
  }
}

function normalize5t(item) {
  const price = aboutPrice(item.price_usd)
  return {
    slug: item.slug,
    name: item.name,
    category: 'Clothes',
    ageFit: '5',
    trending: false,
    retailer: item.retailer || '',
    priceUsd: item.price_usd,
    priceLabel: price,
    url: item.url || '',
    image: localImage(item.slug, item.image),
    dollSize: '',
    notes: notesFor([
      item.retailer,
      price,
      'price as of Oct 16, 2026',
      'Chloe wears 5T',
      item.size_5T_in_stock ? '5T was in stock that day' : 'check that 5T is still in stock',
      item.size_range ? `sizes listed: ${item.size_range}` : '',
    ]),
  }
}

function normalizeRetailer(item) {
  const slug = slugify(item.name)
  const priceUsd = parseMoney(item.price)
  const price = aboutPrice(priceUsd)
  const clothes = item.category === 'Clothes'
  return {
    slug,
    name: item.name,
    category: clothes ? 'Clothes' : 'Toy',
    ageFit: clothes ? '6-7' : 'both',
    trending: false,
    retailer: item.retailer || '',
    priceUsd,
    priceLabel: price,
    url: item.url || '',
    image: localImage(slug, ''),
    dollSize: '',
    notes: notesFor([
      item.retailer,
      price,
      'price as of Oct 16, 2026',
      clothes ? 'Check the size. Claire wears girls size 7. The size was not verified that day.' : '',
    ]),
  }
}

const seenUrl = new Set()
const items = []
for (const raw of [...catalog.map(normalizeCatalog), ...chloe5t.map(normalize5t), ...retailer.map(normalizeRetailer)]) {
  if (!raw.url || seenUrl.has(raw.url)) continue
  seenUrl.add(raw.url)
  items.push(raw)
}

const missingImages = items.filter((item) => !item.image)
if (missingImages.length) {
  console.log('missing images', missingImages.map((item) => item.slug).join(', '))
}

function wants(item, kid) {
  if (kid === 'chloe') return item.ageFit === '5' || item.ageFit === 'both'
  if (kid === 'claire') return item.ageFit === '6-7' || item.ageFit === 'both'
  return false
}

const categoryRank = { Toy: 0, 'Doll Clothes': 1, Educational: 2, Clothes: 3 }

function sortedFor(kid) {
  return items
    .filter((item) => wants(item, kid))
    .sort((a, b) => {
      if (a.trending !== b.trending) return a.trending ? -1 : 1
      const rank = (categoryRank[a.category] ?? 9) - (categoryRank[b.category] ?? 9)
      if (rank) return rank
      return a.name.localeCompare(b.name)
    })
    .map((item, sort) => ({
      id: `${kid}-${item.slug}`,
      title: item.name,
      notes: item.notes,
      url: item.url,
      urlSecondary: '',
      image: item.image,
      availability: '',
      category: item.category,
      priceLabel: item.priceLabel,
      retailer: item.retailer,
      ageFit: item.ageFit,
      dollSize: item.dollSize,
      sourceSlug: item.slug,
      sort,
      claimedByName: '',
      claimedAt: null,
    }))
}

const lists = [
  {
    id: 'list-chloe',
    kidKey: 'chloe',
    displayName: 'Chloe',
    occasion: 'Christmas 2026',
    shareSlug: 'a8k2-chloe-xmas',
    listKind: 'wish',
    items: sortedFor('chloe'),
  },
  {
    id: 'list-claire',
    kidKey: 'claire',
    displayName: 'Claire',
    occasion: 'Christmas 2026',
    shareSlug: 'm4p9-claire-xmas',
    listKind: 'wish',
    items: sortedFor('claire'),
  },
  {
    id: 'list-drew',
    kidKey: 'drew',
    displayName: 'Drew',
    occasion: 'Christmas 2026',
    shareSlug: 'q1w6-drew-xmas',
    listKind: 'wish',
    items: [],
  },
  {
    id: 'list-andrew',
    kidKey: 'andrew',
    displayName: 'Andrew',
    occasion: 'Christmas 2026',
    shareSlug: 'b7n3-andrew-xmas',
    listKind: 'exchange',
    items: [],
  },
  {
    id: 'list-megan',
    kidKey: 'megan',
    displayName: 'Megan',
    occasion: 'Christmas 2026',
    shareSlug: 'c2r8-megan-xmas',
    listKind: 'exchange',
    items: [],
  },
]

const seed = {
  occasion: 'Christmas 2026',
  priceAsOf: '2026-10-16',
  lists,
}

writeFileSync(join(root, 'src/data/christmas-2026-seed.json'), `${JSON.stringify(seed, null, 2)}\n`)

function sqlText(value) {
  if (value == null || value === '') return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

const listIds = {
  chloe: '44444444-4444-4444-8444-444444444401',
  claire: '44444444-4444-4444-8444-444444444402',
  drew: '44444444-4444-4444-8444-444444444403',
}

const rows = []
for (const list of lists) {
  if (list.listKind !== 'wish' || !list.items.length) continue
  for (const item of list.items) {
    rows.push(
      `  (${sqlText(uuidFrom(`${list.kidKey}:${item.sourceSlug}`))}::uuid, ${sqlText(listIds[list.kidKey])}::uuid, ${sqlText(item.title)}, ${sqlText(item.notes)}, ${sqlText(item.url)}, ${sqlText(item.image)}, ${sqlText(item.category)}, ${sqlText(item.priceLabel)}, ${sqlText(item.retailer)}, ${sqlText(item.ageFit)}, ${sqlText(item.dollSize || null)}, ${sqlText(item.sourceSlug)}, DATE '2026-10-16', ${item.sort})`,
    )
  }
}

const counts = {
  chloe: lists[0].items.length,
  claire: lists[1].items.length,
  drew: 0,
}
const byCat = (kid) => {
  const tally = {}
  for (const item of lists.find((list) => list.kidKey === kid).items) {
    tally[item.category] = (tally[item.category] || 0) + 1
  }
  return tally
}

const sql = `-- Christmas 2026 researched wishes. Generated by scripts/build-gift-seed.mjs.
-- Chloe ${counts.chloe} (${JSON.stringify(byCat('chloe'))}).
-- Claire ${counts.claire} (${JSON.stringify(byCat('claire'))}).
-- Drew stays empty. Prices are "about $X" as of Oct 16, 2026.
-- Removes the untouched starter wishes from 20261016040000. Leaves anything already claimed or edited.
-- Does not modify gift_catalog or the kid iPad functions.

DELETE FROM public.gift_items
WHERE id IN (
  '44444444-4444-4444-8444-444444444411',
  '44444444-4444-4444-8444-444444444412',
  '44444444-4444-4444-8444-444444444413',
  '44444444-4444-4444-8444-444444444414',
  '44444444-4444-4444-8444-444444444421',
  '44444444-4444-4444-8444-444444444422',
  '44444444-4444-4444-8444-444444444423',
  '44444444-4444-4444-8444-444444444431',
  '44444444-4444-4444-8444-444444444432',
  '44444444-4444-4444-8444-444444444433'
)
AND claimed_at IS NULL
AND COALESCE(notes, '') ILIKE '%Not pulled from a store%';

INSERT INTO public.gift_items (
  id, list_id, title, notes, url, image, category, price_label, retailer, age_fit, doll_size, source_slug, price_as_of, sort
)
VALUES
${rows.join(',\n')}
ON CONFLICT (list_id, source_slug) WHERE source_slug IS NOT NULL DO NOTHING;
`

writeFileSync(join(root, 'supabase/migrations/20261113191000_christmas_catalog_items.sql'), sql)
console.log(JSON.stringify({ chloe: counts.chloe, claire: counts.claire, byChloe: byCat('chloe'), byClaire: byCat('claire'), images: items.length - missingImages.length, missing: missingImages.length }, null, 2))
