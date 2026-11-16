import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * Refuses CPU-heavy server-side rendering on hosted deployments.
 *
 * Afterframe is free, so the box it runs on has to stay cheap. Encoding a video
 * is the only thing in this app that can pin a CPU for minutes at a time, and a
 * free product cannot pay for that per user. The browser already has everything
 * it needs (`src/export/browserExport.ts` drives WebCodecs through mediabunny, and
 * `src/export/exportRoutePlanner.ts` prefers that route), so a hosted deployment
 * sets `AFTERFRAME_SERVER_EXPORT=off` and these routes stop rendering entirely:
 * the request fails fast with a 501 that says so, instead of quietly burning a
 * core for five minutes.
 *
 * Cheap endpoints stay available because the browser path depends on them:
 * - `/export/stage` moves a finished browser-encoded file to disk for download
 * - `/export/capabilities` lets the client inspect what the box can do
 * - `/api/export-destinations`, `/api/export-media-sources` are metadata only
 *
 * Unset the flag (the Electron/desktop build does) and every route behaves
 * exactly as before.
 */

const DISABLED_MESSAGE =
  'Server-side rendering is disabled on this deployment. Export runs in your browser instead — '
  + 'open the project in a Chromium-based browser or Safari and export again.';

/** Paths that actually run a renderer, a muxer or an ffmpeg analysis pass. */
const RENDER_PATHS = [
  '/render-clip',
  '/api/export-qa',
];

/**
 * Single-frame stills are the one render that is arguably worth paying for: they
 * back dashboard project posters and the agent's visual checks. They are still
 * off by default on a hosted box because each one spawns a browser, but an
 * operator who wants posters back can set `AFTERFRAME_SERVER_STILLS=on`.
 */
const STILL_PATHS = ['/render-still'];

/** Paths that own a whole subtree of render-job bookkeeping. */
const RENDER_PREFIXES = [
  '/export/job',
];

/** `/export` exactly is the submission endpoint; `/export/...` children are not. */
const EXACT_RENDER_PATHS = [
  '/export',
];

function normalisePath(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] ?? '/';
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function isRenderRequest(method: string | undefined, path: string): boolean {
  if (STILL_PATHS.includes(path)) return !stillsAllowed();
  if (RENDER_PATHS.includes(path)) return true;
  if (EXACT_RENDER_PATHS.includes(path)) return method !== 'GET' && method !== 'HEAD';
  return RENDER_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function sendDisabled(res: ServerResponse): void {
  res.statusCode = 501;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    error: DISABLED_MESSAGE,
    code: 'server-render-disabled',
    route: 'browser',
  }));
}

/** True when this process must not render anything for the caller. */
export function serverRenderDisabled(): boolean {
  return process.env.AFTERFRAME_SERVER_EXPORT === 'off';
}

/** True when the operator opted back in to single-frame renders. */
export function stillsAllowed(): boolean {
  return process.env.AFTERFRAME_SERVER_STILLS === 'on';
}

export function serverRenderGatePlugin(): Plugin {
  return {
    name: 'afterframe-server-render-gate',
    configureServer(server) {
      if (!serverRenderDisabled()) return;
      server.config.logger.info('[render-gate] server-side rendering is off; exports run in the browser');
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
        const path = normalisePath(req.url);
        if (!isRenderRequest(req.method, path)) {
          next();
          return;
        }
        server.config.logger.info(`[render-gate] refused ${req.method ?? 'GET'} ${path}`);
        sendDisabled(res);
      });
    },
  };
}
