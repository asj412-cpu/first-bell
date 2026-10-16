const MOTIFS = [
  ['halloween', '/brand/motif-halloween.png'],
  ['thanksgiving', '/brand/motif-thanksgiving.png'],
  ['christmas-eve', '/brand/motif-candle.png'],
  ['christmas eve', '/brand/motif-candle.png'],
  ['christmas', '/brand/motif-christmas.png'],
  ['veteran', '/brand/motif-poppy.png'],
]

export function motifFor(item) {
  const blob = `${item?.key || ''} ${item?.id || ''} ${item?.title || ''}`.toLowerCase()
  if (item?.source === 'birthday' || blob.includes('birthday')) return '/brand/motif-birthday.png'
  for (const [needle, src] of MOTIFS) {
    if (blob.includes(needle)) return src
  }
  return '/icons/icon-192.png'
}
