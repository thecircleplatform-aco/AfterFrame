import assert from 'node:assert/strict';
import { planMusicPlacements, scoreMusicCandidate, type MusicCandidate, type MusicFit } from './music-fit';

// ---- placement planning ----------------------------------------------------

const covered = planMusicPlacements(300, 0, 1000, true, 30);
assert.equal(covered.length, 4, 'a 300-frame loop over 1000 frames needs four clips');
assert.deepEqual(covered.map((placement) => placement.startFrame), [0, 300, 600, 900]);
assert.equal(covered.reduce((total, placement) => total + placement.durationInFrames, 0), 1000, 'loop covers the range exactly');
assert.equal(covered[covered.length - 1]!.durationInFrames, 100, 'the tail is trimmed to the range end');

assert.equal(planMusicPlacements(300, 0, 1000, false, 30).length, 1, 'loop=false places a single clip');

const tinyTail = planMusicPlacements(300, 0, 303, true, 30);
assert.equal(tinyTail.length, 1, 'a sub-0.2s tail is dropped instead of creating a sliver clip');

assert.equal(planMusicPlacements(300, 0, 0, true, 30).length, 0, 'an empty range places nothing');

// ---- scoring ---------------------------------------------------------------

const fit: MusicFit = { rangeSeconds: 20, cutsPerMinute: 60 };
const candidate = (over: Partial<MusicCandidate>): MusicCandidate => ({
  id: 'x', name: 'Track', seconds: 25, bpm: 60, confidence: 0.9, tags: [], ...over,
});

const covering = scoreMusicCandidate(candidate({ id: 'cover', seconds: 25 }), fit);
const looping = scoreMusicCandidate(candidate({ id: 'short', seconds: 8 }), fit);
assert.ok(covering.score > looping.score, 'a track that covers the range outranks one that must loop');
assert.ok(covering.reasons.some((reason) => reason.includes('without looping')));

const aligned = scoreMusicCandidate(candidate({ id: 'aligned', bpm: 60 }), fit);
const mismatched = scoreMusicCandidate(candidate({ id: 'fast', bpm: 173 }), fit);
assert.ok(aligned.score > mismatched.score, 'tempo that matches the cut pace outranks a mismatched one');

const unknownTempo = scoreMusicCandidate(candidate({ id: 'unknown', bpm: null, confidence: null }), fit);
assert.ok(unknownTempo.reasons.some((reason) => reason.includes('no cached tempo')), 'unanalysed assets explain themselves');

const moodHit = scoreMusicCandidate(
  candidate({ id: 'mood', name: 'Upbeat Pop', tags: ['happy'] }),
  { ...fit, mood: 'upbeat' },
);
const moodMiss = scoreMusicCandidate(
  candidate({ id: 'mood', name: 'Upbeat Pop', tags: ['happy'] }),
  fit,
);
assert.equal(moodHit.score, moodMiss.score + 10, 'a mood match adds exactly 10 points');

for (const score of [covering, looping, aligned, mismatched, unknownTempo]) {
  assert.ok(score.score >= 0 && score.score <= 100, 'scores stay inside 0–100');
  assert.ok(score.reasons.length > 0, 'every score explains itself');
}

console.log('music tools verification passed');
