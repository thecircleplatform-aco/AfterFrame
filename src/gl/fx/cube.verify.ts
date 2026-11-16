// .cube  + fxPasses LUT (npx tsx src/gl/fx/cube.check.ts)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { parseCube, primeCube, getCubeSync, cubeSettled, type CubeLut } from './cube';
import { fxPasses, type FxDef } from './uniforms';

// ── 1.  2³  LUT ──────────────────────────────────────────────
const identity2 = `TITLE "id"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
{
  const lut = parseCube(identity2);
  assert.equal(lut.size, 2);
  assert.equal(lut.title, 'id');
  assert.equal(lut.data.length, 2 * 2 * 2 * 3);
  assert.deepEqual([...lut.data.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...lut.data.slice(-3)], [1, 1, 1]);
}

// ── 2. DOMAIN ( domain  [0,1])──────────────
{
  const lut = parseCube(`LUT_3D_SIZE 2
DOMAIN_MIN -1 -1 -1
DOMAIN_MAX 1 1 1
${'0 0 0\n'.repeat(8)}`);
  assert.equal(lut.data[0], 0.5); // (-1..1 \u57df\u4e0a\u7684 0) → 0.5
}

// ── 3. ( xX )──────────────────────────────────────
const bad: Array<[string, string]> = [
  ['\u7f3a LUT_3D_SIZE', '0 0 0\n'],
  ['\u5c3a\u5bf8\u8d8a\u754c(1)', 'LUT_3D_SIZE 1\n0 0 0\n'],
  ['\u5c3a\u5bf8\u8d8a\u754c(65)', 'LUT_3D_SIZE 65\n'],
  ['1D \u62d2\u7edd', 'LUT_1D_SIZE 4\n'],
  ['\u6570\u91cf\u4e0d\u7b26', 'LUT_3D_SIZE 2\n0 0 0\n'],
  ['\u975e\u6570\u503c', `LUT_3D_SIZE 2\n${'0 0 x\n'.repeat(8)}`],
  ['\u884c\u5bbd\u9519\u8bef', `LUT_3D_SIZE 2\n${'0 0\n'.repeat(8)}`],
  ['\u574f DOMAIN', `LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 1 1 1\n${'0 0 0\n'.repeat(8)}`],
];
for (const [name, text] of bad) {
  assert.throws(() => parseCube(text), `${name} \u5e94\u5f53\u629b\u9519`);
}

// ── 4.  .cube LUT  ─────────────────────────────────────────
for (const file of ['Sony_Slog3_s709.cube', 'CinemaGamut_CanonLog3-to-Canon709_33_Ver.1.0.cube']) {
  const lut = parseCube(readFileSync(`assets/luts/${file}`, 'utf8'));
  assert.equal(lut.size, 33, `${file} \u5e94\u4e3a 33³`);
  assert.equal(lut.data.length, 33 ** 3 * 3);
  let inRange = 0;
  for (const v of lut.data) {
    assert.ok(Number.isFinite(v), `${file} \u542b\u975e\u6709\u9650\u503c`);
    if (v >= 0 && v <= 1) inRange++;
  }
  assert.ok(inRange / lut.data.length > 0.95, `${file} \u5927\u90e8\u5206\u503c\u5e94\u843d\u5728 [0,1]`);
}

// ── 5. fxPasses :→intensity  0;→lut3d  ─────────
const def: FxDef = {
  id: 'builtin:test-lut', name: 't', desc: 't', frag: 'FRAG', cube: 'test://lut',
  props: [{ key: 'intensity', label: '\u5f3a\u5ea6', default: 1, min: 0, max: 1, step: 0.01 }],
};
{
  assert.equal(cubeSettled('test://lut'), false);
  const passes = fxPasses([{ def }], 0);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].lut3d, undefined);
  assert.equal(passes[0].uniforms?.u_intensity, 0, '\u672a\u52a0\u8f7d\u65f6\u900f\u4f20(intensity=0)');
}
{
  const fake: CubeLut = parseCube(identity2);
  primeCube('test://lut', fake);
  assert.equal(getCubeSync('test://lut'), fake);
  const passes = fxPasses([{ def, overrides: { intensity: 0.7 } }], 0);
  assert.equal(passes[0].lut3d, fake, '\u5c31\u7eea\u540e lut3d \u9644\u5728 pass \u4e0a');
  assert.equal(passes[0].uniforms?.u_intensity, 0.7);
}
{
  primeCube('test://lut', null); // \u52a0\u8f7d\u5931\u8d25\u6001 = \u6c38\u4e45\u900f\u4f20
  const passes = fxPasses([{ def }], 0);
  assert.equal(passes[0].lut3d, undefined);
  assert.equal(passes[0].uniforms?.u_intensity, 0);
}

console.log('cube.check: ok (\u89e3\u6790/\u57df\u5f52\u4e00/8 \u9519\u8bef\u9762/\u771f 33³ \u53cc\u6587\u4ef6/fxPasses \u4e09\u6001)');
