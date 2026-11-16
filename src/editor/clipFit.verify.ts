// Runnable check: `npx tsx src/editor/clipFit.verify.ts`.
// Verify the self-healing of duration-derived data: fading on both sides does not overlap, the side that was changed when setFade gives way, and key frames are truncated
// Keep "the still rendered frame sample value is completely unchanged" and confirm with true reduce retime/setSpeed/split
// No out-of-bounds fades or keyframes will be left after changing the duration.
import assert from 'node:assert/strict';
import { capFade, fitItemToDuration, fitKeyframes, truncateKeyframes } from './clipFit';
import { sampleKeyframes } from './keyframes';
import { reduce } from './reduce';
import { migrateProjectDoc } from '../persist/projectStore';
import type { Keyframe, TimelineItem, TimelineState } from './types';

const item = (patch: Partial<TimelineItem> = {}): TimelineItem => ({
  id: 'a', track: 'V1', startFrame: 0, durationInFrames: 100,
  kind: 'video', name: 'a', src: '/m/a.mp4', ...patch,
} as TimelineItem);

const stateOf = (items: TimelineItem[]): TimelineState => ({
  fps: 30, width: 1920, height: 1080, selectedId: null,
  tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'], items,
});

// ── capFade: Negative numbers are returned to zero, room is given away, undefined remains unset ──
{
  assert.equal(capFade(undefined, 100), undefined, '\u6ca1\u8bbe\u8fc7\u5c31\u4fdd\u6301\u6ca1\u8bbe');
  assert.equal(capFade(-5, 100), 0);
  assert.equal(capFade(90, 100), 90);
  assert.equal(capFade(90, 10), 10, '\u53ea\u80fd\u5403\u6389\u5bf9\u4fa7\u8ba9\u51fa\u6765\u7684\u7a7a\u95f4');
  assert.equal(capFade(90, -20), 0, 'room \u4e3a\u8d1f\u65f6\u5f52\u96f6');
}

// ── Core flaw: The sum of the fades on both sides cannot exceed the length of the clip ──
{
  const broken = fitItemToDuration(item({ durationInFrames: 100, fadeInFrames: 90, fadeOutFrames: 90 }));
  assert.equal(broken.fadeInFrames, 90);
  assert.equal(broken.fadeOutFrames, 10, '\u6de1\u51fa\u8ba9\u4f4d,\u5408\u8ba1\u6b63\u597d\u7b49\u4e8e\u65f6\u957f');
  assert.ok((broken.fadeInFrames ?? 0) + (broken.fadeOutFrames ?? 0) <= 100);

  const legal = item({ fadeInFrames: 10, fadeOutFrames: 10 });
  assert.equal(fitItemToDuration(legal), legal, '\u672c\u6765\u5c31\u5408\u6cd5\u65f6\u8fd4\u56de\u539f\u5bf9\u8c61(\u4e0d\u89e6\u53d1\u591a\u4f59\u91cd\u6e32\u67d3)');
}

// ── Keyframe truncation: Each frame that is still rendered must have the same sample value ──
{
  const kfs: Keyframe[] = [
    { frame: 0, value: 0, easing: 'easeInOut' },
    { frame: 40, value: 100, easing: [0.2, 0.9, 0.4, 1] },
    { frame: 90, value: 20 },
  ];
  const last = 49; // Reduce duration to 50
  const cut = truncateKeyframes(kfs, last);
  assert.ok(cut[cut.length - 1]!.frame <= last, '\u6ca1\u6709\u5173\u952e\u5e27\u843d\u5728\u6700\u540e\u4e00\u5e27\u4e4b\u540e');
  for (let f = 0; f <= last; f += 1) {
    assert.ok(
      Math.abs(sampleKeyframes(cut, f) - sampleKeyframes(kfs, f)) < 1e-6,
      `\u7b2c ${f} \u5e27\u91c7\u6837\u503c\u5fc5\u987b\u4e0d\u53d8(\u76f4\u63a5\u4e22\u5c3e\u5df4\u4f1a\u8ba9\u66f2\u7ebf\u63d0\u524d\u505c\u4f4f)`,
    );
  }
  assert.equal(truncateKeyframes(kfs, 200), kfs, '\u5df2\u7ecf\u5728\u8303\u56f4\u5185\u65f6\u539f\u6837\u8fd4\u56de');

  const ik = { opacity: kfs, scale: [{ frame: 0, value: 1 }] as Keyframe[] };
  assert.equal(fitKeyframes(ik, 200), ik, '\u5168\u90e8\u5728\u8303\u56f4\u5185\u5219\u6574\u4e2a\u5bf9\u8c61\u539f\u6837\u8fd4\u56de');
  const trimmed = fitKeyframes(ik, last)!;
  assert.notEqual(trimmed, ik);
  assert.deepEqual(trimmed.scale, ik.scale, '\u6ca1\u8d8a\u754c\u7684\u5c5e\u6027\u4e0d\u52a8');
  assert.equal(fitKeyframes(undefined, 10), undefined);

  // Extreme case of 1 frame duration: leaving a 0-frame keyframe, neither exploding nor clearing
  assert.deepEqual(truncateKeyframes(kfs, 0).map((k) => k.frame), [0]);
}

// ── After using reduce:retime to shorten the clip, the fade and keyframes are pressed back together ──
{
  const before = stateOf([item({
    durationInFrames: 100, fadeInFrames: 30, fadeOutFrames: 60,
    keyframes: { opacity: [{ frame: 0, value: 0 }, { frame: 95, value: 1 }] },
  })]);
  const after = reduce(before, { type: 'retime', id: 'a', durationInFrames: 20 });
  const it = after.items[0]!;
  assert.equal(it.durationInFrames, 20);
  assert.ok((it.fadeInFrames ?? 0) + (it.fadeOutFrames ?? 0) <= 20, `\u7f29\u77ed\u540e\u6de1\u5316\u4ecd\u8d8a\u754c: ${it.fadeInFrames}+${it.fadeOutFrames}`);
  assert.ok((it.keyframes?.opacity ?? []).every((k) => k.frame <= 19), '\u6ca1\u6709\u6e32\u67d3\u4e0d\u5230\u7684\u5173\u952e\u5e27');
}

// ── It is true that reduce:setSpeed ​​also heals itself after acceleration ──
{
  const before = stateOf([item({ durationInFrames: 100, fadeInFrames: 40, fadeOutFrames: 40 })]);
  const it = reduce(before, { type: 'setSpeed', id: 'a', rate: 4 }).items[0]!;
  assert.equal(it.durationInFrames, 25);
  assert.ok((it.fadeInFrames ?? 0) + (it.fadeOutFrames ?? 0) <= 25, '4 \u500d\u901f\u540e 40+40 \u5e27\u6de1\u5316\u5fc5\u987b\u6536\u56de\u6765');
}

// ── The outer fade of the last two halves of Jingzhen reduce:split cannot exceed their respective lengths ──
{
  const before = stateOf([item({ durationInFrames: 100, fadeInFrames: 80, fadeOutFrames: 80 })]);
  const halves = reduce(before, { type: 'split', id: 'a', atFrame: 30, newId: 'b' }).items;
  assert.equal(halves.length, 2);
  for (const half of halves) {
    assert.ok(
      (half.fadeInFrames ?? 0) + (half.fadeOutFrames ?? 0) <= half.durationInFrames,
      `${half.id} \u7684\u6de1\u5316\u8d85\u8fc7\u4e86\u5b83\u81ea\u5df1\u7684 ${half.durationInFrames} \u5e27`,
    );
  }
}

// ── setFade: The side that has been explicitly changed gives way, and the side that has not been moved remains unchanged ──
{
  const before = stateOf([item({ durationInFrames: 100, fadeInFrames: 0, fadeOutFrames: 90 })]);
  const it = reduce(before, { type: 'setFade', id: 'a', fadeInFrames: 90 }).items[0]!;
  assert.equal(it.fadeOutFrames, 90, '\u53ea\u8c03\u6de1\u5165\u4e0d\u8be5\u628a\u7528\u6237\u539f\u6709\u7684\u6de1\u51fa\u780d\u77ed');
  assert.equal(it.fadeInFrames, 10, '\u88ab\u6539\u7684\u4e00\u4fa7\u5403\u5269\u4e0b\u7684\u7a7a\u95f4');

  const both = reduce(before, { type: 'setFade', id: 'a', fadeInFrames: 70, fadeOutFrames: 70 }).items[0]!;
  assert.deepEqual([both.fadeInFrames, both.fadeOutFrames], [70, 30], '\u4e24\u4fa7\u540c\u65f6\u7ed9\u51fa\u65f6\u6de1\u5165\u4f18\u5148');
}

// ── Self-healing is also required when loading the project: reduce is only reached when there is an action, and illegal values ​​cannot wait for the user to move first ──
{
  const legacy = {
    version: 3, assets: [], mediaFolders: [], activeTimelineId: 'tl1',
    timelines: [{
      id: 'tl1', name: 'main', order: 0, fps: 30, width: 1920, height: 1080, selectedId: null,
      tracks: { V1: { kind: 'video' as const } }, trackOrder: ['V1'],
      items: [item({ durationInFrames: 100, fadeInFrames: 90, fadeOutFrames: 90 })],
    }],
  };
  const healed = migrateProjectDoc(legacy);
  assert.ok(healed, '\u5408\u6cd5\u5de5\u7a0b\u4ecd\u80fd\u901a\u8fc7\u8fc1\u79fb');
  const it = healed!.timelines[0]!.items[0]!;
  assert.ok(
    (it.fadeInFrames ?? 0) + (it.fadeOutFrames ?? 0) <= 100,
    `\u52a0\u8f7d\u540e\u4ecd\u8d8a\u754c: ${it.fadeInFrames}+${it.fadeOutFrames}(\u6574\u6bb5\u4f1a\u4e00\u76f4\u662f\u6697\u7684)`,
  );
}

console.log('clipFit.verify: ok (\u6de1\u5316\u8054\u5408\u94b3\u4f4d/\u88ab\u6539\u4fa7\u8ba9\u4f4d/\u5173\u952e\u5e27\u622a\u65ad\u91c7\u6837\u4e0d\u53d8/\u771f reduce retime·setSpeed·split/\u52a0\u8f7d\u81ea\u6108)');
