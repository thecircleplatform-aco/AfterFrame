// Runnable check: `npx tsx server/plugins/extract-frames.verify.ts`.
// Verify contact table sampling: the basic properties of uniform sampling, and the selection rule of "change priority + uniform completion"
// (Change points are selected first, those too close to each other are not repeated, too many candidates are evenly distributed in order, and discarded outside the window,
// Exactly the same as uniform sampling when there are no candidates).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { frameSeekArgs, pickDistinctTimes, sampleTimesMs } from './extract-frames.ts';

const source = await readFile(new URL('./extract-frames.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /\bspawn\(ffprobeBin\(\)/, 'ffprobe must use the shared low-priority process launcher');

const inWindow = (times: number[], lo: number, hi: number): boolean =>
  times.every((t) => t >= lo && t < hi);
const ascending = (times: number[]): boolean =>
  times.every((t, i) => i === 0 || t >= times[i - 1]!);

assert.deepEqual(frameSeekArgs(0), [], '\u9759\u6001\u56fe\u7247\u96f6\u79d2\u53d6\u5e27\u4e0d\u5f97\u5728\u8f93\u5165\u524d seek');
assert.deepEqual(frameSeekArgs(1500), ['-ss', '1.5'], '\u89c6\u9891\u6b63\u65f6\u95f4\u7ee7\u7eed\u8d70\u5feb\u901f seek');

// ── Uniform sampling: equally divided block midpoint, number of bars, interval ──
{
  assert.deepEqual(sampleTimesMs(0, 12000, 6), [1000, 3000, 5000, 7000, 9000, 11000], '\u7b49\u5206\u5757\u4e2d\u70b9');
  assert.equal(sampleTimesMs(0, 1000, 99).length, 20, '\u53d7 MAX_SAMPLES \u4e0a\u9650\u7ea6\u675f');
  assert.equal(sampleTimesMs(0, 1000, 0).length, 1, 'count 0 \u81f3\u5c11\u7ed9 1 \u4e2a');
}

// ── No candidates → exactly the same as uniform sampling (the fallback path when scene analysis fails) ──
{
  assert.deepEqual(pickDistinctTimes([], 0, 18000, 6), sampleTimesMs(0, 18000, 6), '\u7a7a\u5019\u9009=\u5747\u5300\u53d6\u6837');
}

// ── Change points are selected first, and the rest are filled up to count using uniform sampling ──
{
  const out = pickDistinctTimes([9000, 12000, 15000], 0, 18000, 6);
  assert.equal(out.length, 6, '\u8865\u9f50\u5230 count');
  for (const t of [9000, 12000, 15000]) assert.ok(out.includes(t), `\u53d8\u5316\u70b9 ${t} \u5fc5\u987b\u5165\u9009`);
  assert.ok(ascending(out) && inWindow(out, 0, 18000), '\u5347\u5e8f\u4e14\u843d\u5728\u7a97\u53e3\u5185');
}

// ── Candidates who are too close to each other will not occupy duplicate seats (otherwise one transition will take up multiple places) ──
{
  const out = pickDistinctTimes([9000, 9050, 9100], 0, 18000, 6);
  const near = out.filter((t) => t >= 9000 && t <= 9100);
  assert.equal(near.length, 1, '\u540c\u4e00\u5904\u53d8\u5316\u53ea\u5360\u4e00\u4e2a\u540d\u989d');
}

// ── There are more candidates than places → divide them evenly in order, not all at the beginning ──
{
  const dense = Array.from({ length: 40 }, (_, i) => i * 250); // 0..9750ms dense candidates
  const out = pickDistinctTimes(dense, 0, 10000, 5);
  assert.equal(out.length, 5, '\u4e0d\u8d85\u8fc7 count');
  assert.ok(out[out.length - 1]! - out[0]! > 5000, `\u5e94\u8986\u76d6\u6574\u6bb5\u800c\u975e\u6324\u5728\u5f00\u5934(\u5b9e\u5f97 ${out.join(',')})`);
  assert.ok(ascending(out), '\u5347\u5e8f');
}

// ── Candidates outside the window are discarded ──
{
  const out = pickDistinctTimes([-500, 500, 99000], 0, 3000, 3);
  assert.ok(inWindow(out, 0, 3000), `\u7a97\u53e3\u5916\u5019\u9009\u5fc5\u987b\u4e22\u5f03(\u5b9e\u5f97 ${out.join(',')})`);
  assert.ok(out.includes(500), '\u7a97\u53e3\u5185\u5019\u9009\u4fdd\u7559');
}

// ── The interval that is not the starting point of the window (view_asset_frames will pass fromMs/toMs) ──
{
  const out = pickDistinctTimes([7000], 5000, 9000, 3);
  assert.ok(inWindow(out, 5000, 9000), '\u76f8\u5bf9\u533a\u95f4\u5185');
  assert.ok(out.includes(7000), '\u533a\u95f4\u5185\u53d8\u5316\u70b9\u4fdd\u7559');
}

console.log('extract-frames.verify: ok (\u5747\u5300\u53d6\u6837/\u7a7a\u5019\u9009\u515c\u5e95/\u53d8\u5316\u4f18\u5148/\u8fd1\u90bb\u53bb\u91cd/\u5747\u644a/\u7a97\u53e3\u88c1\u526a)');
