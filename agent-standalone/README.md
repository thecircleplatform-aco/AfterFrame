# AfterFrame Agent — standalone host

The agent (model loop, tool protocol, run persistence, streaming) running **on its own
server and its own UI**, outside the editor.

```bash
cd agent-standalone
npm run dev        # http://127.0.0.1:5199  (UI + API)
npm run headless   # API only, no UI bundle
```

## Why this is a host, not a copy

The agent is ~180 modules in `src/agent/**` and ~60 in `server/agent-runs/**`. They
import each other by relative path, share the editor's `ProjectDoc`, the tool catalog,
the LLM proxy and the durable store. Copying them into a folder produces a fork that
breaks on the first import and drifts from the app on the first commit.

So this folder **hosts the production modules in place**:

| Piece | Where it actually lives | How it is used here |
| --- | --- | --- |
| Agent loop | `server/agent-runs/executor.ts` | mounted as-is |
| Run store / SSE | `server/agent-runs/store*.ts`, `sse.ts` | mounted as-is |
| Run protocol | `src/agent/serverRunProtocol.ts` | `buildServerRunPayload` imported |
| Tool catalog | `src/agent/tools/**`, `tool-activation.ts` | activated by the payload builder |
| Chat rendering | `src/components/chat/ChatMessage.tsx` + `Markdown`, `ToolBadge`, `WidgetCard` | rendered as-is |
| Theme / i18n | `src/theme.ts`, `src/i18n/**` | imported as-is |

The only new code is: the plugin list (`server/plugins.ts`), the HTTP/UI entry points,
and the run client (`src/agentClient.ts`) — which reproduces the editor's request
sequence byte-for-byte instead of re-inventing it.

## What runs

```
agent-standalone/
├── vite.config.mts          # mount: react + standaloneAgentPlugins()
├── index.html
├── server/
│   ├── plugins.ts           # the agent's server dependency set (see LOGIC.md)
│   └── headless.mts         # API-only host
└── src/
    ├── main.tsx
    ├── App.tsx              # header/composer shell + <ChatMessage/>
    ├── agentClient.ts        # admit → start → SSE → tool-claim/tool-result → cancel
    ├── config.ts            # provider/model defaults from VITE_AF_*
    └── styles.css
```

## Configuration

Keys are read by the server keystore (`server/keystore.ts`): environment variable
first, then the runtime profile — exactly like the editor. Nothing is sent to the
browser.

```bash
OPENAI_API_KEY=...            # or ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / ...
VITE_AF_PROVIDER=openai       # client default
VITE_AF_MODEL=gpt-5
VITE_AF_PROJECT_ID=agent-standalone-console
```

## The honest boundary: no editor

The agent's tools mutate a timeline. In the editor, tool requests are executed by the
browser that owns the project store (`src/agent/serverRunToolExecutor.ts`). A
standalone console owns no timeline, so this host **claims every tool request and
settles it with a structured failure** the model can read and route around. The
protocol is complete — only the executor is missing.

Three ways to make tools real:

- `VITE_AF_TOOL_EXECUTOR_URL=http://…` — every claimed tool call is forwarded as
  `POST { toolCallId, name, args, argsDigest }` and the JSON answer is settled back
  (`src/toolExecutor.ts`). This is the "agent separate, timeline in the main app" split.
- `executeTool` in `StandaloneAgentConfig` (`src/agentClient.ts`, `runAgent`) — in-process
  executor.
- Nothing at all — reads/answers still work; the model is told the tool is unavailable.

Existing executors in the repo: `server/external-agent/offline-executor.ts` (headless,
against an `AgentContext`) and `src/agent/serverRunToolExecutor.ts` (needs the editor store).

Full request/response reference: **[LOGIC.md](./LOGIC.md)**.
