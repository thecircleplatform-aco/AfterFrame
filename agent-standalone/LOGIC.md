# Agent logic & stack (what the main app does)

Everything below is the behaviour of the production app. The standalone host
reproduces it; this file is the contract for pointing any client at it.

---

## 1. Stack

| Layer | Technology | Files |
| --- | --- | --- |
| Host | Node ≥ 24 + Vite (dev server / Electron embedded server both mount Vite plugins) | `config/vite.config.ts`, `desktop/embedded-server.ts`, `server/plugins/index.ts` |
| Agent loop | Vercel AI SDK `streamText` (`ai`, `@ai-sdk/*`) | `server/agent-runs/executor.ts` |
| Run protocol | Plain `node:http` middleware + SSE | `server/agent-runs/routes.ts`, `sse.ts` |
| Run state | In-memory ledger, flushed to the project store | `server/agent-runs/store*.ts`, `src/persist/agentRuntimeStore.ts` |
| Transport | `fetch` + manual SSE reader (no socket.io) | `src/agent/serverRunFetchEventStream.ts` |
| UI | React 19, `ChatMessage` / `Markdown` / `ToolBadge` / `WidgetCard` | `src/components/chat/**` |
| Model access | Provider SDK through a loopback LLM proxy; keys from keystore | `server/agent-runs/model.ts`, `server/plugins/llm-proxy.ts`, `server/keystore.ts` |
| Tools | JSON-schema catalog, activation-filtered per request | `src/agent/tools/**`, `src/agent/tool-activation.ts` |
| Approval / proposals | Run events + editor proposal bridge | `server/agent-runs/store-approval.ts`, `src/agent/serverRunProposalBridge.ts` |

Three execution backends exist. `backend: 'api'` (the default) is the server-side AI
SDK loop. `codex`, `copilot`, `claude-code` run the same protocol with the turn owned
by an external CLI instead (`server/agent-runs/codex-turn.ts`, etc.).

---

## 2. The request sequence

A "turn" is **6 HTTP calls**. Nothing is stateful in the client besides the run id +
capability.

```
POST /api/agent-runs/                    → { id, capability }
POST /api/agent-runs/:id/start           { projectId }
GET  /api/agent-runs/:id/events?projectId=…&after=<cursor>   (SSE, long-lived)
POST /api/agent-runs/:id/tool-claim      { projectId, toolCallId, argsDigest, claimId }
POST /api/agent-runs/:id/tool-result     { projectId, toolCallId, argsDigest, claimId, result|error }
POST /api/agent-runs/:id/cancel          { projectId }        (on Stop)
```

Side routes: `POST :id/settle` (terminal handoff), `POST :id/draft`, `POST :id/draft/clear`,
`GET :id?projectId=…` (metadata for recovery).

### Payload (the body of `POST /api/agent-runs/`)

`src/agent/serverRunProtocol.ts` → `ServerRunPayload`.

| Field | Meaning |
| --- | --- |
| `projectId`, `runId`, `capability` | identity. `capability` is a 32-byte random token; it is the per-run write credential |
| `messages` | projected model history + the new user message (≤63 messages, ≤960 KB body, images share a 512 KB budget) |
| `tools` | **the active tool surface for this request**, already filtered by `ToolActivation` |
| `askOnly` | Ask/Plan mode: read-only catalog, no edits |
| `references` | editor selection refs (clip ids, ranges) |
| `systemPrompt` | optional override; the server builds one otherwise |
| `provider`, `model`, `reasoningEffort`, `openAiApiMode` | model routing |
| `cacheMode` | prompt-cache TTL (`short`/`long`) |
| `maxOutputTokens`, `autonomousAcceptance`, `maxAcceptanceIterations` | loop budget |
| `externalSessionId`, `approvalMode` | external backends only |

The payload **is** the run: `buildServerRunPayload` performs activation, budgeting and
identity in one place, and the server refuses a run whose `id`/`capability` echo back
differently.

### Auth model (`server/project-store-http-auth.ts`)

No shared secret, no cookies, no session:

1. socket peer must be loopback,
2. `Host` must name a loopback host (defeats DNS rebinding),
3. writes require `Origin` == `Host`,
4. `Sec-Fetch-Site` must be `same-origin` or `none`.

That is why a standalone host works with zero configuration — and why it must bind
`127.0.0.1`.

---

## 3. SSE event stream

`server/agent-runs/sse.ts` writes `id: <n>` / `event: <type>` / `data: <json>`. Resume
is by `after=<n>` or the `Last-Event-ID` header; a cursor outside the replay window is
`410`, ahead of the run is `409`.

| Event | Data | Client action |
| --- | --- | --- |
| `status` | `{ status }` | header badge |
| `text-start` | `{}` | open the assistant bubble |
| `text-delta` | `{ text }` | append text (flushed every 8 192 chars and every 2 s) |
| `text-end` | `{ characterCount, utf8Bytes }` | finalize |
| `thinking-delta` | `{ text }` | append to the collapsed "thinking" block |
| `tool-request` | `{ toolCallId, name, args, argsDigest }` | claim → execute → settle |
| `tool-result` | `{ toolCallId, toolName, result?, error? }` | render badge state |
| `context-usage` | `{ usage }` | context meter |
| `llm-retry`, `llm-retry-start` | `{ attempt, requestIndex }` | retry hint |
| `context-overflow-retry` | `{ requestIndex, stage? }` | silent shrink |
| `acceptance`, `max-tokens`, `tool-failures` | loop diagnostics | notes |
| `checkpoint` | `{ … }` | recovery point |
| `error` | `{ message }` | surface to user |
| `finish` | text metadata | turn done |
| `done` | — | close the stream |

The loop is **multi-turn**: one SSE stream can carry several model calls (tool use,
acceptance loop, overflow retries). Never treat `text-end` as end-of-run.

---

## 4. Tool call lifecycle

```
model requests tool
      ↓
executor pushRunEvent(run, 'tool-request', …)      browser-tool.ts
      ↓
client POSTs :id/tool-claim  { claimId }           → claimed | duplicate | already-claimed | mismatch
      ↓
client executes (editor) and POSTs :id/tool-result { result | error }
      ↓
executor resumes the model with the tool result
```

- `claimId` is **client-generated** (uuid) and idempotent: the same `claimId` twice is
  `duplicate`, a different one is `already-claimed`. `argsDigest` must match the
  request, otherwise `mismatch` (409).
- Unclaimed calls are answered by `unexecuted-tool-calls.ts` so the model is never
  wedged on a dangling call.
- Tool results are size-capped and projected (`src/agent/tool-result-output.ts`).
- Approvals (`approval_requested`/`denied`) gate mutating tools; `external-tool-policy.ts`
  decides what a remote caller may touch.

Without an editor the host answers every `tool-request` with an `error` result — the
protocol stays intact, the model just learns the tool is unavailable. Set
`VITE_AF_TOOL_EXECUTOR_URL` to forward claimed calls to a worker that owns a
`ProjectDoc` instead (`src/toolExecutor.ts`).

---

## 5. Server plugin set the agent needs

`server/plugins/index.ts` mounts ~40 plugins for the editor. The agent needs these 11:

| Plugin | Why |
| --- | --- |
| `requestShapeGatePlugin` | Host/Origin/Sec-Fetch gate for every `POST` |
| `crossOriginIsolationPlugin` | COOP/COEP headers the editor needs |
| `storageLifecyclePlugin` | store init/teardown |
| `llmProxyPlugin` | model traffic + key validation |
| `agentRunsPlugin` | **the agent** (`/api/agent-runs/**`) |
| `projectStorePlugin({ http: true })` | durable runs/events/artifacts + the project doc |
| `settingsPlugin` | provider/model settings |
| `skillFilesPlugin`, `skillInstallPlugin`, `skillExecPlugin` | agent skills |
| `localMediaPlugin` | media the tools reference |

Everything else (upload, export, transcode, MCP bridge, remote control) belongs to the
editor shell.

---

## 6. Persistence & recovery

- Runs, events, artifacts, approvals live in the project store
  (`src/persist/agentRuntimeStore.ts`), keyed `run:<id>`, capped (`agentRuntimeRetention.ts`).
- `server/agent-runs/store-recovery.ts` + `src/agent/serverRunRecovery.ts` resume a run
  after a reload: read metadata → replay from the cursor → if the cursor is past the
  window, fall back to `settle`.
- A run holds a capability token; a reload with a lost capability can still **cancel**
  (denial) but not write.

---

## 7. What the editor adds on top

These are the only pieces a standalone host cannot provide, and where they live:

| Editor behaviour | File |
| --- | --- |
| Tool execution (timeline mutations) | `src/agent/serverRunToolExecutor.ts` |
| Applying edits to `ProjectDoc` | `src/agent/serverRunProjectWrite.ts`, `src/editor/storeCommands.ts` |
| Proposal preview / apply | `src/agent/serverRunProposalBridge.ts`, `src/agent/proposal.ts` |
| Selection references, media pool, frames | `src/agent/selection-refs.ts`, `src/agent/tools/**` |
| Full chat panel (composer, attachments, model picker) | `src/components/chat/ChatPanel.tsx`, `useChatAgentController.ts` |

To rebuild the console as a **drop-in client for the editor's agent**, keep calling the
same six routes against the editor's origin — the server is the only thing that moved.
