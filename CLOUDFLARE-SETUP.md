# AfterFrame on Cloudflare

Brought over from the FreeCut folder. Everything here is additive: the Electron
desktop build and the local Node server are untouched.

## What is in this repo now

| Path | What it is | Deploy |
|---|---|---|
| `auth-worker/` | Accounts, sessions (HttpOnly cookie + D1), password reset, device hints | `npm run cf:deploy:auth` |
| `fetch-worker/` | The agent's web reader (allow-listed, rate-limited) | `npm run cf:deploy:fetch` |
| `mail-worker/` | Transactional mail via Cloudflare Email Routing (`send_email` binding) | `npm run cf:deploy:mail` |
| `docs-ai-worker/` | Docs assistant; holds `DEEPSEEK_API_KEY` server-side | `npm run cf:deploy:docs` |
| `functions/auth/` | Pages Function that proxies `/auth/*` to the auth worker, so the session cookie stays **first-party** | ships with Pages |
| `public/_headers`, `public/_redirects` | Pages headers/redirects | ships with Pages |
| `scripts/cf-full-token.mjs` | Mints a long-lived 90-day token from a short-lived one | run manually |
| `CLOUDFLARE.md`, `AUTH.md`, `MAIL.md` | The original FreeCut docs (still accurate for the workers) | — |

## Live Cloudflare state (verified)

- Account: `<your-cloudflare-account-email>` — id `<your-cloudflare-account-id>`
- Pages project **`afterframe`** exists, serving
  `afterframe-2a6.pages.dev`, `afterframe.acocloud.app`, `docs.afterframe.acocloud.app`
- **0 Workers** exist in this account — the four workers the configs name
  (`afterframe-auth`, `afterframe-fetch`, `afterframe-mail`, `afterframe-docs-ai`)
  have never been deployed from this account.

## Blocker: the token in `freecut/.cf-token.local` cannot deploy

| API | Result |
|---|---|
| `GET /accounts/:id/workers/scripts` | **OK** (read) — 0 scripts |
| `GET /accounts/:id/pages/projects` | **OK** — 1 project |
| `GET /accounts/:id/d1/database` | **401 Authentication error** |
| `POST workers/services/afterframe-auth` (deploy) | **No access to the specified service** |

The token is readable but not writable. To deploy, mint a token with:

- Account → **Workers Scripts : Edit**
- Account → **D1 : Edit**
- Account → **Cloudflare Pages : Edit**
- Account → **Workers KV / R2 : Edit** (only if you add bindings later)

Then:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<new token>"
$env:CLOUDFLARE_ACCOUNT_ID = "<your-cloudflare-account-id>"
npm run cf:deploy:workers
npm run cf:d1:schema      # first run only: creates the auth tables
npm run cf:deploy:pages
```

`wrangler whoami` needs `CLOUDFLARE_ACCOUNT_ID` set — an Account-scoped token
cannot call `/memberships`, and wrangler tries that first.

## Wiring the app to the deployed worker

The app reads these at build time (Vite exposes `VITE_*`):

```
VITE_AUTH_API_URL=https://afterframe-auth.<account>.workers.dev
VITE_FETCH_URL=https://afterframe-fetch.<account>.workers.dev
VITE_DOCS_AI_URL=https://afterframe-docs-ai.<account>.workers.dev
```

On Pages the auth URL can stay empty (`functions/auth/[[path]].js` proxies
same-origin `/auth/*`), which is why the cookie is first-party in production.

## Important limitation

AfterFrame's editor backend — `server/` (sqlite project store, export pipeline,
MCP, model downloads) — is a **Node process**. It cannot run on Workers. Hosting
the editor itself on Cloudflare means either:

1. keeping the Node server beside Pages (VPS / container), or
2. rewriting the store onto Durable Objects + R2 + D1 (a separate project).

The workers above only cover identity, the agent's web reader, mail, and the
docs assistant.

## Rendering cost on a free product

Nothing here renders video. Cloudflare Pages serves static assets, and the
Node backend is started with `AFTERFRAME_SERVER_EXPORT=off`, which makes
`server/plugins/server-render-gate.ts` answer `501 server-render-disabled` for
`POST /export`, `/export/job/*`, `/render-clip`, `/api/export-qa` and (unless
`AFTERFRAME_SERVER_STILLS=on`) `/render-still`. Exports are encoded in the
visitor's browser via WebCodecs, so CPU cost scales with the user's device
instead of with our bill. See the table in `DO-SETUP.md` §8 for the full route
matrix and the features this gives up (ProRes mezzanine, server frame grabs,
dashboard posters).
