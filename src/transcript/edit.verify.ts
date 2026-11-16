//  window(trim ):npx tsx src/transcript/edit.check.ts
// fps=10,,=×10,
import assert from 'node:assert';
import { editedFrames, itemWindow, keptSegments, keptWordIndices, mediaWindowKeptIndices, mediaWindowWords, retimeWords } from './edit';
import type { TranscriptWord } from './types';

const FPS = 10;
const W: TranscriptWord[] = [
  { text: 'a', start: 0, end: 1000 },     // f0-10
  { text: 'b', start: 1000, end: 2000 },  // f10-20
  { text: 'c', start: 3000, end: 4000 },  // f30-40(\u524d\u6709 1s \u505c\u987f)
  { text: 'd', start: 4000, end: 5000 },  // f40-50
];
const none = new Set<number>();

// ── : ──────────────────────────────────────────────
{
  const segs = keptSegments(W, none, FPS, 0);
  assert.deepEqual(segs, [{ srcStartFrame: 0, srcEndFrame: 50, fromFrame: 0, durFrames: 50 }]);
  assert.equal(editedFrames(W, none, FPS), 50);
  assert.deepEqual(keptWordIndices(W, none, FPS), [0, 1, 2, 3]);
  assert.equal(retimeWords(W, none, FPS, 0).length, 4);
}

// ── :[0, )  ─────────────────────────────────────
{
  const segs = keptSegments(W, none, FPS, 0, { window: { startFrame: 0, durFrames: 50 } });
  assert.deepEqual(segs, [{ srcStartFrame: 0, srcEndFrame: 50, fromFrame: 0, durFrames: 50 }]);
}

// ──  15 :, a b  ─────────────────────
{
  const opts = { window: { startFrame: 15, durFrames: 35 } };
  const segs = keptSegments(W, none, FPS, 100, opts); // offset 100 \u9a8c\u8bc1\u91cd\u6392\u5e95\u5ea7
  assert.deepEqual(segs, [{ srcStartFrame: 15, srcEndFrame: 50, fromFrame: 100, durFrames: 35 }]);
  assert.deepEqual(keptWordIndices(W, none, FPS, opts), [1, 2, 3], '\u7a97\u53e3\u5916\u7684\u8bcd a \u4e0d\u7b97\u5b58\u6d3b');
  const words = retimeWords(W, none, FPS, 100, opts);
  assert.equal(words.length, 3);
  assert.equal(words[0].text, 'b');
  assert.equal(Math.round(words[0].start), 100 / FPS * 1000, 'b \u88ab\u5939\u5230 clip \u8d77\u70b9');
}

// ── :,d c  ────────────────────────────────────────
{
  const opts = { window: { startFrame: 0, durFrames: 35 } };
  const segs = keptSegments(W, none, FPS, 0, opts);
  assert.deepEqual(segs, [{ srcStartFrame: 0, srcEndFrame: 35, fromFrame: 0, durFrames: 35 }]);
  assert.deepEqual(keptWordIndices(W, none, FPS, opts), [0, 1, 2]);
}

// ── : ────────────────────────────────────────────────────
{
  const opts = { window: { startFrame: 15, durFrames: 20 } }; // [15,35)
  assert.deepEqual(keptWordIndices(W, none, FPS, opts), [1, 2]);
}

// ──  + : ─────────────────────────────────
{
  const del = new Set([1]); // \u5220 b → \u6bb51 [0,10) + \u6bb52 [30,50),\u6d41\u957f 30
  const base = keptSegments(W, del, FPS, 0);
  assert.deepEqual(base, [
    { srcStartFrame: 0, srcEndFrame: 10, fromFrame: 0, durFrames: 10 },
    { srcStartFrame: 30, srcEndFrame: 50, fromFrame: 10, durFrames: 20 },
  ]);
  const segs = keptSegments(W, del, FPS, 0, { window: { startFrame: 5, durFrames: 20 } }); // [5,25)
  assert.deepEqual(segs, [
    { srcStartFrame: 5, srcEndFrame: 10, fromFrame: 0, durFrames: 5 },   // \u6bb51 \u5207\u5934
    { srcStartFrame: 30, srcEndFrame: 45, fromFrame: 5, durFrames: 15 }, // \u6bb52 \u5207\u5c3e,\u7d27\u6392\u63a5\u4e0a
  ]);
}

// ── : → ;editedFrames  1 ─────────────────────
{
  const segs = keptSegments(W, none, FPS, 0, { window: { startFrame: 60, durFrames: 10 } });
  assert.equal(segs.length, 0);
  assert.equal(editedFrames(W, none, FPS, { window: { startFrame: 60, durFrames: 10 } }), 1);
}

// ── itemWindow: audio (video  srcInFrame )────
{
  assert.deepEqual(itemWindow({ kind: 'audio', srcInFrame: 15, durationInFrames: 35 }), { startFrame: 15, durFrames: 35 });
  assert.equal(itemWindow({ kind: 'video', srcInFrame: 15, durationInFrames: 35 }), undefined);
  assert.deepEqual(itemWindow({ kind: 'audio', durationInFrames: 50 }), { startFrame: 0, durFrames: 50 });
}

// ── video ( e2e )────────────────────
// video  [srcIn, srcIn+dur×rate),;:
// transcript ("")
{
  const s = (sec: number): number => sec * 1000; // ms;\u5e27 = sec×FPS
  const W: TranscriptWord[] = [
    { text: 'a', start: s(0), end: s(1) },   // \u5e27 0×FPS-1×FPS(\u7a97\u5916)
    { text: 'b', start: s(7), end: s(8) },   // 7×FPS-8×FPS
    { text: 'c', start: s(12), end: s(13) }, // 12×FPS-13×FPS
    { text: 'd', start: s(20), end: s(21) }, // \u7a97\u5916(rate=1 \u65f6)
  ];
  const item = { startFrame: 10, durationInFrames: 12 * FPS, srcInFrame: 6 * FPS }; // \u7a97\u53e3 [6s,18s)
  const out = mediaWindowWords(W, FPS, item);
  assert.deepEqual(out.map((w) => w.text), ['b', 'c'], '\u7a97\u53e3\u5185 b/c,a/d \u5728\u7a97\u5916');
  assert.equal(Math.round(out[0].start), Math.round(((10 + 1 * FPS) / FPS) * 1000), 'b \u843d\u5728 startFrame+1s');
  assert.equal(Math.round(out[1].start), Math.round(((10 + 6 * FPS) / FPS) * 1000), 'c \u504f\u79fb 6s');
  // (wordOverrides )
  assert.deepEqual(mediaWindowKeptIndices(W, FPS, item), [1, 2]);
  // 2× : [6s, 6s+12s×2)=[6s,30s) → d ,
  const fast = { startFrame: 0, durationInFrames: 12 * FPS, srcInFrame: 6 * FPS, playbackRate: 2 };
  const outFast = mediaWindowWords(W, FPS, fast);
  assert.deepEqual(outFast.map((w) => w.text), ['b', 'c', 'd']);
  assert.equal(Math.round(outFast[2].start), Math.round(((20 - 6) / 2) * 1000), '\u53d8\u901f\u4e0b\u5a92\u4f53\u5e27\u5dee\u9664\u4ee5 rate');
}

// ── :srcEndFrame  srcStartFrame ────────────────────────
// ASR  start === end() srcEndFrame
//  srcStartFrame, trimBefore === trimAfter ,Remotion
// <Audio> ("trimAfter prop must be greater than trimBefore prop"),
// :,""
{
  const zero: TranscriptWord[] = [
    { text: 'Music', start: 24420, end: 24440 }, // fps=30 \u65f6\u4e24\u7aef\u540c\u4e3a f733
  ];
  for (const fps of [30, FPS]) {
    const segs = keptSegments(zero, none, fps, 0);
    assert.equal(segs.length, 1);
    assert.ok(segs[0]!.srcEndFrame > segs[0]!.srcStartFrame, `\u96f6\u957f\u8bcd\u5fc5\u987b\u7559\u51fa\u81f3\u5c11\u4e00\u5e27 (fps=${fps})`);
    assert.equal(segs[0]!.durFrames, segs[0]!.srcEndFrame - segs[0]!.srcStartFrame);
  }
  //  start === end
  const exact = keptSegments([{ text: 'x', start: 500, end: 500 }], none, FPS, 0);
  assert.ok(exact[0]!.srcEndFrame > exact[0]!.srcStartFrame, 'start === end \u4e5f\u5fc5\u987b\u7559\u51fa\u4e00\u5e27');
}

console.log('edit.check: ok (\u65e0\u7a97\u53e3\u56de\u5f52/\u6052\u7b49/\u5de6\u88c1/\u53f3\u88c1/\u4e2d\u6bb5/\u5220\u8bcd\u8de8\u6bb5/\u8d8a\u754c\u81ea\u6108/itemWindow kind \u95e8/video \u5a92\u4f53\u7a97\u6295\u5f71/\u96f6\u957f\u8bcd)');
