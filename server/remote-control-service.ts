// LAN remote control: a phone scans a QR, joins the same network as this
// machine, and drives the running editor's Agent.
//
// Two channels, deliberately asymmetric:
//   guest (phone, token in the URL)  → POST prompt / stop / image, GET SSE mirror
//   host  (desktop tab, loopback)    → GET SSE actions, POST publish
//
// The desktop tab stays the ONLY executor. Tools run against the live project
// document, which only the tab owns, so the phone must never be handed a run
// capability and must never reach /api/agent-runs. It sees text and sends text
// and images; nothing else crosses the LAN. That is why this service is a
// broker, not a second agent host.
//
// The LAN listener is created on demand and closed when the last session ends,
// so with no pairing open there is no socket bound to 0.0.0.0 at all.
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { deflateSync } from 'node:zlib';
import { uploadDir } from './media-dir.ts';

const DEFAULT_SESSION_TTL_MS = 45 * 60_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const KEEPALIVE_MS = 20_000;
const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 6_000;

export interface RemoteMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly text: string;
  /** Tool rows only: the human-readable outcome of the call. */
  readonly detail?: string;
}

export interface RemoteSnapshot {
  readonly running: boolean;
  readonly liveTool: string | null;
  readonly messages: RemoteMessage[];
  readonly projectName?: string;
  /**
   * Set by the desktop tab while it is pushing preview frames. The phone uses it
   * to show/hide the live preview card without guessing.
   */
  readonly previewLive?: boolean;
}

export interface RemoteAddress {
  readonly label: string;
  readonly address: string;
  readonly url: string;
  readonly hotspot: boolean;
}

/**
 * A public HTTPS entry point for the same session, published by a tunnel.
 * Nothing about the LAN listener changes: the tunnel forwards to it, so the
 * phone talks to the same tokenised broker whether it is on the same Wi-Fi or
 * on mobile data.
 */
export interface RemotePublicAddress {
  /** e.g. `remote.af.acocloud.app` */
  readonly host: string;
  readonly url: string;
}

export interface RemoteSessionSnapshot {
  readonly id: string;
  readonly addresses: RemoteAddress[];
  /**
   * Public tunnel URL for this session, when one is configured. The pairing
   * sheet prefers it (it works off-Wi-Fi and gives HTTPS, which the QR scanner
   * and camera permissions require).
   */
  readonly publicAddress?: RemotePublicAddress;
  readonly expiresAt: number;
  readonly hostAttached: boolean;
  readonly guestCount: number;
}

export type RemoteGuestAction =
  | { readonly type: 'prompt'; readonly text: string }
  | { readonly type: 'stop' }
  | { readonly type: 'image'; readonly name: string; readonly mime: string; readonly url: string }
  /** Phone asks the desktop to start sending preview frames. */
  | { readonly type: 'watch' }
  /** Phone stopped looking (backgrounded, card closed). */
  | { readonly type: 'unwatch' };

/** One live preview still, relayed desktop → phone. */
export interface RemotePreviewFrame {
  readonly data: string;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
}

export type RemotePageLocale = 'zh' | 'en' | 'it' | 'ru' | 'ko' | 'th';

interface RemoteSession {
  readonly id: string;
  readonly token: string;
  readonly locale: RemotePageLocale;
  expiresAt: number;
  snapshot: RemoteSnapshot;
  hostListeners: Set<(action: RemoteGuestAction) => void>;
  guests: Set<ServerResponse>;
  keepalive: NodeJS.Timeout;
}

interface RemoteControlOptions {
  bindHost?: string;
  sessionTtlMs?: number;
  /**
   * Pin the listener to a fixed port instead of an ephemeral one.
   *
   * A random port is right for LAN-only pairing (nothing needs to find it twice)
   * but fatal for a tunnel: the public vhost proxies to one fixed upstream, so a
   * port that changes each boot silently breaks the public URL on restart.
   * `0` (the default) keeps the old ephemeral behaviour.
   */
  port?: number;
  /**
   * Public HTTPS origin that forwards to this LAN listener (e.g.
   * `https://remote.af.acocloud.app`). Set via REMOTE_PUBLIC_ORIGIN; when
   * absent the phone must be on the same network, which is the default.
   */
  publicOrigin?: string;
  log?: (message: string) => void;
}

/**
 * Validate and canonicalise the public origin.
 *
 * Only `https:` is accepted: the phone's camera (QR scanning) and clipboard both
 * require a secure context, so an `http:` public origin would silently break the
 * very features the tunnel exists to enable. A bare host is upgraded to https.
 * Returns null for anything unusable so a bad env value degrades to "LAN only"
 * instead of producing a dead QR code.
 */
export function normalizePublicOrigin(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // Origin only: any path in the env value would corrupt the /r/<token> route.
  return url.origin;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sseWrite(res: ServerResponse, event: string, data: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseOpen(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx and friends buffer SSE by default; this is the documented opt-out.
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write(': connected\n\n');
}

/**
 * Web app manifest, so the phone page can be installed from the browser.
 *
 * `start_url` is relative (`./`) on purpose: the page already lives under
 * `/r/<token>`, and a relative start_url keeps the installed icon pointing at
 * the same pairing instead of a hardcoded absolute path that would 404 on the
 * public domain. `display: standalone` plus a fixed `theme_color` is what makes
 * the installed app open without browser chrome.
 */
function sendManifest(res: ServerResponse, _token: string, locale: RemotePageLocale): void {
  if (res.destroyed || res.writableEnded) return;
  const copy = COPY[locale];
  const manifest = {
    name: `${copy.title} ${copy.sub}`,
    short_name: copy.title,
    description: copy.empty,
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(JSON.stringify(manifest));
}

/**
 * Icons are generated rather than shipped as files.
 *
 * The service is inlined into the desktop build and has no asset pipeline, and
 * a binary blob in source would rot silently. A solid black square with a white
 * play triangle is drawn into a raw RGBA buffer and wrapped in a minimal PNG —
 * no encoder dependency, no filesystem read at runtime.
 */
const iconCache = new Map<number, Buffer>();

function sendIcon(res: ServerResponse, size: number): void {
  if (res.destroyed || res.writableEnded) return;
  let png = iconCache.get(size);
  if (!png) {
    png = renderIconPng(size);
    iconCache.set(size, png);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', String(png.length));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(png);
}

/** CRC32 (PNG chunk checksum). Table is built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Solid black rounded-ish square with a white triangle, encoded as PNG. */
export function renderIconPng(size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 6;   // colour type: RGBA
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlace

  // Filter byte (0 = None) per scanline, then RGBA pixels.
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.34;
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 4;
      // Rounded square mask.
      const dx = Math.max(0, Math.abs(x - cx) - (size * 0.5 - radius));
      const dy = Math.max(0, Math.abs(y - cy) - (size * 0.5 - radius));
      const outside = Math.hypot(dx, dy) > radius;
      raw[at] = 0; raw[at + 1] = 0; raw[at + 2] = 0;
      raw[at + 3] = outside ? 0 : 255;

      // White play triangle, centred.
      const halfH = size * 0.22;
      const halfW = size * 0.19;
      const relX = x - (cx - halfW * 0.8);
      const relY = Math.abs(y - cy);
      if (relX >= 0 && relX <= halfW * 2 && relY <= halfH * (1 - relX / (halfW * 2))) {
        raw[at] = 255; raw[at + 1] = 255; raw[at + 2] = 255; raw[at + 3] = 255;
      }
    }
  }

  const idat = pngChunk('IDAT', deflateSync(raw, { level: 9 }));
  const ihdr = pngChunk('IHDR', header);
  const iend = pngChunk('IEND', new Uint8Array(0));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, idat, iend]);
}

interface BindableAddress {
  readonly name: string;
  readonly address: string;
}

/**
 * Every IPv4 this machine could be reached on from another device.
 *
 * Link-local (169.254.x) addresses are dropped: they exist on adapters with no
 * cable and no lease, so they are dead links. Hyper-V / Docker / VPN switches
 * are dropped too — they route only on this machine. Windows Internet
 * Connection Sharing always hands the hotspot host 192.168.137.1, so that
 * address is ranked first: when someone turns a hotspot on, the phone can only
 * reach that one, not the home-Wi-Fi address.
 */
export function remoteControlAddresses(): BindableAddress[] {
  const virtual = /utun|tun|tap|tailscale|docker|bridge|veth|vmnet|virtual|loopback/i;
  const wifi = /^(?:en[01]|wi-?fi|wlan|wireless)/i;
  const ethernet = /^(?:eth|ethernet|local area connection)/i;
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, items]) => (items ?? [])
    .filter((item) => item.family === 'IPv4' && !item.internal)
    .filter((item) => !item.address.startsWith('169.254.'))
    .filter(() => !virtual.test(name))
    .map((item) => ({ name, address: item.address })));
  const score = ({ name, address }: BindableAddress) =>
    (address.startsWith('192.168.137.') ? 400 : 0)
    + (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address) ? 100 : 0)
    + (wifi.test(name) ? 40 : 0)
    + (ethernet.test(name) ? 20 : 0);
  return [...new Map(candidates.map((candidate) => [candidate.address, candidate])).values()]
    .sort((a, b) => score(b) - score(a) || a.address.localeCompare(b.address));
}

function addressLabel({ name, address }: BindableAddress): string {
  if (address.startsWith('192.168.137.')) return 'Hotspot';
  if (/^(?:en[01]|wi-?fi|wlan|wireless)/i.test(name)) return 'Wi-Fi';
  if (/^(?:eth|ethernet)/i.test(name)) return 'Ethernet';
  if (/^local area connection/i.test(name)) return 'Hotspot';
  return name;
}

function readJson(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/** Bound the transcript a phone has to render: keep the tail, cap each turn. */
export function trimRemoteSnapshot(snapshot: RemoteSnapshot): RemoteSnapshot {
  const messages = snapshot.messages.slice(-MAX_MESSAGES).map((message) => ({
    role: message.role,
    text: message.text.length > MAX_MESSAGE_CHARS
      ? `${message.text.slice(0, MAX_MESSAGE_CHARS)}…`
      : message.text,
    ...(message.detail ? { detail: message.detail.slice(0, 400) } : {}),
  }));
  return {
    running: snapshot.running,
    liveTool: snapshot.liveTool,
    messages,
    ...(snapshot.projectName ? { projectName: snapshot.projectName } : {}),
  };
}

const EMPTY_SNAPSHOT: RemoteSnapshot = { running: false, liveTool: null, messages: [] };

const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

/** Magic-byte check: a declared `image/png` that is really an HTML page is dropped. */
function imageSignatureMatches(head: Buffer, mime: string): boolean {
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/gif') return head.subarray(0, 4).toString('latin1') === 'GIF8';
  if (mime === 'image/webp') {
    return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  if (mime === 'image/avif' || mime === 'image/heic' || mime === 'image/heif') {
    const brand = head.subarray(8, 12).toString('latin1');
    return head.subarray(4, 8).toString('latin1') === 'ftyp'
      && (mime === 'image/avif' ? brand === 'avif' || brand === 'avis' : /^(?:heic|heix|hevc|mif1|msf1)$/.test(brand));
  }
  return false;
}

function contentLength(req: IncomingMessage): number | null {
  const raw = req.headers['content-length'];
  if (typeof raw !== 'string') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

export class RemoteControlService {
  private readonly sessions = new Map<string, RemoteSession>();
  private server: Server | null = null;
  private port: number | null = null;
  private starting: Promise<void> | null = null;
  private readonly bindHost: string;
  private readonly requestedPort: number;
  private readonly sessionTtlMs: number;
  private readonly publicOrigin: string | null;
  private readonly log: (message: string) => void;

  constructor(options: RemoteControlOptions = {}) {
    this.bindHost = options.bindHost ?? '0.0.0.0';
    this.requestedPort = options.port ?? 0;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.publicOrigin = normalizePublicOrigin(options.publicOrigin);
    this.log = options.log ?? (() => undefined);
  }

  async createSession(locale: RemotePageLocale = 'en'): Promise<RemoteSessionSnapshot> {
    const bindable = remoteControlAddresses();
    if (bindable.length === 0) throw new Error('no LAN IPv4 address available');
    await this.ensureServer();
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const keepalive = setInterval(() => {
      const session = this.sessions.get(id);
      if (!session) return;
      for (const guest of session.guests) guest.write(': ping\n\n');
    }, KEEPALIVE_MS);
    keepalive.unref();
    const session: RemoteSession = {
      id, token, locale,
      expiresAt: Date.now() + this.sessionTtlMs,
      snapshot: EMPTY_SNAPSHOT,
      hostListeners: new Set(),
      guests: new Set(),
      keepalive,
    };
    this.sessions.set(id, session);
    return this.snapshot(session, bindable);
  }

  getSession(id: string): RemoteSessionSnapshot | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this.snapshot(session, remoteControlAddresses());
  }

  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    clearInterval(session.keepalive);
    for (const guest of session.guests) { guest.end(); }
    for (const listener of session.hostListeners) {
      listener({ type: 'stop' });
    }
    session.guests.clear();
    session.hostListeners.clear();
    this.sessions.delete(id);
    if (this.sessions.size === 0) await this.closeServer();
  }

  async stop(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    await this.closeServer();
  }

  /** Desktop tab attaches here to receive phone actions. Returns a detach fn. */
  attachHost(id: string, res: ServerResponse): () => void {
    const session = this.sessions.get(id);
    if (!session) { sendJson(res, 404, { error: 'session not found or expired' }); return () => undefined; }
    sseOpen(res);
    sseWrite(res, 'snapshot', session.snapshot);
    const listener = (action: RemoteGuestAction) => sseWrite(res, 'action', action);
    session.hostListeners.add(listener);
    const detach = () => {
      session.hostListeners.delete(listener);
      if (!res.writableEnded) res.end();
    };
    res.on('close', () => { session.hostListeners.delete(listener); });
    return detach;
  }

  /** Desktop tab pushes the current transcript; every attached phone receives it. */
  publish(id: string, snapshot: RemoteSnapshot): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.expiresAt = Date.now() + this.sessionTtlMs;
    session.snapshot = trimRemoteSnapshot(snapshot);
    for (const guest of session.guests) sseWrite(guest, 'snapshot', session.snapshot);
    return true;
  }

  /**
   * Relay one preview still to every watching phone.
   *
   * Frames are NOT stored on the session: they are live-only evidence, and
   * holding the last one would let a reconnecting phone paint a stale picture as
   * if it were current. A phone that reconnects simply waits for the next frame.
   *
   * Returns the number of phones that received it, so the desktop can stop
   * capturing as soon as nobody is watching.
   */
  publishPreviewFrame(id: string, frame: RemotePreviewFrame): number {
    const session = this.sessions.get(id);
    if (!session) return 0;
    // A frame is evidence the desktop is alive, so keep the session warm — but
    // do not extend indefinitely on frames alone (publish/text still governs).
    let delivered = 0;
    for (const guest of session.guests) {
      sseWrite(guest, 'preview', frame);
      delivered += 1;
    }
    return delivered;
  }

  /** How many phones are currently attached to a session. */
  guestCount(id: string): number {
    return this.sessions.get(id)?.guests.size ?? 0;
  }

  private snapshot(session: RemoteSession, bindable: BindableAddress[]): RemoteSessionSnapshot {
    const port = this.port;
    return {
      id: session.id,
      addresses: port === null ? [] : bindable.map((entry) => ({
        label: addressLabel(entry),
        address: entry.address,
        url: `http://${entry.address}:${port}/r/${session.token}`,
        hotspot: entry.address.startsWith('192.168.137.'),
      })),
      ...(this.publicOrigin
        ? { publicAddress: { host: new URL(this.publicOrigin).host, url: `${this.publicOrigin}/r/${session.token}` } }
        : {}),
      expiresAt: session.expiresAt,
      hostAttached: session.hostListeners.size > 0,
      guestCount: session.guests.size,
    };
  }

  private async ensureServer(): Promise<void> {
    if (this.server?.listening) return;
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => { void this.handle(req, res); });
      server.once('error', reject);
      server.listen(this.requestedPort, this.bindHost, () => {
        const address = server.address();
        if (!address || typeof address === 'string') { reject(new Error('remote control server failed to bind')); return; }
        this.server = server;
        this.port = address.port;
        resolve();
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async closeServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private sessionByToken(token: string): RemoteSession | null {
    for (const session of this.sessions.values()) {
      if (session.token === token && session.expiresAt > Date.now()) return session;
    }
    return null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      /* The bare origin is the installable entry point: someone who typed
         remote.af.acocloud.app (or tapped the home-screen icon before pairing)
         has no token, so they get the shell with only the scanner enabled. */
      if ((url.pathname === '/' || url.pathname === '') && req.method === 'GET') {
        this.sendPage(res, 'en', true);
        return;
      }
      const match = /^\/r\/([A-Za-z0-9_-]+)(\/(events|prompt|stop|image|state|watch|unwatch|manifest\.webmanifest|icon-192\.png|icon-512\.png))?$/.exec(url.pathname);
      if (!match) { sendJson(res, 404, { error: 'not found' }); return; }
      const session = this.sessionByToken(match[1]!);
      if (!session) { sendJson(res, 410, { error: 'pairing expired — show a new QR on the desktop' }); return; }
      const action = match[2];

      if (!action && req.method === 'GET') { this.sendPage(res, session.locale); return; }
      /* The desktop is the source of truth; the shell exists only so the phone
         can install the page and open it from the home screen. */
      if (action === '/manifest.webmanifest' && req.method === 'GET') {
        sendManifest(res, match[1]!, session.locale);
        return;
      }
      if ((action === '/icon-192.png' || action === '/icon-512.png') && req.method === 'GET') {
        sendIcon(res, action === '/icon-512.png' ? 512 : 192);
        return;
      }
      if (action === '/state' && req.method === 'GET') { sendJson(res, 200, session.snapshot); return; }
      if (action === '/events' && req.method === 'GET') {
        sseOpen(res);
        sseWrite(res, 'snapshot', session.snapshot);
        session.guests.add(res);
        res.on('close', () => { session.guests.delete(res); });
        return;
      }
      if (action === '/prompt' && req.method === 'POST') {
        const body = await readJson(req) as { text?: unknown };
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) { sendJson(res, 400, { error: 'empty prompt' }); return; }
        if (session.hostListeners.size === 0) { sendJson(res, 409, { error: 'open the project on the desktop first' }); return; }
        session.expiresAt = Date.now() + this.sessionTtlMs;
        for (const listener of session.hostListeners) listener({ type: 'prompt', text: text.slice(0, MAX_MESSAGE_CHARS) });
        sendJson(res, 202, { ok: true });
        return;
      }
      if (action === '/stop' && req.method === 'POST') {
        for (const listener of session.hostListeners) listener({ type: 'stop' });
        sendJson(res, 202, { ok: true });
        return;
      }
      /* Preview stream control. The phone asks to watch; the desktop decides how
         long to keep encoding. Both are idempotent so a reconnecting tab can
         re-assert its intent without bookkeeping. */
      if ((action === '/watch' || action === '/unwatch') && req.method === 'POST') {
        const watching = action === '/watch';
        for (const listener of session.hostListeners) {
          listener({ type: watching ? 'watch' : 'unwatch' });
        }
        sendJson(res, 202, { ok: true, watching });
        return;
      }
      if (action === '/image' && req.method === 'POST') {
        if (session.hostListeners.size === 0) { sendJson(res, 409, { error: 'open the project on the desktop first' }); return; }
        await this.receiveImage(session, url, req, res);
        return;
      }
      sendJson(res, 405, { error: 'method not allowed' });
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500;
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
      this.log(`[remote-control] ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Phone → desktop image handoff.
   *
   * The bytes land in the same runtime upload directory the local media pool
   * already reads, and the desktop tab is told the URL. The tab then imports it
   * through its normal media pipeline, so an image from a phone becomes an
   * ordinary pool asset — no new storage path, no new trust boundary.
   */
  private async receiveImage(
    session: RemoteSession,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    const extension = IMAGE_TYPES[mime];
    if (!extension) { req.resume(); sendJson(res, 415, { error: 'only png, jpeg, webp, gif, avif or heic images' }); return; }
    const declared = contentLength(req);
    if (declared === 0) { sendJson(res, 400, { error: 'empty body' }); return; }
    if (declared !== null && declared > MAX_IMAGE_BYTES) { req.resume(); sendJson(res, 413, { error: 'image too large' }); return; }

    const originalName = (url.searchParams.get('name') ?? 'photo')
      .replace(/^.*[\\/]/, '')
      .replace(/[^\w.\- ()]/g, '')
      .slice(0, 120) || 'photo';
    const directory = uploadDir();
    const storedName = `${randomUUID()}${extension}`;
    const partPath = join(directory, `.${storedName}.part`);
    const finalPath = join(directory, storedName);

    await mkdir(directory, { recursive: true });
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_IMAGE_BYTES) { callback(Object.assign(new Error('image too large'), { status: 413 })); return; }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(req, meter, createWriteStream(partPath, { flags: 'w' }));
    } catch (error) {
      await unlink(partPath).catch(() => undefined);
      throw error;
    }
    if (bytes === 0) { await unlink(partPath).catch(() => undefined); sendJson(res, 400, { error: 'empty body' }); return; }

    const handle = await open(partPath, 'r');
    let signatureOk = false;
    try {
      const head = Buffer.alloc(16);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      signatureOk = imageSignatureMatches(head.subarray(0, bytesRead), mime);
    } finally {
      await handle.close();
    }
    if (!signatureOk) {
      await unlink(partPath).catch(() => undefined);
      sendJson(res, 415, { error: 'image content does not match its declared type' });
      return;
    }

    await rename(partPath, finalPath);
    session.expiresAt = Date.now() + this.sessionTtlMs;
    const mediaUrl = `/media/uploads/${storedName}`;
    for (const listener of session.hostListeners) {
      listener({ type: 'image', name: originalName, mime, url: mediaUrl });
    }
    sendJson(res, 200, { name: originalName, mime, url: mediaUrl, bytes });
  }

  private sendPage(res: ServerResponse, locale: RemotePageLocale, unpaired = false): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.end(remotePage(locale, unpaired));
  }
}

const COPY = {
  en: {
    title: 'AfterFrame', sub: 'Remote', placeholder: 'Message the agent…',
    connecting: 'Connecting…', live: 'Connected', offline: 'Reconnecting…',
    expired: 'This pairing expired. Show a new QR on the desktop.',
    empty: 'Ask for an edit — the agent works on the project open on your desktop.',
    working: 'Working', attach: 'Attach image', attachFailed: 'Image failed to send',
    scanQr: 'Scan pairing QR', scanHint: 'Point the camera at the QR code on your desktop', cancel: 'Cancel', scanDenied: 'Camera unavailable — allow camera access, or open the link on the desktop', scanFailed: 'No pairing code found yet', scanNoDecoder: 'This browser cannot decode QR codes — use the phone camera app instead',
    preview: 'Live preview', previewOff: 'Stop', previewLive: 'LIVE',
    s1: 'Add a title', s2: 'Trim the intro', s3: 'Normalize audio', s4: 'Make it cinematic',
  },
  zh: {
    title: 'AfterFrame', sub: 'Remote', placeholder: 'Message the agent…',
    connecting: 'Connecting…', live: 'Connected', offline: 'Reconnecting…',
    expired: 'Pairing expired — show the QR code again on the desktop.',
    empty: 'Just say what to change; the agent acts on the project open on the desktop.',
    working: 'Working', attach: 'Send image', attachFailed: 'Image upload failed',
    scanQr: 'Scan pairing QR', scanHint: 'Point the camera at the QR code on your desktop', cancel: 'Cancel', scanDenied: 'Camera unavailable — allow camera access, or open the link on the desktop', scanFailed: 'No pairing code found yet', scanNoDecoder: 'This browser cannot decode QR codes — use the phone camera app instead',
    preview: 'Live preview', previewOff: 'Stop', previewLive: 'LIVE',
    s1: 'Add a title', s2: 'Trim the intro', s3: 'Normalize volume', s4: 'Make it cinematic',
  },
  ru: {
    title: 'AfterFrame', sub: 'Пульт', placeholder: 'Сообщение агенту…',
    connecting: 'Подключение…', live: 'Подключено', offline: 'Переподключение…',
    expired: 'Сеанс истёк. Покажите новый QR на компьютере.',
    empty: 'Скажите, что изменить — агент работает с проектом на компьютере.',
    working: 'Работаю', attach: 'Прикрепить фото', attachFailed: 'Не удалось отправить фото',
    scanQr: 'Сканировать QR', scanHint: 'Наведите камеру на QR-код на компьютере', cancel: 'Отмена', scanDenied: 'Камера недоступна — разрешите доступ или откройте ссылку на компьютере', scanFailed: 'Код сопряжения не найден', scanNoDecoder: 'Этот браузер не распознаёт QR-коды — используйте камеру телефона',
    preview: 'Живой просмотр', previewOff: 'Стоп', previewLive: 'LIVE',
    s1: 'Добавь титр', s2: 'Обрежь начало', s3: 'Выровняй звук', s4: 'Сделай кинематографично',
  },
  ko: {
    title: 'AfterFrame', sub: '\ub9ac\ubaa8\ud2b8', placeholder: '\uc5d0\uc774\uc804\ud2b8\uc5d0\uac8c \uba54\uc2dc\uc9c0…',
    connecting: '\uc5f0\uacb0 \uc911…', live: '\uc5f0\uacb0\ub428', offline: '\ub2e4\uc2dc \uc5f0\uacb0 \uc911…',
    expired: '\ud398\uc5b4\ub9c1\uc774 \ub9cc\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ub370\uc2a4\ud06c\ud1b1\uc5d0\uc11c \uc0c8 QR\uc744 \ud45c\uc2dc\ud558\uc138\uc694.',
    empty: '\ubb34\uc5c7\uc744 \ubc14\uafc0\uc9c0 \uc54c\ub824\uc8fc\uc138\uc694. \uc5d0\uc774\uc804\ud2b8\uac00 \ub370\uc2a4\ud06c\ud1b1\uc758 \uc5f4\ub9b0 \ud504\ub85c\uc81d\ud2b8\ub97c \ud3b8\uc9d1\ud569\ub2c8\ub2e4.',
    working: '\uc791\uc5c5 \uc911', attach: '\uc774\ubbf8\uc9c0 \ucca8\ubd80', attachFailed: '\uc774\ubbf8\uc9c0 \uc804\uc1a1 \uc2e4\ud328',
    scanQr: '\uc0ac\uc9c4 \uc2a4\uce94', scanHint: '\ub370\uc2a4\ud06c\ud1b1\uc758 QR \ucf54\ub4dc\ub97c \uce74\uba54\ub77c\ub85c \ube44\ucdb0\uc8fc\uc138\uc694', cancel: '\ucde8\uc18c', scanDenied: '\uce74\uba54\ub77c\ub97c \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4 \u2014 \uad8c\ud55c\uc744 \ud5c8\uc6a9\ud558\uac70\ub098 \ucef4\ud4e8\ud1b0\uc5d0\uc11c \ub9c1\ud06c\ub97c \uc5f4\uc138\uc694', scanFailed: '\ud398\uc5b4\ub9c1 \ucf54\ub4dc\ub97c \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4', scanNoDecoder: '\uc774 \ube0c\ub77c\uc6b0\uc800\ub294 QR \ucf54\ub4dc\ub97c \uc778\uc2dd\ud558\uc9c0 \ubabb\ud569\ub2c8\ub2e4 \u2014 \ud734\ub300\ud3f0 \uce74\uba54\ub77c\ub97c \uc0ac\uc6a9\ud558\uc138\uc694',
    preview: '\uc2e4\uc2dc\uac04 \ubbf8\ub9ac\ubcf4\uae30', previewOff: '\uc911\uc9c0', previewLive: 'LIVE',
    s1: '\uc81c\ubaa9 \ucd94\uac00', s2: '\uc778\ud2b8\ub85c \uc790\ub974\uae30', s3: '\uc624\ub514\uc624 \uc815\uaddc\ud654', s4: '\uc2dc\ub124\ub9c8\ud2f1\ud558\uac8c',
  },
  th: {
    title: 'AfterFrame', sub: 'รีโมท', placeholder: 'ส่งข้อความถึงเอเจนต์…',
    connecting: 'กำลังเชื่อมต่อ…', live: 'เชื่อมต่อแล้ว', offline: 'กำลังเชื่อมต่อใหม่…',
    expired: 'การจับคู่หมดอายุ โปรดแสดง QR ใหม่บนคอมพิวเตอร์',
    empty: 'บอกสิ่งที่อยากแก้ เอเจนต์จะทำงานกับโปรเจกต์ที่เปิดบนคอมพิวเตอร์',
    working: 'กำลังทำงาน', attach: 'แนบรูปภาพ', attachFailed: 'ส่งรูปไม่สำเร็จ',
    scanQr: 'สแกน QR', scanHint: 'หันกล้องไปที่คิวอาร์โค้ดบนคอมพิวเตอร์', cancel: 'ยกเลิก', scanDenied: 'ใช้กล้องไม่ได้ — โปรดอนุญาตการเข้าถึงกล้อง หรือเปิดลิงก์บนคอมพิวเตอร์', scanFailed: 'ยังไม่พบรหัสจับคู่', scanNoDecoder: 'เบราว์เซอร์นี้ไม่รองรับการอ่านคิวอาร์ — โปรดใช้แอปกล้องของโทรศัพท์',
    preview: 'ดูตัวอย่างสด', previewOff: 'Stop', previewLive: 'LIVE',
    s1: 'เพิ่มชื่อเรื่อง', s2: 'ตัดช่วงเปิด', s3: 'ปรับระดับเสียง', s4: 'ทำให้เป็นหนัง',
  },
  it: {
    title: 'AfterFrame', sub: 'Remoto', placeholder: 'Scrivi all\'agente…',
    connecting: 'Connessione…', live: 'Connesso', offline: 'Riconnessione…',
    expired: 'Abbinamento scaduto. Mostra un nuovo QR sul desktop.',
    empty: 'Chiedi una modifica: l\'agente lavora sul progetto aperto sul desktop.',
    working: 'Al lavoro', attach: 'Allega immagine', attachFailed: 'Invio immagine non riuscito',
    scanQr: 'Scansiona QR', scanHint: 'Inquadra il codice QR sul desktop', cancel: 'Annulla', scanDenied: 'Fotocamera non disponibile — consenti l\'accesso o apri il link sul desktop', scanFailed: 'Nessun codice di abbinamento trovato', scanNoDecoder: 'Questo browser non legge i codici QR — usa la fotocamera del telefono',
    preview: 'Anteprima live', previewOff: 'Stop', previewLive: 'LIVE',
    s1: 'Aggiungi un titolo', s2: 'Taglia l\'intro', s3: 'Normalizza l\'audio', s4: 'Rendi cinematografico',
  },
} as const;

/**
 * The real brand mark, inlined. The page is served from the LAN origin, where
 * `/afterframe-mark.svg` does not exist, and the CSP forbids remote images — so
 * the same geometry is embedded rather than downgraded to a lookalike glyph.
 */
const BRAND_MARK = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><defs>'
  + '<linearGradient id="afg" x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse">'
  + '<stop offset="0" stop-color="#ec4899"/><stop offset=".55" stop-color="#9333ea"/><stop offset="1" stop-color="#3b82f6"/>'
  + '</linearGradient><linearGradient id="afs" x1="6" y1="2" x2="26" y2="18" gradientUnits="userSpaceOnUse">'
  + '<stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>'
  + '</linearGradient></defs>'
  + '<rect x="3" y="3" width="26" height="26" rx="8" fill="url(#afg)"/>'
  + '<rect x="3" y="3" width="26" height="26" rx="8" fill="url(#afs)"/>'
  + '<path d="M12.6 9.9a1.15 1.15 0 0 1 1.77-.98l8.62 5.6a1.36 1.36 0 0 1 0 2.29l-8.62 5.6a1.15 1.15 0 0 1-1.77-.98Z" fill="#fff"/>'
  + '</svg>';

/** Monochrome play head for the agent avatar, so it never competes with the header. */
const BRAND_GLYPH = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">'
  + '<path d="M12.6 9.9a1.15 1.15 0 0 1 1.77-.98l8.62 5.6a1.36 1.36 0 0 1 0 2.29l-8.62 5.6a1.15 1.15 0 0 1-1.77-.98Z" fill="#fff"/></svg>';

function remotePage(locale: RemotePageLocale, unpaired = false): string {
  const copy = COPY[locale] ?? COPY.en;
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="theme-color" content="#08080b"><meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-192.png">
<title>${copy.title} · ${copy.sub}</title>
<style>
:root{--bg:#08080b;--raise:#121218;--raise2:#17171f;--line:#232330;--line2:#2e2e3d;
--text:#f2f2f6;--mid:#a9a9ba;--dim:#70707f;
--pink:#ec4899;--purple:#9333ea;--blue:#3b82f6;--ok:#35d07f;
--brand:linear-gradient(135deg,var(--pink),var(--purple) 55%,var(--blue));
font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
background:var(--bg);color:var(--text);-webkit-text-size-adjust:100%}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;overscroll-behavior:none}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden;
background:
 radial-gradient(90% 45% at 50% -12%,color-mix(in srgb,var(--purple) 22%,transparent),transparent 70%),
 radial-gradient(70% 40% at 100% 0%,color-mix(in srgb,var(--pink) 12%,transparent),transparent 65%),var(--bg)}

header{position:relative;z-index:5;display:flex;align-items:center;gap:11px;flex:0 0 auto;
padding:calc(9px + env(safe-area-inset-top)) 16px 9px;
background:color-mix(in srgb,var(--bg) 72%,transparent);
-webkit-backdrop-filter:blur(22px) saturate(1.6);backdrop-filter:blur(22px) saturate(1.6);
border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
.mark{width:34px;height:34px;flex:0 0 34px;border-radius:11px;display:grid;place-items:center;
box-shadow:0 5px 18px color-mix(in srgb,var(--purple) 34%,transparent)}
.mark svg{width:34px;height:34px;display:block}
.hd{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.hd b{font-size:15px;font-weight:650;letter-spacing:-.2px;line-height:1.2}
.hd b em{font-style:normal;font-weight:400;color:var(--dim)}
.hd span{font-size:11.5px;color:var(--dim);display:flex;align-items:center;gap:5px;line-height:1.3}
.dot{width:6px;height:6px;border-radius:50%;background:var(--dim);flex:0 0 auto;transition:background .25s}
.dot.live{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 16%,transparent)}
.dot.work{background:var(--pink);animation:blip 1.15s ease-in-out infinite}
.hd-btn{flex:0 0 auto;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;
border:1px solid var(--line2);background:var(--raise);color:var(--mid);cursor:pointer;padding:0}
.hd-btn:active{background:var(--raise2);color:var(--text)}
.hd-btn svg{width:17px;height:17px}

/* Pairing scanner: the same page is served at the bare public origin, with no
   token, so a phone that opens remote.af.acocloud.app can scan the QR shown on
   the desktop and land on its pairing. */
.scan{position:fixed;inset:0;z-index:60;background:#000;display:none}
.scan.show{display:block}
.scan video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scan-frame{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
width:min(68vw,260px);aspect-ratio:1;border-radius:20px;
box-shadow:0 0 0 100vmax rgba(0,0,0,.62);}
.scan-frame:before,.scan-frame:after{content:"";position:absolute;inset:0;border-radius:20px}
.scan-frame:before{border:2px solid rgba(255,255,255,.9)}
.scan-frame:after{box-shadow:inset 0 0 40px rgba(147,51,234,.55);animation:scanPulse 2s ease-in-out infinite}
@keyframes scanPulse{0%,100%{opacity:.35}50%{opacity:.9}}
.scan-hint{position:absolute;left:0;right:0;bottom:calc(28px + env(safe-area-inset-bottom));
text-align:center;font-size:13.5px;color:#fff;padding:0 28px;line-height:1.5;
text-shadow:0 1px 8px rgba(0,0,0,.9)}
.scan-close{position:absolute;top:calc(12px + env(safe-area-inset-top));right:14px;
width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.16);
color:#fff;font-size:20px;line-height:1;cursor:pointer;display:grid;place-items:center}

@keyframes blip{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}}

main{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
overscroll-behavior:contain;padding:18px 0 10px;scrollbar-width:none}
main::-webkit-scrollbar{display:none}
.stream{max-width:720px;margin:0 auto;padding:0 16px;display:flex;flex-direction:column;gap:22px}

.turn{display:flex;gap:10px;animation:rise .26s cubic-bezier(.2,.8,.3,1) both}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.turn.user{flex-direction:column;align-items:flex-end;gap:6px}
.turn.user .bubble{max-width:84%;padding:11px 14px;border-radius:19px 19px 5px 19px;
background:linear-gradient(140deg,color-mix(in srgb,var(--purple) 26%,var(--raise2)),var(--raise2));
border:1px solid color-mix(in srgb,var(--purple) 26%,var(--line));
font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.turn.user .shots{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
.turn.user .shots img{width:104px;height:104px;object-fit:cover;border-radius:13px;
border:1px solid var(--line2);background:var(--raise)}

.turn.agent{flex-direction:row;align-items:flex-start}
.avatar{width:26px;height:26px;flex:0 0 26px;margin-top:1px;border-radius:9px;background:var(--brand);
display:grid;place-items:center;box-shadow:0 3px 12px color-mix(in srgb,var(--purple) 30%,transparent)}
.avatar svg{width:12px;height:12px}
.agent-body{min-width:0;flex:1;display:flex;flex-direction:column;gap:8px;padding-top:2px}
.body{font-size:15px;line-height:1.62;overflow-wrap:anywhere;word-break:break-word}
.body>*:first-child{margin-top:0}.body>*:last-child{margin-bottom:0}
.body p{margin:0 0 10px}
.body h3{margin:14px 0 8px;font-size:15.5px;font-weight:650;letter-spacing:-.15px;line-height:1.35}
.body ul,.body ol{margin:0 0 10px;padding-left:20px}
.body li{margin:0 0 5px}
.body strong{font-weight:650;color:#fff}
.body a{color:#a78bfa;text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--purple) 45%,transparent)}
.body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.8px;
padding:1.5px 5px;border-radius:5px;background:var(--raise2);border:1px solid var(--line);color:#dcd6ff}
.body pre{margin:0 0 10px;padding:11px 12px;border-radius:11px;overflow-x:auto;
background:#0d0d12;border:1px solid var(--line);-webkit-overflow-scrolling:touch}
.body pre code{background:none;border:0;padding:0;font-size:12.4px;line-height:1.55;color:#cfc9f5}

.steps{display:flex;flex-direction:column;gap:5px;margin:2px 0 4px;padding-left:36px}
.step{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dim);line-height:1.35;min-width:0}
.step .ic{width:14px;height:14px;flex:0 0 14px;display:grid;place-items:center;color:var(--purple)}
.step .ic svg{width:12px;height:12px}
.step .nm{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
color:var(--mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.step .dt{color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.step.live .nm{color:var(--text)}
.step .ring{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--purple);border-top-color:transparent;
animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.step.done .ic{color:var(--ok)}

.caret{display:inline-block;width:7px;height:15px;margin-left:2px;vertical-align:-2px;border-radius:1.5px;
background:var(--mid);animation:blip 1s steps(2,end) infinite}
.typing{display:inline-flex;gap:4px;align-items:center;height:18px}
.typing i{width:6px;height:6px;border-radius:50%;background:var(--mid);animation:bounce 1.3s ease-in-out infinite}
.typing i:nth-child(2){animation-delay:.16s}.typing i:nth-child(3){animation-delay:.32s}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}

.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
gap:14px;padding:12vh 8px 24px;animation:rise .4s ease both}
.empty .big{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;
box-shadow:0 14px 40px color-mix(in srgb,var(--purple) 34%,transparent)}
.empty .big svg{width:64px;height:64px}
.empty h1{margin:2px 0 0;font-size:20px;font-weight:650;letter-spacing:-.4px}
.empty p{margin:0;max-width:280px;color:var(--dim);font-size:13.5px;line-height:1.55}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:6px}
.chips button{font:inherit;font-size:13px;color:var(--mid);background:var(--raise);
border:1px solid var(--line2);border-radius:999px;padding:8px 14px;cursor:pointer}
.chips button:active{background:var(--raise2);color:var(--text)}

.banner{display:none;padding:9px 16px;font-size:12.5px;color:#ffb4c4;
background:color-mix(in srgb,var(--pink) 14%,transparent);
border-bottom:1px solid color-mix(in srgb,var(--pink) 28%,transparent)}
.banner.show{display:block}
/* Unpaired landing: one clear action, nothing that pretends to be a session. */
#scanCta{appearance:none;border:0;background:none;color:#ffd6e6;font:inherit;
font-size:12.5px;font-weight:600;padding:0;cursor:pointer;text-decoration:underline}
#scanCtaBig{appearance:none;margin-top:22px;padding:14px 26px;border-radius:15px;
border:0;cursor:pointer;color:#fff;font:inherit;font-size:15px;font-weight:620;
letter-spacing:-.1px;background:var(--brand);
box-shadow:0 10px 30px color-mix(in srgb,var(--purple) 38%,transparent)}
#scanCtaBig:active{transform:scale(.97)}
.pair-empty{flex:1;display:flex;flex-direction:column;align-items:center;
justify-content:center;text-align:center;padding:0 34px 60px;gap:2px}
.pair-empty-title{font-size:19px;font-weight:650;letter-spacing:-.3px}
.pair-empty-text{margin:0;font-size:13.5px;line-height:1.6;color:var(--dim);max-width:30ch}

footer{flex:0 0 auto;padding:8px 12px calc(9px + env(safe-area-inset-bottom));
background:linear-gradient(to top,var(--bg) 62%,transparent)}
.tray{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:8px}
.previews{display:flex;gap:8px;flex-wrap:wrap;padding:0 4px}
.previews .pv{position:relative;width:62px;height:62px;border-radius:12px;overflow:hidden;border:1px solid var(--line2);background:var(--raise)}
.previews .pv img{width:100%;height:100%;object-fit:cover;display:block}
.previews .pv .rm{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;
background:rgba(8,8,11,.78);color:#fff;border:0;font-size:11px;line-height:1;display:grid;place-items:center;cursor:pointer;padding:0}
.previews .pv.up{opacity:.55}
.previews .pv.up::after{content:'';position:absolute;inset:0;border-radius:12px;
border:2px solid transparent;border-top-color:var(--purple);animation:spin .8s linear infinite}
.bar{display:flex;align-items:flex-end;gap:6px;padding:5px 5px 5px 6px;border-radius:24px;
background:var(--raise);border:1px solid var(--line2);
box-shadow:0 10px 34px rgba(0,0,0,.42)}
.bar:focus-within{border-color:color-mix(in srgb,var(--purple) 52%,var(--line2))}
.ib{width:36px;height:36px;flex:0 0 36px;border-radius:50%;border:0;background:transparent;color:var(--mid);
display:grid;place-items:center;cursor:pointer;padding:0}
.ib svg{width:19px;height:19px}
textarea{flex:1;resize:none;border:0;outline:none;background:transparent;color:var(--text);
font:inherit;font-size:16px;line-height:1.4;padding:8px 2px;max-height:32vh}
textarea::placeholder{color:var(--dim)}
.send{width:36px;height:36px;flex:0 0 36px;border-radius:50%;border:0;padding:0;display:grid;place-items:center;
background:var(--brand);color:#fff;cursor:pointer;transition:transform .14s,opacity .14s;
box-shadow:0 5px 16px color-mix(in srgb,var(--purple) 34%,transparent)}
.send:active{transform:scale(.93)}
.send svg{width:18px;height:18px}
.send.stop{background:var(--raise2);border:1px solid var(--line2);color:#ff8fa3;box-shadow:none}
.hint{text-align:center;font-size:10.5px;color:#ff8fa3;min-height:13px;padding-top:2px}
input[type=file]{display:none}

/* Live preview card. The desktop pushes JPEG stills while this is open; keeping
   it OUT of the message stream means a frame arriving never re-renders the
   transcript, and closing it stops the desktop capturing entirely. */
.watch{position:relative;flex:0 0 auto;margin:0 0 2px;background:#000;
  border-bottom:1px solid var(--line);overflow:hidden}
.watch[hidden]{display:none}
.watch img{display:block;width:100%;max-height:34vh;object-fit:contain;background:#000}
.watch-bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:9px;
  padding:7px 12px;background:linear-gradient(to top,rgba(0,0,0,.86),rgba(0,0,0,0))}
.watch-live{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;
  letter-spacing:.06em;color:#ff5f87}
.watch-live i{width:6px;height:6px;border-radius:50%;background:#ff5f87;animation:blip 1.3s ease-in-out infinite}
.watch-pos{margin-left:auto;font-size:10.5px;color:var(--mid);font-variant-numeric:tabular-nums}
.watch-off{border:0;background:rgba(255,255,255,.14);color:#fff;font:inherit;font-size:11px;
  padding:4px 10px;border-radius:999px;cursor:pointer}
</style></head>
<body>
<header>
  <div class="mark">${BRAND_MARK}</div>
  <div class="hd">
    <b>${copy.title} <em>${copy.sub}</em></b>
    <span><i class="dot" id="dot"></i><span id="sub">${copy.connecting}</span></span>
  </div>
  <button type="button" class="hd-btn" id="scanBtn" aria-label="${copy.scanQr}" title="${copy.scanQr}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>
      <path d="M3 12h18"/>
    </svg>
  </button>
</header>
<div class="scan" id="scan" hidden>
  <video id="scanVideo" playsinline muted></video>
  <div class="scan-frame"></div>
  <p class="scan-hint" id="scanHint">${copy.scanHint}</p>
  <button type="button" class="scan-close" id="scanClose" aria-label="${copy.cancel}">&times;</button>
</div>
<div class="banner" id="banner">${copy.expired}</div>
<div class="watch" id="watch" hidden title="${copy.preview}">
  <img id="watchImg" alt="${copy.preview}">
  <div class="watch-bar">
    <span class="watch-live"><i></i>${copy.previewLive}</span>
    <span class="watch-pos" id="watchPos"></span>
    <button type="button" class="watch-off" id="watchOff" aria-label="${copy.previewOff}">${copy.previewOff}</button>
  </div>
</div>
<main id="main"><div class="stream" id="stream"></div></main>
<footer>
  <div class="tray">
    <div class="previews" id="previews"></div>
    <div class="bar">
      <button type="button" class="ib" id="attach" aria-label="${copy.attach}" title="${copy.attach}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6-8.4 8.6a2 2 0 0 0 2.8 2.8l8.4-8.6a4 4 0 1 0-5.7-5.7l-8.4 8.6a6 6 0 1 0 8.5 8.5l8.4-8.6"/></svg>
      </button>
      <textarea id="input" rows="1" placeholder="${copy.placeholder}" enterkeyhint="send" autocomplete="off"></textarea>
      <button type="button" class="send" id="send" aria-label="Send"></button>
    </div>
    <div class="hint" id="hint"></div>
  </div>
</footer>
<input type="file" id="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif">
<script>
(function(){
  var COPY=${JSON.stringify(copy)};
  var AVATAR=${JSON.stringify(BRAND_GLYPH)};
  var MARK=${JSON.stringify(BRAND_MARK)};
  var ICON_SEND='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  var ICON_STOP='<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
  var ICON_TICK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  var $=function(id){return document.getElementById(id)};
  var base=location.pathname.replace(/\\/$/,'');
  /* Served at the bare origin: no token to talk to, so nothing connects and the
     only useful action is the scanner. */
  var PAIRED=${unpaired ? 'false' : 'true'};
  var main=$('main'),stream=$('stream'),input=$('input'),sendBtn=$('send'),
      attachBtn=$('attach'),fileInput=$('file'),previews=$('previews'),
      dot=$('dot'),subEl=$('sub'),banner=$('banner'),hint=$('hint'),
      watch=$('watch'),watchImg=$('watchImg'),watchPos=$('watchPos'),watchOff=$('watchOff'),
      scanBtn=$('scanBtn'),scan=$('scan'),scanVideo=$('scanVideo'),
      scanHint=$('scanHint'),scanClose=$('scanClose');

  var snap={running:false,liveTool:null,messages:[]};
  var optimistic=null, uploads=[], live=true, renderedKey='', lastBody=null;

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function inline(s){
    return s
      .replace(/\\u0060([^\\u0060\\n]+)\\u0060/g,'<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
      .replace(/(^|[^*])\\*([^*\\n]+)\\*/g,'$1<em>$2</em>')
      .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g,'<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  }
  function md(text){
    var lines=esc(text).split('\\n'), out=[], i=0, buf=[];
    function flush(){ if(buf.length){ out.push('<p>'+inline(buf.join('<br>'))+'</p>'); buf=[]; } }
    while(i<lines.length){
      var line=lines[i];
      if(/^\\u0060\\u0060\\u0060/.test(line)){
        flush(); i++; var code=[];
        while(i<lines.length && !/^\\u0060\\u0060\\u0060/.test(lines[i])){ code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>'+code.join('\\n')+'</code></pre>');
        continue;
      }
      var h=/^(#{1,3})\\s+(.*)$/.exec(line);
      if(h){ flush(); out.push('<h3>'+inline(h[2])+'</h3>'); i++; continue; }
      if(/^\\s*[-*+]\\s+/.test(line)){
        flush(); var items=[];
        while(i<lines.length && /^\\s*[-*+]\\s+/.test(lines[i])){ items.push('<li>'+inline(lines[i].replace(/^\\s*[-*+]\\s+/,''))+'</li>'); i++; }
        out.push('<ul>'+items.join('')+'</ul>');
        continue;
      }
      if(/^\\s*\\d+\\.\\s+/.test(line)){
        flush(); var oitems=[];
        while(i<lines.length && /^\\s*\\d+\\.\\s+/.test(lines[i])){ oitems.push('<li>'+inline(lines[i].replace(/^\\s*\\d+\\.\\s+/,''))+'</li>'); i++; }
        out.push('<ol>'+oitems.join('')+'</ol>');
        continue;
      }
      if(!line.trim()){ flush(); i++; continue; }
      buf.push(line); i++;
    }
    flush();
    return out.join('');
  }

  function renderEmpty(){
    stream.innerHTML='<div class="empty"><div class="big">'+MARK+'</div>'
      +'<h1>'+esc(COPY.title)+'</h1><p>'+esc(COPY.empty)+'</p><div class="chips">'
      +['s1','s2','s3','s4'].map(function(k){return '<button type="button" data-seed="'+esc(COPY[k])+'">'+esc(COPY[k])+'</button>'}).join('')
      +'</div></div>';
    bindSeeds();
  }

  function bindSeeds(){
    Array.prototype.forEach.call(stream.querySelectorAll('[data-seed]'),function(b){
      b.addEventListener('click',function(){ input.value=b.getAttribute('data-seed'); autosize(); input.focus(); });
    });
  }

  function stepsHtml(messages){
    var rows=[], group=[];
    function flushGroup(){
      if(!group.length) return;
      rows.push('<div class="steps">'+group.join('')+'</div>');
      group=[];
    }
    for(var i=0;i<messages.length;i++){
      var m=messages[i];
      if(m.role==='tool'){
        group.push('<div class="step done"><span class="ic">'+ICON_TICK+'</span><span class="nm">'+esc(m.text)+'</span>'
          +(m.detail?'<span class="dt">'+esc(m.detail)+'</span>':'')+'</div>');
        continue;
      }
      flushGroup();
      if(m.role==='user'){
        rows.push('<div class="turn user"><div class="bubble">'+esc(m.text)+'</div></div>');
      }else{
        var caret=snap.running&&i===messages.length-1?'<span class="caret"></span>':'';
        rows.push('<div class="turn agent"><div class="avatar">'+AVATAR+'</div>'
          +'<div class="agent-body"><div class="body">'+md(m.text)+caret+'</div></div></div>');
      }
    }
    flushGroup();
    return rows;
  }

  function renderInner(){
    var msgs=snap.messages, rows=stepsHtml(msgs), tail='';
    if(optimistic){
      tail='<div class="turn user">'
        +(optimistic.images.length?'<div class="shots">'+optimistic.images.map(function(u){return '<img src="'+u+'" alt="">'}).join('')+'</div>':'')
        +'<div class="bubble">'+esc(optimistic.text)+'</div></div>';
    }
    if(snap.running&&snap.liveTool){
      rows.push('<div class="turn agent"><div class="avatar">'+AVATAR+'</div><div class="agent-body">'
        +'<div class="step live"><span class="ic"><span class="ring"></span></span><span class="nm">'+esc(snap.liveTool)+'</span></div>'
        +'</div></div>');
    }
    if(!rows.length&&!tail){ renderEmpty(); lastBody=null; return; }
    var lastAssistant=msgs.length&&msgs[msgs.length-1].role==='assistant'?msgs[msgs.length-1]:null;
    if(snap.running&&(!lastAssistant||!lastAssistant.text)&&!snap.liveTool&&!tail){
      rows.push('<div class="turn agent"><div class="avatar">'+AVATAR+'</div><div class="agent-body"><div class="typing"><i></i><i></i><i></i></div></div></div>');
    }
    stream.innerHTML=rows.join('')+tail;
    bindSeeds();
    var bodies=stream.querySelectorAll('.turn.agent .body');
    lastBody=bodies.length?bodies[bodies.length-1]:null;
  }

  /* Signature ignores the tail message's length, so a growing answer patches in
     place instead of rebuilding the list 4x a second. */
  function signature(){
    var msgs=snap.messages, parts=[];
    for(var i=0;i<msgs.length-1;i++) parts.push(msgs[i].role+':'+msgs[i].text.length);
    return snap.running+'|'+(snap.liveTool||'')+'|'+(optimistic?1:0)+'|'+msgs.length+'|'+parts.join(',');
  }

  function paint(){
    var nearBottom=main.scrollHeight-main.scrollTop-main.clientHeight<140;
    var key=signature();
    if(key!==renderedKey){ renderedKey=key; renderInner(); }
    else{
      var msgs=snap.messages, last=msgs[msgs.length-1];
      if(lastBody&&last&&last.role==='assistant') lastBody.innerHTML=md(last.text);
    }
    if(nearBottom) main.scrollTop=main.scrollHeight;
    sendBtn.className='send'+(snap.running?' stop':'');
    sendBtn.innerHTML=snap.running?ICON_STOP:ICON_SEND;
    dot.className='dot'+(snap.running?' work':(live?' live':''));
    subEl.textContent=snap.running?COPY.working:(live?COPY.live:COPY.offline);
  }

  function paintPreviews(){
    previews.innerHTML=uploads.map(function(u,i){
      return '<div class="pv'+(u.state==='up'?' up':'')+'"><img src="'+u.preview+'" alt="">'
        +(u.state==='up'?'':'<button type="button" class="rm" data-rm="'+i+'">×</button>')+'</div>';
    }).join('');
    Array.prototype.forEach.call(previews.querySelectorAll('[data-rm]'),function(b){
      b.addEventListener('click',function(){ uploads.splice(Number(b.getAttribute('data-rm')),1); paintPreviews(); });
    });
  }

  function uploadImage(file){
    var item={preview:URL.createObjectURL(file),state:'up',name:file.name||'photo'};
    uploads.push(item); paintPreviews();
    fetch(base+'/image?name='+encodeURIComponent(item.name),{
      method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file
    }).then(function(r){
      if(!r.ok) return r.json().catch(function(){return {}}).then(function(b){throw new Error(b.error||('HTTP '+r.status))});
      item.state='ok';
    }).catch(function(err){
      item.state='fail'; hint.textContent=COPY.attachFailed+' — '+err.message;
      setTimeout(function(){ hint.textContent=''; },5000);
    }).then(function(){ paintPreviews(); });
  }

  attachBtn.addEventListener('click',function(){ fileInput.click(); });
  fileInput.addEventListener('change',function(){
    Array.prototype.forEach.call(fileInput.files||[],uploadImage);
    fileInput.value='';
  });

  function connect(){
    if(!PAIRED) return;
    var es=new EventSource(base+'/events');
    es.addEventListener('open',function(){ live=true; banner.className='banner'; paint(); requestWatch(); });
    es.addEventListener('snapshot',function(e){
      live=true;
      try{
        snap=JSON.parse(e.data);
        if(optimistic&&snap.messages.some(function(m){return m.role==='user'&&m.text===optimistic.text})) optimistic=null;
        paint();
        /* The desktop advertises whether it is actually pushing frames. If it
           stopped (dialog closed, project switched), leave preview mode. */
        if(snap.previewLive!==true && !watch.hidden) watchOff.click();
      }catch(err){}
    });
    /* Preview frames arrive on their own event so a 6 fps picture never
       re-renders the transcript. Only the <img> src is reassigned. */
    es.addEventListener('preview',function(e){
      try{
        var f=JSON.parse(e.data);
        if(!f||!f.data) return;
        watchImg.src='data:image/jpeg;base64,'+f.data;
        watchPos.textContent=f.frame?('f '+f.frame):'';
        if(watch.hidden){ watch.hidden=false; requestWatch(); }
      }catch(err){}
    });
    es.addEventListener('error',function(){
      live=false;
      if(es.readyState===2){ banner.className='banner show'; es.close(); paint(); return; }
      paint();
    });
  }

  /* Ask the desktop to start pushing frames. Re-sent whenever the tab becomes
     visible again, because the desktop stops capturing when nobody is watching
     and cannot tell a backgrounded tab from a closed one. */
  function requestWatch(){
    if(document.hidden) return;
    fetch(base+'/watch',{method:'POST',headers:{'Content-Type':'application/json'}}
    ).catch(function(){});
  }

  watchOff.addEventListener('click',function(){
    watch.hidden=true;
    fetch(base+'/unwatch',{method:'POST',headers:{'Content-Type':'application/json'}}).catch(function(){});
  });

  /* ---- pairing scanner -------------------------------------------------
     The same page is served at the bare public origin with no token, so the
     first thing a phone can do is scan the QR the desktop is showing. The scan
     result is a full pairing URL; navigating to it lands on the tokenised page. */
  var scanStream=null, scanTimer=null;

  function stopScan(){
    if(scanTimer!==null){ clearInterval(scanTimer); scanTimer=null; }
    if(scanStream){ scanStream.getTracks().forEach(function(t){ t.stop(); }); scanStream=null; }
    scanVideo.srcObject=null; scan.hidden=true; scan.className='scan';
  }

  /* The QR carries a URL; only accept one that points at a pairing, so a random
     QR (a menu, a wifi code) cannot navigate the app somewhere unintended. */
  function pairingFrom(text){
    try{
      var u=new URL(text,location.href);
      if(!u.pathname || u.pathname.indexOf('/r/')===-1) return null;
      return u.href;
    }catch(e){ return null; }
  }

  function startScan(){
    // Toggle: a second tap on the header button puts the camera away, so the
    // only way to leave the sensor on is to leave it deliberately.
    if(!scan.hidden){ stopScan(); return; }
    scan.hidden=false; scan.className='scan show';
    scanHint.textContent=COPY.scanHint;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      scanHint.textContent=COPY.scanDenied; return;
    }
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(s){
      // The user may have tapped close while the permission prompt was up.
      // Without this the sensor stays on with no overlay to show it.
      if(scan.hidden){ s.getTracks().forEach(function(t){ t.stop(); }); return; }
      scanStream=s; scanVideo.srcObject=s;
      var p=scanVideo.play(); if(p&&p.catch) p.catch(function(){});
      if(!('BarcodeDetector' in window)){
        /* No native decoder (iOS Safari). Rather than ship a decoder, say so
           honestly — the QR is still scannable with the system camera app. */
        scanHint.textContent=COPY.scanNoDecoder; return;
      }
      var detector=new window.BarcodeDetector({formats:['qr_code']});
      scanTimer=setInterval(function(){
        // The overlay may have been dismissed mid-flight; stop decoding and let
        // the sensor go rather than polling a detached video element forever.
        if(scan.hidden){ stopScan(); return; }
        if(scanVideo.readyState<2) return;
        detector.detect(scanVideo).then(function(codes){
          for(var i=0;i<codes.length;i++){
            var target=pairingFrom(codes[i].rawValue||'');
            if(target){ stopScan(); location.replace(target); return; }
          }
        }).catch(function(){});
      },260);
    }).catch(function(){ scanHint.textContent=COPY.scanDenied; });
  }

  scanBtn.addEventListener('click',startScan);
  scanClose.addEventListener('click',stopScan);
  // Re-assert the watch request when the tab returns, and drop the camera when
  // it leaves: a backgrounded page must not hold the camera indicator on.
  document.addEventListener('visibilitychange',function(){
    if(document.hidden){ stopScan(); return; }
    if(!watch.hidden) requestWatch();
  });

  function sendText(){
    var text=input.value.trim(); if(!text) return;
    input.value=''; autosize();
    optimistic={text:text,images:uploads.filter(function(u){return u.state==='ok'}).map(function(u){return u.preview})};
    uploads=[]; paintPreviews();
    snap.running=true; renderedKey=''; paint();
    fetch(base+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text})})
      .then(function(r){ if(!r.ok) return r.json().then(function(b){throw new Error(b.error||('HTTP '+r.status))}); })
      .catch(function(err){
        optimistic=null; snap.running=false;
        snap.messages=snap.messages.concat([{role:'assistant',text:'⚠ '+err.message}]);
        renderedKey=''; paint();
      });
  }

  sendBtn.addEventListener('click',function(){
    if(snap.running){ fetch(base+'/stop',{method:'POST'}).catch(function(){}); return; }
    sendText();
  });

  function autosize(){ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,360)+'px'; }
  input.addEventListener('input',autosize);
  input.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault(); if(!snap.running) sendText();}
  });
  document.addEventListener('visibilitychange',function(){ if(!document.hidden){ renderedKey=''; paint(); } });

  connect(); autosize(); renderInner(); renderedKey=''; paint();
  if(!PAIRED){
    /* No session behind this URL, so the composer would only ever 404. Replace
       the whole surface with one call to action. The camera is NOT opened here:
       turning on the sensor without a tap trips a permission prompt and lights
       the recording indicator, so it waits for the user to press the button. */
    subEl.textContent=COPY.scanQr;
    /* One action, not three. The banner is left hidden here: the headline and
       the button below already say the same thing, and repeating it read as a
       warning when nothing is actually wrong. */
    main.innerHTML='<div class="pair-empty">'
      +'<div class="pair-empty-title">'+esc(COPY.scanQr)+'</div>'
      +'<p class="pair-empty-text">'+esc(COPY.scanHint)+'</p>'
      +'<button type="button" class="pair-empty-btn" id="scanCtaBig">'+esc(COPY.scanQr)+'</button>'
      +'</div>';
    var big=$('scanCtaBig');
    if(big) big.addEventListener('click',startScan);
    var footer=document.querySelector('footer');
    if(footer) footer.setAttribute('hidden','');
  }
})();
</script>
</body></html>`;
}
