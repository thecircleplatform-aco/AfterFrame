// :① ② ③
// ④ ⑤ ⑥ opts  paginate ()
//  segmenter.ts ;:npx tsx src/captions/segmenter.check.ts
import assert from 'node:assert/strict';
import { scoreLatinBreaks, segmentWords } from './segmenter';
import type { CaptionPage } from './types';
import { paginate } from './types';
import type { TranscriptWord } from '../transcript/types';

const S = (texts: string[]) => texts.map((text) => ({ text }));
const W = (texts: string[], gapMs = 10, durMs = 90): TranscriptWord[] =>
  texts.map((text, i) => ({ text, start: i * (durMs + gapMs), end: i * (durMs + gapMs) + durMs }));
const pageTexts = (pages: CaptionPage[]) => pages.map((p) => p.words.map((w) => w.text).join(''));

// ── ① /(oHe: →100 / ，→80 ) ──────────────
{
  const words = S(['\u4eca\u5929', '\u5929\u6c14', '\u771f\u597d\u3002', '\u6211\u4eec', '\u4e00\u8d77', '\u53bb', '\u516c\u56ed']);
  // , →
  assert.deepEqual(segmentWords(words, { wordsPerPage: 50, maxCharsPerLine: 20 }), [0, 3]);

  const comma = S(['\u6211\u8bf4，', '\u5927\u5bb6', '\u90fd', '\u8981', '\u6765', '\u6211\u5bb6', '\u5403\u996d']);
  assert.deepEqual(segmentWords(comma, { wordsPerPage: 50, maxCharsPerLine: 20 }), [0, 1]);
}

// ── ② // ─────────────────────────────────────────────
{
  // :aHe (60),
  const ne = S(['\u4f60', '\u5728', '\u60f3', '\u4ec0\u4e48', '\u5462', '\u660e\u5929', '\u6211\u4eec', '\u51fa\u53d1']);
  const starts = segmentWords(ne, { wordsPerPage: 50, maxCharsPerLine: 20 });
  assert.deepEqual(starts, [0, 5]); // \u98752 \u4ece\u300c\u660e\u5929\u300d\u8d77,\u300c\u5462\u300d\u6536\u5728\u98751 \u672b\u5c3e
  // :mA (/ ∈ Q9)
  const ma = S(['\u4f60', '\u5403', '\u4e86', '\u5417', '\u6211\u4eec', '\u8d70']);
  const maStarts = segmentWords(ma, { wordsPerPage: 50, maxCharsPerLine: 8 });
  assert.ok(!maStarts.includes(2) && !maStarts.includes(3), '\u300c\u4e86\u300d\u300c\u5417\u300d\u4e0d\u5f97\u4e3a\u9875\u9996');
  for (const st of maStarts) assert.ok(!['\u4e86', '\u5417', '\u5462', '\u554a'].includes(Array.from(ma[st].text)[0]), '\u8bed\u6c14\u8bcd\u9875\u9996');
  for (const st of starts) assert.ok(!['\u4e86', '\u5417', '\u5462', '\u554a'].includes(Array.from(ne[st].text)[0]), '\u8bed\u6c14\u8bcd\u9875\u9996');
  // FHe :2  G9e  →  fine
  const pull = S(['OK', 'fine', '\u4e86\u89e3', '\u4e00\u4e0b', '\u5427']);
  assert.deepEqual(segmentWords(pull, { wordsPerPage: 50, maxCharsPerLine: 15 }), [0, 1]);
}

// ── ③ (mA:  ∈ Q9 →  30) ──────────
{
  const words = S(['\u6211', '\u4e70', '\u7684', '\u82f9\u679c', '\u5f88', '\u597d\u5403', '\u975e\u5e38', '\u65b0\u9c9c']);
  const starts = segmentWords(words, { wordsPerPage: 50, maxCharsPerLine: 10 });
  assert.deepEqual(starts, [0, 4, 7]);
  assert.ok(!starts.includes(2), '\u300c\u7684\u300d\u4e0d\u5f97\u4e3a\u9875\u9996(\u4e70|\u7684 \u4e0d\u62c6)');
  assert.ok(!starts.includes(3), '\u300c\u7684\u300d\u4e0d\u5f97\u60ac\u5728\u9875\u5c3e(\u7684|\u82f9\u679c \u4e0d\u62c6)');
}

// ── ④ : 1-2 (U9e quantifier-of/trailing + cP ) ──
{
  const words = S(['We', 'learned', 'quite', 'a', 'lot', 'of', 'things', 'today']);
  const starts = segmentWords(words, { wordsPerPage: 50, maxCharsPerLine: 30 });
  //  things;a/lot/of  →  quite
  assert.deepEqual(starts, [0, 3]);
  const pages = [words.slice(0, 3), words.slice(3)].map((ws) => ws.map((w) => w.text));
  assert.equal(pages[0].join(' '), 'We learned quite');
  assert.equal(pages[1].join(' '), 'a lot of things today');
  for (let i = 0; i < starts.length; i++) {
    const end = (starts[i + 1] ?? words.length) - 1;
    assert.notEqual(words[end].text, 'of', '\u9875\u5c3e\u4e0d\u5f97\u60ac\u7a7a of');
  }
}

// ── ⑤  . (z9e 100 +  +30 = 130) ─────────────────────────
{
  const words = S(['I', 'like', 'it.', 'Because', 'it', 'works', 'well', 'today']);
  assert.deepEqual(segmentWords(words, { wordsPerPage: 50, maxCharsPerLine: 30 }), [0, 3]);
  // (, segmenter.ts  2)
  assert.deepEqual(segmentWords(S(['I', 'like', 'it.', 'Because', 'it', 'works']), { wordsPerPage: 4 }), [0, 3]);
  // H9e : 100+30
  const top = scoreLatinBreaks('We had fun. So it goes')[0];
  assert.equal(top.score, 130);
  assert.equal(top.position, 'We had fun.'.length);
}

// ── : / M1e CJK  /  ───────────────────────
{
  const starts = segmentWords(S(['Hello', 'world', '!', 'again', 'now', 'yes', 'more']), { wordsPerPage: 2 });
  assert.deepEqual(starts, [0, 3, 5]); // \u300c!\u300d\u8ddf\u968f world \u6536\u5728\u98751,\u4e0d\u5f00\u9875
  // M1e :CJK  +  → wordsPerPage
  assert.deepEqual(segmentWords(S(['\u4e00\u4e8c', '\u4e09\u56db', '\u4e94\u516d', '\u4e03\u516b']), { wordsPerPage: 2, maxCharsPerLine: 100 }), [0]);
  assert.deepEqual(segmentWords(S(['aa', 'bb', 'cc', 'dd']), { wordsPerPage: 2, maxCharsPerLine: 100 }), [0, 2]);
  assert.deepEqual(segmentWords([], { wordsPerPage: 6 }), []);
  assert.deepEqual(segmentWords(S(['hi']), { wordsPerPage: 1, maxCharsPerLine: 1 }), [0]);
}

// ── paginate :maxCharsPerLine  segmenter( × );forceBreak  ──
{
  const cn = W(['\u4eca\u5929', '\u5929\u6c14', '\u771f\u597d\u3002', '\u6211\u4eec', '\u4e00\u8d77', '\u53bb', '\u516c\u56ed']);
  // 20 chars/line × CAPTION_MAX_VISUAL_LINES(2) = 40 chars — the 12-char sentence fits one page.
  assert.deepEqual(pageTexts(paginate(cn, 'phrase', 50, undefined, 20)), ['\u4eca\u5929\u5929\u6c14\u771f\u597d\u3002\u6211\u4eec\u4e00\u8d77\u53bb\u516c\u56ed']);
  const forced = paginate(cn, 'phrase', 50, new Set([5]), 20);
  assert.deepEqual(pageTexts(forced), ['\u4eca\u5929\u5929\u6c14\u771f\u597d\u3002\u6211\u4eec\u4e00\u8d77', '\u53bb\u516c\u56ed']);
  assert.equal(forced[1].words[0].text, '\u53bb'); // \u5f3a\u5236\u65ad\u70b9\u5904\u5fc5\u5f00\u65b0\u9875
  // word pacing  maxCharsPerLine
  assert.equal(paginate(cn, 'word', 6, undefined, 20).length, cn.length);
}

// ── ⑥ : maxCharsPerLine  paginate  ────────────────────
{
  // 6  flush
  const plain = W(['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh']);
  assert.deepEqual(paginate(plain, 'phrase').map((p) => p.words.length), [6, 2]);
  //  content-aware ()
  assert.deepEqual(paginate(W(['Hi', 'there.', 'Big', 'day']), 'phrase').map((p) => p.words.length), [4]);
  // ,(4  → )
  const gap: TranscriptWord[] = [
    { text: 'a', start: 0, end: 100 }, { text: 'b', start: 110, end: 200 },
    { text: 'c', start: 1000, end: 1100 }, { text: 'd', start: 1110, end: 1200 },
  ];
  assert.deepEqual(paginate(gap, 'phrase').map((p) => p.words.length), [4]);
  // forceBreak
  assert.deepEqual(paginate(W(['aa', 'bb', 'cc', 'dd']), 'phrase', 6, new Set([2])).map((p) => p.words.length), [2, 2]);
  //
  const pages = paginate(plain, 'phrase');
  assert.equal(pages[0].start, plain[0].start);
  assert.equal(pages[0].end, plain[5].end);
  assert.equal(pages[1].start, plain[6].start);
}

console.log('segmenter.check: ok');
