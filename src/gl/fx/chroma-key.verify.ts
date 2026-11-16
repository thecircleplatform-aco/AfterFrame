// （chroma-key）
//  import effects.ts（ GL / tsx ），
// fx.check.ts  FX_EFFECTS['builtin:fx-chroma-key']  id/props
// （ effects.ts ），frag  fs
// : npx tsx src/gl/fx/chroma-key.check.ts
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fxUniforms, type FxDef } from './uniforms';

const __dirname = dirname(fileURLToPath(import.meta.url));

//  effects.ts  'builtin:fx-chroma-key'
const chromaKey: FxDef = {
  id: 'builtin:fx-chroma-key', name: '\u8272\u5ea6\u952e/\u7eff\u5e55', desc: '', frag: '',
  props: [
    { key: 'keyColor', label: '', kind: 'color', default: [0, 1, 0], uniform: 'u_keyColor' },
    { key: 'similarity', label: '', default: 0.18, min: 0, max: 0.6 },
    { key: 'smoothness', label: '', default: 0.08, min: 0.001, max: 0.4 },
    { key: 'spill', label: '', default: 0.5, min: 0, max: 1 },
  ],
};

// 1)  uniform ： props  u_<key>， prop  uniform
assert.deepStrictEqual(fxUniforms(chromaKey), {
  u_keyColor: [0, 1, 0],
  u_similarity: 0.18,
  u_smoothness: 0.08,
  u_spill: 0.5,
}, 'chroma-key \u9ed8\u8ba4 uniform \u6620\u5c04');

// 2)  override  [min,max]（ [0,1]）
assert.deepStrictEqual(
  fxUniforms(chromaKey, { similarity: 99, smoothness: -1, spill: 2, keyColor: [2, -1, 0.5] }),
  { u_keyColor: [1, 0, 0.5], u_similarity: 0.6, u_smoothness: 0.001, u_spill: 1 },
  '\u8d8a\u754c override \u88ab\u5939\u53d6',
);

// 3) frag ： runtime.ts renderFx  uniform
const frag = readFileSync(join(__dirname, 'chroma-key.frag'), 'utf8');
assert.ok(frag.includes('#version 300 es'), '\u58f0\u660e GLSL 300 es');
assert.ok(frag.includes('uniform sampler2D u_input'), '\u5f15\u7528 u_input（renderFx \u7ed1\u5b9a\u7684\u8f93\u5165\u8d34\u56fe）');
assert.ok(frag.includes('in vec2 v_texCoord'), '\u58f0\u660e v_texCoord varying（\u9876\u70b9\u7740\u8272\u5668\u63d0\u4f9b）');
assert.ok(/\bvoid\s+main\s*\(/.test(frag), '\u58f0\u660e main()');
assert.ok(/\bout\s+vec4\s+fragColor\b/.test(frag), '\u58f0\u660e out vec4 fragColor');
assert.ok(frag.includes('fragColor ='), 'main \u91cc\u5199 fragColor');

// props  key  uniform （uniform ?? u_<key>） frag ，
//  runtime  setUniform  location，
for (const p of chromaKey.props) {
  const uniformName = p.uniform ?? `u_${p.key}`;
  assert.ok(frag.includes(uniformName), `frag \u58f0\u660e ${uniformName}（\u5bf9\u5e94 props.${p.key}）`);
}

console.log('chroma-key.check: ok');
