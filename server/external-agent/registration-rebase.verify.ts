// Regression: a browser editor must be able to REGISTER edit ownership even when
// the revision it remembers has drifted from the store's.
//
// The bug this pins: `claimBrowserProjectOwnership` returned `stale` whenever
// the browser's remembered revision differed from the stored project revision.
// Registration is the ONLY way a tab acquires edit ownership, so a rejected
// registration is terminal rather than transient:
//
//   register rejected -> no ownership -> project-document writes refused
//   -> the tab can never advance its copy -> its revision never matches again
//   -> registration is rejected forever -> every import stays in memory only
//   -> refresh discards it ("uploaded media disappears").
//
// The symptom is silent data loss, so this pins the guarantee directly: a
// drifted expectedRevision MUST still produce a claim, anchored to the revision
// the store actually holds, and that claim must then renew normally.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = await mkdtemp(join(tmpdir(), 'occ-registration-rebase-'));
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

const projectId = `register-${crypto.randomUUID()}`;
const editorId = 'editor-registration-under-test';

try {
  const stored = docFromTimeline({ ...INITIAL, width: 1920, height: 1080, items: [] });
  await setStoredEntry(`project:${projectId}`, stored);
  const storedRevision = revisionOf(stored);

  // The tab believes it is on a revision that no longer exists. This is what a
  // local-cache hydration or a raced autosave looks like to the server.
  const drifted = await claimBrowserProjectOwnership(projectId, editorId, 'v3-00000000');
  assert.equal(
    drifted.status,
    'claimed',
    'a drifted baseRevision must not strand the editor - registration has to re-base',
  );
  if (drifted.status !== 'claimed') throw new Error('registration was rejected');
  assert.equal(
    drifted.claim.baseRevision,
    storedRevision,
    'the registered claim must be anchored to the revision the store holds',
  );

  // Registration is only useful if the lease then behaves.
  const renewed = await renewProjectEditOwnership(drifted.claim);
  assert.equal(renewed.status, 'renewed', 'a freshly registered claim must renew');

  // A different window with an equally drifted view may still take over: there
  // is exactly one editor in this app's supported shape, so a revision mismatch
  // is not evidence of a competing writer.
  const takeover = await claimBrowserProjectOwnership(projectId, 'second-window', 'v3-ffffffff');
  assert.equal(takeover.status, 'claimed', 'a drifted second window may still claim');

  // A genuinely missing project cannot be owned; that stale is correct.
  const missing = await claimBrowserProjectOwnership('no-such-project-id', 'editor', 'v3-00000000');
  assert.equal(missing.status, 'stale', 'a missing project must remain stale');

  // Guard against the revision-equality gate being reintroduced.
  const source = await readFile(new URL('./project-edit-ownership.ts', import.meta.url), 'utf8');
  const claimSource = source.slice(
    source.indexOf('export async function claimBrowserProjectOwnership'),
    source.indexOf('export async function claimOfflineProjectOwnership'),
  );
  assert.ok(
    !/project\.revision\s*!==\s*expectedRevision/.test(claimSource),
    'claimBrowserProjectOwnership must not reject a drifted baseRevision',
  );
  assert.ok(
    /baseRevision:\s*project\.revision/.test(claimSource),
    'claimBrowserProjectOwnership must anchor the claim to the stored revision',
  );

  console.log('registration-rebase: drifted revisions register instead of locking the editor out');
} finally {
  if (previousDataDir === undefined) delete process.env.AFTERFRAME_DATA_DIR;
  else process.env.AFTERFRAME_DATA_DIR = previousDataDir;
  await rm(fixture, { recursive: true, force: true }).catch(() => undefined);
}
