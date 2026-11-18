// Verifies the vault folder contract: marker, adoption and refusal.
//
// These are the guarantees that keep a user's folder safe. A vault is "just a
// directory", so the only thing standing between a typo and scattering files
// through ~/Documents is the marker plus an empty-or-ours adoption rule.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VAULT_FORMAT_VERSION,
  VAULT_MARKER,
  defaultVaultPath,
  initVault,
  inspectVault,
  resolveVaultPath,
  vaultMediaDir,
} from './vault.ts';

const root = await mkdtemp(join(tmpdir(), 'afterframe-vault-'));

try {
  // ---- path resolution ---------------------------------------------------
  assert.equal(resolveVaultPath(''), null, 'an empty path is not a vault');
  assert.equal(resolveVaultPath('relative/folder'), null,
    'a relative path must never resolve against the process cwd');
  assert.equal(resolveVaultPath('/'), null, 'a filesystem root is refused');
  assert.equal(resolveVaultPath('C:\\'), null, 'a Windows drive root is refused');
  const home = join(root, 'home');
  assert.equal(resolveVaultPath('~/Videos', home), join(home, 'Videos'),
    '~/ must expand against the supplied home');
  assert.equal(resolveVaultPath(join(root, 'abs'), home), join(root, 'abs'),
    'an absolute path is kept as-is');
  assert.equal(defaultVaultPath(home), join(home, 'Documents', 'AfterFrame'));

  // ---- fresh init --------------------------------------------------------
  const fresh = join(root, 'fresh');
  assert.deepEqual(await inspectVault(fresh), { kind: 'none' },
    'an absent directory is not a vault');

  const created = await initVault(fresh, 1_700_000_000_000);
  assert.equal(created.ok, true);
  assert.equal(created.ok && created.created, true, 'a new folder is created');
  assert.ok(existsSync(join(fresh, VAULT_MARKER)), 'the marker is written');
  assert.ok(existsSync(vaultMediaDir(fresh)), 'the media directory exists immediately');

  const state = await inspectVault(fresh);
  assert.equal(state.kind, 'vault');
  if (state.kind === 'vault') {
    assert.equal(state.marker.formatVersion, VAULT_FORMAT_VERSION);
    assert.equal(state.marker.createdAt, 1_700_000_000_000);
  }

  // ---- idempotent adoption (the "copy the vault elsewhere" case) ---------
  const again = await initVault(fresh);
  assert.equal(again.ok && again.created, false, 'reopening an existing vault does not recreate it');

  // ---- refusal: an unrelated non-empty folder ----------------------------
  const occupied = join(root, 'occupied');
  await mkdir(occupied, { recursive: true });
  await writeFile(join(occupied, 'taxes.pdf'), 'do not touch');
  const refused = await initVault(occupied);
  assert.equal(refused.ok, false, 'a folder holding other files must be refused');
  assert.match(refused.ok ? '' : refused.error, /already contains other files/);
  assert.equal(existsSync(join(occupied, VAULT_MARKER)), false,
    'a refused folder must not be stamped with a marker');

  // ---- refusal: a marker from a newer app -------------------------------
  const future = join(root, 'future');
  await mkdir(future, { recursive: true });
  await writeFile(join(future, VAULT_MARKER), JSON.stringify({
    formatVersion: VAULT_FORMAT_VERSION + 1, createdAt: 0,
  }));
  const futureState = await inspectVault(future);
  assert.equal(futureState.kind, 'invalid', 'a newer format is not silently adopted');
  const futureInit = await initVault(future);
  assert.equal(futureInit.ok, false, 'a newer-format vault must not be re-initialised');

  // ---- refusal: corrupt marker ------------------------------------------
  const corrupt = join(root, 'corrupt');
  await mkdir(corrupt, { recursive: true });
  await writeFile(join(corrupt, VAULT_MARKER), 'not json');
  const corruptState = await inspectVault(corrupt);
  assert.equal(corruptState.kind, 'invalid', 'a corrupt marker is reported, not overwritten');

  // ---- a folder that already only contains our layout is adopted --------
  const partial = join(root, 'partial');
  await mkdir(vaultMediaDir(partial), { recursive: true });
  const adopted = await initVault(partial);
  assert.equal(adopted.ok && adopted.created, true,
    'a folder with only our own directories can be adopted');
  // Nothing foreign was invented.
  assert.deepEqual((await readdir(partial)).sort(), [VAULT_MARKER, 'media'].sort());
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('vault: path resolution, marker adoption and refusal verified');
