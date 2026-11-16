# Mail

Cloudflare Email Routing on `acocloud.app` — receive + forward, no third-party SMTP. Every address
below forwards to **theacoteam2020@gmail.com** (verified destination).

Rebuild / extend at any time with `node scripts/cf-mail-setup.mjs` — it is idempotent and only adds
what is missing.

## acocloud.app — the company

| Address | For |
| --- | --- |
| `hello@acocloud.app` | General enquiries |
| **`head@acocloud.app`** | **Direct line to the person in charge** — complaints, partnerships, anything that should not sit in a support queue |
| `support@acocloud.app` | Help with the account or the domain |
| `billing@acocloud.app` | Invoices and payments |
| `sales@acocloud.app` | Deals, quotes, volume |
| `legal@acocloud.app` | Legal notices, takedowns |
| `privacy@acocloud.app` | Data requests, deletion |
| `security@acocloud.app` | Vulnerability reports |
| `abuse@acocloud.app` | Abuse reports (the contact a domain is expected to publish) |
| `press@acocloud.app` | Media and interviews |
| `jobs@acocloud.app` | Hiring (general) |
| `careers@acocloud.app` | Hiring (roles, internships) |

## afterframe.acocloud.app — the product

The app's own subdomain, so a support thread is obviously about AfterFrame and not the domain.

| Address | For |
| --- | --- |
| `support@afterframe.acocloud.app` | Product support |
| `feedback@afterframe.acocloud.app` | Feature requests, bug reports |
| `billing@afterframe.acocloud.app` | Plans and invoices |
| `noreply@afterframe.acocloud.app` | Outgoing only — no rule, mail to it is not read |

## DNS

Each receiving domain carries its own **3× MX** (`route1-3.mx.cloudflare.net`, priorities 11/21/31)
and **SPF** (`v=spf1 include:_spf.mx.cloudflare.net ~all`). Verified resolving for:

- `acocloud.app` — 3 MX
- `mail.acocloud.app` — 3 MX (test subdomain, `hello@mail.acocloud.app` forwards)
- `afterframe.acocloud.app` — 3 MX

DKIM (`cf2024-1._domainkey`) exists on the apex from Cloudflare's setup.

Catch-all is **disabled** (a `drop` rule that is switched off). Unknown addresses bounce instead of
flooding the inbox; turn it on only if you want one address to catch everything.

## Sending

Email Routing alone is receive-only. Outgoing mail goes through a **Worker with a `send_email`
binding** (`mail-worker/`), so there is no SMTP provider and no third-party deliverability layer.

| | |
| --- | --- |
| Branded endpoint | `https://mailer.acocloud.app/` |
| Fallback endpoint | `https://afterframe-mail.acocloud.workers.dev/` |
| Method | `POST`, JSON body |
| Auth | `Authorization: Bearer <SEND_KEY>` (secret, stored in `.mail-key.local`) |
| From | `AfterFrame <noreply@afterframe.acocloud.app>` (`MAIL_FROM` var) |
| Handler | `mail-worker/src/index.mjs` |
| Config | `mail-worker/wrangler.toml` |
| Route + DNS | `mailer.acocloud.app/*` → `afterframe-mail`, proxied `A 192.0.2.1` placeholder |

Request:

```json
{ "to": "you@example.com", "subject": "Reset your password", "text": "plain body", "html": "<p>optional</p>", "replyTo": "support@afterframe.acocloud.app" }
```

Response: `{"ok":true,"id":"<provider message id>"}` — or `{"error":"..."}` with a 4xx/5xx status.
Errors: `401` bad/missing key, `400` bad body, `429`/`5xx` `send_failed` from the binding.

Notes:

- The key is generated and stored by nothing but you: `.mail-key.local` (git-ignored). Rotate it with
  `wrangler secret put SEND_KEY` or the `/workers/scripts/afterframe-mail/secrets` endpoint.
- `send_email` on the Workers free plan may only deliver to **verified destination addresses** in
  this account. Add production recipients (or upgrade) before real traffic.
- Redeploy with `cd mail-worker; npx wrangler deploy`.

## Adding more

1. New address on an existing domain → add a line to `MAILBOXES` in `scripts/cf-mail-setup.mjs`, run it.
2. New subdomain → add it to `MAIL_DOMAINS` in the same script; it gets MX + SPF automatically.
3. Then send a test message and confirm it lands in the destination inbox.
