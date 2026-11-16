// Runnable check: `npx tsx src/agent/settings/agent-settings.verify.ts`.
// Verification: settings default value/persistence roundtrip, <agent_settings> injection (tier and planMode branches),
// Inline <thinking> extract state machine (single chunk/cross-chunk/unclosed/nested text/half label).
import assert from 'node:assert/strict';
import {
  AGENT_CACHE_MODES, DEFAULT_AGENT_SETTINGS, loadAgentSettings, saveAgentSettings,
  agentSettingsPrompt, createInlineThinkingExtractor,
  MG_TIERS,
} from './agentSettings';

// ── Default value (node has no localStorage → load uses catch/empty storage, return to default in both cases) ──
assert.deepStrictEqual(loadAgentSettings(), DEFAULT_AGENT_SETTINGS, '\u65e0\u5b58\u50a8 → \u9ed8\u8ba4\u503c');
assert.strictEqual(DEFAULT_AGENT_SETTINGS.mgTier, 'balance', 'mgTier \u9ed8\u8ba4 balance');
assert.strictEqual(DEFAULT_AGENT_SETTINGS.planMode, false, 'planMode \u9ed8\u8ba4 false');
assert.strictEqual(DEFAULT_AGENT_SETTINGS.cacheMode, 'short', 'cacheMode \u9ed8\u8ba4 short');
assert.strictEqual(DEFAULT_AGENT_SETTINGS.autonomousAcceptance, false, '\u81ea\u4e3b\u9a8c\u6536\u9ed8\u8ba4\u5173\u95ed，\u65e7\u7528\u6237\u884c\u4e3a\u4e0d\u53d8');
assert.strictEqual(DEFAULT_AGENT_SETTINGS.maxAcceptanceIterations, 3, '\u81ea\u4e3b\u9a8c\u6536\u9ed8\u8ba4\u6700\u591a 3 \u8f6e');
assert.deepStrictEqual([...AGENT_CACHE_MODES], ['short', 'long']);
assert.deepStrictEqual([...MG_TIERS], ['speed', 'balance', 'quality']);

// ── Persistence roundtrip (map version localStorage mock) ──
const store = new Map<string, string>();
// defineProperty: compatible with the localStorage accessor that comes with newer nodes (direct assignment may be rejected)
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  },
});
saveAgentSettings({
  mgTier: 'quality', planMode: true, cacheMode: 'long', serverRun: false,
  autonomousAcceptance: true, maxAcceptanceIterations: 5,
});
assert.deepStrictEqual(
  loadAgentSettings(),
  {
    mgTier: 'quality', planMode: true, cacheMode: 'long', serverRun: true,
    autonomousAcceptance: true, maxAcceptanceIterations: 5,
  },
  'save→load roundtrip \u4fdd\u771f(server-side execution is always on)',
);
// Removed settings from older storage must not leak back into the active settings shape.
store.set('cc.agentSettings.v1', JSON.stringify({ skillGuard: true, thinkingEnabled: true, mgTier: 'speed', planMode: false }));
assert.deepStrictEqual(
  loadAgentSettings(),
  {
    mgTier: 'speed', planMode: false, cacheMode: 'short', serverRun: true,
    autonomousAcceptance: false, maxAcceptanceIterations: 3,
  },
  '\u65e7 thinkingEnabled \u5b57\u6bb5\u88ab\u5ffd\u7565\u4e14\u65b0\u7f13\u5b58\u5b57\u6bb5\u5b89\u5168\u56de\u9000(server-side execution stays on)',
);
// Illegal tier / Missing fields fall back to default
store.set('cc.agentSettings.v1', JSON.stringify({ mgTier: 'ludicrous' }));
assert.strictEqual(loadAgentSettings().mgTier, 'balance', '\u975e\u6cd5 tier \u56de\u843d balance');

// ── <agent_settings> injection ──
const off = agentSettingsPrompt({ mgTier: 'speed', planMode: false });
assert.ok(off.includes('<agent_settings>') && off.includes('</agent_settings>'), '\u6709\u6807\u7b7e\u5305\u88f9');
assert.ok(off.includes('motion_graphic_tier=speed'), '\u542b tier \u952e\u503c');
assert.ok(off.includes('--tier speed'), '\u5305\u542b pass --tier \u63aa\u8f9e');
assert.ok(!off.includes('plan_mode'), 'planMode off → \u65e0\u8ba1\u5212\u6307\u4ee4');
const on = agentSettingsPrompt({ mgTier: 'quality', planMode: true });
assert.ok(on.includes('motion_graphic_tier=quality') && on.includes('--tier quality'), 'tier \u8ddf\u968f\u8bbe\u7f6e');
assert.ok(on.includes('plan_mode=on') && on.includes('numbered plan'), 'planMode on → \u5148\u8ba1\u5212\u540e\u52a8\u624b\u6307\u4ee4');

// ── Inline <thinking> extract state machine ──
const run = (chunks: string[]) => {
  const ex = createInlineThinkingExtractor();
  let text = '';
  let thinking = '';
  for (const c of chunks) {
    const r = ex.push(c);
    text += r.text;
    thinking += r.thinking;
  }
  const f = ex.flush();
  return { text: text + f.text, thinking: thinking + f.thinking };
};

// Single chunk complete label
assert.deepStrictEqual(run(['\u524d<thinking>\u601d\u8003</thinking>\u540e']), { text: '\u524d\u540e', thinking: '\u601d\u8003' }, '\u5355 chunk \u62bd\u53d6');
// Unlabeled passthrough (including nudity < not affected)
assert.deepStrictEqual(run(['\u7eaf\u6587\u672c,a < b \u4e5f\u4e0d\u53d7\u5f71\u54cd']), { text: '\u7eaf\u6587\u672c,a < b \u4e5f\u4e0d\u53d7\u5f71\u54cd', thinking: '' }, '\u65e0\u6807\u7b7e\u76f4\u901a');
// Across chunks: opening/closing tags are split
assert.deepStrictEqual(run(['\u5f00\u5934<thi', 'nking>\u5185\u90e8', '\u601d\u8003</thin', 'king>\u7ed3\u5c3e']), { text: '\u5f00\u5934\u7ed3\u5c3e', thinking: '\u5185\u90e8\u601d\u8003' }, '\u8de8 chunk \u5288\u5f00\u6807\u7b7e');
// Not closed: all remaining balance at the end of the stream returns to thinking
assert.deepStrictEqual(run(['a<thinking>\u6ca1\u95ed\u5408\u7684\u601d\u8003']), { text: 'a', thinking: '\u6ca1\u95ed\u5408\u7684\u601d\u8003' }, '\u672a\u95ed\u5408\u5f52 thinking');
// Unclosed + half-closed tags also belong to thinking
assert.deepStrictEqual(run(['<thinking>x</thin']), { text: '', thinking: 'x</thin' }, '\u534a\u622a\u95ed\u6807\u7b7e\u968f\u672a\u95ed\u5408\u5f52 thinking');
// The half-cut label finally becomes a label → normal text
assert.deepStrictEqual(run(['\u4ef7\u683c <think']), { text: '\u4ef7\u683c <think', thinking: '' }, '\u534a\u622a\u5f00\u6807\u7b7e\u662f\u6b63\u6587');
// Nested text: Leave other tags in thinking as they are, and restore the text after closing.
assert.deepStrictEqual(run(['A<thinking>x <b>\u5d4c\u5957</b> y</thinking>B']), { text: 'AB', thinking: 'x <b>\u5d4c\u5957</b> y' }, '\u5d4c\u5957\u6807\u7b7e\u7559\u5728 thinking');
// Multiple paragraphs of thinking alternate
assert.deepStrictEqual(run(['<thinking>\u4e00</thinking>\u6b63<thinking>\u4e8c</thinking>\u6587']), { text: '\u6b63\u6587', thinking: '\u4e00\u4e8c' }, '\u591a\u6bb5\u4ea4\u66ff');
// Reappear in thinking <thinking> literal: no re-entry, enter thinking as it is
assert.deepStrictEqual(run(['<thinking>\u5916<thinking>\u5185</thinking>\u540e']), { text: '\u540e', thinking: '\u5916<thinking>\u5185' }, '\u4e0d\u91cd\u5165');
// ── <think> variants (DeepSeek/MiniMax/GLM/Qwen/MiMo series) have the same rules as <thinking> ──
assert.deepStrictEqual(run(['\u524d<think>\u601d\u8003</think>\u540e']), { text: '\u524d\u540e', thinking: '\u601d\u8003' }, '<think> \u5355 chunk \u62bd\u53d6');
assert.deepStrictEqual(run(['a<thi', 'nk>\u5185', '\u90e8</th', 'ink>b']), { text: 'ab', thinking: '\u5185\u90e8' }, '<think> \u8de8 chunk \u5288\u5f00\u6807\u7b7e');
assert.deepStrictEqual(run(['a<think>\u6ca1\u95ed\u5408\u7684\u601d\u8003']), { text: 'a', thinking: '\u6ca1\u95ed\u5408\u7684\u601d\u8003' }, '<think> \u672a\u95ed\u5408\u5f52 thinking');
// Two tags in the same stream alternate without crosstalk.
assert.deepStrictEqual(run(['<think>\u4e00</think>\u6b63<thinking>\u4e8c</thinking>\u6587']), { text: '\u6b63\u6587', thinking: '\u4e00\u4e8c' }, '\u4e24\u79cd\u6807\u7b7e\u4ea4\u66ff');
// The closing tag is paired with the opening tag: the </thinking> literal within the <think> block does not close the block
assert.deepStrictEqual(run(['<think>a</thinking>b</think>c']), { text: 'c', thinking: 'a</thinking>b' }, '\u95ed\u6807\u7b7e\u6309\u5f00\u6807\u7b7e\u914d\u5bf9');

console.log('agent-settings.verify: ok (\u9ed8\u8ba4\u503c/roundtrip/\u6ce8\u5165\u5206\u652f/\u62bd\u53d6\u72b6\u6001\u673a)');
