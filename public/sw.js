/**
 * Service worker: exists so the app is installable, and does nothing else.
 *
 * Browsers require a service worker with a fetch handler before they will offer
 * "Install app", but this app is a live editor whose bundles change on every
 * deploy — caching them would hand users a stale editor after an update, which is
 * a much worse failure than an offline error page. So: pass every request
 * straight to the network, cache nothing, and let the browser keep the shell it
 * already has in its HTTP cache.
 */

self.addEventListener('install', (event) => {
  // Take over as soon as the new worker is ready; there is no cache to migrate.
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-only. `respondWith` is what makes the worker count as a fetch handler.
  event.respondWith(fetch(event.request));
});
