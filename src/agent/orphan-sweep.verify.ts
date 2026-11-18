// Verifies that an agent run which was recorded but never leased cannot wedge
// the chat forever.
//
// The bug: `startAgentRun` writes `{ status: 'running' }` and ONLY THEN claims a
// lease. If the claim fails — or the tab is closed between the two writes — the
// sidecar keeps an active run with no owner and no lease. Nothing ever settles
// it, so the composer treats the project as permanently busy and refuses new
// messages, while the server keeps an SSE slot for a run nobody owns until the
// subscriber cap is exhausted and every stream 429s.
//
// The sweep takes an explicit `now`, which is what makes these cases testable
// without sleeping or back-dating records (patchAgentRun stamps updatedAt).
import assert from 'node:assert/strict';
import {
  loadAgentRuntimeSidecar,
  patchAgentRun,
  resetAgentRuntimeStoreMemory,
  settleOrphanedAgentRuns,
} from '../persist/agentRuntimeStore';
import { digestAgentToolArgs, startAgentRun } from './runtime-ledger';

resetAgentRuntimeStoreMemory();
const projectId = `orphan-sweep-${crypto.randomUUID()}`;
// A short grace for the test. The production default (5 min) is longer than the
// 120s lease, so "orphan settles" and "live run survives" could never both be
// observed at one sweep time; that is a property of the clock, not the logic.
const GRACE_MS = 30_000;

/** Start a run, then drop its lease to reproduce the orphan shape. */
async function orphan(input: string): Promise<{
  runId: string;
  approval: Awaited<ReturnType<Awaited<ReturnType<typeof startAgentRun>>['recordApprovalRequested']>>;
}> {
  const recorder = await startAgentRun({ projectId, userInput: input, askOnly: false });
  const approval = await recorder.recordApprovalRequested({
    toolCallId: `call-${input}`,
    toolName: 'edit_item',
    argsDigest: await digestAgentToolArgs({ id: input }),
  });
  await patchAgentRun(projectId, recorder.runId, {
    ownerInstanceId: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
  });
  recorder.stopLease();
  return { runId: recorder.runId, approval };
}

const stale = await orphan('stale');
const fresh = await orphan('fresh');
const liveRecorder = await startAgentRun({ projectId, userInput: 'live', askOnly: false });

// The orphan's updatedAt is "now". Sweep just inside the grace window: nothing
// may be touched, because a run whose lease claim is still in flight looks
// exactly like this.
const justInside = Date.now() + GRACE_MS - 1_000;
assert.equal(await settleOrphanedAgentRuns(projectId, justInside, GRACE_MS), 0,
  'an unleased run inside the grace period must be left alone');

// Now sweep past the grace window but still inside the live run's 120s lease.
// That is the only window where "stale orphan settles" and "live run survives"
// can both be observed at once.
const pastGrace = Date.now() + 60_000;
const sweptCount = await settleOrphanedAgentRuns(projectId, pastGrace, GRACE_MS);
assert.equal(sweptCount, 2, 'both unleased runs are stale by now');
void fresh;

const after = await loadAgentRuntimeSidecar(projectId);
const byId = (id: string) => after.runs.find((run) => run.runId === id);

assert.equal(byId(stale.runId)?.status, 'interrupted', 'a stale orphan becomes terminal');
assert.equal(byId(stale.runId)?.ownerInstanceId, undefined, 'the swept run releases ownership');
assert.equal(byId(stale.runId)?.finalSummary, 'Run stopped before it produced a result.',
  'the run carries a reason instead of stalling silently');

// The live run claimed a 120s lease at creation, which has NOT expired by
// pastGrace (only ~5 minutes of simulated time). It must survive untouched.
assert.equal(byId(liveRecorder.runId)?.status, 'running',
  'a run holding an unexpired lease must never be swept');

assert.equal(
  after.approvals.find((item) => item.approvalId === stale.approval.approvalId)?.status,
  'cancelled',
  'a pending approval from a swept run must be cancelled, not left blocking the composer',
);

// Idempotent: nothing left to settle.
assert.equal(await settleOrphanedAgentRuns(projectId, pastGrace, GRACE_MS), 0,
  'a second sweep is a no-op');

// A much later sweep must not resurrect or re-settle anything.
await settleOrphanedAgentRuns(projectId, pastGrace + 30 * 24 * 60 * 60_000, GRACE_MS);
const final = await loadAgentRuntimeSidecar(projectId);
assert.equal(final.runs.find((run) => run.runId === stale.runId)?.status, 'interrupted',
  'terminal runs are never resurrected');

liveRecorder.stopLease();
console.log('orphan-sweep: grace period, lease protection and approval cleanup verified');
