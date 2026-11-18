import type { ModelMessage } from 'ai';
import type { ToolEffect } from '../../src/agent/execution-policy';
import {
  normalizeAcceptanceIterations,
} from '../../src/agent/settings/agentSettings';

export interface AcceptanceLoopState {
  readonly enabled: boolean;
  readonly maxIterations: number;
  readonly phase: 'working' | 'checking';
  readonly iteration: number;
  readonly mutated: boolean;
  readonly verifiedAfterMutation: boolean;
}

export type AcceptanceDecision =
  | { readonly action: 'finish'; readonly state: AcceptanceLoopState; readonly status?: 'passed' }
  | { readonly action: 'continue'; readonly state: AcceptanceLoopState; readonly message: ModelMessage }
  | { readonly action: 'fail'; readonly state: AcceptanceLoopState; readonly reason: string };

export function createAcceptanceLoop(enabled: boolean, maxIterations: number): AcceptanceLoopState {
  return {
    enabled,
    maxIterations: normalizeAcceptanceIterations(maxIterations),
    phase: 'working',
    iteration: 0,
    mutated: false,
    verifiedAfterMutation: false,
  };
}

export function recordAcceptedTool(
  state: AcceptanceLoopState,
  effect: ToolEffect,
): AcceptanceLoopState {
  if (!state.enabled) return state;
  if (effect === 'read') {
    return state.phase === 'checking' && state.mutated
      ? { ...state, verifiedAfterMutation: true }
      : state;
  }
  return { ...state, mutated: true, verifiedAfterMutation: false };
}

function acceptanceMessage(iteration: number, maxIterations: number): ModelMessage {
  return {
    role: 'user',
    content: [
      `<autonomous_acceptance iteration="${iteration}" max="${maxIterations}">`,
      'Inspect the latest editor state against the original user request before finishing.',
      'Use read_project, read_timeline, and the relevant inspect/probe/progress tools to verify actual results after the last edit.',
      'Fix any issue you find, then verify again. Ask the user only when a required fact cannot be inferred.',
      'When the result passes, give one concise final summary with the checks performed.',
      '</autonomous_acceptance>',
    ].join('\n'),
  } as ModelMessage;
}

export function decideAcceptanceAfterTurn(state: AcceptanceLoopState): AcceptanceDecision {
  if (!state.enabled || !state.mutated) return { action: 'finish', state };
  if (state.phase === 'checking' && state.verifiedAfterMutation) {
    return { action: 'finish', state, status: 'passed' };
  }
  if (state.iteration >= state.maxIterations) {
    return {
      action: 'fail',
      state,
      reason: `Autonomous acceptance did not verify the latest edit within ${state.maxIterations} iterations.`,
    };
  }
  const next = {
    ...state,
    phase: 'checking' as const,
    iteration: state.iteration + 1,
  };
  return {
    action: 'continue',
    state: next,
    message: acceptanceMessage(next.iteration, next.maxIterations),
  };
}

export function acceptanceInstructions(enabled: boolean): string {
  return enabled
    ? '\n\n# Autonomous acceptance\n- The runtime will request a settled verification pass after edits. Treat it as the same task.\n- Do not ask for confirmation unless a required fact is missing. Verify the latest state with tools after the final edit before reporting completion.'
    : '';
}

export type TurnDisposition = 'continue' | 'completed' | 'max-tokens';
/**
 * A turn that ends without tool calls is complete even when a tool failed earlier in
 * the run. The model saw the failed result in its own context and replied to it, so
 * its reply — in the interface language — is the outcome; the failed call stays
 * visible on its own tool card. This used to return 'failed' and the executor then
 * threw the tracker's English "I couldn't complete the requested operation" template
 * underneath the model's reply, which is exactly what the browser runtimes stopped
 * doing (66af696b). It also broke every documented fallback: probe_media failing and
 * finalize_uploaded_asset proceeding with ingest defaults could never complete, since
 * only a successful retry of the same tool resolves a failure.
 */
export function turnDisposition(hitMaxTokens: boolean, continued: boolean): TurnDisposition {
  if (hitMaxTokens) return 'max-tokens';
  return continued ? 'continue' : 'completed';
}

/**
 * Detect a turn that produced NOTHING actionable: no tool calls and no visible
 * text, only reasoning.
 *
 * This is the "why are you stuck?" loop. The executor has no turn cap ("the
 * model decides when the task is done"), which is correct for multi-step edits
 * but assumes every turn either calls a tool or answers. A model that reasons
 * "Let me check state." and then emits no tool call and no text satisfies
 * neither: `continued` is false (no tool calls) and `outcome.text` is empty, so
 * the loop keeps re-asking the same question with the reasoning appended.
 * The run sits on a spinner for minutes while the visible transcript never
 * changes, and each iteration costs a full request.
 *
 * A single empty turn is legitimate (providers occasionally return an empty
 * delta), so this only trips on a run of them.
 */
export function isNoProgressTurn(text: string, toolCallCount: number): boolean {
  return toolCallCount === 0 && text.trim().length === 0;
}

/** Consecutive no-progress turns tolerated before the run is stopped. */
export const MAX_NO_PROGRESS_TURNS = 2;

export interface NoProgressGuardState {
  readonly consecutive: number;
}

export function trackNoProgress(
  state: NoProgressGuardState,
  text: string,
  toolCallCount: number,
): { state: NoProgressGuardState; stalled: boolean } {
  if (!isNoProgressTurn(text, toolCallCount)) {
    return { state: { consecutive: 0 }, stalled: false };
  }
  const consecutive = state.consecutive + 1;
  return {
    state: { consecutive },
    stalled: consecutive >= MAX_NO_PROGRESS_TURNS,
  };
}
