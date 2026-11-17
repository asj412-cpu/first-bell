# Email re-entry

Andrew asked for this on purpose. After an email has completed the normal Mi Casa sign-in once (the code or the magic link), that same email can open the house later **without another code**. Anyone who knows the address can get a session. There is no second factor.

That is the tradeoff. Rate limiting slows guessing. It does not make the shortcut safe against someone who already knows a family email.

## What the app does

1. The browser keeps the Supabase session in `localStorage` (`micasa-auth`) and refreshes it. A phone that already signed in usually stays signed in.
2. On **Continue**, the app asks `POST /api/reentry` with the email.
3. The Vercel function checks that the address has already been verified (`auth.users.email_confirmed_at`, or `verified_emails.verified_at` after the new SQL is applied). It does **not** create a user and it does **not** send email.
4. For a verified address it mints a session on the server (`auth.admin.generateLink` type `magiclink`, then `verifyOtp` with the hashed token) and returns the session tokens. The browser calls `setSession`.
5. An unknown address, or one that has never finished verification, gets `{ "mode": "otp" }`. The screen then sends the normal code and link. The link goes to `/auth/confirm` and is verified with `token_hash`, so it does not need the browser that requested it. That only happens after the dashboard templates in `SHIP.md` are pasted. The hosted project does not read the template files in this repo.
6. Basic limits: 5 tries per email and 20 per IP each 15 minutes, in the function’s memory. After the migration, `reentry_gate` also counts in Postgres so the limit holds across function instances.

`mark_email_verified()` runs after a successful code. It can only record the email in the signed-in token, not an address the browser types in.

## Env vars the owner must set

Vercel → Project `first-bell` → Settings → Environment Variables, for **Production** and **Preview**. Then redeploy.

| Name | Where | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase → Project Settings → API → `service_role` secret. **Required for re-entry.** Missing today. Do **not** name it `VITE_SUPABASE_SERVICE_ROLE_KEY`. Vite would ship it in the browser bundle. |
| `SUPABASE_URL` | Server only | `https://tzkxuinbpmoeyhzomvut.supabase.co`. If this is unset, the function uses `VITE_SUPABASE_URL`, which is already set. |

If `SUPABASE_SERVICE_ROLE_KEY` is missing, `/api/reentry` responds `503` with `"missing": ["SUPABASE_SERVICE_ROLE_KEY"]` and the screen falls back to the normal email code. Sign-in still works. The shortcut does not.

Also in the Supabase dashboard → Authentication → Sessions: turn off a short time-box and a short inactivity timeout (or set them very long) so a refresh token is not thrown away while the app is closed. The app cannot change those project settings from code.

## SQL

`supabase/migrations/20261115190000_family_invites_and_reentry.sql` adds `verified_emails`, `reentry_attempts`, and `reentry_gate`. Do not apply it until this pull request is approved. The function can still recognize people who already verified, via `email_confirmed_at`, before that SQL is applied. The explicit `verified_at` flag and the shared rate-limit counter start after it is applied.

The service role key never belongs in this repo.
