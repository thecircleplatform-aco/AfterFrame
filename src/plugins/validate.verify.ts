//  + def  + zoom npx tsx src/plugins/validate.check.ts
import assert from 'node:assert/strict';
import { validatePack, validateItem } from './validate';
import { fxDefOf, lutDefOf, transitionDefOf } from './store';
import { PLUGIN_FORMAT, PLUGIN_LIMITS, pluginAssetId, type PluginPack } from './types';
import { sampleEnvelope, zoomAt } from '../editor/zoom';
import { reduce } from '../editor/reduce';
import type { TimelineItem, TimelineState } from '../editor/types';

const FX_FRAG = 'uniform sampler2D u_input;\nvoid main(){ /* … */ }';
const TR_FRAG = 'uniform sampler2D u_outgoing;\nuniform sampler2D u_incoming;\nuniform float u_progress;\nvoid main(){}';
const CUBE_2 = ['LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'].join('\n');

const goodPack: PluginPack = {
  format: PLUGIN_FORMAT,
  id: 'demo-pack',
  name: '\u793a\u4f8b\u5305',
  version: '1.0.0',
  author: 'tester',
  items: [
    { type: 'mg-template', id: 'title-card', name: '\u6807\u9898\u5361', width: 1920, height: 1080, code: 'const T = () => null;' },
    { type: 'transition', id: 'ink', name: '\u6c34\u58a8', frag: TR_FRAG, props: [{ key: 'softness', label: '\u67d4\u548c', default: 0.3, min: 0, max: 1 }] },
    { type: 'fx', id: 'vhs', name: 'VHS', frag: FX_FRAG },
    { type: 'lut', id: 'moody', name: 'Moody', cube: CUBE_2 },
    { type: 'zoom', id: 'elastic', name: '\u5f39\u529b', envelope: [0, 0.6, 1.1, 1], magnification: 1.6 },
  ],
};

// ──  ────────────────────────────────────────────────────────────────
{
  const res = validatePack(goodPack);
  assert.ok(res.ok, `\u826f\u6027\u5305\u5e94\u901a\u8fc7:${res.ok ? '' : res.errors.join('; ')}`);
}

// ── / ────────────────────────────────────────────────────────
const rejects: Array<[string, unknown]> = [
  ['\u975e\u5bf9\u8c61', 'not-an-object'],
  ['\u9519 format', { ...goodPack, format: 'evil@9' }],
  ['\u574f\u5305 id', { ...goodPack, id: 'Bad_ID!' }],
  ['\u574f\u7248\u672c', { ...goodPack, version: 'v1' }],
  ['\u7a7a items', { ...goodPack, items: [] }],
  ['\u6761\u76ee\u8d85\u9650', { ...goodPack, items: Array.from({ length: PLUGIN_LIMITS.maxItems + 1 }, (_, i) => ({ type: 'zoom', id: `z-${i}`, name: 'z', envelope: [0, 1] })) }],
  ['\u6761\u76ee id \u91cd\u590d', { ...goodPack, items: [goodPack.items[4], goodPack.items[4]] }],
  ['\u672a\u77e5 type', { ...goodPack, items: [{ type: 'malware', id: 'x', name: 'x' }] }],
  ['fx \u7f3a u_input', { ...goodPack, items: [{ type: 'fx', id: 'x', name: 'x', frag: 'void main(){}' }] }],
  ['fx frag \u8d85\u9650', { ...goodPack, items: [{ type: 'fx', id: 'x', name: 'x', frag: `uniform sampler2D u_input;${'/*x*/'.repeat(20000)}` }] }],
  ['\u8f6c\u573a\u7f3a u_progress', { ...goodPack, items: [{ type: 'transition', id: 'x', name: 'x', frag: 'uniform sampler2D u_outgoing; uniform sampler2D u_incoming;' }] }],
  ['prop key \u975e\u6cd5', { ...goodPack, items: [{ type: 'fx', id: 'x', name: 'x', frag: FX_FRAG, props: [{ key: 'bad key', label: 'x', default: 0, min: 0, max: 1 }] }] }],
  ['prop \u8d85\u6570\u91cf', { ...goodPack, items: [{ type: 'fx', id: 'x', name: 'x', frag: FX_FRAG, props: Array.from({ length: PLUGIN_LIMITS.maxProps + 1 }, (_, i) => ({ key: `k${i}`, label: 'x', default: 0, min: 0, max: 1 })) }] }],
  ['1D LUT', { ...goodPack, items: [{ type: 'lut', id: 'x', name: 'x', cube: 'LUT_1D_SIZE 2\n0 0 0\n1 1 1' }] }],
  ['\u574f cube \u6570\u636e', { ...goodPack, items: [{ type: 'lut', id: 'x', name: 'x', cube: 'LUT_3D_SIZE 2\n0 0' }] }],
  ['envelope \u70b9\u592a\u5c11', { ...goodPack, items: [{ type: 'zoom', id: 'x', name: 'x', envelope: [1] }] }],
  ['envelope \u503c\u8d8a\u754c', { ...goodPack, items: [{ type: 'zoom', id: 'x', name: 'x', envelope: [0, 99] }] }],
  ['zoom magnification \u8d8a\u754c', { ...goodPack, items: [{ type: 'zoom', id: 'x', name: 'x', envelope: [0, 1], magnification: 99 }] }],
  ['mg code \u7f3a\u5931', { ...goodPack, items: [{ type: 'mg-template', id: 'x', name: 'x', code: '' }] }],
  ['thumb \u975e\u6cd5 scheme', { ...goodPack, items: [{ type: 'zoom', id: 'x', name: 'x', envelope: [0, 1], thumb: 'javascript:alert(1)' }] }],
  ['thumb \u8d85\u9650', { ...goodPack, items: [{ type: 'zoom', id: 'x', name: 'x', envelope: [0, 1], thumb: `data:image/jpeg;base64,${'A'.repeat(PLUGIN_LIMITS.maxThumbBytes + 64)}` }] }],
];
{
  const withThumb = validatePack({ ...goodPack, items: [{ type: 'zoom', id: 'zx', name: 'x', envelope: [0, 1], thumb: 'data:image/jpeg;base64,AAAA' }, { type: 'fx', id: 'fy', name: 'y', frag: FX_FRAG, thumb: '/plugins/t.jpg' }] });
  assert.ok(withThumb.ok, `data/URL thumb \u5e94\u901a\u8fc7:${withThumb.ok ? '' : withThumb.errors.join(';')}`);
}
for (const [label, bad] of rejects) {
  const res = validatePack(bad);
  assert.ok(!res.ok, `${label} \u5e94\u88ab\u62d2`);
}
assert.ok(validateItem({ type: 'fx', id: 'ok', name: 'ok', frag: FX_FRAG }).length === 0, 'validateItem \u826f\u6027\u5355\u6761\u901a\u8fc7');
console.log(`validatePack: \u826f\u6027\u901a\u8fc7 + ${rejects.length} \u7c7b\u574f\u5305\u5168\u62d2 OK`);

// ── def : id  +  ─────────────────────────────────────────
{
  const fx = fxDefOf(goodPack, goodPack.items[2] as never);
  assert.equal(fx.id, 'plugin:demo-pack/vhs');
  assert.equal(fx.frag, FX_FRAG);
  const lut = lutDefOf(goodPack, goodPack.items[3] as never, '/media/uploads/demo-pack-moody.cube', 'LUTFRAG');
  assert.equal(lut.id, 'plugin:demo-pack/moody');
  assert.equal(lut.cube, '/media/uploads/demo-pack-moody.cube');
  assert.equal(lut.frag, 'LUTFRAG');
  assert.equal(lut.props[0].key, 'intensity');
  const tr = transitionDefOf(goodPack, goodPack.items[1] as never);
  assert.equal(tr.id, 'plugin:demo-pack/ink');
  assert.equal(tr.label, '\u6c34\u58a8');
  assert.equal(pluginAssetId('a', 'b'), 'plugin:a/b');
  console.log('def \u6620\u5c04 OK');
}

// ── zoom : +  +  ──────────────────────────────────
{
  assert.equal(sampleEnvelope([0, 1], 0.5), 0.5, '\u4e24\u70b9\u7ebf\u6027\u4e2d\u503c');
  assert.equal(sampleEnvelope([0, 1, 0], 0.25), 0.5, '\u4e09\u70b9\u7b2c\u4e00\u6bb5\u4e2d\u503c');
  assert.equal(sampleEnvelope([0.4], 0.9), 0.4, '\u5355\u70b9\u5373\u5e38\u91cf');
  const z = { envelope: [0, 1], magnification: 2 };
  assert.equal(zoomAt(z, 0, 61).magnification, 1, '\u5305\u7edc\u8d77\u70b9 = \u65e0\u7f29\u653e');
  assert.equal(zoomAt(z, 60, 61).magnification, 2, '\u5305\u7edc\u7ec8\u70b9 = \u6ee1\u500d\u7387');
  const over = zoomAt({ envelope: [0, 1.5], magnification: 2 }, 60, 61).magnification;
  assert.ok(Math.abs(over - 2.5) < 1e-9, `\u8fc7\u51b2\u5305\u7edc\u653e\u5927\u5230 2.5,\u5b9e\u5f97 ${over}`);
  // shape  envelope  envelope ()
  const both = zoomAt({ envelope: [1, 1], shape: 'zoom-out', magnification: 2 }, 0, 61).magnification;
  assert.equal(both, 2, 'envelope \u8986\u76d6 shape');
  console.log('zoom \u5305\u7edc OK');
}

// ── reduce setEffects: defs  state.fxDefs, ───────────────
{
  const base: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    items: [{ id: 'a', track: 'V1', startFrame: 0, durationInFrames: 60, kind: 'video', name: 'a', src: '/a.mp4' } as TimelineItem],
  };
  const def = { id: 'plugin:demo-pack/vhs', name: 'VHS', desc: 'x', frag: FX_FRAG, props: [] };
  const s1 = reduce(base, { type: 'setEffects', id: 'a', effects: [{ id: 'e1', assetId: def.id }], defs: [def] });
  assert.equal(s1.fxDefs?.[def.id]?.frag, FX_FRAG, 'def \u8fdb state.fxDefs');
  assert.equal(s1.items[0].effects?.[0]?.assetId, def.id);
  const s2 = reduce(s1, { type: 'setEffects', id: 'a', effects: [] });
  assert.equal(s2.fxDefs?.[def.id]?.frag, FX_FRAG, '\u79fb\u9664\u7279\u6548\u4e0d\u6e05 defs(\u64a4\u9500/\u91cd\u6302\u5b89\u5168)');
  assert.equal(s2.items[0].effects, undefined);
  console.log('reduce fxDefs OK');
}

// ── :(/)+  id +  ────────────────
{
  const { fxCandidates, transitionCandidates, mgCandidates, buildExportPack } = await import('./export');
  const fx = fxCandidates([
    { id: 'custom:fx-a', name: '\u7532', desc: 'x', frag: FX_FRAG, props: [] },
    { id: 'plugin:other/b', name: '\u4ed6\u4eba', desc: 'x', frag: FX_FRAG, props: [] },   // \u4e0d\u5bfc\u4ed6\u4eba\u5185\u5bb9
    { id: 'builtin:fx-invert', name: '\u5185\u7f6e', desc: 'x', frag: FX_FRAG, props: [] }, // \u4e0d\u5bfc\u5185\u7f6e
    { id: 'custom:fx-a', name: '\u7532', desc: 'x', frag: FX_FRAG, props: [] },        // \u53bb\u91cd
  ]);
  assert.equal(fx.length, 1, 'fx \u5019\u9009\u53ea\u6536 custom: \u4e14\u53bb\u91cd');
  const trs = transitionCandidates(
    [{ id: 'custom:tr-x', label: '\u6ce8\u518c\u8868\u8f6c\u573a', frag: TR_FRAG, props: [] }],
    [
      { id: 't1', type: 'custom-shader', durationInFrames: 30, outgoingItemId: 'a', incomingItemId: 'b', trackId: 'V1', customFrag: TR_FRAG, customLabel: '\u540cfrag' },
      { id: 't2', type: 'custom-shader', durationInFrames: 30, outgoingItemId: 'b', incomingItemId: 'c', trackId: 'V1', customFrag: TR_FRAG + '\n// v2', customUniforms: { u_soft: 0.3 }, customLabel: '\u65f6\u95f4\u7ebf\u8f6c\u573a' },
      { id: 't3', type: 'cross-dissolve', durationInFrames: 30, outgoingItemId: 'c', incomingItemId: 'd', trackId: 'V1' },
    ],
  );
  assert.equal(trs.length, 2, '\u6ce8\u518c\u8868 + \u65f6\u95f4\u7ebf\u5b64\u513f frag,\u540c frag \u53bb\u91cd,\u5185\u7f6e\u8f6c\u573a\u4e0d\u6536');
  const mgs = mgCandidates([
    { id: 'm1', track: 'V1', startFrame: 0, durationInFrames: 60, name: '\u5361\u7247', kind: 'motion-graphic', code: 'const A = () => null;' },
    { id: 'm2', track: 'V1', startFrame: 60, durationInFrames: 60, name: '\u5361\u7247', kind: 'motion-graphic', code: 'const A = () => null;' },
    { id: 'v1', track: 'V1', startFrame: 120, durationInFrames: 60, name: '\u89c6\u9891', kind: 'video', src: '/a.mp4' },
  ] as TimelineItem[]);
  assert.equal(mgs.length, 1, 'MG \u6309 code \u53bb\u91cd,\u975e MG \u4e0d\u6536');
  const built = buildExportPack({ id: 'my-pack', name: '\u6211\u7684\u5305' }, [fx[0].item, trs[0].item, trs[1].item, mgs[0].item]);
  assert.ok(built.ok, `\u7ec4\u5305\u5e94\u8fc7\u6821\u9a8c:${built.ok ? '' : built.errors.join(';')}`);
  if (built.ok) {
    assert.deepEqual(built.pack.items.map((i) => i.id), ['fx-1', 'tr-1', 'tr-2', 'mg-1'], 'id \u6309\u7c7b\u578b\u91cd\u6392\u552f\u4e00');
    assert.equal(built.pack.version, '1.0.0');
  }
  const badId = buildExportPack({ id: 'Bad Id!', name: 'x' }, [fx[0].item]);
  assert.ok(!badId.ok, '\u574f\u5305 id \u88ab\u62d2');
  console.log('export \u7ec4\u5305 OK');
}

// ── propSchema  + sha256Hex + () ─────────────────────────
{
  const mg = (extra: Record<string, unknown>) => ({ ...goodPack, items: [{ type: 'mg-template', id: 'mg-x', name: 'x', code: 'const T = () => null;', ...extra }] });
  assert.ok(validatePack(mg({ propSchema: [{ key: 'title', type: 'text', label: '\u6807\u9898' }] })).ok, '\u826f\u6027 propSchema \u901a\u8fc7');
  assert.ok(!validatePack(mg({ propSchema: 'nope' })).ok, '\u975e\u6570\u7ec4 propSchema \u62d2');
  assert.ok(!validatePack(mg({ propSchema: [{ key: 1, type: 'text' }] })).ok, 'key \u975e\u5b57\u7b26\u4e32\u62d2');
  assert.ok(!validatePack(mg({ propSchema: Array.from({ length: 33 }, (_, i) => ({ key: `k${i}`, type: 'text' })) })).ok, '>32 \u9879\u62d2');

  const { sha256Hex, installFromText } = await import('./install');
  const hex = await sha256Hex('afterframe');
  assert.match(hex, /^[0-9a-f]{64}$/, 'sha256Hex \u8f93\u51fa 64 \u4f4d\u5c0f\u5199 hex');
  assert.equal(hex, await sha256Hex('afterframe'), '\u540c\u6587\u672c\u7a33\u5b9a');
  const mismatch = await installFromText('{}', { sha256: 'f'.repeat(64) });
  assert.ok(!mismatch.ok && mismatch.errors[0].includes('SHA-256'), '\u54c8\u5e0c\u4e0d\u5339\u914d\u5728\u89e3\u6790\u524d\u62d2\u88c5');

  const { registerCustomTransition, getCustomTransition, unregisterCustomTransition, __resetCustomTransitions } = await import('../gl/customTransitions');
  registerCustomTransition({ id: 'plugin:p/t', label: 't', frag: TR_FRAG, props: [] });
  assert.ok(getCustomTransition('plugin:p/t'), '\u6ce8\u518c\u53ef\u89c1');
  assert.equal(unregisterCustomTransition('plugin:p/t'), true, '\u53cd\u6ce8\u518c\u8fd4\u56de true');
  assert.equal(getCustomTransition('plugin:p/t'), undefined, '\u53cd\u6ce8\u518c\u540e\u4e0d\u53ef\u89c1');
  assert.equal(unregisterCustomTransition('plugin:p/t'), false, '\u91cd\u590d\u53cd\u6ce8\u518c\u8fd4\u56de false');
  __resetCustomTransitions();

  const { registerCustomZoom, getCustomZoom, unregisterCustomZoom, __resetCustomZooms } = await import('../editor/customZooms');
  registerCustomZoom({ id: 'plugin:p/z', label: 'z', envelope: [0, 1] });
  assert.ok(getCustomZoom('plugin:p/z'));
  assert.equal(unregisterCustomZoom('plugin:p/z'), true);
  assert.equal(getCustomZoom('plugin:p/z'), undefined, 'zoom \u53cd\u6ce8\u518c\u540e\u4e0d\u53ef\u89c1');
  __resetCustomZooms();
  console.log('propSchema/sha256/\u53cd\u6ce8\u518c OK');
}

console.log('\nplugins/validate.check: ALL PASSED');
