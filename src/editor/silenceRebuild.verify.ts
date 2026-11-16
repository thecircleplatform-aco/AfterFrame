// Runnable check: `npx tsx src/editor/silenceRebuild.verify.ts`.
// Verify: span→local frame cropping (clamp/segment/edge), and the planned split/remove sequence
// After applying [real reducer] one by one, the number of segments/duration/srcIn/ripple left shift of the timeline are all correct.
import assert from 'node:assert/strict';
import { reduce, type Action } from './reduce';
import { planSilenceRemoval, silenceRemovalBlocker, spansToLocalCuts } from './silenceRebuild';
import type { TimelineItem, TimelineState } from './types';

const FPS = 30;

const clip = (over: Partial<TimelineItem>): TimelineItem => ({
  id: 'main', track: 'V1', startFrame: 0, durationInFrames: 300,
  name: 'talk', kind: 'video', src: '/media/uploads/talk.mp4',
  ...over,
});

const baseState = (items: TimelineItem[]): TimelineState => ({
  fps: FPS, width: 1920, height: 1080, items, selectedId: null,
} as unknown as TimelineState);

const apply = (state: TimelineState, actions: Action[]): TimelineState =>
  actions.reduce((s, a) => reduce(s, a), state);

// ── spansToLocalCuts: source milliseconds → local frame, clamp source window, srcIn takes effect ──
const trimmed = clip({ srcInFrame: 60, durationInFrames: 240 }); // Source window [60, 300)
const cuts1 = spansToLocalCuts(trimmed, [
  { startMs: 0, endMs: 1000 },      // source [0,30) — before window, insufficient after clamp → lose
  { startMs: 4000, endMs: 5000 },   // source [120,150) → local [60,90)
  { startMs: 9800, endMs: 12000 },  // source [294,360) → local [234,240) tail
], FPS);
assert.deepEqual(cuts1, [{ fromFrame: 60, toFrame: 90 }, { fromFrame: 234, toFrame: 240 }], 'clamp + srcIn \u6620\u5c04');

// The fragmented reserved sections are merged and deleted: the two sections of silence are only separated by 3 frames → merged into one section
const cuts2 = spansToLocalCuts(clip({}), [
  { startMs: 1000, endMs: 2000 },
  { startMs: 2100, endMs: 3000 },
], FPS);
assert.deepEqual(cuts2, [{ fromFrame: 30, toFrame: 90 }], '3 \u5e27\u4fdd\u7559\u6bb5\u5e76\u5165');

// The entire line is quiet: conservative and giving up
assert.deepEqual(spansToLocalCuts(clip({}), [{ startMs: 0, endMs: 10_000 }], FPS), [], '\u6574\u6761\u5168\u9759\u4e0d\u52a8');

// ── Planning + true reducer: dead energy in the middle, subsequent clip ripples on the same track shift left ──
{
  const follower = clip({ id: 'next', startFrame: 300, durationInFrames: 90 });
  let n = 0;
  const plan = planSilenceRemoval(clip({}), [{ fromFrame: 100, toFrame: 160 }], () => `seg_${++n}`);
  const out = apply(baseState([clip({}), follower]), plan.actions);
  const v1 = out.items.filter((it) => it.track === 'V1').sort((a, b) => a.startFrame - b.startFrame);
  assert.equal(plan.removedFrames, 60);
  assert.equal(v1.length, 3, '\u4e3b clip \u53d8\u4e24\u6bb5 + \u8ddf\u968f clip');
  const [a, b, c] = v1;
  assert.deepEqual([a!.startFrame, a!.durationInFrames, a!.srcInFrame ?? 0], [0, 100, 0], '\u4fdd\u7559\u6bb5 1');
  assert.deepEqual([b!.startFrame, b!.durationInFrames, b!.srcInFrame], [100, 140, 160], '\u4fdd\u7559\u6bb5 2 \u6e90\u70b9\u8df3\u8fc7\u6b7b\u6c14');
  assert.deepEqual([c!.id, c!.startFrame], ['next', 240], '\u540c\u8f68\u540e\u7eed clip \u5de6\u79fb 60 \u5e27');
}

// ── The death energy at the beginning + the death energy at the end (the original id is deleted at the beginning, and the whole paragraph at the end is removed) ──
{
  let n = 0;
  const plan = planSilenceRemoval(clip({}), [
    { fromFrame: 0, toFrame: 45 },
    { fromFrame: 200, toFrame: 300 },
  ], () => `seg_${++n}`);
  const out = apply(baseState([clip({})]), plan.actions);
  assert.equal(plan.removedFrames, 145);
  assert.equal(out.items.length, 1, '\u53ea\u5269\u4e2d\u95f4\u4fdd\u7559\u6bb5');
  const only = out.items[0]!;
  assert.deepEqual([only.startFrame, only.durationInFrames, only.srcInFrame], [0, 155, 45], '\u5934\u5c3e\u90fd\u5220\u51c0,srcIn=45');
}

// ── Multiple sections of dead energy: three reserved sections, srcIn jumps section by section, and the last section is aligned ──
{
  let n = 0;
  const plan = planSilenceRemoval(clip({}), [
    { fromFrame: 60, toFrame: 90 },
    { fromFrame: 180, toFrame: 240 },
  ], () => `seg_${++n}`);
  const out = apply(baseState([clip({})]), plan.actions);
  const segs = out.items.sort((a, b) => a.startFrame - b.startFrame);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map((s) => [s.startFrame, s.durationInFrames, s.srcInFrame ?? 0]), [
    [0, 60, 0],
    [60, 90, 90],
    [150, 60, 240],
  ], '\u4e09\u6bb5\u4f4d\u7f6e/\u65f6\u957f/\u6e90\u70b9');
  const total = segs.reduce((sum, s) => sum + s.durationInFrames, 0);
  assert.equal(total, 300 - plan.removedFrames, '\u603b\u65f6\u957f\u6052\u7b49');
}

// ── Fade in and out to the outer edge: keep fadeIn in the first section, fadeOut in the last section, and no fade in the cut ──
{
  let n = 0;
  const faded = clip({ fadeInFrames: 12, fadeOutFrames: 15 });
  const plan = planSilenceRemoval(faded, [{ fromFrame: 100, toFrame: 160 }], () => `f_${++n}`);
  const out = apply(baseState([faded]), plan.actions);
  const segs = out.items.sort((a, b) => a.startFrame - b.startFrame);
  assert.equal(segs[0]!.fadeInFrames, 12, '\u9996\u6bb5\u4fdd\u7559 fadeIn');
  assert.equal(segs[0]!.fadeOutFrames, undefined, '\u5207\u53e3\u4e0d\u6de1\u51fa');
  assert.equal(segs[1]!.fadeInFrames, undefined, '\u5207\u53e3\u4e0d\u6de1\u5165');
  assert.equal(segs[1]!.fadeOutFrames, 15, '\u672b\u6bb5\u4fdd\u7559 fadeOut');
}

// ── Gatekeeper: variable speed/zoom/word-level editing/non-audio/video/passive ──
assert.match(silenceRemovalBlocker(clip({ playbackRate: 2 })) ?? '', /\u53d8\u901f/);
assert.match(silenceRemovalBlocker(clip({ zoom: { kind: 'shape' } as never })) ?? '', /zoom/);
assert.match(silenceRemovalBlocker(clip({ kind: 'image' })) ?? '', /\u65e0\u97f3\u9891/);
assert.match(silenceRemovalBlocker(clip({ src: undefined })) ?? '', /\u65e0\u5a92\u4f53\u6e90/);
assert.match(
  silenceRemovalBlocker(clip({ transcript: [{ text: 'hi', start: 0, end: 300 }], deletedWordIdx: [0] })) ?? '',
  /clean_script/, '\u8bcd\u7ea7\u7f16\u8f91\u8fc7\u7684\u8f6c\u5199 clip \u8ba9\u4f4d clean_script',
);
assert.equal(silenceRemovalBlocker(clip({ transcript: [{ text: 'hi', start: 0, end: 300 }] })), null, '\u672a\u7f16\u8f91\u7684\u8f6c\u5199 clip \u53ef\u5904\u7406');
assert.equal(silenceRemovalBlocker(clip({})), null, '\u666e\u901a\u89c6\u9891\u53ef\u5904\u7406');

console.log('silenceRebuild.verify: ok (\u6620\u5c04/\u5e76\u6bb5/\u771f reducer \u6ce2\u7eb9/\u6de1\u5316\u5916\u7f18/\u5b88\u95e8)');
