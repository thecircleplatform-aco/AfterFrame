// Confirms propose_plan is reachable by the model end to end:
// schema emitted → dispatch resolver registered → executor returns markup.
import assert from 'node:assert/strict';
import { TOOL_SCHEMAS, executeTool } from './tools.ts';
import { ASK_MODE_TOOL_SCHEMAS } from './ask-mode-tools.ts';

const schema = TOOL_SCHEMAS.find((tool) => tool.name === 'propose_plan');
assert.ok(schema, 'propose_plan must be in TOOL_SCHEMAS or the model never sees it');
assert.deepEqual(schema.input_schema.required, ['steps']);

// Plan mode is sent with `askOnly: true`, so it uses ASK_MODE_TOOL_SCHEMAS.
// Leaving propose_plan out of it is silent: the model searches, finds nothing,
// and answers in prose. Asserted here because that failure is invisible in tests
// that only check the tool's own executor.
const askSchema = ASK_MODE_TOOL_SCHEMAS.find((tool) => tool.name === 'propose_plan');
assert.ok(askSchema, 'propose_plan must be in ASK_MODE_TOOL_SCHEMAS or Plan mode can never emit a card');
// The read-only guarantee still holds: nothing that mutates may slip in.
const mutations = ASK_MODE_TOOL_SCHEMAS.filter((tool) => /^(edit_|add_|delete_|trim_|move_|set_|split_|merge_|apply_)/.test(tool.name));
assert.equal(mutations.length, 0, `ask/plan catalog must stay read-only, found: ${mutations.map((m) => m.name).join(', ')}`);

// Through the real dispatch path, not the executor directly: a missing entry in
// EXECUTOR_BY_NAME would fall through to core-tools and fail only at runtime.
const result = await executeTool(
  'propose_plan',
  { steps: [{ title: 'Trim the intro', detail: 'until frame 120' }], title: 'Tighten the cut' },
  {} as never,
) as { __followup?: string; error?: string };

assert.ok(!result.error, `unexpected error: ${String(result.error)}`);
assert.ok(result.__followup?.includes('<plan title="Tighten the cut">'), 'returns the <plan> block');
assert.ok(result.__followup?.includes('Trim the intro'), 'step survives');
assert.ok(result.__followup?.includes('until frame 120'), 'detail survives');

// A no-op call must report an error rather than emitting an empty card.
const empty = await executeTool('propose_plan', { steps: [] }, {} as never) as { error?: string };
assert.ok(empty.error, 'empty steps is an error');

console.log('planToolWiring.verify: ok');
