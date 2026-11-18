/**
 * Service worker: makes the app installable and keeps the installed window from
 * ever opening blank.
 *
 * Browsers require a service worker with a fetch handler before they will offer
 * "Install app". This app is a live editor whose bundles change on every deploy,
 * so caching the shell would hand users a stale editor — a worse failure than a
 * retry. The strategy is therefore network-first for app shells, with a
 * navigation fallback that has no equivalent in a bare passthrough.
 *
 * Why the fallback exists: `respondWith(fetch(request))` makes the worker
 * responsible for the DOCUMENT request of the installed window. If that fetch
 * fails or is aborted (offline, server restart, a tunnel hiccup), a bare
 * passthrough rejects and the window commits an error — reported by users as
 * "the installed app shows a blank page", with no reload affordance because
 * there is no browser chrome. Answering with a real error document instead
 * turns a dead window into something the user can retry.
 */

self.addEventListener('install', (event) => {
  // Take over as soon as the new worker is ready; there is no cache to migrate.
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Minimal, dependency-free retry page. Inline CSS: no network fetch at all. */
const OFFLINE_DOCUMENT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>AfterFrame — reconnecting</title>
<style>
:root{color-scheme:dark}
html,body{margin:0;height:100%}
body{display:grid;place-items:center;background:#000;color:#f2f2f6;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;text-align:center;padding:24px}
h1{margin:0 0 8px;font-size:17px;font-weight:650;letter-spacing:-.2px}
p{margin:0 0 20px;font-size:13.5px;line-height:1.6;color:#8a8a99;max-width:34ch}
button{appearance:none;border:0;cursor:pointer;padding:11px 22px;border-radius:11px;
font:inherit;font-size:14px;font-weight:600;color:#fff;
background:linear-gradient(135deg,#ec4899,#9333ea 55%,#3b82f6)}
</style></head>
<body><div>
<h1>Could not reach AfterFrame</h1>
<p>The editor needs a connection. Check your network, then try again.</p>
<button onclick="location.reload()">Retry</button>
</div></body></html>`;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only navigations need the fallback. Everything else (bundles, /api, media)
  // passes through untouched, so the worker never becomes an API layer.
  if (request.mode !== 'navigate') {
    event.respondWith(fetch(request));
    return;
  }
  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      return new Response(OFFLINE_DOCUMENT, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  })());
});
