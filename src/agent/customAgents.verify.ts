import assert from 'node:assert/strict';
import {
  customAgent,
  deleteCustomAgent,
  listCustomAgents,
  resetCustomAgents,
  saveCustomAgent,
  subscribeCustomAgents,
} from './customAgents';

// localStorage is absent under plain node; the store must degrade to memory-only.
resetCustomAgents();

let notifications = 0;
const unsubscribe = subscribeCustomAgents(() => { notifications += 1; });

const created = saveCustomAgent({ name: '  Short-form Editor  ', prompt: 'Keep hooks under 2s.' });
assert.ok(created, 'a named agent with a prompt is stored');
assert.equal(created.name, 'Short-form Editor', 'names are trimmed');
assert.equal(created.readOnly, false, 'read-only defaults to false');
assert.equal(listCustomAgents().length, 1);
assert.equal(notifications, 1, 'subscribers hear about a new agent');
assert.equal(customAgent(created.id)?.prompt, 'Keep hooks under 2s.');

// Unusable input is rejected rather than stored.
assert.equal(saveCustomAgent({ name: '   ', prompt: 'x' }), null, 'a blank name is rejected');
assert.equal(saveCustomAgent({ name: 'No prompt', prompt: '   ' }), null, 'a blank prompt is rejected');
assert.equal(listCustomAgents().length, 1, 'rejected input does not create an agent');

// Updating keeps the id and createdAt, so a project that references the preset keeps working.
const updated = saveCustomAgent({ id: created.id, name: 'Short-form Pro', prompt: 'Keep hooks under 1.5s.', readOnly: true });
assert.ok(updated);
assert.equal(updated.id, created.id, 'update keeps the id');
assert.equal(updated.createdAt, created.createdAt, 'update keeps createdAt');
assert.equal(updated.readOnly, true);
assert.equal(listCustomAgents().length, 1, 'update replaces instead of appending');

deleteCustomAgent(created.id);
assert.equal(listCustomAgents().length, 0);
assert.equal(customAgent(created.id), null, 'a deleted preset resolves to null');

unsubscribe();
const before = notifications;
resetCustomAgents([{ id: 'a', name: 'A', prompt: 'p', readOnly: false, createdAt: 0 }]);
assert.equal(notifications, before, 'unsubscribed listeners are not called');
assert.equal(listCustomAgents().length, 1, 'reset replaces the set');

console.log('custom agents verification passed');
