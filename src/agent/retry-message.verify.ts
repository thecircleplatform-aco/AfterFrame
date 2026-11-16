import assert from 'node:assert/strict';
import { createAgentRetry, ensureAgentRetryMetadata } from './agent-session';
import type { AgentReference } from './context';

const reference: AgentReference = { id: 'asset-1', name: '\u7d20\u6750', kind: 'video' };
const options = { askOnly: true, references: [reference] };
const retry = createAgentRetry('  \u751f\u6210\u5b57\u5e55  ', options);
assert.deepEqual(retry, {
  text: '\u751f\u6210\u5b57\u5e55',
  askOnly: true,
  references: [reference],
}, 'retry payload preserves the original prompt, mode, and references');
assert.notEqual(retry?.references, options.references, 'retry payload owns its reference array');
assert.equal(createAgentRetry('   '), undefined, 'empty prompts cannot be retried');

const existing = createAgentRetry('\u5df2\u7ecf\u5e26\u5143\u6570\u636e', { askOnly: true });
const hydrated = ensureAgentRetryMetadata([
  { role: 'user', text: '\u5386\u53f2\u7528\u6237\u6d88\u606f' },
  { role: 'assistant', text: '\u5386\u53f2\u56de\u7b54' },
  { role: 'user', text: '\u5df2\u7ecf\u5e26\u5143\u6570\u636e', retry: existing },
]);
assert.deepEqual(hydrated[0], {
  role: 'user',
  text: '\u5386\u53f2\u7528\u6237\u6d88\u606f',
  retry: { text: '\u5386\u53f2\u7528\u6237\u6d88\u606f' },
}, 'legacy user messages receive retry metadata during hydration');
assert.deepEqual(hydrated[1], { role: 'assistant', text: '\u5386\u53f2\u56de\u7b54' }, 'assistant messages are unchanged');
assert.equal(hydrated[2].retry, existing, 'existing retry metadata is preserved');

console.log('retry-message.verify: ok');
