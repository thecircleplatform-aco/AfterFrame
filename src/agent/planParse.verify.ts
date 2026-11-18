// Verifies the plan round-trip: tool → <plan> markup → UI card → execution message.
//
// This is the contract that makes plan mode actionable. If the tool's serializer
// and the UI's parser disagree, the user sees either nothing or a run that does
// not match the card they approved — so both directions are asserted here.
import assert from 'node:assert/strict';
import { buildPlanBlock, execPlanTool } from './tools/plan-tools.ts';
import {
  hasPlan, MAX_PLAN_STEPS, parsePlans, planExecutionMessage, reindexPlanSteps, type PlanStep,
} from '../components/chat/plan-parse.ts';

const ctx = {} as never;

// ---- tool output shape ----
const block = buildPlanBlock([
  { title: 'Trim the intro', detail: 'until frame 120' },
  { title: 'Add captions' },
]);
assert.ok(block.startsWith('<plan'), 'plan block opens with <plan');
assert.ok(block.includes('<plan-step title="Trim the intro" detail="until frame 120"/>'));
assert.ok(block.includes('<plan-step title="Add captions"/>'), 'detail is optional');

// Escaping: quotes/angle brackets in a title must not break the tags.
const hostile = buildPlanBlock([{ title: 'Use "a < b" & done' }]);
assert.ok(hostile.includes('&quot;') && hostile.includes('&lt;') && hostile.includes('&amp;'), 'attributes are escaped');

// Empty titles are dropped rather than producing an empty step.
assert.equal(buildPlanBlock([{ title: '   ' }]), '', 'blank titles drop the whole block');

// ---- executor contract ----
const ok = execPlanTool('propose_plan', { steps: [{ title: 'One' }], title: 'Cut tighter' }, ctx) as { __followup?: string };
assert.ok(ok.__followup?.includes('<plan title="Cut tighter">'), 'title attr survives');
const empty = execPlanTool('propose_plan', { steps: [] }, ctx) as { error?: string };
assert.ok(empty.error, 'empty steps is an error, not an empty card');
const unknown = execPlanTool('not_a_tool', {}, ctx) as { error?: string };
assert.ok(unknown.error, 'unknown tool rejected');

// ---- parser round-trip ----
const parsed = parsePlans(block);
const planSeg = parsed.find((seg) => seg.type === 'plan');
assert.ok(planSeg && planSeg.type === 'plan', 'block parses back into a plan segment');
assert.equal(planSeg.steps.length, 2);
assert.equal(planSeg.steps[0]!.title, 'Trim the intro');
assert.equal(planSeg.steps[0]!.detail, 'until frame 120');
assert.equal(planSeg.steps[1]!.title, 'Add captions');
assert.equal(planSeg.steps[1]!.detail, undefined);

// Entities decode back to the original text.
const hostileRoundTrip = parsePlans(hostile)[0];
assert.ok(hostileRoundTrip?.type === 'plan');
assert.equal(hostileRoundTrip.steps[0]!.title, 'Use "a < b" & done');

// Bare (non-self-closing) steps are what models emit about half the time.
const bare = parsePlans('<plan><plan-step>Trim the intro — until frame 120</plan-step><plan-step>Add captions</plan-step></plan>');
const barePlan = bare.find((seg) => seg.type === 'plan');
assert.ok(barePlan?.type === 'plan', 'bare step form parses');
assert.equal(barePlan.steps[0]!.title, 'Trim the intro');
assert.equal(barePlan.steps[0]!.detail, 'until frame 120');
assert.equal(barePlan.steps[1]!.title, 'Add captions');

// Text around the block is preserved; stray markup never leaks to the user.
const mixed = parsePlans('Here is the plan.\n\n<plan><plan-step>One</plan-step></plan>\n\nTakes about 2 minutes.');
assert.equal(mixed[0]?.type, 'text');
assert.ok(mixed[0]?.type === 'text' && mixed[0].text.includes('Here is the plan'));
const tail = mixed[mixed.length - 1];
assert.ok(tail?.type === 'text' && tail.text.includes('Takes about 2 minutes'));
assert.ok(!mixed.some((seg) => seg.type === 'text' && seg.text.includes('<plan')), 'no raw markup leaks');

// A truncated block (stream cut off mid-plan) must not explode.
assert.doesNotThrow(() => parsePlans('<plan><plan-step title="One"/>'));
assert.equal(hasPlan('<plan><plan-step title="x"/></plan>'), true);
assert.equal(hasPlan('no plan here'), false);
assert.equal(hasPlan(undefined), false);

// Step cap: a runaway model cannot render an unbounded list.
const many = Array.from({ length: MAX_PLAN_STEPS + 10 }, (_, i) => ({ title: `Step ${i}` }));
const capped = parsePlans(buildPlanBlock(many)).find((seg) => seg.type === 'plan');
assert.ok(capped?.type === 'plan' && capped.steps.length <= MAX_PLAN_STEPS, 'step count is capped');

// ---- editing keeps keys unique ----
const edited: PlanStep[] = reindexPlanSteps([
  { id: 'step-0', title: 'A' },
  { id: 'step-9', title: 'B' },
]);
assert.deepEqual(edited.map((step) => step.id), ['step-0', 'step-1'], 'ids are renumbered after a delete');

// ---- execution message ----
const msg = planExecutionMessage([
  { id: 'step-0', title: 'Trim the intro', detail: 'until frame 120' },
  { id: 'step-1', title: 'Add captions' },
]);
assert.ok(msg.includes('1. Trim the intro — until frame 120'));
assert.ok(msg.includes('2. Add captions'));
assert.ok(msg.includes('Do not re-plan'), 'order is pinned so the run cannot drift from the card');

console.log('planParse.verify: ok');
