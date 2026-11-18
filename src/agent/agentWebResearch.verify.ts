// Verifies the agent can research trending styles on the web.
//
// Two independent gaps were fixed here, and both would silently regress:
//
// 1. CAPABILITY. `web` was computed as `has("FIRECRAWL_API_KEY")` only. Parallel
//    Search MCP is anonymous (no key), so setting WEB_SEARCH_PROVIDER=parallel
//    left `web:false` — the agent was told web was unavailable and either
//    refused to search or burned a turn discovering "not configured", while a
//    working provider sat enabled.
//
// 2. ROUTING. The web group was declared last and only matched words like
//    "search"/"web". "find trending editing styles" matched the EDIT group
//    instead (the word "editing" is an edit verb), so the research question fell
//    outside the 4-group budget and the model answered from training data.
import assert from 'node:assert/strict';
import { routedToolNames, hasMutationRoutingIntent } from './tool-routing';

const WEB_TOOLS = ['web_search', 'web_browser'];

function has(prompt: string, tool: string): boolean {
  return routedToolNames(prompt.toLowerCase(), false).has(tool);
}

// ── 1. Trend-research phrasing reaches web_search ──────────────────────────
// The headline case from the request: even though "editing" also matches the
// edit group, research intent must win a slot.
const RESEARCH_REQUESTS: [lang: string, prompt: string][] = [
  ['en', 'find trending editing styles for short form'],
  ['en', 'what editing style is popular right now'],
  ['en', 'look up viral tiktok edit styles'],
  ['en', 'research the latest reel trends'],
  ['zh', '找一些抖音上流行的剪辑风格'],
  ['zh', '现在流行什么剪辑风格'],
  ['ja', 'トレンドの編集スタイルを調べて'],
  ['ko', '요즘 인기 있는 편집 스타일 찾아봐'],
  ['ru', 'найди тренды монтажа'],
  ['es', 'buscar tendencias de edición'],
  ['fr', 'chercher les tendances de montage'],
  ['de', 'aktuelle schnitt trends suchen'],
  ['pt', 'pesquisar tendências de edição'],
  ['it', 'cercare tendenze di montaggio'],
];
for (const [lang, prompt] of RESEARCH_REQUESTS) {
  for (const tool of WEB_TOOLS) {
    assert.ok(has(prompt, tool),
      `[${lang}] "${prompt}" must expose ${tool}`);
  }
}

// ── 2. A plain edit request must NOT drag in web tools ─────────────────────
// The priority boost is conditional on research wording; without that guard
// every edit would spend a slot on the web group.
for (const prompt of [
  'trim the clip and split it',
  'move this clip to the start',
  'add a title to the first clip',
]) {
  assert.ok(!has(prompt, 'web_search'), `"${prompt}" must not route web_search`);
  assert.ok(has(prompt, 'edit_item'), `"${prompt}" must still route edit tools`);
}

// ── 3. A passing mention of "web" must not reorder everything ──────────────
// "recent" was briefly a web keyword and hijacked "make the recent clips
// shorter". It is gone; this guards the general shape of that mistake.
assert.ok(!has('make the recent clips shorter', 'web_search'),
  'a vague foregrounding word must not be a research trigger');

// ── 4. Research phrasing is not mistaken for a mutation ────────────────────
// Plan mode is read-only: if "find trending editing styles" counts as a
// mutation, the read-only filter drops it and planning cannot research.
assert.equal(hasMutationRoutingIntent('find trending editing styles for short form'), false,
  'research intent must not be classified as an edit');

console.log('agentWebResearch.verify: research phrasings route web_search in 9 languages without hijacking edits');
