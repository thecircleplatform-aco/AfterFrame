// ：`npx tsx src/agent/followup-tools.check.ts`
// ask_followup_questions  fields  <widget> ， UI  parseWidgets
// ：buildFollowupWidget → parseWidgets ， execFollowupTool
// __followup  fields
import assert from 'node:assert';
import { buildFollowupWidget, execFollowupTool, FOLLOWUP_TOOL_NAMES } from './followup-tools';
import { parseWidgets, type FormMulti, type FormSingle, type WidgetField } from '../../components/chat/widget-parse';
import type { AgentContext } from '../context';

const ctx = {} as AgentContext; // followup \u4e0d\u78b0\u7f16\u8f91\u5668\u72b6\u6001

// ---- ：single + multi  buildFollowupWidget → parseWidgets  ----
const text = buildFollowupWidget(
  [
    { id: 'ratio', label: '\u753b\u5e45\u6bd4\u4f8b', type: 'single', options: [{ value: '16:9', display: '\u6a2a\u5c4f 16:9' }, { value: '9:16', display: '\u7ad6\u5c4f 9:16' }], required: true },
    { id: 'topics', label: '\u91cd\u70b9\u5185\u5bb9', type: 'multi', options: [{ value: 'a', display: '\u751f\u5e73' }, { value: 'b', display: '\u4f5c\u54c1' }], allowOther: true },
  ],
  '\u5f00\u59cb\u524d\u9700\u8981\u786e\u8ba4\u51e0\u4ef6\u4e8b：',
);
const segs = parseWidgets(text);
assert.strictEqual(segs.length, 2, '\u5e94\u4e3a \u6587\u672c + widget \u4e24\u6bb5');
assert.ok(segs[0].type === 'text' && segs[0].text.includes('\u5f00\u59cb\u524d\u9700\u8981\u786e\u8ba4'), 'prompt \u5e94\u4f5c\u4e3a\u524d\u7f6e\u6587\u672c\u6bb5');
assert.ok(segs[1].type === 'widget', '\u7b2c\u4e8c\u6bb5\u5e94\u662f widget');
const fields = segs[1].type === 'widget' ? segs[1].fields : [];
assert.strictEqual(fields.length, 2, '\u5e94\u89e3\u51fa 2 \u4e2a\u5b57\u6bb5');
const [ratio, topics] = fields as [FormSingle, FormMulti];
assert.strictEqual(ratio.kind, 'single');
assert.strictEqual(ratio.id, 'ratio');
assert.strictEqual(ratio.label, '\u753b\u5e45\u6bd4\u4f8b');
assert.strictEqual(ratio.required, true, 'required \u5e94\u4fdd\u7559');
assert.deepStrictEqual(ratio.options, [{ value: '16:9', display: '\u6a2a\u5c4f 16:9' }, { value: '9:16', display: '\u7ad6\u5c4f 9:16' }]);
assert.strictEqual(topics.kind, 'multi');
assert.strictEqual(topics.allowOther, true, 'allow_other \u5e94\u4fdd\u7559');

// ----  prompt ， widget  ----
const freeText = buildFollowupWidget([{ id: 'title', label: '\u89c6\u9891\u6807\u9898', type: 'single', options: [] }], '');
const freeSegs = parseWidgets(freeText);
assert.ok(!freeSegs.some((s) => s.type === 'widget'), '\u65e0\u9009\u9879\u5b57\u6bb5\u4e0d\u5e94\u4ea7\u51fa widget \u5361');
assert.ok(freeSegs.some((s) => s.type === 'text' && s.text.includes('- \u89c6\u9891\u6807\u9898')), '\u65e0\u9009\u9879\u5b57\u6bb5\u5e94\u964d\u7ea7\u4e3a\u63d0\u95ee\u884c');

// ---- ： +  → widget ， ----
const mixed = buildFollowupWidget(
  [
    { id: 'q1', label: '\u5e26\u9009\u9879', type: 'single', options: ['x', 'y'] },
    { id: 'q2', label: '\u81ea\u7531\u8f93\u5165', type: 'single', options: [] },
  ],
  '',
);
const mixedSegs = parseWidgets(mixed);
const mixedWidget = mixedSegs.find((s) => s.type === 'widget');
assert.ok(mixedWidget && mixedWidget.type === 'widget' && mixedWidget.fields.length === 1, '\u5e26\u9009\u9879\u5b57\u6bb5\u72ec\u7acb\u6210\u5361');
assert.ok(mixedSegs.some((s) => s.type === 'text' && s.text.includes('- \u81ea\u7531\u8f93\u5165')), '\u81ea\u7531\u6587\u672c\u5b57\u6bb5\u964d\u7ea7\u4e3a\u63d0\u95ee\u884c');

// ---- （//&） esc → decodeEntities  ----
const escaped = buildFollowupWidget([{ id: 'q', label: 'A & B <c> "d"', type: 'single', options: [{ value: 'v', display: 'x & y' }] }], '');
const escFields = (parseWidgets(escaped).find((s) => s.type === 'widget') as { type: 'widget'; fields: WidgetField[] }).fields;
assert.strictEqual(escFields[0].label, 'A & B <c> "d"', '\u6807\u7b7e\u7279\u6b8a\u5b57\u7b26\u5e94\u65e0\u635f\u5f80\u8fd4');
const escOpt = (escFields[0] as FormSingle).options[0] as { display?: string; value?: string };
assert.strictEqual(escOpt.display ?? escOpt.value, 'x & y', '\u9009\u9879\u7279\u6b8a\u5b57\u7b26\u5e94\u65e0\u635f\u5f80\u8fd4');

// ---- execFollowupTool ： __followup， fields  ----
assert.ok(FOLLOWUP_TOOL_NAMES.has('ask_followup_questions'));
const ok = execFollowupTool('ask_followup_questions', { fields: [{ id: 'r', label: '\u6bd4\u4f8b', type: 'single', options: ['16:9', '9:16'] }], prompt: '\u9009\u4e00\u4e2a' }, ctx) as { __followup?: string; note?: string };
assert.ok(typeof ok.__followup === 'string' && ok.__followup.includes('<widget>'), '\u5408\u6cd5\u8c03\u7528\u5e94\u8fd4\u56de __followup widget \u6587\u672c');
assert.ok(typeof ok.note === 'string' && ok.note.length > 0, '\u5e94\u5e26 note \u63d0\u793a\u7b49\u5f85\u4f5c\u7b54');
const empty = execFollowupTool('ask_followup_questions', { fields: [] }, ctx) as { error?: string };
assert.ok(empty.error, '\u7a7a fields \u5e94\u62a5\u9519');
const noRenderable = execFollowupTool('ask_followup_questions', { fields: [{ label: '', type: 'single', options: [] }] }, ctx) as { error?: string };
assert.ok(noRenderable.error, '\u65e0\u53ef\u6e32\u67d3\u5b57\u6bb5\u5e94\u62a5\u9519');
const badName = execFollowupTool('nope', { fields: [] }, ctx) as { error?: string };
assert.ok(badName.error, '\u672a\u77e5\u5de5\u5177\u540d\u5e94\u62a5\u9519');

console.log('followup-tools.check.ts ✓ (widget \u5f80\u8fd4 / \u65e0\u9009\u9879\u964d\u7ea7 / \u7279\u6b8a\u5b57\u7b26 / exec \u5951\u7ea6)');
