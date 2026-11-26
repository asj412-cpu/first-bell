# Email re-entry

Andrew asked for this: if an email has signed in successfully before (code or magic link), typing that email on the login screen should get straight in, without another code.

There are two ways to do it. A server-only switch, `REENTRY_MODE`, picks one.

| `REENTRY_MODE` | Who skips the code | Risk |
|---|---|---|
| `device` **(default, recommended)** | That email, on a phone or computer where it already finished a code sign-in. A new device still gets a code once. | Someone has to have that device (and its browser) in hand. |
| `email` | That email, on any device. | **Anyone who knows the email gets in.** There is no second factor. |
| `off` | Nobody. Always the code. | None. |

If `REENTRY_MODE` is not set, the app uses `device`.

## What the app does

1. On **Continue**, the browser calls `POST /api/reentry` with the email.
2. The Vercel function (server only) calls `reentry_check` in Postgres with the email, the caller's IP, the hashed device cookie (device mode), and the mode. That one call:
   - counts the try and rate-limits: more than 5 tries for one email, or more than 20 from one IP, in 15 minutes → `429 Too many tries`, the same for known and unknown emails;
   - finds a confirmed, not banned, not deleted user with that email (or one in `verified_emails`);
   - in `device` mode, also needs this browser's device token to belong to that same user, not revoked, not expired.
3. Yes: the function mints a session with the service role key (`auth.admin.generateLink` type `magiclink`, then `verifyOtp` with the hashed token, so no email is sent) and returns it. The browser calls `setSession`.
4. No, for any reason (unknown email, never verified, not this device, database error): `{ "mode": "otp" }`. The screen sends the normal code. So the screen never says whether an email is on the list.
5. After a successful code or link sign-in, the browser calls `POST /api/remember-device` with its new access token. The server checks the token with Supabase, records the verified-at time in `verified_emails`, makes a random 32-byte device token, stores only its SHA-256 hash in `reentry_devices`, and sets the cookie `micasa_device` (`HttpOnly; Secure; SameSite=Strict; Path=/api`, 180 days, renewed on each use). Page JavaScript cannot read it. Up to 10 devices per person; older ones are revoked.
6. **Sign out** calls `DELETE /api/remember-device`: that device's token is revoked and the cookie cleared, so the next sign-in on it needs a code.

## Env vars the owner must set

Vercel → Project `first-bell` → Settings → Environment Variables. Tick **Production** and **Preview**. Then redeploy.

| Name | Value | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → `service_role` secret | **Required.** Server only. Paste it yourself in the Vercel dashboard. Do **not** name it `VITE_…` (Vite would put it in the browser bundle). Mark it Sensitive. |
| `REENTRY_MODE` | `device` or `email` or `off` | Optional. Not a secret. Unset = `device`. |
| `SUPABASE_URL` | `https://tzkxuinbpmoeyhzomvut.supabase.co` | Optional. Falls back to `VITE_SUPABASE_URL`, which is already set. |

Without `SUPABASE_SERVICE_ROLE_KEY`, `/api/reentry` answers `503` naming the missing variable and the screen sends the normal code. Sign-in still works; the shortcut does not.

Also in Supabase → Authentication → Sessions: leave time-box and inactivity timeout off (or very long), so a phone that is already signed in stays signed in.

## SQL

`supabase/migrations/20261126220000_reentry_devices.sql` (additive) adds `reentry_devices` and the service-role-only functions `reentry_check`, `reentry_device_register`, `reentry_device_forget`. It replaces the use of the old `reentry_gate`, which never worked: it fails with "column reference ip is ambiguous", its wrapper cannot reach the `private` schema as `service_role`, and the old function passed a fixed IP. The old function is left in place, unused.

Test: `supabase/tests/reentry_devices_rollback_test.sql` (run after the migration in one transaction; always rolls back).

The service role key never belongs in this repo or in the browser.
