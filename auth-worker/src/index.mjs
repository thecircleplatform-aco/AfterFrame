/**
 * AfterFrame auth API — Cloudflare Worker + D1.
 *
 * POST /auth/signup           { email, password, name?, device? }
 * POST /auth/login            { email, password, device? }
 * POST /auth/logout
 * GET  /auth/me
 * POST /auth/device           { device }             -> { known, createdAccount, hint }
 * POST /auth/forgot-password  { email }            -> always 200
 * POST /auth/reset-password   { token, password }
 * GET  /health
 *
 * Security shape:
 *  - passwords: PBKDF2-SHA256, 100k iterations, per-user 16-byte salt
 *  - sessions: 32-byte random token, HttpOnly + Secure + SameSite=None cookie, stored
 *    as a SHA-256 hash so a database leak cannot be replayed
 *  - password resets: 32-byte random token, hashed at rest, single use, 60 minute TTL,
 *    and the address never appears in the link
 *  - device records: a coarse, derived description of the browser (never a canvas or
 *    audio fingerprint). They choose which form the app opens and nothing else —
 *    they authenticate nobody and unlock nothing, so a collision is harmless
 *  - every response is JSON, no wildcard CORS, no credentials in the URL
 */

const SESSION_COOKIE = 'af_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const RESET_TTL_MS = 60 * 60 * 1000
// Cloudflare's WebCrypto rejects PBKDF2 iteration counts above 100000, so this is the
// strongest allowed setting rather than an arbitrary choice.
const PBKDF2_ITERATIONS = 100_000
const MIN_PASSWORD = 8

const encoder = new TextEncoder()

function base64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64Url(bytes) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(byteLength = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64(new Uint8Array(digest))
}

async function hashPassword(password, salt) {
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64(saltBytes)}$${base64(new Uint8Array(bits))}`
}

async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, expected] = String(stored).split('$')
  if (scheme !== 'pbkdf2' || !salt || !expected) return false
  const saltBytes = Uint8Array.from(atob(salt), (char) => char.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: Number(iterations), hash: 'SHA-256' },
    key,
    256,
  )
  const actual = base64(new Uint8Array(bits))
  // Constant-time-ish compare.
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let index = 0; index < actual.length; index++) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return diff === 0
}

function allowedOrigins(env) {
  return String(env.APP_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const headers = {
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
  if (origin && allowedOrigins(env).includes(origin)) headers['access-control-allow-origin'] = origin
  return headers
}

function json(request, env, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request, env),
      ...extraHeaders,
    },
  })
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

function sessionCookie(token, maxAgeSeconds) {
  // SameSite=None so the editor on another origin can carry the session; Secure is
  // mandatory for that, which is why this API is HTTPS-only.
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAgeSeconds}`
}

const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}

/** Best-effort per-isolate throttle; D1 is the source of truth for accounts. */
const attempts = new Map()
function throttle(key, limit, windowMs) {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  entry.count += 1
  if (entry.count > limit) return false
  return true
}

async function sendMail(env, message) {
  if (!env.MAIL_URL || !env.SEND_KEY) return
  await fetch(env.MAIL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SEND_KEY}` },
    body: JSON.stringify(message),
  })
}

async function userById(env, id) {
  return env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?1').bind(id).first()
}

/** `someone@studio.com` -> `s******@studio.com`. Enough to recognise, not to harvest. */
function maskEmail(email) {
  const [local, domain] = String(email ?? '').split('@')
  if (!local || !domain) return null
  const stars = '*'.repeat(Math.min(3, Math.max(1, local.length - 1)))
  return `${local.slice(0, 1)}${stars}@${domain}`
}

/**
 * Hash the device signal the app sends.
 *
 * `traits` is the stable half — platform, language, timezone, bucketed screen,
 * core count and a version-stripped UA family — so it survives a routine browser
 * update and cleared site data. `id` is the random per-origin token stored in
 * localStorage, which is exact when the storage is still there.
 *
 * Returns `null` for anything too short to be a real signal, so a caller cannot
 * write a junk row that would then match other junk rows.
 */
async function deviceKeys(device) {
  const traits = String(device?.traits ?? '').trim().slice(0, 400)
  const clientId = String(device?.id ?? '').trim().slice(0, 80)
  if (traits.length < 8) return null
  return {
    fingerprint: await sha256(`traits:${traits}`),
    clientId: clientId ? await sha256(`id:${clientId}`) : '',
  }
}

/** Remember that this device created or used an account. Never throws. */
async function recordDevice(env, request, device, userId, createdAccount) {
  try {
    const keys = await deviceKeys(device)
    if (!keys) return
    const now = Date.now()
    const { ip, country } = clientAddress(request)
    await env.DB.prepare(
      `INSERT INTO auth_devices (fingerprint, client_id, user_id, created_account, first_seen_at, last_seen_at, user_agent, ip, country)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8)
       ON CONFLICT(fingerprint) DO UPDATE SET
         client_id = excluded.client_id,
         user_id = excluded.user_id,
         created_account = max(auth_devices.created_account, excluded.created_account),
         last_seen_at = excluded.last_seen_at,
         user_agent = excluded.user_agent,
         ip = excluded.ip,
         country = excluded.country`,
    )
      .bind(
        keys.fingerprint,
        keys.clientId,
        userId,
        createdAccount ? 1 : 0,
        now,
        (request.headers.get('User-Agent') ?? '').slice(0, 255),
        ip,
        country,
      )
      .run()
  } catch (error) {
    // A missing table or a write hiccup must never fail a signup or a login.
    console.error('device record failed', error)
  }
}

/**
 * What does the worker know about this device?
 *
 * Deliberately quiet: `known` with no address for a device that merely signed
 * in, and a MASKED address only when the account was created here. A caller who
 * guesses a fingerprint learns whether an account exists, never which one.
 */
async function handleDevice(request, env) {
  const unknown = { known: false, createdAccount: false, hint: null }
  const body = await request.json().catch(() => ({}))
  const keys = await deviceKeys(body.device)
  if (!keys) return json(request, env, unknown)
  if (!throttle(`device:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 120, 60_000)) {
    return json(request, env, unknown)
  }

  try {
    let row = await env.DB.prepare(
      'SELECT user_id, created_account FROM auth_devices WHERE fingerprint = ?1',
    )
      .bind(keys.fingerprint)
      .first()

    if (!row && keys.clientId) {
      row = await env.DB.prepare(
        'SELECT user_id, created_account FROM auth_devices WHERE client_id = ?1 AND user_id IS NOT NULL',
      )
        .bind(keys.clientId)
        .first()
    }

    if (!row?.user_id) return json(request, env, unknown)

    const user = await userById(env, row.user_id)
    if (!user) return json(request, env, unknown)

    await env.DB.prepare('UPDATE auth_devices SET last_seen_at = ?1 WHERE fingerprint = ?2')
      .bind(Date.now(), keys.fingerprint)
      .run()

    const created = Boolean(row.created_account)
    return json(request, env, {
      known: true,
      createdAccount: created,
      hint: created ? maskEmail(user.email) : null,
    })
  } catch (error) {
    // Nothing here is load-bearing: the app falls back to its own record.
    console.error('device lookup failed', error)
    return json(request, env, unknown)
  }
}

/**
 * Who is calling, as far as Cloudflare can tell. `CF-Connecting-IP` is set by the
 * edge and cannot be forged by the client; `CF-IPCountry` is the ISO country.
 * Only ever used for abuse tracing, never for auth decisions.
 */
function clientAddress(request) {
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    (request.headers.get('X-Forwarded-For') ?? '').split(',')[0].trim() ??
    null
  return {
    ip: ip ? ip.slice(0, 64) : null,
    country: (request.headers.get('CF-IPCountry') ?? '').slice(0, 2) || null,
  }
}

async function createSession(env, request, userId) {
  const token = randomToken()
  const now = Date.now()
  const { ip, country } = clientAddress(request)
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, country, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
  )
    .bind(
      crypto.randomUUID(),
      userId,
      await sha256(token),
      (request.headers.get('User-Agent') ?? '').slice(0, 255),
      ip,
      country,
      now,
      now + SESSION_TTL_MS,
    )
    .run()
  return token
}

async function handleSignup(request, env) {
  const body = await request.json().catch(() => ({}))
  const email = normalizeEmail(body.email)
  const password = String(body.password ?? '')
  const name = body.name ? String(body.name).trim().slice(0, 80) : null

  if (!isEmail(email)) return json(request, env, { error: 'invalid_email', message: 'Enter a valid email address.' }, 400)
  if (password.length < MIN_PASSWORD) {
    return json(request, env, { error: 'weak_password', message: `Use at least ${MIN_PASSWORD} characters.` }, 400)
  }
  if (!throttle(`signup:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 10, 60_000)) {
    return json(request, env, { error: 'rate_limited', message: 'Too many attempts. Try again shortly.' }, 429)
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first()
  if (existing) {
    return json(request, env, { error: 'email_taken', message: 'That email already has an account.' }, 409)
  }

  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(id, email, name, await hashPassword(password), now, now)
    .run()

  // The account was made HERE. That is what makes the next visit open sign-in
  // with the address filled in instead of an empty signup form.
  await recordDevice(env, request, body.device, id, true)

  const token = await createSession(env, request, id)
  // Best-effort: a mail hiccup must never fail a sign-up that already committed.
  await sendMail(env, {
    to: email,
    template: 'welcome',
    data: { name, email, link: `${env.APP_ORIGIN}/#/signin` },
  }).catch(() => {})
  return json(
    request,
    env,
    { user: { id, email, name } },
    201,
    { 'set-cookie': sessionCookie(token, SESSION_TTL_MS / 1000) },
  )
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}))
  const email = normalizeEmail(body.email)
  const password = String(body.password ?? '')

  if (!isEmail(email) || !password) {
    return json(request, env, { error: 'invalid_input', message: 'Enter your email and password.' }, 400)
  }
  if (!throttle(`login:${email}`, 12, 60_000)) {
    return json(request, env, { error: 'rate_limited', message: 'Too many attempts. Try again shortly.' }, 429)
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name, password_hash FROM users WHERE email = ?1',
  )
    .bind(email)
    .first()

  // Same answer whether the account is missing or the password is wrong.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json(request, env, { error: 'invalid_credentials', message: 'Email or password is incorrect.' }, 401)
  }

  // Used here, not necessarily created here — `created_account` keeps its max.
  await recordDevice(env, request, body.device, user.id, false)

  const token = await createSession(env, request, user.id)
  return json(
    request,
    env,
    { user: { id: user.id, email: user.email, name: user.name } },
    200,
    { 'set-cookie': sessionCookie(token, SESSION_TTL_MS / 1000) },
  )
}

async function handleLogout(request, env) {
  const token = readCookie(request, SESSION_COOKIE)
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run()
  }
  return json(request, env, { ok: true }, 200, { 'set-cookie': clearedCookie })
}

async function handleMe(request, env) {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return json(request, env, { error: 'unauthenticated', message: 'Not signed in.' }, 401)

  const row = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1',
  )
    .bind(await sha256(token))
    .first()

  if (!row || row.expires_at < Date.now()) {
    return json(request, env, { error: 'unauthenticated', message: 'Session expired.' }, 401)
  }

  const user = await userById(env, row.user_id)
  if (!user) return json(request, env, { error: 'unauthenticated', message: 'Not signed in.' }, 401)
  return json(request, env, { user })
}

/**
 * Google sign-in, code-exchange leg.
 *
 * The browser never talks to Google's token endpoint with our secret, and the
 * redirect URI is the app origin, so the session cookie lands on the app's own
 * host in dev and in production alike. The client sends the authorization code
 * plus its PKCE verifier; we exchange, verify the ID token with Google, then
 * issue a session exactly as a password login would.
 *
 * Accounts are matched on the verified email. If someone signed up with a
 * password using the same address, Google has proven ownership of it, so the two
 * sign-in methods converge on one account. A Google-only account gets an
 * unusable password hash, which makes password login impossible rather than
 * merely unlikely.
 */
async function handleGoogleExchange(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json(request, env, { error: 'google_disabled', message: 'Google sign-in is not configured on this server.' }, 501)
  }

  const body = await request.json().catch(() => ({}))
  const code = String(body.code ?? '')
  const redirectUri = String(body.redirectUri ?? '')
  const codeVerifier = String(body.codeVerifier ?? '')
  if (!code || !redirectUri) {
    return json(request, env, { error: 'invalid_request', message: 'Google sign-in did not return a code.' }, 400)
  }
  if (!throttle(`google:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 20, 60_000)) {
    return json(request, env, { error: 'rate_limited', message: 'Too many attempts. Try again shortly.' }, 429)
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }),
  })
  const tokens = await tokenResponse.json().catch(() => ({}))
  if (!tokenResponse.ok || !tokens.id_token) {
    return json(request, env, { error: 'google_failed', message: 'Google did not accept that sign-in. Try again.' }, 401)
  }

  // Google validates signature, issuer and expiry for us; we still pin `aud`.
  const infoResponse = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
  )
  const info = await infoResponse.json().catch(() => ({}))
  if (!infoResponse.ok || info.aud !== env.GOOGLE_CLIENT_ID) {
    return json(request, env, { error: 'google_failed', message: 'That Google token was not issued for this app.' }, 401)
  }
  const email = normalizeEmail(info.email)
  if (!isEmail(email)) {
    return json(request, env, { error: 'google_no_email', message: 'Google did not share an email address.' }, 400)
  }
  if (info.email_verified !== true && info.email_verified !== 'true') {
    return json(request, env, { error: 'google_unverified', message: 'Google has not verified that address yet.' }, 403)
  }

  const now = Date.now()
  let user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?1').bind(email).first()
  if (!user) {
    const id = crypto.randomUUID()
    const name = info.name ? String(info.name).trim().slice(0, 80) : null
    await env.DB.prepare(
      'INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    )
      .bind(id, email, name, await hashPassword(randomToken(32)), now, now)
      .run()
    user = { id, email, name }
  }

  const token = await createSession(env, request, user.id)
  return json(
    request,
    env,
    { user: { id: user.id, email: user.email, name: user.name } },
    200,
    { 'set-cookie': sessionCookie(token, SESSION_TTL_MS / 1000) },
  )
}

async function handleForgot(request, env) {
  const body = await request.json().catch(() => ({}))
  const email = normalizeEmail(body.email)
  if (!isEmail(email)) return json(request, env, { ok: true }, 200)
  if (!throttle(`forgot:${email}`, 5, 60_000)) return json(request, env, { ok: true }, 200)

  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?1')
    .bind(email)
    .first()

  if (user) {
    const token = randomToken()
    const now = Date.now()
    await env.DB.prepare(
      'INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
      .bind(crypto.randomUUID(), user.id, await sha256(token), now, now + RESET_TTL_MS)
      .run()

    const link = `${env.APP_ORIGIN}/#/reset-password?token=${token}`
    await sendMail(env, {
      to: user.email,
      template: 'reset-password',
      data: { name: user.name, link },
    })
    // Local development has no mail worker and no SEND_KEY, so nothing would
    // arrive. `--var EXPOSE_RESET_LINK:true` (see `npm run auth:dev`) returns the
    // link instead. Never enabled on the deployed worker.
    if (env.EXPOSE_RESET_LINK === 'true') return json(request, env, { ok: true, link }, 200)
  }

  // Never reveal whether the address exists.
  return json(request, env, { ok: true }, 200)
}

async function handleReset(request, env) {
  const body = await request.json().catch(() => ({}))
  const token = String(body.token ?? '')
  const password = String(body.password ?? '')

  if (!token) return json(request, env, { error: 'invalid_token', message: 'This reset link is not valid.' }, 400)
  if (password.length < MIN_PASSWORD) {
    return json(request, env, { error: 'weak_password', message: `Use at least ${MIN_PASSWORD} characters.` }, 400)
  }

  const row = await env.DB.prepare(
    'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?1',
  )
    .bind(await sha256(token))
    .first()

  if (!row || row.used_at || row.expires_at < Date.now()) {
    return json(request, env, { error: 'invalid_token', message: 'This reset link has expired or was already used.' }, 400)
  }

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3').bind(
      await hashPassword(password),
      now,
      row.user_id,
    ),
    env.DB.prepare('UPDATE password_resets SET used_at = ?1 WHERE id = ?2').bind(now, row.id),
    // Any other session must not survive a password change.
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(row.user_id),
  ])

  // Tell the owner it happened. Every session was just killed, so this is the
  // only signal that something changed on an account they are not looking at.
  const owner = await userById(env, row.user_id)
  if (owner) {
    const { ip } = clientAddress(request)
    await sendMail(env, {
      to: owner.email,
      template: 'password-changed',
      data: {
        name: owner.name,
        when: new Date(now).toUTCString(),
        ip: ip ?? undefined,
      },
    }).catch(() => {})
  }

  return json(request, env, { ok: true }, 200, { 'set-cookie': clearedCookie })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    try {
      if (url.pathname === '/health') return json(request, env, { ok: true, service: 'afterframe-auth' })

      switch (`${request.method} ${url.pathname}`) {
        case 'POST /auth/signup':
          return await handleSignup(request, env)
        case 'POST /auth/login':
          return await handleLogin(request, env)
        case 'POST /auth/logout':
          return await handleLogout(request, env)
        case 'GET /auth/me':
          return await handleMe(request, env)
        case 'POST /auth/device':
          return await handleDevice(request, env)
        case 'POST /auth/forgot-password':
          return await handleForgot(request, env)
        case 'POST /auth/google/exchange':
          return await handleGoogleExchange(request, env)
        case 'POST /auth/reset-password':
          return await handleReset(request, env)
        default:
          return json(request, env, { error: 'not_found', message: 'Unknown endpoint.' }, 404)
      }
    } catch (error) {
      return json(
        request,
        env,
        { error: 'server_error', message: String(error?.message ?? error) },
        500,
      )
    }
  },
}
