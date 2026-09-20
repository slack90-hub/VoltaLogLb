# Private room

A two-account text chat served by its own Cloudflare Worker. The public website has a discreet entrance; it does not host messages, credentials or encryption keys.

## Access

Open the deployed room or click/tap “Murex is a sea shell” in the About MDS section of the English homepage five times (less than 2.5 seconds between taps). Alt+Shift+M also opens it. The five-tap entrance is on the English homepage; the keyboard shortcut works on both homepages.

First-time setup: choose your account (lion for Nad, butterfly for Maria), sign in with the original generated password, and unlock with the shared recovery key. The setup dialog asks for a new passphrase twice. Use at least four different words and 16 characters. Once saved, that account signs in and unlocks history with just its passphrase on any browser. Each account enrolls separately. The header Passphrase button changes it later after a recent sign-in. Credentials are in the **ignored local** `.secrets/access-kit.md`; give Maria only her own password plus the recovery key through a trusted channel. Keep a secure offline copy. This folder may be synchronized by the user's OneDrive; it is not an offline backup by itself.

The plaintext key stays in tab memory and is never sent to the backend. Refreshing/locking requires the passphrase again after enrollment. Choose Use original access kit to recover with the original password plus recovery key; resetting a password alone cannot decrypt history. Lock revokes the session and removes decrypted content. Quick exit/Escape also returns to MDS. Auto-lock: 15 idle minutes, or 5 minutes in the background. Quick exit cannot erase browser history or screenshots. Locking discards unsent drafts and queued ciphertext; keep the tab open until messages show Sent.

## Appearance switch

The Neutral mode switch is above the conversation search field. On removes the interface's romantic copy, hearts, lion/butterfly symbols and personal decoration. Off uses the personal lion-and-butterfly theme. The preference is saved only in this browser (room-appearance in localStorage), applies to the login screen, and syncs across tabs of the same origin. It is not sent to the server or shared with the other person's browser. A blocking same-origin appearance script applies the saved mode before page content appears. Messages and drafts remain exactly as written; this is not a message-redaction feature.

Run node test/appearance-browser.mjs to check both modes, desktop/mobile layout, locking, persistence, and neutral login.

## Email rule

Only a message authenticated as Maria can trigger an alert. There must be at least 24 hours since the last accepted message from **either** account. The first-ever Maria message also triggers one. Opening the room, logging in, typing and reading do not count as messages. A Nad message restarts the activity clock, so Maria's immediate reply never alerts him.

An atomic SQL transaction stores the message and notification job together. The message UUID deduplicates client retries. Alarms process a durable outbox; a five-minute cron is a recovery fallback. No message content or recovery key enters email. The recipient is configured only on the server.

Production uses an email binding restricted to the verified recipient. Cloudflare delivery is **at least once**: normal duplicate sends are prevented, but an ambiguous provider success followed by a crash can cause a rare retry email. A stable Message-ID assists downstream deduplication. Optional Resend support uses its idempotency key. Jobs stop retrying after 23 hours and are shown as failures on the next sign-in; provider acceptance does not prove inbox delivery.

## Encryption boundary

Web Crypto AES-256-GCM encrypts text using a random 256-bit pre-shared room key and a fresh 96-bit nonce per message. Protocol version, account identity and message UUID are authenticated additional data. A key fingerprint detects accidental use of the wrong recovery key. The server stores ciphertext, sender, timestamps and read positions; it cannot decrypt message bodies with its stored data alone.

This is a small pre-shared-key encrypted room, **not the Signal/WhatsApp protocol**, and it has no forward secrecy or independent security audit. Anyone obtaining the room key and ciphertext can decrypt all messages, including old history. A compromised browser or maliciously changed frontend could capture plaintext/keys. Both participants must trust the initial access-kit exchange and the website code. Account passwords are separate randomly generated 256-bit tokens; their salted SHA-256 verifiers are suitable for these high-entropy tokens, not human-chosen passwords. Public registration is absent. Sessions use random opaque tokens, hashed server-side, with an eight-hour maximum lifetime and Secure/HttpOnly/SameSite=Strict cookies. Changing AUTH_CONFIG invalidates all existing sessions.

## Passphrase migration and recovery

The browser runs PBKDF2-HMAC-SHA-256 with a random per-enrollment 256-bit salt and 600,000 iterations. HKDF derives separate authentication and AES-256-GCM key-wrapping keys, with account-specific domain separation. The authentication proof is password-equivalent and travels over HTTPS; the plaintext passphrase and wrapping key never leave the browser. The server stores only a SHA-256 verifier of that derived proof and the encrypted room-key envelope. The envelope authenticates its version, account, original room-key fingerprint and salt. Browser key objects are extractable so Web Crypto can wrap/export them; plaintext key bytes are not persisted.

The work factor follows [OWASP's PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); derivation and wrapping use [Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey). This is not a PAKE: an intercepted authentication proof is a reusable login credential, but does not itself unwrap history. Database theft enables offline guessing of passphrases through stored envelopes/verifiers, so choose unrelated words. The room's existing lack of forward secrecy is unchanged.

Setup requires an authenticated session less than ten minutes old. It stages a per-account candidate, reads back and decrypts the stored envelope in the browser, then confirms it atomically. Unconfirmed/expired candidates never replace active credentials. Confirmation is idempotent and revokes other sessions for that account. Messages, receipts, original room keys, original recovery credentials, and the email activity clock are unchanged. New SQL tables are created alongside existing tables; the Durable Object namespace and room identifier must stay unchanged.

No passphrase is recorded in local access files or logs. After enrollment, those files remain the original recovery kit. Use that kit to sign in, unlock, and set a replacement passphrase if it is forgotten. The CLI rotate-password script rotates only the original recovery password, not the enrolled passphrase. Do not delete the recovery kit after enrollment.

Run node test/passphrase-browser.mjs for real-browser setup/new-browser/recovery checks (same Playwright environment as test/browser.mjs). Node tests cover separate account derivation, cross-account rejection, unchanged messages, session revocation, expired staging and idempotent confirmation.

## Development and checks

Use Node 22 or later:

```powershell
cd private-chat
npm ci
npm run build
npm test
npm run check
npm run provision
npm run dev
```

Provision refuses to overwrite existing keys. It creates `.secrets/access-kit.md`, `.secrets/auth-config.json` and `.dev.vars`. Only the hashed auth config goes into the AUTH_CONFIG Worker secret. Never upload the access kit or room key. Generated assets and build outputs are ignored.

`test/browser.mjs` uses Playwright with Edge. Install Playwright or set PLAYWRIGHT_MODULE to its local module URL, then run `node test/browser.mjs`. It checks separate browser accounts, live messages, Arabic, mobile overflow, recovered history, search, offline resend and locking. All automated tests use temporary credentials and local storage. `test/bridge.mjs` exposes SQL inspection **only in the local test bundle**, never in production.

## Deployment

1. Build, run tests, then `wrangler deploy --dry-run`.
2. Set AUTH_CONFIG from `.secrets/auth-config.json` as a Worker secret. Set ALERT_TO and ALERT_FROM as secrets. Use EMAIL_ENABLED=true only after the destination is verified.
3. Deploy `src/worker.mjs` with the ROOM SQLite Durable Object migration and an EMAIL send binding restricted to the intended destination address. The connected Cloudflare API can deploy the self-contained `dist/worker.mjs` with the same bindings.
4. Enable workers.dev and configure the five-minute cron. Ensure observability remains off for the room.
5. Verify anonymous history returns 401, both accounts can exchange and recover messages, and a Maria-started quiet conversation schedules one email. Verify the email separately; don't infer delivery from a build or API success.
6. Publish only the scoped homepage/entry script and private-chat source changes. `scripts/build-pages.mjs` must never copy private-chat, .secrets, node_modules, or test artifacts into the public site.

## Backups and recovery

History is retained until intentionally removed. Download encrypted backups using the desktop sidebar button. The JSON contains ciphertext and a key fingerprint, never the key. Store it separately from an offline copy of the recovery key. The backup can be decrypted locally with `scripts/read-backup.mjs` (instructions below). Server disaster recovery requires restoring the SQL rows from the backup; there is deliberately no public upload/restore endpoint. Test a restore before relying on the room as the sole archive. Cloudflare SQLite point-in-time recovery is an additional operational tool, not a substitute for an independently saved backup.

To change a lost account password without losing history:

```powershell
node scripts/rotate-password.mjs nad
# Upload the updated .secrets/auth-config.json as AUTH_CONFIG and redeploy if needed.
```

The encryption key and message history stay unchanged. If both people lose every copy of the recovery key, password reset cannot recover history.

To read a saved encrypted backup locally, put only the recovery key in an untracked file, then:

```powershell
node scripts/read-backup.mjs path-to-backup.json path-to-key.txt output.txt
```

This deliberately creates a plaintext output file; keep that output private.
