import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BabyDollArt, BackArt, BiggerDollArt, CameraArt, CategoryArt, ClothesArt, DollClothesArt, GiftArt, HeartArt, LearningArt, LockArt, MicArt, SparkleArt, SpeakerArt, ToysArt } from '../components/KidArt.jsx'
import { CATALOG_TABS, DOLL_FILTERS, catalogForKid, matchesCatalogTab, matchesDollFilter, normalizeCatalogItem, spokenProduct } from '../lib/catalog.js'
import {
  KID_PROMPTS,
  blobToDataUrl,
  chime,
  findKidList,
  kidIcon,
  kidVisibleItems,
  payloadToKidList,
  safeMedia,
  shrinkImage,
  speak,
} from '../lib/kidGifts.js'
import { ageInYears } from '../lib/planner.js'
import { useBell } from '../lib/store.jsx'
import { supabase } from '../lib/supabase.js'

const TAB_ART = {
  trending: SparkleArt,
  toys: ToysArt,
  clothes: ClothesArt,
  learning: LearningArt,
  dolls: DollClothesArt,
}

const DOLL_ART = {
  baby: BabyDollArt,
  toddler: BiggerDollArt,
}

const BURST = [
  ['-80px', '-120px', '#C8643B'],
  ['90px', '-90px', '#F2B544'],
  ['-120px', '20px', '#7A9A74'],
  ['110px', '40px', '#C8643B'],
  ['-20px', '-140px', '#F2B544'],
  ['40px', '110px', '#7A9A74'],
  ['-100px', '90px', '#F2B544'],
  ['130px', '-20px', '#C8643B'],
]

function setMeta(name, kidKey) {
  document.title = name
  const icon = kidIcon(kidKey)
  let apple = document.querySelector('link[rel="apple-touch-icon"]')
  if (!apple) {
    apple = document.createElement('link')
    apple.rel = 'apple-touch-icon'
    document.head.appendChild(apple)
  }
  apple.href = icon
  const title = document.querySelector('meta[name="apple-mobile-web-app-title"]')
  if (title) title.content = name
  const theme = document.querySelector('meta[name="theme-color"]')
  if (theme) theme.content = '#F6EFE6'
  const manifest = document.querySelector('link[rel="manifest"]')
  const blob = new Blob(
    [
      JSON.stringify({
        name,
        short_name: name,
        start_url: window.location.pathname,
        scope: window.location.pathname,
        display: 'standalone',
        background_color: '#F6EFE6',
        theme_color: '#C8643B',
        icons: [
          { src: icon, sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      }),
    ],
    { type: 'application/manifest+json' },
  )
  const url = URL.createObjectURL(blob)
  const previous = manifest?.href
  if (manifest) manifest.href = url
  return () => {
    document.title = 'Mi Casa'
    if (title) title.content = 'Mi Casa'
    if (theme) theme.content = '#C8643B'
    if (manifest && previous) manifest.href = previous
    URL.revokeObjectURL(url)
  }
}

function WishFace({ item }) {
  const image = safeMedia(item.image, 'image')
  if (image) return <img src={image} alt="" />
  if (item.category) return <CategoryArt id={item.category} />
  if (safeMedia(item.audio, 'audio')) return <MicArt />
  return <GiftArt />
}

export default function KidPad() {
  const { secret = '' } = useParams()
  const navigate = useNavigate()
  const { state, entered, addKidWish, checkKidPin } = useBell()
  const demoList = supabase ? null : findKidList(state.giftLists, secret)
  const [remote, setRemote] = useState(null)
  const [remoteCatalog, setRemoteCatalog] = useState([])
  const [loading, setLoading] = useState(Boolean(supabase))
  const [panel, setPanel] = useState('home')
  const [tab, setTab] = useState('trending')
  const [dollFilter, setDollFilter] = useState('')
  const [burst, setBurst] = useState(false)
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pin, setPin] = useState('')
  const [listening, setListening] = useState(false)
  const stopMic = useRef(null)
  const trap = useRef(null)
  const lock = useRef(false)

  const list = supabase ? remote : demoList
  const prompt = panel === 'pin' ? KID_PROMPTS.pin : listening ? KID_PROMPTS.mic : list ? KID_PROMPTS.home(list.displayName) : KID_PROMPTS.missing

  useEffect(() => {
    if (!list) return undefined
    return setMeta(list.displayName, list.kidKey)
  }, [list])

  useEffect(() => {
    function onPop() {
      window.history.pushState(null, '', window.location.href)
    }
    trap.current = onPop
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [secret])

  useEffect(() => {
    function block(event) {
      const anchor = event.target.closest?.('a')
      if (anchor) event.preventDefault()
    }
    document.addEventListener('click', block, true)
    return () => document.removeEventListener('click', block, true)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.rpc('get_kid_gift_list', { p_secret: secret }),
      supabase.rpc('get_kid_catalog', { p_secret: secret }),
    ]).then(([listRes, catRes]) => {
      if (cancelled) return
      if (listRes.error || !listRes.data) setRemote(null)
      else setRemote(payloadToKidList(listRes.data))
      const rows = Array.isArray(catRes.data) ? catRes.data : []
      setRemoteCatalog(rows.map((row, index) => normalizeCatalogItem(row, index)))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [secret])

  useEffect(() => () => stopMic.current?.(), [])

  async function refresh() {
    if (!supabase) return
    const { data } = await supabase.rpc('get_kid_gift_list', { p_secret: secret })
    if (data) setRemote(payloadToKidList(data))
  }

  function celebrate(phrase) {
    try {
      chime()
    } catch {
      /* sound is a bonus */
    }
    speak(phrase || KID_PROMPTS.saved)
    setBurst(true)
    window.setTimeout(() => setBurst(false), 900)
  }

  function stumble(error) {
    const wait = /slow down/i.test(error?.message || '')
    speak(wait ? KID_PROMPTS.wait : KID_PROMPTS.retry)
    setShake(true)
    window.setTimeout(() => setShake(false), 480)
  }

  async function saveWish(fields, phrase) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      await addKidWish(secret, fields)
      await refresh()
      setListening(false)
      celebrate(phrase)
    } catch (error) {
      stumble(error)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function onHeart(product) {
    const picked = items.some((item) => item.catalogId === product.id)
    const phrase = spokenProduct(product)
    if (picked) {
      celebrate(phrase)
      return
    }
    await saveWish({ kind: 'catalog', catalogId: product.id }, phrase)
  }

  async function onPhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    speak(KID_PROMPTS.camera)
    try {
      const image = await shrinkImage(file)
      await saveWish({ kind: 'photo', image })
    } catch (error) {
      stumble(error)
    }
  }

  async function startMic() {
    if (listening || busy) return
    speak(KID_PROMPTS.mic)
    setListening(true)
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setListening(false)
      stumble(new Error('retry'))
      return
    }
    const mime = ['audio/mp4', 'audio/webm'].find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || ''
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks = []
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data)
    }
    let transcript = ''
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition
    let recognition = null
    if (Speech) {
      recognition = new Speech()
      recognition.lang = 'en-US'
      recognition.interimResults = true
      recognition.continuous = true
      recognition.onresult = (event) => {
        transcript = [...event.results].map((result) => result[0]?.transcript || '').join(' ').trim()
      }
      try {
        recognition.start()
      } catch {
        recognition = null
      }
    }
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve
    })
    recorder.start()
    let finished = false
    const finish = async () => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      try {
        recognition?.stop()
      } catch {
        /* already stopped */
      }
      if (recorder.state !== 'inactive') recorder.stop()
      await stopped
      stream.getTracks().forEach((track) => track.stop())
      setListening(false)
      stopMic.current = null
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' })
        const audio = await blobToDataUrl(blob)
        await saveWish({ kind: 'voice', label: transcript.slice(0, 160), audio })
      } catch (error) {
        stumble(error)
      }
    }
    const timer = window.setTimeout(finish, 6000)
    stopMic.current = finish
  }

  function finishLeave() {
    window.removeEventListener('popstate', trap.current)
    navigate(entered ? '/gifts' : '/enter', { replace: true })
  }

  async function submitPin(next) {
    setBusy(true)
    const ok = await checkKidPin(secret, next)
    setBusy(false)
    setPin('')
    if (ok) {
      try {
        chime()
      } catch {
        /* ignore */
      }
      finishLeave()
      return
    }
    setShake(true)
    speak(KID_PROMPTS.pinNo)
    window.setTimeout(() => setShake(false), 480)
  }

  function press(digit) {
    if (busy || pin.length >= 4) return
    const next = `${pin}${digit}`
    setPin(next)
    if (next.length === 4) submitPin(next)
  }

  if (loading) {
    return (
      <div className="kid-pad">
        <img className="kid-photo" src="/kids/kid.png" alt="" />
      </div>
    )
  }

  if (!list) {
    return (
      <div className="kid-pad">
        <div className="kid-top">
          <img className="kid-photo" src="/kids/kid.png" alt="" />
          <button className="kid-icon-btn" type="button" aria-label="Hear it" onClick={() => speak(KID_PROMPTS.missing)}>
            <SpeakerArt />
          </button>
        </div>
      </div>
    )
  }

  const items = kidVisibleItems(list)
  const profile = state.profiles.find((row) => row.memberKey === list.kidKey)
  const years = ageInYears(profile?.birthDate)
  const dollChoices = supabase
    ? remoteCatalog.filter((item) => item.category === 'dolls')
    : catalogForKid(state.catalog, years, 'dolls', profile?.clothingSize)
  const tabs = dollChoices.length ? CATALOG_TABS : CATALOG_TABS.filter((entry) => entry.id !== 'dolls')
  const pickedTab = tabs.some((entry) => entry.id === tab) ? tab : 'trending'
  const products = (supabase
    ? remoteCatalog.filter((item) => matchesCatalogTab(item, pickedTab))
    : catalogForKid(state.catalog, years, pickedTab, profile?.clothingSize)
  ).filter((item) => pickedTab !== 'dolls' || matchesDollFilter(item, dollFilter))

  return (
    <div className={`kid-pad ${shake ? 'shake' : ''}`} data-panel={panel}>
      <div className="kid-top">
        <img className="kid-photo" src={kidIcon(list.kidKey)} alt="" />
        <h1 className="kid-name">{list.displayName}</h1>
        <button className="kid-icon-btn" type="button" aria-label="Hear it" onClick={() => speak(prompt)}>
          <SpeakerArt />
        </button>
        <button
          className="kid-icon-btn"
          type="button"
          aria-label="Lock"
          onClick={() => {
            setPanel('pin')
            setPin('')
            speak(KID_PROMPTS.pin)
          }}
        >
          <LockArt />
        </button>
      </div>

      {panel === 'pin' ? (
        <div className={`kid-pin ${shake ? 'shake' : ''}`}>
          <div className="kid-dots" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <i key={index} className={index < pin.length ? 'on' : ''} />
            ))}
          </div>
          <div className="kid-digits">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
              <button key={digit} type="button" className="kid-digit" onClick={() => press(digit)} aria-label={digit}>
                {digit}
              </button>
            ))}
          </div>
          <button className="kid-icon-btn kid-back" type="button" aria-label="Back" onClick={() => setPanel('home')}>
            <BackArt />
          </button>
        </div>
      ) : (
        <>
          <div className="kid-tabs" role="tablist" aria-label="Pictures">
            {tabs.map((entry) => {
              const Art = TAB_ART[entry.id]
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  className={`kid-tab ${entry.id === 'dolls' ? 'wide' : ''} ${pickedTab === entry.id ? 'on' : ''}`}
                  aria-label={entry.speak}
                  aria-selected={pickedTab === entry.id}
                  onClick={() => {
                    setTab(entry.id)
                    speak(entry.speak)
                  }}
                >
                  <Art />
                </button>
              )
            })}
          </div>
          {pickedTab === 'dolls' && (
            <div className="kid-doll-filters" role="group" aria-label="Doll size">
              {DOLL_FILTERS.map((entry) => {
                const Art = DOLL_ART[entry.id]
                const on = dollFilter === entry.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`kid-doll-chip ${on ? 'on' : ''}`}
                    aria-label={entry.speak}
                    aria-pressed={on}
                    onClick={() => {
                      setDollFilter(on ? '' : entry.id)
                      speak(entry.speak)
                    }}
                  >
                    <Art />
                  </button>
                )
              })}
            </div>
          )}
          <div className="kid-catalog">
            {products.map((product) => {
              const image = safeMedia(product.image, 'image')
              const picked = items.some((item) => item.catalogId === product.id)
              const phrase = spokenProduct(product)
              return (
                <article className="kid-product" key={product.id}>
                  <button type="button" className="kid-photo-btn" aria-label={product.name} onClick={() => speak(phrase)}>
                    {image ? <img src={image} alt="" /> : <CategoryArt id={product.category} />}
                  </button>
                  {product.inStock === false && <span className="kid-ask">ask a grown-up</span>}
                  <button
                    type="button"
                    className="kid-heart-btn"
                    aria-label={`Save ${product.name}`}
                    aria-pressed={picked}
                    disabled={busy}
                    onClick={() => onHeart(product)}
                  >
                    <HeartArt filled={picked} />
                  </button>
                </article>
              )
            })}
          </div>
          {items.length > 0 && (
            <div className="kid-wishes">
              {items.map((item) => {
                const audio = safeMedia(item.audio, 'audio')
                return (
                  <div className="kid-wish" key={item.id}>
                    <WishFace item={item} />
                    {audio && (
                      <button
                        type="button"
                        className="kid-hear"
                        aria-label="Hear it"
                        onClick={() => {
                          const player = new Audio(audio)
                          player.play().catch(() => {})
                        }}
                      >
                        <SpeakerArt />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <div className="kid-secondary">
            <button
              type="button"
              className={`kid-side mic ${listening ? 'listening' : ''}`}
              aria-label="Microphone"
              aria-pressed={listening}
              disabled={busy && !listening}
              onClick={() => (listening ? stopMic.current?.() : startMic())}
            >
              <MicArt />
            </button>
            <label className="kid-side cam">
              <CameraArt />
              <input type="file" accept="image/*" capture="environment" aria-label="Camera" onChange={onPhoto} />
            </label>
          </div>
        </>
      )}

      {burst && (
        <div className="kid-pop" role="status">
          <div className="kid-heart">
            <HeartArt />
          </div>
          {BURST.map(([x, y, color]) => (
            <i key={`${x}${y}`} style={{ '--x': x, '--y': y, background: color }} />
          ))}
        </div>
      )}
    </div>
  )
}
