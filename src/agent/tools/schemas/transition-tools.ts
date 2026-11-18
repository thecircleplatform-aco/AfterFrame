import type { AgentToolSchema } from '../../tool-schema';
import {
  EXTENDED_TRANSITION_IDS,
  TRANSITION_GROUPS,
  TRANSITION_LABELS_EXTENDED,
} from '../../../gl/extendedTransitions.generated.js';
import {
  AUDIO_TRANSITION_ORDER,
  TRANSITION_ORDER,
  type TransitionType,
} from '../../../editor/types.js';

/**
 * One catalog authority for every visual transition id the agent may place —
 * the 16 hand-written originals plus the 158 generated entries.
 */
export const ALL_TRANSITION_IDS: readonly TransitionType[] = [
  ...TRANSITION_ORDER,
  ...AUDIO_TRANSITION_ORDER,
];

/** `{ id, name, group }` rows — what `list_transitions` returns. */
export const TRANSITION_CATALOG: ReadonlyArray<{ id: TransitionType; name: string; group: string }> = [
  ...TRANSITION_ORDER.map((id) => ({
    id: id as TransitionType,
    name: TRANSITION_LABELS_EXTENDED[id as keyof typeof TRANSITION_LABELS_EXTENDED] ?? id,
    group: groupFor(id),
  })),
  ...AUDIO_TRANSITION_ORDER.map((id) => ({ id: id as TransitionType, name: 'Audio Cross-Fade', group: 'audio' })),
];

function groupFor(id: string): string {
  for (const group of TRANSITION_GROUPS) {
    if (id.startsWith(group.id)) return group.id;
  }
  // Hand-written originals: classify by behaviour rather than by prefix.
  if (['cross-dissolve', 'luma-blend', 'organic-dissolve'].includes(id)) return 'dissolve';
  if (['soft-wipe', 'clean-line-wipe', 'circle-wipe'].includes(id)) return 'wipe';
  if (['whip-pan', 'impact-shake', 'anticipation-zoom'].includes(id)) return 'camera';
  if (['flash', 'dip-to-black', 'dip-to-color'].includes(id)) return 'color';
  if (['page-curl'].includes(id)) return 'fold';
  if (['rack-focus', 'radial-blur'].includes(id)) return 'blur';
  if (['glitch-cut'].includes(id)) return 'glitch';
  return 'other';
}

/**
 * Natural-language → catalog hints. An agent asked for a "smooth" or "glitchy"
 * transition has no idea our ids are `wipe-gauze` / `glitch-datamosh`, so map
 * the words people actually use onto groups and ids before scoring.
 */
const SYNONYMS: Record<string, string[]> = {
  smooth: ['cross-dissolve', 'soft-wipe', 'wipe-gauze', 'blur-radial-soft'],
  soft: ['soft-wipe', 'wipe-soft', 'wipe-gauze', 'blur-radial-soft'],
  gentle: ['cross-dissolve', 'wipe-gauze', 'blur-micro'],
  subtle: ['blur-micro', 'glitch-micro', 'wipe-quick'],
  harsh: ['glitch-heavy', 'wipe-hard', 'wipe-quick'],
  aggressive: ['glitch-heavy', 'camera-crash-zoom', 'earthquake', 'glitch-signal'],
  retro: ['glitch-tape', 'glitch-scan', 'luma-dark-in'],
  vhs: ['glitch-tape', 'glitch-scan', 'glitch-roll'],
  analog: ['glitch-tape', 'light-leak-left', 'blur-gauze'],
  fast: ['wipe-quick', 'glitch-micro', 'dip-to-black'],
  slow: ['cross-dissolve', 'blur-heavy', 'color-dip-white'],
  cinematic: ['cross-dissolve', 'light-bloom', 'blur-defocus', 'luma-dark-in'],
  flashy: ['light-white-flash', 'flash', 'glitch-rgb'],
  clean: ['wipe-clean', 'wipe-hard', 'cross-dissolve', 'soft-wipe'],
  organic: ['organic-dissolve', 'shape-blob', 'warp-liquid'],
  liquid: ['warp-liquid', 'warp-water', 'shape-blob'],
  water: ['warp-water', 'warp-ripple', 'warp-current'],
  shake: ['camera-shake-cut', 'camera-earthquake', 'impact-shake'],
  punch: ['camera-zoom-punch', 'camera-crash-zoom', 'camera-shake-cut'],
  whoosh: ['whip-pan', 'slide-overshoot', 'camera-drift-x'],
  spin: ['spiral-2-arm', 'shape-spiral-in', 'push-rotate-in'],
  circle: ['circle-wipe', 'shape-oval', 'shape-ring'],
  square: ['shape-square', 'shape-diamond'],
  star: ['shape-star', 'shape-heart'],
  heart: ['shape-heart'],
  pixel: ['mosaic', 'pattern-halftone', 'pattern-checker'],
  blur: ['blur-defocus', 'rack-focus', 'blur-radial-soft'],
  focus: ['rack-focus', 'blur-focus-pull', 'blur-defocus'],
  black: ['dip-to-black', 'color-dip-black-fast'],
  white: ['color-dip-white', 'light-white-flash'],
  color: ['dip-to-color', 'color-dip-warm'],
  fade: ['cross-dissolve', 'dip-to-black'],
  dissolve: ['cross-dissolve', 'organic-dissolve', 'luma-blend'],
  curtain: ['wipe-vertical-soft', 'bars-vertical-6'],
  blind: ['bars-vertical-12', 'bars-horizontal-8', 'wipe-blinds-tall'],
  flip: ['fold-flip-card', 'shutter-8', 'fold-vertical'],
  page: ['page-curl', 'fold-page-turn', 'fold-book'],
  zoom: ['camera-zoom-punch', 'anticipation-zoom', 'camera-crash-zoom'],
  light: ['light-bloom', 'light-center-glow', 'light-leak-left'],
  glow: ['light-center-glow', 'light-bloom'],
  leak: ['light-leak-left', 'light-leak-right', 'light-leak-top'],
  strobe: ['light-strobe', 'light-white-flash'],
};

/** Words that carry no transition meaning — ignored when scoring. */
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'with', 'for', 'of', 'in', 'on', 'cut', 'transition', 'effect', 'like', 'some', 'please', 'make', 'it', 'this', 'that']);

/** "glitchy" → ["glitch"], "ripples" → ["ripple"] — cheap stemming for matching only. */
function pluralOrAdjectiveForms(term: string): string[] {
  const out: string[] = [];
  for (const suffix of ['y', 'ey', 'ing', 'ed', 'ish', 'es', 's']) {
    if (term.endsWith(suffix) && term.length > suffix.length + 2) out.push(term.slice(0, -suffix.length));
  }
  if (term.endsWith('e')) out.push(term.slice(0, -1));
  return out;
}

/**
 * How many catalog entries a term describes. A broad, subject-like word
 * ("glitch" → 13 entries) scores higher than a modifier that happens to prefix
 * one id ("quick" → 1), which is what makes "quick glitchy cut" pick a glitch
 * instead of `wipe-quick`.
 */
function termVariety(term: string): number {
  const variants = [term, ...pluralOrAdjectiveForms(term), ...(SYNONYMS[term] ?? [])];
  let hits = 0;
  for (const entry of TRANSITION_CATALOG) {
    if (variants.some((v) => entry.id.includes(v) || entry.group === v || entry.group.includes(v))) hits += 1;
  }
  return Math.min(hits, 20);
}

/** Fuzzy-match a free-text request ("smooth wipe", "glitchy") to catalog ids. */
export function searchTransitions(query: string, limit = 20): Array<{ id: TransitionType; name: string; group: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return TRANSITION_CATALOG.slice(0, limit);
  const meaningful = q.split(/[^a-z0-9-]+/).filter((t) => t && !STOP_WORDS.has(t));
  if (!meaningful.length) return TRANSITION_CATALOG.slice(0, limit);
  const scored = TRANSITION_CATALOG.flatMap((entry) => {
    // Rank by HOW MANY of the user's terms the entry matches, then by how
    // specific those matches are, then by how commonly the strongest term
    // describes the catalog. Ranking by raw summed weights let one incidental
    // adjective ("quick") outscore an entry matching both words ("glitch" +
    // "quick" should beat "quick" alone).
    let matchedTerms = 0;
    let specificity = 0;
    let strongestVariety = 0;
    for (const term of meaningful) {
      const variants = [term, ...(SYNONYMS[term] ?? []), ...pluralOrAdjectiveForms(term)];
      let termBest = 0;
      for (const variant of variants) {
        const direct = variant === term ? 3 : 1;
        const weight = direct * Math.min(variant.length, 12);
        let s = 0;
        if (entry.id === variant) s = 100 * weight;
        else if (entry.id.startsWith(variant)) s = 45 * weight;
        else if (entry.id.includes(variant)) s = 22 * weight;
        else if (entry.name.toLowerCase().includes(variant)) s = 16 * weight;
        else if (entry.group === variant) s = 60 * weight;
        else if (entry.group.includes(variant)) s = 12 * weight;
        if (s > termBest) termBest = s;
      }
      if (termBest > 0) {
        matchedTerms += 1;
        specificity += termBest;
        strongestVariety = Math.max(strongestVariety, termVariety(term));
      }
    }
    if (!matchedTerms) return [];
    return [{ ...entry, score: matchedTerms * 100000 + strongestVariety * 1000 + specificity }];
  });
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ score: _score, ...entry }) => entry);
}

export const TRANSITION_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'list_transitions',
    description:
      'List available video transitions (174 total). Use `query` for a fuzzy search — "smooth", "glitch", "wipe", "zoom", "light" all match ids, names and groups. Returns {id, name, group}. Then call add_transition with the id (or a group name to pick one at random from that family).',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Fuzzy search over id, name and group. Omit to list the first entries.',
        },
        group: {
          type: 'string',
          enum: [...TRANSITION_GROUPS.map((g) => g.id), 'audio', 'other'],
          description: 'Restrict to one family (dissolve, slide, wipe, shape, blur, light, glitch, warp, pattern, camera, fold, color, bars, mosaic, luma, audio).',
        },
        limit: { type: 'number', description: 'Max results (default 20, max 60).' },
      },
    },
  },
  {
    name: 'add_transition',
    description:
      'Add a transition between two adjacent same-track clips. Provide `incomingItemId` (the clip that starts the cut); the outgoing clip is found automatically. `transition` accepts an exact id from list_transitions, a group name like "wipe" (a random member of that family is chosen), or a description like "quick glitch". Duration defaults to 15 frames and is clamped to half of the shorter neighbouring clip.',
    input_schema: {
      type: 'object',
      properties: {
        incomingItemId: { type: 'string', description: 'Clip id whose BEGINNING the transition covers.' },
        transition: {
          type: 'string',
          description: 'Exact transition id, group name, or natural-language description.',
        },
        durationInFrames: { type: 'number', description: 'Length in frames (min 2). Defaults to 15.' },
        direction: {
          type: 'string',
          enum: ['left', 'right', 'up', 'down'],
          description: 'Direction for directional wipes/slides. Defaults to left.',
        },
      },
      required: ['incomingItemId', 'transition'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_transition',
    description:
      'Update an existing transition in place: change its type (same resolution rules as add_transition), duration, direction, or enable/disable it without removing it.',
    input_schema: {
      type: 'object',
      properties: {
        transitionId: { type: 'string', description: 'Transition item id (from read_timeline).' },
        transition: { type: 'string', description: 'New transition id / group / description. Optional.' },
        durationInFrames: { type: 'number', description: 'New length in frames. Optional.' },
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'] },
        enabled: { type: 'boolean', description: 'false keeps the transition but renders a hard cut.' },
      },
      required: ['transitionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_transition',
    description: 'Remove a transition, restoring a hard cut between the two clips.',
    input_schema: {
      type: 'object',
      properties: {
        transitionId: { type: 'string', description: 'Transition item id.' },
      },
      required: ['transitionId'],
      additionalProperties: false,
    },
  },
];

export const TRANSITION_TOOL_NAMES = new Set(TRANSITION_TOOL_SCHEMAS.map((t) => t.name));

/** Re-exported so the executor can validate ids without re-importing. */
export const EXTENDED_IDS = EXTENDED_TRANSITION_IDS;
