import assert from 'node:assert';
import { EXTENDED_TRANSITION_IDS, EXTENDED_TRANSITION_UNIFORMS, TRANSITION_LABELS_EXTENDED, EXTENDED_PREVIEW_APPROXIMATION } from '../../gl/extendedTransitions.generated';
import { TRANSITION_LABELS, TRANSITION_ORDER, GLSL_TRANSITION_TYPES, CSS_TRANSITION_TYPES } from '../../editor/types';
import { GLSL_TRANSITIONS } from '../../gl/transitions';
import { previewTransitionType } from '../../editor/transitionPreview';
import { resolveTransitionRequest } from './transition-tools';
import { TRANSITION_CATALOG, searchTransitions } from './schemas/transition-tools';

// ── catalog integrity ───────────────────────────────────────────────────────
assert.ok(EXTENDED_TRANSITION_IDS.length >= 100, `expected >= 100 extended transitions, got ${EXTENDED_TRANSITION_IDS.length}`);

for (const id of EXTENDED_TRANSITION_IDS) {
  assert.ok(TRANSITION_LABELS[id], `${id} is missing from TRANSITION_LABELS`);
  assert.strictEqual(TRANSITION_LABELS[id], TRANSITION_LABELS_EXTENDED[id], `${id} label drifted`);
  assert.ok(GLSL_TRANSITION_TYPES.has(id), `${id} is missing from GLSL_TRANSITION_TYPES`);
  assert.ok(TRANSITION_ORDER.includes(id), `${id} is missing from TRANSITION_ORDER`);
  assert.ok(GLSL_TRANSITIONS[id], `${id} has no GLSL registry entry`);
  assert.ok(GLSL_TRANSITIONS[id].frag.length > 100, `${id} has an empty fragment source`);
  assert.ok(EXTENDED_PREVIEW_APPROXIMATION[id], `${id} has no CSS preview fallback`);
  assert.ok(CSS_TRANSITION_TYPES.has(EXTENDED_PREVIEW_APPROXIMATION[id]), `${id} preview fallback is not a CSS type`);
  const defaults = EXTENDED_TRANSITION_UNIFORMS[id];
  assert.ok(defaults && typeof defaults === 'object', `${id} has no uniform defaults`);
}

// every fragment must declare the two-input contract
for (const id of EXTENDED_TRANSITION_IDS) {
  const frag = GLSL_TRANSITIONS[id].frag;
  for (const token of ['u_outgoing', 'u_incoming', 'u_progress', 'v_texCoord', 'fragColor']) {
    assert.ok(frag.includes(token), `${id} fragment is missing ${token}`);
  }
  assert.ok(frag.startsWith('#version 300 es'), `${id} fragment must start with #version (got: ${JSON.stringify(frag.slice(0, 30))})`);
}

// uniforms() must produce only declared values
for (const id of EXTENDED_TRANSITION_IDS) {
  const values = GLSL_TRANSITIONS[id].uniforms({ time: 0.5, aspect: 16 / 9, direction: 'left' });
  for (const [key, value] of Object.entries(values)) {
    assert.ok(typeof value === 'number' || Array.isArray(value), `${id}.${key} is not a number or array`);
  }
}

// ── preview fallback ────────────────────────────────────────────────────────
for (const id of EXTENDED_TRANSITION_IDS) {
  const css = previewTransitionType(id);
  assert.ok(CSS_TRANSITION_TYPES.has(css), `${id} previews as a non-CSS type`);
}

// ── tool catalog ────────────────────────────────────────────────────────────
const expectedCount = EXTENDED_TRANSITION_IDS.length + TRANSITION_ORDER.length - EXTENDED_TRANSITION_IDS.length + 1;
assert.ok(TRANSITION_CATALOG.length >= 170, `tool catalog lists ${TRANSITION_CATALOG.length}, expected >= 170`);
assert.strictEqual(new Set(TRANSITION_CATALOG.map((e) => e.id)).size, TRANSITION_CATALOG.length, 'tool catalog has duplicate ids');
void expectedCount;

// exact / label / group resolution
assert.strictEqual(resolveTransitionRequest('wipe-diagonal'), 'wipe-diagonal');
assert.strictEqual(resolveTransitionRequest('Diagonal Wipe'), 'wipe-diagonal');
assert.strictEqual(resolveTransitionRequest('audio-cross-fade'), 'audio-cross-fade');
// A group name resolves to a member of that group — the id prefix does not
// always match the group id (e.g. `clean-line-wipe` lives in group `wipe`).
const wipeMember = resolveTransitionRequest('wipe');
assert.ok(wipeMember, 'group name wipe did not resolve');
assert.strictEqual(
  TRANSITION_CATALOG.find((e) => e.id === wipeMember)?.group,
  'wipe',
  `"wipe" resolved to ${wipeMember}, which is not in the wipe group`,
);

// natural language
const nl: Array<[string, string]> = [
  ['quick glitchy cut', 'glitch'],
  ['heavy water ripple', 'warp'],
  ['page turn', 'fold'],
  ['shaky', 'camera'],
];
for (const [query, prefix] of nl) {
  const resolved = resolveTransitionRequest(query);
  assert.ok(resolved, `"${query}" did not resolve`);
  assert.ok(resolved.startsWith(prefix) || resolved.includes(prefix), `"${query}" resolved to ${resolved}, expected a ${prefix}* transition`);
}

// unknown input must not invent a transition
assert.strictEqual(resolveTransitionRequest('zzzznotathing'), null);
assert.strictEqual(resolveTransitionRequest(''), null);
assert.deepStrictEqual(searchTransitions('zzzznotathing', 5), []);

// search is case-insensitive and bounded
assert.ok(searchTransitions('GLITCH', 100).length > 5);
assert.ok(searchTransitions('glitch', 3).length <= 3);

console.log(`transition-catalog.check: OK (${EXTENDED_TRANSITION_IDS.length} extended, ${TRANSITION_CATALOG.length} searchable)`);
