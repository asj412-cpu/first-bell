function Art({ children }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      {children}
    </svg>
  )
}

export function MicArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F3D7C8" />
      <rect x="48" y="28" width="24" height="40" rx="12" fill="#C8643B" />
      <path d="M40 58a20 20 0 0 0 40 0" fill="none" stroke="#3A2A22" strokeWidth="6" strokeLinecap="round" />
      <path d="M60 78v14M48 92h24" fill="none" stroke="#3A2A22" strokeWidth="6" strokeLinecap="round" />
    </Art>
  )
}

export function CameraArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#E5EFE2" />
      <rect x="24" y="40" width="72" height="48" rx="12" fill="#7A9A74" />
      <rect x="46" y="32" width="22" height="12" rx="4" fill="#3A2A22" />
      <circle cx="60" cy="64" r="14" fill="#F6EFE6" />
      <circle cx="60" cy="64" r="7" fill="#3A2A22" />
    </Art>
  )
}

export function PicturesArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F8E7C0" />
      <rect x="30" y="34" width="28" height="28" rx="8" fill="#C8643B" />
      <rect x="62" y="34" width="28" height="28" rx="8" fill="#7A9A74" />
      <rect x="30" y="66" width="28" height="28" rx="8" fill="#F2B544" />
      <rect x="62" y="66" width="28" height="28" rx="8" fill="#3A2A22" />
    </Art>
  )
}

export function SpeakerArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#FFF8F1" />
      <path d="M46 48h12l16-12v48L58 72H46z" fill="#C8643B" />
      <path d="M84 46c8 8 8 20 0 28" fill="none" stroke="#3A2A22" strokeWidth="6" strokeLinecap="round" />
    </Art>
  )
}

export function LockArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#FFF8F1" />
      <rect x="38" y="54" width="44" height="34" rx="8" fill="#3A2A22" />
      <path d="M46 54v-8a14 14 0 0 1 28 0v8" fill="none" stroke="#C8643B" strokeWidth="6" />
      <circle cx="60" cy="70" r="4" fill="#F2B544" />
    </Art>
  )
}

export function BackArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#FFF8F1" />
      <path d="M70 36 42 60l28 24" fill="none" stroke="#3A2A22" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </Art>
  )
}

export function GiftArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F6EFE6" />
      <rect x="30" y="48" width="60" height="44" rx="8" fill="#C8643B" />
      <path d="M30 62h60" stroke="#F2B544" strokeWidth="8" />
      <path d="M60 48v44" stroke="#F2B544" strokeWidth="8" />
      <path d="M60 48c-10-16-28-8-18 2" fill="none" stroke="#7A9A74" strokeWidth="6" strokeLinecap="round" />
      <path d="M60 48c10-16 28-8 18 2" fill="none" stroke="#7A9A74" strokeWidth="6" strokeLinecap="round" />
    </Art>
  )
}

export function HeartArt({ filled = true }) {
  return (
    <Art>
      <path
        d="M60 100 20 58a22 22 0 0 1 32-30l8 8 8-8a22 22 0 0 1 32 30z"
        fill={filled ? '#C8643B' : 'none'}
        stroke="#C8643B"
        strokeWidth="6"
      />
    </Art>
  )
}

export function ToysArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F3D7C8" />
      <rect x="34" y="58" width="52" height="22" rx="6" fill="#C8643B" />
      <circle cx="46" cy="82" r="8" fill="#3A2A22" />
      <circle cx="74" cy="82" r="8" fill="#3A2A22" />
      <rect x="48" y="40" width="18" height="16" rx="4" fill="#F2B544" />
    </Art>
  )
}

export function ClothesArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#E5EFE2" />
      <path d="M40 42 60 54 80 42l8 16-16 8v28H48V66L32 58z" fill="#7A9A74" />
    </Art>
  )
}

export function DollClothesArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F3D7C8" />
      <path d="M38 34h44l-8 18H46z" fill="#F2B544" />
      <path d="M28 62 60 48l32 14 10 40H18z" fill="#C8643B" />
      <path d="M60 48v54" stroke="#F6EFE6" strokeWidth="4" />
    </Art>
  )
}

export function BabyDollArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F8E7C0" />
      <path d="M46 42h28l-6 12H52z" fill="#F2B544" />
      <path d="M40 60 60 50l20 10 6 28H34z" fill="#C8643B" />
    </Art>
  )
}

export function BiggerDollArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F3D7C8" />
      <path d="M36 30h48l-8 16H44z" fill="#F2B544" />
      <path d="M24 54 60 40l36 14 8 48H16z" fill="#C8643B" />
    </Art>
  )
}

export function LearningArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F8E7C0" />
      <path d="M18 48c14 8 22 8 42 0v36c-20 8-28 8-42 0z" fill="#C8643B" />
      <path d="M102 48c-14 8-22 8-42 0v36c20 8 28 8 42 0z" fill="#F2B544" />
    </Art>
  )
}

export function SparkleArt() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F8E7C0" />
      <path d="M60 18 70 46 98 50 76 68 82 98 60 82 38 98 44 68 22 50 50 46Z" fill="#F2B544" />
      <circle cx="26" cy="28" r="6" fill="#C8643B" />
      <circle cx="94" cy="32" r="4" fill="#7A9A74" />
    </Art>
  )
}

function Lego() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F6EFE6" />
      <rect x="28" y="62" width="64" height="26" rx="4" fill="#C8643B" />
      <circle cx="42" cy="62" r="6" fill="#C8643B" />
      <circle cx="60" cy="62" r="6" fill="#C8643B" />
      <circle cx="78" cy="62" r="6" fill="#C8643B" />
      <rect x="36" y="40" width="48" height="22" rx="4" fill="#F2B544" />
      <circle cx="50" cy="40" r="5" fill="#F2B544" />
      <circle cx="70" cy="40" r="5" fill="#F2B544" />
    </Art>
  )
}

function ArtSupplies() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F3D7C8" />
      <ellipse cx="54" cy="64" rx="26" ry="18" fill="#FFF8F1" stroke="#3A2A22" strokeWidth="4" />
      <circle cx="42" cy="60" r="5" fill="#C8643B" />
      <circle cx="56" cy="56" r="5" fill="#F2B544" />
      <circle cx="66" cy="68" r="5" fill="#7A9A74" />
      <path d="M78 28l10 28-8 4-10-28z" fill="#3A2A22" />
    </Art>
  )
}

function Books() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#E5EFE2" />
      <rect x="30" y="36" width="16" height="52" rx="3" fill="#C8643B" />
      <rect x="50" y="30" width="16" height="58" rx="3" fill="#F2B544" />
      <rect x="70" y="40" width="16" height="48" rx="3" fill="#7A9A74" />
    </Art>
  )
}

function Games() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F8E7C0" />
      <rect x="34" y="34" width="52" height="52" rx="10" fill="#FFF8F1" stroke="#3A2A22" strokeWidth="4" />
      <circle cx="50" cy="50" r="6" fill="#C8643B" />
      <circle cx="70" cy="70" r="6" fill="#7A9A74" />
      <circle cx="70" cy="50" r="4" fill="#F2B544" />
    </Art>
  )
}

function Outdoors() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#E5EFE2" />
      <circle cx="86" cy="36" r="12" fill="#F2B544" />
      <path d="M28 86h64" stroke="#7A9A74" strokeWidth="8" strokeLinecap="round" />
      <path d="M60 86 60 48" stroke="#3A2A22" strokeWidth="6" />
      <circle cx="60" cy="46" r="16" fill="#7A9A74" />
    </Art>
  )
}

function DressUp() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F3D7C8" />
      <path d="M40 46h40l-6 14H46z" fill="#F2B544" />
      <circle cx="48" cy="44" r="4" fill="#C8643B" />
      <circle cx="60" cy="40" r="4" fill="#C8643B" />
      <circle cx="72" cy="44" r="4" fill="#C8643B" />
      <path d="M36 70 60 58l24 12 8 28H28z" fill="#C8643B" />
    </Art>
  )
}

function Stuffed() {
  return (
    <Art>
      <circle cx="60" cy="60" r="54" fill="#F8E7C0" />
      <circle cx="38" cy="40" r="12" fill="#C8643B" />
      <circle cx="82" cy="40" r="12" fill="#C8643B" />
      <circle cx="60" cy="64" r="26" fill="#C8643B" />
      <circle cx="50" cy="60" r="4" fill="#3A2A22" />
      <circle cx="70" cy="60" r="4" fill="#3A2A22" />
      <ellipse cx="60" cy="72" rx="8" ry="6" fill="#F3C7A6" />
    </Art>
  )
}

const TILES = {
  lego: Lego,
  art: ArtSupplies,
  books: Books,
  games: Games,
  outdoors: Outdoors,
  dressup: DressUp,
  stuffed: Stuffed,
  toys: ToysArt,
  clothes: ClothesArt,
  learning: LearningArt,
  dolls: DollClothesArt,
}

export function CategoryArt({ id }) {
  const Tile = TILES[id] || PicturesArt
  return <Tile />
}
