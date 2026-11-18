// Verifies vault maintenance: hash relink and unused-media reporting.
//
// Both operations can destroy or corrupt a user's media if they are wrong, so the
// assertions here focus on the refusals as much as the happy path:
//   - relink must never copy bytes whose hash does not match the record,
//   - relink must never resolve a name outside the media directory,
//   - cleanup must never report a file that any project still references,
//   - cleanup must re-check references at delete time, not trust the report.
//
// The project store is stubbed through `readStore` injection so the test does not
// depend on the real SQLite store or on the user's actual projects.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---- project store stub ---------------------------------------------------
// The maintenance functions take a `ReferenceSource`, so this test drives them
// against a synthetic store instead of the user's real SQLite database. Proving
// that a delete is safe by mutating real projects would be the very risk these
// functions exist to avoid.
const storeEntries: Record<string, unknown> = {};
const references = async (): Promise<Record<string, unknown>> => storeEntries;

import {
  applyRelink, deleteUnusedMedia, findUnusedMedia, listMediaFiles, planRelink,
} from './vault-maintenance.ts';

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');

const root = await mkdtemp(join(tmpdir(), 'afterframe-vault-maint-'));
const media = join(root, 'media');

/** Write a project document referencing the given assets. */
function project(id: string, assets: { src: string; hash?: string }[]): void {
  storeEntries[`project:${id}`] = {
    version: 1,
    assets: assets.map((asset, index) => ({
      id: `a${index}`,
      name: `asset-${index}`,
      kind: 'video',
      src: asset.src,
      durationInFrames: 30,
      ...(asset.hash ? { sourceContentHash: asset.hash } : {}),
    })),
    timelines: [],
    activeTimelineId: 't0',
  };
}

try {
  // ---- fixture ----------------------------------------------------------
  await mkdir(media, { recursive: true });
  const videoBytes = 'video-bytes-v1';
  const videoHash = sha256(videoBytes);
  // Present and referenced.
  await writeFile(join(root, 'media', 'keep.mp4'), videoBytes);
  // The same bytes under a DIFFERENT name: this is what a vault restored from a
  // backup, or a hand-renamed file, looks like.
  await writeFile(join(root, 'media', 'renamed-copy.mp4'), videoBytes);
  // Orphaned: on disk, referenced by nobody.
  await writeFile(join(root, 'media', 'orphan.mp4'), 'orphan-bytes');
  // A non-media file must never be reported as unused media.
  await writeFile(join(root, 'media', 'notes.txt'), 'keep me');

  project('p1', [
    { src: '/media/uploads/keep.mp4', hash: videoHash },
    // Missing, but its bytes exist as renamed-copy.mp4 → recoverable.
    { src: '/media/uploads/lost.mp4', hash: videoHash },
  ]);
  project('p2', [
    // Missing, no hash on record → NOT recoverable by guessing.
    { src: '/media/uploads/unknown.mp4' },
  ]);

  // ---- listing ----------------------------------------------------------
  const files = await listMediaFiles(media);
  const names = files.map((file) => file.name).sort();
  assert.deepEqual(names, ['keep.mp4', 'orphan.mp4', 'renamed-copy.mp4'],
    'only media extensions are listed; notes.txt is ignored');

  // ---- relink plan ------------------------------------------------------
  const plan = await planRelink(media, references);
  assert.equal(plan.missingCount, 2, 'lost.mp4 and unknown.mp4 are both missing');
  assert.equal(plan.recoverable.length, 1, 'only the hash-matched file is recoverable');
  assert.equal(plan.recoverable[0]?.expectedName, 'lost.mp4');
  assert.equal(plan.recoverable[0]?.foundName, 'renamed-copy.mp4');
  assert.deepEqual(plan.recoverable[0]?.projectIds, ['p1']);
  assert.deepEqual(plan.unrecoverable.map((entry) => entry.name), ['unknown.mp4'],
    'a reference with no hash is never guessed at');

  // ---- relink refuses tampered bytes -----------------------------------
  const tampered = await applyRelink(media, [{
    expectedName: 'lost.mp4',
    foundName: 'renamed-copy.mp4',
    hash: 'a'.repeat(64), // wrong on purpose
    projectIds: [],
    bytes: 0,
  }]);
  assert.equal(tampered.restored.length, 0, 'a hash mismatch must not be copied');
  assert.match(tampered.failed[0]?.error ?? '', /changed since the plan/);

  // ---- relink refuses path traversal -----------------------------------
  const escape = await applyRelink(media, [{
    expectedName: '../escaped.mp4',
    foundName: 'renamed-copy.mp4',
    hash: videoHash,
    projectIds: [],
    bytes: 0,
  }]);
  assert.equal(escape.restored.length, 0, 'a traversal name must be refused');
  assert.match(escape.failed[0]?.error ?? '', /unsafe/);

  // ---- relink applies --------------------------------------------------
  const applied = await applyRelink(media, [...plan.recoverable]);
  assert.equal(applied.restored.length, 1);
  assert.equal(applied.restored[0]?.expectedName, 'lost.mp4');
  assert.equal(await readFile(join(media, 'lost.mp4'), 'utf8'), videoBytes,
    'the restored file holds the recorded bytes');

  // Re-planning now finds nothing to restore.
  const after = await planRelink(media, references);
  assert.equal(after.recoverable.length, 0, 'relink is idempotent');
  assert.equal(after.missingCount, 1, 'only the unknown.mp4 reference remains missing');

  // ---- unused media ----------------------------------------------------
  const unused = await findUnusedMedia(media, references);
  // After the relink, `lost.mp4` exists again, so the duplicate that supplied its
  // bytes is no longer referenced by name and is correctly reported as unused.
  // This is the intended outcome: the file is a byte-identical leftover, and
  // surfacing it is how the vault stops growing without bound.
  assert.deepEqual(unused.files.map((file) => file.name).sort(), ['orphan.mp4', 'renamed-copy.mp4'],
    'both the true orphan and the now-duplicate relink source are reported');
  assert.equal(unused.missingReferences, 1, 'the unresolved reference is reported separately');

  // ---- delete refuses a file that became referenced ---------------------
  // Simulate a save landing between the report and the delete.
  project('p3', [{ src: '/media/uploads/orphan.mp4' }]);
  const refusedDelete = await deleteUnusedMedia(media, ['orphan.mp4'], references);
  assert.deepEqual(refusedDelete.deleted, [], 'a file that is now referenced must not be deleted');
  assert.match(refusedDelete.kept[0]?.reason ?? '', /referenced by a project/);

  // Still refuses traversal.
  const refusedTraversal = await deleteUnusedMedia(media, ['../media/keep.mp4'], references);
  assert.deepEqual(refusedTraversal.deleted, []);
  assert.match(refusedTraversal.kept[0]?.reason ?? '', /unsafe/);

  // ---- delete works when genuinely unreferenced ------------------------
  delete storeEntries['project:p3'];
  const deleted = await deleteUnusedMedia(media, ['orphan.mp4'], references);
  assert.deepEqual(deleted.deleted, ['orphan.mp4']);
  assert.deepEqual(deleted.kept, []);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('vault-maintenance: relink, hash verification and unused-media safety verified');
