/**
 * Headless host: serves ONLY the HTTP API (no UI, no bundler for the client).
 *
 * This is the "agent as a service" shape — the editor, a script, or curl can
 * drive it. It boots the same plugin list the UI build uses by embedding Vite in
 * middleware mode, so the route implementations are byte-identical to the app.
 *
 *   npm run headless            # 127.0.0.1:5199
 *   PORT=6000 npm run headless
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';

const port = Number(process.env.PORT ?? 5199);
const host = process.env.HOST ?? '127.0.0.1';

const vite = await createViteServer({
  root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  configFile: new URL('../vite.config.mts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'warn',
});

// `vite.middlewares` is the same connect stack the dev/embedded hosts use, so
// /api/agent-runs/** behaves exactly as it does inside the editor.
const server = createHttpServer(vite.middlewares);

server.listen(port, host, () => {
  console.log(`[agent-standalone] headless API on http://${host}:${port}`);
  console.log('  POST   /api/agent-runs/                     create + admit a run');
  console.log('  POST   /api/agent-runs/:id/start            begin execution');
  console.log('  GET    /api/agent-runs/:id/events?...       SSE stream');
  console.log('  POST   /api/agent-runs/:id/tool-claim       claim a tool request');
  console.log('  POST   /api/agent-runs/:id/tool-result      settle a tool call');
  console.log('  POST   /api/agent-runs/:id/cancel           stop');
  console.log('  GET    /api/agent-runs/:id?projectId=...    metadata / recovery');
});

const shutdown = async (): Promise<void> => {
  server.close();
  await vite.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
