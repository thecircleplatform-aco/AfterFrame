import { MAX_AGENT_RUNS, MAX_EVENTS_PER_RUN } from '../../src/persist/agentRuntimeRetention';
import type { AgentRunContext } from '../../src/persist/agentRuntimeStore';

export const MAX_ACTIVE_SERVER_RUNS = MAX_AGENT_RUNS;
export const MAX_SERVER_RUN_EVENTS = MAX_EVENTS_PER_RUN;
export const MAX_SERVER_EVENT_BYTES = 64 * 1024;
export const MAX_SERVER_TOOL_REQUEST_EVENT_BYTES = 512 * 1024;
export const MAX_SERVER_RUN_BYTES = 1024 * 1024;

/**
 * How long the server waits for a browser to CLAIM a tool request.
 *
 * Distinct from SERVER_RUN_AI_TIMEOUT.toolMs: that is the AI SDK's per-step
 * deadline (deliberately generous, it bounds a whole provider step). This one
 * bounds the gap before anything picks the request up at all.
 *
 * A tool request is answered by the open editor tab. If that tab is gone
 * (reloaded, crashed, navigated away) nothing will ever claim the request, and
 * the run would sit in `running` with the UI spinning on "Cross cutting… 328.5s"
 * while blocking the composer and holding a run slot. The claim window only
 * needs to cover "the editor is alive and will answer shortly", so it is short:
 * editor mutations are milliseconds. Observed live: a run frozen at sequence 4
 * for 200s+ with a tool_requested event no client ever claimed.
 */
export const SERVER_TOOL_CLAIM_TIMEOUT_MS = 90_000;

/**
 * After a browser HAS claimed a request it may legitimately run long (a render,
 * a transcription), so this bound is generous — but still finite, so a
 * claimed-then-abandoned tool cannot pin the run forever.
 */
export const SERVER_TOOL_RESULT_TIMEOUT_MS = 24 * 60 * 60_000;

export type ServerRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting-confirmation'
  | 'awaiting-user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ServerRunEvent {
  id: number;
  type: string;
  data: unknown;
  at: number;
}

export interface ServerToolRequest {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argsDigest: string;
  status: 'pending' | 'settled' | 'cancelled';
  claimId?: string;
  claimedAt?: number;
  outcomeDigest?: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

export interface ServerRunMetrics {
  requests: number;
  inputTokens: number;
  freshInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface ServerRun {
  id: string;
  projectId: string;
  sessionGeneration: string;
  capabilityVerifier: string;
  requestShapeHash?: string;
  backend: string;
  provider: string;
  model: string;
  askOnly: boolean;
  references: readonly unknown[];
  externalSessionId?: string;
  context?: unknown;
  status: ServerRunStatus;
  createdAt: number;
  events: ServerRunEvent[];
  error: string | null;
  persistenceError?: string;
  retainedEventBytes: number;
  replayStart: number;
  subscriberCount: number;
  abort?: AbortController;
  waiters: Set<() => void>;
  eventCursor: number;
  pendingEventBytes: number;
  pendingEventCount: number;
  runtimeContext: AgentRunContext;
  terminalPromise?: Promise<void>;
  metrics?: ServerRunMetrics;
  toolRequests: Map<string, ServerToolRequest>;
}

export type ToolClaimOutcome =
  | 'claimed'
  | 'duplicate'
  | 'already-claimed'
  | 'unknown-call'
  | 'mismatch'
  | 'run-settled';

export type ToolResultOutcome =
  | 'accepted'
  | 'duplicate'
  | 'unknown-call'
  | 'unclaimed'
  | 'mismatch'
  | 'run-settled';

export class RunStoreLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStoreLimitError';
  }
}
