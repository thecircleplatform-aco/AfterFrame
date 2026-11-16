import type { ModelMessage } from 'ai';
import {
  SERVER_RUN_CAPABILITY_HEADER,
  buildServerRunPayload,
} from '../../agent/serverRunProtocol';
import type { AgentSendOptions } from '../../agent/useAgentRun';

/**
 * Client for the standalone agent host.
 *
 * Wire-for-wire identical to the editor's chat panel
 * (src/agent/serverRunSend.ts + serverRunProtocol.ts + serverRunFetchEventStream.ts):
 *
 *   1. POST /api/agent-runs/                 — admit the run (payload IS the run)
 *   2. POST /api/agent-runs/:id/start        — begin the loop
 *   3. GET  /api/agent-runs/:id/events?after — SSE: text/thinking/tool/status
 *   4. POST /api/agent-runs/:id/tool-claim   — claim an emitted tool request
 *   5. POST /api/agent-runs/:id/tool-result  — settle it
 *   6. POST /api/agent-runs/:id/cancel       — stop
 *
 * The payload is produced by the shipped `buildServerRunPayload`, so message
 * projection, tool activation, body budgeting and identity generation are the
 * production implementation, not a re-implementation.
 */

export interface ToolRequestEvent {
  readonly toolCallId: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly argsDigest: string;
}

export type ToolOutcome =
  | { readonly result: unknown }
  | { readonly error: string };

export interface StandaloneAgentConfig {
  readonly projectId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly cacheMode: 'short' | 'long';
  readonly maxOutputTokens: number;
  readonly autonomousAcceptance: boolean;
  readonly maxAcceptanceIterations: number;
  readonly askOnly: boolean;
  readonly openAiApiMode?: string;
  /** Executes tool calls. Without an editor attached the default refuses them. */
  readonly executeTool?: (request: ToolRequestEvent) => Promise<ToolOutcome>;
}

export interface AgentRunCallbacks {
  readonly onStatus?: (status: string) => void;
  readonly onTextStart?: () => void;
  readonly onText?: (delta: string) => void;
  readonly onThinking?: (delta: string) => void;
  readonly onToolRequest?: (request: ToolRequestEvent) => void;
  readonly onToolResult?: (result: {
    toolCallId: string;
    toolName?: string;
    result?: unknown;
    error?: string;
  }) => void;
  readonly onContextUsage?: (usage: unknown) => void;
  readonly onError?: (message: string) => void;
}

const HEADERS = { 'Content-Type': 'application/json' } as const;

function encodeCapability(header: string, capability: string): Record<string, string> {
  return { ...HEADERS, [header]: capability };
}

export async function admitRun(
  payload: ReturnType<typeof buildServerRunPayload>,
): Promise<void> {
  const response = await fetch('/api/agent-runs/', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error
        ? `agent run failed: HTTP ${response.status} (${body.error})`
        : `agent run failed: HTTP ${response.status}`,
    );
  }
  const created = (await response.json()) as { id: string; capability: string };
  if (created.id !== payload.runId || created.capability !== payload.capability) {
    throw new Error('Server run identity did not match the submitted request.');
  }
}

export async function startRun(projectId: string, runId: string, capability: string): Promise<void> {
  const response = await fetch(`/api/agent-runs/${runId}/start`, {
    method: 'POST',
    headers: encodeCapability(SERVER_RUN_CAPABILITY_HEADER, capability),
    body: JSON.stringify({ projectId }),
  });
  if (!response.ok) throw new Error(`server run start failed: HTTP ${response.status}`);
}

export async function cancelRun(projectId: string, runId: string, capability?: string): Promise<void> {
  // Stop must work even without the capability (reload / second tab): the server
  // treats cancellation as a denial and accepts it on the same-origin shape gate.
  const response = await fetch(`/api/agent-runs/${runId}/cancel`, {
    method: 'POST',
    headers: capability
      ? encodeCapability(SERVER_RUN_CAPABILITY_HEADER, capability)
      : HEADERS,
    body: JSON.stringify({ projectId }),
  });
  if (!response.ok) throw new Error(`server run cancel failed: HTTP ${response.status}`);
}

async function claimTool(
  projectId: string,
  runId: string,
  capability: string,
  request: ToolRequestEvent,
  claimId: string,
): Promise<boolean> {
  const response = await fetch(`/api/agent-runs/${runId}/tool-claim`, {
    method: 'POST',
    headers: encodeCapability(SERVER_RUN_CAPABILITY_HEADER, capability),
    body: JSON.stringify({
      projectId,
      toolCallId: request.toolCallId,
      argsDigest: request.argsDigest,
      claimId,
    }),
  }).catch(() => null);
  if (!response || response.status !== 200) return false;
  const body = (await response.json().catch(() => ({}))) as {
    claimed?: boolean;
    outcome?: string;
  };
  return body.claimed === true || body.outcome === 'claimed' || body.outcome === 'duplicate';
}

async function settleTool(
  projectId: string,
  runId: string,
  capability: string,
  request: ToolRequestEvent,
  claimId: string,
  outcome: ToolOutcome,
): Promise<void> {
  const body =
    'error' in outcome
      ? {
          projectId,
          toolCallId: request.toolCallId,
          argsDigest: request.argsDigest,
          claimId,
          error: outcome.error,
        }
      : {
          projectId,
          toolCallId: request.toolCallId,
          argsDigest: request.argsDigest,
          claimId,
          result: outcome.result,
        };
  await fetch(`/api/agent-runs/${runId}/tool-result`, {
    method: 'POST',
    headers: encodeCapability(SERVER_RUN_CAPABILITY_HEADER, capability),
    body: JSON.stringify(body),
  }).catch(() => null);
}

interface SseFrame {
  readonly id: number | null;
  readonly event: string;
  readonly data: unknown;
}

function parseFrame(raw: string): SseFrame | null {
  let id: number | null = null;
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') id = Number(value);
    else if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (!dataLines.length) return null;
  try {
    return { id, event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

function textOf(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as { text?: unknown; delta?: unknown };
  if (typeof record.text === 'string') return record.text;
  return typeof record.delta === 'string' ? record.delta : '';
}

/** Consume the run's SSE stream until `done` / terminal, dispatching events. */
async function streamRun(
  projectId: string,
  runId: string,
  capability: string,
  callbacks: AgentRunCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `/api/agent-runs/${runId}/events?projectId=${encodeURIComponent(projectId)}&after=0`,
    {
      headers: { [SERVER_RUN_CAPABILITY_HEADER]: capability, Accept: 'text/event-stream' },
      signal,
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`server run stream failed: HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = parseFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (frame) {
        dispatch(frame, callbacks);
        if (frame.event === 'done') return;
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function dispatch(frame: SseFrame, callbacks: AgentRunCallbacks): void {
  const data = frame.data as Record<string, unknown> | null;
  switch (frame.event) {
    case 'status':
      if (typeof data?.status === 'string') callbacks.onStatus?.(data.status);
      return;
    case 'text-start':
      callbacks.onTextStart?.();
      return;
    case 'text-delta':
      callbacks.onText?.(textOf(frame.data));
      return;
    case 'thinking-delta':
      callbacks.onThinking?.(textOf(frame.data));
      return;
    case 'tool-request':
      callbacks.onToolRequest?.({
        toolCallId: String(data?.toolCallId ?? ''),
        name: String(data?.name ?? ''),
        args: (data?.args as Record<string, unknown>) ?? {},
        argsDigest: String(data?.argsDigest ?? ''),
      });
      return;
    case 'tool-result':
      callbacks.onToolResult?.({
        toolCallId: String(data?.toolCallId ?? ''),
        toolName: typeof data?.toolName === 'string' ? data.toolName : undefined,
        result: data?.result,
        error: typeof data?.error === 'string' ? data.error : undefined,
      });
      return;
    case 'context-usage':
      callbacks.onContextUsage?.(data?.usage);
      return;
    case 'error':
      callbacks.onError?.(String(data?.message ?? 'Agent provider request failed.'));
      return;
    default:
      return;
  }
}

export interface RunAgentInput {
  readonly config: StandaloneAgentConfig;
  readonly history: readonly ModelMessage[];
  readonly text: string;
  readonly callbacks: AgentRunCallbacks;
  readonly signal: AbortSignal;
}

/**
 * Default tool host: there is no editor attached to a standalone console, so a
 * mutating tool call is answered with a structured, non-retryable failure the
 * model can read and route around. Swap in `executeTool` to run real tools.
 */
async function refuseTool(request: ToolRequestEvent): Promise<ToolOutcome> {
  return {
    error:
      `Tool "${request.name}" needs the AfterFrame editor (timeline/project store) ` +
      'and this standalone console has no editor attached. Answer without it, or ' +
      'run the agent inside the editor.',
  };
}

export async function runAgent(input: RunAgentInput): Promise<string> {
  const { config, history, text, callbacks, signal } = input;
  const payload = buildServerRunPayload(
    config.projectId,
    text,
    { askOnly: config.askOnly } as AgentSendOptions,
    {
      history: [...history] as ModelMessage[],
      provider: config.provider,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      cacheMode: config.cacheMode,
      maxOutputTokens: config.maxOutputTokens,
      autonomousAcceptance: config.autonomousAcceptance,
      maxAcceptanceIterations: config.maxAcceptanceIterations,
      openAiApiMode: config.openAiApiMode,
    },
  );

  let assistantText = '';
  const executeTool = config.executeTool ?? refuseTool;
  const inFlight = new Set<string>();

  const handleToolRequest = async (request: ToolRequestEvent): Promise<void> => {
    if (inFlight.has(request.toolCallId)) return;
    inFlight.add(request.toolCallId);
    callbacks.onToolRequest?.(request);
    const claimId = crypto.randomUUID();
    const claimed = await claimTool(
      config.projectId,
      payload.runId,
      payload.capability,
      request,
      claimId,
    );
    if (!claimed) return;
    let outcome: ToolOutcome;
    try {
      outcome = await executeTool(request);
    } catch (error) {
      outcome = { error: error instanceof Error ? error.message : String(error) };
    }
    await settleTool(
      config.projectId,
      payload.runId,
      payload.capability,
      request,
      claimId,
      outcome,
    );
  };

  await admitRun(payload);
  await startRun(config.projectId, payload.runId, payload.capability);

  await streamRun(
    config.projectId,
    payload.runId,
    payload.capability,
    {
      ...callbacks,
      onText: (delta) => {
        assistantText += delta;
        callbacks.onText?.(delta);
      },
      onToolRequest: (request) => {
        void handleToolRequest(request);
      },
    },
    signal,
  );

  return assistantText;
}

/** Build the model history the server expects from rendered chat messages. */
export function toModelHistory(
  messages: readonly { role: string; text: string }[],
): ModelMessage[] {
  const history: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (!message.text.trim()) continue;
    history.push({ role: message.role, content: message.text } as ModelMessage);
  }
  // The current turn is appended by the payload builder itself.
  return history.slice(0, -1);
}
