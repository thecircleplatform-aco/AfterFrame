// :( projectStore )
// :npx tsx src/persist/mediaCleanup.check.ts( verify:persist, pretest )
import assert from 'node:assert/strict';
import { collectAllUploadRefs, orphanDocIdsToPurge, unreferencedOf } from './mediaCleanup';
import { createProject, listProjectDocIds, purgeProject } from './projectStore';
import { kvGet, kvSet } from './sharedKv';
import { listVersions, saveVersion } from './versionStore';
import type { ProjectDoc } from '../editor/types';

// ── unreferencedOf: −  ──────────────────────────────────────────
{
  const files = [
    { name: 'a.mp4', bytes: 10, mtimeMs: 1 },
    { name: '\u674e\u767d_01_\u5f00\u7bc7.mp3', bytes: 20, mtimeMs: 2 },
    { name: 'kept.png', bytes: 30, mtimeMs: 3 },
  ];
  const refs = new Set(['/media/uploads/kept.png']);
  const orphans = unreferencedOf(files, refs);
  assert.deepEqual(orphans.map((f) => f.name), ['a.mp4', '\u674e\u767d_01_\u5f00\u7bc7.mp3'], '\u5f15\u7528\u7684\u4e0d\u8fdb\u65e0\u4e3b\u6e05\u5355(\u4e2d\u6587\u540d\u7167\u5e38)');
  console.log('unreferencedOf: OK');
}

// ── orphanDocIdsToPurge: ────────────────────────────────────
{
  assert.deepEqual(orphanDocIdsToPurge(new Set(['a']), ['a', 'b']), ['b'], '\u4e0d\u5728\u7d22\u5f15\u4e2d\u7684\u6587\u6863\u662f\u5b64\u513f');
  assert.deepEqual(orphanDocIdsToPurge(new Set(['a']), ['a']), [], '\u7d22\u5f15\u9f50\u5168\u65f6\u65e0\u5b64\u513f');
  assert.deepEqual(orphanDocIdsToPurge(new Set(), []), [], '\u7a7a\u5e93\u65e0\u4e8b\u53d1\u751f');
  assert.deepEqual(orphanDocIdsToPurge(new Set(), ['a', 'b']), [],
    '\u7d22\u5f15\u4e3a\u7a7a\u4f46\u6587\u6863\u5b58\u5728 = \u7d22\u5f15\u4e22\u5931/\u4e0d\u53ef\u8bfb,\u7981\u6b62\u628a\u5168\u90e8\u5de5\u7a0b\u5f53\u5b64\u513f\u6e05\u9664');
  console.log('orphanDocIdsToPurge: OK');
}

// ──  + ( projectStore) ────────────────────────────
{
  const doc = (src: string): ProjectDoc => ({
    version: 3,
    assets: [{ id: 'a1', name: 'x', kind: 'video', src, durationInFrames: 30 }],
    mediaFolders: [],
    timelines: [{ id: 'tl1', name: '\u5e8f\u5217 1', fps: 30, width: 1920, height: 1080, selectedId: null, items: [] } as never],
    activeTimelineId: 'tl1',
  } as never);
  const shared = '/media/uploads/shared.mp4';
  const solo = '/media/uploads/solo.mp4';
  const p1 = await createProject('\u7532', doc(shared));
  const p2 = await createProject('\u4e59', doc(shared));
  const p3 = await createProject('\u4e19', doc(solo));

  let refs = await collectAllUploadRefs();
  assert.ok(refs.has(shared) && refs.has(solo), '\u5e76\u96c6\u542b\u5168\u90e8\u5f15\u7528');

  //  p3  solo  → ;shared  p2  →
  refs = await collectAllUploadRefs(p3.id);
  assert.ok(!refs.has(solo) && refs.has(shared), '\u6392\u9664\u81ea\u8eab\u540e:\u72ec\u5360\u7684\u88f8\u5954,\u5171\u4eab\u7684\u4ecd\u88ab\u62a4\u4f4f');

  //  p1  shared  p2
  await purgeProject(p1.id);
  refs = await collectAllUploadRefs();
  assert.ok(refs.has(shared), '\u590d\u5236\u4f53\u5728,\u5171\u4eab\u7d20\u6750\u5f15\u7528\u4e0d\u4e22');

  for (const m of [p2, p3]) await purgeProject(m.id);
  assert.equal((await listProjectDocIds()).length, 0, 'purge \u540e\u6587\u6863\u6e05\u96f6');
  console.log('collectAllUploadRefs/\u7ea7\u8054\u8bed\u4e49: OK');
}

// Snapshots that this build cannot display still own their uploaded media.
{
  const doc: ProjectDoc = {
    version: 3, assets: [], mediaFolders: [],
    timelines: [{ id: 'tl1', name: 'sequence', fps: 30, width: 1920, height: 1080, selectedId: null, items: [] } as never],
    activeTimelineId: 'tl1',
  } as never;
  const project = await createProject('snapshot cleanup safety', doc);
  const futureSrc = '/media/uploads/future-snapshot-only.mp4';
  const snapshots = [{ id: 'future', name: 'newer build', createdAt: 1,
    doc: { ...doc, version: 99, assets: [{ src: futureSrc }] } }];
  await kvSet(`versions:${project.id}`, snapshots);
  assert.deepEqual(await listVersions(project.id), [], 'future versions stay hidden from the display list');
  const spacedSrc = '/media/uploads/readable snapshot only.mp4';
  await saveVersion(project.id, 'readable snapshot', { ...doc, assets: [{ id: 'space', name: 'spaced', kind: 'video', src: spacedSrc, durationInFrames: 30 }] });
  const storedBefore = await kvGet(`versions:${project.id}`);
  const refs = await collectAllUploadRefs();
  assert.ok(refs.has(spacedSrc), 'readable snapshots retain their complete media paths');
  assert.ok(refs.has(futureSrc), 'cleanup protects media owned only by an unreadable snapshot');
  assert.deepEqual(unreferencedOf([{ name: 'future-snapshot-only.mp4', bytes: 1, mtimeMs: 1 }], refs), []);
  assert.deepEqual(await kvGet(`versions:${project.id}`), storedBefore, 'reference collection preserves snapshot bytes');
  assert.ok(!(await collectAllUploadRefs(project.id)).has(futureSrc), 'excluded projects exclude their snapshots too');
  await purgeProject(project.id);
}
console.log('\nmediaCleanup.check: ALL PASSED');
