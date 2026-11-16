import assert from 'node:assert/strict';
import type { TimelineState } from '../../editor/types';
import { closeCaptionTrackGaps, trackClearPlan, trackContextMenuLabels } from './trackContextOperations';

assert.deepEqual(trackContextMenuLabels('video').slice(0, 2), ['\u63d2\u5165\u7d20\u6750', '\u95ed\u5408\u7f1d\u9699']);
assert.ok(trackContextMenuLabels('audio').includes('\u81ea\u52a8\u95ea\u907f'));
assert.ok(trackContextMenuLabels('caption').includes('\u5b57\u5e55\u6837\u5f0f'));
assert.ok(!trackContextMenuLabels('caption').includes('\u9759\u97f3\u8f68\u9053'));

const state: TimelineState = {
  fps: 30, width: 1080, height: 1920, items: [], selectedId: null,
  trackOrder: ['C1'], tracks: { C1: { kind: 'caption', captions: {
    enabled: true, template: 'plain', pacing: 'phrase', sourceEntries: [{
      id: 'lane-1', itemId: 'manual:lane-1', words: [
        { text: '\u4e00', start: 1_000, end: 2_000 },
        { text: '\u4e8c', start: 4_000, end: 5_500 },
        { text: '\u4e09', start: 5_200, end: 6_000 },
      ],
    }],
  } } },
};
const captions = state.tracks!.C1!.captions!;
const tightened = closeCaptionTrackGaps(captions);
assert.equal(tightened.changed, true);
assert.deepEqual(tightened.captions.sourceEntries?.[0]?.words?.map(({ start, end }) => [start, end]), [
  [1_000, 2_000], [2_000, 3_500], [5_200, 6_000],
]);
assert.equal(trackClearPlan(state, 'C1').hasContents, true);
assert.deepEqual(trackClearPlan(state, 'C1').actions, [{ type: 'setCaptions', captions: null, track: 'C1' }]);

console.log('track context operations verify passed');
