# First Bell — ship

America/Chicago. v1 household desk for Andrew Johnson Sr / ThreatRadar.

## Run locally

```bash
cd /workspace/first-bell-app
npm install
npm run dev          # http://localhost:5173
```

Production build:

```bash
npm run build        # writes dist/
npm run preview      # http://localhost:4173
```

Demo path: **Enter Johnson household** → Home shows Chloe’s party → Parties detail → Inbox folders → Calendar (October 2026).

Guest path (no demo login): `/r/princess-chloe-5`

## Publish to grok.me

This environment cannot push a grok.me subdomain from the CLI. Publish from **Grok Build** on grok.com:

1. Open the First Bell Build chat (this project).
2. Use **Publish app**.
3. Subdomain suggestion: `first-bell` → `https://first-bell.grok.me`
4. Access: **Anyone with the link** (needed for guest RSVP).
5. Confirm cover uses the gold bell (`public/brand/bell.jpg`) or regenerate.

If grok.me is not available, ship `dist/` to any static host. SPA fallback **must** rewrite unknown paths to `index.html` so `/r/princess-chloe-5` and `/parties/chloe-5` work.

### Static host (Netlify / Cloudflare / nginx)

`dist/` is the artifact.

Netlify `_redirects` (place in `public/` before build, or in `dist/` after):

```
/*    /index.html   200
```

nginx:

```
try_files $uri $uri/ /index.html;
```

Cloudflare Pages: Settings → Functions → **SPA fallback** (or `_redirects` as above).

## What must be true after publish

- [ ] App loads, demo gate works
- [ ] Nav: Home / Parties / Inbox / Calendar / Settings
- [ ] Chloe party visible on Home + Parties; RSVP board has **Leila · Yes**
- [ ] Registry opens Amazon guest view `L53W1XS578SM`
- [ ] Invite assets show both Mario-movie and Peach castle art
- [ ] Inbox folders + 3 example cards; filing copy present
- [ ] Calendar month/week; Oct 10 party + Oct 13 birthday
- [ ] `/r/princess-chloe-5` is public (no demo login)

## Not in v1 (honest)

- No iCloud / Gmail login. No passwords.
- Inbox and calendar are scaffolds; **Family sync is next**.
- RSVPs persist in the visitor’s browser only (demo). A real backend is required before guest RSVPs from other phones land on Andrew’s board.

## Contacts (seed)

Andrew · 936-355-1281 · asj412@me.com  
Venue: Cypress Academy of Gymnastics, 23200 Kuykendahl Rd, Tomball TX 77375 · SNAP Package A paid.
