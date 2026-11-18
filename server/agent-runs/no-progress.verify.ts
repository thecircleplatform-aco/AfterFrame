// Regression: a model that reasons without acting must not spin forever.
//
// The bug this pins ("why are u stuck?"): the executor's model loop has no turn
// cap — deliberately, so multi-step edits can take as many turns as they need.
// That is only safe if every turn makes observable progress. A turn that emits
// no tool call and no text (reasoning only) does neither, so the loop re-asks an
// identical question and the model reproduces the same "Let me check state."
// reasoning indefinitely. Observed live: 328s+ on a spinner with an unchanged
// transcript, and a fresh billed request per iteration.
import assert from 'node:assert/strict';
import {
  MAX_NO_PROGRESS_TURNS,
  isNoProgressTurn,
  trackNoProgress,
} from './acceptance-loop.ts';

// --- classification ------------------------------------------------------

assert.equal(
  isNoProgressTurn('', 0),
  true,
  'reasoning-only text with no tool calls is a no-progress turn',
);
assert.equal(
  isNoProgressTurn('   \n\t ', 0),
  true,
  'whitespace-only text is no progress, not an answer',
);
assert.equal(
  isNoProgressTurn('Let me check state.', 0),
  false,
  'visible text is progress even without a tool call — the user can read it',
);
assert.equal(
  isNoProgressTurn('', 1),
  false,
  'a tool call is progress',
);

// --- guard arithmetic ----------------------------------------------------

const fresh = { consecutive: 0 };

// One empty turn is tolerable: providers intermittently return an empty delta,
// and stopping on the first one would be a worse bug than the stall.
const first = trackNoProgress(fresh, '', 0);
assert.equal(first.stalled, false, 'a single empty turn must not stop the run');
assert.equal(first.state.consecutive, 1);

const second = trackNoProgress(first.state, '', 0);
assert.equal(
  second.stalled,
  true,
  'consecutive empty turns must stop the run instead of looping forever',
);
assert.equal(second.state.consecutive, MAX_NO_PROGRESS_TURNS);

// Progress resets the counter, so a long run that hits one empty turn partway
// through is not penalised for it.
const afterProgress = trackNoProgress(second.state, 'Done — trimmed the intro.', 0);
assert.equal(afterProgress.stalled, false);
assert.equal(afterProgress.state.consecutive, 0, 'any progress must reset the streak');

const afterTool = trackNoProgress(first.state, '', 3);
assert.equal(afterTool.stalled, false);
assert.equal(afterTool.state.consecutive, 0, 'a tool call must reset the streak');

// A long read-only investigation is progress, not a stall.
let investigating = { consecutive: 0 };
for (let i = 0; i < 20; i += 1) {
  const step = trackNoProgress(investigating, `Checking track ${i}...`, 0);
  assert.equal(step.stalled, false, 'read-only narration must never trip the guard');
  investigating = step.state;
}

console.log('no-progress guard: reasoning-only turns stop the loop instead of spinning');
