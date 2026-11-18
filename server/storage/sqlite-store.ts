// SQLite-backed project-store lifecycle and primitives.
//
// Initialization imports legacy data atomically before any database access.
// SQLite is the sole persistent backend; original JSON files remain backups.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectIdFromProjectStoreKey } from '../../shared/project-store-validation.ts';
import { runtimeProfile } from '../runtime-profile.ts';
import {
  RECEIPT_PHASE,
  ensureJsonImported,
  readAuthoritativeImportReceipt,
} from './sqlite-migration.ts';

export interface StoredEntryValue {
  found: boolean;
  value?: unknown;
}

let database: DatabaseSync | null = null;
let databaseHadKvTableAtOpen = false;
let initialization: Promise<void> | undefined;
let ready = false;

/**
 * Set when the store is running from a vault, so the warning below can name the
 * real location instead of guessing.
 */
let configuredStorePath: string | null = null;

/**
 * Point the store at a specific database file.
 *
 * The vault is the authoritative storage root when the user has chosen one: its
 * `project-store-v1.sqlite3` holds the projects, so a vault folder copied to
 * another machine carries the timeline as well as the media. This must be
 * called BEFORE the database is first opened; once a connection exists the
 * path is fixed for the process, so a relocation has to restart the store.
 *
 * Isolated dev profiles deliberately do not consult the vault pointer (see
 * runtime-profile.ts): a developer's machine-wide vault must not capture a
 * checkout's data.
 */
export function configureSqliteStorePath(path: string | null): void {
  if (database) throw new Error('cannot change the SQLite store path while the database is open');
  configuredStorePath = path;
}

export function storePath(): string {
  if (configuredStorePath) return configuredStorePath;
  const profile = runtimeProfile();
  // The vault database wins when the user has chosen a storage folder: that is
  // what makes a copied vault carry the projects, not just the media.
  if (profile.mode === 'default' && profile.projectDatabasePath) {
    return profile.projectDatabasePath;
  }
  // Keep the database outside the read-only legacy backup directory.
  return join(profile.rootDir, 'project-store-v1.sqlite3');
}

function openDatabase(): DatabaseSync {
  if (database) return database;
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000;');
  try {
    const existingKvTable = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv'
    `).get() as { name?: string } | undefined;
    databaseHadKvTableAtOpen = existingKvTable?.name === 'kv';
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS kv (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    `);
    database = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Readiness only: never opens a database or selects a different backend. */
export function sqliteStoreReady(): boolean {
  return ready;
}

/** All callers share one startup import; failure blocks every storage operation. */
export function initializeSqliteProjectStore(): Promise<void> {
  initialization ??= Promise.resolve().then(() => {
    const db = openDatabase();
    ensureJsonImported(db, runtimeProfile(), databaseHadKvTableAtOpen);
    const receipt = readAuthoritativeImportReceipt(db);
    if (!receipt || receipt.phase !== RECEIPT_PHASE) {
      throw new Error('SQLite initialization completed without an authoritative receipt');
    }
    ready = true;
  }).catch((error: unknown) => {
    ready = false;
    initialization = undefined;
    throw error;
  });
  return initialization;
}

function requireDatabase(): DatabaseSync {
  if (!ready || !database) throw new Error('SQLite project store is not initialized');
  return database;
}

/**
 * Connections the store owns besides its main one. fulltext-search.ts and
 * semantic-vectors.ts each hold a second long-lived DatabaseSync on the same
 * file, and Windows refuses to delete a file while a handle is open: a verifier
 * that closed only the main connection still failed its temp-library cleanup
 * with EPERM after the assertions had passed. Those modules register their own
 * closer at import time (importing them from here would be a cycle).
 */
const connectionClosers = new Set<() => void>();

export function registerSqliteStoreConnectionCloser(closer: () => void): void {
  connectionClosers.add(closer);
}

/** Close every connection and reset process state (verifier/profile isolation). */
export function resetSqliteStoreForTests(): void {
  database?.close();
  database = null;
  databaseHadKvTableAtOpen = false;
  initialization = undefined;
  ready = false;
  for (const close of connectionClosers) close();
}

/**
 * Close every connection so the database file can be moved.
 *
 * `DatabaseSync.close()` is what performs the final WAL checkpoint, so this is
 * the only correct way to make the on-disk file self-contained enough to copy.
 * The store comes back on the next `initializeSqliteProjectStore()` — and that
 * call re-reads `storePath()`, which is how the relocation takes effect.
 *
 * Returns the number of closers invoked for diagnostics.
 */
export function closeSqliteStore(): number {
  let closed = 0;
  try {
    if (database) {
      database.close();
      closed += 1;
    }
  } finally {
    database = null;
    databaseHadKvTableAtOpen = false;
    initialization = undefined;
    ready = false;
  }
  for (const close of connectionClosers) {
    try {
      close();
      closed += 1;
    } catch {
      // A secondary connection that already closed must not block the move.
    }
  }
  return closed;
}

const encode = (value: unknown): string => JSON.stringify(value);
const decode = (raw: string): unknown => JSON.parse(raw);

export interface SQLiteImmediateStore {
  readEntry(key: string): StoredEntryValue;
  writeEntry(key: string, value: unknown): void;
  deleteEntry(key: string): void;
}

function immediateStore(db: DatabaseSync): SQLiteImmediateStore {
  const read = db.prepare('SELECT v FROM kv WHERE k = ?');
  const write = db.prepare(
    'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
  );
  const remove = db.prepare('DELETE FROM kv WHERE k = ?');
  return {
    readEntry: (key) => {
      const row = read.get(key) as { v: string } | undefined;
      return row ? { found: true, value: decode(row.v) } : { found: false };
    },
    writeEntry: (key, value) => { write.run(key, encode(value)); },
    deleteEntry: (key) => { remove.run(key); },
  };
}

/** Execute a synchronous read/validate/write state transition under SQLite's writer lock. */
export function sqliteImmediateTransaction<T>(work: (store: SQLiteImmediateStore) => T): T {
  const db = requireDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work(immediateStore(db));
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Full snapshot (equivalent of readDirectoryEntries). */
export async function sqliteReadAll(): Promise<Record<string, unknown>> {
  const rows = requireDatabase().prepare('SELECT k, v FROM kv').all() as Array<{
    k: string;
    v: string;
  }>;
  const entries: Record<string, unknown> = {};
  for (const row of rows) entries[row.k] = decode(row.v);
  return entries;
}

/** Single key read (equivalent of readEntryFile). */
export async function sqliteReadEntry(key: string): Promise<StoredEntryValue> {
  const row = requireDatabase().prepare('SELECT v FROM kv WHERE k = ?').get(key) as
    | { v: string }
    | undefined;
  return row ? { found: true, value: decode(row.v) } : { found: false };
}

/** Single key write (equivalent of writeStoredEntry). */
export async function sqliteWriteEntry(key: string, value: unknown): Promise<void> {
  requireDatabase()
    .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .run(key, encode(value));
}

/** Full replace in one transaction (equivalent of writeEntries). */
export async function sqliteWriteAll(entries: Record<string, unknown>): Promise<void> {
  const db = requireDatabase();
  const stmt = db.prepare(
    'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
  );
  db.exec('BEGIN');
  try {
    for (const [key, value] of Object.entries(entries)) stmt.run(key, encode(value));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Single key delete (equivalent of durableRemove(entryPath)). */
export async function sqliteDeleteEntry(key: string): Promise<void> {
  requireDatabase().prepare('DELETE FROM kv WHERE k = ?').run(key);
}

/** Remove every key whose parsed owning project id matches exactly. */
export async function sqliteDeleteProjectEntries(projectId: string): Promise<void> {
  const db = requireDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db.prepare('SELECT k FROM kv').all() as Array<{ k: string }>;
    const remove = db.prepare('DELETE FROM kv WHERE k = ?');
    for (const row of rows) {
      if (projectIdFromProjectStoreKey(row.k) === projectId) remove.run(row.k);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
