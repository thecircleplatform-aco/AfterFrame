import assert from 'node:assert/strict';
import { classifyExternalFile, parseDroppedCaptions } from './externalFileDrop';

assert.deepEqual(classifyExternalFile({ name: '\u65c5\u884c.mp4', type: 'video/mp4' }), {
  type: 'media', mediaKind: 'video',
});
assert.deepEqual(classifyExternalFile({ name: '\u65c1\u767d.mp3', type: 'audio/mpeg' }), {
  type: 'media', mediaKind: 'audio',
});
assert.deepEqual(classifyExternalFile({ name: '\u5b57\u5e55.srt', type: '' }), {
  type: 'caption', format: 'srt',
});
assert.deepEqual(
  parseDroppedCaptions(
    '\u5b57\u5e55.srt',
    '1\n00:00:01,000 --> 00:00:02,500\n\u7b2c\u4e00\u53e5\n\n2\n00:00:03,000 --> 00:00:04,000\n\u7b2c\u4e8c\u53e5',
    10000,
  ),
  [
    { text: '\u7b2c\u4e00\u53e5', start: 10000, end: 11500 },
    { text: '\u7b2c\u4e8c\u53e5', start: 12000, end: 13000 },
  ],
);
assert.deepEqual(
  parseDroppedCaptions('\u6587\u6848.txt', '\u7b2c\u4e00\u884c\n\n\u7b2c\u4e8c\u884c', 4000),
  [
    { text: '\u7b2c\u4e00\u884c', start: 4000, end: 7000 },
    { text: '\u7b2c\u4e8c\u884c', start: 7000, end: 10000 },
  ],
);

console.log('externalFileDrop.verify: Finder media and caption classification OK');
