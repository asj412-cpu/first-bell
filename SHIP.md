# First Bell — ship

America/Chicago. Household desk for Andrew Johnson Sr / ThreatRadar.

Live now: https://first-bell-seven.vercel.app  
Repo is a Vite + React SPA at the root. Keep `vercel.json` SPA rewrites so `/r/:slug` and `/parties/chloe-5` work.

## Run locally

```bash
npm install
cp .env.example .env.local
# paste VITE_SUPABASE_ANON_KEY from Supabase → Project Settings → API
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # writes dist/
npm run preview      # http://localhost:4173
```

- **Backend configured:** host gate is email OTP / magic link. Guest path stays public.
- **Env vars missing:** demo gate **Enter Johnson household**. Banner explains RSVPs stay in this browser.

Guest path (no login): `/r/princess-chloe-5`

## Vercel env vars (Andrew)

In Vercel → Project → Settings → Environment Variables, set for **Production** and **Preview**, then **redeploy**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://tzkxuinbpmoeyhzomvut.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` key (JWT) or the publishable `sb_publishable_…` key |

Do **not** put the `service_role` key in Vite or Vercel frontend env. Vite inlines any `VITE_*` value into the browser bundle.

After saving env vars, trigger a new deployment. Existing builds will not pick them up.

## Apply the SQL migration

File: `supabase/migrations/20260902120000_household_parties_rsvps.sql`

Creates `households`, `household_members`, `parties`, `rsvps`, RLS, guest RPC `submit_public_rsvp`, host RPC `ensure_host_membership`, and seeds Chloe’s party (Oct 10 2026 1:00–2:30 CT, Cypress Academy Kuykendahl, Amazon `L53W1XS578SM`, Leila Yes).

**Supabase Dashboard (simplest)**

1. Open project `tzkxuinbpmoeyhzomvut` → SQL Editor.
2. Paste the migration file and run it.
3. Confirm tables under Table Editor.

**CLI (if the project is linked)**

```bash
npx supabase db push --project-ref tzkxuinbpmoeyhzomvut
```

**Auth URLs** (Authentication → URL Configuration)

- Site URL: `https://first-bell-seven.vercel.app`
- Redirect URLs:
  - `https://first-bell-seven.vercel.app/**`
  - `https://*.vercel.app/**`
  - `http://localhost:5173/**`

**Email template** (Authentication → Email Templates → Magic Link) so both a code and a link work:

```html
<h2>First Bell sign-in</h2>
<p>Your code: <strong>{{ .Token }}</strong></p>
<p><a href="{{ .ConfirmationURL }}">Or tap this magic link</a></p>
```

Host emails that auto-join the Johnson household after signup: `asj412@me.com`, `asj412@icloud.com`. To add another host:

```sql
UPDATE public.households
SET host_emails = array_append(host_emails, 'new-host@example.com')
WHERE is_seed = true;
```

If the seeded household still has **zero** members, the first authenticated user claims it (restore-friendly bootstrap).

## Auth test plan

1. With env vars **unset**, open `/enter` → **Enter Johnson household** → Home shows Chloe. Banner says demo.
2. With env vars **set** and migration applied:
   1. `/enter` shows email, not the demo button.
   2. Request a code as `asj412@me.com` or `asj412@icloud.com`.
   3. Enter the 6-digit code **or** tap the magic link.
   4. Land on Home. Settings shows the email and “Supabase · live”.
   5. Sign out returns to `/enter`.
   6. A random email can create an Auth user but will not see RSVPs until it is in `household_members` (gate explains this).
3. Guest `/r/princess-chloe-5` never asks for a password.

## Guest RSVP vs host board (phone test)

1. On a **phone** (or incognito): open `https://first-bell-seven.vercel.app/r/princess-chloe-5`.
2. Submit a kid first name that is not Leila, e.g. **Maya**, parent optional, Yes/Maybe/No.
3. You should see “Got it — Maya is a Yes” and “Saved to the household board” when live.
4. On the **host** device (signed in): Parties → Princess Chloe → RSVP board. Maya appears in that column without refreshing if Realtime is on; otherwise refresh the page.
5. Submit again with the same first name to change Yes → Maybe. The board updates the same row (unique on party + name).
6. Host can move a guest between Yes / No / Maybe / No response on the board; that write goes to `rsvps`.

If the demo banner is showing, that phone-only RSVP will **not** appear on the host’s other devices — env vars or the migration are missing.

## Deploy notes

- `vercel.json` rewrites all paths to `index.html`. Do not remove this; guest links 404 without it.
- This is a static Vite SPA. No server routes required.
- Redeploy after changing `VITE_*` env vars.
- Inbox and calendar stay scaffolded. No meal planning, no venue B2B booking.

### Static host fallback (Netlify / nginx)

Netlify `_redirects` (already in `public/`):

```
/*    /index.html   200
```

nginx: `try_files $uri $uri/ /index.html;`

## What must be true after publish

- [ ] App loads
- [ ] Nav: Home / Parties / Inbox / Calendar / Settings
- [ ] Chloe party visible on Home + Parties; RSVP board has **Leila · Yes** (from DB when live)
- [ ] Registry opens Amazon guest view `L53W1XS578SM`
- [ ] Invite assets show both Mario-movie and Peach castle art
- [ ] Inbox folders + 3 example cards; filing copy present
- [ ] Calendar month/week; Oct 10 party + Oct 13 birthday
- [ ] `/r/princess-chloe-5` is public (no host login)
- [ ] With env + migration: guest RSVP from another device appears on the host board
- [ ] With env missing: demo gate + banner; RSVPs local only

## Not in this slice (honest)

- Inbox and calendar are scaffolds; **Family sync is next**.
- No iCloud / Gmail passwords.
- No meal planning. No venue B2B booking.

## Contacts (seed)

Andrew · 936-355-1281 · asj412@me.com  
Venue: Cypress Academy of Gymnastics, 23200 Kuykendahl Rd, Tomball TX 77375 · SNAP Package A paid.
