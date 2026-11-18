import { useMemo, useState } from 'react';
import type { TimelineItem, TrackId } from '../editor/types';
import type { CaptionsData } from './types';
import type { TranscriptWord } from '../transcript/types';
import { useT } from '../i18n/locale';
import { useTranscript } from '../transcript/useTranscript';
import { mediaOnTrack, trackTitle, type TranscriptTrackOption } from '../transcript/trackOptions';
import {
  captionReadiness, formatSpan, isSilent, pendingSources, speechSpanMs, wordsOf,
} from './autoCaptions';

interface Props {
  items: TimelineItem[];
  /** Every video/audio track — the source of the speech, chosen by the user. */
  trackOptions: TranscriptTrackOption[];
  captionTracks: Array<TranscriptTrackOption & { captions: CaptionsData | null }>;
  onCreateCaptionTrack: (captions: CaptionsData, opts?: { name?: string; order?: number }) => TrackId;
  onSetItemTranscript: (id: string, words: TranscriptWord[]) => void;
  /** Called after a track is created so the parent can select it. */
  onCreated: (track: TrackId) => void;
}

/**
 * "Detect speech and generate subtitles" — the missing entry point in the
 * Subtitles tab.
 *
 * Before this existed the panel could only style captions that some *other*
 * surface had already produced, so an empty project was a dead end. This walks
 * the user through the one thing they asked for: pick the audio, transcribe it,
 * get timed captions.
 */
export function GenerateSubtitles({
  items, trackOptions, captionTracks, onCreateCaptionTrack, onSetItemTranscript, onCreated,
}: Props) {
  const t = useT();
  const { runMany, reset, progressNote, error } = useTranscript();

  // Default to the first track that actually has audible media, so the common
  // case (one video track with one clip) needs no choices at all.
  const mediaTracks = useMemo(
    () => trackOptions.filter((option) => mediaOnTrack(items, option.id).length > 0),
    [trackOptions, items],
  );
  const [sourceTrack, setSourceTrack] = useState<TrackId | null>(
    () => mediaTracks.find((option) => captionReadiness(option.id, items).ok)?.id ?? mediaTracks[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  // A previously chosen track can disappear (clip deleted / track removed).
  const activeTrack = sourceTrack && mediaTracks.some((option) => option.id === sourceTrack)
    ? sourceTrack
    : mediaTracks[0]?.id ?? null;

  const readiness = useMemo(
    () => (activeTrack
      ? captionReadiness(activeTrack, items)
      : {
        ok: false,
        count: 0,
        transcribed: 0,
        reason: 'Add a video or audio clip with speech to the timeline, then generate subtitles from it.',
      }),
    [activeTrack, items],
  );
  const pending = useMemo(
    () => (activeTrack ? pendingSources(activeTrack, items) : []),
    [activeTrack, items],
  );

  const existingCaptionCount = captionTracks.filter((option) => option.captions?.enabled).length;

  const generate = async () => {
    if (!activeTrack || !readiness.ok || busy) return;
    // Transcribe only clips that are still missing a transcript. When all of
    // them already have one, fall through and just build the caption from what
    // is stored — no second upload.
    const jobs = pending.map((source) => ({ path: source.path, itemId: source.itemId, label: source.label }));
    setBusy(true);
    setReport(null);
    reset();
    try {
      let transcribed = 0;
      let spokenMs = 0;
      if (jobs.length) {
        await runMany(jobs, (itemId, result) => {
          const words = wordsOf(result);
          transcribed += 1;
          spokenMs += speechSpanMs(words);
          onSetItemTranscript(itemId, words);
        });
      }

      // Bind the caption to the clips that now carry a transcript. Using the
      // item ids (rather than pre-shifted word arrays) is what lets the store
      // project cues onto the timeline with trim/rate applied.
      const bound = mediaOnTrack(items, activeTrack)
        .filter((item) => !isSilent(item))
        .map((item) => item.id);
      const sourceIds = bound.filter((id) => {
        const item = items.find((candidate) => candidate.id === id);
        // A clip transcribed just now has no stored transcript on this render,
        // so keep it — `jobs` already proved it was processed.
        return !item || (item.transcript?.length ?? 0) > 0 || jobs.some((job) => job.itemId === id);
      });

      if (!sourceIds.length) {
        setReport(t('Nothing to subtitle — no clip on this track produced any speech.'));
        return;
      }

      const captions: CaptionsData = {
        enabled: true,
        template: 'black-bar',
        pacing: 'phrase',
        sourceItemId: sourceIds[0],
        sources: sourceIds.length > 1 ? sourceIds : undefined,
        sourceMode: sourceIds.length > 1 ? 'item' : undefined,
        bilingual: false,
      };
      const created = onCreateCaptionTrack(captions, { name: t('Subtitles') });
      onCreated(created);

      // A silent track (music only, or speech the provider could not read) is a
      // legitimate outcome, so say so rather than implying success.
      setReport(
        spokenMs > 0
          ? t('Generated subtitles from {n} clip(s) · {span} of speech', { n: String(transcribed), span: formatSpan(spokenMs) })
          : t('Created a subtitle track. No speech was detected, so it is empty — you can type captions in below.'),
      );
    } catch (cause) {
      // `runMany` already surfaces a readable message through `error`; keep the
      // panel usable and let that note render.
      setReport(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const active = mediaTracks.find((option) => option.id === activeTrack) ?? null;
  const nothingLeftToDo = readiness.ok && pending.length === 0 && readiness.transcribed > 0;
  const disabled = !readiness.ok || busy;

  return (
    <div className="cc-subgen">
      <div className="cc-subgen-head">
        <span className="cc-subgen-mark" aria-hidden="true">
          {/* Waveform-ish glyph: this control listens to audio. */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
          </svg>
        </span>
        <div className="cc-subgen-titles">
          <strong>{t('Generate subtitles from audio')}</strong>
          <span>
            {nothingLeftToDo
              ? t('Speech already detected on this track.')
              : t('Detects speech and writes timed captions for you.')}
          </span>
        </div>
      </div>

      {mediaTracks.length > 1 && (
        <label className="cc-subgen-field">
          <span>{t('Listen to')}</span>
          <select
            value={activeTrack ?? ''}
            disabled={busy}
            onChange={(event) => { setSourceTrack(event.target.value as TrackId); setReport(null); }}
          >
            {mediaTracks.map((option) => (
              <option key={option.id} value={option.id}>{trackTitle(option)}</option>
            ))}
          </select>
        </label>
      )}

      {!readiness.ok && readiness.reason && (
        <p className="cc-subgen-note warn">{t(readiness.reason)}</p>
      )}

      {readiness.ok && (
        <p className="cc-subgen-note">
          {t('{n} clip(s) on {track} will be transcribed.', {
            n: String(pending.length || readiness.transcribed),
            track: active ? trackTitle(active) : '',
          })}
        </p>
      )}

      {busy && progressNote && (
        <p className="cc-subgen-note progress" role="status" aria-live="polite">{progressNote}</p>
      )}

      {!busy && (error || report) && (
        <p className={`cc-subgen-note${error ? ' error' : ''}`}>{error ?? report}</p>
      )}

      <button
        type="button"
        className="cc-subgen-run"
        onClick={() => void generate()}
        disabled={disabled}
        title={readiness.ok ? undefined : readiness.reason}
      >
        {busy ? t('Detecting speech…') : nothingLeftToDo ? t('Rebuild subtitles') : t('Generate subtitles')}
      </button>

      {existingCaptionCount > 0 && !busy && (
        <p className="cc-subgen-foot">
          {t('Tip: this replaces the caption style on the track it creates. Existing tracks are left alone.')}
        </p>
      )}
    </div>
  );
}
