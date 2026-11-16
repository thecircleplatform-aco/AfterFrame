/**
 * `/auth/*` — same-origin proxy to the auth worker (`auth.acocloud.app`).
 *
 * Why this exists: the app is served from `afterframe.acocloud.app`, the auth API
 * from `auth.acocloud.app`. Every authenticated call therefore needs a
 * cross-SITE credentialed fetch, and browsers increasingly refuse those — Chrome
 * reported `No 'Access-Control-Allow-Origin' header` + `net::ERR_FAILED` for
 * `GET /auth/me` with `credentials: 'include'` while the identical request from
 * Node returned 200 with a correct `ACAO`. A `SameSite=None` cookie between two
 * hosts is on borrowed time anyway.
 *
 * So the browser never talks to the worker directly. It talks to this origin, and
 * the cookie lives on THIS host (`SameSite=Lax`, no `Domain`), which is what a
 * first-party session should look like. The worker stays the single source of
 * truth for accounts, sessions and password resets — nothing is reimplemented
 * here, and `auth.acocloud.app` keeps working for anything that calls it directly.
 *
 * `functions/auth/device.js` is a more specific route and wins for
 * `/auth/device`; it reads the same D1 database but answers locally.
 */

const AUTH_ORIGIN = 'https://auth.acocloud.app'

/**
 * `af_session=…; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=…`
 *   → same cookie on THIS host, `Lax`, no `Domain`.
 *
 * `SameSite=None` was only ever needed because the cookie crossed origins; on a
 * same-origin proxy it is both unnecessary and weaker.
 */
function firstPartyCookie(cookie) {
  return cookie.replace(/;\s*Domain=[^;]*/gi, '').replace(/SameSite=None/gi, 'SameSite=Lax')
}

function setCookies(headers) {
  // `getSetCookie()` is the only way to read more than one; the single-value
  // fallback keeps this working on an older runtime.
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

export async function onRequest({ request, params }) {
  const segment = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '')
  const method = request.method

  if (method !== 'GET' && method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const incoming = new URL(request.url)
  const target = `${AUTH_ORIGIN}/auth/${segment}${incoming.search}`

  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  // The session cookie must travel WITH the request, or `/auth/me` answers 401
  // on a perfectly good session — the proxy cannot invent it.
  const cookie = request.headers.get('cookie')
  if (cookie) headers.set('cookie', cookie)
  // The worker throttles on the client address; without this every caller would
  // look like one Cloudflare egress IP.
  const clientIp = request.headers.get('CF-Connecting-IP')
  if (clientIp) headers.set('x-forwarded-for', clientIp)

  let upstream
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: method === 'GET' ? undefined : await request.text(),
      redirect: 'manual',
    })
  } catch (error) {
    console.error('auth proxy failed', error)
    return new Response(
      JSON.stringify({ error: 'network', message: 'Cannot reach the sign-in service.' }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  const body = await upstream.text()
  const responseHeaders = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    // A cached session response handed to the next visitor would be a data leak.
    'cache-control': 'no-store',
  })
  for (const cookie of setCookies(upstream.headers)) {
    responseHeaders.append('set-cookie', firstPartyCookie(cookie))
  }

  return new Response(body, { status: upstream.status, headers: responseHeaders })
}
