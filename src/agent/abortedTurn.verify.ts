// Runnable check: `npx tsx src/agent/abortedTurn.verify.ts`.
// After the user clicks "Stop", the session history must still be able to continue to be sent down: the tool calls that have been issued cannot be left hanging.
// Here we verify the judgment "Find tool calls without results" - it determines how many "cancelled" results should be added.
import assert from 'node:assert/strict';
import { completeAbortedTurn, unresolvedToolCalls } from './abortedTurn';
import type { ModelMessage as LLMMessage } from 'ai';

const call = (id: string, name: string): LLMMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: name, input: {} }],
} as unknown as LLMMessage);

const result = (id: string, name: string): LLMMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { type: 'text', value: '{}' } }],
} as unknown as LLMMessage);

const text = (role: 'user' | 'assistant', value: string): LLMMessage => ({
  role, content: [{ type: 'text', text: value }],
} as unknown as LLMMessage);

// ── All have results → No dangling ──
{
  assert.deepEqual(unresolvedToolCalls([text('user', 'hi'), call('t1', 'remove_item'), result('t1', 'remove_item')]), []);
  assert.deepEqual(unresolvedToolCalls([]), []);
  assert.deepEqual(unresolvedToolCalls([text('user', 'hi'), text('assistant', 'ok')]), []);
}

// ── Interrupted midway: The last call has no result ──
{
  const conv = [
    text('user', '\u5220\u4e24\u6bb5'),
    call('t1', 'remove_item'), result('t1', 'remove_item'),
    call('t2', 'remove_item'), // The user clicked stop here
  ];
  assert.deepEqual(unresolvedToolCalls(conv), [{ toolCallId: 't2', toolName: 'remove_item' }]);
}

// ── Multiple calls are made concurrently in one round, only some of them come back ──
{
  const conv: LLMMessage[] = [
    text('user', '\u770b\u770b\u8fd9\u51e0\u6bb5'),
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'a', toolName: 'read_timeline', input: {} },
        { type: 'tool-call', toolCallId: 'b', toolName: 'view_asset_frames', input: {} },
        { type: 'tool-call', toolCallId: 'c', toolName: 'detect_beats', input: {} },
      ],
    } as unknown as LLMMessage,
    result('b', 'view_asset_frames'),
  ];
  assert.deepEqual(unresolvedToolCalls(conv), [
    { toolCallId: 'a', toolName: 'read_timeline' },
    { toolCallId: 'c', toolName: 'detect_beats' },
  ], '\u6ca1\u56de\u6765\u7684\u4e24\u4e2a\u90fd\u8981\u8865\u6536\u5c3e,\u987a\u5e8f\u6309\u53d1\u51fa\u987a\u5e8f');
}

// ── The result is also counted in later messages (immediate proximity is not required) ──
{
  const conv = [
    call('t1', 'x'),
    text('assistant', '\u7a0d\u7b49'),
    result('t1', 'x'),
  ];
  assert.deepEqual(unresolvedToolCalls(conv), []);
}

// ── After completing "Cancelled", clear it in the air (simulating the end of commitAbortedTurn) ──
{
  const history = [text('user', 'go')];
  const completed = completeAbortedTurn(history, [call('t9', 'submit_image')]);
  assert.equal(completed.length, 3, '\u6a21\u578b\u5df2\u7ecf\u8fd4\u56de\u7684\u6d88\u606f\u5fc5\u987b\u4fdd\u7559');
  assert.deepEqual(unresolvedToolCalls(completed), [], '\u8865\u5b8c\u4e4b\u540e\u4f1a\u8bdd\u53ef\u4ee5\u7ee7\u7eed\u5f80\u4e0b\u53d1');
}

console.log('abortedTurn.verify: ok (\u65e0\u60ac\u7a7a/\u5355\u4e2a\u60ac\u7a7a/\u5e76\u53d1\u90e8\u5206\u56de\u6765/\u8de8\u6d88\u606f\u5339\u914d/\u8865\u5b8c\u6e05\u96f6)');
