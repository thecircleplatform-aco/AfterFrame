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
}

export interface RemoteAddress {
  readonly label: string;
  readonly address: string;
  readonly url: string;
  readonly hotspot: boolean;
}

export interface RemoteSessionSnapshot {
  readonly id: string;
  readonly addresses: RemoteAddress[];
  readonly expiresAt: number;
  readonly hostAttached: boolean;
  readonly guestCount: number;
}

export type RemoteGuestAction =
  | { readonly type: 'prompt'; readonly text: string }
  | { readonly type: 'stop' }
  | { readonly type: 'image'; readonly name: string; readonly mime: string; readonly url: string };

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
  log?: (message: string) => void;
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
  private readonly sessionTtlMs: number;
  private readonly log: (message: string) => void;

  constructor(options: RemoteControlOptions = {}) {
    this.bindHost = options.bindHost ?? '0.0.0.0';
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
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
      server.listen(0, this.bindHost, () => {
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
      const match = /^\/r\/([A-Za-z0-9_-]+)(\/(events|prompt|stop|image|state))?$/.exec(url.pathname);
      if (!match) { sendJson(res, 404, { error: 'not found' }); return; }
      const session = this.sessionByToken(match[1]!);
      if (!session) { sendJson(res, 410, { error: 'pairing expired — show a new QR on the desktop' }); return; }
      const action = match[2];

      if (!action && req.method === 'GET') { this.sendPage(res, session.locale); return; }
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

  private sendPage(res: ServerResponse, locale: RemotePageLocale): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.end(remotePage(locale));
  }
}

const COPY = {
  en: {
    title: 'AfterFrame', sub: 'Remote', placeholder: 'Message the agent…',
    connecting: 'Connecting…', live: 'Connected', offline: 'Reconnecting…',
    expired: 'This pairing expired. Show a new QR on the desktop.',
    empty: 'Ask for an edit — the agent works on the project open on your desktop.',
    working: 'Working', attach: 'Attach image', attachFailed: 'Image failed to send',
    s1: 'Add a title', s2: 'Trim the intro', s3: 'Normalize audio', s4: 'Make it cinematic',
  },
  zh: {
    title: 'AfterFrame', sub: 'Remote', placeholder: 'Message the agent…',
    connecting: 'Connecting…', live: 'Connected', offline: 'Reconnecting…',
    expired: 'Pairing expired — show the QR code again on the desktop.',
    empty: 'Just say what to change; the agent acts on the project open on the desktop.',
    working: 'Working', attach: 'Send image', attachFailed: 'Image upload failed',
    s1: 'Add a title', s2: 'Trim the intro', s3: 'Normalize volume', s4: 'Make it cinematic',
  },
  ru: {
    title: 'AfterFrame', sub: 'Пульт', placeholder: 'Сообщение агенту…',
    connecting: 'Подключение…', live: 'Подключено', offline: 'Переподключение…',
    expired: 'Сеанс истёк. Покажите новый QR на компьютере.',
    empty: 'Скажите, что изменить — агент работает с проектом на компьютере.',
    working: 'Работаю', attach: 'Прикрепить фото', attachFailed: 'Не удалось отправить фото',
    s1: 'Добавь титр', s2: 'Обрежь начало', s3: 'Выровняй звук', s4: 'Сделай кинематографично',
  },
  ko: {
    title: 'AfterFrame', sub: '\ub9ac\ubaa8\ud2b8', placeholder: '\uc5d0\uc774\uc804\ud2b8\uc5d0\uac8c \uba54\uc2dc\uc9c0…',
    connecting: '\uc5f0\uacb0 \uc911…', live: '\uc5f0\uacb0\ub428', offline: '\ub2e4\uc2dc \uc5f0\uacb0 \uc911…',
    expired: '\ud398\uc5b4\ub9c1\uc774 \ub9cc\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ub370\uc2a4\ud06c\ud1b1\uc5d0\uc11c \uc0c8 QR\uc744 \ud45c\uc2dc\ud558\uc138\uc694.',
    empty: '\ubb34\uc5c7\uc744 \ubc14\uafc0\uc9c0 \uc54c\ub824\uc8fc\uc138\uc694. \uc5d0\uc774\uc804\ud2b8\uac00 \ub370\uc2a4\ud06c\ud1b1\uc758 \uc5f4\ub9b0 \ud504\ub85c\uc81d\ud2b8\ub97c \ud3b8\uc9d1\ud569\ub2c8\ub2e4.',
    working: '\uc791\uc5c5 \uc911', attach: '\uc774\ubbf8\uc9c0 \ucca8\ubd80', attachFailed: '\uc774\ubbf8\uc9c0 \uc804\uc1a1 \uc2e4\ud328',
    s1: '\uc81c\ubaa9 \ucd94\uac00', s2: '\uc778\ud2b8\ub85c \uc790\ub974\uae30', s3: '\uc624\ub514\uc624 \uc815\uaddc\ud654', s4: '\uc2dc\ub124\ub9c8\ud2f1\ud558\uac8c',
  },
  th: {
    title: 'AfterFrame', sub: 'รีโมท', placeholder: 'ส่งข้อความถึงเอเจนต์…',
    connecting: 'กำลังเชื่อมต่อ…', live: 'เชื่อมต่อแล้ว', offline: 'กำลังเชื่อมต่อใหม่…',
    expired: 'การจับคู่หมดอายุ โปรดแสดง QR ใหม่บนคอมพิวเตอร์',
    empty: 'บอกสิ่งที่อยากแก้ เอเจนต์จะทำงานกับโปรเจกต์ที่เปิดบนคอมพิวเตอร์',
    working: 'กำลังทำงาน', attach: 'แนบรูปภาพ', attachFailed: 'ส่งรูปไม่สำเร็จ',
    s1: 'เพิ่มชื่อเรื่อง', s2: 'ตัดช่วงเปิด', s3: 'ปรับระดับเสียง', s4: 'ทำให้เป็นหนัง',
  },
  it: {
    title: 'AfterFrame', sub: 'Remoto', placeholder: 'Scrivi all\'agente…',
    connecting: 'Connessione…', live: 'Connesso', offline: 'Riconnessione…',
    expired: 'Abbinamento scaduto. Mostra un nuovo QR sul desktop.',
    empty: 'Chiedi una modifica: l\'agente lavora sul progetto aperto sul desktop.',
    working: 'Al lavoro', attach: 'Allega immagine', attachFailed: 'Invio immagine non riuscito',
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

function remotePage(locale: RemotePageLocale): string {
  const copy = COPY[locale] ?? COPY.en;
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="theme-color" content="#08080b"><meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
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
</style></head>
<body>
<header>
  <div class="mark">${BRAND_MARK}</div>
  <div class="hd">
    <b>${copy.title} <em>${copy.sub}</em></b>
    <span><i class="dot" id="dot"></i><span id="sub">${copy.connecting}</span></span>
  </div>
</header>
<div class="banner" id="banner">${copy.expired}</div>
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
  var main=$('main'),stream=$('stream'),input=$('input'),sendBtn=$('send'),
      attachBtn=$('attach'),fileInput=$('file'),previews=$('previews'),
      dot=$('dot'),subEl=$('sub'),banner=$('banner'),hint=$('hint');

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
    var es=new EventSource(base+'/events');
    es.addEventListener('open',function(){ live=true; banner.className='banner'; paint(); });
    es.addEventListener('snapshot',function(e){
      live=true;
      try{
        snap=JSON.parse(e.data);
        if(optimistic&&snap.messages.some(function(m){return m.role==='user'&&m.text===optimistic.text})) optimistic=null;
        paint();
      }catch(err){}
    });
    es.addEventListener('error',function(){
      live=false;
      if(es.readyState===2){ banner.className='banner show'; es.close(); paint(); return; }
      paint();
    });
  }

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
})();
</script>
</body></html>`;
}
