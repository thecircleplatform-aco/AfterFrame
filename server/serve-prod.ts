/**
 * Production entry point for a self-hosted box (VPS / Docker).
 *
 * The same server the Electron build runs: `startEmbeddedServer(dist)` mounts
 * every `/api/*` plugin from `server/plugins`, serves `dist/` as static, and
 * streams `/media/uploads`. It binds 127.0.0.1 on purpose, so a reverse proxy
 * (Caddy/nginx) terminates TLS in front of it.
 *
 * Build:  npm run build:server
 * Run:    node server-dist/serve-prod.mjs
 */
import { resolve } from 'node:path';
import { startEmbeddedServer } from '../desktop/embedded-server.ts';

const distDir = resolve(process.cwd(), process.env.AFTERFRAME_DIST ?? 'dist');

// Free hosted deployment: all encoding happens in the visitor's browser. Rendering
// on this box would turn every export into our CPU bill, which a free product
// cannot absorb. Unset this (or set "on") if you run a paid render box.
process.env.AFTERFRAME_SERVER_EXPORT ??= 'off';

const { server, port, origin } = await startEmbeddedServer(distDir);

process.stdout.write(`afterframe: serving ${distDir} on ${origin} (port ${port})\n`);

const shutdown = (signal: string): void => {
  process.stdout.write(`afterframe: ${signal}, closing\n`);
  server.close(() => process.exit(0));
  // Hard stop if a long-lived export/transcode refuses to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
