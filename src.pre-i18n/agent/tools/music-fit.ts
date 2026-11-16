// Pure music-bed planning helpers. No runtime imports on purpose: the agent tool
// that uses them pulls the analysis store (IndexedDB + transport), while
// `music-tools.verify.ts` must be able to import this module under plain tsx.

export interface MusicCandidate {
  /** Asset id usable with add_music_track. */
  id: string;
  name: string;
  seconds: number;
  /** Cached Beat This tempo, or null when the asset has not been analysed. */
  bpm: number | null;
  /** Cached tempo confidence 0–1, or null. */
  confidence: number | null;
  tags: string[];
}

export interface MusicFit {
  rangeSeconds: number;
  cutsPerMinute: number;
  mood?: string;
}

export interface MusicScore {
  score: number;
  reasons: string[];
}

/**
 * Deterministic fit score (0–100) for one candidate.
 * Weights: duration coverage 40, tempo-vs-cut-pace 40, analysis confidence 10, mood 10.
 */
export function scoreMusicCandidate(candidate: MusicCandidate, fit: MusicFit): MusicScore {
  const reasons: string[] = [];
  let score = 0;

  // 1. Duration coverage — being longer than the range stops paying off past 1.4x.
  if (fit.rangeSeconds > 0 && candidate.seconds > 0) {
    const coverage = Math.min(1.4, candidate.seconds / fit.rangeSeconds);
    score += Math.min(40, coverage * 34);
    if (candidate.seconds >= fit.rangeSeconds) {
      reasons.push(`covers the ${fit.rangeSeconds.toFixed(1)}s range without looping`);
    } else {
      reasons.push(`only ${candidate.seconds.toFixed(1)}s long — needs looping`);
    }
  }

  // 2. Tempo versus cut pace — best when cuts land on a beat, half-bar, or bar.
  if (candidate.bpm && candidate.bpm > 0 && fit.cutsPerMinute > 0) {
    const beatsPerSecond = candidate.bpm / 60;
    const cutsPerSecond = fit.cutsPerMinute / 60;
    const cutsPerBeat = cutsPerSecond / beatsPerSecond;
    const distance = Math.min(
      Math.abs(Math.log2(cutsPerBeat / 1)),
      Math.abs(Math.log2(cutsPerBeat / 0.5)),
      Math.abs(Math.log2(cutsPerBeat / 0.25)),
    );
    score += Math.max(0, 40 - distance * 24);
    if (40 - distance * 24 >= 26) {
      reasons.push(`tempo matches the cut pace (${Math.round(candidate.bpm)} BPM vs ${fit.cutsPerMinute.toFixed(1)} cuts/min)`);
    } else {
      reasons.push(`tempo does not align with the cut pace (${Math.round(candidate.bpm)} BPM)`);
    }
  } else {
    score += 12;
    reasons.push('no cached tempo — run analyze_music for beat-accurate cuts');
  }

  // 3. Cached analysis confidence.
  if (candidate.confidence !== null) score += Math.max(0, Math.min(10, candidate.confidence * 10));

  // 4. Mood match against the asset name and top CLAP tags.
  const mood = fit.mood?.trim().toLowerCase();
  if (mood) {
    const haystack = `${candidate.name} ${candidate.tags.join(' ')}`.toLowerCase();
    if (haystack.includes(mood)) {
      score += 10;
      reasons.push(`matches mood "${fit.mood?.trim()}"`);
    }
  }

  return { score: Math.round(Math.max(0, Math.min(100, score))), reasons };
}

export interface MusicPlacement {
  startFrame: number;
  durationInFrames: number;
}

/**
 * Lay a track of `assetFrames` over [fromFrame, toFrame), repeating it when
 * `loop` is true. Never returns a tail shorter than `minFrames`, and never
 * more than `maxPlacements` clips.
 */
export function planMusicPlacements(
  assetFrames: number,
  fromFrame: number,
  toFrame: number,
  loop: boolean,
  fps: number,
  maxPlacements = 64,
): MusicPlacement[] {
  const span = Math.max(1, Math.round(assetFrames));
  const minFrames = Math.max(1, Math.round((fps || 30) * 0.2));
  const placements: MusicPlacement[] = [];
  let cursor = fromFrame;
  while (cursor < toFrame && placements.length < maxPlacements) {
    const remaining = toFrame - cursor;
    const duration = Math.min(span, remaining);
    if (duration < minFrames) break;
    placements.push({ startFrame: cursor, durationInFrames: duration });
    cursor += duration;
    if (!loop) break;
  }
  return placements;
}
