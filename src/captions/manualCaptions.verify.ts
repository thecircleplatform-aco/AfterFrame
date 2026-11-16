import assert from 'node:assert/strict';
import { captionPages, captionsToSrt } from './exportCaptions';
import { buildLaneGroups } from './lanes';
import {
  appendDroppedManualCaption, appendManualCue, appendManualCueToFirstLane, appendManualLane, isManualCaptionEntry,
  newManualCaptions, placeManualCueTiming, removeManualCue, resizeManualCue, updateManualCue,
} from './manualCaptions';

let captions = newManualCaptions();
const laneId = captions.sourceEntries![0]!.id;
assert.equal(captions.sourceEntries!.filter(isManualCaptionEntry).length, 1);

const added = appendManualCue(captions, laneId, '\u7b2c\u4e00\u53e5', 1_000, 2_000);
assert.ok(added?.sourceEntries);
captions = { ...captions, ...added };
assert.equal(buildLaneGroups(captions, [], 30, 1_500, 6)?.[0]?.lanes[0]?.page.words[0]?.text, '\u7b2c\u4e00\u53e5');
assert.deepEqual(buildLaneGroups(captions, [], 30, 2_500, 6), [], 'manual cue ends exactly at endMs');
const originalCueId = captions.sourceEntries![0]!.words![0]!.id;

const updated = updateManualCue(captions, laneId, 0, '\u6539\u8fc7\u7684\u5b57\u5e55', 1_200, 2_400);
assert.ok(updated?.sourceEntries);
captions = { ...captions, ...updated };
assert.equal(captions.sourceEntries![0]!.words![0]!.id, originalCueId, 'manual text/timing updates preserve cue identity');
assert.equal(captionPages(captions, [], 30)[0]?.words[0]?.text, '\u6539\u8fc7\u7684\u5b57\u5e55');
assert.match(captionsToSrt(captions, [], 30), /00:00:01,200 --> 00:00:02,400\n\u6539\u8fc7\u7684\u5b57\u5e55/);

captions = { ...captions, ...appendManualCue(captions, laneId, '\u4e0b\u4e00\u53e5', 3_000, 4_000) };
captions = { ...captions, ...resizeManualCue(captions, laneId, 0, 'start', -500) };
assert.equal(captions.sourceEntries![0]!.words![0]!.start, 700, 'left edge extends earlier');
captions = { ...captions, ...resizeManualCue(captions, laneId, 0, 'end', 2_000) };
assert.equal(captions.sourceEntries![0]!.words![0]!.end, 3_000, 'right edge stops at the next cue');

const secondLane = appendManualLane(captions, []);
captions = { ...captions, ...secondLane };
assert.equal(captions.sourceEntries!.filter(isManualCaptionEntry).length, 2, 'multiple manual lanes persist');

let destination = newManualCaptions();
destination = { ...destination, ...appendManualCueToFirstLane(destination, [], '\u8de8\u8f68\u5b57\u5e55', 1_000, 3_000) };
destination = { ...destination, ...appendManualCueToFirstLane(destination, [], '\u5141\u8bb8\u91cd\u53e0', 2_000, 4_000) };
assert.deepEqual(destination.sourceEntries![0]!.words?.map((word) => word.text), ['\u8de8\u8f68\u5b57\u5e55', '\u5141\u8bb8\u91cd\u53e0']);

const dropped = appendDroppedManualCaption(captions, [], 'tiktok', '\u62d6\u5165\u5b57\u5e55', 5_000, {
  anchor: 'middle-center', offsetXRatio: 0.2, offsetYRatio: -0.15,
});
assert.ok(dropped);
captions = { ...captions, ...dropped.patch };
const droppedEntry = captions.sourceEntries!.find((entry) => entry.id === dropped.laneId)!;
assert.equal(droppedEntry.words?.[0]?.text, '\u62d6\u5165\u5b57\u5e55');
assert.equal(droppedEntry.offsetXRatio, 0.2);
assert.equal(droppedEntry.style?.highlightBackground, '#FF2E63');

captions = { ...captions, ...removeManualCue(captions, laneId, 0) };
captions = { ...captions, ...removeManualCue(captions, laneId, 0) };
assert.equal(captions.sourceEntries!.find((entry) => entry.id === laneId)?.words?.length, 0);

//  —  placeManualCueTiming: non-overlapping clamping of dragging and placing (shared with same-track/cross-track drag and drop)  —
const occupied = [{ text: 'a', start: 0, end: 1_000 }, { text: 'c', start: 1_200, end: 2_000 }];
assert.equal(placeManualCueTiming(occupied, 1_050, 1_000), null, '1000ms cue \u62d6\u8fdb 200ms \u95f4\u9699 → \u62d2\u7edd(\u8c03\u7528\u65b9\u56de\u5f39)');
assert.deepEqual(placeManualCueTiming(occupied, 1_050, 150), { start: 1_050, end: 1_200 }, '\u585e\u5f97\u4e0b\u6309\u8bf7\u6c42\u4f4d\u653e,\u53f3\u4fa7\u88ab\u90bb\u5c45\u9876\u4f4f');
assert.deepEqual(placeManualCueTiming(occupied, 950, 200), { start: 1_000, end: 1_200 }, '\u538b\u5230\u524d\u90bb\u5c45\u5c3e\u90e8 → \u8d34\u8fb9\u6070\u597d\u586b\u6ee1\u95f4\u9699');
assert.deepEqual(placeManualCueTiming(occupied, 5_000, 700), { start: 5_000, end: 5_700 }, '\u53ef\u8d8a\u8fc7\u90bb\u5c45\u8df3\u5230\u8fdc\u5904\u5f00\u9614\u533a');
assert.deepEqual(placeManualCueTiming([], -500, 800), { start: 0, end: 800 }, '\u7a7a lane:\u8d1f\u843d\u70b9\u94b3\u5230 0,\u65f6\u957f\u4fdd\u6301');

console.log('manualCaptions.check: ok');
