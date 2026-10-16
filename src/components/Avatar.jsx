const TINTS = ['#C8643B', '#7A9A74', '#F2B544', '#8C4A32', '#3A2A22']

export function avatarTint(seed = '') {
  const n = [...String(seed)].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const background = TINTS[n % TINTS.length]
  const color = background === '#F2B544' ? '#3A2A22' : '#FFFAF5'
  return { background, color }
}

export default function Avatar({ name, seed, className = '' }) {
  const letter = (name || '?').trim().slice(0, 1).toUpperCase()
  return (
    <span className={`avatar ${className}`.trim()} style={avatarTint(seed || name)} aria-hidden="true">
      {letter}
    </span>
  )
}
