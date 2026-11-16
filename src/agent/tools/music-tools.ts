export { MUSIC_TOOL_NAMES } from './schemas/music-tools';

import type { AgentContext } from '../context';
import type { AudioAsset } from '../../audio/library';
import type { MediaAsset, TrackId, TimelineState } from '../../editor/types';
import { resolveTrackId, timelineTrackIds, trackAlias, trackKind } from '../../editor/types';
import { loadMusicAnalysisForAsset, musicAnalysisRef } from '../../audio/intelligence/store';
import {
  analyzeMusic,
  buildMusicEditPlan,
  normalizePlanOptions,
  resolveMusicTarget,
} from './music-intelligence-plan';
import { buildMusicSplitActions } from './music-intelligence-tools';
import {
  planMusicPlacements,
  scoreMusicCandidate,
  type MusicCandidate,
  type MusicFit,
  type MusicScore,
} from './music-fit';

type Args = Record<string, unknown>;

const MAX_SCAN_ASSETS = 24;
const MAX_PLACEMENTS = 64;
const DEFAULT_MUSIC_TRACK_NAME = 'Music';
const DEFAULT_DUCK_DB = -18;

export function timelineEndFrame(state: TimelineState): number {
  const fps = state.fps || 30;
  return Math.max(fps, state.items.reduce((end, item) => Math.max(end, item.startFrame + item.durationInFrames), 0));
}

function resolveRange(state: TimelineState, args: Args): { fromFrame: number; toFrame: number } | { error: string } {
  const fromFrame = typeof args.fromFrame === 'number' && Number.isFinite(args.fromFrame)
    ? Math.max(0, Math.round(args.fromFrame))
    : 0;
  const toFrame = typeof args.toFrame === 'number' && Number.isFinite(args.toFrame)
    ? Math.round(args.toFrame)
    : timelineEndFrame(state);
  if (!(toFrame > fromFrame)) return { error: `empty range: fromFrame=${fromFrame} toFrame=${toFrame}` };
  return { fromFrame, toFrame };
}

/** Cut points (clip starts) strictly inside the range — the pace the music has to support. */
export function cutFramesInRange(state: TimelineState, fromFrame: number, toFrame: number): number[] {
  return state.items
    .filter((item) => trackKind(state, item.track) === 'video')
    .map((item) => item.startFrame)
    .filter((frame) => frame > fromFrame && frame < toFrame)
    .sort((left, right) => left - right);
}

function audioAssets(ctx: AgentContext): MediaAsset[] {
  return ctx.getDoc().assets.filter((asset) => asset.kind === 'audio').slice(0, MAX_SCAN_ASSETS);
}

async function describeCandidate(asset: MediaAsset, fps: number): Promise<MusicCandidate> {
  const base: MusicCandidate = {
    id: asset.id,
    name: asset.name,
    seconds: Math.max(0, Math.round((asset.durationInFrames / (fps || 30)) * 10) / 10),
    bpm: null,
    confidence: null,
    tags: [],
  };
  try {
    const analysis = await loadMusicAnalysisForAsset(asset);
    if (!analysis) return base;
    return {
      ...base,
      bpm: Number.isFinite(analysis.bpm) && analysis.bpm > 0 ? analysis.bpm : null,
      confidence: Number.isFinite(analysis.beatConfidence) ? analysis.beatConfidence : null,
      tags: analysis.tags
        .slice()
        .sort((left, right) => right.score - left.score)
        .slice(0, 4)
        .map((tag) => tag.label),
    };
  } catch {
    return base;
  }
}

async function rankCandidates(ctx: AgentContext, fit: MusicFit): Promise<Array<MusicCandidate & MusicScore>> {
  const fps = ctx.getState().fps || 30;
  const described = await Promise.all(audioAssets(ctx).map((asset) => describeCandidate(asset, fps)));
  return described
    .map((candidate) => ({ ...candidate, ...scoreMusicCandidate(candidate, fit) }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

function rangeFit(state: TimelineState, fromFrame: number, toFrame: number): { rangeSeconds: number; cutsPerMinute: number } {
  const fps = state.fps || 30;
  const rangeSeconds = (toFrame - fromFrame) / fps;
  const cuts = cutFramesInRange(state, fromFrame, toFrame).length;
  return { rangeSeconds, cutsPerMinute: rangeSeconds > 0 ? (cuts / rangeSeconds) * 60 : 0 };
}

async function findMusic(args: Args, ctx: AgentContext) {
  const state = ctx.getState();
  const range = resolveRange(state, args);
  if ('error' in range) return range;
  const { rangeSeconds, cutsPerMinute } = rangeFit(state, range.fromFrame, range.toFrame);
  const mood = typeof args.mood === 'string' ? args.mood : undefined;
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(12, Math.round(args.limit))) : 5;

  const ranked = await rankCandidates(ctx, { rangeSeconds, cutsPerMinute, mood });
  const summary = {
    range: {
      fromFrame: range.fromFrame,
      toFrame: range.toFrame,
      seconds: Math.round(rangeSeconds * 10) / 10,
    },
    cuts: cutFramesInRange(state, range.fromFrame, range.toFrame).length,
    cutsPerMinute: Math.round(cutsPerMinute * 10) / 10,
  };
  if (!ranked.length) {
    return {
      ...summary,
      candidates: [],
      recommended: null,
      note: 'No audio assets in the media pool. Import music, call submit_music, or search stock audio first.',
    };
  }
  return {
    ...summary,
    candidates: ranked.slice(0, limit).map((candidate) => ({
      assetId: candidate.id,
      name: candidate.name,
      seconds: candidate.seconds,
      bpm: candidate.bpm === null ? null : Math.round(candidate.bpm),
      analyzed: candidate.bpm !== null,
      fitScore: candidate.score,
      reasons: candidate.reasons,
    })),
    recommended: ranked[0]!.id,
  };
}

function pickAsset(
  args: Args,
  ctx: AgentContext,
  ranked: Array<MusicCandidate & MusicScore>,
): MediaAsset | { error: string; available?: string[] } {
  const docAssets = audioAssets(ctx);
  const assetId = typeof args.assetId === 'string' ? args.assetId.trim() : '';
  if (assetId) {
    const hit = docAssets.find((asset) => asset.id === assetId || asset.id.startsWith(assetId));
    if (hit) return hit;
    return { error: `no audio asset ${assetId} in the media pool`, available: docAssets.map((asset) => asset.id) };
  }
  const name = typeof args.audioName === 'string' ? args.audioName.trim().toLowerCase() : '';
  if (name) {
    const hit = docAssets.find((asset) => asset.name.toLowerCase() === name)
      ?? docAssets.find((asset) => asset.name.toLowerCase().includes(name))
      ?? docAssets.find((asset) => asset.id.toLowerCase().startsWith(name));
    if (hit) return hit;
    return { error: `no audio matching "${args.audioName}"`, available: docAssets.map((asset) => asset.name) };
  }
  const bestId = ranked[0]?.id;
  const auto = bestId ? docAssets.find((asset) => asset.id === bestId) : undefined;
  if (auto) return auto;
  return { error: 'no usable music found; pass assetId or audioName, or import/generate music first' };
}

function musicTrackFor(state: TimelineState): TrackId | null {
  const audioTracks = timelineTrackIds(state).filter((id) => trackKind(state, id) === 'audio');
  return audioTracks.find((id) => {
    const flags = state.tracks?.[id];
    return flags?.role === 'follower' || /music|bgm|Music|Music/i.test(flags?.name ?? '');
  }) ?? null;
}

async function waitForTrack(ctx: AgentContext, id: TrackId): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (timelineTrackIds(ctx.getState()).includes(id)) return true;
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }
  return timelineTrackIds(ctx.getState()).includes(id);
}

function asCommandAsset(asset: MediaAsset, durationInFrames: number): AudioAsset {
  return {
    id: asset.id,
    name: asset.name,
    category: 'music',
    src: asset.src,
    durationInFrames: Math.max(1, Math.round(durationInFrames)),
  };
}

async function addMusicTrack(args: Args, ctx: AgentContext) {
  const state = ctx.getState();
  const fps = state.fps || 30;
  const range = resolveRange(state, args);
  if ('error' in range) return range;
  const { rangeSeconds, cutsPerMinute } = rangeFit(state, range.fromFrame, range.toFrame);
  const ranked = await rankCandidates(ctx, { rangeSeconds, cutsPerMinute });
  const asset = pickAsset(args, ctx, ranked);
  if ('error' in asset) return asset;

  const volume = typeof args.volume === 'number' && Number.isFinite(args.volume)
    ? Math.max(0, Math.min(2, args.volume))
    : 1;
  const fadeInFrames = typeof args.fadeInSeconds === 'number'
    ? Math.max(0, Math.round(args.fadeInSeconds * fps))
    : fps;
  const fadeOutFrames = typeof args.fadeOutSeconds === 'number'
    ? Math.max(0, Math.round(args.fadeOutSeconds * fps))
    : Math.round(fps * 2);
  const loop = args.loop !== false;
  const duck = args.duck !== false;

  let track: TrackId | null = null;
  let createdTrack = false;
  const requested = typeof args.track === 'string' ? args.track.trim() : '';
  if (requested) {
    track = resolveTrackId(state, requested, 'audio');
    if (!track) {
      return {
        error: `audio track "${requested}" does not exist. Omit track to reuse or create the music track.`,
        tracks: timelineTrackIds(state).map((id) => trackAlias(state, id)),
      };
    }
  } else {
    track = musicTrackFor(state);
  }
  if (!track) {
    const name = typeof args.trackName === 'string' && args.trackName.trim()
      ? args.trackName.trim()
      : DEFAULT_MUSIC_TRACK_NAME;
    track = ctx.commands.createTrack('audio', {
      name,
      role: duck ? 'follower' : undefined,
      audioRouting: duck ? { duckDepthDb: DEFAULT_DUCK_DB } : undefined,
    });
    createdTrack = true;
    if (!await waitForTrack(ctx, track)) return { error: 'the music track could not be created' };
  }

  const trackId = track;
  const placements = planMusicPlacements(asset.durationInFrames, range.fromFrame, range.toFrame, loop, fps, MAX_PLACEMENTS);
  if (!placements.length) return { error: 'nothing fits: the range is shorter than the minimum clip length' };

  const itemIds: string[] = [];
  ctx.commands.beginHistoryGesture();
  try {
    for (const placement of placements) {
      const placed = ctx.commands.addAudio(asCommandAsset(asset, placement.durationInFrames), {
        track: trackId,
        startFrame: placement.startFrame,
      });
      itemIds.push(placed.itemId);
      if (volume !== 1) ctx.commands.setItemVolume(placed.itemId, volume);
    }
    const firstId = itemIds[0]!;
    const lastId = itemIds[itemIds.length - 1]!;
    ctx.commands.setItemFade(firstId, {
      fadeInFrames: Math.min(fadeInFrames, placements[0]!.durationInFrames),
      ...(itemIds.length === 1 ? { fadeOutFrames: Math.min(fadeOutFrames, placements[0]!.durationInFrames) } : {}),
    });
    if (itemIds.length > 1) {
      const lastPlacement = placements[placements.length - 1]!;
      ctx.commands.setItemFade(lastId, { fadeOutFrames: Math.min(fadeOutFrames, lastPlacement.durationInFrames) });
    }
  } finally {
    ctx.commands.endHistoryGesture();
  }

  const after = ctx.getState();
  const last = placements[placements.length - 1]!;
  return {
    ok: true,
    assetId: asset.id,
    assetName: asset.name,
    track: {
      id: trackId,
      alias: trackAlias(after, trackId),
      name: after.tracks?.[trackId]?.name ?? null,
      role: after.tracks?.[trackId]?.role ?? null,
      created: createdTrack,
    },
    range: { fromFrame: range.fromFrame, toFrame: range.toFrame },
    // itemIds align with the placement order, so the agent can target any of them later.
    clips: placements.map((placement, index) => ({ ...placement, itemId: itemIds[index] })),
    looped: placements.length > 1,
    secondsCovered: Math.round(((last.startFrame + last.durationInFrames - range.fromFrame) / fps) * 10) / 10,
    fades: { inFrames: fadeInFrames, outFrames: fadeOutFrames },
    volume,
    ducking: createdTrack && duck ? { role: 'follower', duckDepthDb: DEFAULT_DUCK_DB } : null,
  };
}

/** Shape returned by addMusicTrack, narrowed for the composite tool. */
interface PlacedMusicBed {
  ok?: boolean;
  error?: string;
  assetId?: string;
  range?: { fromFrame: number; toFrame: number };
  clips?: Array<{ itemId: string; startFrame: number; durationInFrames: number }>;
  [key: string]: unknown;
}

/**
 * Place the bed, then optionally split video clips on the music grid.
 * Reuses addMusicTrack so both tools produce identical track/placement semantics.
 */
async function autoMusicBed(args: Args, ctx: AgentContext) {
  const placed = await addMusicTrack(args, ctx) as PlacedMusicBed;
  if (placed.error || !placed.ok) return placed;

  const firstItemId = placed.clips?.[0]?.itemId;
  if (!firstItemId) return { ...placed, cutSync: { applied: false, reason: 'no placed music clip' } };
  if (args.syncCuts === false) return { ...placed, cutSync: { applied: false, reason: 'syncCuts=false' } };

  const asset = ctx.getDoc().assets.find((candidate) => candidate.id === placed.assetId);
  if (!asset) return { ...placed, cutSync: { applied: false, reason: 'placed asset is no longer in the media pool' } };

  let analysis = await loadMusicAnalysisForAsset(asset).catch(() => null);
  if (!analysis && args.analyze !== false) {
    // Runs the on-device rhythm model; optional=true turns a missing pack into a soft miss.
    await analyzeMusic({ itemId: firstItemId, optional: true }, ctx).catch(() => null);
    analysis = await loadMusicAnalysisForAsset(asset).catch(() => null);
  }
  if (!analysis) {
    return {
      ...placed,
      cutSync: {
        applied: false,
        reason: 'no beat analysis available — install the rhythm model pack, then call analyze_music and sync_cuts_to_music',
      },
    };
  }

  const target = resolveMusicTarget({ itemId: firstItemId }, ctx);
  if (!target.item) return { ...placed, cutSync: { applied: false, reason: 'placed music clip not found' } };

  const options = normalizePlanOptions({
    ...args,
    timing: typeof args.timing === 'string' ? args.timing : 'downbeat',
    density: typeof args.density === 'string' ? args.density : 'medium',
  });
  const built = buildMusicEditPlan(
    analysis,
    musicAnalysisRef(analysis),
    target.item,
    ctx.getState(),
    options,
  );
  const prepared = buildMusicSplitActions(built.plan, ctx.getState());
  if (prepared.actions.length) ctx.commands.batch(prepared.actions, 'Music beat sync cut');

  return {
    ...placed,
    cutSync: {
      applied: prepared.actions.length > 0,
      splits: prepared.actions.length,
      targets: prepared.editableIds.length,
      lockedTargetIds: prepared.lockedIds.slice(0, 8),
      timing: built.plan.timing,
      analysisRef: built.plan.analysisRef,
      ...(prepared.actions.length ? {} : { reason: 'no planned cut falls inside an editable video clip' }),
    },
  };
}

export async function execMusicTool(name: string, args: Args, ctx: AgentContext): Promise<unknown> {
  if (name === 'find_music_for_timeline') return findMusic(args, ctx);
  if (name === 'add_music_track') return addMusicTrack(args, ctx);
  if (name === 'auto_music_bed') return autoMusicBed(args, ctx);
  return { error: `unknown tool ${name}` };
}
