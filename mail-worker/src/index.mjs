/**
 * AfterFrame transactional mail.
 *
 * One endpoint, one job: turn a JSON body into an email.
 *
 *   POST /            { to, subject, text, html?, replyTo? }  → { ok: true, id }
 *   POST /            { to, template, data }                 → { ok: true, id }
 *   Authorization: Bearer <SEND_KEY>
 *
 * Delivery is Resend when `RESEND_API_KEY` is set. Cloudflare's `send_email`
 * binding is kept as a fallback, but that binding only reaches addresses
 * verified under Email Routing — fine for testing, useless for password resets
 * to arbitrary users, which is why Resend is the primary path.
 *
 * Bindings:
 *   RESEND_API_KEY secret       → Resend delivery (primary)
 *   EMAIL          send_email   → Cloudflare delivery (fallback, optional)
 *   SEND_KEY       secret       → the shared token the app presents
 *   MAIL_FROM      var          → default sender (must be a verified Resend domain)
 *   ALLOWED_ORIGIN var          → browser origin allowed to call this
 */

import { renderTemplate } from './templates.mjs'

const json = (body, status = 200, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'POST,OPTIONS',
      vary: 'origin',
    },
  })

function addressOf(value) {
  const match = /<([^>]+)>/.exec(value ?? '')
  return (match ? match[1] : (value ?? '')).trim()
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? ''
    const allowed = env.ALLOWED_ORIGIN ?? '*'
    const cors = allowed === '*' ? '*' : origin === allowed ? origin : allowed

    if (request.method === 'OPTIONS') return json({}, 204, cors)
    if (request.method !== 'POST') return json({ error: 'use POST' }, 405, cors)

    if (allowed !== '*' && origin && origin !== allowed) {
      return json({ error: 'origin not allowed' }, 403, cors)
    }

    const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!env.SEND_KEY || presented !== env.SEND_KEY) {
      return json({ error: 'unauthorized' }, 401, cors)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'body must be JSON' }, 400, cors)
    }

    const to = typeof body.to === 'string' ? body.to.trim() : ''
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addressOf(to))) {
      return json({ error: 'to must be one email address' }, 400, cors)
    }

    // Two shapes: a ready-made message, or a template name plus its data. The
    // template path is how the app sends mail — design lives here, not in the
    // auth worker, and a typo in the name fails loudly instead of silently
    // sending a blank body.
    let subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    let text = typeof body.text === 'string' ? body.text : ''
    let html = typeof body.html === 'string' ? body.html : undefined
    if (typeof body.template === 'string' && body.template) {
      try {
        const rendered = renderTemplate(body.template, body.data ?? {})
        subject = rendered.subject
        text = rendered.text
        html = rendered.html
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 400, cors)
      }
    }

    if (!subject || !text) {
      return json({ error: 'subject and text are required (or pass template + data)' }, 400, cors)
    }

    try {
      const defaultFrom = env.MAIL_FROM ?? 'AfterFrame <noreply@afterframe.acocloud.app>'
      // Our own domain or nothing. Resend's shared `onboarding@resend.dev` sender
      // only exists so a brand-new account can send itself a test; shipping it
      // would put the wrong domain in every reset email. Refuse it unless the
      // operator has explicitly opted in for local testing.
      if (/resend\.dev/i.test(defaultFrom) && env.ALLOW_RESEND_TEST_SENDER !== 'true') {
        return json({
          error: 'MAIL_FROM must be an address on a verified domain (set ALLOW_RESEND_TEST_SENDER=true only for local testing)',
        }, 500, cors)
      }

      const message = {
        to,
        from: defaultFrom,
        // Replies should reach a human inbox on our domain, not the send-only
        // address that Resend and SPF are configured for.
        replyTo: typeof body.replyTo === 'string' && body.replyTo ? body.replyTo : (env.MAIL_REPLY_TO ?? undefined),
        subject,
        text,
        ...(typeof html === 'string' ? { html } : {}),
      }

      // Resend first: it can deliver to any address, which resets require.
      if (env.RESEND_API_KEY) {
        const sent = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.RESEND_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: message.from,
            to: [addressOf(to)],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
            ...(message.replyTo ? { reply_to: addressOf(message.replyTo) } : {}),
          }),
        })
        const payload = await sent.json().catch(() => ({}))
        if (!sent.ok) {
          // Resend's own message is the most useful thing to hand back.
          return json({ error: payload?.message ?? `resend ${sent.status}`, provider: 'resend' }, 502, cors)
        }
        return json({ ok: true, id: payload?.id ?? null, provider: 'resend' }, 200, cors)
      }

      // Fallback: Cloudflare Email Routing (verified recipients only).
      const result = await env.EMAIL.send(message)
      return json({ ok: true, id: result?.messageId ?? null, provider: 'cloudflare' }, 200, cors)
    } catch (error) {
      // Surface the reason but never the binding internals.
      return json({ error: String(error?.message ?? error) }, 502, cors)
    }
  },
}
