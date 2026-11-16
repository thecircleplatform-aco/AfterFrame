import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Plugin } from 'vite';
import { runtimeProfile } from '../runtime-profile.ts';

/**
 * Accounts for the self-hosted / desktop server.
 *
 * Cloudflare Pages serves this app from `auth-worker` on top of D1; the Node build
 * (VPS, Electron) has no worker, so it serves the same four endpoints out of
 * SQLite. The API contract is identical — same paths, same JSON, same cookie name
 * (`af_session`) — because `src/auth/session.ts` must not care which one answered.
 *
 * Password hashes use the worker's exact format
 * (`pbkdf2$100000$<b64 salt>$<b64 digest>`), so the two stores are interchangeable
 * and a hash can be copied between them without a migration script.
 */

const SESSION_COOKIE = 'af_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---- storage ---------------------------------------------------------------

let database: DatabaseSync | null = null;

function databasePath(): string {
  return join(runtimeProfile().rootDir, 'accounts-v1.sqlite3');
}

function db(): DatabaseSync {
  if (database) return database;
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const handle = new DatabaseSync(path);
  handle.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // Mirrors auth-worker/schema.sql, minus password_resets: reset mail is sent by
  // mail-worker, which a self-hosted box does not run.
  handle.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  `);
  database = handle;
  return handle;
}

export interface LocalAccount { id: string; email: string; name: string | null }

// ---- password + token primitives -------------------------------------------

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${digest.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, iterations, salt, expected] = String(stored ?? '').split('$');
  if (scheme !== 'pbkdf2' || !salt || !expected) return false;
  const digest = pbkdf2Sync(password, Buffer.from(salt, 'base64'), Number(iterations) || PBKDF2_ITERATIONS, 32, 'sha256');
  const want = Buffer.from(expected, 'base64');
  return digest.length === want.length && timingSafeEqual(digest, want);
}

const sessionTokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('base64');

// ---- http helpers ----------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function isSecureRequest(req: IncomingMessage): boolean {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  if (forwarded) return forwarded === 'https';
  return Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

function sessionCookie(req: IncomingMessage, token: string, maxAgeSeconds: number): string {
  // First-party cookie: no Domain, SameSite=Lax. Secure is added only over TLS so
  // `http://localhost` still works in dev.
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAgeSeconds}`;
}

function clearedCookie(req: IncomingMessage): string {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

/** Coarse in-memory throttle, same shape as the worker's. */
const attempts = new Map<string, { count: number; resetAt: number }>();
function allow(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const hit = attempts.get(key);
  if (!hit || now > hit.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  hit.count += 1;
  return hit.count <= limit;
}

// ---- handlers --------------------------------------------------------------

const normalizeEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase();

function createSession(req: IncomingMessage, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db().prepare(
    'INSERT INTO sessions (id, user_id, token_hash, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    randomUUID(), userId, sessionTokenHash(token),
    String(req.headers['user-agent'] ?? '').slice(0, 200), now, now + SESSION_TTL_MS,
  );
  return token;
}

function accountForToken(req: IncomingMessage): LocalAccount | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = db().prepare(
    `SELECT u.id AS id, u.email AS email, u.name AS name, s.expires_at AS expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  ).get(sessionTokenHash(token)) as { id: string; email: string; name: string | null; expiresAt: number } | undefined;
  if (!row || row.expiresAt < Date.now()) return null;
  return { id: row.id, email: row.email, name: row.name };
}

async function handleSignup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');
  const name = body.name ? String(body.name).trim().slice(0, 80) : null;

  if (!EMAIL_RE.test(email)) { sendJson(res, 400, { error: 'invalid_email', message: 'Enter a valid email address.' }); return; }
  if (password.length < MIN_PASSWORD) { sendJson(res, 400, { error: 'weak_password', message: `Use at least ${MIN_PASSWORD} characters.` }); return; }
  if (!allow(`signup:${req.socket.remoteAddress ?? 'local'}`, 10)) {
    sendJson(res, 429, { error: 'rate_limited', message: 'Too many attempts. Try again shortly.' }); return;
  }

  const existing = db().prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) { sendJson(res, 409, { error: 'email_taken', message: 'That email already has an account.' }); return; }

  const id = randomUUID();
  const now = Date.now();
  db().prepare(
    'INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, email, name, hashPassword(password), now, now);

  const token = createSession(req, id);
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_TTL_MS / 1000));
  sendJson(res, 201, { user: { id, email, name } });
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');

  if (!EMAIL_RE.test(email) || !password) {
    sendJson(res, 400, { error: 'invalid_input', message: 'Enter your email and password.' }); return;
  }
  if (!allow(`login:${email}`, 12)) {
    sendJson(res, 429, { error: 'rate_limited', message: 'Too many attempts. Try again shortly.' }); return;
  }

  const row = db().prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
    .get(email) as { id: string; email: string; name: string | null; password_hash: string } | undefined;
  // Same answer whether the account is missing or the password is wrong.
  if (!row || !verifyPassword(password, row.password_hash)) {
    sendJson(res, 401, { error: 'invalid_credentials', message: 'Email or password is incorrect.' }); return;
  }

  const token = createSession(req, row.id);
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_TTL_MS / 1000));
  sendJson(res, 200, { user: { id: row.id, email: row.email, name: row.name } });
}

function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionTokenHash(token));
  res.setHeader('Set-Cookie', clearedCookie(req));
  sendJson(res, 200, { ok: true });
}

function handleMe(req: IncomingMessage, res: ServerResponse): void {
  const account = accountForToken(req);
  if (!account) { sendJson(res, 401, { error: 'unauthenticated', message: 'Not signed in.' }); return; }
  sendJson(res, 200, { user: account });
}

// ---- plugin ----------------------------------------------------------------

export function localAuthPlugin(): Plugin {
  return {
    name: 'afterframe-local-auth',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split('?')[0]?.replace(/\/+$/, '') ?? '/';
        if (!path.startsWith('/auth/')) { next(); return; }
        const key = `${req.method ?? 'GET'} ${path}`;
        const run = async (): Promise<void> => {
          switch (key) {
            case 'POST /auth/signup': await handleSignup(req, res); return;
            case 'POST /auth/login': await handleLogin(req, res); return;
            case 'POST /auth/logout': handleLogout(req, res); return;
            case 'GET /auth/me': handleMe(req, res); return;
            // Password mail needs mail-worker, which only the Cloudflare deployment runs.
            case 'POST /auth/forgot-password':
            case 'POST /auth/reset-password':
              sendJson(res, 501, {
                error: 'not_supported',
                message: 'Password reset is only available on the hosted service.',
              });
              return;
            default:
              sendJson(res, 404, { error: 'not_found', message: 'Unknown endpoint.' });
          }
        };
        void run().catch((error: unknown) => {
          server.config.logger.error(`[auth] ${error instanceof Error ? error.message : String(error)}`);
          if (!res.headersSent) sendJson(res, 500, { error: 'server_error', message: 'Sign-in failed.' });
        });
      });
    },
  };
}
