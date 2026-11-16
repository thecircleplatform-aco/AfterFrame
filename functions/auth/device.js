/**
 * `POST /auth/device` — the device-fingerprint oracle for the sign-in gate.
 *
 * Lives HERE, on the app's own origin, rather than on the auth worker, because
 * the Pages project can already reach the same D1 database (`DB` → `afterframe-auth`,
 * bound in the project's deployment config) while the API token that deploys this
 * project has no Workers permission. Same table, same hashing, one fewer moving
 * part — and no cross-origin request, so no CORS and no cookie mode to get wrong.
 *
 * Contract (identical to the auth worker's, so either side can answer):
 *
 *   POST { device: { id, traits }, claim?: { userId, createdAccount } }
 *     -> { known, createdAccount, hint }
 *
 * `claim` is how a row learns which account this device made. The app sends it
 * after a successful signup/signin, because the account operation itself still
 * happens on `auth.acocloud.app` — this function only remembers the outcome.
 *
 * Security shape: this authenticates NOBODY. It reads a table keyed on a coarse,
 * non-secret browser description and returns at most a MASKED address for a
 * device that created an account here. A guessed fingerprint learns "an account
 * was made on a device like this", never which one.
 */

const encoder = new TextEncoder()

/** Same encoding as `auth-worker/src/index.mjs` — the hashes must match exactly. */
function base64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64(new Uint8Array(digest))
}

/** `someone@studio.com` -> `s***@studio.com`. Recognisable, not harvestable. */
function maskEmail(email) {
  const [local, domain] = String(email ?? '').split('@')
  if (!local || !domain) return null
  const stars = '*'.repeat(Math.min(3, Math.max(1, local.length - 1)))
  return `${local.slice(0, 1)}${stars}@${domain}`
}

/**
 * Two keys, exactly as the worker derives them: `traits` survives a routine
 * browser update (version-stripped UA, bucketed screen), `id` is the random
 * per-origin token in localStorage and is exact while storage survives.
 */
async function deviceKeys(device) {
  const traits = String(device?.traits ?? '').trim().slice(0, 400)
  const clientId = String(device?.id ?? '').trim().slice(0, 80)
  // Too short to be a real signal: writing that row would let junk match junk.
  if (traits.length < 8) return null
  return {
    fingerprint: await sha256(`traits:${traits}`),
    clientId: clientId ? await sha256(`id:${clientId}`) : '',
  }
}

const UNKNOWN = { known: false, createdAccount: false, hint: null }

/** Best-effort per-isolate throttle, same idea as the worker's. */
const attempts = new Map()
function allow(key, limit, windowMs) {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  entry.count += 1
  return entry.count <= limit
}

/**
 * The table is created by `auth-worker/schema.sql`, which was written before this
 * function existed — so on a database that only ever ran the older schema the
 * table is genuinely absent. This creates it.
 *
 * One statement per call, deliberately: `DB.exec()` takes a multi-statement
 * string, but a single failing statement inside it is swallowed whole, which is
 * how this endpoint spent a deploy returning "unknown device" for a reason
 * nobody could see. The outcome is remembered so a broken database costs one
 * failed attempt, not one per request.
 */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS auth_devices (
     fingerprint TEXT PRIMARY KEY,
     client_id TEXT,
     user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
     created_account INTEGER NOT NULL DEFAULT 0,
     first_seen_at INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL,
     user_agent TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS idx_devices_user ON auth_devices(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_devices_client ON auth_devices(client_id)',
]

let schemaState = 'uninitialised'
async function ensureSchema(db) {
  if (schemaState === 'ready') return
  try {
    for (const sql of SCHEMA_STATEMENTS) await db.prepare(sql).run()
    schemaState = 'ready'
  } catch (error) {
    // Recorded, not thrown: a missing table must not fail the gate, and the
    // health probe reports this string so it is diagnosable at all.
    schemaState = String(error?.message ?? error).slice(0, 140)
    console.error('device schema failed', schemaState)
  }
}

const ALLOWED_ORIGINS = new Set([
  'https://afterframe.acocloud.app',
  'https://docs.afterframe.acocloud.app',
  'http://localhost:5173',
])

function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? ''
  const headers = {
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
  // Same-origin requests send no Origin at all, which is the normal case here.
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['access-control-allow-origin'] = origin
  return headers
}

function reply(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A hint cached by a CDN would be handed to the next visitor.
      'cache-control': 'no-store',
      ...corsHeaders(request),
    },
  })
}

export function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

/**
 * `GET /auth/device` — is this endpoint wired up?
 *
 * Worth having: every failure mode here is silent by design (a hint that cannot
 * be read must never break the app), so without one honest probe a missing D1
 * binding is indistinguishable from "this really is a new device". Reports names
 * only — never a token, an id or a row count that could be scraped.
 */
export async function onRequestGet({ request, env }) {
  if (!env.DB) return reply(request, { ok: false, database: false, schema: 'no binding' })
  await ensureSchema(env.DB)
  let table = 'missing'
  try {
    await env.DB.prepare('SELECT 1 FROM auth_devices LIMIT 1').first()
    table = 'ready'
  } catch (error) {
    table = String(error?.message ?? 'error').slice(0, 80)
  }
  return reply(request, { ok: table === 'ready', database: true, table, schema: schemaState })
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return reply(request, UNKNOWN)
  if (!allow(`device:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 120, 60_000)) {
    return reply(request, UNKNOWN)
  }

  const body = await request.json().catch(() => ({}))
  const keys = await deviceKeys(body?.device)
  if (!keys) return reply(request, UNKNOWN)

  try {
    await ensureSchema(env.DB)
    const now = Date.now()
    const userAgent = (request.headers.get('User-Agent') ?? '').slice(0, 255)

    await env.DB.prepare(
      `INSERT INTO auth_devices (fingerprint, client_id, user_id, created_account, first_seen_at, last_seen_at, user_agent)
       VALUES (?1, ?2, NULL, 0, ?3, ?3, ?4)
       ON CONFLICT(fingerprint) DO UPDATE SET
         client_id = excluded.client_id,
         last_seen_at = excluded.last_seen_at,
         user_agent = excluded.user_agent`,
    )
      .bind(keys.fingerprint, keys.clientId, now, userAgent)
      .run()

    // The account operation happens on the auth worker, so the outcome is
    // reported back here. `created_account` is sticky: signing in later on the
    // same device must never demote it back to "merely used here".
    const claim = body?.claim
    const userId = typeof claim?.userId === 'string' ? claim.userId.slice(0, 64) : ''
    if (userId) {
      await env.DB.prepare(
        `UPDATE auth_devices
            SET user_id = ?1,
                created_account = max(created_account, ?2),
                last_seen_at = ?3
          WHERE fingerprint = ?4`,
      )
        .bind(userId, claim?.createdAccount ? 1 : 0, now, keys.fingerprint)
        .run()
    }

    let row = await env.DB.prepare(
      'SELECT user_id, created_account FROM auth_devices WHERE fingerprint = ?1',
    )
      .bind(keys.fingerprint)
      .first()

    // Storage was cleared but the browser is the same machine: the client id is
    // gone too, so this is the traits hash only. Exact when localStorage survives
    // is the case above; this branch is the "same device, new browser profile".
    if (!row?.user_id && keys.clientId) {
      row = await env.DB.prepare(
        'SELECT user_id, created_account FROM auth_devices WHERE client_id = ?1 AND user_id IS NOT NULL',
      )
        .bind(keys.clientId)
        .first()
    }

    if (!row?.user_id) return reply(request, UNKNOWN)

    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?1')
      .bind(row.user_id)
      .first()
      .catch(() => null)
    if (!user?.email) return reply(request, UNKNOWN)

    const created = Boolean(row.created_account)
    return reply(request, {
      known: true,
      createdAccount: created,
      // Only an account MADE here gets its address echoed, and only masked.
      hint: created ? maskEmail(user.email) : null,
    })
  } catch (error) {
    // Nothing here is load-bearing: the app falls back to its own local record.
    console.error('device lookup failed', error)
    return reply(request, UNKNOWN)
  }
}
