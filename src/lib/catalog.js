import catalogSeed from '../data/catalog.json'

export const CATALOG_TABS = [
  { id: 'toys', speak: 'Toys' },
  { id: 'clothes', speak: 'Clothes' },
  { id: 'learning', speak: 'Learning' },
]

const CATEGORIES = new Set(CATALOG_TABS.map((tab) => tab.id))

export function ageFits(ageFit, years) {
  if (years == null || Number.isNaN(Number(years))) return false
  const fit = String(ageFit || '').replace(/\s/g, '')
  if (/^\d+$/.test(fit)) return Number(years) === Number(fit)
  const range = fit.match(/^(\d+)-(\d+)$/)
  if (!range) return false
  const low = Math.min(Number(range[1]), Number(range[2]))
  const high = Math.max(Number(range[1]), Number(range[2]))
  return Number(years) >= low && Number(years) <= high
}

export function normalizeCatalogItem(row, index = 0) {
  const category = CATEGORIES.has(row.category) ? row.category : 'toys'
  const price = row.price === '' || row.price == null ? null : Number(row.price)
  return {
    id: row.id,
    name: String(row.name || '').trim().slice(0, 80),
    category,
    ageFit: String(row.ageFit || row.age_fit || '').replace(/\s/g, ''),
    retailer: String(row.retailer || '').trim().slice(0, 80),
    price: price == null || Number.isNaN(price) ? null : Math.round(price * 100) / 100,
    url: String(row.url || '').trim(),
    image: String(row.image || '').trim(),
    active: row.active !== false,
    sort: row.sort ?? index,
  }
}

export function cloneCatalog(seed = catalogSeed) {
  return seed.map((row, index) => normalizeCatalogItem(row, index))
}

export function catalogForKid(catalog, years, category) {
  return [...(catalog || [])]
    .filter((item) => item.active !== false && ageFits(item.ageFit, years))
    .filter((item) => !category || item.category === category)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
}

export function fromDbCatalog(row) {
  return normalizeCatalogItem({
    id: row.id,
    name: row.name,
    category: row.category,
    age_fit: row.age_fit,
    retailer: row.retailer,
    price: row.price,
    url: row.url,
    image: row.image,
    active: row.active,
    sort: row.sort,
  })
}

export function moneyLabel(price) {
  if (price == null || price === '' || Number.isNaN(Number(price))) return ''
  const amount = Number(price)
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`
}
