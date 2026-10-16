# First Bell Family Vault (phase 2, after vNext PR) - Andrew approved Oct 15 2026 10:59 PM CT

Goal: very secure store for sensitive family docs (SS cards, passports, birth certificates, IDs, insurance cards) with details extracted and stored against each family member.

## Security (non-negotiable)
- Client-side end-to-end encryption: AES-256-GCM per file/record; keys derived from a family vault passphrase (Argon2id / WebCrypto PBKDF2 high iterations fallback) known only to Andrew + Megan. Server (Supabase) stores ciphertext only. Lost passphrase = unrecoverable (show recovery-kit printout at setup).
- Separate vault unlock (passkey/WebAuthn or passphrase) on top of app login; auto-lock after 5 min idle / tab hidden; no plaintext in localStorage/IndexedDB/service-worker cache.
- Private Supabase Storage bucket, RLS limited to the two parent accounts; no public URLs, no share links, no signed links ever.
- Audit log (who viewed/added/deleted what, when) — metadata only.
- Masked display (SSN shows ***-**-1234; tap-and-hold to reveal, auto re-mask).
- No vault data sent to any third-party API or LLM. No logging of contents. CSP hardened.

## Extraction ("store against the person")
- On-device OCR only (e.g. Tesseract.js / MRZ parser for passports) run in-browser BEFORE encryption.
- Fields: name, document type, number, DOB, issue/expiry dates, issuing state/country; parent confirms/edits before save.
- Saved as encrypted structured record linked to family member (Andrew, Megan, Claire, Chloe, Drew).
- Expiry reminders (e.g. passport renewal 9 months before) surface in Next up with no sensitive numbers shown.

## Out of scope
Kids' accounts never see the vault. Not shareable with extended family.
