// Runnable check: `npx tsx src/editor/layouts.verify.ts`.
// Verification: Cover placement and inverse visible rectangle are exactly equal to the slots (all layouts × all slots); no stretching (scale single value is
// year-on-year); anchor boundary; fit mailbox; pip parameters; illegal slot rejection; tool layer verification and batch output.
import assert from 'node:assert/strict';
import {
  LAYOUT_IDS, layoutSlots, placeInSlot, visibleRectOf,
  type LayoutId, type SlotRect,
} from './layouts';
import { LAYOUT_TOOL_NAMES, execLayoutTool } from '../agent/tools/layout-tools';
import type { AgentContext } from '../agent/context';
import type { TimelineState } from './types';

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;
const rectNear = (a: SlotRect, b: SlotRect): boolean =>
  near(a.x, b.x, 1e-4) && near(a.y, b.y, 1e-4) && near(a.w, b.w, 1e-4) && near(a.h, b.h, 1e-4);

// ── cover: each layout, each slot, visible rectangle === slot (no overlap, no missing corners, no stretching) ──
for (const layout of LAYOUT_IDS) {
  const slots = layoutSlots(layout as LayoutId);
  for (const [name, slot] of Object.entries(slots)) {
    const t = placeInSlot(slot, 'cover');
    assert.ok(rectNear(visibleRectOf(t), slot), `${layout}/${name} cover \u53ef\u89c6\u77e9\u5f62\u5e94\u7b49\u4e8e\u69fd\u4f4d`);
    assert.ok((t.scale ?? 0) > 0, `${layout}/${name} scale > 0`);
    const c = t.crop;
    if (c) {
      for (const v of [c.left, c.top, c.right, c.bottom]) assert.ok((v ?? 0) >= 0 && (v ?? 0) < 1, '\u88c1\u5207\u5206\u6570\u5728\u754c\u5185');
      assert.ok((c.left ?? 0) + (c.right ?? 0) < 1 && (c.top ?? 0) + (c.bottom ?? 0) < 1, '\u88c1\u5207\u4e0d\u5403\u5149\u6574\u5c42');
    }
  }
}

// ── Specific values: Left half screen = original size, middle half cropped, left shift 25%; grid angle = half size without cropping ──
const left = placeInSlot(layoutSlots('2up-horizontal').left!, 'cover');
assert.ok(near(left.scale!, 1) && near(left.x!, -25) && near(left.y!, 0), '\u5de6\u534a\u5c4f scale1/x-25');
assert.ok(near(left.crop!.left!, 0.25) && near(left.crop!.right!, 0.25), '\u5de6\u534a\u5c4f\u5de6\u53f3\u5404\u88c1 1/4');
const tl = placeInSlot(layoutSlots('grid-4')['top-left']!, 'cover');
assert.equal(tl.crop, undefined, '\u540c\u6bd4\u69fd(grid \u89d2)\u65e0\u9700\u88c1\u5207');
assert.ok(near(tl.scale!, 0.5) && near(tl.x!, -25) && near(tl.y!, -25), 'grid \u89d2\u534a\u5c3a\u5bf8\u5c45\u89d2');

// ── Anchor: 0 keeps left/top (left is not cropped), 1 keeps right/bottom; the visible rectangle is still exactly equal to the slot ──
const keepLeft = placeInSlot(layoutSlots('2up-horizontal').left!, 'cover', 0, 0.5);
assert.ok(near(keepLeft.crop!.left!, 0) && near(keepLeft.crop!.right!, 0.5), 'anchorX=0 \u53ea\u88c1\u53f3\u4fa7');
assert.ok(rectNear(visibleRectOf(keepLeft), layoutSlots('2up-horizontal').left!), 'anchor \u4e0d\u7834\u574f\u69fd\u4f4d\u5bf9\u9f50');
const keepBottom = placeInSlot(layoutSlots('2up-vertical').top!, 'cover', 0.5, 1);
assert.ok(near(keepBottom.crop!.top!, 0.5) && near(keepBottom.crop!.bottom!, 0), 'anchorY=1 \u53ea\u88c1\u4e0a\u4fa7');

// ── fit: The mailbox is not cut, the box is contained in the slot and centered ──
const fitLeft = placeInSlot(layoutSlots('2up-horizontal').left!, 'fit');
assert.equal(fitLeft.crop, undefined, 'fit \u4e0d\u88c1\u5207');
assert.ok(near(fitLeft.scale!, 0.5), 'fit \u53d6 min(slot.w, slot.h)');
const fitBox = visibleRectOf(fitLeft);
const slotL = layoutSlots('2up-horizontal').left!;
assert.ok(fitBox.x >= slotL.x - 1e-6 && fitBox.x + fitBox.w <= slotL.x + slotL.w + 1e-6, 'fit \u76d2\u5b50\u6a2a\u5411\u542b\u4e8e\u69fd');
assert.ok(near(fitBox.x + fitBox.w / 2, slotL.x + slotL.w / 2), 'fit \u5c45\u4e2d');

// ── full = reset:scale1 / no displacement / no cropping ──
const full = placeInSlot(layoutSlots('full').full!, 'cover');
assert.ok(near(full.scale!, 1) && near(full.x!, 0) && near(full.y!, 0) && full.crop === undefined && full.rotation === 0, 'full \u5373\u590d\u4f4d');

// ── pip: corner/size/margin parameters take effect and are clamped ──
const pip = layoutSlots('pip', { corner: 'top-left', size: 0.25, margin: 0.05 });
assert.ok(rectNear(pip.inset!, { x: 0.05, y: 0.05, w: 0.25, h: 0.25 }), 'pip \u5de6\u4e0a\u89d2\u5c0f\u7a97');
const clamped = layoutSlots('pip', { size: 5, margin: -1 });
assert.ok(near(clamped.inset!.w, 0.6) && near(clamped.inset!.x, 0.4), 'pip \u53c2\u6570\u8d8a\u754c\u88ab\u94b3\u5236');

// ──Illegal slot rejection──
assert.throws(() => placeInSlot({ x: 0.8, y: 0, w: 0.5, h: 1 }), /invalid slot/, '\u8d8a\u51fa\u753b\u5e03\u7684\u69fd\u62d2\u7edd');
assert.throws(() => placeInSlot({ x: 0, y: 0, w: 0, h: 1 }), /invalid slot/, '\u96f6\u5bbd\u69fd\u62d2\u7edd');

// ── Tool layer: verification, batch output, pip stacking and time overlap reminder ──
assert.ok(LAYOUT_TOOL_NAMES.has('apply_layout'));
interface Recorded { actions: Array<{ type: string; id: string; patch: Record<string, unknown> }>; label?: string }
const recorded: Recorded = { actions: [] };
const state = {
  fps: 30, width: 1920, height: 1080, selectedId: null,
  trackOrder: ['V2', 'V1'],
  tracks: { V1: { kind: 'video' }, V2: { kind: 'video' } },
  items: [
    { id: 'a', track: 'V1', startFrame: 0, durationInFrames: 90, name: 'A', kind: 'video', src: 'x.mp4' },
    { id: 'b', track: 'V2', startFrame: 30, durationInFrames: 90, name: 'B', kind: 'video', src: 'y.mp4' },
    { id: 'late', track: 'V2', startFrame: 500, durationInFrames: 30, name: 'L', kind: 'video', src: 'z.mp4' },
    { id: 'snd', track: 'V1', startFrame: 0, durationInFrames: 30, name: 'S', kind: 'audio', src: 's.mp3' },
  ],
} as unknown as TimelineState;
const ctx = {
  getState: () => state,
  commands: {
    batch: (actions: Recorded['actions'], label?: string) => { recorded.actions = actions; recorded.label = label; },
  },
} as unknown as AgentContext;

const ok = execLayoutTool('apply_layout', {
  layout: '2up-horizontal',
  assignments: [{ slot: 'left', itemId: 'a' }, { slot: 'right', itemId: 'b' }],
}, ctx) as { applied: Array<{ itemId: string; transform: { x?: number } }>; notes?: string[] };
assert.equal(recorded.actions.length, 2, '\u4e00\u6b21 batch \u4e24\u6761 setTransform');
assert.equal(recorded.actions[0]!.type, 'setTransform');
assert.ok(near(ok.applied[0]!.transform.x!, -25), '\u5de6\u69fd x=-25');
assert.equal(ok.notes, undefined, '\u65f6\u95f4\u91cd\u53e0\u6b63\u5e38 → \u65e0\u63d0\u9192');

const bad = execLayoutTool('apply_layout', { layout: 'grid-4', assignments: [{ slot: 'middle', itemId: 'a' }] }, ctx) as { error?: string };
assert.match(bad.error ?? '', /unknown slot/, '\u672a\u77e5\u69fd\u540d\u62a5\u9519');
const dup = execLayoutTool('apply_layout', { layout: '2up-horizontal', assignments: [{ slot: 'left', itemId: 'a' }, { slot: 'left', itemId: 'b' }] }, ctx) as { error?: string };
assert.match(dup.error ?? '', /assigned twice/, '\u91cd\u590d\u69fd\u62a5\u9519');
const audio = execLayoutTool('apply_layout', { layout: 'full', assignments: [{ slot: 'full', itemId: 'snd' }] }, ctx) as { error?: string };
assert.match(audio.error ?? '', /visual clips/, '\u97f3\u9891\u7247\u6bb5\u62d2\u7edd');

// trackOrder V2 in front (upstream) → inset V1 (downstream) should be reminded; if the time does not overlap, it should also be reminded
const warn = execLayoutTool('apply_layout', {
  layout: 'pip',
  assignments: [{ slot: 'main', itemId: 'b' }, { slot: 'inset', itemId: 'a' }],
}, ctx) as { notes?: string[] };
assert.ok(warn.notes?.some((n) => n.includes('BEHIND')), 'inset \u4f4e\u4e8e main → \u53e0\u653e\u63d0\u9192');
const never = execLayoutTool('apply_layout', {
  layout: '2up-horizontal',
  assignments: [{ slot: 'left', itemId: 'a' }, { slot: 'right', itemId: 'late' }],
}, ctx) as { notes?: string[] };
assert.ok(never.notes?.some((n) => n.includes('overlap in time')), '\u65f6\u95f4\u4e0d\u91cd\u53e0 → \u63d0\u9192');

console.log('layouts.verify: ok (cover \u69fd\u4f4d\u6052\u7b49/anchor/fit/pip/\u590d\u4f4d/\u5de5\u5177\u6821\u9a8c)');
