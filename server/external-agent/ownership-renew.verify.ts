// Regression: a browser editor must be able to RENEW its edit ownership after
// someone else changed the project.
//
// The bug this pins: `renewProjectEditOwnership` returned `stale` whenever the
// claim's baseRevision differed from the stored project revision. Once any other
// writer bumped the revision (another window, the agent, a restore, or a leftover
// claim from an earlier session), the editor could never renew again:
//
//   editor loads → register → claim ok
//   other writer saves → revision moves
//   editor renews → stale (409) → retries every ~1.5s → 409 forever
//   every project save → rejected → "Failed to save project"
//   user imports media → kept only in memory → gone after refresh
//
// Because every project in the store had a stale ownership row, this affected
// every editor, not just an unlucky one. The editor is the only writer in this
// app's supported shape, so its newer intent must win over a stranded pointer.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = await mkdtemp(join(tmpdir(), 'occ-ownership-renew-'));
const previousDataDir = process.env.AFTERFRAME_DATA_DIR;
process.env.AFTERFRAME_DATA_DIR = fixture;

// Store paths are captured at import time; keep the real SQLite store isolated.
const { setStoredEntry } = await import('../plugins/project-store.ts');
const {
  claimBrowserProjectOwnership,
  renewProjectEditOwnership,
} = await import('./project-edit-ownership.ts');
const { docFromTimeline } = await import('../../src/persist/projectStore.ts');
const { INITIAL } = await import('../../src/editor/initial.ts');
const { revisionOf } = await import('../../src/agent/external-edit-session.ts');

const projectId = `renew-${crypto.randomUUID()}`;
const editorId = 'editor-under-test';

try {
  const initial = docFromTimeline({ ...INITIAL, width: 1920, height: 1080, items: [] });
  await setStoredEntry(`project:${projectId}`, initial);
  const initialRevision = revisionOf(initial);

  const claim = await claimBrowserProjectOwnership(projectId, editorId, initialRevision);
  assert.equal(claim.status, 'claimed', 'a fresh editor claims ownership');
  if (claim.status !== 'claimed') throw new Error('claim failed');

  // 1. Renewing at the SAME revision is fine (the easy path).
  const sameRevision = await renewProjectEditOwnership(claim.claim, initialRevision);
  assert.equal(sameRevision.status, 'renewed', 'renewal at the current revision works');

  // 2. Another writer moves the revision on.
  const edited = structuredClone(initial);
  edited.timelines[0]!.width = 1280;
  await setStoredEntry(`project:${projectId}`, edited);
  const movedRevision = revisionOf(edited);
  assert.notEqual(movedRevision, initialRevision, 'the fixture must actually move the revision');

  // 3. THE BUG: renewal must re-base, not report stale.
  const afterMove = await renewProjectEditOwnership(claim.claim, initialRevision);
  assert.equal(
    afterMove.status,
    'renewed',
    'a stale baseRevision must not strand the editor — renewal has to re-base to the stored revision',
  );
  assert.equal(afterMove.status === 'renewed' && afterMove.claim.baseRevision, movedRevision,
    'the renewed claim carries the CURRENT stored revision');

  // 4. And the renewal is durable: a subsequent renewal from the re-based claim works.
  if (afterMove.status !== 'renewed') throw new Error('renew failed');
  const again = await renewProjectEditOwnership(afterMove.claim, afterMove.claim.baseRevision);
  assert.equal(again.status, 'renewed', 'the re-based claim keeps renewing normally');

  // 5. A DIFFERENT owner must still be refused, so re-basing did not become a
  //    blanket "anyone may steal a live lease".
  const impostor = await renewProjectEditOwnership(
    { ...claim.claim, ownerId: 'someone-else' },
    movedRevision,
  );
  assert.notEqual(impostor.status, 'renewed', 'renewal still requires the same owner');

  // 6. Once the lease lapses, renewal must refuse. The ownership key is
  //    server-managed (setStoredEntry rejects it), so this is driven through the
  //    public API: release the claim, then try to renew the dead one. A released
  //    record is exactly what an editor that went away leaves behind.
  const { releaseProjectEditOwnership } = await import('./project-edit-ownership.ts');
  await releaseProjectEditOwnership(
    afterMove.status === 'renewed' ? afterMove.claim : claim.claim,
  );
  const afterRelease = await renewProjectEditOwnership(claim.claim, movedRevision);
  assert.notEqual(afterRelease.status, 'renewed', 'a released lease cannot be renewed');
} finally {
  if (previousDataDir === undefined) delete process.env.AFTERFRAME_DATA_DIR;
  else process.env.AFTERFRAME_DATA_DIR = previousDataDir;
  // The SQLite store keeps its -shm/-wal handles open for the process lifetime,
  // so a strict rm can fail with EBUSY on Windows. The assertions have already
  // run by this point; a leftover temp dir must not turn a pass into a failure.
  await rm(fixture, { recursive: true, force: true }).catch(() => undefined);
}

console.log('ownership-renew: stale revisions re-base instead of stranding the editor');
