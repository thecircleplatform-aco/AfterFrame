// Verifies the agent can actually SEE.
//
// The bug this guards against: `view_timeline_frames` / `view_asset_frames` were
// registered, policy-approved, and working — but they were NOT boot tools, so
// they only reached the model when the user's wording happened to match a
// routing keyword ("scene", "beat", "color"). Ask "the intro looks ugly, can you
// check it?" and the model received no frame tool at all and answered from clip
// names. The system prompt simultaneously *requires* visual verification, so it
// was instructing the model to do something the toolset did not allow.
//
// Two invariants are asserted:
//   1. The vision tools are active on EVERY turn, regardless of wording.
//   2. The "look at it" phrasings also route them (belt and braces, and it keeps
//      the neighbouring visual tools like inspect_color in reach).
import assert from 'node:assert/strict';
import { ToolActivation } from './tool-activation';
import { TOOL_SCHEMAS } from './tools';
import { ASK_MODE_TOOL_SCHEMAS } from './ask-mode-tools';

const VISION_TOOLS = ['view_timeline_frames', 'view_asset_frames'];

function activeNamesFor(text: string): readonly string[] {
  const activation = new ToolActivation(TOOL_SCHEMAS, [{ role: 'user', content: text }]);
  return activation.names();
}

// ── 1. Always available, even with no visual keyword at all ─────────────────
// This is the core regression: a neutral request used to carry zero frame tools.
for (const request of ['make it better somehow', 'tighten the pacing a bit', '']) {
  const active = activeNamesFor(request);
  for (const tool of VISION_TOOLS) {
    assert.ok(active.includes(tool),
      `"${tool}" must be active for "${request || '(empty)'}" — the agent cannot verify its own work without it`);
  }
}

// ── 2. "Look at it" phrasings route the vision tools ───────────────────────
const LOOK_REQUESTS = [
  'the intro looks ugly, can you check it?',
  'can you see what is wrong with the first frame?',
  'show me the preview at 10 seconds',
  'something is broken and overlapping',
  'the text is cut off at the edge',
  'why is the screen black',
];
for (const request of LOOK_REQUESTS) {
  const active = activeNamesFor(request);
  assert.ok(active.includes('view_timeline_frames'),
    `"${request}" must surface view_timeline_frames`);
}

// ── 3. Plan/Ask mode can look too (read-only tools are eligible) ────────────
const askNames = ASK_MODE_TOOL_SCHEMAS.map((schema) => schema.name);
for (const tool of VISION_TOOLS) {
  assert.ok(askNames.includes(tool),
    `"${tool}" must survive the read-only filter so Plan mode can inspect frames`);
}

// ── 4. Nothing mutating leaked into Ask mode as a side effect ──────────────
for (const name of askNames) {
  assert.ok(!/^(edit_|add_|delete_|trim_|move_|set_|split_|merge_|apply_|remove_)/.test(name),
    `Ask mode must stay read-only, but "${name}" looks mutating`);
}

console.log('agentVision.verify: vision tools are always available and look-requests route them');
