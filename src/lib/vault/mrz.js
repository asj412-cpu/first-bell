const WEIGHTS = [7, 3, 1]

export function mrzValue(char) {
  if (char === '<') return 0
  if (char >= '0' && char <= '9') return char.charCodeAt(0) - 48
  if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 55
  return null
}

export function checkDigit(input) {
  let sum = 0
  for (let i = 0; i < input.length; i += 1) {
    const value = mrzValue(input[i])
    if (value == null) return null
    sum += value * WEIGHTS[i % 3]
  }
  return String(sum % 10)
}

function cleanLine(line) {
  return String(line || '').toUpperCase().replace(/\s+/g, '')
}

export function yyMMddToIso(value, kind, now = new Date()) {
  if (!/^\d{6}$/.test(value)) return ''
  const yy = Number(value.slice(0, 2))
  const month = value.slice(2, 4)
  const day = value.slice(4, 6)
  let year = 2000 + yy
  if (kind === 'birth') {
    const candidate = new Date(Date.UTC(year, Number(month) - 1, Number(day)))
    if (candidate.getTime() > now.getTime()) year -= 100
  }
  return `${year}-${month}-${day}`
}

function prettyName(value) {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

function nameFromMrz(field) {
  const [surname = '', given = ''] = field.split('<<')
  const givenName = prettyName(given.replace(/</g, ' ').replace(/\s+/g, ' ').trim())
  const family = prettyName(surname.replace(/</g, ' ').replace(/\s+/g, ' ').trim())
  return [givenName, family].filter(Boolean).join(' ')
}

export function parseTd3(line1, line2, now = new Date()) {
  const a = cleanLine(line1)
  const b = cleanLine(line2)
  if (a.length < 44 || b.length < 44) return null
  const number = b.slice(0, 9).replace(/</g, '')
  if (checkDigit(b.slice(0, 9)) !== b[9]) return null
  if (checkDigit(b.slice(13, 19)) !== b[19]) return null
  if (checkDigit(b.slice(21, 27)) !== b[27]) return null
  const optional = b.slice(28, 42)
  const optionalCheck = b[42]
  if (optionalCheck !== '<' && checkDigit(optional) !== optionalCheck) return null
  const composite = b.slice(0, 10) + b.slice(13, 20) + b.slice(21, 43)
  if (checkDigit(composite) !== b[43]) return null
  return {
    docType: a[0] === 'P' ? 'passport' : 'id',
    issuer: a.slice(2, 5).replace(/</g, ''),
    name: nameFromMrz(a.slice(5)),
    number,
    dob: yyMMddToIso(b.slice(13, 19), 'birth', now),
    expiresOn: yyMMddToIso(b.slice(21, 27), 'expiry', now),
    nationality: b.slice(10, 13).replace(/</g, ''),
  }
}

export function parseMrz(text, now = new Date()) {
  const lines = String(text || '')
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9<]/g, ''))
    .filter((line) => line.length >= 30)
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].length >= 44 && lines[i + 1].length >= 44) {
      const parsed = parseTd3(lines[i], lines[i + 1], now)
      if (parsed) return parsed
    }
  }
  return null
}
