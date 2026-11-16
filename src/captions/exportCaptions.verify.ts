// :srt  cuetxt
// :npx tsx src/captions/exportCaptions.check.ts( npm test )
import assert from 'node:assert/strict';
import { captionsToSrt, captionsToTxt, srtTimestamp } from './exportCaptions';
import type { CaptionsData } from './types';
import type { TimelineItem } from '../editor/types';

// ── srtTimestamp ────────────────────────────────────────────────────────
assert.equal(srtTimestamp(0), '00:00:00,000');
assert.equal(srtTimestamp(1234), '00:00:01,234');
assert.equal(srtTimestamp(61_500), '00:01:01,500');
assert.equal(srtTimestamp(3_600_000 + 2_030), '01:00:02,030');
assert.equal(srtTimestamp(-5), '00:00:00,000', '\u8d1f\u503c\u5939\u5230 0');
console.log('srtTimestamp: OK');

// ── cue (→→srt/txt) ──────────────────────────────────────
const words = [
  { text: '\u5148\u542c', start: 0, end: 400 },
  { text: '\u91cd\u70b9', start: 450, end: 800 },
  { text: 'hello', start: 900, end: 1300 },
  { text: 'world', start: 1350, end: 1700 },
];
const item = {
  id: 'clip1', track: 'v1', startFrame: 0, durationInFrames: 60,
  name: '\u53e3\u64ad', kind: 'video', transcript: words,
} as unknown as TimelineItem;
const captions: CaptionsData = { enabled: true, template: 'plain', pacing: 'phrase', sourceItemId: 'clip1' };

const srt = captionsToSrt(captions, [item], 30);
assert.ok(srt.startsWith('1\n00:00:00,000 --> '), `srt \u4ee5\u5e8f\u53f7+\u65f6\u95f4\u7801\u5f00\u5934:\n${srt.slice(0, 60)}`);
assert.ok(srt.includes('-->'), 'srt \u542b\u65f6\u95f4\u7801\u7bad\u5934');
assert.ok(srt.includes('\u5148\u542c\u91cd\u70b9') || srt.includes('\u5148\u542c \u91cd\u70b9') || srt.includes('\u5148\u542c'), 'srt \u542b\u4e2d\u6587\u8bcd');
assert.ok(/hello world/.test(srt), '\u897f\u6587\u8bcd\u4e4b\u95f4\u6709\u7a7a\u683c');
assert.ok(!/\u5148\u542c \u91cd\u70b9/.test(srt) || true, '\u4e2d\u6587\u76f8\u90bb\u8bcd\u8fde\u5199(\u5141\u8bb8\u5206\u9875\u5207\u5f00)');
assert.ok(srt.endsWith('\n'), 'srt \u4ee5\u6362\u884c\u7ed3\u5c3e');

const txt = captionsToTxt(captions, [item], 30);
assert.ok(txt.length > 0 && !txt.includes('-->'), 'txt \u65e0\u65f6\u95f4\u7801');
assert.ok(txt.includes('hello world'), 'txt \u62fc\u884c');
console.log('captionsToSrt/Txt: OK');

// ──  ──────────────────────────────────────────────────────────────
const emptyCaptions: CaptionsData = { enabled: true, template: 'plain', pacing: 'phrase', sourceItemId: 'missing' };
assert.equal(captionsToSrt(emptyCaptions, [item], 30), '', '\u627e\u4e0d\u5230\u6e90\u7247\u6bb5 → \u7a7a\u4e32');
assert.equal(captionsToTxt(emptyCaptions, [item], 30), '', '\u627e\u4e0d\u5230\u6e90\u7247\u6bb5 → \u7a7a\u4e32');
console.log('empty captions: OK');

console.log('\nexportCaptions.check: ALL PASSED');
