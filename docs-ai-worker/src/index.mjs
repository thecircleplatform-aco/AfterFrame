/**
 * afterframe-docs-ai — the docs assistant behind "Ask Zen".
 *
 * The docs are a static SPA, so a provider key can never live in the bundle: a
 * Vite build inlines `VITE_*` values into public JavaScript. This Worker holds the
 * key as a Cloudflare secret instead, so one key serves every reader and nobody
 * has to bring their own.
 *
 *   POST /zen   { system, messages: [{ role, content }] }  -> text/plain stream
 *   GET  /health
 *
 * Design:
 *  - The client sends the prompt (it owns the documentation corpus); the Worker
 *    only validates size, adds the key and streams the completion back.
 *  - OpenAI-compatible SSE from the provider is re-emitted as plain text chunks,
 *    which is all the panel needs — no SSE parsing in the browser.
 *  - Origin allow-list + per-IP rate limit, because this is a paid endpoint on a
 *    public hostname.
 */

const MAX_SYSTEM_CHARS = 80_000
const MAX_MESSAGE_CHARS = 8_000
const MAX_MESSAGES = 24
const RATE_PER_MINUTE = 12

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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
  if (!allowedOrigins(env).includes(origin)) return headers // no ACAO = browser blocks it
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

/** Best-effort per-isolate throttle; Cloudflare gives each isolate its own Map. */
const buckets = new Map()

function withinRate(clientKey) {
  const now = Date.now()
  const entry = buckets.get(clientKey)
  if (!entry || now > entry.resetAt) {
    buckets.set(clientKey, { count: 1, resetAt: now + 60_000 })
    return true
  }
  entry.count += 1
  return entry.count <= RATE_PER_MINUTE
}

function readPrompt(body) {
  const system = typeof body?.system === 'string' ? body.system.slice(0, MAX_SYSTEM_CHARS) : ''
  const messages = Array.isArray(body?.messages) ? body.messages.slice(-MAX_MESSAGES) : []
  const cleaned = messages
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? '').slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content.trim().length > 0)

  if (cleaned.length === 0) return null
  return { system, messages: cleaned }
}

/** OpenAI-style SSE → plain text chunks (only `choices[0].delta.content`). */
function toTextStream(body) {
  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader()
      let buffer = ''
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              const delta = parsed?.choices?.[0]?.delta?.content
              if (delta) controller.enqueue(encoder.encode(delta))
            } catch {
              /* keepalive comment or truncated frame — ignore */
            }
          }
        }
      } catch (error) {
        controller.enqueue(encoder.encode(`\n[stream error: ${String(error?.message ?? error)}]`))
      } finally {
        controller.close()
      }
    },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    if (url.pathname === '/health') {
      return json(request, env, {
        ok: true,
        service: 'afterframe-docs-ai',
        configured: Boolean(env.DEEPSEEK_API_KEY),
        model: env.DOCS_MODEL ?? 'deepseek-chat',
      })
    }

    if (url.pathname !== '/zen') {
      return json(request, env, { error: 'not_found' }, 404)
    }
    if (request.method !== 'POST') {
      return json(request, env, { error: 'method_not_allowed' }, 405)
    }

    const origin = request.headers.get('Origin') ?? ''
    if (origin && !allowedOrigins(env).includes(origin)) {
      return json(request, env, { error: 'origin_not_allowed' }, 403)
    }

    const clientKey = request.headers.get('CF-Connecting-IP') ?? 'local'
    if (!withinRate(clientKey)) {
      return json(request, env, { error: 'rate_limited' }, 429)
    }

    if (!env.DEEPSEEK_API_KEY) {
      return json(request, env, { error: 'not_configured', message: 'DEEPSEEK_API_KEY is missing.' }, 503)
    }

    const body = await request.json().catch(() => null)
    const prompt = readPrompt(body)
    if (!prompt) {
      return json(request, env, { error: 'invalid_prompt' }, 400)
    }

    const base = env.DEEPSEEK_BASE ?? 'https://api.deepseek.com'
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.DOCS_MODEL ?? 'deepseek-chat',
        temperature: 0.2,
        stream: true,
        messages: prompt.system
          ? [{ role: 'system', content: prompt.system }, ...prompt.messages]
          : prompt.messages,
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '')
      return json(
        request,
        env,
        { error: 'upstream', status: upstream.status, detail: detail.slice(0, 500) },
        502,
      )
    }

    return new Response(toTextStream(upstream.body), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
        ...corsHeaders(request, env),
      },
    })
  },
}
