# Private room

A two-account text chat served by its own Cloudflare Worker. The public website has a discreet entrance; it does not host messages, credentials or encryption keys.

## Access

Open the deployed room or click/tap the copyright line at the bottom of the MDS homepage five times (less than 2.5 seconds between taps). Alt+Shift+M also opens it. The entrance works on the English and Arabic homepages.

Sign in as Nad or Maria with the generated account password, then enter the shared conversation recovery key. Each browser needs both. Credentials are in the **ignored local** `.secrets/access-kit.md`; give Maria only her own password plus the recovery key through a trusted channel. Keep a secure offline copy. This folder may be synchronized by the user's OneDrive; it is not an offline backup by itself.

The key stays in tab memory and is never sent to the backend. Refreshing/locking requires the key again. Lock revokes the session and removes decrypted content. Quick exit/Escape also returns to MDS. Auto-lock: 15 idle minutes, or 5 minutes in the background. Quick exit cannot erase browser history or screenshots. Locking discards unsent drafts and queued ciphertext; keep the tab open until messages show Sent.

## Email rule

Only a message authenticated as Maria can trigger an alert. There must be at least 24 hours since the last accepted message from **either** account. The first-ever Maria message also triggers one. Opening the room, logging in, typing and reading do not count as messages. A Nad message restarts the activity clock, so Maria's immediate reply never alerts him.

An atomic SQL transaction stores the message and notification job together. The message UUID deduplicates client retries. Alarms process a durable outbox; a five-minute cron is a recovery fallback. No message content or recovery key enters email. The recipient is configured only on the server.

Production uses an email binding restricted to the verified recipient. Cloudflare delivery is **at least once**: normal duplicate sends are prevented, but an ambiguous provider success followed by a crash can cause a rare retry email. A stable Message-ID assists downstream deduplication. Optional Resend support uses its idempotency key. Jobs stop retrying after 23 hours and are shown as failures on the next sign-in; provider acceptance does not prove inbox delivery.

## Encryption boundary

Web Crypto AES-256-GCM encrypts text using a random 256-bit pre-shared room key and a fresh 96-bit nonce per message. Protocol version, account identity and message UUID are authenticated additional data. A key fingerprint detects accidental use of the wrong recovery key. The server stores ciphertext, sender, timestamps and read positions; it cannot decrypt message bodies with its stored data alone.

This is a small pre-shared-key encrypted room, **not the Signal/WhatsApp protocol**, and it has no forward secrecy or independent security audit. Anyone obtaining the room key and ciphertext can decrypt all messages, including old history. A compromised browser or maliciously changed frontend could capture plaintext/keys. Both participants must trust the initial access-kit exchange and the website code. Account passwords are separate randomly generated 256-bit tokens; their salted SHA-256 verifiers are suitable for these high-entropy tokens, not human-chosen passwords. Public registration is absent. Sessions use random opaque tokens, hashed server-side, with an eight-hour maximum lifetime and Secure/HttpOnly/SameSite=Strict cookies. Changing AUTH_CONFIG invalidates all existing sessions.

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
