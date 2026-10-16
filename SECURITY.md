# Family vault threat model

The vault keeps Social Security cards, passports, birth certificates, IDs, and insurance cards for the Johnson household. Confidentiality is the point. This note is what the design actually protects, and what it does not.

## What we are protecting

Document images and the fields taken from them: name, document type, number, date of birth, issue date, expiry, and issuer. Those are sealed in the browser before they are saved.

## What the server is allowed to see

Supabase stores ciphertext, a random record id, the household id, a salt, KDF parameters, a wrapped key, timestamps, and an audit row. The audit row is who did what to which record id, and when. It does not include the document number, the name on the document, or the image.

The storage bucket `vault` is private. Row policies allow the household owner and at most one other parent. There is no public URL, no share link, and the app never asks Supabase for a signed URL.

A lost passphrase cannot be reset. The setup screen prints a recovery kit so the passphrase can be written on paper. That passphrase is not saved.

## How a record is sealed

1. A random 256-bit data key is created on the device.
2. The passphrase is stretched with Argon2id (19 MiB, 2 iterations, parallelism 1). If Argon2id cannot run, the same step uses PBKDF2-HMAC-SHA256 with 600,000 iterations.
3. The data key is wrapped with AES-256-GCM. Only the wrapped key is stored.
4. Each record and each file gets its own AES-256-GCM nonce and ciphertext.
5. The unwrapped key stays in memory. It is wiped when the vault locks.

A passkey can wrap that same data key with the WebAuthn PRF extension, when the device supports it. The passkey does not create a second copy of the documents.

OCR and passport MRZ parsing run in the page, against files under `/ocr`. The OCR module refuses an `http` address. Nothing in the vault code calls an external OCR or language API.

## Who can open it

The household owner, and one additional parent listed in `vault_parents`. Demo mode is the parent host only. A member who is not a vault parent does not get the vault screen. There is no kid account path and no link that opens a document for someone else.

The vault has its own unlock, separate from household sign-in. It locks when the tab is hidden and after five minutes without a keypress or tap.

Numbers are masked. A Social Security number shows as `***-**-1234` until someone presses and holds, then it masks itself again.

Expiry reminders can appear in Next up only while the vault is unlocked, and only as “Passport renewal · Claire”. The document number is not copied into that reminder, and the reminder is not written to the calendar table.

## Limits

- A person who knows the passphrase, or who uses an unlocked device, can read the documents. The vault does not protect against that.
- Anything that can run script in the page, including a successful cross-site scripting bug, can read the key while the vault is unlocked. The content security policy forbids third-party scripts. Google Fonts are still loaded for the rest of the app. Those requests do not include vault fields. A compromised font host is still a supply-chain risk.
- The browser cannot promise that wiped bytes are gone from every copy the engine made. Locking drops the key from the app. It is not a forensic wipe.
- Ciphertext length, record counts, and audit times are visible to whoever can read the database, including a Supabase project admin.
- The recovery kit is paper. If that paper and a copy of the ciphertext are both taken, the documents can be opened.
- On-device OCR can misread a card. A parent has to confirm the fields before they are sealed. A bad read is a data-quality problem, not a reason to send the image anywhere.
- Demo mode keeps ciphertext in this browser’s local storage. That is still ciphertext, and it is not a backup. Live mode uses the private bucket after `supabase/migrations/20261016050000_family_vault.sql` is applied by hand. The app does not apply that migration itself.
- This design does not hide the fact that a vault exists.

## Tests

`npm test` seals a record with a known number and file, then asserts that every mocked Supabase write and the local sealed blob omit that plaintext. The same run checks masking, MRZ parsing, the renewal wording, the lock timer, parent access, and that the vault source does not reference signed URLs, share sheets, IndexedDB, or a remote OCR host.
