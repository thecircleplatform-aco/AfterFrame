import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { editorCredentialAuthorized, trustedEditorRequest } from '../editor-auth.ts';
import {
  RemoteControlService,
  type RemotePageLocale,
  type RemotePreviewFrame,
  type RemoteSnapshot,
} from '../remote-control-service.ts';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function pageLocale(value: unknown): RemotePageLocale {
  return value === 'zh' || value === 'en' || value === 'it' || value === 'ru' || value === 'ko' || value === 'th'
    ? value
    : 'en';
}

function readBody(req: IncomingMessage, limit = 512 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/**
 * Validate a preview frame from the desktop tab.
 *
 * `data` must be PURE base64 (no `data:` prefix, no newlines) — the phone builds
 * a `data:image/jpeg;base64,` URL from it, and anything else would either
 * produce a broken image or, worse, a crafted string that survives into an
 * attribute. The size cap keeps one oversized frame from blocking the stream.
 */
const MAX_PREVIEW_BYTES = 512 * 1024;

function normalizePreviewFrame(value: unknown): RemotePreviewFrame | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { data?: unknown; frame?: unknown; width?: unknown; height?: unknown };
  if (typeof source.data !== 'string' || !source.data) return null;
  if (source.data.length > MAX_PREVIEW_BYTES) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(source.data)) return null;
  const frame = typeof source.frame === 'number' && Number.isFinite(source.frame) ? Math.round(source.frame) : 0;
  const width = typeof source.width === 'number' && Number.isFinite(source.width) ? Math.round(source.width) : 0;
  const height = typeof source.height === 'number' && Number.isFinite(source.height) ? Math.round(source.height) : 0;
  return { data: source.data, frame, width, height };
}

function normalizeSnapshot(value: unknown): RemoteSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { running?: unknown; liveTool?: unknown; messages?: unknown; projectName?: unknown; previewLive?: unknown };
  if (typeof source.running !== 'boolean' || !Array.isArray(source.messages)) return null;
  const messages = source.messages.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as { role?: unknown; text?: unknown; detail?: unknown };
    if (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'tool') return [];
    if (typeof item.text !== 'string') return [];
    return [{
      role: item.role,
      text: item.text,
      ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
    } as const];
  });
  return {
    running: source.running,
    liveTool: typeof source.liveTool === 'string' ? source.liveTool : null,
    messages,
    ...(typeof source.projectName === 'string' ? { projectName: source.projectName } : {}),
    ...(source.previewLive === true ? { previewLive: true } : {}),
  };
}

/**
 * The desktop half of LAN remote control. Every route here is loopback-only —
 * the phone never touches `/api/remote-control`; it talks to the tokenized
 * listener inside RemoteControlService, which forwards only text. Keeping the
 * control plane off the LAN is what stops a paired phone from minting new
 * sessions or publishing fake transcripts.
 */
export async function handleRemoteControl(
  req: IncomingMessage,
  res: ServerResponse,
  service: RemoteControlService,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'POST' && path === '/sessions') {
    if (!editorCredentialAuthorized(req, true)) { req.resume(); sendJson(res, 401, { error: 'editor credential required' }); return; }
    try {
      const body = await readBody(req) as { locale?: unknown };
      sendJson(res, 201, await service.createSession(pageLocale(body.locale)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, /no LAN IPv4/i.test(message) ? 503 : 400, { error: message });
    }
    return;
  }

  const match = /^\/sessions\/([0-9a-f-]{36})(?:\/(host|publish|preview))?$/.exec(path);
  if (!match) { sendJson(res, 404, { error: 'not found' }); return; }
  const [, id, action] = match;

  if (!action && req.method === 'GET') {
    if (!trustedEditorRequest(req, false)) { req.resume(); sendJson(res, 403, { error: 'untrusted editor request' }); return; }
    const snapshot = service.getSession(id!);
    sendJson(res, snapshot ? 200 : 404, snapshot ?? { error: 'session not found' });
    return;
  }

  if (!action && req.method === 'DELETE') {
    if (!editorCredentialAuthorized(req, true)) { req.resume(); sendJson(res, 401, { error: 'editor credential required' }); return; }
    await service.closeSession(id!);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'host' && req.method === 'GET') {
    if (!trustedEditorRequest(req, false)) { req.resume(); sendJson(res, 403, { error: 'untrusted editor request' }); return; }
    service.attachHost(id!, res);
    return;
  }

  if (action === 'publish' && req.method === 'POST') {
    if (!editorCredentialAuthorized(req, true)) { req.resume(); sendJson(res, 401, { error: 'editor credential required' }); return; }
    try {
      const body = await readBody(req) as { snapshot?: unknown };
      const snapshot = normalizeSnapshot(body.snapshot);
      if (!snapshot) { sendJson(res, 400, { error: 'invalid snapshot' }); return; }
      if (!service.publish(id!, snapshot)) { sendJson(res, 404, { error: 'session not found' }); return; }
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (action === 'preview' && req.method === 'POST') {
    if (!editorCredentialAuthorized(req, true)) { req.resume(); sendJson(res, 401, { error: 'editor credential required' }); return; }
    try {
      const body = await readBody(req) as { frame?: unknown };
      const frame = normalizePreviewFrame(body.frame);
      if (!frame) { sendJson(res, 400, { error: 'invalid preview frame' }); return; }
      // Let the desktop decide whether it still has an audience: a zero count
      // means every phone left, so it can stop capturing instead of burning CPU
      // encoding frames nobody will see.
      const delivered = service.publishPreviewFrame(id!, frame);
      sendJson(res, 200, { delivered });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

export function remoteControlPlugin(): Plugin {
  return {
    name: 'afterframe-remote-control',
    configureServer(server) {
      // REMOTE_PUBLIC_ORIGIN is the tunnel's public HTTPS origin (e.g.
      // https://remote.af.acocloud.app). The tunnel forwards to this same LAN
      // listener, so nothing else changes — the phone simply has a second, public
      // route to the identical tokenised broker. Unset = LAN-only, as before.
      const publicOrigin = process.env.REMOTE_PUBLIC_ORIGIN || process.env.VITE_REMOTE_PUBLIC_ORIGIN || '';
      // A tunnel proxies to one fixed upstream, so the public origin only works
      // if the listener stops hopping ports. Unset keeps the ephemeral port that
      // LAN-only pairing relies on.
      const pinned = Number.parseInt(process.env.LOCAL_REMOTE_PORT ?? '', 10);
      const service = new RemoteControlService({
        publicOrigin,
        ...(Number.isFinite(pinned) && pinned > 0 ? { port: pinned } : {}),
        log: (message) => server.config.logger.warn(message),
      });
      server.httpServer?.once('close', () => { void service.stop(); });
      server.middlewares.use('/api/remote-control', (req: IncomingMessage, res: ServerResponse) => {
        void handleRemoteControl(req, res, service);
      });
    },
  };
}
