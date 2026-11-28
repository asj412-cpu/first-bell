# Email + PIN sign-in

Andrew's ask (Nov 28 2026): let people set a 4-digit PIN so they sign in with
email + PIN instead of digging out an emailed code every time.

## How it works for people

1. First time: email → emailed code (unchanged). Once signed in, a sheet asks
   them to pick a 4-digit PIN ("Not now" hides it on that device for 3 days).
2. After that: sign-in screen → email + PIN → **Sign in**. No email.
3. Leave the PIN blank → **Email me a code** (the old flow, always available).
4. **Forgot PIN?** emails a code; after that sign-in the app asks for a new PIN
   (no old PIN needed, because the code proved the email).
5. Settings → **Sign-in PIN** sets or changes it. From a session opened with a
   PIN, changing it needs the current PIN.

## Security

- All checks run server-side in the Supabase Edge Function `pin-auth`
  (`supabase/functions/pin-auth/index.ts`, `verify_jwt = false` because login
  has no session yet; `status`/`set` verify the caller's access token with
  `auth.getUser`). The service role comes from the Supabase runtime. It is not
  in Vercel, the browser bundle, or this repo. This is why PIN sign-in does not
  wait on `SUPABASE_SERVICE_ROLE_KEY` in Vercel the way `/api/reentry` does.
- PINs are hashed in Postgres with bcrypt (`crypt(pin, gen_salt('bf', 10))`),
  a fresh random salt per hash. Plaintext is never stored or returned.
- 5 wrong PINs in a row lock PIN sign-in for that person until they sign in
  with the emailed code (that clears the lock) — the app sends the code
  automatically when it sees "locked". Unknown emails and emails without a PIN
  give the same "wrong"/"locked" answers, so the screen never reveals who has a
  PIN. One IP gets at most 20 misses per 15 minutes across all emails.
- Too easy PINs are refused: 0000…9999 repeats, 1234, 4321.
- A correct PIN mints a normal Supabase session server-side
  (`admin.generateLink` magiclink → `verifyOtp` with the hashed token; no email
  is sent) and records the session id in `pin_sessions`.

## Kill switch

Vercel env `VITE_PIN_SIGNIN=off` (then redeploy) hides every PIN part and the
sign-in screen goes back to code-only. Unset = on.

## SQL

`supabase/migrations/20261128174158_pin_signin.sql` (additive): tables
`user_pins`, `pin_attempts`, `pin_sessions` (RLS forced, no grants to anon or
authenticated) and service-role-only functions `pin_login_check`,
`pin_record_session`, `pin_status`, `pin_set`.

Test: `supabase/tests/pin_signin_rollback_test.sql` (run after the migration in
one transaction; always rolls back).

## Deploying the function

`supabase functions deploy pin-auth --no-verify-jwt` (or the Supabase MCP
`deploy_edge_function` with `verify_jwt: false`).
