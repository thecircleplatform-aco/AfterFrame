/**
 * Tier layer checks — run with `npx tsx src/tier/tier.verify.ts`.
 *
 * Covers the guarantees this layer makes: the default path stays the server
 * proxy, BYOK only activates on the free tier with a usable key, provider
 * gating is honest, and runtime-asset URLs are unchanged when unconfigured.
 */
import assert from 'node:assert/strict';

// Minimal browser surface: the modules read localStorage/import.meta.env lazily.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
} as Storage;

const { readChosenTier, writeChosenTier, setByokKey, getByokKey, maskKey, byokKeyCount } =
  await import('./byok');
const { resolveTier, shouldUseByok, isProviderAvailable, isHostedOrigin } = await import('./resolve');
const { byokConnection, defaultBaseUrl, resolvedBaseUrl } = await import('./byokClient');
const { runtimeAsset, usesRemoteRuntimeAssets } = await import('./assets');
const { RUNTIME_ASSETS, groupSizeBytes } = await import('./runtimeAssets');
const { supportsByok, TIER_IDS } = await import('./types');

// --- tier resolution -------------------------------------------------------
assert.deepEqual(TIER_IDS, ['free', 'paid'], 'two tiers are defined');
assert.equal(readChosenTier(), null, 'nothing chosen initially');
// No window in Node, so this is the non-hosted default: free.
assert.equal(resolveTier(), 'free', 'local/self-hosted defaults to free');

writeChosenTier('paid');
assert.equal(resolveTier(), 'paid', 'explicit choice wins');
assert.equal(isProviderAvailable('anthropic'), true, 'hosted tier can use every provider');
writeChosenTier('free');
assert.equal(resolveTier(), 'free', 'free can be forced');

// --- hosted host detection -------------------------------------------------
assert.equal(isHostedOrigin('afterframe.acocloud.app'), true, 'production host is hosted');
assert.equal(isHostedOrigin('abc123.afterframe-2a6.pages.dev'), true, 'preview deploy is hosted');
assert.equal(isHostedOrigin('localhost'), false, 'localhost is not hosted');

// --- BYOK gating -----------------------------------------------------------
assert.equal(supportsByok('deepseek'), true, 'deepseek permits browser calls');
assert.equal(supportsByok('anthropic'), false, 'anthropic blocks browser CORS');
assert.equal(supportsByok('xai-oauth'), false, 'server-only providers are never BYOK');

// On free with no key, the proxy must stay in charge.
setByokKey('deepseek', '');
assert.equal(shouldUseByok('deepseek'), true, 'tier/provider say BYOK is possible');
const missing = byokConnection('deepseek');
assert.equal(missing.ok, false, 'but no key means no connection');
assert.equal(missing.ok === false && missing.reason, 'missing-key');

// With a key it resolves to the vendor.
setByokKey('deepseek', 'sk-test-1234567890');
assert.equal(getByokKey('deepseek'), 'sk-test-1234567890');
const conn = byokConnection('deepseek');
assert.equal(conn.ok, true, 'key present -> connection built');
if (conn.ok) {
  assert.equal(conn.connection.baseURL, 'https://api.deepseek.com', 'default vendor base URL');
  assert.equal(conn.connection.apiKey, 'sk-test-1234567890', 'uses the user key, not a proxy key');
}

// Local runtimes need no key at all.
const ollama = byokConnection('ollama');
assert.equal(ollama.ok, true, 'ollama works without a key');
if (ollama.ok) assert.equal(ollama.connection.baseURL, 'http://localhost:11434/v1');

// Unsupported provider on free tier is reported, not silently misrouted.
assert.equal(shouldUseByok('anthropic'), false, 'anthropic stays on the proxy even on free');
assert.equal(isProviderAvailable('anthropic'), false, 'and is flagged unavailable');

// --- key hygiene -----------------------------------------------------------
assert.equal(maskKey('sk-test-1234567890'), 'sk-t…7890', 'keys are masked in the UI');
assert.equal(maskKey('short'), '••••', 'very short keys are fully hidden');
assert.equal(byokKeyCount(), 1, 'only providers with keys are counted');

// --- runtime assets --------------------------------------------------------
assert.equal(usesRemoteRuntimeAssets(), false, 'unset env keeps same-origin assets');
assert.equal(runtimeAsset('/mediapipe/wasm/x.wasm'), '/mediapipe/wasm/x.wasm', 'no base -> unchanged path');
assert.equal(runtimeAsset('models/a.onnx'), '/models/a.onnx', 'leading slash is normalised');

assert.ok(RUNTIME_ASSETS.length >= 2, 'mediapipe + silero groups exist');
for (const group of RUNTIME_ASSETS) {
  assert.ok(group.files.length > 0, `${group.id} has files`);
  assert.equal(typeof groupSizeBytes(group), 'number');
}

// --- base url overrides ----------------------------------------------------
assert.equal(defaultBaseUrl('openai'), 'https://api.openai.com/v1');
assert.equal(resolvedBaseUrl('nope'), '', 'unknown providers have no default');

console.log('tier.verify: tier resolution, BYOK gating, key hygiene and asset URLs OK');
