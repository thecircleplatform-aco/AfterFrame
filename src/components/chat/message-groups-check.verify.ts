// Runnable check: `npx tsx src/components/chat/message-groups.check.ts`.
// groupMessages (≥GROUP_MIN),;///
import assert from 'node:assert/strict';
import type { DisplayMessage } from '../../agent/agent-session';
import { groupMessages, GROUP_MIN } from './message-groups';

const tool = (name: string, id = ''): DisplayMessage => ({ role: 'tool', text: '', tool: { name, args: { id }, result: { ok: true } } });
const txt = (t: string): DisplayMessage => ({ role: 'assistant', text: t });

// 20× edit_gap  →  toolgroup,
const msgs: DisplayMessage[] = [
  txt('\u5f00\u59cb'),
  ...Array.from({ length: 20 }, (_, i) => tool('edit_gap', 'g' + i)),
  tool('read_timeline'),
  txt('\u5b8c\u6210'),
];
const items = groupMessages(msgs);
assert.deepStrictEqual(items.map((it) => it.kind), ['single', 'toolgroup', 'single', 'single'], '20 \u8fde\u7eed edit_gap \u6298\u6210 1 \u7ec4,\u6587\u672c/\u5176\u5b83\u5de5\u5177\u5404\u81ea\u6210\u884c');
const grp = items[1];
assert.ok(grp.kind === 'toolgroup');
assert.strictEqual(grp.kind === 'toolgroup' && grp.name, 'edit_gap');
assert.strictEqual(grp.kind === 'toolgroup' && grp.items.length, 20, '\u7ec4\u91cc\u542b\u5168\u90e8 20 \u6b21');
assert.strictEqual(grp.kind === 'toolgroup' && grp.items[0].index, 1, '\u7ec4\u5185\u4fdd\u7559\u539f\u59cb message \u7d22\u5f15(\u7528\u4e8e key/feedback)');
assert.strictEqual(grp.kind === 'toolgroup' && grp.items[19].index, 20);

// :GROUP_MIN-1 (),GROUP_MIN
const below = groupMessages(Array.from({ length: GROUP_MIN - 1 }, () => tool('search_templates')));
assert.ok(below.every((it) => it.kind === 'single'), `\u4e0d\u8db3 ${GROUP_MIN} \u6b21\u4e0d\u6298\u53e0`);
const at = groupMessages(Array.from({ length: GROUP_MIN }, () => tool('search_templates')));
assert.deepStrictEqual(at.map((it) => it.kind), ['toolgroup'], `\u6ee1 ${GROUP_MIN} \u6b21\u6298\u53e0`);

// ()
const distinct = groupMessages([tool('clean_script'), tool('read_timeline'), tool('manage_timelines')]);
assert.ok(distinct.every((it) => it.kind === 'single'), '\u4e0d\u540c\u540d\u5de5\u5177\u5404\u81ea\u6210\u884c,\u4e0d\u8bef\u6298');

//  →
const split = groupMessages([...Array.from({ length: 4 }, () => tool('edit_gap')), tool('read_timeline'), ...Array.from({ length: 3 }, () => tool('edit_gap'))]);
assert.deepStrictEqual(split.map((it) => it.kind), ['toolgroup', 'single', 'toolgroup'], '\u88ab\u9694\u5f00\u7684\u540c\u540d\u6bb5\u5404\u81ea\u6210\u7ec4');

console.log('message-groups.check: ok (\u6298\u53e0/\u9608\u503c/\u7d22\u5f15/\u4e0d\u8bef\u6298/\u5206\u6bb5)');
