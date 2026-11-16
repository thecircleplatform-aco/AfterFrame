import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mediaRatioLabel } from './mediaPoolFormat';

assert.equal(mediaRatioLabel(1920, 1080), '16:9');
assert.equal(mediaRatioLabel(1080, 1920), '9:16');
assert.equal(mediaRatioLabel(1024, 768), '4:3');
assert.equal(mediaRatioLabel(undefined, 1080), null);
assert.equal(mediaRatioLabel(1920, 0), null);
// Source files are rarely an exact ratio: encoders round to a codec-friendly size, and a
// 427×240 trailer used to read "427:240" (gcd 1). Snap to the ratio a person would name.
assert.equal(mediaRatioLabel(427, 240), '16:9', 'a pixel off 16:9 is still 16:9');
assert.equal(mediaRatioLabel(854, 480), '16:9');
assert.equal(mediaRatioLabel(1440, 1080), '4:3');
assert.equal(mediaRatioLabel(1080, 1080), '1:1');
assert.equal(mediaRatioLabel(2560, 1080), '21:9');
assert.equal(mediaRatioLabel(3000, 2000), '3:2');
// Not close to anything named: a small reduced fraction is fine, a large one becomes a decimal.
assert.equal(mediaRatioLabel(1400, 1000), '7:5');
assert.equal(mediaRatioLabel(1998, 1080), '1.85:1', 'flat widescreen is shown as a proportion, not 111:60');
assert.equal(mediaRatioLabel(1280, 544), '21:9', 'scope (2.35) is what people call 21:9');
assert.equal(mediaRatioLabel(1920, 800), '2.40:1', 'anamorphic 2.40 is past the 21:9 tolerance');

const cardSource = readFileSync(new URL('./MediaPoolCard.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

assert.match(
  cardSource,
  /const aspectLabel = mediaRatioLabel\(asset\.width, asset\.height\);[\s\S]*?className="cc-asset-ratio"/,
  '\u7d20\u6750\u5361\u7247\u5e94\u6839\u636e\u81ea\u8eab\u5bbd\u9ad8\u6e32\u67d3\u6bd4\u4f8b\u89d2\u6807',
);
assert.match(
  cssSource,
  /\.cc-asset-ratio\s*\{[^}]*position:\s*absolute;[^}]*left:\s*4px;[^}]*bottom:\s*4px;/s,
  '\u7d20\u6750\u6bd4\u4f8b\u5e94\u56fa\u5b9a\u5728\u7f29\u7565\u56fe\u5de6\u4e0b\u89d2',
);
assert.match(
  cssSource,
  /\.cc-media-grid\.list[\s\S]*?\.cc-asset-ratio[\s\S]*?display:\s*none;/,
  '\u5217\u8868\u6a21\u5f0f\u5e94\u9690\u85cf\u7f29\u7565\u56fe\u6bd4\u4f8b\u89d2\u6807',
);

console.log('media-aspect-badge.verify: valid visual media ratios render at thumbnail bottom-left');
