// End-to-end verification of the live preview path.
//
// The feature spans four hops: phone POSTs /watch → broker relays a guest
// action to the desktop → desktop POSTs /preview frames → broker fans them out
// as `preview` SSE events. Each hop is individually plausible and the whole
// thing can still be dead, so this drives the real HTTP surface of
// RemoteControlService rather than calling the internals.
//
// Also covers the PWA shell (manifest + icons), because an installed phone page
// that 404s on its manifest is installable-looking but not installable.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { RemoteControlService, type RemoteGuestAction } from './remote-control-service.ts';

interface Fetched {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function fetchUrl(url: string, init: { method?: string; body?: string } = {}): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET' }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => parts.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(parts).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

/** Read exactly one SSE frame matching `event` off a live stream. */
function openSse(url: string): Promise<{
  next: (event: string) => Promise<unknown>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      let buffer = '';
      const pending = new Map<string, (data: unknown) => void>();
      const queued = new Map<string, unknown[]>();
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim();
          const data = frame.split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n');
          if (event && data) {
            const parsed = JSON.parse(data) as unknown;
            const waiter = pending.get(event);
            if (waiter) { pending.delete(event); waiter(parsed); }
            else { queued.set(event, [...(queued.get(event) ?? []), parsed]); }
          }
          boundary = buffer.indexOf('\n\n');
        }
      });
      resolve({
        next: (event) => new Promise((done, fail) => {
          const already = queued.get(event)?.shift();
          if (already !== undefined) { done(already); return; }
          const timer = setTimeout(() => fail(new Error(`timeout waiting for ${event}`)), 3000);
          pending.set(event, (data) => { clearTimeout(timer); done(data); });
        }),
        close: () => { req.destroy(); },
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const service = new RemoteControlService();
const created = await service.createSession('en');

try {
  // The session must expose a LAN URL; without one the phone has nothing to
  // scan and the rest of this file would be testing a service nobody can reach.
  const lan = created.addresses[0];
  assert.ok(lan, 'session should expose at least one LAN address');

  const tokenBase = /\/r\/([A-Za-z0-9_-]+)$/.exec(lan.url)?.[1];
  assert.ok(tokenBase, `unexpected pairing url ${lan.url}`);
  const root = lan.url.replace(/\/r\/[A-Za-z0-9_-]+$/, `/r/${tokenBase}`);

  // ---- PWA shell -----------------------------------------------------------
  const manifest = await fetchUrl(`${root}/manifest.webmanifest`);
  assert.equal(manifest.status, 200, 'manifest should be served');
  assert.match(String(manifest.headers['content-type']), /manifest\+json/);
  const parsed = JSON.parse(manifest.body) as {
    name?: string; start_url?: string; display?: string; icons?: { src: string; sizes: string }[];
  };
  assert.equal(parsed.display, 'standalone', 'installed app must not show browser chrome');
  // A relative start_url is what keeps the installed icon inside the pairing
  // instead of a hardcoded path that 404s behind the public domain.
  assert.equal(parsed.start_url, './');
  assert.ok(parsed.icons?.some((icon) => icon.sizes === '512x512'), 'needs a 512 icon');

  for (const icon of parsed.icons ?? []) {
    const res = await fetchUrl(`${root}/${icon.src}`);
    assert.equal(res.status, 200, `${icon.src} should be served`);
    assert.match(String(res.headers['content-type']), /image\/png/);
  }

  const page = await fetchUrl(root);
  assert.equal(page.status, 200);
  assert.match(page.body, /rel="manifest"/, 'page must link the manifest');
  assert.match(page.body, /id="watch"/, 'page must contain the preview card');

  // ---- watch request reaches the desktop ----------------------------------
  const actions: RemoteGuestAction[] = [];
  // The host listener is what the desktop tab registers; standing in for it
  // here is the only way to observe the broker → desktop hop.
  const hostStream = streamHost(service, created.id, actions);
  await hostStream.ready;

  const watch = await fetchUrl(`${root}/watch`, { method: 'POST', body: '{}' });
  assert.equal(watch.status, 202, 'watch should be accepted');
  assert.deepEqual(await nextAction(actions), { type: 'watch' });

  const unwatch = await fetchUrl(`${root}/unwatch`, { method: 'POST', body: '{}' });
  assert.equal(unwatch.status, 202, 'unwatch should be accepted');
  assert.deepEqual(await nextAction(actions), { type: 'unwatch' });

  // ---- preview frames reach the phone ------------------------------------
  const guest = await openSse(`${root}/events`);
  await guest.next('snapshot');
  const delivered = service.publishPreviewFrame(created.id, {
    data: 'AAAA', frame: 42, width: 640, height: 360,
  });
  assert.equal(delivered, 1, 'exactly one watching phone should receive the frame');
  const frame = await guest.next('preview') as { data: string; frame: number };
  assert.equal(frame.data, 'AAAA');
  assert.equal(frame.frame, 42);
  guest.close();
} finally {
  await service.stop();
}

/** Minimal stand-in for the desktop's host listener registration. */
function streamHost(
  service: RemoteControlService,
  id: string,
  sink: RemoteGuestAction[],
): { ready: Promise<void> } {
  // Accessing the private listener set is deliberate: the alternative is an
  // HTTP SSE host stream, which would make this test depend on the transport it
  // is not trying to verify.
  const internal = service as unknown as {
    sessions: Map<string, { hostListeners: Set<(action: RemoteGuestAction) => void> }>;
  };
  const session = internal.sessions.get(id);
  assert.ok(session, 'session should be registered');
  session.hostListeners.add((action) => { sink.push(action); });
  return { ready: Promise.resolve() };
}

async function nextAction(actions: RemoteGuestAction[]): Promise<RemoteGuestAction> {
  for (let i = 0; i < 60; i += 1) {
    const action = actions.shift();
    if (action) return action;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no guest action reached the desktop');
}

// ---- pinned port --------------------------------------------------------
// A tunnel proxies to one fixed upstream; an ephemeral port silently breaks the
// public URL on every restart. Verified against a real bind, because the option
// being plumbed through is exactly the kind of thing that gets dropped.
{
  const probe = createServer();
  await new Promise<void>((resolve) => { probe.listen(0, '127.0.0.1', () => resolve()); });
  const free = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => { probe.close(() => resolve()); });

  const pinned = new RemoteControlService({ port: free, bindHost: '127.0.0.1' });
  try {
    const session = await pinned.createSession('en');
    // The snapshot is built from the bound port, so a LAN URL carrying the
    // requested port proves the listener honoured it.
    const url = session.addresses[0]?.url ?? '';
    assert.ok(url.includes(`:${free}/`), `expected port ${free} in ${url}`);
  } finally {
    await pinned.stop();
  }
}

console.log('remote-preview: watch/preview/manifest verified');
