import { useCallback, useRef } from 'react';
import { replayActions } from '../editor/store';
import type { ProjectDoc } from '../editor/types';
import {
  clearProposal,
  markProposalApplying,
  settleProposal,
  type ProposalSettlementOutcome,
} from '../persist/proposalStore';
import { saveAutomaticVersion } from '../persist/versionStore';
import { saveProject } from '../persist/projectStore';
import { appendAgentChange, createAgentChangeSession } from './changeLog';
import { isProposalStale, type Proposal } from './proposal';
import { appendRejectedProposal } from './agent-session';
import { recordProposalOutcome } from './useAgentPersistence';
import type { AgentSend } from './useAgentRun';
import type { AgentHookState } from './useAgentState';
import {
  clearStoredServerRun,
} from './serverRunSessionStorage';
import { settleServerRun } from './serverRunSettleClient';
import { commitProposalDocument } from './proposal-commit';

export interface ProposalPersistence {
  readonly saveVersion: typeof saveAutomaticVersion;
  readonly saveDoc: typeof saveProject;
  readonly markApplying: typeof markProposalApplying;
  readonly settle: typeof settleProposal;
  readonly clear: typeof clearProposal;
}

const DEFAULT_PROPOSAL_PERSISTENCE: ProposalPersistence = {
  saveVersion: saveAutomaticVersion,
  saveDoc: saveProject,
  markApplying: markProposalApplying,
  settle: settleProposal,
  clear: clearProposal,
};

const OUTCOME_STATUS: Record<ProposalSettlementOutcome, {
  runtime: 'applied' | 'rejected' | 'stale' | 'reproposed';
  final: 'completed' | 'aborted' | 'waiting_approval';
  summary: string;
}> = {
  applied: { runtime: 'applied', final: 'completed', summary: 'proposal applied' },
  rejected: { runtime: 'rejected', final: 'aborted', summary: 'proposal rejected' },
  stale: { runtime: 'stale', final: 'aborted', summary: 'proposal became stale' },
  reproposed: { runtime: 'reproposed', final: 'aborted', summary: 'proposal replaced' },
};

function showProposalError(state: AgentHookState, text: string): void {
  state.setMessages((current) => [...current, { role: 'error', text }]);
}

async function settleAndRecord(
  projectId: string,
  proposal: Proposal,
  outcome: ProposalSettlementOutcome,
  persistence: ProposalPersistence,
): Promise<void> {
  await persistence.settle(projectId, proposal, outcome);
  const status = OUTCOME_STATUS[outcome];
  await recordProposalOutcome(projectId, proposal, status.runtime, status.final, status.summary);
}

function commitAppliedUi(
  state: AgentHookState,
  proposal: Proposal,
  chosen: Proposal['options'][number]['operations'],
  currentDoc: ProjectDoc,
  result: ProjectDoc,
): void {
  state.ctxRef.current.commands.applyDoc(result);
  const session = createAgentChangeSession(proposal.summary, chosen, currentDoc, result);
  state.setChangeLog((current) => appendAgentChange(current, session));
  state.llmRef.current.push({
    role: 'user',
    content: `(Applied proposal: ${chosen.length}/${proposal.options[0].operations.length} operations.)`,
  });
  state.refreshEstimatedContextUsage();
  state.setProposalStale(false);
  state.setProposal(null);
}

async function cleanupAppliedProposal(
  proposal: Proposal,
  operationCount: number,
  projectId: string,
  persistence: ProposalPersistence,
): Promise<string | null> {
  try {
    if (proposal.agentRunId && proposal.id) {
      await settleServerRun(projectId, proposal.agentRunId, {
        status: 'completed',
        proposalId: proposal.id,
        proposalRuntimeStatus: 'applied',
        summary: `applied ${operationCount} operations`,
      });
      clearStoredServerRun(projectId, proposal.agentRunId);
    }
  } catch {
    return 'Proposal applied, but the run record has not completed; recovery will continue when the project is reopened.';
  }
  try {
    await persistence.clear(projectId, proposal.id);
    return null;
  } catch {
    return 'Proposal applied, but recovery record not yet cleaned; marked as non-replayable.';
  }
}
class CommittedProposalRecoveryError extends Error {}

async function persistSelectedProposal(
  state: AgentHookState,
  projectId: string,
  proposal: Proposal,
  currentDoc: ProjectDoc,
  result: ProjectDoc,
  operationCount: number,
  persistence: ProposalPersistence,
): Promise<boolean> {
  const committed = await commitProposalDocument({
    projectId, before: currentDoc, result, versionLabel: 'Before Agent modification',
  }, {
    saveVersion: persistence.saveVersion,
    saveDoc: persistence.saveDoc,
    getDoc: () => state.ctxRef.current.getDoc(),
    isCurrent: () => state.proposalRef.current === proposal && state.ctxRef.current.getDoc() === currentDoc,
    stage: () => persistence.markApplying(projectId, proposal, result, operationCount),
  });
  if (committed.status === 'stale') {
    await settleAndRecord(projectId, proposal, 'stale', persistence);
    state.setProposalStale(true);
    return false;
  }
  if (committed.status !== 'saved') throw new Error('project save or concurrent edit recovery failed');
  try {
    await persistence.settle(projectId, proposal, 'applied');
  } catch {
    throw new CommittedProposalRecoveryError();
  }
  return true;
}


export async function applySelectedProposal(
  state: AgentHookState,
  projectId: string,
  selected: Set<number>,
  persistence: ProposalPersistence = DEFAULT_PROPOSAL_PERSISTENCE,
): Promise<void> {
  const proposal = state.proposalRef.current;
  if (!proposal || state.applyingProposalRef.current) return;
  state.applyingProposalRef.current = true;
  const currentDoc = state.ctxRef.current.getDoc();
  const chosen = proposal.options[0].operations.filter((_, index) => selected.has(index));
  let result: ProjectDoc;
  try {
    // Inside the try: replaying a SUBSET (the user unchecked a prerequisite
    // operation) is the one step that can throw before any await, and doing it
    // outside left applyingProposalRef stuck true — every later apply in the
    // session would then silently no-op.
    result = replayActions(currentDoc, chosen.flatMap((operation) => operation.actions));
  } catch {
    state.applyingProposalRef.current = false;
    showProposalError(state, 'Selected action cannot be applied (a prerequisite step may have been unchecked); the proposal did not modify the project.');
    return;
  }
  try {
    const persisted = await persistSelectedProposal(
      state, projectId, proposal, currentDoc, result, chosen.length, persistence,
    );
    if (!persisted) return;
    commitAppliedUi(state, proposal, chosen, currentDoc, result);
    const warning = await cleanupAppliedProposal(
      proposal, chosen.length, projectId, persistence,
    );
    if (warning) showProposalError(state, warning);
  } catch (error) {
    if (error instanceof CommittedProposalRecoveryError) {
      commitAppliedUi(state, proposal, chosen, currentDoc, result);
      showProposalError(state, 'Proposal saved to the project, but the recovery record has not completed; reopen the project to confirm.');
    } else {
      showProposalError(state, 'Could not acquire proposal run permission, save project, or create a pre-edit version; proposal was not applied. Please retry.');
    }
  } finally {
    state.applyingProposalRef.current = false;
  }
}

function applyUnlessStale(
  state: AgentHookState,
  projectId: string,
  selected: Set<number>,
): void {
  const proposal = state.proposalRef.current;
  if (!proposal) return;
  if (isProposalStale(proposal, state.ctxRef.current.getDoc())) {
    state.setProposalStale(true);
    void settleAndRecord(projectId, proposal, 'stale', DEFAULT_PROPOSAL_PERSISTENCE)
      .catch(() => showProposalError(state, 'Could not persist expired proposal state; the proposal will not be applied.'));
    return;
  }
  void applySelectedProposal(state, projectId, selected);
}

async function replaceStaleProposal(
  state: AgentHookState,
  projectId: string,
  send: AgentSend,
): Promise<void> {
  const previous = state.proposalRef.current;
  if (!previous) return;
  try {
    await settleAndRecord(projectId, previous, 'reproposed', DEFAULT_PROPOSAL_PERSISTENCE);
    await DEFAULT_PROPOSAL_PERSISTENCE.clear(projectId, previous.id);
  } catch {
    showProposalError(state, 'Unable to persist proposal replacement state; please retry.');
    return;
  }
  state.setProposalStale(false);
  state.setProposal(null);
  state.proposalRef.current = null;
  await send('(Project changed after the previous proposal was generated. Based on current <editor_state>, re-propose an equivalent change to the previous proposal.)');
}

export async function rejectPendingProposal(
  state: AgentHookState,
  projectId: string,
  persistence: ProposalPersistence = DEFAULT_PROPOSAL_PERSISTENCE,
): Promise<void> {
  const previous = state.proposalRef.current;
  if (!previous) return;
  try {
    await persistence.settle(projectId, previous, 'rejected');
  } catch {
    showProposalError(state, 'Could not persist proposal rejection state; proposal was not rejected. Please retry.');
    return;
  }
  let warning: string | null = null;
  try {
    const status = OUTCOME_STATUS.rejected;
    await recordProposalOutcome(projectId, previous, status.runtime, status.final, status.summary);
    await persistence.clear(projectId, previous.id);
  } catch {
    warning = 'Proposal rejected, but the run record has not completed; cleanup will continue when the project is reopened.';
  }
  state.setProposalStale(false);
  state.llmRef.current = appendRejectedProposal(state.llmRef.current);
  state.refreshEstimatedContextUsage();
  state.setProposal(null);
  if (warning) showProposalError(state, warning);
}

export function useAgentProposalActions(
  state: AgentHookState,
  projectId: string,
  send: AgentSend,
) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const applyProposal = useCallback((selected: Set<number>) => {
    applyUnlessStale(stateRef.current, projectId, selected);
  }, [projectId]);
  const forceApplyProposal = useCallback((selected: Set<number>) => {
    void applySelectedProposal(stateRef.current, projectId, selected);
  }, [projectId]);
  const reProposeStale = useCallback(() => {
    void replaceStaleProposal(stateRef.current, projectId, send);
  }, [projectId, send]);
  const rejectProposal = useCallback(() => {
    void rejectPendingProposal(stateRef.current, projectId);
  }, [projectId]);
  return { applyProposal, forceApplyProposal, reProposeStale, rejectProposal };
}
