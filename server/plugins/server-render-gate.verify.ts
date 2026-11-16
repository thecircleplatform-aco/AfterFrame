// Afterframe is free, so a hosted box must never spend its CPU on rendering a
// user's video: the browser has WebCodecs (see src/export/browserExport.ts) and
// src/export/exportRoutePlanner.ts already prefers that route. This pins the
// middleware that makes a hosted deployment refuse the expensive routes, and
// pins the cheap routes the browser path depends on so a future refactor does
// not accidentally take the download path away with it.
// Run: npx tsx server/plugins/server-render-gate.verify.ts
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { serverRenderGatePlugin } from './server-render-gate.ts';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;

/** Drive the plugin's middleware the way Vite would, and report what it did. */
function call(method: string, url: string, options: { enabled: boolean; stills?: boolean } = { enabled: true }) {
  if (options.enabled) process.env.AFTERFRAME_SERVER_EXPORT = 'off';
  else delete process.env.AFTERFRAME_SERVER_EXPORT;
  if (options.stills) process.env.AFTERFRAME_SERVER_STILLS = 'on';
  else delete process.env.AFTERFRAME_SERVER_STILLS;

  const plugin = serverRenderGatePlugin() as Plugin & {
    configureServer: (server: unknown) => void;
  };
  const middlewares: Middleware[] = [];
  plugin.configureServer({
    middlewares: { use: (handler: Middleware) => middlewares.push(handler) },
    config: { logger: { info: () => {} } },
  });

  let status: number | null = null;
  let body = '';
  let passedThrough = false;
  const res = {
    set statusCode(value: number) { status = value; },
    get statusCode() { return status ?? 200; },
    setHeader: () => {},
    end: (chunk?: string) => { body = chunk ?? ''; },
    headersSent: false,
  } as unknown as ServerResponse;

  for (const handler of middlewares) {
    handler({ method, url } as IncomingMessage, res, () => { passedThrough = true; });
  }
  // No middleware at all means the gate is inactive, which is a pass-through.
  if (!middlewares.length) passedThrough = true;
  return { status: passedThrough ? null : status, body, passedThrough };
}

// ── 1. Rendering routes are refused, with a message a user can act on ───────
for (const [method, url] of [
  ['POST', '/export/job'],
  ['POST', '/export/job/render-123'],
  ['GET', '/export/job/render-123'],
  ['DELETE', '/export/job/render-123'],
  ['POST', '/export/job/render-123/promote'],
  ['POST', '/export'],
  ['POST', '/render-clip'],
  ['POST', '/api/export-qa'],
  ['POST', '/render-still'],
] as const) {
  const result = call(method, url);
  assert.equal(result.passedThrough, false, `${method} ${url} must not reach the renderer`);
  assert.equal(result.status, 501, `${method} ${url} must answer 501`);
  const payload = JSON.parse(result.body) as { code: string; route: string; error: string };
  assert.equal(payload.code, 'server-render-disabled');
  assert.equal(payload.route, 'browser', 'the client is told which route to use instead');
  assert.match(payload.error, /browser/);
}

// ── 2. The browser export path keeps the endpoints it needs ────────────────
for (const [method, url] of [
  ['GET', '/'],
  ['POST', '/export/stage?name=clip.mp4'],
  ['GET', '/export/stage/stage-abc.mp4'],
  ['DELETE', '/export/stage/stage-abc.mp4'],
  ['GET', '/export/capabilities'],
  ['GET', '/export-destinations'],
  ['PUT', '/api/export-destinations'],
  ['POST', '/api/export-media-sources'],
  ['GET', '/api/project-store/health'],
] as const) {
  const result = call(method, url);
  assert.equal(result.passedThrough, true, `${method} ${url} is cheap and must still work`);
}

// ── 3. Query strings and trailing slashes cannot smuggle a render through ──
assert.equal(call('POST', '/export/job?x=1').status, 501);
assert.equal(call('POST', '/export/job/').status, 501);
assert.equal(call('POST', '/export/').status, 501, 'a trailing slash is still the submission route');
assert.equal(call('GET', '/export').passedThrough, true, 'a bare GET is not a submission');

// ── 4. Desktop/dev behaviour is untouched when the flag is absent ──────────
assert.equal(call('POST', '/export/job', { enabled: false }).passedThrough, true);
assert.equal(call('POST', '/render-clip', { enabled: false }).passedThrough, true);
assert.equal(call('POST', '/render-still', { enabled: false }).passedThrough, true);

// ── 5. Posters can be opted back in without re-enabling video renders ──────
assert.equal(call('POST', '/render-still', { enabled: true, stills: true }).passedThrough, true);
assert.equal(call('POST', '/render-clip', { enabled: true, stills: true }).status, 501,
  'the stills opt-in must not unlock full renders');

delete process.env.AFTERFRAME_SERVER_EXPORT;
delete process.env.AFTERFRAME_SERVER_STILLS;
console.log('server-render-gate.verify: ok (render routes refused, browser path intact)');
