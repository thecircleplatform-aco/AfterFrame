// ：`npx tsx src/components/chat/widget-parse.check.ts`
//  widget  + formatWidgetAnswer  +  widget
import assert from 'node:assert';
import {
  parseWidgets, formatWidgetAnswer,
  type FormMulti, type FormRichChoice, type FormSingle,
} from './widget-parse';

const REAL_EXAMPLE = `\u597d\u7684！\u5728\u5f00\u59cb\u5236\u4f5c\u4e4b\u524d，\u6211\u9700\u8981\u4e86\u89e3\u51e0\u4e2a\u5173\u952e\u4fe1\u606f：

<widget>
  <form-single id="duration" label="\u89c6\u9891\u65f6\u957f\u5927\u6982\u591a\u5c11？" options="60s|\u7ea61\u5206\u949f,180s|\u7ea63\u5206\u949f,300s|\u7ea65\u5206\u949f" allow_other="false"/>
  <form-single id="ratio" label="\u89c6\u9891\u753b\u5e45\u6bd4\u4f8b" options="16:9|\u6a2a\u5c4f 16:9,9:16|\u7ad6\u5c4f 9:16,1:1|\u65b9\u5f62"/>
  <form-multi id="content" label="\u60f3\u91cd\u70b9\u6db5\u76d6\u54ea\u4e9b\u5185\u5bb9？（\u591a\u9009）" options="\u751f\u5e73\u7ecf\u5386,\u4ee3\u8868\u8bd7\u4f5c\u8d4f\u6790,\u5386\u53f2\u80cc\u666f\u4e0e\u65f6\u4ee3"/>
  <form-visual id="voiceId" label="\u9009\u62e9\u4e00\u4e2a\u914d\u97f3\u97f3\u8272：" required="true">
    <visual-option value="ruyayichen" name="\u5112\u96c5\u9038\u8fb0" media="/voice-samples/doubao-ruyayichen.mp3" aspect-ratio="16:5" summary="\u7537 / \u5e74\u8f7b / \u5112\u96c5\u98d8\u9038"/>
    <visual-option value="morgan" name="Morgan" media="/voice-samples/x.mp3" summary="..."/>
  </form-visual>
</widget>`;

// ----  +  ----
const segs = parseWidgets(REAL_EXAMPLE);
assert.strictEqual(segs.length, 2, 'segment \u6570\u5e94\u4e3a 2（\u6587\u672c + widget）');
assert.strictEqual(segs[0].type, 'text');
assert.ok(segs[0].type === 'text' && segs[0].text.includes('\u597d\u7684！\u5728\u5f00\u59cb\u5236\u4f5c\u4e4b\u524d'));
assert.strictEqual(segs[1].type, 'widget');
assert.ok(segs[1].type === 'widget');
const fields = segs[1].type === 'widget' ? segs[1].fields : [];
assert.strictEqual(fields.length, 4, '\u5e94\u89e3\u51fa 4 \u4e2a\u5b57\u6bb5');

const [duration, ratio, content, voiceId] = fields as [
  FormSingle,
  FormSingle,
  FormMulti,
  FormRichChoice,
];

assert.strictEqual(duration.kind, 'single');
assert.strictEqual(duration.id, 'duration');
assert.strictEqual(duration.label, '\u89c6\u9891\u65f6\u957f\u5927\u6982\u591a\u5c11？');
assert.strictEqual(duration.allowOther, false);
assert.deepStrictEqual(duration.options, [
  { value: '60s', display: '\u7ea61\u5206\u949f' },
  { value: '180s', display: '\u7ea63\u5206\u949f' },
  { value: '300s', display: '\u7ea65\u5206\u949f' },
]);

assert.strictEqual(ratio.kind, 'single');
assert.strictEqual(ratio.allowOther, false, 'allow_other \u7f3a\u7701\u5e94\u4e3a false');
assert.deepStrictEqual(ratio.options, [
  { value: '16:9', display: '\u6a2a\u5c4f 16:9' },
  { value: '9:16', display: '\u7ad6\u5c4f 9:16' },
  { value: '1:1', display: '\u65b9\u5f62' },
]);

assert.strictEqual(content.kind, 'multi');
assert.deepStrictEqual(content.options, [
  { value: '\u751f\u5e73\u7ecf\u5386', display: '\u751f\u5e73\u7ecf\u5386' },
  { value: '\u4ee3\u8868\u8bd7\u4f5c\u8d4f\u6790', display: '\u4ee3\u8868\u8bd7\u4f5c\u8d4f\u6790' },
  { value: '\u5386\u53f2\u80cc\u666f\u4e0e\u65f6\u4ee3', display: '\u5386\u53f2\u80cc\u666f\u4e0e\u65f6\u4ee3' },
]);

assert.strictEqual(voiceId.kind, 'visual');
assert.strictEqual(voiceId.required, true);
assert.strictEqual(voiceId.options.length, 2);
assert.deepStrictEqual(voiceId.options[0], {
  value: 'ruyayichen',
  name: '\u5112\u96c5\u9038\u8fb0',
  media: '/voice-samples/doubao-ruyayichen.mp3',
  description: '\u7537 / \u5e74\u8f7b / \u5112\u96c5\u98d8\u9038',
  aspectRatio: '16:5',
  submitPrompt: undefined,
});
assert.deepStrictEqual(voiceId.options[1], {
  value: 'morgan',
  name: 'Morgan',
  media: '/voice-samples/x.mp3',
  description: '...',
  aspectRatio: undefined,
  submitPrompt: undefined,
});

// ---- formatWidgetAnswer ----
const answer = formatWidgetAnswer(fields, {
  duration: '180s',
  ratio: '16:9',
  content: ['\u751f\u5e73\u7ecf\u5386', '\u4ee3\u8868\u8bd7\u4f5c\u8d4f\u6790'],
  voiceId: 'ruyayichen',
});
assert.strictEqual(
  answer,
  ['- \u89c6\u9891\u65f6\u957f\u5927\u6982\u591a\u5c11？：\u7ea63\u5206\u949f', '- \u89c6\u9891\u753b\u5e45\u6bd4\u4f8b：\u6a2a\u5c4f 16:9', '- \u60f3\u91cd\u70b9\u6db5\u76d6\u54ea\u4e9b\u5185\u5bb9？（\u591a\u9009）：\u751f\u5e73\u7ecf\u5386\u3001\u4ee3\u8868\u8bd7\u4f5c\u8d4f\u6790', '- \u9009\u62e9\u4e00\u4e2a\u914d\u97f3\u97f3\u8272：：\u5112\u96c5\u9038\u8fb0'].join('\n'),
);

// ；allow_other
const partial = formatWidgetAnswer(fields, { duration: '\u81ea\u5b9a\u4e49\u4e24\u5206\u949f' });
assert.strictEqual(partial, '- \u89c6\u9891\u65f6\u957f\u5927\u6982\u591a\u5c11？：\u81ea\u5b9a\u4e49\u4e24\u5206\u949f');

// ----  widget ： ----
const plain = parseWidgets('\u8fd9\u662f\u4e00\u53e5\u666e\u901a\u56de\u590d，\u6ca1\u6709\u8868\u5355\u3002');
assert.strictEqual(plain.length, 1);
assert.deepStrictEqual(plain[0], { type: 'text', text: '\u8fd9\u662f\u4e00\u53e5\u666e\u901a\u56de\u590d，\u6ca1\u6709\u8868\u5355\u3002' });

// ----  widget：（）----
const malformed = '\u524d\u9762\u7684\u8bdd<widget><form-single id="x"/></widget>\u540e\u9762\u7684\u8bdd';
assert.doesNotThrow(() => parseWidgets(malformed));
const malformedSegs = parseWidgets(malformed);
assert.strictEqual(malformedSegs.length, 2);
assert.deepStrictEqual(malformedSegs[0], { type: 'text', text: '\u524d\u9762\u7684\u8bdd' });
assert.deepStrictEqual(malformedSegs[1], { type: 'text', text: '\u540e\u9762\u7684\u8bdd' });

// ----  widget（）， ----
const empty = '<widget></widget>';
assert.doesNotThrow(() => parseWidgets(empty));
assert.deepStrictEqual(parseWidgets(empty), []);

console.log('widget-parse.check: ok');
