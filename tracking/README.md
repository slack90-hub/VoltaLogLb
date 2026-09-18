# Murex activity tracking

Deployed service: https://murex-tracking.slack-90.workers.dev/

The website reports to /events. Dashboard credentials are in local ignored dashboard-access.txt. D1 database ID: b01d5bf0-cb1b-478d-8590-330d85758260. Account ID: f3073764cb377f9c39bcab97b9e7bab9. Deployed using the authenticated Cloudflare MCP.

GitHub Pages remains the frontend. A separate Cloudflare Worker stores events in D1. The root dashboard and /stats JSON are protected with HTTP Basic authentication: username admin, password from the ADMIN_PASSWORD Worker secret. Never put that password in frontend code or Git.

Each new unlock gets a random ID. key_success records a correct sequence. gallery_open records a loaded photo in a visible document after the reveal animation and two animation frames. Photo navigation does not count again. Retries are deduplicated; events may arrive in either order. Browser-tab storage retries delivery; localhost previews do not report events. Times are server receipt timestamps in UTC, so offline events can arrive later.

Counts are browser-reported events, not unique people or proof of viewing. Blocking, offline tab closure and disabled JavaScript may lose events. A determined client can forge events; origin checks are not authentication. The application stores no IP address or persistent visitor ID. Provider logs are separate. Past untracked visits cannot be recovered.

## Deploy once Cloudflare is connected

Use a supported Node runtime and Wrangler 4. In this directory:

1. Install Wrangler: npm install --no-save wrangler@latest
2. If using CLI rather than the connected plugin: npx wrangler login, then npx wrangler whoami.
3. Create or reuse D1 database murex-tracking: npx wrangler d1 create murex-tracking.
4. Copy wrangler.example.json to wrangler.jsonc and replace the database ID placeholder with the returned ID. Choose account_id explicitly if multiple accounts exist.
5. Apply schema: npx wrangler d1 migrations apply DB --remote
6. Validate and deploy: npx wrangler deploy --dry-run, then npx wrangler deploy
7. Set a strong separate admin password: npx wrangler secret put ADMIN_PASSWORD
8. Verify /stats returns 401 anonymously, and the database totals when authenticated.
9. Set the exact deployed HTTPS Worker /events URL in ../murex/tracking-config.js, then publish the scoped GitHub Pages update.
10. Verify one unlock adds one to each counter, slide navigation adds nothing, and reopening increments again. Report verification events separately in initial totals.

Do not claim tracking is live before both deployments are verified.
