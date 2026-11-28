// Mi Casa: sign in with email + a 4-digit PIN.
//
// Runs as a Supabase Edge Function, so the service role key comes from the
// Supabase runtime (SUPABASE_SERVICE_ROLE_KEY) and never touches Vercel, the
// browser bundle, or the repo. Deployed with verify_jwt=false because the login
// action has no session yet; status and set check the caller's access token here.
//
// POST JSON { action }
//   login  { email, pin }        -> { ok, access_token, refresh_token } | { error: wrong|locked|slow }
//   status (Bearer access token)  -> { has_pin, locked, needs_current }
//   set    { pin, current? } (Bearer access token) -> { ok } | { error }
//
// PIN checks, bcrypt hashing and lockouts happen in Postgres (see
// supabase/migrations/20261128174158_pin_signin.sql). This function only
// relays, and mints a session after a correct PIN.
import { createClient } from 'npm:@supabase/supabase-js@2'

const URL_ = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const ALLOWED = [
  /^https:\/\/first-bell-seven\.vercel\.app$/,
  /^https:\/\/first-bell-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
]

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED.some((re) => re.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'https://first-bell-seven.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  const xff = (req.headers.get('x-forwarded-for') || '').split(',')[0]
  return String(cf || xff || 'unknown').trim().slice(0, 64) || 'unknown'
}

function claims(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split('.')[1]
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))
    return JSON.parse(json)
  } catch {
    return {}
  }
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { error: 'method' })
  if (!URL_ || !SERVICE || !ANON) return reply(503, { error: 'server' })

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const action = String(body.action || '')
  const admin = createClient(URL_, SERVICE, noSession)

  if (action === 'login') {
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254)
    const pin = String(body.pin || '').replace(/\D/g, '').slice(0, 8)
    const checked = await admin.rpc('pin_login_check', { p_email: email, p_pin: pin, p_ip: clientIp(req) })
    if (checked.error) return reply(503, { error: 'server' })
    const result = checked.data?.result
    if (result === 'locked') return reply(423, { error: 'locked' })
    if (result === 'slow') return reply(429, { error: 'slow' })
    if (result !== 'ok' || !checked.data?.user_id) return reply(401, { error: 'wrong' })

    // Mint a session without sending any email: make a one-time magic-link
    // token, then redeem it right here. A separate anon client redeems it so the
    // admin client keeps its service-role headers.
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: checked.data.email })
    const props = link.data?.properties
    const tokenHash = props?.hashed_token
    const type = props?.verification_type === 'email' ? 'email' : 'magiclink'
    if (link.error || !tokenHash || link.data?.user?.id !== checked.data.user_id) return reply(503, { error: 'server' })
    const anon = createClient(URL_, ANON, noSession)
    const verified = await anon.auth.verifyOtp({ token_hash: tokenHash, type })
    const session = verified.data?.session
    if (verified.error || !session?.access_token || !session?.refresh_token) return reply(503, { error: 'server' })
    const sessionId = String(claims(session.access_token).session_id || '')
    if (sessionId) {
      await admin.rpc('pin_record_session', { p_user: checked.data.user_id, p_session: sessionId })
    }
    return reply(200, { ok: true, access_token: session.access_token, refresh_token: session.refresh_token })
  }

  if (action === 'status' || action === 'set') {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return reply(401, { error: 'signin' })
    const got = await admin.auth.getUser(jwt)
    const user = got.data?.user
    if (got.error || !user?.id || !user.email_confirmed_at) return reply(401, { error: 'signin' })
    const sid = String(claims(jwt).session_id || '') || null

    if (action === 'status') {
      const s = await admin.rpc('pin_status', { p_user: user.id, p_session: sid })
      if (s.error) return reply(503, { error: 'server' })
      return reply(200, { has_pin: !!s.data?.has_pin, locked: !!s.data?.locked, needs_current: !!s.data?.needs_current })
    }

    const pin = String(body.pin || '').trim()
    const current = body.current == null ? null : String(body.current).trim()
    const s = await admin.rpc('pin_set', { p_user: user.id, p_session: sid, p_pin: pin, p_current: current })
    if (s.error) return reply(503, { error: 'server' })
    if (!s.data?.ok) return reply(400, { error: s.data?.error || 'format' })
    return reply(200, { ok: true })
  }

  return reply(400, { error: 'action' })
})
