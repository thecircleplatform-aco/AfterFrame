/**
 * `/api/*` on Cloudflare Pages.
 *
 * The real backend is `server/` (Node: media probing, frame extraction, settings,
 * agent runs). It cannot run on Pages, which only serves the static bundle plus
 * these Functions. Two things must be true for the hosted build:
 *
 *  1. Calls must NOT fall through to the SPA catch-all in `_redirects`. That was
 *     the original bug: `/api/keys` returned index.html with a 200, so the client
 *     parsed HTML as JSON and the settings dialog reported "dev server not ready?".
 *  2. The answer must be honest JSON with a real status, so callers can degrade
 *     to their offline/local path instead of guessing what went wrong.
 *
 * `_redirects` cannot express this (Pages supports only 3xx + 200 proxying, not
 * 404 rewrites), so the behaviour lives here. `functions/auth/[[path]].js` is a
 * more specific route and continues to win for `/auth/*`.
 */
const BODY = {
  error: 'server_unavailable',
  message:
    'The AfterFrame backend is not running on this host. Features that need local '
    + 'processing (media probing, frame extraction, settings, agent runs) require '
    + 'the desktop app or a self-hosted server.',
}

export async function onRequest() {
  return new Response(JSON.stringify(BODY), {
    status: 501,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Never cache a capability failure.
      'Cache-Control': 'no-store',
    },
  })
}
