// Runnable check: `npx tsx src/audio/silence.verify.ts`.
// Verification: Dead air detection on synthetic PCM (relative threshold/breathing port/minimum duration/music bed does not cut/pure noise floor does not exit the segment).
import assert from 'node:assert/strict';
import { detectSilentSpans, rmsEnvelope } from './silence';

const SR = 48_000;

/** Synthesize mono: Press [amplitude, milliseconds] to segment the waveform (sine 220Hz, amplitude control level). */
function synth(segments: Array<[amp: number, ms: number]>): Float32Array {
  const total = segments.reduce((a, [, ms]) => a + Math.round((SR * ms) / 1000), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const [amp, ms] of segments) {
    const n = Math.round((SR * ms) / 1000);
    for (let i = 0; i < n; i++) out[at + i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR);
    at += n;
  }
  return out;
}

const WIN = 50;
const spansOf = (samples: Float32Array, params = {}) =>
  detectSilentSpans(rmsEnvelope(samples, SR, WIN), WIN, params);

// ── Voice - long pause - voice: find the dead breath segment in the middle, and the boundary includes the breathing port ──
const talkPauseTalk = synth([[0.3, 2000], [0.002, 1500], [0.3, 2000]]);
const spans = spansOf(talkPauseTalk);
assert.equal(spans.length, 1, '\u4e00\u6bb5\u957f\u505c\u987f → \u4e00\u4e2a\u6b7b\u6c14\u6bb5');
const [span] = spans;
assert.ok(span!.startMs >= 2000 && span!.startMs <= 2000 + 300, `\u8d77\u70b9\u5728\u505c\u987f\u5f00\u59cb+\u547c\u5438\u53e3\u9644\u8fd1(${span!.startMs})`);
assert.ok(span!.endMs <= 3500 - 100 && span!.endMs >= 3500 - 400, `\u7ec8\u70b9\u7559\u547c\u5438\u53e3(${span!.endMs})`);

// ── Short pause (< minSilenceMs) without moving ──
assert.equal(spansOf(synth([[0.3, 1000], [0.002, 400], [0.3, 1000]])).length, 0, '400ms \u505c\u987f\u4e0d\u5220');

// ──Customized minSilenceMs takes effect──
assert.equal(spansOf(synth([[0.3, 1000], [0.002, 400], [0.3, 1000]]), { minSilenceMs: 300 }).length, 1, '\u8c03\u4f4e\u4e0b\u9650\u540e 400ms \u53ef\u5220');

// ── Music bed: continuous sound, zero life ──
assert.equal(spansOf(synth([[0.2, 5000]])).length, 0, '\u6301\u7eed\u97f3\u4e50\u4e0d\u5207');

// ── Pure noise (no voice reference): no segment ──
assert.equal(spansOf(synth([[0.003, 5000]])).length, 0, '\u6574\u6bb5\u6ca1\u8bed\u97f3 → \u4e0d\u52a8');

// ── Relative threshold: soft voice segments (lower than speech but not low enough) are not considered dead ──
const softMid = synth([[0.3, 1500], [0.05, 1500], [0.3, 1500]]);
assert.equal(spansOf(softMid).length, 0, '-16dB \u7684\u8f7b\u58f0\u4e0d\u5220');
const deadMid = synth([[0.3, 1500], [0.005, 1500], [0.3, 1500]]);
assert.equal(spansOf(deadMid).length, 1, '-36dB \u7684\u6b7b\u6c14\u5220');

// ──Multiple pauses to hit one by one──
const multi = synth([[0.3, 1200], [0.002, 900], [0.3, 1200], [0.002, 800], [0.3, 1200]]);
assert.equal(spansOf(multi).length, 2, '\u4e24\u6bb5\u505c\u987f → \u4e24\u4e2a\u6b7b\u6c14\u6bb5');

// ── Empty input / illegal window ──
assert.deepEqual(spansOf(new Float32Array(0)), [], '\u7a7a\u8f93\u5165');
assert.deepEqual(detectSilentSpans(new Float32Array(0), 0), [], '\u96f6\u7a97\u53e3');

console.log('silence.verify: ok (\u76f8\u5bf9\u9608\u503c/\u547c\u5438\u53e3/\u6700\u77ed\u65f6\u957f/\u97f3\u4e50\u5e8a/\u5e95\u566a\u5b88\u95e8)');
