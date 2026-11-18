// Generate subtitles from the audio actually on the timeline.
//
// The Subtitles tab used to be a styling surface only: it could recolour and
// re-time captions but had no way to *produce* them, so a project with no
// transcript showed "Please create a subtitle track first" with no path out of
// that state. This module is that path.
//
// Deliberately, it does NOT compute caption timings itself. The store already
// carries per-clip transcripts, and `captions/resolve.ts` projects those onto
// the timeline while honouring trim in-points, playback rate, deleted words and
// silence compaction. Re-deriving that here would duplicate a subtle, heavily
// tested calculation and drift from it the first time either side changed. So
// the flow is:
//
//   1. Pick the audio-bearing clips on the track.
//   2. Transcribe them with the same provider router the Transcript tab uses,
//      so settings, keys and error messages are identical.
//   3. Write the result onto the item via `setItemTranscript`.
//   4. Bind a caption to those items and let the projection place the cues.
//
// Provider timings are relative to the SOURCE FILE, never the timeline. Because
// step 4 reuses the projection that already knows the clip's `srcInFrame` and
// `playbackRate`, a clip placed 30s in or trimmed 5s from the head still lands
// its subtitles on the right frames.
import type { TimelineItem, TrackId } from '../editor/types';
import type { TranscriptResult, TranscriptWord } from '../transcript/types';
import { mediaOnTrack } from '../transcript/trackOptions';

/** A clip queued for transcription. */
export interface CaptionSourcePlan {
  itemId: string;
  label: string;
  /** Same-origin media path handed to the ASR provider. */
  path: string;
}

/** Clips that contribute audio on this track, in timeline order. */
function audibleMedia(track: TrackId, items: TimelineItem[]): TimelineItem[] {
  return mediaOnTrack(items, track).filter((item) => !isSilent(item));
}

/**
 * Clips worth transcribing on a track.
 *
 * `mediaOnTrack` already filters to audio/video items that have a `src` (nothing
 * else has sound to detect) and sorts by start frame, so the transcripts come
 * back in timeline order.
 */
export function captionSources(track: TrackId, items: TimelineItem[]): CaptionSourcePlan[] {
  return audibleMedia(track, items).map((item) => ({
    itemId: item.id,
    label: item.name?.trim() || item.id,
    path: item.src as string,
  }));
}

/**
 * True when the clip contributes no audible signal, so transcribing it is pointless.
 * Muting is a per-TRACK flag in this editor, not per-clip, so the only per-clip
 * silence signal is a zero volume.
 */
export function isSilent(item: TimelineItem): boolean {
  return item.volume === 0;
}

/**
 * Readiness check so the UI can disable the button with an honest reason
 * instead of failing after a click (and after a costly upload).
 */
export function captionReadiness(track: TrackId, items: TimelineItem[]): {
  ok: boolean;
  /** Audible clips on the track. */
  count: number;
  /** How many of those already carry a transcript. */
  transcribed: number;
  /** Why generation is unavailable, phrased as what to do next. */
  reason?: string;
} {
  const media = items.filter(
    (item) => item.track === track && !!item.src && (item.kind === 'audio' || item.kind === 'video'),
  );
  if (!media.length) {
    // Distinguish "the track is empty" from "the track only holds things with no
    // audio" (motion graphics, titles, solids). Both block generation, but the
    // fix is different, and a generic "no audio" message made the second case
    // look like a bug.
    const anythingThere = items.some((item) => item.track === track);
    return {
      ok: false,
      count: 0,
      transcribed: 0,
      reason: anythingThere
        ? 'This track only has graphics or titles, which carry no sound. Import a video or audio clip with speech, then generate subtitles.'
        : 'This track is empty. Import a video or audio clip with speech, then generate subtitles.',
    };
  }
  const audible = media.filter((item) => !isSilent(item));
  if (!audible.length) {
    return {
      ok: false,
      count: 0,
      transcribed: 0,
      reason: 'Every clip on this track has zero volume, so there is no speech to detect.',
    };
  }
  const transcribed = audible.filter((item) => (item.transcript?.length ?? 0) > 0).length;
  return { ok: true, count: audible.length, transcribed };
}

/** Flatten a provider result into words, falling back to utterance word arrays. */
export function wordsOf(result: TranscriptResult): TranscriptWord[] {
  if (result.words?.length) return result.words;
  return (result.utterances ?? []).flatMap((utterance) => utterance.words ?? []);
}

/**
 * Clips on `track` that still need a transcript.
 *
 * Re-running after a partial failure therefore retries only what is missing
 * instead of re-uploading everything, which matters because each upload costs
 * time and provider quota.
 */
export function pendingSources(track: TrackId, items: TimelineItem[]): CaptionSourcePlan[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return captionSources(track, items).filter((source) => {
    const item = byId.get(source.itemId);
    return !!item && (item.transcript?.length ?? 0) === 0;
  });
}

/** Total spoken duration of a result, used only for a progress hint. */
export function speechSpanMs(words: TranscriptWord[]): number {
  if (!words.length) return 0;
  return Math.max(0, words[words.length - 1]!.end - words[0]!.start);
}

/** Format ms as `m:ss`. */
export function formatSpan(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
