// Runnable check: `npx tsx src/editor/sourceLimit.verify.ts`.
// Verify that "the clip cannot be longer than the source asset": conversion of remaining source frames (including variable speed), which clips are not limited
// (picture/MG/text/word-driven audio), and it is confirmed by real reduce that the right cropping is indeed blocked by this upper bound.
import assert from 'node:assert/strict';
import {
  remainingSourceFrames,
  sourceFrameAt,
  sourceFramesToTimelineFrames,
  sourceWindowForTimelineRange,
  timelineFramesToSourceFrames,
} from './sourceLimit';
import { reduce } from './reduce';
import type { MediaAsset, TimelineItem, TimelineState } from './types';

const assets: MediaAsset[] = [
  { id: 'as-v', name: 'a.mp4', kind: 'video', src: '/m/a.mp4', durationInFrames: 300 },
  { id: 'as-a', name: 'a.wav', kind: 'audio', src: '/m/a.wav', durationInFrames: 300 },
  { id: 'as-i', name: 'a.png', kind: 'image', src: '/m/a.png', durationInFrames: 0 },
];

const item = (patch: Partial<TimelineItem> = {}): TimelineItem => ({
  id: 'a', track: 'V1', startFrame: 0, durationInFrames: 100,
  kind: 'video', name: 'a', src: '/m/a.mp4', ...patch,
} as TimelineItem);

const stateOf = (items: TimelineItem[]): TimelineState => ({
  fps: 30, width: 1920, height: 1080, selectedId: null,
  tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'], items, assets,
});

// ── Transition pre-roll keeps the source position continuous at the cut ──
{
  const incoming = item({ srcInFrame: 1263 });
  assert.equal(sourceFrameAt(incoming, -15), 1248);
  assert.equal(sourceFrameAt(incoming, 0), 1263);
  assert.equal(sourceFrameAt(item({ srcInFrame: 100, playbackRate: 2 }), -15), 70);
  assert.equal(sourceFrameAt(item({ srcInFrame: 5 }), -15), 0, '\u6e90\u5165\u70b9\u4e0d\u8db3\u65f6\u4e0d\u8d8a\u8fc7\u7d20\u6750\u5f00\u5934');
}

// ── One authoritative timeline/source conversion, including clamped pre-roll windows ──
{
  const fast = item({ srcInFrame: 10, playbackRate: 2 });
  assert.equal(timelineFramesToSourceFrames(fast, 25), 50);
  assert.equal(sourceFramesToTimelineFrames(fast, 50), 25);
  assert.deepEqual(sourceWindowForTimelineRange(fast, 5, 20), { startFrame: 20, endFrame: 60 });
  assert.deepEqual(
    sourceWindowForTimelineRange(item({ srcInFrame: 5, playbackRate: 0.5 }), -20, 30),
    { startFrame: 0, endFrame: 10 },
    'source windows clamp pre-roll at the asset head without changing the range endpoint',
  );
}

// ── Remaining source frames: How much is left after the entry point, variable speed timeline frame = source frame / rate conversion ──
{
  assert.equal(remainingSourceFrames(item(), 0, assets), 300);
  assert.equal(remainingSourceFrames(item(), 120, assets), 180, '\u5165\u70b9\u5403\u6389\u7684\u90e8\u5206\u4e0d\u7b97\u6570');
  assert.equal(remainingSourceFrames(item({ playbackRate: 2 }), 0, assets), 150, '2 \u500d\u901f\u65f6\u540c\u6837\u7684\u6e90\u6599\u53ea\u591f\u4e00\u534a\u65f6\u95f4\u7ebf\u5e27');
  assert.equal(remainingSourceFrames(item({ playbackRate: 0.5 }), 0, assets), 600, '\u6162\u653e\u80fd\u6491\u66f4\u4e45');
  assert.equal(remainingSourceFrames(item(), 999, assets), 1, '\u5165\u70b9\u8d8a\u8fc7\u5c3e\u90e8\u65f6\u81f3\u5c11\u7559 1 \u5e27,\u4e0d\u8fd4\u56de 0/\u8d1f\u6570');
}

// ── If you can’t determine the length, don’t set a limit, so as not to lock something that can be stretched arbitrarily ──
{
  assert.equal(remainingSourceFrames(item({ kind: 'image', src: '/m/a.png' }), 0, assets), null, '\u56fe\u7247\u53ef\u4ee5\u4efb\u610f\u62c9\u957f');
  assert.equal(remainingSourceFrames(item({ kind: 'motion-graphic', src: undefined }), 0, assets), null, 'MG \u662f\u751f\u6210\u7684');
  assert.equal(remainingSourceFrames(item({ kind: 'text', src: undefined }), 0, assets), null);
  assert.equal(remainingSourceFrames(item({ src: '/m/missing.mp4' }), 0, assets), null, '\u7d20\u6750\u8868\u91cc\u6ca1\u6709\u5c31\u4e0d\u731c');
  assert.equal(remainingSourceFrames(item(), 0, []), null);
  assert.equal(remainingSourceFrames(item(), 0, undefined), null);
  assert.equal(
    remainingSourceFrames(
      { kind: 'audio', src: '/m/a.wav', transcript: [{ text: 'hi', start: 0, end: 100 }] } as TimelineItem,
      0, assets,
    ),
    null,
    '\u8bcd\u9a71\u52a8\u97f3\u9891\u7531 retime \u6309\u7f16\u8f91\u540e\u8bcd\u6d41\u6536\u53e3,\u4e24\u5957\u4e0a\u754c\u4e0d\u80fd\u6253\u67b6',
  );
}

// ── Jingzhen reduce: The right crop is blocked by the tail of the asset, and the freeze frame can no longer be pulled out──
{
  const before = stateOf([item({ durationInFrames: 100 })]);
  const stretched = reduce(before, { type: 'retime', id: 'a', durationInFrames: 5000 });
  assert.equal(stretched.items[0]!.durationInFrames, 300, '\u6700\u591a\u7528\u6ee1\u6574\u6761\u7d20\u6750');

  const trimmed = reduce(before, { type: 'retime', id: 'a', durationInFrames: 5000, srcInFrame: 200 });
  assert.equal(trimmed.items[0]!.durationInFrames, 100, '\u5de6\u88c1\u4e4b\u540e\u53ef\u7528\u957f\u5ea6\u4e5f\u8ddf\u7740\u53d8\u77ed');

  const shorter = reduce(before, { type: 'retime', id: 'a', durationInFrames: 60 });
  assert.equal(shorter.items[0]!.durationInFrames, 60, '\u8303\u56f4\u5185\u7684\u88c1\u526a\u4e0d\u53d7\u5f71\u54cd');
}

// ──Clips without asset information can still be lengthened (MG/template)──
{
  const mg = stateOf([item({ kind: 'motion-graphic', src: undefined, durationInFrames: 60 })]);
  assert.equal(reduce(mg, { type: 'retime', id: 'a', durationInFrames: 900 }).items[0]!.durationInFrames, 900);
}


// ── Variable-speed split advances source time by timeline delta × playbackRate ──
{
  const normal = reduce(
    stateOf([item({ srcInFrame: 10, durationInFrames: 100 })]),
    { type: 'split', id: 'a', atFrame: 25, newId: 'normal-right' },
  );
  assert.deepEqual(
    normal.items.find((clip) => clip.id === 'normal-right')?.srcInFrame,
    35,
    '1x split keeps the established source in-point behavior',
  );

  const fast = reduce(
    stateOf([item({ srcInFrame: 10, playbackRate: 2, durationInFrames: 100 })]),
    { type: 'split', id: 'a', atFrame: 25, newId: 'fast-right' },
  );
  const fastRight = fast.items.find((clip) => clip.id === 'fast-right')!;
  assert.deepEqual(
    [fastRight.startFrame, fastRight.durationInFrames, fastRight.srcInFrame],
    [25, 75, 60],
    '2x split resumes after 50 source frames while preserving the right timeline duration',
  );

  const slow = reduce(
    stateOf([item({ srcInFrame: 10, playbackRate: 0.5, durationInFrames: 100 })]),
    { type: 'split', id: 'a', atFrame: 25, newId: 'slow-right' },
  );
  const slowRight = slow.items.find((clip) => clip.id === 'slow-right')!;
  assert.deepEqual(
    [slowRight.startFrame, slowRight.durationInFrames, slowRight.srcInFrame],
    [25, 75, 22.5],
    '0.5x split preserves the fractional source boundary instead of skipping ahead',
  );
}
console.log('sourceLimit.verify: ok (\u5269\u4f59\u6e90\u5e27\u6362\u7b97/\u53d8\u901f/\u4e0d\u8bbe\u9650\u89c4\u5219/\u771f reduce \u53f3\u88c1\u4e0a\u754c)');
