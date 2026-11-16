/**
 * End-to-end smoke test for the standalone agent host.
 *
 * Drives the real protocol with no browser and no bundler:
 *   create → start → SSE → (tool-claim/tool-result if asked) → finish
 *
 *   node scripts/smoke.mjs "say hello in five words"
 *
 * It needs a model key in the server keystore (env var) — without one the run
 * fails on the provider, which still proves every hop of the protocol.
 */
import { randomBytes } from 'node:crypto';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:5199';
const HEADERS = {
  'content-type': 'application/json',
  origin: ORIGIN,
  'sec-fetch-site': 'same-origin',
};

const text = process.argv.slice(2).join(' ') || 'Reply with the single word: ok';
const projectId = process.env.PROJECT_ID ?? 'agent-standalone-console';
// The server contracts the capability at exactly 43 base64url chars (32 bytes).
const capability = randomBytes(32).toString('base64url');
const runId = crypto.randomUUID();

const payload = {
  projectId,
  runId,
  capability,
  messages: [{ role: 'user', content: text }],
  tools: [],
  askOnly: true,
  references: [],
  provider: process.env.PROVIDER ?? process.env.VITE_AF_PROVIDER ?? 'openai',
  model: process.env.MODEL ?? process.env.VITE_AF_MODEL ?? 'gpt-5',
  cacheMode: 'short',
  maxOutputTokens: 512,
  autonomousAcceptance: false,
  maxAcceptanceIterations: 3,
};

const log = (...parts) => console.log(...parts);

const create = await fetch(`${ORIGIN}/api/agent-runs/`, {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify(payload),
});
log('create  ', create.status, await create.text());
if (!create.ok) process.exit(1);

const start = await fetch(`${ORIGIN}/api/agent-runs/${runId}/start`, {
  method: 'POST',
  headers: { ...HEADERS, 'x-afterframe-run-capability': capability },
  body: JSON.stringify({ projectId }),
});
log('start   ', start.status, await start.text());

const stream = await fetch(
  `${ORIGIN}/api/agent-runs/${runId}/events?projectId=${encodeURIComponent(projectId)}&after=0`,
  {
    headers: {
      ...HEADERS,
      accept: 'text/event-stream',
      'x-afterframe-run-capability': capability,
    },
  },
);
log('events  ', stream.status);

const claimId = crypto.randomUUID();
let assistant = '';
const decoder = new TextDecoder();
let buffer = '';

const handleTool = async (data) => {
  const claim = await fetch(`${ORIGIN}/api/agent-runs/${runId}/tool-claim`, {
    method: 'POST',
    headers: { ...HEADERS, 'x-afterframe-run-capability': capability },
    body: JSON.stringify({
      projectId,
      toolCallId: data.toolCallId,
      argsDigest: data.argsDigest,
      claimId,
    }),
  });
  log('claim   ', claim.status, await claim.text());
  const settle = await fetch(`${ORIGIN}/api/agent-runs/${runId}/tool-result`, {
    method: 'POST',
    headers: { ...HEADERS, 'x-afterframe-run-capability': capability },
    body: JSON.stringify({
      projectId,
      toolCallId: data.toolCallId,
      argsDigest: data.argsDigest,
      claimId,
      error: 'standalone host: no editor attached',
    }),
  });
  log('settle  ', settle.status, await settle.text());
};

for await (const chunk of stream.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let boundary = buffer.indexOf('\n\n');
  while (boundary >= 0) {
    const raw = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const event = /event: (.+)/.exec(raw)?.[1]?.trim();
    const data = /data: (.+)/.exec(raw)?.[1];
    if (event) {
      if (event === 'text-delta') assistant += JSON.parse(data).text ?? '';
      log('event   ', event, data?.slice(0, 200) ?? '');
      if (event === 'tool-request') await handleTool(JSON.parse(data));
    }
    boundary = buffer.indexOf('\n\n');
  }
}

log('\n--- assistant text ---\n' + assistant);
