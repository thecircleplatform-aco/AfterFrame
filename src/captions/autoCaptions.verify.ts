// Verifies the "generate subtitles from audio" flow.
//
// The interesting risk is not the UI: it is that the caption ends up bound to
// the right clips, that a silent/absent track is refused with a reason instead
// of throwing, and that a re-run only retries what is missing (each retry costs
// an upload and provider quota).
//
// Timing is deliberately NOT asserted here. Cue placement is owned by
// `captions/resolve.ts` (which knows trim in-points, playback rate, deleted words
// and silence compaction) and is covered by its own verify suite. This file
// asserts the boundary: which clips are selected, and that the words written
// onto them are the provider's words unchanged.
import assert from 'node:assert/strict';
import type { TimelineItem } from '../editor/types';
import type { TranscriptWord } from '../transcript/types';
import { captionReadiness, captionSources, pendingSources, speechSpanMs, wordsOf } from './autoCaptions';

const track = 'track_v1';

function clip(over: Partial<TimelineItem> & { id: string }): TimelineItem {
  return {
    track,
    startFrame: 0,
    durationInFrames: 300,
    name: over.id,
    kind: 'video',
    src: `/media/${over.id}.mp4`,
    ...over,
  } as TimelineItem;
}

const W = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end });

// ── word extraction ─────────────────────────────────────────────────────────
{
  const words = [W('hello', 0, 400), W('world', 400, 900)];
  assert.deepEqual(wordsOf({ text: 'hello world', words, utterances: [] }), words, 'uses top-level words');

  // Some providers only populate utterance-word arrays; falling back keeps them usable.
  const fromUtterances = wordsOf({
    text: 'a b',
    words: [],
    utterances: [{ speaker: 'A', text: 'a b', start: 0, end: 500, words: [W('a', 0, 200), W('b', 200, 500)] }],
  });
  assert.equal(fromUtterances.length, 2, 'falls back to utterance words');
  assert.equal(fromUtterances[1]!.text, 'b');
}

// ── source selection ────────────────────────────────────────────────────────
{
  const items = [
    clip({ id: 'v1', startFrame: 0 }),
    clip({ id: 'v2', startFrame: 600 }),
    // Different track: must not be picked up.
    clip({ id: 'other', track: 'track_v2', startFrame: 0 }),
    // No source: nothing to read.
    clip({ id: 'nosrc', src: undefined, startFrame: 900 }),
  ];
  const sources = captionSources(track, items);
  assert.deepEqual(sources.map((s) => s.itemId), ['v1', 'v2'], 'picks audio-bearing clips on the chosen track, in timeline order');

  // Volume 0 contributes no signal and is skipped.
  const muted = [clip({ id: 'silent', volume: 0 }), clip({ id: 'loud' })];
  assert.deepEqual(captionSources(track, muted).map((s) => s.itemId), ['loud'], 'skips zero-volume clips');
}

// ── readiness ───────────────────────────────────────────────────────────────
{
  const empty = captionReadiness(track, [clip({ id: 'other', track: 'track_v9' })]);
  assert.equal(empty.ok, false, 'no media on track is not ready');
  assert.match(empty.reason ?? '', /track is empty/i, 'explains why, instead of failing on click');

  // A track holding only graphics has nothing to listen to. The message must
  // differ from the empty-track one, because the fix is different.
  const graphicsOnly = captionReadiness(track, [clip({ id: 'mg', kind: 'motion-graphic', src: undefined })]);
  assert.equal(graphicsOnly.ok, false);
  assert.match(graphicsOnly.reason ?? '', /graphics or titles/i, 'distinguishes a graphics-only track from an empty one');

  const allMuted = captionReadiness(track, [clip({ id: 'a', volume: 0 })]);
  assert.equal(allMuted.ok, false);
  assert.match(allMuted.reason ?? '', /zero volume/i);

  const ready = captionReadiness(track, [clip({ id: 'a' }), clip({ id: 'b' })]);
  assert.equal(ready.ok, true);
  assert.equal(ready.count, 2);
  assert.equal(ready.transcribed, 0);

  const done = captionReadiness(track, [clip({ id: 'a', transcript: [W('hi', 0, 100)] }), clip({ id: 'b' })]);
  assert.equal(done.transcribed, 1, 'counts clips that already have a transcript');
}

// ── pending (retry only what is missing) ────────────────────────────────────
{
  const items = [
    clip({ id: 'done', transcript: [W('hi', 0, 100)] }),
    clip({ id: 'todo' }),
    clip({ id: 'muted', volume: 0 }),
  ];
  assert.deepEqual(pendingSources(track, items).map((s) => s.itemId), ['todo'],
    're-running transcribes only untranscribed clips');
}

// ── speech span (progress hint only) ────────────────────────────────────────
{
  assert.equal(speechSpanMs([]), 0);
  assert.equal(speechSpanMs([W('a', 1000, 1400), W('b', 1400, 7500)]), 6500);
}

console.log('autoCaptions.verify: source selection, readiness and retry scoping are correct');
