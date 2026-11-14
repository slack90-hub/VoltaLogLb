# MIC visitor enquiries

`mic/survey.js` posts name, phone, email and interest to the dedicated
`mic-survey` Cloudflare Worker. The page stays open and displays confirmation
only after the email service accepts the message. Delivery failures preserve
the form and show a retry message. There is no automatic visitor email.

The message is addressed to `mic@mdslb.com`. Cloudflare's send-email binding
requires a verified destination, so the SMTP envelope uses the same verified
inbox configured as MIC's Email Routing destination. This address is stored
in the Worker secret `DELIVERY_ADDRESS`, never in the frontend. If the MIC
forwarding destination changes, update that secret too.

Deploy from this directory using Node 22 or newer and Wrangler 4:

```sh
wrangler deploy --dry-run
wrangler deploy
wrangler secret put DELIVERY_ADDRESS
```

Set the secret to MIC's verified forwarding destination. Confirm the routing
rule and destination verification in Cloudflare before changing it. Never
put credentials in source control. Worker source is outside the static-site
build's public allowlist.

The endpoint validates fields and message size, rejects email-header injection,
allows browser requests from the two production hostnames, and uses a honeypot
plus per-IP and overall rate limits. Rate limits are approximate per Cloudflare
location, not a global quota. It does not save enquiries in a database or log
their contents. Provider processing and email retention still apply.

Run `node --test mic-api/handler.test.mjs` from the repository root. Tests mock
email delivery; one separately identified live smoke test is needed after
deployment. Publish `mic/` through the existing GitHub Pages workflow after
the endpoint has been verified.
