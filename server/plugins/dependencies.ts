// /api/deps — runtime dependency inspection and (approved) provisioning.
//
// Two routes, deliberately narrow:
//   GET  /api/deps            → reports
//   POST /api/deps/install    → { id } runs the pinned installer for that id
//
// The POST is a mutating local action, so the CLIENT is responsible for
// obtaining user consent before calling it; the server refuses to guess. It also
// refuses any id without a registered installer, which is what keeps this from
// being a generic command runner.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  canInstall, inspectDependencies, installDependency, isDependencyId,
} from '../dependencies.ts';

const MAX_BODY_BYTES = 8 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/' || path === '') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      sendJson(res, 200, { dependencies: await inspectDependencies() });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (path === '/install') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const body = await readJson(req);
    if (!body) { sendJson(res, 400, { error: 'body must be a JSON object' }); return; }
    const id = body.id;
    if (!isDependencyId(id)) { sendJson(res, 400, { error: 'unknown dependency id' }); return; }
    if (!canInstall(id)) {
      sendJson(res, 409, { error: `"${id}" has no automatic installer; it must be provisioned another way` });
      return;
    }
    // Re-inspect first: installing something already present wastes a long
    // download and can overwrite a working binary with a failed build.
    const report = (await inspectDependencies()).find((entry) => entry.id === id);
    if (report?.status === 'ready') {
      sendJson(res, 200, { ok: true, id, already: true, output: '' });
      return;
    }
    const result = await installDependency(id);
    sendJson(res, result.ok ? 200 : 500, result);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

export function dependenciesPlugin(): Plugin {
  return {
    name: 'afterframe-dependencies',
    configureServer(server) {
      server.middlewares.use('/api/deps', (req: IncomingMessage, res: ServerResponse) => {
        void handle(req, res);
      });
    },
  };
}
