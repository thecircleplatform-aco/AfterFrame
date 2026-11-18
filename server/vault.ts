// The AfterFrame vault: one folder on the user's device that owns their projects
// AND their media, so the two can never drift apart.
//
// Previously the storage root (projects) and the upload directory were resolved
// independently: in the default profile uploads live at `public/media/uploads`
// inside the checkout, while projects live at `~/.afterframe`. That split is why
// media appeared to vanish — the two halves could be pointed at different
// places, and a vault copied to another machine carried the project documents
// but not the files they reference.
//
// A vault is just a directory with a marker file. The marker is what makes the
// folder self-describing:
//   - the app can recognise a folder it already owns instead of re-initialising
//     it over unrelated files,
//   - a copied or backed-up vault is adopted as-is, with no path rewriting,
//     because `/media/uploads/<name>` is already relative to the vault root,
//   - a future layout change can be migrated by reading `formatVersion`.
//
// This module is pure filesystem + validation. It never decides policy: whether
// the vault is the active root is answered by runtime-profile/data-dir.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';

export const VAULT_MARKER = '.afterframe-vault';
export const VAULT_FORMAT_VERSION = 1;

/** Subdirectories a vault always has, so paths never depend on first write. */
export const VAULT_LAYOUT = {
  media: join('media', 'uploads'),
  projects: 'project-store-v1',
  /** Portable SQLite database + its WAL sidecars. */
  database: 'project-store-v1.sqlite3',
} as const;

export interface VaultMarker {
  readonly formatVersion: number;
  readonly createdAt: number;
  /** Which app build created it; diagnostic only, never used for decisions. */
  readonly createdBy?: string;
}

export type VaultState =
  /** No marker; the directory is absent, empty, or holds unrelated files. */
  | { readonly kind: 'none' }
  /** A marker exists and parses. */
  | { readonly kind: 'vault'; readonly root: string; readonly marker: VaultMarker }
  /** A marker exists but is unreadable or from a newer app. Refuse to write. */
  | { readonly kind: 'invalid'; readonly root: string; readonly reason: string };

/** Suggested default location, shown as the pre-filled choice on first run. */
export function defaultVaultPath(home: string = homedir()): string {
  return join(home, 'Documents', 'AfterFrame');
}

/**
 * Resolve a user-supplied path to an absolute vault root.
 *
 * Accepts `~` / `~/…` and requires an absolute result, so a typo can never
 * silently create a vault inside whatever the process cwd happened to be.
 */
export function resolveVaultPath(raw: string, home: string = homedir()): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const expanded = trimmed === '~' ? home : trimmed.replace(/^~(?=\/)/, home);
  // `isAbsolute` is the platform-correct check (Windows drive letters, UNC and
  // POSIX roots all differ), so a relative typo can never resolve against the
  // process cwd and create a vault somewhere unexpected.
  if (!isAbsolute(expanded)) return null;
  const resolved = resolve(expanded);
  // A vault at the filesystem root would scatter media across the whole drive,
  // and adopts nothing meaningful. Compare against the RESOLVED root so a POSIX
  // path like "/" on Windows (which resolves to "C:\") is caught too.
  if (resolved === parse(resolved).root) return null;
  return resolved;
}

function parseMarker(text: string): VaultMarker | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const formatVersion = record.formatVersion;
    if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
      return null;
    }
    return {
      formatVersion,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
      ...(typeof record.createdBy === 'string' ? { createdBy: record.createdBy } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Inspect a directory without modifying it.
 *
 * Distinguishes "not a vault" from "a vault this build cannot read", because the
 * two need different answers: the first may be initialised, the second must be
 * refused so a newer layout is never overwritten by an older app.
 */
export async function inspectVault(root: string): Promise<VaultState> {
  const markerPath = join(root, VAULT_MARKER);
  if (!existsSync(markerPath)) return { kind: 'none' };
  let text: string;
  try {
    text = await readFile(markerPath, 'utf8');
  } catch (error) {
    return { kind: 'invalid', root, reason: `unreadable marker: ${String(error)}` };
  }
  const marker = parseMarker(text);
  if (!marker) return { kind: 'invalid', root, reason: 'marker is not valid JSON with a formatVersion' };
  if (marker.formatVersion > VAULT_FORMAT_VERSION) {
    return {
      kind: 'invalid',
      root,
      reason: `vault was written by a newer version (format ${marker.formatVersion}, this build reads ${VAULT_FORMAT_VERSION})`,
    };
  }
  return { kind: 'vault', root, marker };
}

export type VaultInitOutcome =
  | { readonly ok: true; readonly root: string; readonly created: boolean }
  | { readonly ok: false; readonly error: string };

/**
 * Create the vault layout (or adopt an existing one).
 *
 * Adopting is idempotent, and an unrelated NON-EMPTY folder is refused: pointing
 * the app at `~/Documents` must not copy the user's whole Documents folder into
 * a vault, nor write a marker that makes it look like one.
 */
export async function initVault(root: string, now = Date.now()): Promise<VaultInitOutcome> {
  const state = await inspectVault(root);
  if (state.kind === 'invalid') {
    return { ok: false, error: `this folder cannot be used as a vault: ${state.reason}` };
  }
  if (state.kind === 'vault') {
    await mkdir(join(root, VAULT_LAYOUT.media), { recursive: true });
    return { ok: true, root, created: false };
  }

  const existed = existsSync(root);
  let entries: string[] = [];
  try {
    entries = existed ? await readdir(root) : [];
  } catch (error) {
    return { ok: false, error: `this folder cannot be read: ${String(error)}` };
  }
  // Only "empty" or "only our own directories" may be adopted.
  const foreign = entries.filter((name) => name !== 'media' && name !== VAULT_LAYOUT.projects);
  if (foreign.length > 0) {
    const preview = foreign.slice(0, 3).join(', ');
    return {
      ok: false,
      error: `this folder already contains other files (${preview}${foreign.length > 3 ? ', …' : ''}); choose an empty folder or a new subfolder`,
    };
  }

  try {
    await mkdir(join(root, VAULT_LAYOUT.media), { recursive: true });
    const marker: VaultMarker = {
      formatVersion: VAULT_FORMAT_VERSION,
      createdAt: now,
      createdBy: `afterframe/${process.platform}-${process.arch}`,
    };
    // Written last: a half-created vault must look unoccupied, not adopted.
    await writeFile(join(root, VAULT_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  } catch (error) {
    return { ok: false, error: `could not create the vault: ${String(error)}` };
  }
  return { ok: true, root, created: true };
}

/** Media directory of a vault. Always derived, never stored, so it cannot drift. */
export function vaultMediaDir(root: string): string {
  return join(root, VAULT_LAYOUT.media);
}
