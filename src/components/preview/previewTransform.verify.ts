import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TimelineItem, TimelineState } from '../../editor/types';
import { appearanceAt } from '../../editor/clipFade';
import * as previewTransformModule from './previewTransform';
import {
  cyclePreviewCandidate,
  edgeCropPreviewTransform,
  effectivePreviewTransform,
  hitPreviewCandidates,
  movePreviewTransform,
  previewCandidateGeometry,
  rotatePreviewTransform,
  scalePreviewTransform,
  uniformScaleAxesPreviewTransform,
  visiblePreviewCandidates,
  type PreviewPoint,
} from './previewTransform';

const visualItem = (
  id: string,
  track: string,
  patch: Partial<TimelineItem> = {},
): TimelineItem => ({
  id,
  track,
  startFrame: 0,
  durationInFrames: 90,
  kind: 'image',
  name: id,
  src: `/media/${id}.png`,
  width: 1920,
  height: 1080,
  ...patch,
});

const stateOf = (patch: Partial<TimelineState> = {}): TimelineState => ({
  fps: 30,
  width: 1080,
  height: 1920,
  fit: 'contain',
  selectedId: null,
  trackOrder: ['V2', 'V1', 'A1'],
  tracks: {
    V2: { kind: 'video' },
    V1: { kind: 'video' },
    A1: { kind: 'audio' },
  },
  items: [],
  ...patch,
});

// ，
// 1:1  contain  16:9 ， 1080×608
{
  const geometryApi = previewTransformModule as unknown as {
    visibleVisualFrameRect?: (
      canvas: { width: number; height: number },
      source: { width: number; height: number },
      fit: 'contain' | 'cover',
    ) => { x: number; y: number; width: number; height: number };
    clampVisualBorderRadius?: (
      borderRadius: number,
      frame: { width: number; height: number },
    ) => number;
  };
  assert.equal(typeof geometryApi.visibleVisualFrameRect, 'function', '\u5e94\u63d0\u4f9b\u7d20\u6750\u53ef\u89c1\u77e9\u5f62\u7684\u5171\u7528\u51e0\u4f55');
  assert.equal(typeof geometryApi.clampVisualBorderRadius, 'function', '\u5e94\u6309\u7d20\u6750\u77ed\u8fb9\u7ea6\u675f\u5706\u89d2');
  if (geometryApi.visibleVisualFrameRect && geometryApi.clampVisualBorderRadius) {
    const frame = geometryApi.visibleVisualFrameRect(
      { width: 1080, height: 1080 },
      { width: 1920, height: 1080 },
      'contain',
    );
    assert.deepEqual(frame, { x: 0, y: 236, width: 1080, height: 608 });
    assert.equal(geometryApi.clampVisualBorderRadius(405, frame), 304);
  }
}

{
  const { objectFitInsideVisualFrame } = previewTransformModule;
  assert.equal(objectFitInsideVisualFrame('contain'), 'fill', 'contain box is already fitted; fill avoids a second letterbox');
  assert.equal(objectFitInsideVisualFrame('cover'), 'cover');
}

// A wrong paint-order mirror would select the background instead of the card.
{
  const v1 = visualItem('v1', 'V1');
  const early = visualItem('early', 'V2', { startFrame: 0 });
  const late = visualItem('late', 'V2', { startFrame: 10 });
  const audio = visualItem('audio', 'A1', { kind: 'audio' });
  const hidden = visualItem('hidden', 'VH');
  const locked = visualItem('locked', 'VL');
  const expired = visualItem('expired', 'V2', { durationInFrames: 5 });
  const state = stateOf({
    items: [v1, early, late, audio, hidden, locked, expired],
    trackOrder: ['VH', 'VL', 'V2', 'V1', 'A1'],
    tracks: {
      VH: { kind: 'video', hidden: true },
      VL: { kind: 'video', locked: true },
      V2: { kind: 'video' },
      V1: { kind: 'video' },
      A1: { kind: 'audio' },
    },
  });
  assert.deepEqual(
    visiblePreviewCandidates(state, 15).map(({ item }) => item.id),
    ['late', 'early', 'v1'],
    '\u5019\u9009\u987a\u5e8f\u5fc5\u987b\u4e0e\u5408\u6210\u5c42\u76f8\u53cd：\u6700\u4e0a\u5c42\u4f18\u5148，\u540c\u8f68\u540e\u5f00\u59cb\u7684\u7247\u6bb5\u5728\u4e0a',
  );
}

// 9:16 canvas containing a 16:9 source produces a centered integer 1080×608 box.
{
  const item = visualItem('wide', 'V1');
  const state = stateOf({ items: [item] });
  const [candidate] = visiblePreviewCandidates(state, 0);
  assert.ok(candidate);
  const geometry = previewCandidateGeometry(state, candidate);
  assert.deepEqual(geometry.baseRect, { x: 0, y: 656, width: 1080, height: 608 });

  const cropped = visualItem('cropped', 'V1', {
    transform: { crop: { left: 0.25, right: 0.25 } },
  });
  const cropState = stateOf({ items: [cropped] });
  const cropGeometry = previewCandidateGeometry(cropState, visiblePreviewCandidates(cropState, 0)[0]!);
  assert.deepEqual(cropGeometry.baseRect, { x: 270, y: 656, width: 540, height: 608 });

  const bottomCropped = visualItem('bottom', 'V1', {
    transform: { crop: { bottom: 800 / 1920 } },
  });
  const bottomState = stateOf({ items: [bottomCropped] });
  const bottomGeometry = previewCandidateGeometry(bottomState, visiblePreviewCandidates(bottomState, 0)[0]!);
  assert.deepEqual(
    bottomGeometry.baseRect,
    { x: 0, y: 656, width: 1080, height: 464 },
    'Crop Bottom uses canvas pixels; outline meets the clipped picture, not a leftover strip',
  );
}

// Rotation is around the composition center (CSS 50% 50%), so that point stays put.
{
  const item = visualItem('wide', 'V1', { transform: { rotation: 90 } });
  const state = stateOf({ items: [item] });
  const geometry = previewCandidateGeometry(state, visiblePreviewCandidates(state, 0)[0]!);
  assert.equal(geometry.center.x, 540);
  assert.equal(geometry.center.y, 960);
  const appearance = appearanceAt(item, 0, false, { width: 1080, height: 1920 });
  assert.equal(appearance.foregroundStyle.transformOrigin, '50% 50%');
  assert.equal(appearance.foregroundStyle.transformBox, 'border-box');
}

// Background fill renders a contained sharp foreground even when the timeline's normal fit is cover.
// The transform outline must follow that foreground instead of disappearing against the canvas edge.
{
  const item = visualItem('background-fill', 'V1', { backgroundFill: true });
  const state = stateOf({ fit: 'cover', items: [item] });
  const geometry = previewCandidateGeometry(state, visiblePreviewCandidates(state, 0)[0]!);
  assert.deepEqual(geometry.baseRect, { x: 0, y: 656, width: 1080, height: 608 });
}

// A transient zero-size canvas during window resize must not leak NaN geometry.
{
  const item = visualItem('zero-canvas', 'V1');
  const state = stateOf({ width: 0, height: 0, items: [item] });
  const geometry = previewCandidateGeometry(state, visiblePreviewCandidates(state, 0)[0]!);
  assert.deepEqual(geometry.baseRect, { x: 0, y: 0, width: 0, height: 0 });
  assert.ok(geometry.corners.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
}

// Keyframes override the static transform at the current item-local frame.
{
  const item = visualItem('keyed', 'V1', {
    startFrame: 10,
    transform: { x: 3, y: 4, scale: 1.2, scaleX: 1.2, scaleY: 1.2, rotation: 5 },
    keyframes: {
      x: [{ frame: 0, value: 10 }, { frame: 20, value: 30 }],
      rotation: [{ frame: 0, value: 170 }, { frame: 20, value: 190 }],
    },
  });
  assert.deepEqual(effectivePreviewTransform(item, 20), {
    x: 20,
    y: 4,
    scale: 1.2,
    scaleX: 1.2,
    scaleY: 1.2,
    rotation: 180,
  });
}

// Hit testing must invert rotation, not test only the axis-aligned bounds.
{
  const item = visualItem('rotated', 'V1', {
    width: 1000,
    height: 500,
    transform: { rotation: 90 },
  });
  const state = stateOf({ width: 1000, height: 1000, items: [item] });
  assert.deepEqual(hitPreviewCandidates(state, 0, { x: 500, y: 50 }).map(({ item: hit }) => hit.id), ['rotated']);
  assert.deepEqual(hitPreviewCandidates(state, 0, { x: 50, y: 500 }), []);
}

// Repeated clicks within four UI pixels cycle through the unchanged hit stack.
{
  const candidates = [
    { item: visualItem('top', 'V2'), transform: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 }, localFrame: 0 },
    { item: visualItem('bottom', 'V1'), transform: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 }, localFrame: 0 },
  ];
  const first = cyclePreviewCandidate(null, { x: 100, y: 100 }, candidates, 4)!;
  assert.equal(first.id, 'top');
  const second = cyclePreviewCandidate(first.next, { x: 103, y: 102 }, candidates, 4)!;
  assert.equal(second.id, 'bottom');
  const third = cyclePreviewCandidate(second.next, { x: 103, y: 102 }, candidates, 4)!;
  assert.equal(third.id, 'top');
  const reset = cyclePreviewCandidate(third.next, { x: 110, y: 100 }, candidates, 4)!;
  assert.equal(reset.id, 'top', '\u8d85\u51fa\u5bb9\u5dee\u540e\u4ece\u6700\u4e0a\u5c42\u91cd\u65b0\u5f00\u59cb');
}

// Pointer-space movement maps to composition percentages independently per axis.
assert.deepEqual(
  movePreviewTransform(
    { x: 5, y: -5, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 },
    { x: 54, y: 96 },
    { width: 540, height: 960 },
  ),
  { x: 15, y: 5 },
);

{
  const { previewClientDelta, previewPointerFromClient } = previewTransformModule;
  const startClient = { x: 420, y: 510 };
  const identity = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 };
  const afterInspector = { left: 100, top: 200, width: 360, height: 640 };
  // Click empty canvas then the clip: inspector mounts (320px), canvas recenters
  // downward. Overlay-relative coords would see ~120px of fake Y motion.
  const staleUiDelta = {
    x: (startClient.x - afterInspector.left) - (startClient.x - 100),
    y: (startClient.y - afterInspector.top) - (startClient.y - 80),
  };
  assert.equal(staleUiDelta.y, -120);
  assert.deepEqual(
    movePreviewTransform(identity, staleUiDelta, { width: 360, height: 640 }),
    { x: 0, y: -18.75 },
    'cached overlay origin would jump the clip up when the inspector opens',
  );
  const liveDelta = previewClientDelta(startClient, startClient);
  assert.deepEqual(liveDelta, { x: 0, y: 0 });
  assert.deepEqual(
    movePreviewTransform(identity, liveDelta, { width: afterInspector.width, height: afterInspector.height }),
    { x: 0, y: 0 },
    'a stationary click must not write x/y when the canvas recenters',
  );
  const dragged = previewClientDelta(startClient, { x: 420, y: 558 });
  assert.deepEqual(
    movePreviewTransform(identity, dragged, { width: 480, height: 480 }),
    { x: 0, y: 10 },
  );
  const mapped = previewPointerFromClient(startClient, afterInspector, { width: 1080, height: 1920 });
  assert.equal(mapped.ui.x, 320);
  assert.equal(mapped.ui.y, 310);
}

// Uniform scale uses distance from center and respects the usable minimum.
assert.equal(scalePreviewTransform(1, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }), 2);
assert.equal(scalePreviewTransform(1, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }), 0.05);
assert.equal(scalePreviewTransform(9, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }), 10);

// Corner drag keeps both axes linked.
assert.deepEqual(
  uniformScaleAxesPreviewTransform({ scaleX: 1, scaleY: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }),
  { scale: 2, scaleX: 2, scaleY: 2 },
);
// Edge drag crops (covers) — drag right edge from full frame to x=960 on 1920 canvas → right half hidden.
{
  const identity = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 };
  const half = edgeCropPreviewTransform(
    { width: 1920, height: 1080 },
    identity,
    undefined,
    { x: 960, y: 540 },
    'e',
  );
  assert.ok(half.crop, '\u53f3\u8fb9\u5185\u6536\u5e94\u4ea7\u751f crop');
  assert.ok(Math.abs((half.crop?.right ?? 0) - 0.5) < 1e-6, '\u53f3\u534a\u88ab\u906e\u4f4f right≈0.5');
  assert.equal(half.crop?.left ?? 0, 0, '\u5de6\u8fb9 inset \u4e0d\u53d8');
  const leftIn = edgeCropPreviewTransform(
    { width: 1920, height: 1080 },
    identity,
    undefined,
    { x: 480, y: 540 },
    'w',
  );
  assert.ok(Math.abs((leftIn.crop?.left ?? 0) - 0.25) < 1e-6, '\u5de6\u8fb9\u5185\u6536 left≈0.25');
  assert.equal(leftIn.crop?.right ?? 0, 0, '\u53f3\u8fb9 inset \u4e0d\u53d8');
}

const pointAt = (degrees: number): PreviewPoint => {
  const radians = degrees * Math.PI / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
};

// Crossing the atan2 boundary should add two degrees, not jump by -358.
assert.ok(Math.abs(rotatePreviewTransform(10, { x: 0, y: 0 }, pointAt(179), pointAt(-179)) - 12) < 1e-9);

// Bare arrow keys nudge a selected visual clip in the same x/y transform model
// used by the preview drag handles and Inspector values.
const keyboardPreviewNudgePlan = (
  previewTransformModule as unknown as {
    keyboardPreviewNudgePlan?: (
      item: TimelineItem,
      absoluteFrame: number,
      direction: 'left' | 'right' | 'up' | 'down',
    ) => unknown;
  }
).keyboardPreviewNudgePlan;
assert.equal(typeof keyboardPreviewNudgePlan, 'function', '\u9884\u89c8\u53d8\u6362\u5c42\u5e94\u63d0\u4f9b\u65b9\u5411\u952e\u5fae\u79fb\u8ba1\u5212');
if (keyboardPreviewNudgePlan) {
  const item = visualItem('keyboard', 'V1', { transform: { x: 4, y: -2 } });
  assert.deepEqual(keyboardPreviewNudgePlan(item, 20, 'left'), {
    itemId: 'keyboard',
    transform: { x: 3 },
  });
  assert.deepEqual(keyboardPreviewNudgePlan(item, 20, 'down'), {
    itemId: 'keyboard',
    transform: { y: -1 },
  });

  const keyed = visualItem('keyboard-keyed', 'V1', {
    startFrame: 10,
    keyframes: { x: [{ frame: 0, value: 0 }, { frame: 20, value: 10 }] },
  });
  assert.deepEqual(keyboardPreviewNudgePlan(keyed, 20, 'right'), {
    itemId: 'keyboard-keyed',
    keyframe: { prop: 'x', localFrame: 10, value: 6 },
  });
  assert.equal(
    keyboardPreviewNudgePlan({ ...item, kind: 'audio' }, 20, 'right'),
    null,
    '\u7eaf\u97f3\u9891\u7247\u6bb5\u6ca1\u6709\u9884\u89c8\u753b\u9762\u4f4d\u7f6e，\u65b9\u5411\u952e\u5e94\u56de\u9000\u5230\u539f\u5feb\u6377\u952e',
  );
  assert.equal(
    keyboardPreviewNudgePlan(item, item.startFrame + item.durationInFrames, 'right'),
    null,
    '\u64ad\u653e\u5934\u79bb\u5f00\u7247\u6bb5\u540e，\u5373\u4f7f\u9884\u89c8\u5c42\u4ecd\u6709\u7126\u70b9\u4e5f\u5e94\u56de\u9000\u5230\u539f\u5feb\u6377\u952e',
  );
}

const editorActionsSource = readFileSync(new URL('../../shortcuts/useEditorActions.ts', import.meta.url), 'utf8');
assert.match(editorActionsSource, /keyboardPreviewNudgePlan/, '\u5168\u5c40\u65b9\u5411\u952e\u52a8\u4f5c\u5e94\u63a5\u5165\u9884\u89c8\u5fae\u79fb\u8ba1\u5212');
assert.match(
  editorActionsSource,
  /previewCanvasHasKeyboardFocus/,
  '\u53ea\u6709\u9884\u89c8\u753b\u5e03\u5904\u4e8e\u952e\u76d8\u64cd\u4f5c\u7126\u70b9\u65f6\u624d\u53ef\u8986\u76d6\u65b9\u5411\u952e\u539f\u6709\u529f\u80fd',
);
assert.match(editorActionsSource, /setItemTransform/, '\u666e\u901a\u7247\u6bb5\u65b9\u5411\u952e\u5fae\u79fb\u540e\u5e94\u5199\u56de Inspector \u5171\u7528 transform');
assert.match(editorActionsSource, /setItemKeyframe/, '\u5df2\u6709\u4f4d\u7f6e\u5173\u952e\u5e27\u65f6\u5e94\u5199\u56de\u5f53\u524d\u5e27\u5173\u952e\u5e27');
const overlaySource = readFileSync(new URL('./PreviewTransformOverlay.tsx', import.meta.url), 'utf8');
assert.match(overlaySource, /tabIndex=\{0\}/, '\u9884\u89c8\u53d8\u6362\u5c42\u5e94\u53ef\u83b7\u5f97\u952e\u76d8\u7126\u70b9');
assert.match(overlaySource, /event\.currentTarget\.focus\(/, '\u5728\u9884\u89c8\u91cc\u70b9\u9009\u7247\u6bb5\u65f6\u5e94\u6fc0\u6d3b\u65b9\u5411\u952e\u5fae\u79fb\u6a21\u5f0f');
assert.match(
  overlaySource,
  /previewClientDelta\(gesture\.startClient/,
  'move/scale/rotate must use viewport client delta, not a cached overlay origin',
);

console.log('previewTransform.verify: ok (\u5019\u9009/\u753b\u6846/\u5173\u952e\u5e27/\u547d\u4e2d/\u5faa\u73af/\u79fb\u52a8/\u7f29\u653e/\u65cb\u8f6c/\u65b9\u5411\u952e\u5fae\u79fb)');
