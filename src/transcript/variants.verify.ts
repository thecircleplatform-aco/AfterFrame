// Runnable contract check: `npx tsx src/transcript/variants.check.ts`.
// :,
import assert from 'node:assert';
import type { TranscriptWord, TranscriptVariant } from './types';
import { resolveVariantText, createVariant, upsertVariant, findVariantByLang } from './variants';
import { retimeWords } from './edit';
import { makeDraft } from '../editor/store';
import type { TimelineState } from '../editor/types';
import { docFromTimeline } from '../persist/projectStore';

const source: TranscriptWord[] = [
  { text: '\u4f60\u597d', start: 0, end: 200, speaker: 'A' },
  { text: '\u4e16\u754c', start: 200, end: 500, speaker: 'A' },
  { text: '\u518d\u89c1', start: 500, end: 900, speaker: 'B' },
];

// ── 1) resolveVariantText: text,start/end/speaker ; ──
const variant: TranscriptVariant = {
  id: 'v1', lang: 'English', kind: 'translation', label: 'English',
  words: [
    { i: 0, text: 'hello' },
    { i: 2, text: 'bye' },
    { i: 99, text: 'OUT_OF_RANGE' }, // \u8d8a\u754c:\u5fc5\u987b\u88ab\u5b89\u5168\u5ffd\u7565,\u4e0d\u5f97\u89e6\u78b0\u4efb\u4f55\u8bcd
  ],
};
const out = resolveVariantText(source, variant);
assert.strictEqual(out.length, source.length, 'variant never changes word count');
assert.strictEqual(out[0].text, 'hello', 'i=0 text swapped');
assert.strictEqual(out[1].text, '\u4e16\u754c', 'no entry for i=1 → source text');
assert.strictEqual(out[2].text, 'bye', 'i=2 text swapped');
//  start/end/speaker
for (let i = 0; i < source.length; i++) {
  assert.strictEqual(out[i].start, source[i].start, `word ${i} start from source`);
  assert.strictEqual(out[i].end, source[i].end, `word ${i} end from source`);
  assert.strictEqual(out[i].speaker, source[i].speaker, `word ${i} speaker from source`);
}
// : i=1 ()
assert.ok(Object.is(out[1], source[1]), 'untouched word keeps the source reference');

// ── 2)  = (,) ──
const empty: TranscriptVariant = { id: 'e', lang: 'x', kind: 'corrected', label: 'x', words: [] };
assert.ok(Object.is(resolveVariantText(source, empty), source), 'empty variant is a no-op (same array reference)');

// ── 3)  retime  retime  ────────────────
// (,)
const fps = 30;
const timedSource = retimeWords(source, new Set(), fps, 0);
const timedVariant = retimeWords(out, new Set(), fps, 0);
assert.strictEqual(timedVariant.length, timedSource.length, 'retime keeps the same word count');
for (let i = 0; i < timedSource.length; i++) {
  assert.strictEqual(timedVariant[i].start, timedSource[i].start, `retimed start ${i} unaffected by variant text`);
  assert.strictEqual(timedVariant[i].end, timedSource[i].end, `retimed end ${i} unaffected by variant text`);
}
// ()
assert.strictEqual(timedVariant[0].text, 'hello');
assert.strictEqual(timedVariant[2].text, 'bye');

// ── 4) createVariant:(LLM ) ──
const built = createVariant({
  lang: '  \u65e5\u672c\u8a9e  ', kind: 'translation',
  words: [
    { i: 0, text: '\u3053\u3093\u306b\u3061\u306f' },
    { i: -1, text: 'bad-index' },      // \u8d1f\u4e0b\u6807 → \u4e22\u5f03
    { i: 1.5, text: 'bad-float' },     // \u975e\u6574\u6570 → \u4e22\u5f03
    { i: 2, text: 3 as unknown as string }, // \u975e\u5b57\u7b26\u4e32 → \u4e22\u5f03
  ],
});
assert.strictEqual(built.lang, '\u65e5\u672c\u8a9e', 'lang trimmed');
assert.strictEqual(built.label, '\u65e5\u672c\u8a9e', 'translation label defaults to lang');
assert.deepStrictEqual(built.words, [{ i: 0, text: '\u3053\u3093\u306b\u3061\u306f' }], 'only the valid word entry survives');
assert.ok(built.id.startsWith('var_'), 'variant gets an id');
assert.throws(() => createVariant({ lang: '   ', kind: 'translation', words: [] }), /lang is required/);

// ── 5) upsertVariant / findVariantByLang: +  ──
const list0: TranscriptVariant[] = [];
const list1 = upsertVariant(list0, built);
assert.strictEqual(list0.length, 0, 'upsert does not mutate the input list');
assert.strictEqual(list1.length, 1);
const replaced = createVariant({ id: built.id, lang: '\u65e5\u672c\u8a9e', kind: 'translation', words: [{ i: 0, text: '\u3084\u3042' }] });
const list2 = upsertVariant(list1, replaced);
assert.strictEqual(list2.length, 1, 'same id replaces in place');
assert.strictEqual(list2[0].words[0].text, '\u3084\u3042');
assert.strictEqual(findVariantByLang(list2, '\u65e5\u672c\u8a9e', 'translation')?.id, built.id);
assert.strictEqual(findVariantByLang(list2, 'nope'), undefined);

// ── 6) :setItemVariants ,transcript/timing/ ──
const state: TimelineState = {
  fps, width: 1920, height: 1080, selectedId: null,
  items: [{ id: 'clip', track: 'A1', startFrame: 0, durationInFrames: 24, name: 'vo', kind: 'audio', src: '/vo.mp3', transcript: source }],
};
const draft = makeDraft(docFromTimeline(state));
draft.commands.setItemVariants('clip', [variant]);
const item = draft.getState().items.find((it) => it.id === 'clip')!;
assert.strictEqual(item.variants?.length, 1, 'variant persisted on the item');
assert.strictEqual(item.variants![0].id, 'v1');
assert.deepStrictEqual(item.transcript, source, 'transcript words untouched by setItemVariants');
assert.strictEqual(item.durationInFrames, 24, 'clip duration untouched');

console.log('variants.check: ok');
