// Moving the project database into a vault must be safe or not happen at all.
//
// The property under test is the one the media/vault split originally broke:
// after choosing a folder, the vault must actually contain the projects — not
// an empty `project-store-v1/` directory that only looks like it does. Because
// this touches every project a user has, the failure modes matter more than the
// happy path:
//
//   - a destination that already holds a database must NEVER be overwritten
//     (that is someone's other vault, or an older backup);
//   - a crash mid-copy must not leave a truncated database in place;
//   - the source must survive, so a bad move is always recoverable.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  relocateDatabaseToVault,
  vaultDatabaseLooksTruncated,
  vaultHoldsProjectDatabase,
} from './vault-store.ts';
import { VAULT_LAYOUT } from './vault.ts';

const fixture = await mkdtemp(join(tmpdir(), 'occ-vault-store-'));

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

try {
  // --- a fresh install has no source yet: the app creates it later --------
  const missing = await relocateDatabaseToVault({
    from: join(fixture, 'nope.sqlite3'),
    to: join(fixture, 'vault-a', VAULT_LAYOUT.database),
  });
  assert.equal(missing.kind, 'no-source', 'a missing source must not be reported as an error');

  // --- the happy path: copy, source preserved ----------------------------
  const source = join(fixture, 'profile', 'project-store-v1.sqlite3');
  await mkdir(join(fixture, 'profile'), { recursive: true });
  await writeFile(source, 'PROJECTS-AND-CHATS');
  const vaultRoot = join(fixture, 'vault-a');

  const copied = await relocateDatabaseToVault({
    from: source,
    to: join(vaultRoot, VAULT_LAYOUT.database),
  });
  assert.equal(copied.kind, 'copied', 'a fresh destination must be written');
  assert.equal(
    await readFile(join(vaultRoot, VAULT_LAYOUT.database), 'utf8'),
    'PROJECTS-AND-CHATS',
    'the vault must contain the actual database, not an empty directory',
  );
  assert.equal(
    await readFile(source, 'utf8'),
    'PROJECTS-AND-CHATS',
    'the source must be kept so a bad move stays recoverable',
  );
  assert.equal(
    await sizeOf(`${join(vaultRoot, VAULT_LAYOUT.database)}.partial`),
    null,
    'the temporary file must not be left behind',
  );

  // --- the vault now reports as holding projects -------------------------
  assert.equal(
    await vaultHoldsProjectDatabase(vaultRoot, VAULT_LAYOUT.database),
    true,
    'a populated vault must report that it owns the projects',
  );
  const emptyVault = join(fixture, 'vault-empty');
  await mkdir(emptyVault, { recursive: true });
  assert.equal(
    await vaultHoldsProjectDatabase(emptyVault, VAULT_LAYOUT.database),
    false,
    'an empty vault directory must NOT claim to hold the projects',
  );

  // --- an occupied destination is never overwritten ----------------------
  await writeFile(join(vaultRoot, VAULT_LAYOUT.database), 'SOMEONE-ELSES-VAULT');
  const blocked = await relocateDatabaseToVault({
    from: source,
    to: join(vaultRoot, VAULT_LAYOUT.database),
  });
  assert.equal(blocked.kind, 'destination-occupied');
  assert.equal(
    await readFile(join(vaultRoot, VAULT_LAYOUT.database), 'utf8'),
    'SOMEONE-ELSES-VAULT',
    'an existing vault database must never be clobbered by a migration',
  );

  // --- a zero-byte destination is treated as empty, not as data ----------
  const partialVault = join(fixture, 'vault-partial');
  await mkdir(partialVault, { recursive: true });
  await writeFile(join(partialVault, VAULT_LAYOUT.database), '');
  const recovered = await relocateDatabaseToVault({
    from: source,
    to: join(partialVault, VAULT_LAYOUT.database),
  });
  assert.equal(
    recovered.kind,
    'copied',
    'a zero-byte leftover from an interrupted copy must be replaced, not trusted',
  );

  // --- same path is a no-op ---------------------------------------------
  const same = await relocateDatabaseToVault({
    from: join(vaultRoot, VAULT_LAYOUT.database),
    to: join(vaultRoot, VAULT_LAYOUT.database),
  });
  assert.equal(same.kind, 'already-there');

  // --- WAL sidecars travel with the main file ---------------------------
  const walSource = join(fixture, 'profile', 'with-wal.sqlite3');
  await writeFile(walSource, 'MAIN');
  await writeFile(`${walSource}-wal`, 'PENDING-WRITES');
  const walVault = join(fixture, 'vault-wal');
  const walCopy = await relocateDatabaseToVault({
    from: walSource,
    to: join(walVault, VAULT_LAYOUT.database),
  });
  assert.equal(walCopy.kind, 'copied');
  assert.equal(
    await readFile(`${join(walVault, VAULT_LAYOUT.database)}-wal`, 'utf8'),
    'PENDING-WRITES',
    'the WAL holds committed writes; leaving it behind silently loses them',
  );

  // --- truncated-copy detection -----------------------------------------
  const truncatedVault = join(fixture, 'vault-truncated');
  await mkdir(truncatedVault, { recursive: true });
  await writeFile(join(truncatedVault, VAULT_LAYOUT.database), 'x');
  await writeFile(`${join(truncatedVault, VAULT_LAYOUT.database)}-wal`, 'BIGPENDINGDATA');
  assert.equal(
    await vaultDatabaseLooksTruncated(truncatedVault, VAULT_LAYOUT.database),
    true,
    'a tiny main file beside a large WAL is the signature of a copy that missed its sidecar',
  );

  console.log('vault-store: project databases move into the vault safely, or not at all');
} finally {
  await rm(fixture, { recursive: true, force: true }).catch(() => undefined);
}
