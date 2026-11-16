// :npx tsx src/editor/audio-transcript-guard.verify.ts
// ASR (): 3s  sting  "Music" 24.4s
// AudioClip ,,
// ,:
//   1)  →
//   2) , →
// ()
import assert from 'node:assert/strict';
import { keptSegments } from '../transcript/edit';
import type { TranscriptWord } from '../transcript/types';
import { audibleTranscriptSegments } from './audioTranscriptGuard';

const fps = 30;
const segmentsOf = (words: TranscriptWord[], deleted: number[] = []) => keptSegments(words, new Set(deleted), fps, 0, {});

//  1:3s(90 ) sting,ASR  "Music" 24.42–24.44s →
{
  const segs = segmentsOf([{ text: 'Music', start: 24420, end: 24440 }]);
  assert.ok(segs[0]!.srcStartFrame >= 90, 'keptSegments \u786e\u5b9e\u7ed9\u51fa\u4e86\u8d8a\u754c\u7a97\u53e3(\u524d\u63d0)');
  assert.equal(audibleTranscriptSegments(segs, { durationInFrames: 90, deletedWordCount: 0, sourceDurationInFrames: 90 }), null,
    '\u8d8a\u754c\u7a97\u53e3 → \u5e73\u94fa\u64ad\u653e');
}

//  2:1.8s(55 ) sting, →  15 ,
{
  const segs = segmentsOf([{ text: 'Uh', start: 500, end: 1000 }]);
  assert.equal(audibleTranscriptSegments(segs, { durationInFrames: 55, deletedWordCount: 0, sourceDurationInFrames: 55 }), null,
    '\u672a\u7f16\u8f91\u5374\u541e\u6389\u5927\u534a → \u5e73\u94fa\u64ad\u653e');
}

const speech: TranscriptWord[] = [
  { text: 'one', start: 0, end: 900 },
  { text: 'two', start: 1000, end: 1900 },
  { text: 'three', start: 2000, end: 2900 },
  { text: 'four', start: 3000, end: 3900 },
];

// : →
{
  const segs = segmentsOf(speech);
  assert.deepEqual(audibleTranscriptSegments(segs, { durationInFrames: 118, deletedWordCount: 0, sourceDurationInFrames: 120 }), segs,
    '\u8986\u76d6\u5b8c\u6574 → \u5c0a\u91cd\u8f6c\u5199');
}

// :, →
{
  const segs = segmentsOf(speech, [1, 2, 3]);
  assert.deepEqual(audibleTranscriptSegments(segs, { durationInFrames: 118, deletedWordCount: 3, sourceDurationInFrames: 120 }), segs,
    '\u6709\u5220\u9664 → \u5c0a\u91cd\u8f6c\u5199');
}

// ()
{
  const segs = segmentsOf(speech);
  assert.deepEqual(audibleTranscriptSegments(segs, { durationInFrames: 118, deletedWordCount: 0 }), segs, '\u957f\u5ea6\u672a\u77e5 → \u4e0d\u8bef\u4f24');
}

// :,
{
  const segs = [
    { srcStartFrame: 0, srcEndFrame: 60, fromFrame: 0, durFrames: 60 },
    { srcStartFrame: 733, srcEndFrame: 734, fromFrame: 60, durFrames: 1 },
  ];
  assert.deepEqual(audibleTranscriptSegments(segs, { durationInFrames: 61, deletedWordCount: 0, sourceDurationInFrames: 90 }), [segs[0]],
    '\u53ea\u4e22\u8d8a\u754c\u7a97\u53e3');
}

console.log('audio-transcript-guard.verify: ok (\u8d8a\u754c\u4e22\u5f03/\u541e\u7247\u5e73\u94fa/\u5220\u9664\u8bcd\u7167\u5e38/\u957f\u5ea6\u672a\u77e5\u4e0d\u8bef\u4f24/\u90e8\u5206\u8d8a\u754c)');
