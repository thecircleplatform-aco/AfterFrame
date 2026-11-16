// Runnable check: `npx tsx src/editor/camSwitch.verify.ts`.
// Verification: Geometric results of the change_cam planner through the real reducer (border double cut/edge single cut/entire segment deletion/
// Non-intersecting zero action), srcInFrame forward, no ripple (other rails don't move), coverage gap calculation, and
// Tool layer execChangeCam's boundary verification, multi-segment target from the same source, and single batch submission.
import assert from 'node:assert/strict';
import { coveredFrames, planCamSwitch } from './camSwitch';
import { reduce, type Action, type AtomicAction } from './reduce';
import type { TimelineItem, TimelineState } from './types';
import { execChangeCam } from '../agent/tools/multicam-tools';

let seq = 0;
const makeId = (): string => `seg_${++seq}`;
const clip = (id: string, track: string, startFrame: number, dur: number, src: string, patch: Partial<TimelineItem> = {}): TimelineItem =>
  ({ id, track, startFrame, durationInFrames: dur, kind: 'video', name: id, src, ...patch } as TimelineItem);

const baseState = (): TimelineState => ({
  fps: 30, width: 1920, height: 1080, selectedId: null,
  tracks: { V1: { kind: 'video' }, V2: { kind: 'video' }, V3: { kind: 'video' }, A1: { kind: 'audio' } },
  trackOrder: ['V1', 'V2', 'V3', 'A1'],
  items: [
    clip('camA', 'V1', 0, 300, '/m/a.mp4'),
    clip('camB', 'V2', 0, 300, '/m/b.mp4', { keyframes: { opacity: [{ frame: 0, value: 1 }, { frame: 299, value: 0.2 }] } }),
    clip('camC', 'V3', 0, 300, '/m/c.mp4'),
    { id: 'mix', track: 'A1', startFrame: 0, durationInFrames: 300, kind: 'audio', name: 'mix', src: '/m/mix.wav' } as TimelineItem,
  ],
});

const applyPlan = (s: TimelineState, actions: Action[]): TimelineState => actions.reduce(reduce, s);
const spansOf = (s: TimelineState, src: string) => s.items
  .filter((it) => it.src === src)
  .map((it) => [it.startFrame, it.startFrame + it.durationInFrames])
  .sort((a, b) => a[0] - b[0]);

// ── 1. The interval is in the middle: other camera positions are double-cut and deleted, leaving [0,60)+[150,300), srcIn is moved forward by 150 ──
{
  const s0 = baseState();
  const plan = planCamSwitch([s0.items[0]], [s0.items[1], s0.items[2]], 60, 150, makeId);
  assert.equal(plan.actions.length, 6, '\u4e24\u673a\u4f4d\u5404 2 \u5207 1 \u5220');
  assert.equal(plan.coverageGapFrames, 0, '\u76ee\u6807\u5168\u8986\u76d6\u65e0\u7f3a\u53e3');
  const s1 = applyPlan(s0, plan.actions);
  assert.deepEqual(spansOf(s1, '/m/b.mp4'), [[0, 60], [150, 300]], 'camB \u5269\u4e24\u6bb5');
  assert.deepEqual(spansOf(s1, '/m/c.mp4'), [[0, 60], [150, 300]], 'camC \u5269\u4e24\u6bb5');
  assert.deepEqual(spansOf(s1, '/m/a.mp4'), [[0, 300]], '\u76ee\u6807\u673a\u4f4d\u4e0d\u52a8');
  const bTail = s1.items.find((it) => it.src === '/m/b.mp4' && it.startFrame === 150)!;
  assert.equal(bTail.srcInFrame ?? 0, 150, '\u5c3e\u6bb5\u6e90\u70b9\u524d\u79fb\u5230\u5207\u70b9');
  const bHead = s1.items.find((it) => it.src === '/m/b.mp4' && it.startFrame === 0)!;
  assert.ok(bHead.keyframes?.opacity?.length && bTail.keyframes?.opacity?.length, '\u5173\u952e\u5e27\u968f split \u5206\u6bb5\u4fdd\u7559');
  const mix = s1.items.find((it) => it.id === 'mix')!;
  assert.equal(`${mix.startFrame}:${mix.durationInFrames}`, '0:300', '\u97f3\u9891\u8f68\u5b8c\u5168\u4e0d\u52a8(\u65e0\u6ce2\u7eb9)');
}

// ── 2. Interval pasting clip header: single cut right boundary, delete [0,150) ──
{
  const s0 = baseState();
  const plan = planCamSwitch([s0.items[0]], [s0.items[1]], 0, 150, makeId);
  assert.equal(plan.actions.length, 2, '1 \u5207 1 \u5220');
  assert.deepEqual(spansOf(applyPlan(s0, plan.actions), '/m/b.mp4'), [[150, 300]], '\u4ec5\u5269\u5c3e\u6bb5');
}

// ── 3. The interval is full clip: zero cut and whole deletion ──
{
  const s0 = baseState();
  const plan = planCamSwitch([s0.items[0]], [s0.items[1]], 0, 300, makeId);
  assert.deepEqual(plan.actions.map((a) => a.type), ['remove'], '\u6574\u6bb5\u76f4\u63a5\u5220');
  assert.deepEqual(spansOf(applyPlan(s0, plan.actions), '/m/b.mp4'), [], 'camB \u6e05\u7a7a');
}

// ── 4. Disjoint: zero action; coverage gap is counted in frames ──
{
  const s0 = baseState();
  const far = clip('camD', 'V3', 500, 100, '/m/d.mp4');
  assert.equal(planCamSwitch([s0.items[0]], [far], 60, 150, makeId).actions.length, 0, '\u533a\u95f4\u5916\u96f6\u52a8\u4f5c');
  const shortTarget = clip('camA2', 'V1', 0, 100, '/m/a.mp4');
  const plan = planCamSwitch([shortTarget], [s0.items[1]], 60, 200, makeId);
  assert.equal(plan.coverageGapFrames, 100, '\u76ee\u6807\u53ea\u76d6 40 \u5e27,\u7f3a 100 \u5e27');
  assert.equal(coveredFrames([shortTarget], 60, 200), 40, 'coveredFrames \u8ba1\u6570');
}

// ── 5. Tool layer: single batch submission + geometric consistency; multiple segments from the same source are considered targets ──
{
  let s = baseState();
  let batches = 0;
  const ctx = {
    getState: () => s,
    commands: { batch: (actions: AtomicAction[]) => { batches++; s = actions.reduce((st, a) => reduce(st, a as Action), s); } },
  } as unknown as Parameters<typeof execChangeCam>[1];
  const r = execChangeCam({ itemIds: ['camA', 'camB', 'camC'], targetItemId: 'camA', fromSeconds: 2, toSeconds: 5 }, ctx) as Record<string, unknown>;
  assert.equal(r.error, undefined, `no error (got ${String(r.error)})`);
  assert.equal(batches, 1, '\u6070\u597d\u4e00\u6b21 batch(\u4e00\u6b65\u64a4\u9500)');
  assert.deepEqual(spansOf(s, '/m/b.mp4'), [[0, 60], [150, 300]], '\u5de5\u5177\u5c42\u51e0\u4f55\u4e0e\u89c4\u5212\u5668\u4e00\u81f4');
  assert.equal((r.removedSegments as unknown[]).length, 2, '\u62a5\u544a\u4e24\u6bb5\u79fb\u9664');

  // The second cut: camB has been divided into two segments, and only the current segment id is listed; the target homologous segment will not be accidentally deleted.
  const bSegs = s.items.filter((it) => it.src === '/m/b.mp4').map((it) => it.id);
  const r2 = execChangeCam({ itemIds: ['camA', ...bSegs], targetItemId: 'camA', fromSeconds: 6, toSeconds: 8 }, ctx) as Record<string, unknown>;
  assert.equal(r2.error, undefined, 'second switch ok');
  assert.deepEqual(spansOf(s, '/m/b.mp4'), [[0, 60], [150, 180], [240, 300]], '\u7b2c\u4e8c\u5200\u518d\u6316\u6389 [180,240)');
  assert.deepEqual(spansOf(s, '/m/a.mp4'), [[0, 300]], '\u76ee\u6807\u4ecd\u5b8c\u6574');
}

// ── 6. Boundary check: each error path ──
{
  const s0 = baseState();
  const ctx = { getState: () => s0, commands: { batch: () => { throw new Error('must not commit'); } } } as unknown as Parameters<typeof execChangeCam>[1];
  const err = (args: Record<string, unknown>) => (execChangeCam(args, ctx) as { error?: string }).error ?? '';
  assert.match(err({ itemIds: ['camA'], targetItemId: 'camA', fromSeconds: 0 }), /at least 2/, '\u5c11\u4e8e 2 \u4e2a\u673a\u4f4d');
  assert.match(err({ itemIds: ['camA', 'nope'], targetItemId: 'camA', fromSeconds: 0 }), /not found/, '\u672a\u77e5 id');
  assert.match(err({ itemIds: ['camA', 'mix'], targetItemId: 'camA', fromSeconds: 0 }), /must be video/, '\u975e\u89c6\u9891\u673a\u4f4d');
  assert.match(err({ itemIds: ['camA', 'camB'], targetItemId: 'camC', fromSeconds: 0 }), /must be one of/, '\u76ee\u6807\u4e0d\u5728\u7ec4\u5185');
  assert.match(err({ itemIds: ['camA', 'camB'], targetItemId: 'camA', fromSeconds: -1 }), /fromSeconds/, '\u8d1f\u8d77\u70b9');
  assert.match(err({ itemIds: ['camA', 'camB'], targetItemId: 'camA', fromSeconds: 5, toSeconds: 5 }), /empty switch range/, '\u7a7a\u533a\u95f4');
  const shortA = { ...s0, items: s0.items.map((it) => (it.id === 'camA' ? { ...it, durationInFrames: 30 } : it)) };
  const ctx2 = { getState: () => shortA, commands: { batch: () => { throw new Error('must not commit'); } } } as unknown as Parameters<typeof execChangeCam>[1];
  assert.match((execChangeCam({ itemIds: ['camA', 'camB'], targetItemId: 'camA', fromSeconds: 5, toSeconds: 8 }, ctx2) as { error?: string }).error ?? '', /no clip in the switch range/, '\u76ee\u6807\u96f6\u8986\u76d6\u62d2\u7edd');
  const locked = { ...s0, tracks: { ...s0.tracks, V2: { kind: 'video' as const, locked: true } } };
  const ctx3 = { getState: () => locked, commands: { batch: () => { throw new Error('must not commit'); } } } as unknown as Parameters<typeof execChangeCam>[1];
  assert.match((execChangeCam({ itemIds: ['camA', 'camB'], targetItemId: 'camA', fromSeconds: 0, toSeconds: 2 }, ctx3) as { error?: string }).error ?? '', /locked/, '\u9501\u8f68\u62d2\u7edd');
}

// ── 7. Multiple segments from the same source: The remaining segments of the target camera will not be deleted as "other cameras" and will be included in the coverage together ──
{
  let s: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    tracks: { V1: { kind: 'video' }, V2: { kind: 'video' } }, trackOrder: ['V1', 'V2'],
    items: [
      clip('a1', 'V1', 0, 100, '/m/a.mp4'),
      clip('a2', 'V1', 100, 200, '/m/a.mp4', { srcInFrame: 100 }),
      clip('camB', 'V2', 0, 300, '/m/b.mp4'),
    ],
  };
  const ctx = {
    getState: () => s,
    commands: { batch: (actions: AtomicAction[]) => { s = actions.reduce((st, a) => reduce(st, a as Action), s); } },
  } as unknown as Parameters<typeof execChangeCam>[1];
  const r = execChangeCam({ itemIds: ['a1', 'a2', 'camB'], targetItemId: 'a1', fromSeconds: 2, toSeconds: 6 }, ctx) as Record<string, unknown>;
  assert.equal(r.error, undefined, 'same-src switch ok');
  assert.deepEqual(spansOf(s, '/m/a.mp4'), [[0, 100], [100, 300]], '\u76ee\u6807\u540c\u6e90\u6bb5\u5168\u90e8\u4fdd\u7559');
  assert.deepEqual(spansOf(s, '/m/b.mp4'), [[0, 60], [180, 300]], 'camB \u6316\u6389 [60,180)');
  assert.equal(r.coverageGapSeconds, 0, '\u8de8\u6bb5\u8986\u76d6\u65e0\u7f3a\u53e3');
}

console.log('camSwitch.verify: all assertions passed');
