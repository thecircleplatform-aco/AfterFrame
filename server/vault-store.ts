// Moving the project database into (or out of) a vault.
//
// The vault already owns media; this makes it own the project documents too, so
// "copy the folder to another machine" carries the timeline AND the clips it
// references. The failure mode to design against is the one that produced the
// original "media disappeared" bug: the two halves being pointed at different
// places, so a vault looks complete but resolves to nothing.
//
// The rules here are deliberately conservative:
//   - Never overwrite a non-empty destination database. An existing vault wins;
//     the local copy is left alone for the user to resolve.
//   - Copy, verify, then switch the pointer. The active database is never
//     deleted by this module — it stays as a last-resort backup.
//   - Sidecars (`-wal`, `-shm`) belong to the source database. Copying the main
//     file without them loses every transaction still in the WAL, so they are
//     handled explicitly: a live database is checkpointed first, and the
//     sidecars are only carried when the main file is copied while closed.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface RelocateDatabaseInput {
  /** The database currently in use (usually inside the profile root). */
  readonly from: string;
  /** Destination path, typically `<vault>/project-store-v1.sqlite3`. */
  readonly to: string;
}

export type RelocateDatabaseOutcome =
  /** Already at the destination — nothing to do. */
  | { readonly kind: 'already-there' }
  /** Copied the source database into place. */
  | { readonly kind: 'copied'; readonly bytes: number }
  /** A usable database already lives there; the source was left untouched. */
  | { readonly kind: 'destination-occupied'; readonly destination: string }
  /** The source does not exist yet (fresh install); the app will create it. */
  | { readonly kind: 'no-source' }
  | { readonly kind: 'failed'; readonly error: string };

/** SQLite sidecars that make up a consistent on-disk database. */
export const SQLITE_SIDECARS = ['-wal', '-shm'] as const;

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * A destination counts as occupied when its main file exists and is non-empty.
 * A zero-byte file is what an interrupted copy leaves behind, so it must be
 * treated as "nothing here" and overwritten rather than as a real database.
 */
async function destinationOccupied(path: string): Promise<boolean> {
  const size = await fileSize(path);
  return size !== null && size > 0;
}

/**
 * Copy a database into the vault.
 *
 * The caller MUST have closed the database (and every long-lived connection to
 * it) before calling this: SQLite in WAL mode keeps committed data in `-wal`
 * until a checkpoint, so copying a live file copies a stale snapshot. `close()`
 * checkpoints as the last connection goes away, which is why the copy is only
 * safe afterwards.
 */
export async function relocateDatabaseToVault(
  input: RelocateDatabaseInput,
): Promise<RelocateDatabaseOutcome> {
  const from = input.from;
  const to = input.to;
  if (basename(from) === basename(to) && dirname(from) === dirname(to)) {
    return { kind: 'already-there' };
  }
  const sourceSize = await fileSize(from);
  if (sourceSize === null) return { kind: 'no-source' };

  try {
    await mkdir(dirname(to), { recursive: true });
  } catch (error) {
    return { kind: 'failed', error: `could not create the vault database folder: ${String(error)}` };
  }

  if (await destinationOccupied(to)) {
    return { kind: 'destination-occupied', destination: to };
  }

  try {
    // Copy to a temporary sibling first, then rename. A crash mid-copy then
    // leaves `<name>.partial` rather than a truncated database that the next
    // launch would happily open and corrupt.
    const partial = `${to}.partial`;
    await copyFile(from, partial);
    // Sidecars are copied only when present; a cleanly closed database has none
    // (close() checkpoints and removes them).
    for (const suffix of SQLITE_SIDECARS) {
      const sidecar = `${from}${suffix}`;
      if (existsSync(sidecar)) await copyFile(sidecar, `${partial}${suffix}`);
    }
    const { rename } = await import('node:fs/promises');
    await rename(partial, to);
    for (const suffix of SQLITE_SIDECARS) {
      const partialSidecar = `${partial}${suffix}`;
      if (existsSync(partialSidecar)) await rename(partialSidecar, `${to}${suffix}`);
    }
    return { kind: 'copied', bytes: sourceSize };
  } catch (error) {
    return { kind: 'failed', error: `could not copy the project database into the vault: ${String(error)}` };
  }
}

/**
 * Whether a vault holds a usable project database.
 *
 * Used by the settings UI to report honestly: an empty `project-store-v1/`
 * directory used to look like the vault owned the projects when it owned
 * nothing at all.
 */
export async function vaultHoldsProjectDatabase(root: string, databaseName: string): Promise<boolean> {
  return (await fileSize(join(root, databaseName))) !== null;
}

/**
 * A vault copied from another machine may carry the WAL sidecars but not a
 * checkpointed main file. Refuse to adopt such a folder silently — a database
 * whose WAL is missing is a database missing its newest writes.
 */
export async function vaultDatabaseLooksTruncated(root: string, databaseName: string): Promise<boolean> {
  const main = await fileSize(join(root, databaseName));
  if (main === null || main === 0) return false;
  const wal = await fileSize(join(root, `${databaseName}-wal`));
  // A large WAL next to a tiny main file is the signature of a copy that took
  // the main file but not its sidecar.
  return wal !== null && main < 4096;
}

