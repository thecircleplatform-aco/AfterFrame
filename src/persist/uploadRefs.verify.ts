// Runnable check: `npx tsx src/persist/uploadRefs.verify.ts`.
// Asset reference inventory is the basis for deleting files. Missing one means deleting assets that the user is still using. Here are two things to verify:
// ① denoisedSrc (the product of isolate_voice, directly linked to the path without creating the asset) must be counted as a reference;
// ② When the project document cannot be read, it degenerates into scanning the original bytes instead of treating it as a "zero reference".
import assert from 'node:assert/strict';
import { collectUploadSrcs, rawUploadSrcs } from './projectTransfer';
import type { ProjectDoc } from '../editor/types';

const docOf = (items: unknown[], assets: unknown[] = []): ProjectDoc => ({
  version: 3, assets, mediaFolders: [], activeTimelineId: 'tl1',
  timelines: [{
    id: 'tl1', name: 'main', order: 0, fps: 30, width: 1920, height: 1080, selectedId: null,
    tracks: { A1: { kind: 'audio' } }, trackOrder: ['A1'], items,
  }],
} as unknown as ProjectDoc);

// ── denoisedSrc must be counted as a reference ──
{
  const doc = docOf(
    [{ id: 'a', track: 'A1', startFrame: 0, durationInFrames: 30, kind: 'audio', name: 'a', src: '/media/uploads/raw.wav', denoisedSrc: '/media/uploads/clean.wav' }],
    [{ id: 'as1', name: 'raw', kind: 'audio', src: '/media/uploads/raw.wav', durationInFrames: 30 }],
  );
  const refs = collectUploadSrcs(doc);
  assert.ok(refs.includes('/media/uploads/raw.wav'), '\u6e90\u7d20\u6750');
  assert.ok(
    refs.includes('/media/uploads/clean.wav'),
    'isolate_voice \u7684\u4ea7\u7269\u53ea\u4ee5 denoisedSrc \u5b58\u5728,\u6f0f\u6389\u5b83\u6e05\u7406\u5c31\u4f1a\u5220\u6389\u6b63\u5728\u64ad\u653e\u7684\u97f3\u8f68',
  );
  assert.equal(new Set(refs).size, refs.length, '\u4e0d\u91cd\u590d');
}

// ── Original bytes that cannot be read: still need to fish out the reference ──
{
  // The version is newer than the local machine → migrateProjectDoc returns null, but the project is not broken at all
  const future = {
    version: 999, assets: [{ src: '/media/uploads/a.mp4' }], mediaFolders: [],
    activeTimelineId: 'tl1',
    timelines: [{ id: 'tl1', items: [{ src: '/media/uploads/b.wav', denoisedSrc: '/media/uploads/c.wav' }] }],
  };
  const refs = rawUploadSrcs(future).sort();
  assert.deepEqual(refs, ['/media/uploads/a.mp4', '/media/uploads/b.wav', '/media/uploads/c.wav']);
}

// ── Boundaries: null value, illegal name, query string, repetition ──
{
  assert.deepEqual(rawUploadSrcs(null), []);
  assert.deepEqual(rawUploadSrcs(undefined), []);
  assert.deepEqual(rawUploadSrcs({}), []);
  assert.deepEqual(rawUploadSrcs('/media/uploads/x.mp4"'), ['/media/uploads/x.mp4'], '\u76f4\u63a5\u7ed9\u5b57\u7b26\u4e32\u4e5f\u80fd\u626b');
  assert.deepEqual(
    rawUploadSrcs({ a: '/media/uploads/dup.mp4', b: '/media/uploads/dup.mp4' }),
    ['/media/uploads/dup.mp4'],
    '\u540c\u4e00\u4e2a\u6587\u4ef6\u53ea\u7b97\u4e00\u6b21',
  );
  assert.deepEqual(
    rawUploadSrcs({ a: '/media/uploads/.hidden', b: '/media/uploads/ok.mp4' }),
    ['/media/uploads/ok.mp4'],
    '\u70b9\u5f00\u5934\u7684\u540d\u5b57\u4e0d\u5408\u6cd5,\u4e0d\u5f53\u5f15\u7528',
  );
  assert.deepEqual(
    rawUploadSrcs({ a: '/media/uploads/f.mp4?v=2' }),
    ['/media/uploads/f.mp4'],
    '\u67e5\u8be2\u4e32\u4e0d\u8fdb\u6587\u4ef6\u540d',
  );
  // Circular reference: If it cannot be scanned, it will return empty, and the caller will handle it as unknown (instead of throwing an exception and causing the entire cleanup to hang up)
  const cyclic: Record<string, unknown> = { src: '/media/uploads/z.mp4' };
  cyclic.self = cyclic;
  assert.deepEqual(rawUploadSrcs(cyclic), []);
}

// ── It is better to keep more than delete by mistake: the original scan is a superset of collectUploadSrcs ──
{
  const doc = docOf(
    [{ id: 'a', track: 'A1', startFrame: 0, durationInFrames: 30, kind: 'audio', name: 'a', src: '/media/uploads/raw.wav', denoisedSrc: '/media/uploads/clean.wav' }],
    [{ id: 'as1', name: 'raw', kind: 'audio', src: '/media/uploads/raw.wav', durationInFrames: 30 }],
  );
  const raw = new Set(rawUploadSrcs(doc));
  for (const src of collectUploadSrcs(doc)) {
    assert.ok(raw.has(src), `\u539f\u59cb\u626b\u63cf\u6f0f\u4e86 ${src},\u9000\u5316\u8def\u5f84\u5c31\u4f1a\u6bd4\u6b63\u5e38\u8def\u5f84\u66f4\u5371\u9669`);
  }
}

console.log('uploadRefs.verify: ok (denoisedSrc \u8ba1\u5165/\u8bfb\u4e0d\u51fa\u65f6\u626b\u539f\u59cb\u5b57\u8282/\u8fb9\u754c/\u8d85\u96c6\u5173\u7cfb)');
