# First Bell

Household ops for parents. **Party planning is the wedge, not the whole product.**

This is the Johnson household desk (Andrew Johnson Sr / ThreatRadar). It is **not** Teach4 Texas, **not** Gridiron, **not** trading.

Live: [https://first-bell-seven.vercel.app](https://first-bell-seven.vercel.app)

## What this ships

1. **App shell** — Home / Parties / Inbox / Calendar / Settings (mobile bottom nav + desktop rail)
2. **Home** — upcoming party, open RSVPs, inbox attention count, next calendar item
3. **Parties** — Chloe’s 5th (seeded), RSVP board Yes/No/Maybe/No response (Leila preloaded Yes), Amazon registry, invite assets
4. **Inbox** — folders Inbox / Bills / Shopping / School / Trash · example cards · copy that the COO/agent files
5. **Calendar** — month + week shell, Chloe party + birthday seeded, Family sync next
6. **Auth** — Supabase email OTP / magic link for hosts when env vars are set; **Enter Johnson household** demo only if env vars are missing
7. **Public guest RSVP** — `/r/princess-chloe-5` (no login). With Supabase configured, submissions land on the host board across devices
8. **SHIP.md** — env, migrations, auth test plan, deploy

## Seed — Princess Chloe is turning 5!

| | |
|---|---|
| Party | Saturday, October 10, 2026 · 1:00–2:30pm CT |
| Birthday | Tuesday, October 13, 2026 |
| Venue | Cypress Academy of Gymnastics · Kuykendahl · 23200 Kuykendahl Rd, Tomball, TX 77375 |
| Package | SNAP Package A (paid) |
| Theme | Mario-movie style · headline *Princess Chloe is turning 5!* |
| Host | Andrew · 936-355-1281 · asj412@me.com |
| Registry | [Amazon guest view](https://www.amazon.com/registries/gl/guest-view/L53W1XS578SM) |
| RSVP Yes | Leila (parent: Leila's Mom) |

## Run

```bash
npm install
cp .env.example .env.local   # add VITE_SUPABASE_ANON_KEY for live RSVPs
npm run dev
```

Open http://localhost:5173

- Host: email sign-in (when env is set) or **Enter Johnson household** (demo fallback)
- Guest RSVP (no login): http://localhost:5173/r/princess-chloe-5

Production preview:

```bash
npm run build
npm run preview
```

Without `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, RSVPs still persist in `localStorage` key `first-bell.v1` and a demo banner is shown. Settings → Reset seed restores Chloe / Leila / inbox cards in demo mode.

## Backend (v2)

Supabase project `tzkxuinbpmoeyhzomvut` (us-west-2). Client: `@supabase/supabase-js`.

| Vite / Vercel env | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | `https://tzkxuinbpmoeyhzomvut.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Legacy anon JWT **or** publishable `sb_publishable_…` key from Project Settings → API |

Never commit real keys. Apply SQL in `supabase/migrations/` before testing live RSVPs — see **SHIP.md**.

## Stack

Vite · React 18 · React Router 6 · Supabase (Auth + Postgres + RLS). Family calendar sync is next (shared calendar or one `.ics` — never an Apple/Google password).
