// /:src ()
// :npx tsx src/persist/projectTransfer.check.ts( verify:persist, pretest )
import assert from 'node:assert/strict';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version';
import { collectUploadSrcs, parseProjectEnvelope, PROJECT_EXPORT_FORMAT } from './projectTransfer';

const doc = {
  version: 2,
  assets: [
    { id: 'a1', name: 'v.mp4', kind: 'video', src: '/media/uploads/v.mp4', durationInFrames: 60 },
    { id: 'a2', name: 'pic.png', kind: 'image', src: '/media/uploads/pic.png', durationInFrames: 90 },
    { id: 'a3', name: 'ext', kind: 'image', src: 'https://cdn.example.com/x.png', durationInFrames: 90 },
  ],
  timelines: [{
    id: 'tl_1', name: '\u5e8f\u5217 1', order: 0, fps: 30, width: 1920, height: 1080, selectedId: null,
    items: [
      { id: 'i1', name: 'v.mp4', kind: 'video', track: 'v1', startFrame: 0, durationInFrames: 60, src: '/media/uploads/v.mp4' },
      { id: 'i2', name: 'bgm.mp3', kind: 'audio', track: 'a1', startFrame: 0, durationInFrames: 60, src: '/media/uploads/bgm.mp3' },
      { id: 'i3', name: '\u6807\u9898', kind: 'text', track: 'v2', startFrame: 0, durationInFrames: 30 },
    ],
  }],
  activeTimelineId: 'tl_1',
};

// ── collectUploadSrcs ───────────────────────────────────────────────────
{
  const srcs = collectUploadSrcs(doc as never);
  assert.deepEqual(srcs, ['/media/uploads/v.mp4', '/media/uploads/pic.png', '/media/uploads/bgm.mp3'],
    '\u7d20\u6750\u6c60+\u65f6\u95f4\u7ebf\u5408\u96c6,\u53bb\u91cd\u4fdd\u5e8f,\u5916\u94fe\u4e0d\u6536');
  console.log('collectUploadSrcs: OK');
}

// ── parseProjectEnvelope ────────────────────────────────────────────────
{
  const good = {
    format: PROJECT_EXPORT_FORMAT, name: ' \u8fc1\u79fb\u5de5\u7a0b ', exportedAt: '2026-07-18T00:00:00Z', doc,
    chat: { messages: [], llm: [] },
    creativeMode: 'long-video-to-shorts',
    media: [
      { src: '/media/uploads/v.mp4', name: 'v.mp4', mime: 'video/mp4', bytes: 10, dataBase64: 'AAAA' },
    ],
  };
  const migrationProgress: Array<[number, number]> = [];
  const parsed = parseProjectEnvelope(JSON.stringify(good), {
    onProgress: (event) => migrationProgress.push([event.fromVersion, event.toVersion]),
  });
  assert.ok('envelope' in parsed, `\u5e94\u901a\u8fc7:${'error' in parsed ? parsed.error : ''}`);
  if ('envelope' in parsed) {
    assert.equal(parsed.envelope.name, '\u8fc1\u79fb\u5de5\u7a0b', '\u540d\u5b57 trim');
    assert.equal(parsed.envelope.media.length, 1, '\u5408\u89c4\u5a92\u4f53\u6761\u76ee\u4fdd\u7559');
    assert.equal(parsed.envelope.media[0].src, '/media/uploads/v.mp4');
    assert.ok(parsed.envelope.chat, 'chat \u5f62\u72b6\u5bf9\u5c31\u4fdd\u7559');
    assert.equal(parsed.envelope.creativeMode, 'long-video-to-shorts');
    assert.equal(parsed.envelope.doc.timelines.length, 1, 'doc \u8d70 migrateProjectDoc \u5b58\u6d3b');
    assert.equal(parsed.envelope.doc.version, CURRENT_PROJECT_VERSION, '\u65e7\u5bfc\u5165\u6587\u4ef6\u5347\u7ea7\u5230\u5f53\u524d\u5de5\u7a0b\u7248\u672c');
    // One progress event per public migration step.
    const expectedSteps = Array.from({ length: CURRENT_PROJECT_VERSION - 2 }, (_, i) => [2 + i, 3 + i]);
    assert.deepEqual(migrationProgress, expectedSteps, '\u5bfc\u5165\u590d\u7528\u7edf\u4e00\u8fc1\u79fb\u8fdb\u5ea6');
  }

  // Any unsafe/oversized media entry rejects the whole envelope (untrusted input).
  for (const bad of [
    { src: '/media/uploads/../etc', name: 'x', mime: 'x', bytes: 1, dataBase64: 'AA' },      // \u7a7f\u8d8a
    { src: '/media/uploads/ok.png', name: 'a/b.png', mime: 'x', bytes: 1, dataBase64: 'AA' }, // name \u5e26\u8def\u5f84
    { src: '/media/uploads/big.mov', name: 'big.mov', mime: 'x', bytes: 1e12, dataBase64: 'AA' }, // \u8d85\u4e0a\u9650
    { src: '/media/uploads/nob64.png', name: 'n.png', mime: 'x', bytes: 5, dataBase64: '' },  // \u7a7a\u6570\u636e
  ]) {
    const withBad = parseProjectEnvelope(JSON.stringify({ ...good, media: [good.media[0], bad] }));
    assert.ok('error' in withBad, `\u574f\u5a92\u4f53\u6761\u76ee\u6574\u5305\u62d2\u6536:${JSON.stringify(bad.src)}`);
  }

  assert.deepEqual(parseProjectEnvelope('not json'), { error: '\u4e0d\u662f\u5408\u6cd5\u7684 JSON \u6587\u4ef6' });
  const wrongFormat = parseProjectEnvelope(JSON.stringify({ ...good, format: 'foreign-project@1' }));
  assert.ok('error' in wrongFormat, '\u63d2\u4ef6\u5305\u683c\u5f0f\u62d2\u6536');
  const badDoc = parseProjectEnvelope(JSON.stringify({ ...good, doc: { timelines: [] } }));
  assert.ok('error' in badDoc, '\u7a7a\u65f6\u95f4\u7ebf doc \u62d2\u6536');
  const badChat = parseProjectEnvelope(JSON.stringify({ ...good, chat: { messages: 'x' } }));
  assert.ok('envelope' in badChat && !(badChat as { envelope: { chat?: unknown } }).envelope.chat, '\u574f chat \u4e22\u5f03\u4e0d\u81f4\u547d');
  console.log('parseProjectEnvelope: OK');
}

console.log('\nprojectTransfer.check: ALL PASSED');
