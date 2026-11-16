// Runnable contract check: `npx tsx src/agent/highlight-tool.check.ts`.
// ():N →N
// /, LLM
// (/)LLM  stub  canned JSON,
import assert from 'node:assert';
import { makeDraft } from '../../editor/store';
import type { TimelineState } from '../../editor/types';
import type { TranscriptWord } from '../../transcript/types';
import { docFromTimeline } from '../../persist/projectStore';
import type { AgentContext } from '../context';
import { execHighlightTool, validateHighlights, setHighlightSelector } from './highlight-tool';

// fps 30 → msToFrame(ms)=round(ms/1000*30):0→0,500→15,1000→30,1400→42,1700→51,2000→60,2600→78,3000→90,3500→105
const words: TranscriptWord[] = [
  { text: 'hello', start: 0, end: 500, speaker: 'A' },
  { text: 'world', start: 500, end: 1000, speaker: 'A' },
  { text: 'this', start: 1000, end: 1400, speaker: 'A' },
  { text: 'is', start: 1400, end: 1700, speaker: 'A' },
  { text: 'the', start: 1700, end: 2000, speaker: 'A' },
  { text: 'best', start: 2000, end: 2600, speaker: 'A' },
  { text: 'part', start: 2600, end: 3000, speaker: 'A' },
  { text: 'ever', start: 3000, end: 3500, speaker: 'A' },
];

const state: TimelineState = {
  fps: 30, width: 1920, height: 1080, selectedId: null,
  items: [
    { id: 'talk', track: 'V1', startFrame: 0, durationInFrames: 105, name: '\u53e3\u64ad', kind: 'video', src: '/talk.mp4', transcript: words },
    { id: 'ov', track: 'V2', startFrame: 60, durationInFrames: 30, name: '\u8986\u76d6MG', kind: 'motion-graphic', code: '' },
    { id: 'far', track: 'V2', startFrame: 200, durationInFrames: 30, name: '\u8fdc\u5904MG', kind: 'motion-graphic', code: '' },
  ],
};

const draft = makeDraft(docFromTimeline(state));
const ctx: AgentContext = { commands: draft.commands, getState: draft.getState, getDoc: draft.getDoc, getCreativeMode: () => null, templates: [], audio: [] };
const originalActiveId = draft.getDoc().activeTimelineId;

// ── 1) validateHighlights :/start>end/ ────────────────────
assert.strictEqual(validateHighlights({ nope: true }, 8, 5).length, 0, '\u975e\u6570\u7ec4 → \u7a7a');
assert.strictEqual(
  validateHighlights([{ startWordIndex: -1, endWordIndex: 2 }, { startWordIndex: 5, endWordIndex: 99 }, { startWordIndex: 3, endWordIndex: 1 }], 8, 5).length,
  0, '\u8d8a\u754c\u4e0e start>end \u5168\u88ab\u4e22\u5f03',
);
const overlap = validateHighlights([{ startWordIndex: 0, endWordIndex: 3, title: 'a' }, { startWordIndex: 2, endWordIndex: 5, title: 'b' }], 8, 5);
assert.strictEqual(overlap.length, 1, '\u91cd\u53e0\u6bb5\u53bb\u91cd\u540e\u53ea\u5269\u4e00\u6761');
assert.deepStrictEqual([overlap[0].startWordIndex, overlap[0].endWordIndex], [0, 3], '\u4fdd\u7559\u5148\u51fa\u73b0\u7684\u533a\u95f4');
assert.strictEqual(
  validateHighlights([{ startWordIndex: 0, endWordIndex: 0 }, { startWordIndex: 1, endWordIndex: 1 }, { startWordIndex: 2, endWordIndex: 2 }], 8, 2).length,
  2, 'max \u4e0a\u9650\u751f\u6548',
);

// ── 2) (stub LLM):canned JSON , ──────────
setHighlightSelector(async () => [
  { startWordIndex: 0, endWordIndex: 1, title: '\u5f00\u573a' },
  { startWordIndex: 0, endWordIndex: 99, title: '\u8d8a\u754c', reason: 'bad' }, // out-of-range → dropped, not a crash
  { startWordIndex: 2, endWordIndex: 6, title: '\u6700\u7cbe\u5f69', reason: '\u9ad8\u4fe1\u606f\u5bc6\u5ea6' },
]);

const res = await execHighlightTool('find_highlights', { count: 5, ratio: '9:16' }, ctx) as {
  ok: boolean; count: number; shorts: { timelineId: string; title: string; startFrame: number; endFrame: number; ratio: string }[];
};
assert.strictEqual(res.ok, true, '\u5de5\u5177\u6210\u529f\u8fd4\u56de');
assert.strictEqual(res.shorts.length, 2, '3 \u6761\u5019\u9009\u91cc\u8d8a\u754c\u7684\u88ab\u5254\u9664 → 2 \u6761\u77ed\u89c6\u9891');
assert.strictEqual(res.count, 2);

// :[0,1]=,[2,6]=
assert.deepStrictEqual(res.shorts.map((s) => s.title), ['\u5f00\u573a', '\u6700\u7cbe\u5f69']);
const hot = res.shorts[1];
assert.deepStrictEqual([hot.startFrame, hot.endFrame, hot.ratio], [30, 90, '9:16'], '\u9ad8\u5149\u5e27\u533a\u95f4\u6765\u81ea\u8bcd\u8fb9\u754c ms×fps');

const doc = draft.getDoc();
assert.strictEqual(doc.activeTimelineId, originalActiveId, 'activate:false → \u7ed3\u675f\u540e\u89c6\u56fe\u56de\u5230\u539f\u5e8f\u5217');
assert.strictEqual(doc.timelines.length, 3, '\u539f\u5e8f\u5217 + 2 \u6761\u77ed\u89c6\u9891');

//  9:16 (cover)
for (const s of res.shorts) {
  const tl = doc.timelines.find((t) => t.id === s.timelineId)!;
  assert.deepStrictEqual([tl.width, tl.height, tl.fit], [1080, 1920, 'cover'], `${s.title} \u662f\u7ad6\u5c4f 9:16 cover`);
}

// ── 3) ( [2,6]): ────────────────
const short = doc.timelines.find((t) => t.id === hot.timelineId)!;
const talk = short.items.find((it) => it.id === 'talk')!;

// ,/; deletedWordIdx
assert.strictEqual(talk.transcript!.length, 8, '\u8f6c\u5199\u8bcd\u4e00\u6761\u4e0d\u5220(\u4ec5\u6807\u8bb0\u5220\u9664),\u8bcd↔\u5e27\u4ecd\u6210\u5bf9');
assert.deepStrictEqual([...(talk.deletedWordIdx ?? [])].sort((a, b) => a - b), [0, 1, 7], '\u9ad8\u5149\u5916\u7684\u8bcd(0,1,7)\u88ab\u6807\u8bb0\u5220\u9664');
assert.strictEqual(talk.transcript![2].text, 'this', '\u4fdd\u7559\u8bcd\u6587\u672c\u672a\u6539');
assert.strictEqual(talk.transcript![2].start, 1000, '\u4fdd\u7559\u8bcd\u8d77\u70b9 ms \u672a\u6539');
assert.strictEqual(talk.transcript![6].end, 3000, '\u4fdd\u7559\u8bcd\u7ec8\u70b9 ms \u672a\u6539');
assert.deepStrictEqual(talk.transcript!.map((w) => w.text), words.map((w) => w.text), '\u4efb\u4f55\u8bcd\u7684\u6587\u672c\u90fd\u6ca1\u88ab\u6539\u5199');
//  0, =
assert.strictEqual(talk.startFrame, 0, '\u9ad8\u5149\u6bb5\u8d77\u64ad\u5e27\u5bf9\u9f50\u5230 0');
assert.strictEqual(talk.durationInFrames, 60, 'clip \u65f6\u957f = spanEnd-spanStart = 90-30');

//  clip: MG ; MG
const ov = short.items.find((it) => it.id === 'ov')!;
assert.deepStrictEqual([ov.startFrame, ov.durationInFrames], [30, 30], '\u4ea4\u53e0 MG \u88c1\u5230\u533a\u95f4\u5185\u5e76\u5e73\u79fb -spanStart');
assert.strictEqual(short.items.find((it) => it.id === 'far'), undefined, '\u533a\u95f4\u5916 MG \u88ab\u5220\u9664');
assert.strictEqual(short.items.length, 2, '\u77ed\u89c6\u9891\u53ea\u5269\u9ad8\u5149\u8de8\u5ea6\u5185\u7684 clip');

// [0,1] : MG  →
const opening = doc.timelines.find((t) => t.id === res.shorts[0].timelineId)!;
assert.strictEqual(opening.items.length, 1, '\u5f00\u573a\u77ed\u89c6\u9891\u53ea\u5269\u53e3\u64ad clip');
assert.strictEqual(opening.items[0].durationInFrames, 30, '\u5f00\u573a\u65f6\u957f = \u524d\u4e24\u8bcd\u8de8\u5ea6');

// ── 4)  → , ──────────────────────────────────
const bareState: TimelineState = { fps: 30, width: 1920, height: 1080, selectedId: null, items: [{ id: 'v', track: 'V1', startFrame: 0, durationInFrames: 90, name: 'v', kind: 'video', src: '/v.mp4' }] };
const bare = makeDraft(docFromTimeline(bareState));
const bareCtx: AgentContext = { commands: bare.commands, getState: bare.getState, getDoc: bare.getDoc, getCreativeMode: () => null, templates: [], audio: [] };
const err = await execHighlightTool('find_highlights', { count: 3 }, bareCtx) as { error?: string };
assert.ok(err.error && /\u8f6c\u5199/.test(err.error), '\u65e0\u8f6c\u5199\u8fd4\u56de\u6e05\u6670\u9519\u8bef');
assert.strictEqual(bare.getDoc().timelines.length, 1, '\u9519\u8bef\u8def\u5f84\u4e0d\u65b0\u5efa\u4efb\u4f55\u5e8f\u5217');

setHighlightSelector(null); // \u8fd8\u539f\u771f LLM \u8def\u5f84
console.log('highlight-tool.check: ok');
