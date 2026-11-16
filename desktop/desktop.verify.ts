// :env  round-tripmini-connect (
// ) MIME:npx tsx desktop/desktop.check.ts( npm test )
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App, BrowserWindow } from 'electron';
import { parseEnvText } from './env-file.ts';
import { createMiniConnect, matchRoute, rewriteUrl } from './mini-connect.ts';
import { staticMime } from './static-files.ts';
import {
  applyWindowsGpuCrashFallback,
  installWindowsGpuCrashRecovery,
  installWindowsRendererRecovery,
} from './window-recovery.ts';

// ── env-file ────────────────────────────────────────────────────────────
{
  const env = parseEnvText([
    'LLM_API_KEY=sk-plain',
    'A_QUOTED="v#1"',
    "B_SINGLE='x y'",
    'C_COMMENT=val # trailing note',
    'D_EMPTY=',
    '# \u6574\u884c\u6ce8\u91ca',
    'not a kv line',
    '  E_SPACED =  padded  ',
  ].join('\n'));
  assert.equal(env.LLM_API_KEY, 'sk-plain');
  assert.equal(env.A_QUOTED, 'v#1', '\u6210\u5bf9\u5f15\u53f7\u5265\u79bb,\u5185\u90e8 # \u4fdd\u7559');
  assert.equal(env.B_SINGLE, 'x y');
  assert.equal(env.C_COMMENT, 'val', '\u672a\u5f15\u53f7\u503c\u622a\u65ad\u4e8e #');
  assert.ok(!('D_EMPTY' in env), '\u7a7a\u503c\u4e0d\u5165 seed');
  assert.equal(env.E_SPACED, 'padded');
  console.log('env-file parse: OK');
}

// ── mini-connect  ────────────────────────────────────────────────
{
  assert.equal(matchRoute('/export', '/export'), '/');
  assert.equal(matchRoute('/export', '/export/job'), '/job', '\u6574\u6bb5\u524d\u7f00\u547d\u4e2d');
  assert.equal(matchRoute('/export', '/exportx'), null, '\u975e\u6bb5\u754c\u4e0d\u547d\u4e2d');
  assert.equal(matchRoute('/', '/anything'), '/anything');
  assert.equal(rewriteUrl('/export/job?a=1', '/export/job'), '/?a=1', 'query \u4fdd\u7559');
  assert.equal(rewriteUrl('/upload?name=x', '/upload'), '/?name=x');
  assert.equal(rewriteUrl('/media/uploads/%E4%B8%AD.mp4', '/media/uploads'), '/%E4%B8%AD.mp4');
  console.log('mini-connect match/rewrite: OK');
}

// ── mini-connect :next url /404 500 ──────
type FakeRes = ServerResponse & { statusCode: number; body: string; ended: boolean };
function fakeRes(): FakeRes {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0, body: '', ended: false, headersSent: false, writableEnded: false,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    writeHead(code: number) { res.statusCode = code; (res as { headersSent: boolean }).headersSent = true; return res; },
    end(chunk?: string) { res.ended = true; (res as { writableEnded: boolean }).writableEnded = true; if (chunk) res.body += chunk; },
    on: () => res,
  };
  return res as unknown as FakeRes;
}
function fakeReq(url: string): IncomingMessage {
  return { url, method: 'GET', headers: {} } as unknown as IncomingMessage;
}

async function tick(): Promise<void> { await new Promise((r) => setTimeout(r, 0)); }

{
  const errors: unknown[] = [];
  const app = createMiniConnect((e) => errors.push(e));
  const seen: string[] = [];
  app.use('/a', (req, _res, next) => { seen.push(`a:${req.url}`); next(); });
  app.use('/a/b', (req, _res, next) => { seen.push(`ab:${req.url}`); next(); });
  app.use((req, res) => { seen.push(`root:${req.url}`); res.writeHead(200); res.end('done'); });

  const res = fakeRes();
  app.handle(fakeReq('/a/b/c?q=1'), res);
  assert.deepEqual(seen, ['a:/b/c?q=1', 'ab:/c?q=1', 'root:/a/b/c?q=1'], '\u9010\u5c42\u91cd\u5199,\u515c\u5e95\u5c42\u89c1\u539f url');
  assert.equal(res.statusCode, 200);

  const res404 = fakeRes();
  const app2 = createMiniConnect(() => {});
  app2.use('/only', (_req, res2) => { res2.writeHead(200); res2.end(); });
  app2.handle(fakeReq('/other'), res404);
  assert.equal(res404.statusCode, 404, '\u65e0\u547d\u4e2d → 404');

  const res500 = fakeRes();
  const app3 = createMiniConnect((e) => errors.push(e));
  app3.use('/boom', async () => { throw new Error('kaput'); });
  app3.handle(fakeReq('/boom'), res500);
  await tick();
  assert.equal(res500.statusCode, 500, '\u5f02\u6b65\u62d2\u7edd → 500');
  assert.match(res500.body, /kaput/);
  assert.equal(errors.length, 1);
  console.log('mini-connect dispatch: OK');
}

// ── staticMime ──────────────────────────────────────────────────────────
{
  assert.equal(staticMime('index.html'), 'text/html; charset=utf-8');
  assert.equal(staticMime('app.js'), 'text/javascript', 'ES module \u4e25\u683c MIME');
  assert.equal(staticMime('style.css'), 'text/css');
  assert.equal(staticMime('font.woff2'), 'font/woff2');
  assert.equal(staticMime('lut.cube'), 'text/plain; charset=utf-8');
  assert.equal(staticMime('clip.mp4'), 'video/mp4', '\u5a92\u4f53\u8d70 media-dir \u8868');
  console.log('staticMime: OK');
}

// Editor windows must keep their MCP bridge heartbeat alive while in the
// background: Electron throttles background timers by default, which drops
// the long-poll touch cadence below the 35s online lease and leaves the
// editor registered but connected:false (issue #86).
{
  const main = await readFile(new URL('./main.ts', import.meta.url), 'utf8');
  const prefs = main.match(/webPreferences:\s*\{[\s\S]*?\}/g) ?? [];
  assert.ok(prefs.length >= 2, 'main and transcript windows define webPreferences');
  for (const block of prefs) {
    assert.match(block, /backgroundThrottling:\s*false/, 'every editor webPreferences keeps the bridge heartbeat running in the background');
  }
  assert.match(main, /if \(!hasSingleInstanceLock\)\s*\{\s*app\.quit\(\);\s*\}\s*else\s*\{\s*applyWindowsGpuCrashFallback\(app\);/,
    'GPU fallback runs only after profile selection and successful single-instance acquisition');
  assert.match(main, /webContents\.on\('did-finish-load',[\s\S]*?TRANSCRIPT_WINDOW_CHANNELS\.update, transcriptPayload/,
    'every floating-window load receives its latest transcript payload');
}

// Windows keeps the current GPU-fast path, but a real child/renderer crash
// repaints the window and makes the next launch use software rendering once.
{
  const userData = await mkdtemp(join(tmpdir(), 'afterframe-gpu-recovery-'));
  const appEvents = new EventEmitter();
  let hardwareDisabled = 0;
  const fakeApp = {
    disableHardwareAcceleration: () => { hardwareDisabled += 1; },
    getPath: () => userData,
    on: appEvents.on.bind(appEvents),
    off: appEvents.off.bind(appEvents),
  } as unknown as App;
  const windowEvents = new EventEmitter();
  let reloads = 0;
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: Object.assign(windowEvents, { reload: () => { reloads += 1; } }),
  } as unknown as BrowserWindow;
  const uninstallGpu = installWindowsGpuCrashRecovery(fakeApp, () => [fakeWindow], 'win32');
  appEvents.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit', exitCode: 0 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(reloads, 0, 'normal GPU termination does not reload windows');
  assert.equal(applyWindowsGpuCrashFallback(fakeApp, 'win32'), false, 'normal GPU termination leaves no fallback marker');
  appEvents.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 7 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(reloads, 1, 'GPU loss repaints the open editor');
  uninstallGpu();
  assert.equal(applyWindowsGpuCrashFallback(fakeApp, 'win32'), true);
  assert.equal(hardwareDisabled, 1, 'the launch after a GPU crash uses software rendering');
  assert.equal(applyWindowsGpuCrashFallback(fakeApp, 'win32'), false, 'fallback applies for one session');

  const rendererEvents = new EventEmitter();
  let rendererReloads = 0;
  const rendererWindow = {
    isDestroyed: () => false,
    webContents: Object.assign(rendererEvents, { reload: () => { rendererReloads += 1; } }),
  } as unknown as BrowserWindow;
  const uninstallRenderer = installWindowsRendererRecovery(rendererWindow, 'win32');
  rendererEvents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  rendererEvents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(rendererReloads, 1, 'renderer OOM reloads into a fresh process');
  uninstallRenderer();

  // The disposer runs from the window's own 'closed' handler, when the window
  // is already destroyed and Electron's webContents getter THROWS. v0.2.12
  // shipped this as an uncaught main-process exception — a modal error dialog
  // on every Windows window close. The fake reproduces the real getter
  // semantics: accessing webContents on a destroyed window must never be
  // reached by the disposer.
  {
    let destroyed = false;
    const destroyedWindow = {
      isDestroyed: () => destroyed,
      get webContents() {
        if (destroyed) throw new TypeError('Object has been destroyed');
        return Object.assign(new EventEmitter(), { reload: () => undefined });
      },
    } as unknown as BrowserWindow;
    const uninstall = installWindowsRendererRecovery(destroyedWindow, 'win32');
    destroyed = true;
    assert.doesNotThrow(uninstall, 'disposing recovery on a closed window must not touch its webContents');
  }
  await rm(userData, { recursive: true, force: true });
}

console.log('\ndesktop.check: ALL PASSED');
