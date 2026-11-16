import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyframeResetBatch } from '../../editor/keyframeReset';
import { clampScalar, scalarModifier, scrubScalar, snapScalar } from './scalarMath';

assert.equal(scalarModifier({ shiftKey: false, metaKey: false }), 1);
assert.equal(scalarModifier({ shiftKey: true, metaKey: false }), 10);
assert.equal(scalarModifier({ shiftKey: false, metaKey: true }), 0.1);
assert.equal(scrubScalar(1, 2, 0.05, 0, 2, { shiftKey: false, metaKey: false }), 1.1);
assert.equal(scrubScalar(1, 2, 0.05, 0, 2, { shiftKey: true, metaKey: false }), 2);
assert.equal(scrubScalar(1, -100, 0.05, 0, 2, { shiftKey: false, metaKey: true }), 0.5);
assert.equal(clampScalar(9, 0, 2), 2);
assert.equal(snapScalar(1.373, 0, 2, 0.05), 1.35);

const row = keyframeResetBatch('clip-1', ['volume']);
assert.equal(row.label, 'Reset volume');
assert.deepEqual(row.actions, [
  { type: 'clearKeyframes', id: 'clip-1', prop: 'volume' },
  { type: 'setVolume', id: 'clip-1', volume: 1 },
]);

const group = keyframeResetBatch('clip-1', ['scale', 'x', 'y', 'rotation', 'opacity']);
assert.equal(group.label, 'Reset transform');
assert.deepEqual(group.actions.at(-1), {
  type: 'setTransform',
  id: 'clip-1',
  // Uniform scale reset also re-links scaleX/scaleY so non-uniform residue is cleared.
  patch: { scale: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, rotation: 0, opacity: 1, crop: undefined },
});

const transformSource = readFileSync(new URL('./InspectorKeyframeControls.tsx', import.meta.url), 'utf8');
assert.match(transformSource, /label: '\u88c1\u5de6'/, 'Transform \u5206\u7ec4\u5728\u5706\u89d2\u4e0b\u5e94\u6709\u88c1\u5de6');
assert.match(transformSource, /label: '\u88c1\u53f3'/, 'Transform \u5206\u7ec4\u5e94\u6709\u88c1\u53f3');
assert.match(transformSource, /label: '\u88c1\u4e0a'/, 'Transform \u5206\u7ec4\u5e94\u6709\u88c1\u4e0a');
assert.match(transformSource, /label: '\u88c1\u4e0b'/, 'Transform \u5206\u7ec4\u5e94\u6709\u88c1\u4e0b');
assert.match(transformSource, /CROP_ROWS\.map/, '\u56db\u8fb9\u88c1\u5207\u5e94\u6392\u5728\u5173\u952e\u5e27\u884c\u4e4b\u540e');

console.log('inspector-controls.verify: ok');
