# Mi Casa — ship

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

- **Backend configured:** host gate asks for an email, then a code or the link in that email. Guest path stays public.
- **Env vars missing:** demo gate **Enter Johnson household**. Banner explains RSVPs stay in this browser.

Guest path (no login): `/r/princess-chloe-5`

## Vercel env vars (Andrew)

In Vercel → Project → Settings → Environment Variables, set for **Production** and **Preview**, then **redeploy**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://tzkxuinbpmoeyhzomvut.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` key (JWT) or the publishable `sb_publishable_…` key |
| `SUPABASE_URL` | Same project URL. Server only. Optional if `VITE_SUPABASE_URL` is set; `/api/reentry` falls back to that. |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` **secret**. Server only. **Not set yet.** Required for email re-entry. Never use a `VITE_` name. |

Do **not** put the `service_role` key in Vite, in any `VITE_` variable, or in the repo. Vite inlines any `VITE_*` value into the browser bundle. See `docs/EMAIL-REENTRY.md`. Until `SUPABASE_SERVICE_ROLE_KEY` is set, Continue still emails a code.

After saving env vars, trigger a new deployment. Existing builds will not pick them up.

## Apply the SQL migration

Files, in order:

- `supabase/migrations/20260902120000_household_parties_rsvps.sql`
- `supabase/migrations/20260902133000_tighten_rsvp_grants.sql`
- `supabase/migrations/20261016040000_vnext_calendar_gifts_meals.sql` (additive: calendar import, gift lists, meal plans, household profiles — not applied by the app)
- `supabase/migrations/20261110120000_learning_progress.sql` (additive parent checkmarks for At-home learning — **not applied**; do not run it until Andrew says yes. Until then, Learning checks stay in this browser.)
- `supabase/migrations/20261115190000_family_invites_and_reentry.sql` (family invite links, verified-email re-entry, chores, event bring-list — **not applied**; do not run it until Andrew says yes.)

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

**Email templates** — the hosted project does not read `supabase/templates/`. `supabase/config.toml` is not a full auth config. Do not run `supabase config push`. There is no Supabase access token in this repo, so the Management API cannot update the hosted templates from here.

Paste the templates **after this app version is deployed**. Pasting earlier sends the link to `/auth/confirm`, which older builds do not verify. The app calls `signInWithOtp` with `emailRedirectTo` set to `{origin}/auth/confirm?next=...`. Supabase sends **Confirm signup** the first time an address is used, and **Magic Link** after that. Update both. Leave Email OTP length at 6 (Authentication → Providers → Email).

The link must not be `{{ .ConfirmationURL }}`. That URL is the PKCE redirect: it only finishes in the browser that asked for the email. Use `{{ .TokenHash }}` instead. The screen calls `supabase.auth.verifyOtp({ token_hash, type: 'email' })`, which does not read a stored code verifier. The 6-digit code uses `verifyOtp({ email, token, type: 'email' })`.

Dashboard: project `tzkxuinbpmoeyhzomvut` → Authentication → Emails → Templates. Subject for both: `{{ .Token }} is your Mi Casa sign-in code`. Paste the full HTML from `supabase/templates/magic_link.html` and `supabase/templates/confirmation.html`. The link in both files is:

```html
<a href="{{ if .RedirectTo }}{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email{{ else }}{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email{{ end }}">Sign in</a>
```

`{{ .RedirectTo }}` is the app URL, and it already contains `?next=`. The fallback uses the Site URL when RedirectTo is empty. Site URL should be `https://first-bell-seven.vercel.app` with no trailing slash.

**Redirect allow list** (Authentication → URL Configuration). Any path on the Site URL host is already allowed, including `/auth/confirm`. Keep these entries so preview and local sign-in can use the same route:

- `https://first-bell-seven.vercel.app/**`
- `https://*.vercel.app/**`
- `http://localhost:5173/**`

`vercel.json` already rewrites every non-API path to `index.html`, so `/auth/confirm` loads the app.

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
   3. After the dashboard templates above are saved, the email shows a 6-digit code and a link. Open the link in a different browser than the one that asked for it: it should sign in. Or type the code on the sign-in screen (`I have a code`). On an iPhone home-screen app, type the code — the link opens Safari. A link that fails shows “Send a new link”, not a PKCE error.
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
- [ ] Calendar shows upcoming days; finished party and birthdays are on History. Birthdays are computed from Settings.
- [ ] `/r/princess-chloe-5` is public (no host login)
- [ ] With env + migration: guest RSVP from another device appears on the host board
- [ ] With env missing: demo gate + banner; RSVPs local only

## Not in this slice (honest)

- Family calendar rows come from the COO via `docs/CALENDAR-SYNC.md`. The app does not store an iCloud password.
- Meal plans, gift lists, and History ship in the vNext migration. Apply that SQL before they sync across devices. Demo mode keeps them in this browser.
- No venue B2B booking.

## Contacts (seed)

Andrew · 936-355-1281 · asj412@me.com  
Venue: Cypress Academy of Gymnastics, 23200 Kuykendahl Rd, Tomball TX 77375 · SNAP Package A paid.
