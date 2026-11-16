// Runnable check: `npx tsx src/editor/keyframes.verify.ts`.
// Verification: volume keyframe channel - volumeAtFrame fallback/override/interpolation/out-of-bounds clamping; split carry
// The volume channel and the sampling on both sides of the cut point are consistent; the registry supports dispatching by kind; the reducer is
// setKeyframe accepts audio volume and rejects picture volume; tool layer per-prop verification.
import assert from 'node:assert/strict';
import { sampleKeyframes, splitItemKeyframes, volumeAtFrame } from './keyframes';
import {
  KEYFRAME_PROPS, coerceKeyframeValue, getKeyframePropertyDefinition, supportsKeyframeProperty,
} from './keyframeRegistry';
import { reduce } from './reduce';
import type { TimelineItem, TimelineState } from './types';

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;
const item = (patch: Partial<TimelineItem>): TimelineItem => ({
  id: 'a1', track: 'a-audio-1', startFrame: 0, durationInFrames: 120, kind: 'audio', name: 'a', ...patch,
} as TimelineItem);

// ── volumeAtFrame: no keyframe to fall back to static volume; with keyframe to overwrite the static value and interpolate by frame ──
assert.equal(volumeAtFrame({}, 10), 1, '\u65e0 volume \u5b57\u6bb5\u9ed8\u8ba4 1');
assert.equal(volumeAtFrame({ volume: 0.4 }, 10), 0.4, '\u65e0\u5173\u952e\u5e27\u56de\u9000 item.volume');
const ducked = { volume: 0.3, keyframes: { volume: [{ frame: 0, value: 1 }, { frame: 10, value: 0.2 }] } };
assert.equal(volumeAtFrame(ducked, 0), 1, '\u5173\u952e\u5e27\u8986\u76d6\u9759\u6001\u97f3\u91cf');
assert.ok(near(volumeAtFrame(ducked, 5), 0.6), '\u7ebf\u6027\u63d2\u503c\u4e2d\u70b9');
assert.equal(volumeAtFrame(ducked, 999), 0.2, '\u8d8a\u8fc7\u672b\u5e27\u4fdd\u6301\u672b\u503c');
assert.equal(volumeAtFrame(ducked, -5), 1, '\u9996\u5e27\u4e4b\u524d\u4fdd\u6301\u9996\u503c');

// ── Clamp: overshoot Bezier can sample >2 between inbound keyframes, and must be clamped back to 0..2 ──
const shoot = { keyframes: { volume: [{ frame: 0, value: 0, easing: [0.3, 3, 0.7, 3] as [number, number, number, number] }, { frame: 10, value: 2 }] } };
const rawMid = sampleKeyframes(shoot.keyframes.volume, 5);
assert.ok(rawMid > 2, `\u6784\u9020\u7684 overshoot \u4e2d\u70b9\u5e94 >2(\u5b9e\u9645 ${rawMid.toFixed(3)})`);
assert.equal(volumeAtFrame(shoot, 5), 2, 'overshoot \u94b3\u5230 2');

// ── split:volume The channel is split with cutting, and the sampling on both sides of the cutting point is consistent with that before cutting frame by frame ──
const kfs = { volume: [{ frame: 0, value: 1 }, { frame: 40, value: 0.2 }, { frame: 100, value: 1.6 }] };
const [l, r] = splitItemKeyframes(kfs, 30);
assert.ok(l?.volume?.length && r?.volume?.length, 'split \u4e24\u4fa7\u90fd\u6709 volume \u901a\u9053');
for (let f = 0; f < 120; f++) {
  const orig = sampleKeyframes(kfs.volume, f);
  const post = f < 30 ? sampleKeyframes(l!.volume!, f) : sampleKeyframes(r!.volume!, f - 30);
  assert.ok(near(orig, post, 1e-9), `\u5e27 ${f} \u5207\u524d\u540e\u91c7\u6837\u4e00\u81f4`);
}

// ── Registry: volume in KEYFRAME_PROPS; audio/video supported, image not supported; coerce clamp 0..2 ──
assert.ok(KEYFRAME_PROPS.includes('volume'), 'KEYFRAME_PROPS \u542b volume');
const def = getKeyframePropertyDefinition('volume');
assert.deepEqual([...def.valueRange], [0, 2], 'volume valueRange 0..2');
assert.equal(def.getBaseValue(item({ volume: 0.7 })), 0.7, 'getBaseValue \u8bfb item.volume');
assert.ok(supportsKeyframeProperty(item({ kind: 'audio' }), 'volume'), 'audio \u652f\u6301 volume');
assert.ok(supportsKeyframeProperty(item({ kind: 'video' }), 'volume'), 'video \u652f\u6301 volume');
assert.ok(!supportsKeyframeProperty(item({ kind: 'image' }), 'volume'), 'image \u4e0d\u652f\u6301 volume');
assert.ok(!supportsKeyframeProperty(item({ kind: 'audio' }), 'opacity'), 'audio \u4ecd\u4e0d\u652f\u6301 opacity');
const opacityDef = getKeyframePropertyDefinition('opacity');
assert.equal(opacityDef.getBaseValue(item({ kind: 'image', transform: { opacity: 0.45 } })), 0.45, 'opacity \u8bfb\u53d6\u9759\u6001 transform');
assert.deepEqual(opacityDef.toTransformPatch?.(0.6), { opacity: 0.6 }, 'opacity \u53ef\u5199\u56de\u9759\u6001 transform');
const radiusDef = getKeyframePropertyDefinition('borderRadius');
assert.ok(KEYFRAME_PROPS.includes('borderRadius'), 'KEYFRAME_PROPS \u542b borderRadius');
assert.ok(supportsKeyframeProperty(item({ kind: 'image' }), 'borderRadius'), '\u56fe\u7247\u652f\u6301\u5706\u89d2');
assert.ok(!supportsKeyframeProperty(item({ kind: 'text' }), 'borderRadius'), '\u6587\u5b57\u4e0d\u5f00\u653e\u5706\u89d2');
assert.deepEqual(radiusDef.toTransformPatch?.(24), { borderRadius: 24 }, '\u5706\u89d2\u53ef\u5199\u56de\u9759\u6001 transform');
assert.equal(coerceKeyframeValue('borderRadius', 1200), 1000, '\u5706\u89d2\u5173\u952e\u5e27\u6309\u8303\u56f4\u94b3\u5236');
assert.equal(coerceKeyframeValue('volume', 9), 2, 'coerce \u4e0a\u94b3 2');
assert.equal(coerceKeyframeValue('volume', -1), 0, 'coerce \u4e0b\u94b3 0');

// ── reducer:setKeyframe accepts audio+volume; rejects image+volume(state as is) ──
const base: TimelineState = {
  fps: 30, width: 1920, height: 1080, selectedId: null,
  tracks: { 'a-audio-1': { kind: 'audio' }, 'a-video-1': { kind: 'video' } },
  trackOrder: ['a-video-1', 'a-audio-1'],
  items: [item({ kind: 'audio' }), item({ id: 'i1', kind: 'image', track: 'a-video-1' })],
};
const s1 = reduce(base, { type: 'setKeyframe', id: 'a1', prop: 'volume', frame: 12, value: 0.5 });
assert.deepEqual(s1.items[0].keyframes?.volume, [{ frame: 12, value: 0.5 }], 'reducer \u5199\u5165\u97f3\u9891 volume \u5173\u952e\u5e27');
const s2 = reduce(base, { type: 'setKeyframe', id: 'i1', prop: 'volume', frame: 12, value: 0.5 });
assert.equal(s2, base, 'image \u4e0a\u7684 volume \u5173\u952e\u5e27\u88ab\u62d2(state \u4e0d\u53d8)');
const s3 = reduce(s1, { type: 'setKeyframe', id: 'a1', prop: 'volume', frame: 20, value: 7 });
assert.deepEqual(s3.items[0].keyframes?.volume?.map((k) => k.value), [0.5, 2], 'reducer \u5199\u5165\u65f6\u6309 valueRange \u94b3\u5236');

// ── Tool layer: edit_item verification per-prop support and scope ──
const { validateGenericUpdate } = await import('../agent/tools/edit-item-generic');
const okAudio = validateGenericUpdate(base, { type: 'update', itemId: 'a1', keyframes: { volume: [{ frame: 0, value: 1.5 }] } });
assert.ok(!('error' in okAudio && okAudio.error), 'audio+volume \u5173\u952e\u5e27\u901a\u8fc7\u6821\u9a8c');
const badImage = validateGenericUpdate(base, { type: 'update', itemId: 'i1', keyframes: { volume: [{ frame: 0, value: 1 }] } }) as { error?: string };
assert.match(badImage.error ?? '', /not supported on a image/, 'image+volume \u88ab\u62d2\u5e76\u62a5 kind');
const badAudioOpacity = validateGenericUpdate(base, { type: 'update', itemId: 'a1', keyframes: { opacity: [{ frame: 0, value: 0.5 }] } }) as { error?: string };
assert.match(badAudioOpacity.error ?? '', /not supported on a audio/, 'audio+opacity \u88ab\u62d2');
const badRange = validateGenericUpdate(base, { type: 'update', itemId: 'a1', keyframes: { volume: [{ frame: 0, value: 3 }] } }) as { error?: string };
assert.match(badRange.error ?? '', /0\.\.2/, 'volume>2 \u88ab\u8303\u56f4\u6821\u9a8c\u62d2\u7edd');

console.log('keyframes.verify: all assertions passed');
