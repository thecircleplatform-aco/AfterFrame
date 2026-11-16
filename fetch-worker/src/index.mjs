/**
 * afterframe-fetch — the reader behind the agent's web tool.
 *
 * A browser cannot scrape arbitrary sites: no CORS header, and a proxy that
 * accepts any URL is an SSRF hole. So the fetch happens here, once, behind an
 * origin allow-list, a scheme allow-list, a private-address deny-list and a
 * size cap.
 *
 *   POST /read   { url }  -> { url, title, text, truncated }
 *   GET  /health
 *
 * Design:
 *  - Readable text only. The page is stripped of scripts, styles, nav and
 *    chrome; the model gets prose, not markup, because markup costs tokens and
 *    teaches it nothing about the content.
 *  - No HTML rendering, no JS execution: whatever the server returns is what we
 *    read, which also makes this useless as a browser-automation bypass.
 *  - 20k characters out. Beyond that a page is a book, not a source.
 */

const MAX_CHARS = 20_000
const MAX_BYTES = 4_000_000
const RATE_PER_MINUTE = 20
const FETCH_TIMEOUT_MS = 12_000

const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
]

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const headers = {
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
  if (!allowedOrigins(env).includes(origin)) return headers
  headers['access-control-allow-origin'] = origin
  return headers
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(request, env),
    },
  })
}

const hits = new Map()
function throttled(ip) {
  const now = Date.now()
  const windowStart = now - 60_000
  const list = (hits.get(ip) ?? []).filter((at) => at > windowStart)
  if (list.length >= RATE_PER_MINUTE) return true
  list.push(now)
  hits.set(ip, list)
  return false
}

function parseTarget(raw) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    return { error: 'That is not a URL.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Only http and https pages can be read.' }
  }
  if (BLOCKED_HOSTS.some((pattern) => pattern.test(url.hostname))) {
    return { error: 'That address is not reachable from here.' }
  }
  return { url }
}

/** The handful of entities that actually appear in prose. */
function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

/** Strip a page down to its prose. */
function toText(html) {
  const withoutHead = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  const title = decodeEntities(
    (withoutHead.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim(),
  )

  const body =
    withoutHead.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    withoutHead.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    withoutHead.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    withoutHead

  const text = body
    // Block tags become newlines so paragraphs survive; everything else goes.
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()

  return { title, text: decodeEntities(text) }
}

async function handleRead(request, env) {
  const body = await request.json().catch(() => null)
  const target = parseTarget(body?.url)
  if (target.error) return json(request, env, { error: target.error }, 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(target.url.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Identify ourselves; some hosts block unknown agents outright.
        'user-agent': 'AfterFrameReader/1.0 (+https://afterframe.acocloud.app)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
    })

    if (!response.ok) {
      return json(request, env, { error: `The page answered ${response.status}.` }, 502)
    }

    const type = response.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      return json(request, env, { error: `Cannot read ${type || 'that content type'}.` }, 415)
    }

    const buffer = await response.arrayBuffer()
    const truncatedBytes = buffer.byteLength > MAX_BYTES
    const html = new TextDecoder('utf-8').decode(buffer.slice(0, MAX_BYTES))
    const { title, text } = toText(html)
    const truncated = truncatedBytes || text.length > MAX_CHARS

    return json(request, env, {
      url: target.url.href,
      title: title || target.url.hostname,
      text: text.slice(0, MAX_CHARS),
      truncated,
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return json(request, env, { error: aborted ? 'The page timed out.' : 'The page could not be read.' }, 504)
  } finally {
    clearTimeout(timer)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    if (url.pathname === '/health') {
      return json(request, env, { ok: true, service: 'afterframe-fetch' })
    }

    if (url.pathname !== '/read' || request.method !== 'POST') {
      return json(request, env, { error: 'Not found.' }, 404)
    }

    const origin = request.headers.get('Origin') ?? ''
    if (allowedOrigins(env).length > 0 && !allowedOrigins(env).includes(origin)) {
      return json(request, env, { error: 'Origin not allowed.' }, 403)
    }

    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    if (throttled(ip)) return json(request, env, { error: 'Too many reads. Wait a minute.' }, 429)

    return handleRead(request, env)
  },
}
