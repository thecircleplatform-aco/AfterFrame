import assert from 'node:assert/strict';
import type { DisplayMessage } from './agent-session';
import type { LLMMessage } from './runtime';
import { planRetryRewind } from './retry-rewind';

const user = (text: string): DisplayMessage => ({ role: 'user', text, retry: { text } });
const assistant = (text: string): DisplayMessage => ({ role: 'assistant', text });
const tool = (name: string): DisplayMessage => ({ role: 'tool', text: '', tool: { name, args: {}, result: { ok: true } } });
const modelUser = (content: string): LLMMessage => ({ role: 'user', content });
const modelAssistant = (content: string): LLMMessage => ({ role: 'assistant', content });

// The failed last turn, with tool and error rows that exist only in the display history.
{
  const messages = [
    user('\u52a0\u4e2a\u7247\u5934'), assistant('\u597d\u7684'),
    user('\u4e0b\u8f7d\u4e00\u6bb5\u80cc\u666f'), assistant(''), tool('download_media'), { role: 'error', text: 'Chunk timeout of 120000ms exceeded' } as DisplayMessage,
  ];
  const llm = [modelUser('\u52a0\u4e2a\u7247\u5934'), modelAssistant('\u597d\u7684'), modelUser('\u4e0b\u8f7d\u4e00\u6bb5\u80cc\u666f'), modelAssistant('')];
  assert.deepEqual(planRetryRewind(messages, llm, 2), { messages: 2, llm: 2 });
  // Rewinding an earlier turn drops everything after it in both histories.
  assert.deepEqual(planRetryRewind(messages, llm, 0), { messages: 0, llm: 0 });
}

// Attached context is appended to the model copy of the turn; the display copy is the bare text.
{
  const messages = [user('\u4e0b\u8f7d\u4e00\u6bb5\u80cc\u666f')];
  const llm = [modelUser('\u4e0b\u8f7d\u4e00\u6bb5\u80cc\u666f\n\n{"type":"chat_context_entry","entries":[]}')];
  assert.deepEqual(planRetryRewind(messages, llm, 0), { messages: 0, llm: 0 });
  // A different suffix on the same line is a different turn.
  assert.equal(planRetryRewind(messages, [modelUser('\u4e0b\u8f7d\u4e00\u6bb5\u80cc\u666f\u89c6\u9891')], 0), null);
}

// Multi-part model content (text plus an image) still identifies the turn by its text.
{
  const messages = [user('\u770b\u770b\u8fd9\u5f20\u56fe'), assistant('\u770b\u5230\u4e86')];
  const llm: LLMMessage[] = [
    { role: 'user', content: [{ type: 'text', text: '\u770b\u770b\u8fd9\u5f20\u56fe' }, { type: 'image', image: 'data:image/png;base64,AA==' }] },
    modelAssistant('\u770b\u5230\u4e86'),
  ];
  assert.deepEqual(planRetryRewind(messages, llm, 0), { messages: 0, llm: 0 });
}

// Display-only rows never count as user turns: the continue card and widgets do not shift the ordinal.
{
  const messages = [user('\u7b2c\u4e00\u6b65'), { role: 'continue', text: '' } as DisplayMessage, user('\u7ee7\u7eed')];
  const llm = [modelUser('\u7b2c\u4e00\u6b65'), modelAssistant('...'), modelUser('\u7ee7\u7eed')];
  assert.deepEqual(planRetryRewind(messages, llm, 2), { messages: 2, llm: 2 });
  assert.deepEqual(planRetryRewind(messages, llm, 0), { messages: 0, llm: 0 });
}

// When the histories cannot be matched the plan is null and the caller falls back to re-sending.
{
  const messages = [user('\u7b2c\u4e00\u6b65'), assistant('...'), user('\u7b2c\u4e8c\u6b65')];
  // A model-only user message (a proposal rejection) sits after the target turn.
  const withRejection = [modelUser('\u7b2c\u4e00\u6b65'), modelAssistant('...'), modelUser('\u7b2c\u4e8c\u6b65'), modelUser('User clicked Deny')];
  assert.equal(planRetryRewind(messages, withRejection, 2), null);
  // A compacted history no longer contains the turn.
  assert.equal(planRetryRewind(messages, [modelUser('[summary]'), modelAssistant('...')], 0), null);
  // Not a user turn, out of range, or an empty prompt.
  assert.equal(planRetryRewind(messages, [modelUser('\u7b2c\u4e00\u6b65'), modelAssistant('...'), modelUser('\u7b2c\u4e8c\u6b65')], 1), null);
  assert.equal(planRetryRewind(messages, [], 5), null);
  assert.equal(planRetryRewind([user('   ')], [modelUser('   ')], 0), null);
}

console.log('retry-rewind.verify: ok');
