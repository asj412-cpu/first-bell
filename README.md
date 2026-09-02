# First Bell

Household ops for parents. **Party planning is the wedge, not the whole product.**

This is the Johnson household desk (Andrew Johnson Sr / ThreatRadar). It is **not** Teach4 Texas, **not** Gridiron, **not** trading.

## What v1 ships

1. **App shell** — Home / Parties / Inbox / Calendar / Settings (mobile bottom nav + desktop rail)
2. **Home** — upcoming party, open RSVPs, inbox attention count, next calendar item
3. **Parties** — Chloe’s 5th (seeded), RSVP board Yes/No/Maybe/No response (Leila preloaded Yes), Amazon registry, invite assets
4. **Inbox** — folders Inbox / Bills / Shopping / School / Trash · example cards · copy that the COO/agent files
5. **Calendar** — month + week shell, Chloe party + birthday seeded, Family sync next
6. **Auth** — demo mode (no password, local only)
7. **Public guest RSVP** — `/r/princess-chloe-5`
8. **SHIP.md** — run and publish steps

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
cd first-bell-app
npm install
npm run dev
```

Open http://localhost:5173

- Enter **Johnson household** (demo)
- Guest RSVP (no login): http://localhost:5173/r/princess-chloe-5

Production preview:

```bash
npm run build
npm run preview
```

Data lives in `localStorage` key `first-bell.v1`. Settings → Reset seed restores Chloe / Leila / inbox cards.

## Stack

Vite · React 18 · React Router 6. No backend in v1. Family calendar sync is next (shared calendar or one `.ics` — never an Apple/Google password).
