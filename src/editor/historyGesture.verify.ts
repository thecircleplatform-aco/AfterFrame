// Runnable check: `npx tsx src/editor/historyGesture.verify.ts`.
// Continuous gestures (drag the slider, drag the color picker) must leave only one undo record: the undo must go back to "before dragging" instead of
// Previous tick. Without it, volume 0→2 will push in about 40 snapshots in 0.05 steps, and the upper limit is only 100
//  — Drag twice and the user’s real editing history is squeezed out.
import assert from 'node:assert/strict';
import { historyReduce, type History } from './reduce';
import type { ProjectDoc, TimelineItem } from './types';

const item = (volume: number): TimelineItem => ({
  id: 'a', track: 'A1', startFrame: 0, durationInFrames: 60,
  kind: 'audio', name: 'a', src: '/m/a.wav', volume,
} as TimelineItem);

const docOf = (volume: number): ProjectDoc => ({
  version: 3, assets: [], mediaFolders: [], activeTimelineId: 'tl1',
  timelines: [{
    id: 'tl1', name: 'main', order: 0, fps: 30, width: 1920, height: 1080, selectedId: null,
    tracks: { A1: { kind: 'audio' } }, trackOrder: ['A1'], items: [item(volume)],
  }],
} as unknown as ProjectDoc);

const start = (): History => ({ past: [], present: docOf(1), future: [] });
const volumeOf = (h: History) => h.present.timelines[0]!.items[0]!.volume;
const setVolume = (h: History, volume: number) => historyReduce(h, { type: 'setVolume', id: 'a', volume });

// ── Disable gestures: each step is a history (original behavior, single keyboard adjustment is still the same) ──
{
  let h = start();
  for (const v of [1.1, 1.2, 1.3]) h = setVolume(h, v);
  assert.equal(h.past.length, 3, '\u6ca1\u6709\u624b\u52bf\u8fb9\u754c\u65f6\u9010\u6b65\u8bb0\u5f55');
}

// ── Gestures enabled: Only one of the 40 steps is left, and the undo returns to before dragging ──
{
  let h = start();
  h = historyReduce(h, { type: 'history.beginGesture' });
  assert.equal(h.past.length, 0, '\u5f00\u59cb\u624b\u52bf\u672c\u8eab\u4e0d\u52a8\u5386\u53f2');
  for (let i = 1; i <= 40; i += 1) h = setVolume(h, Math.round((1 + i * 0.025) * 1000) / 1000);
  h = historyReduce(h, { type: 'history.endGesture' });

  assert.equal(h.past.length, 1, `40 \u6b65\u53ea\u8be5\u7559 1 \u6761\u5386\u53f2,\u5b9e\u5f97 ${h.past.length}`);
  assert.equal(volumeOf(h), 2, '\u5f53\u524d\u503c\u662f\u62d6\u5230\u7684\u6700\u7ec8\u503c');
  const undone = historyReduce(h, { type: 'undo' });
  assert.equal(volumeOf(undone), 1, '\u64a4\u9500\u56de\u5230\u62d6\u4e4b\u524d,\u800c\u4e0d\u662f\u4e0a\u4e00\u4e2a\u523b\u5ea6');
  assert.equal(undone.past.length, 0);
}

// ── Two independent gestures = two histories, will not be merged across gestures ──
{
  let h = start();
  for (const [a, b] of [[1.5, 1.8], [0.5, 0.2]] as const) {
    h = historyReduce(h, { type: 'history.beginGesture' });
    h = setVolume(h, a);
    h = setVolume(h, b);
    h = historyReduce(h, { type: 'history.endGesture' });
  }
  assert.equal(h.past.length, 2, '\u6bcf\u6b21\u624b\u52bf\u5404\u7559\u4e00\u6761');
  assert.equal(volumeOf(h), 0.2);
  assert.equal(volumeOf(historyReduce(h, { type: 'undo' })), 1.8, '\u64a4\u9500\u56de\u5230\u7b2c\u4e8c\u6b21\u624b\u52bf\u4e4b\u524d');
}

// ── The gesture did not change during the process: an extra piece of history should not be created out of thin air──
{
  let h = start();
  h = historyReduce(h, { type: 'history.beginGesture' });
  h = historyReduce(h, { type: 'history.endGesture' });
  assert.equal(h.past.length, 0);
  assert.equal(h.gesture, undefined, '\u7ed3\u675f\u540e\u624b\u52bf\u72b6\u6001\u6e05\u5e72\u51c0');
}

// ── The redo branch will still be cleared during the gesture (the same as normal editing) ──
{
  let h = start();
  h = setVolume(h, 1.5);
  h = historyReduce(h, { type: 'undo' });
  assert.equal(h.future.length, 1, '\u6709\u53ef\u91cd\u505a\u7684\u5206\u652f');
  h = historyReduce(h, { type: 'history.beginGesture' });
  h = setVolume(h, 0.8);
  h = setVolume(h, 0.6);
  assert.equal(h.future.length, 0, '\u65b0\u7f16\u8f91\u6e05\u7a7a\u91cd\u505a\u5206\u652f');
  assert.equal(h.past.length, 1);
}

// ── undo/redo will turn off the gesture state to prevent the state from getting stuck after undoing the drag ──
{
  let h = start();
  h = historyReduce(h, { type: 'history.beginGesture' });
  h = setVolume(h, 1.4);
  assert.equal(h.gesture, 'pushed');
  h = historyReduce(h, { type: 'undo' });
  assert.equal(h.gesture, undefined, '\u64a4\u9500\u540e\u624b\u52bf\u72b6\u6001\u6e05\u6389');
  h = setVolume(h, 1.9);
  assert.equal(h.past.length, 1, '\u4e4b\u540e\u7684\u7f16\u8f91\u7167\u5e38\u8bb0\u5f55');
}

// ── Repeating begin will not repeat the open gesture──
{
  let h = start();
  h = historyReduce(h, { type: 'history.beginGesture' });
  h = setVolume(h, 1.2);
  h = historyReduce(h, { type: 'history.beginGesture' });
  h = setVolume(h, 1.4);
  assert.equal(h.past.length, 1, '\u4ecd\u7136\u53ea\u6709\u4e00\u6761');
}

console.log('historyGesture.verify: ok (\u9010\u6b65/40 \u6b65\u5408\u4e00/\u8de8\u624b\u52bf\u4e0d\u5408\u5e76/\u7a7a\u624b\u52bf/\u6e05 redo/undo \u6536\u5c3e/\u91cd\u590d begin)');
