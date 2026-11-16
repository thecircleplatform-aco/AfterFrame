// Runnable check: `npx tsx src/transcript/cutPad.verify.ts`.
// Verify the breathing opening of the deletion cut: only mute the opening cut by deletion/rearrangement, and the beginning and end of the segment itself will be muted
// The gap controlled by the compression rules will not be borrowed; the amount borrowed shall be based on the actual silence on site. If you cannot borrow, borrow less.
import assert from 'node:assert/strict';
import { keptSegments } from './edit';
import type { TranscriptWord } from './types';

const fps = 100; // 10ms one frame, so that milliseconds can be read directly into frames
// 100ms per word, 200ms between words mute: w0 [0,100] w1 [300,400] w2 [600,700] w3 [900,1000]
const words: TranscriptWord[] = [0, 1, 2, 3].map((i) => ({
  text: `w${i}`, start: i * 300, end: i * 300 + 100,
}));

const spans = (deleted: number[], cutPadFrames?: number) =>
  keptSegments(words, new Set(deleted), fps, 0, { cutPadFrames })
    .map((s) => [s.srcStartFrame, s.srcEndFrame]);

// ── Default (not passed) = old behavior, precise at word boundaries ──
{
  assert.deepEqual(spans([1]), [[0, 10], [60, 100]], '\u4e0d\u8bbe\u547c\u5438\u53e3\u65f6\u5207\u70b9\u5206\u6beb\u4e0d\u5dee');
  assert.deepEqual(spans([]), [[0, 100]], '\u6ca1\u5220\u8bcd\u5c31\u662f\u4e00\u6574\u6bb5');
}

// ── Borrow half on each side of the cut: 60 frames budget → 30 frames per side, 20 frames live mute, only borrow 20 ──
{
  assert.deepEqual(
    spans([1], 60),
    [[0, 30], [40, 100]],
    '\u7b2c\u4e00\u6bb5\u5c3e\u5df4\u501f\u5230 w1 \u8d77\u70b9,\u7b2c\u4e8c\u6bb5\u5934\u501f\u5230 w1 \u7ec8\u70b9,\u90fd\u88ab\u73b0\u573a\u9759\u97f3\u5361\u4f4f',
  );
}

// ── If the budget is less than the on-site silence, borrow according to the budget ──
{
  assert.deepEqual(spans([1], 20), [[0, 20], [50, 100]], '\u6bcf\u4fa7 10 \u5e27');
  assert.deepEqual(spans([1], 1), [[0, 10], [60, 100]], 'half \u53d6\u6574\u540e\u4e3a 0,\u7b49\u4e8e\u4e0d\u501f');
}

// ── Only incisions are borrowed: after deleting the first/last word, the new one is the incision (borrowing), and the other end is not (not borrowing) ──
{
  assert.deepEqual(spans([3], 60), [[0, 90]], '\u5c3e\u8bcd\u5220\u6389 → \u6536\u5c3e\u6210\u4e86\u5207\u53e3,\u5f80\u540e\u501f\u5230 w3 \u8d77\u70b9');
  assert.deepEqual(spans([0], 60), [[10, 100]], '\u9996\u8bcd\u5220\u6389 → \u5f00\u5934\u6210\u4e86\u5207\u53e3,\u5f80\u524d\u501f\u5230 w0 \u7ec8\u70b9');
  // When not a single word is deleted, neither end is a cut, and no matter how big the budget is, not a single frame is borrowed.
  assert.deepEqual(spans([], 600), [[0, 100]], '\u7247\u6bb5\u81ea\u8eab\u7684\u9996\u5c3e\u4e0d\u501f');
}

// ── The gaps governed by the silent compression rules are not borrowed: the length has been determined by cap ──
{
  const capped = keptSegments(words, new Set(), fps, 0, { cutPadFrames: 60, gapCapsMs: { 1: 50 } })
    .map((s) => [s.srcStartFrame, s.srcEndFrame]);
  assert.deepEqual(capped, [[0, 15], [30, 100]], 'cap \u540e\u7684 w0 \u6bb5\u6b62\u4e8e 10+5,\u4e0d\u518d\u989d\u5916\u501f;\u4e0b\u4e00\u6bb5\u5934\u4e5f\u4e0d\u501f');
}

// ── Incisions caused by rearrangements are also considered incisions──
{
  const reordered = keptSegments(words, new Set(), fps, 0, { cutPadFrames: 60, playOrder: [2, 3, 0, 1] })
    .map((s) => [s.srcStartFrame, s.srcEndFrame]);
  assert.deepEqual(reordered, [[40, 100], [0, 60]], '\u4e24\u6bb5\u5404\u81ea\u5728\u88ab\u5207\u5f00\u7684\u4e00\u4fa7\u501f\u5230\u9759\u97f3');
}

// ── Timeline positions are still connected end to end: borrowed frames are included in the duration and cannot leave overlaps or holes ──
{
  const segs = keptSegments(words, new Set([1]), fps, 500, { cutPadFrames: 60 });
  let cursor = 500;
  for (const seg of segs) {
    assert.equal(seg.fromFrame, cursor, '\u6bcf\u6bb5\u7d27\u63a5\u4e0a\u4e00\u6bb5');
    assert.equal(seg.durFrames, seg.srcEndFrame - seg.srcStartFrame, '\u65f6\u957f\u7b49\u4e8e\u501f\u5b8c\u4e4b\u540e\u7684\u6e90\u8de8\u5ea6');
    cursor += seg.durFrames;
  }
}

console.log('cutPad.verify: ok (\u9ed8\u8ba4\u4e0d\u53d8/\u4e24\u4fa7\u5e73\u5206/\u73b0\u573a\u9759\u97f3\u4e0a\u9650/\u9996\u5c3e\u4e0d\u501f/cap \u4e0d\u501f/\u91cd\u6392\u5207\u53e3/\u65f6\u95f4\u7ebf\u8fde\u7eed)');
