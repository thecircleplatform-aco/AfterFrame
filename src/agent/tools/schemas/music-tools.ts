import type { AgentToolSchema } from '../../tool-schema';

const RANGE_PROPERTIES = {
  fromFrame: {
    type: 'number',
    minimum: 0,
    description: 'Optional absolute timeline start frame. Defaults to 0.',
  },
  toFrame: {
    type: 'number',
    minimum: 1,
    description: 'Optional exclusive timeline end frame. Defaults to the end of the last clip.',
  },
} as const;

export const MUSIC_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'find_music_for_timeline',
    description: [
      'Rank the project\'s audio assets as background music for a timeline range.',
      'Scores each candidate on duration coverage, tempo versus the local cut pace, cached Beat This analysis confidence, and an optional mood keyword; it is read-only and edits nothing.',
      'Use this before add_music_track to choose music that matches how fast the edit cuts, or to explain to the user why a track fits.',
      'Cached tempo only: call analyze_music on a candidate first when you need exact beats for cut-syncing.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        ...RANGE_PROPERTIES,
        mood: {
          type: 'string',
          description: 'Optional mood/style keyword to match against asset names and cached CLAP tags (e.g. "upbeat", "cinematic").',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 12,
          description: 'How many ranked candidates to return (default 5).',
        },
      },
    },
  },
  {
    name: 'add_music_track',
    description: [
      'Add background music to the timeline in one undoable step: it picks or creates a dedicated music audio track, places the track from fromFrame to toFrame (looping when it is shorter), applies fades and volume, and optionally marks the track as a follower so speech ducks it.',
      'Pass assetId or audioName to choose the music explicitly; omit both to auto-pick the best fit from find_music_for_timeline.',
      'Existing music is never moved or deleted — this only adds clips on the chosen track, and the target range may be empty or already contain other audio.',
      'For beat-accurate cuts after placement, call analyze_music and then music_edit_plan / sync_cuts_to_music on the placed clip.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'Media-pool audio asset id (prefix ok).' },
        audioName: { type: 'string', description: 'Fuzzy asset name match, like add_audio.' },
        ...RANGE_PROPERTIES,
        track: {
          type: 'string',
          description: 'Existing audio track id or alias to place on. Omit to reuse the music track or create a new one.',
        },
        trackName: { type: 'string', description: 'Name for a newly created audio track (default "Music").' },
        volume: { type: 'number', minimum: 0, maximum: 2, description: 'Clip gain, 1 = unchanged (default 1).' },
        fadeInSeconds: { type: 'number', minimum: 0, maximum: 60, description: 'Fade-in on the first placed clip (default 1s).' },
        fadeOutSeconds: { type: 'number', minimum: 0, maximum: 60, description: 'Fade-out on the last placed clip (default 2s).' },
        loop: { type: 'boolean', description: 'Repeat the track until toFrame when it is shorter than the range (default true).' },
        duck: {
          type: 'boolean',
          description: 'When true (default) a newly created track is role=follower with -18 dB ducking under anchor tracks.',
        },
      },
    },
  },
  {
    name: 'auto_music_bed',
    description: [
      'One-call music bed: picks the best-fitting pool track (or the one you name), creates or reuses the music track, places it looped with fades and ducking, then splits video clips on the music\'s downbeats so the edit lands on the beat.',
      'Equivalent to find_music_for_timeline + add_music_track + analyze_music + music_edit_plan + sync_cuts_to_music, but executed inline with sensible defaults (timing=downbeat, density=medium).',
      'Set syncCuts=false to only place the bed. Set analyze=false to skip on-demand beat analysis and use only cached analysis.',
      'Two undo steps at most: one for the placed music clips, one for the beat splits. Nothing is moved or deleted; splits only touch unlocked video clips.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'Media-pool audio asset id (prefix ok).' },
        audioName: { type: 'string', description: 'Fuzzy asset name match.' },
        ...RANGE_PROPERTIES,
        track: { type: 'string', description: 'Existing audio track id or alias. Omit to reuse or create the music track.' },
        trackName: { type: 'string', description: 'Name for a newly created audio track (default "Music").' },
        volume: { type: 'number', minimum: 0, maximum: 2, description: 'Clip gain, 1 = unchanged (default 1).' },
        fadeInSeconds: { type: 'number', minimum: 0, maximum: 60, description: 'Fade-in on the first clip (default 1s).' },
        fadeOutSeconds: { type: 'number', minimum: 0, maximum: 60, description: 'Fade-out on the last clip (default 2s).' },
        loop: { type: 'boolean', description: 'Repeat the track to cover the range (default true).' },
        duck: { type: 'boolean', description: 'Mark a newly created track as follower with -18 dB ducking (default true).' },
        syncCuts: { type: 'boolean', description: 'Split video clips on the music grid (default true).' },
        analyze: { type: 'boolean', description: 'Run beat analysis when no cached analysis exists (default true).' },
        timing: {
          type: 'string',
          enum: ['auto', 'beat', 'downbeat', 'section'],
          description: 'Cut grid for syncCuts (default downbeat).',
        },
        density: {
          type: 'string',
          enum: ['sparse', 'medium', 'dense'],
          description: 'How many cuts to place (default medium).',
        },
      },
    },
  },
];

export const MUSIC_TOOL_NAMES = new Set(MUSIC_TOOL_SCHEMAS.map((tool) => tool.name));
