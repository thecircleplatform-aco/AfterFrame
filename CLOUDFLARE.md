# Cloudflare token — manual setup

Everything the agent needs to work on this domain: point it at Cloudflare, set up mail, deploy.
One token, 90 days, no follow-up scope requests.

## 1. Open the token builder

<https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Create Custom Token**.

Name it `afterframe-agent`.

## 2. Add these permissions

Tick each row in the two dropdowns exactly as written.

### Zone

| Resource | Level | Why |
| --- | --- | --- |
| Zone | Edit | Add / rename / park the domain |
| DNS | Edit | A, CNAME, MX, TXT records |
| Zone Settings | Edit | SSL mode, Always Use HTTPS, dev mode |
| SSL and Certificates | Edit | Universal SSL, custom certs |
| Cache Purge | Purge | Ship a deploy, clear stale assets |
| Email Routing Rules | Edit | Addresses, forwarding rules, catch-all |
| Email Routing Addresses | Edit | Destination inboxes to verify |
| Workers Routes | Edit | Attach a Worker to `*domain/*` |
| Transform Rules | Edit | Redirects / rewrites |
| Page Rules | Edit | Legacy redirects |
| Zone WAF | Edit | Firewall and rate limits |

### Account

| Resource | Level | Why |
| --- | --- | --- |
| Cloudflare Pages | Edit | Deploy the app |
| Workers Scripts | Edit | Workers (mail sending, API routes) |
| Workers KV Storage | Edit | Small state for Workers |
| Workers R2 Storage | Edit | Media / asset bucket |
| D1 | Edit | SQL database |
| Email Routing Addresses | Edit | Account-level mail destinations |
| Account Settings | Read | Confirm the account id |
| Account Analytics | Read | Traffic checks |

### User

| Resource | Level | Why |
| --- | --- | --- |
| API Tokens | Edit | Lets the agent mint / rotate tokens later without asking you |
| User Details | Read | Verify the token |

## 3. Resources + TTL

- **Account resources** → Include → *your account* (or *All accounts*).
- **Zone resources** → Include → *All zones from an account* → your account, so the domain you add
  tomorrow is already covered.
- **Client IP Address Filtering** → leave empty.
- **TTL** → 90 days (or *No expiry* if you'd rather not revisit it).

Create it, then copy the value once — Cloudflare never shows it again.

## 4. Hand it to the repo (not to chat)

```powershell
cd c:\dev\eval\freecut
Set-Content .cf-token.local -Value '<paste the token>' -NoNewline
$env:CLOUDFLARE_API_TOKEN = (Get-Content .cf-token.local -Raw).Trim()
```

`.cf-token.local` is git-ignored.

## 5. Verify

```powershell
Invoke-RestMethod -Uri https://api.cloudflare.com/client/v4/user/tokens/verify `
  -Headers @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" } | ConvertTo-Json -Depth 4
```

`"status": "active"` means the rest of the jobs can run.

## Jobs this token covers

| Ask | Uses |
| --- | --- |
| Point `mydomain.com` at Cloudflare | Zone Edit + DNS Edit |
| Serve AfterFrame on the domain | Pages Edit + DNS Edit + SSL and Certificates |
| Mail at `hello@mydomain.com` | Email Routing Rules + Addresses, Workers Scripts for sending |
| Move media into R2 / state into KV / SQL into D1 | the storage rows above |
| Rotate this token later | API Tokens Edit |

## Notes

- Email Routing is receive/forward plus a Worker *send* binding. A real mailbox or raw SMTP relay
  needs a provider (Resend / Postmark / Mailgun) pointed at the domain — that is their key, not
  Cloudflare's.
- Tokens are fixed at creation. If a job later needs a scope that is not above, the token has to be
  reissued — the table is the wide net so that should not happen.
- `scripts/cf-full-token.mjs` does all of this through the API instead of the dashboard: it needs
  `User → API Tokens → Edit` on whatever token you start from, and writes the new secret to
  `.cf-token.local` without printing it.
