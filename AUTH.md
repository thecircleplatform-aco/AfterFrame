# Accounts (AfterFrame auth)

Login, signup and password recovery, running entirely on Cloudflare — no third-party
identity provider, no SMTP provider.

| Piece | Where |
| --- | --- |
| Pages | `/login`, `/signup`, `/forgot-password`, `/reset-password?token=…` |
| UI | `src/features/auth/components/auth-shell.tsx` (galaxy backdrop, glass card, ACO footer) |
| Gate | `src/app/auth-gate.tsx` + `src/features/auth/components/auth-gate-screen.tsx` |
| Device | `src/features/auth/device-identity.ts` |
| Client | `src/features/auth/auth-api.ts` |
| API | `auth-worker/` → `https://auth.acocloud.app` |
| Data | Cloudflare D1 `afterframe-auth` (`2208907d-226b-4511-ab56-28800f21d85c`) |
| Mail | the existing `afterframe-mail` worker (`SEND_KEY`) |

## Theme

Black and white only: a star field over black, a faint milky-way band crossing the sky at
two angles, a card, white CTA with black type. `prefers-reduced-motion` stops all of the
backdrop motion. The "powered by ACO" lockup (`/brand/aco-mark.png`, a white alpha mask)
sits under every form.

**There is no white nebula fog.** A blurred white cloud at half opacity greys the whole
screen, and a grey screen swallows the stars it is supposed to sit behind — it reads as
fog, not as space. The sky is black; the only light in it is the galactic band and four
star layers (dust, small, bright, twinkling), tiled at 44/96/132/210px so the density holds
up even in a narrow side-panel viewport.

`AuthShell` takes two independent props:

| Prop | Values | Meaning |
| --- | --- | --- |
| `backdrop` | `galaxy` (default) · `none` | star field on or off |
| `frame` | `glass` (default) · `solid` | card fill |

`frame="solid"` is the sign-in GATE: a black/35 scrim with a white 1px hairline and
`authInputClassSolid` fields (white hairline on black). The scrim is deliberately
translucent so stars still read behind the form, while the fields themselves are opaque
black — a form must stay legible against a sky. The standalone `/login`, `/signup`,
`/forgot-password` and `/reset-password` pages keep the glass frame.

## Endpoints

```http
POST /auth/signup          { email, password, name?, device? } -> 201 { user } + session cookie
POST /auth/login           { email, password, device? }        -> 200 { user } + session cookie
POST /auth/logout                                        -> 200 { ok }
GET  /auth/me                                            -> 200 { user } | 401
POST /auth/device          { device, claim? }            -> 200 { known, createdAccount, hint }
POST /auth/forgot-password { email }                     -> 200 { ok } always
POST /auth/reset-password  { token, password }           -> 200 { ok }
GET  /health                                             -> 200 { ok }
```

**`/auth/*` is served same-origin.** `functions/auth/[[path]].js` proxies every
route except `/auth/device` to `auth.acocloud.app`, and rewrites the session
cookie from `SameSite=None` (cross-site) to `SameSite=Lax` with no `Domain`
(first-party). The browser therefore never makes a credentialed cross-site
request, and the cookie belongs to `afterframe.acocloud.app`.

That is not a preference. Chrome refused every `credentials: 'include'` fetch to
`auth.acocloud.app` with `net::ERR_FAILED` and a misleading *"No
'Access-Control-Allow-Origin' header"* message, while the identical request from
Node — same Origin, same cookie, same `sec-fetch-*` headers — returned `200` with
a correct `ACAO`. Nothing in the worker was wrong; the cross-site cookie was.
`/auth/me` failing that way made the gate **fail open on every load**.

Two rules for the proxy: it must forward the inbound `cookie` header (dropping it
makes a good session answer `401`, which is how this was first shipped broken),
and it must never cache — a cached session response would be handed to the next
visitor.

**`/auth/device` is NOT on the auth worker.** It is a Pages Function on the
app's own origin (`functions/auth/device.js`, deployed with `dist`), bound to the
same `afterframe-auth` D1 database. Three reasons it lives there:

- the request is **same-origin** — no CORS, no `SameSite=None` cookie mode, and
  nothing to get wrong behind the site's `Cross-Origin-Embedder-Policy`;
- the Pages project can reach D1 with the permissions it already has, so a
  device hint does not depend on a second worker being redeployed in step;
- it is a HINT, not an auth surface: it never mints, checks or extends a session.

The account operations stay on the worker, so the Function is **told** the
outcome: after a successful signup/signin the client posts
`{ device, claim: { userId, createdAccount } }`. `created_account` is sticky in
SQL (`max(created_account, …)`), so signing in later cannot demote a device that
created its account here. `GET /auth/device` reports
`{ database, table, schema }` — every failure in this endpoint is silent by
design, and without that probe a missing D1 binding is indistinguishable from a
genuine new device (which is exactly how it failed the first time).

`auth-worker/src/index.mjs` still carries its own `/auth/device`; it is the same
contract over the same table, so either can answer and the schema is shared.

## The device gate (which form opens)

The app opens `/` → `/projects`, and `AuthGate` decides what renders there before
the workspace picker does:

1. `GET /auth/me` — a live session cookie means signed in, the gate is a
   pass-through.
2. `401` → `resolveDeviceHint()` merges the Pages Function's `/auth/device`
   answer with the local record, and the gate opens the matching form.

| Device says | Form |
| --- | --- |
| `createdAccount` | Sign in, address prefilled, “Welcome back” |
| `known` (only ever signed in here) | Sign in, empty address |
| nothing known | Sign up |

A “Known device / New device” badge and a Create-an-account ↔ Sign-in switch keep
every branch escapable — the hint only picks the default.

**What a fingerprint is here.** Two parts, both non-secret:

- `traits` — platform, language, timezone, screen bucketed to 50px, core count,
  touch points, and a UA family with **every version number stripped** (so a
  routine browser update is still the same device). No canvas, no audio, no font
  probing, no plugins.
- `id` — a random UUID in `localStorage` (`afterframe.device.id.v1`). Exact while
  storage survives; the trait hash is what carries the hint after a site-data
  clear.

The worker stores `sha256("traits:" + traits)` as the primary key and
`sha256("id:" + id)` as a secondary index (`auth_devices`), so it can answer
after localStorage is gone and still be exact when it isn’t.

**Why it is safe.** It authenticates nobody: it cannot read a project, mint a
session or reveal a password. `/auth/device` returns a **masked** address
(`s******@studio.com`) only for a device that CREATED the account, and `known`
with no address otherwise — so guessing a fingerprint tells you an account exists,
never which one. Rate limited per IP. `auth_devices` rows cascade away with the
user.

Two deliberate escapes:

- **An unreachable worker fails open.** AfterFrame is local-first; if `/auth/me`
  or `/auth/device` cannot be reached the app renders normally. A blocked
  endpoint must never be a broken editor.
- **“Continue without signing in”** silences the gate for the tab session
  (`sessionStorage`), so an account-free editor is one click away. Nothing in the
gate guards storage.


## Why the URLs are safe

- **Reset links carry a random token, never an email.** 32 CSPRNG bytes, base64url. The
  database only stores its SHA-256, so the link cannot be reconstructed from a dump.
- **Single use, one hour.** `used_at` is set on redemption and expired rows are rejected.
- **Passwords are never stored or logged.** PBKDF2-SHA256, 100 000 iterations (the maximum
  Cloudflare's WebCrypto accepts), 16-byte per-user salt, compared in constant time.
- **Sessions are opaque.** 32-byte token in an `HttpOnly; Secure; SameSite=Lax; Path=/`
  cookie set by the app's own origin (the worker's `SameSite=None` is rewritten by
  the proxy); the server keeps only its hash. Changing a password deletes every session.
- **No enumeration.** Login failures are identical for unknown emails and wrong passwords;
  `forgot-password` always answers `{ ok: true }`.
- **HTTPS only, no wildcard CORS.** `APP_ORIGINS` is an explicit allow-list and credentials
  are only echoed back to those origins.

## Operations

```powershell
cd auth-worker
$env:CLOUDFLARE_API_TOKEN = (Get-Content ../.cf-token.local -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = '<your-cloudflare-account-id>'

npx wrangler d1 execute afterframe-auth --remote --file=schema.sql   # idempotent
npx wrangler deploy
```

`schema.sql` is additive and idempotent (`CREATE TABLE IF NOT EXISTS`), so
re-running it after a pull is safe and is how `auth_devices` lands. Until it has
been applied, `/auth/device` answers `{ known: false }` instead of failing, and
the gate simply falls back to the record this browser keeps.

**The device table does not need that command.** `functions/auth/device.js`
creates `auth_devices` + its two indexes on first use, one statement at a time,
because the Pages project can reach the same D1 database. `GET /auth/device`
reports `{ database, table, schema }` so a missing binding or a failed
`CREATE TABLE` is visible instead of looking like a new device.

Deploying the app therefore deploys everything the gate needs:

```powershell
npm run build                       # dist/ carries functions/ with it
node scripts/deploy-pages.mjs       # Pages project afterframe, branch main
```

Bindings: `DB` (D1), `SEND_KEY` (secret, same value as `.mail-key.local`), vars `APP_ORIGIN`,
`APP_ORIGINS`, `MAIL_URL`. Hostname: `auth.acocloud.app/*` → `afterframe-auth`.
The Pages project needs `DB` → `afterframe-auth` (`2208907d-226b-4511-ab56-28800f21d85c`)
in its deployment config — set once, verified by `GET /auth/device`.

Point the app elsewhere (staging, local worker) with `VITE_AUTH_API_URL`, and the
device hint with `VITE_DEVICE_URL` (empty by default = same origin; the Vite dev
server serves no Functions, so it is skipped there).

## Still to do

- Verify the email address on signup (add `email_verified` to the schema and gate it).
- Rate limiting is per-isolate and best-effort; move counters into D1 or a Durable Object
  before opening signups publicly.
- Sessions currently live 30 days with no refresh; add sliding renewal if needed.
