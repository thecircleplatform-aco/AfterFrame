// Runnable check: `npx tsx src/color/scopes.verify.ts`.
// Verification: Oscilloscope statistics on synthetic RGBA patterns - grayscale (neutral/no dominant color), pure orange (main hue/warm bias),
// Overexposure (highlight overflow), teal-orange double cluster, segmented color cast with bluish shadows, and empty input.
import assert from 'node:assert/strict';
import { compareColorScopes } from '../../agent/tools/color-scope-tools';
import { analyzeRgbaPixels, describeScopeStats } from './scopes';

const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) < eps;

/** Construct RGBA buffer: give [r,g,b](0..255) row by row, n pixels per color block. */
function rgba(blocks: Array<[r: number, g: number, b: number, n: number]>): Uint8Array {
  const total = blocks.reduce((a, [, , , n]) => a + n, 0);
  const out = new Uint8Array(total * 4);
  let at = 0;
  for (const [r, g, b, n] of blocks) {
    for (let i = 0; i < n; i++) {
      out[at] = r; out[at + 1] = g; out[at + 2] = b; out[at + 3] = 255;
      at += 4;
    }
  }
  return out;
}

// ── Grayscale gradient: black and white dots, no saturation, no main color, color shift ≈ 0 ──
{
  const blocks: Array<[number, number, number, number]> = [];
  for (let v = 0; v <= 255; v += 5) blocks.push([v, v, v, 40]);
  const s = analyzeRgbaPixels(rgba(blocks), 1);
  assert.ok(s.blackPoint < 0.03 && s.whitePoint > 0.97, '\u7070\u9636\u9ed1\u767d\u70b9\u8d34\u8fb9');
  assert.ok(s.saturationMean < 0.01, '\u7070\u9636\u65e0\u9971\u548c');
  assert.deepEqual(s.dominantHues, [], '\u7070\u9636\u65e0\u4e3b\u8272\u76f8');
  assert.ok(near(s.warmCool, 0, 1e-6) && near(s.greenMagenta, 0, 1e-6), '\u7070\u9636\u96f6\u8272\u504f');
  assert.ok(describeScopeStats(s).some((line) => line.includes('near-neutral')), '\u5224\u8bfb\u63d0\u793a\u4e2d\u6027');
}

// ── Pure orange picture: main hue orange, warm, high saturation ──
{
  const s = analyzeRgbaPixels(rgba([[255, 128, 0, 5000]]), 1);
  assert.equal(s.dominantHues[0], 'orange', '\u4e3b\u8272\u76f8 orange');
  assert.ok(s.warmCool > 0.5, '\u6696\u51b7\u5e73\u8861\u660e\u663e\u504f\u6696');
  assert.ok(s.saturationMean > 0.9, '\u9ad8\u9971\u548c');
  assert.ok(near(s.hueHistogram.find((b) => b.label === 'orange')!.pct, 1, 1e-6), '\u76f4\u65b9\u56fe\u96c6\u4e2d\u5728 orange bin');
}

// ── Overexposure: 35% pure white → highlight bloom ratio ≈ 0.35, white point = 1 ──
{
  const s = analyzeRgbaPixels(rgba([[255, 255, 255, 3500], [120, 120, 120, 6500]]), 1);
  assert.ok(near(s.clippedHighlightsPct, 0.35, 0.01), `\u9ad8\u5149\u6ea2\u51fa≈35%(${s.clippedHighlightsPct})`);
  assert.ok(s.whitePoint > 0.99, '\u767d\u70b9\u8d34\u9876');
  assert.ok(s.clippedShadowsPct < 0.01, '\u6697\u90e8\u65e0\u6ea2\u51fa');
}

// ── teal-orange: Both main color clusters are recognized ──
{
  const s = analyzeRgbaPixels(rgba([[230, 140, 40, 4000], [20, 160, 180, 4000], [128, 128, 128, 2000]]), 1);
  assert.ok(s.dominantHues.includes('orange') && (s.dominantHues.includes('cyan') || s.dominantHues.includes('azure')),
    `teal-orange \u53cc\u7c07(${s.dominantHues.join(',')})`);
}

// ── Segmented color cast: dark parts are bluer, bright parts are warmer, and the segmented tilts should be different from each other ──
{
  const s = analyzeRgbaPixels(rgba([[20, 25, 60, 4000], [235, 210, 170, 4000]]), 1);
  assert.ok(s.tilt.shadows.warmCool < -0.05, `\u6697\u90e8\u504f\u84dd(${s.tilt.shadows.warmCool})`);
  assert.ok(s.tilt.highlights.warmCool > 0.05, `\u4eae\u90e8\u504f\u6696(${s.tilt.highlights.warmCool})`);
}

// ── Empty input will not explode ──
{
  const s = analyzeRgbaPixels(new Uint8Array(0));
  assert.equal(s.sampledPixels, 0);
  assert.deepEqual(s.dominantHues, []);
}

// ── Reference shot comparison: signed difference + named knob suggestion after dead zone ──
{
  const target = analyzeRgbaPixels(rgba([[230, 135, 40, 5000]]), 1);
  const reference = analyzeRgbaPixels(rgba([[100, 100, 100, 5000]]), 1);
  const compared = compareColorScopes(target, reference);
  assert.ok(compared.targetMinusReference.meanLuma > 0, '\u76ee\u6807\u6bd4\u53c2\u8003\u66f4\u4eae\u65f6\u5dee\u503c\u4e3a\u6b63');
  assert.ok(compared.targetMinusReference.warmCool > 0, '\u76ee\u6807\u6bd4\u53c2\u8003\u66f4\u6696\u65f6\u5dee\u503c\u4e3a\u6b63');
  assert.deepEqual(
    compared.suggestions.map((entry) => [entry.control, entry.direction]),
    [['brightness', 'decrease'], ['saturate', 'decrease'], ['temperature', 'cooler']],
  );
  assert.deepEqual(compareColorScopes(reference, reference).suggestions, [], '\u6b7b\u533a\u5185\u4e0d\u751f\u6210\u65e0\u610f\u4e49\u5efa\u8bae');
}

console.log('scopes.verify: ok (\u7070\u9636/\u4e3b\u8272\u76f8/\u6ea2\u51fa/\u53cc\u7c07/\u5206\u6bb5\u8272\u504f/\u53c2\u8003\u5bf9\u6bd4/\u7a7a\u8f93\u5165)');
