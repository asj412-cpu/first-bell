import catalogSeed from '../data/catalog.json'

export const CATALOG_CATEGORIES = [
  { id: 'toys', speak: 'Toys' },
  { id: 'clothes', speak: 'Clothes' },
  { id: 'learning', speak: 'Learning' },
]

export const CATALOG_TABS = [
  { id: 'trending', speak: 'Trending' },
  ...CATALOG_CATEGORIES,
]

const CATEGORY_ALIASES = {
  toy: 'toys',
  toys: 'toys',
  clothes: 'clothes',
  educational: 'learning',
  learning: 'learning',
}

export function ageFits(ageFit, years) {
  if (years == null || Number.isNaN(Number(years))) return false
  const fit = String(ageFit || '').replace(/\s/g, '')
  const age = Number(years)
  // "both" is the shared list for Claire (6) and Chloe (5).
  if (fit === 'both') return age === 5 || age === 6
  if (/^\d+$/.test(fit)) return age === Number(fit)
  const range = fit.match(/^(\d+)-(\d+)$/)
  if (!range) return false
  const low = Math.min(Number(range[1]), Number(range[2]))
  const high = Math.max(Number(range[1]), Number(range[2]))
  return age >= low && age <= high
}

export function clothingSizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/girls'?\s*/g, '')
    .replace(/size\s*/g, '')
    .replace(/\s+/g, '')
}

function tokenCovers(token, kid) {
  const size = clothingSizeKey(token)
  if (!size || !kid) return false
  if (size === kid) return true
  const floor = size.match(/^(\d+)\/\d+(?:\+|-up)$/)
  if (floor) return /^\d+$/.test(kid) && Number(kid) >= Number(floor[1])
  const pair = size.match(/^(\d+)\/(\d+)$/)
  if (pair) return kid === pair[1] || kid === pair[2]
  const range = size.match(/^(\d+)(t)?-(\d+)(t)?$/)
  if (!range) return false
  const low = Math.min(Number(range[1]), Number(range[3]))
  const high = Math.max(Number(range[1]), Number(range[3]))
  const toddler = kid.match(/^(\d+)t$/)
  if (toddler) {
    if (!range[2] && !range[4]) return false
    const n = Number(toddler[1])
    return n >= low && n <= high
  }
  if (!/^\d+$/.test(kid)) return false
  const n = Number(kid)
  return n >= low && n <= high
}

export function sizeFits(sizes, clothingSize) {
  const kid = clothingSizeKey(clothingSize)
  const raw = String(sizes || '').trim()
  if (!kid || !raw) return false
  return raw.split(',').some((token) => tokenCovers(token, kid))
}

export function sizeLabel(sizes) {
  const raw = String(sizes || '').trim()
  if (!raw) return ''
  if (raw.toLowerCase() === '5/6+') return 'from 5/6'
  return raw
}

export function normalizeCatalogItem(row, index = 0) {
  const category = CATEGORY_ALIASES[String(row.category || '').trim().toLowerCase()] || 'toys'
  const price = row.price === '' || row.price == null ? null : Number(row.price)
  const out = row.inStock === false || row.in_stock === false || row.in_stock_online === false
  return {
    id: row.id,
    slug: String(row.slug || '').trim(),
    name: String(row.name || '').trim().slice(0, 160),
    category,
    ageFit: String(row.ageFit || row.age_fit || '').replace(/\s/g, ''),
    retailer: String(row.retailer || '').trim().slice(0, 80),
    price: price == null || Number.isNaN(price) ? null : Math.round(price * 100) / 100,
    url: String(row.url || '').trim(),
    image: String(row.image || '').trim(),
    active: row.active !== false,
    inStock: !out,
    trending: Boolean(row.trending),
    checkSize: row.checkSize === true || row.check_size === true,
    sizes: String(row.sizes || '').trim(),
    sort: row.sort ?? index,
  }
}

export function cloneCatalog(seed = catalogSeed) {
  return seed.map((row, index) => normalizeCatalogItem(row, index))
}

export function matchesCatalogTab(item, tab) {
  if (!tab) return true
  if (tab === 'trending') return Boolean(item.trending)
  return item.category === tab
}

export function catalogForKid(catalog, years, tab, clothingSize) {
  return [...(catalog || [])]
    .filter((item) => {
      if (item.active === false || !ageFits(item.ageFit, years) || !matchesCatalogTab(item, tab)) return false
      if (item.category === 'clothes' && !sizeFits(item.sizes, clothingSize)) return false
      return true
    })
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
}

export function fromDbCatalog(row) {
  return normalizeCatalogItem({
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    age_fit: row.age_fit,
    retailer: row.retailer,
    price: row.price,
    url: row.url,
    image: row.image,
    active: row.active,
    in_stock: row.in_stock,
    trending: row.trending,
    check_size: row.check_size,
    sizes: row.sizes,
    sort: row.sort,
  })
}

export function moneyLabel(price) {
  if (price == null || price === '' || Number.isNaN(Number(price))) return ''
  const amount = Number(price)
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`
}

export function spokenProduct(product) {
  if (!product?.name) return ''
  if (product.inStock === false) return `${product.name}. Ask a grown-up.`
  return product.name
}
