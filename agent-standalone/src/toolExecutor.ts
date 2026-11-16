import type { ToolOutcome, ToolRequestEvent } from './agentClient';

/**
 * Optional remote tool executor.
 *
 * The agent loop runs here; the *timeline* lives in the editor. Point
 * `VITE_AF_TOOL_EXECUTOR_URL` at a service that accepts
 *   POST { toolCallId, name, args, argsDigest }
 * and answers with the tool result JSON (or `{ error: string }`).
 *
 * That keeps this host a pure agent server while the main app (or any worker
 * that owns a ProjectDoc) executes the mutations — the same split the editor
 * uses between `server/agent-runs` and `src/agent/serverRunToolExecutor.ts`.
 */
export function remoteToolExecutor(url: string): (request: ToolRequestEvent) => Promise<ToolOutcome> {
  return async (request) => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolCallId: request.toolCallId,
          name: request.name,
          args: request.args,
          argsDigest: request.argsDigest,
        }),
      });
      if (!response.ok) return { error: `tool executor failed: HTTP ${response.status}` };
      const body = (await response.json().catch(() => null)) as
        | { error?: string; result?: unknown }
        | null;
      if (body && typeof body.error === 'string') return { error: body.error };
      return { result: body && 'result' in body ? body.result : body };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Executor chosen for this host: remote when configured, otherwise refuse. */
export const TOOL_EXECUTOR_URL = import.meta.env.VITE_AF_TOOL_EXECUTOR_URL ?? '';
