// Registry of the GLSL transitions (builtin:tr-*), mapping our
// TransitionType → fragment source + default uniforms. Defaults follow the
// (name, default, min, max) table in shaders/README.md; the vec3
// color defaults aren't in that table — chosen by eye.
import type { GlslTransitionType, TransitionDirection } from '../editor/types';
import type { UniformValue } from './runtime';
import {
  EXTENDED_DIRECTIONAL,
  EXTENDED_TRANSITION_IDS,
  EXTENDED_TRANSITION_UNIFORMS,
  type ExtendedTransitionType,
} from './extendedTransitions.generated.js';
import { EXTENDED_TRANSITION_FRAGS } from './extendedTransitionRegistry.generated.js';
import pageCurl from './shaders/page-curl.frag.ts';
import rackFocus from './shaders/rack-focus.frag.ts';
import organicDissolve from './shaders/organic-dissolve.frag.ts';
import impactShake from './shaders/impact-shake.frag.ts';
import anticipationZoom from './shaders/anticipation-zoom.frag.ts';
import cleanLineWipe from './shaders/clean-line-wipe.frag.ts';
import crossDissolve from './shaders/cross-dissolve.frag.ts';
import dipToBlack from './shaders/dip-to-black.frag.ts';
import flash from './shaders/flash.frag.ts';
import lumaBlend from './shaders/luma-blend.frag.ts';
import softWipe from './shaders/soft-wipe.frag.ts';
import whipPan from './shaders/whip-pan.frag.ts';
import circleWipe from './shaders/circle-wipe.frag.ts';
import radialBlur from './shaders/radial-blur.frag.ts';
import glitchCut from './shaders/glitch-cut.frag.ts';
import dipToColor from './shaders/dip-to-color.frag.ts';

export interface GlslTransitionDef {
  frag: string;
  /** per-frame uniforms beyond u_progress/u_resolution/u_aspect */
  uniforms: (ctx: { time: number; aspect: number; direction: TransitionDirection }) => Record<string, UniformValue>;
}

/** Direction name → UV vector, shared by every directional transition. */
export const DIRECTION_VECTORS: Record<TransitionDirection, [number, number]> = {
  right: [-1, 0],
  left: [1, 0],
  up: [0, 1],
  down: [0, -1],
};

/**
 * Build the registry rows for the generated catalog: one `frag` import per
 * shader, plus a `uniforms` closure returning that entry's catalog defaults.
 * `u_direction` is derived from the item's direction so directional entries
 * don't need a per-type switch.
 */
function extendedDefs(): Record<ExtendedTransitionType, GlslTransitionDef> {
  const defs = {} as Record<ExtendedTransitionType, GlslTransitionDef>;
  for (const id of EXTENDED_TRANSITION_IDS) {
    const defaults = EXTENDED_TRANSITION_UNIFORMS[id] ?? {};
    const directional = EXTENDED_DIRECTIONAL.has(id);
    defs[id] = {
      frag: EXTENDED_TRANSITION_FRAGS[id],
      uniforms: ({ time, direction }) => {
        const values: Record<string, UniformValue> = { u_time: time };
        for (const [key, value] of Object.entries(defaults)) {
          values[key] = typeof value === 'number' ? value : [value[0], value[1]];
        }
        if (directional) {
          const [dx, dy] = DIRECTION_VECTORS[direction];
          values.u_direction = [dx, dy];
        }
        return values;
      },
    };
  }
  return defs;
}

const EXTENDED_TRANSITION_DEFS = extendedDefs();

export const GLSL_TRANSITIONS: Record<GlslTransitionType, GlslTransitionDef> = {
  'cross-dissolve': {
    frag: crossDissolve,
    uniforms: () => ({ u_easingAmount: 1 }),
  },
  'dip-to-black': {
    frag: dipToBlack,
    uniforms: () => ({ u_blackDuration: 0.2 }),
  },
  flash: {
    frag: flash,
    uniforms: () => ({ u_flashColor: [1, 1, 1], u_flashHold: 0.1, u_overexposure: 2 }),
  },
  'luma-blend': {
    frag: lumaBlend,
    uniforms: () => ({ u_intensity: 2, u_additiveAmount: 0.5, u_threshold: 0.3 }),
  },
  'soft-wipe': {
    frag: softWipe,
    uniforms: () => ({ u_feather: 0.4, u_parallax: 0.05 }),
  },
  'whip-pan': {
    frag: whipPan,
    uniforms: ({ direction }) => ({
      u_dir: direction === 'right' ? [-1, 0] : direction === 'up' ? [0, -1] : direction === 'down' ? [0, 1] : [1, 0],
      u_blurStrength: 0.15,
      u_bounceback: 0.1,
    }),
  },
  'page-curl': {
    frag: pageCurl,
    uniforms: () => ({
      u_radius: 0.12, // Ai default [0.02, 0.5]
      u_glossiness: 0.6, // Ai default [0, 1]
      u_paperTint: [0.97, 0.95, 0.9], // Paper back color (customized)
    }),
  },
  'rack-focus': {
    frag: rackFocus,
    uniforms: () => ({
      u_blurStrength: 0.5, // Ai default [0, 1]
      u_chromaticAberration: 0.4, // Ai default [0, 1]
      u_contrastLoss: 0.2, // Ai default [0, 1]
    }),
  },
  'organic-dissolve': {
    frag: organicDissolve,
    uniforms: ({ time, aspect }) => ({
      u_ratio: aspect,
      u_time: time,
      u_glowWidth: 0.05, // Ai default [0, 0.5]
      u_depth: 1.8, // Ai default [0.1, 4]
      u_glowColor: [1.0, 0.55, 0.18], // Burning edge orange (customized)
    }),
  },
  'impact-shake': {
    frag: impactShake,
    uniforms: () => ({
      u_shakeIntensity: 0.03, // Ai default [0, 0.2]
      u_zoomPunch: 1.08, // Ai default [1, 2]
      u_chromaticAmount: 0.01, // Ai default [0, 0.1]
    }),
  },
  'anticipation-zoom': {
    frag: anticipationZoom,
    uniforms: () => ({
      u_windupAmount: 0.15, // Ai default [0, 1]
      u_zoomAmount: 6, // Ai default [0, 20]
      u_incomingStartScale: 0.8, // Ai default [0.1, 1]
    }),
  },
  'clean-line-wipe': {
    frag: cleanLineWipe,
    uniforms: () => ({
      u_lineWidth: 0.006, // Thin bright line width (customized)
      u_lineColor: [1, 1, 1], // Custom
    }),
  },
  // ── Extended generated library ──────────────────────────────────────────
  'circle-wipe': {
    frag: circleWipe,
    uniforms: () => ({
      u_feather: 0.04,
      u_center: [0.5, 0.5],
    }),
  },
  'radial-blur': {
    frag: radialBlur,
    uniforms: () => ({
      u_blurStrength: 0.22,
      u_center: [0.5, 0.5],
    }),
  },
  'glitch-cut': {
    frag: glitchCut,
    uniforms: ({ time }) => ({
      u_intensity: 1,
      u_time: time,
    }),
  },
  'dip-to-color': {
    frag: dipToColor,
    uniforms: () => ({
      // warm brand flash — bright enough to read on dark library cards
      u_color: [0.95, 0.38, 0.14],
      // short hold so PREVIEW_PROGRESS (~0.42) still shows outgoing + color blend
      u_hold: 0.12,
    }),
  },
  // ── 158-entry extended catalog (generated) ───────────────────────────────
  // Sources live in `src/gl/shaders/<id>.frag`; the entry list and uniforms in
  // `scripts/lib/transition-catalog.mjs`. Regenerate with
  // `npm run sync:transitions` rather than editing anything below by hand.
  ...EXTENDED_TRANSITION_DEFS,
};
