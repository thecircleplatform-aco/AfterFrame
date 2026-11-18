import type { AgentContext } from '../context';
import type { TransitionItem, TransitionType } from '../../editor/types';
import { GLSL_TRANSITION_TYPES, TRANSITION_ORDER } from '../../editor/types';
import {
  ALL_TRANSITION_IDS,
  searchTransitions,
  TRANSITION_CATALOG,
} from './schemas/transition-tools';

type Args = Record<string, unknown>;

const DEFAULT_DURATION_FRAMES = 15;
const MIN_DURATION_FRAMES = 2;

function ok(value: Record<string, unknown>): Record<string, unknown> {
  return { ok: true, ...value };
}

function fail(error: string, hint?: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: false, error, hint, ...extra };
}

/**
 * Resolve a free-text request to a concrete transition id.
 *
 * Accepts, in priority order:
 *   1. an exact catalog id           ("wipe-diagonal", "audio-cross-fade")
 *   2. an exact label                ("Diagonal Wipe")
 *   3. a group name                  ("wipe") → a representative member
 *   4. fuzzy text                    ("smooth glitchy") → best match
 */
export function resolveTransitionRequest(request: string): TransitionType | null {
  const raw = request.trim();
  if (!raw) return null;

  const exactId = ALL_TRANSITION_IDS.find((id) => id === raw);
  if (exactId) return exactId;

  const lower = raw.toLowerCase();
  const byId = ALL_TRANSITION_IDS.find((id) => id.toLowerCase() === lower);
  if (byId) return byId;

  const byLabel = TRANSITION_CATALOG.find((entry) => entry.name.toLowerCase() === lower);
  if (byLabel) return byLabel.id;

  // A bare group name picks the first member, which keeps the result stable and
  // predictable rather than random — the agent can always ask for a specific id.
  const inGroup = TRANSITION_CATALOG.filter((entry) => entry.group === lower);
  if (inGroup.length) return inGroup[0].id;

  const [best] = searchTransitions(raw, 1);
  return best ? best.id : null;
}

function transitionSummary(item: TransitionItem): Record<string, unknown> {
  return {
    id: item.id,
    type: item.type,
    durationInFrames: item.durationInFrames,
    outgoingItemId: item.outgoingItemId,
    incomingItemId: item.incomingItemId,
    trackId: item.trackId,
    enabled: item.enabled !== false,
    direction: item.direction,
  };
}

function findTransition(ctx: AgentContext, id: string): TransitionItem | undefined {
  return ctx.getState().transitions?.find((t: TransitionItem) => t.id === id);
}

export async function execTransitionTool(name: string, args: Args, ctx: AgentContext): Promise<unknown> {
  if (name === 'list_transitions') {
    const group = typeof args.group === 'string' ? args.group : undefined;
    const query = typeof args.query === 'string' ? args.query : '';
    const limit = Math.min(60, Math.max(1, Number(args.limit) || 20));
    const pool = group ? TRANSITION_CATALOG.filter((entry) => entry.group === group) : TRANSITION_CATALOG;
    const matches = query
      ? searchTransitions(query, limit).filter((entry) => !group || entry.group === group)
      : pool.slice(0, limit);
    return ok({
      total: pool.length,
      returned: matches.length,
      transitions: matches,
    });
  }

  if (name === 'add_transition') {
    const incomingItemId = String(args.incomingItemId ?? '');
    if (!incomingItemId) return fail('incomingItemId is required');

    const requested = String(args.transition ?? '');
    const type = resolveTransitionRequest(requested);
    if (!type) {
      return fail(
        `no transition matches "${requested}"`,
        'Call list_transitions with a query to discover ids, then retry with an exact id.',
        { available: TRANSITION_ORDER.slice(0, 12) },
      );
    }

    const durationInFrames = args.durationInFrames === undefined
      ? DEFAULT_DURATION_FRAMES
      : Math.max(MIN_DURATION_FRAMES, Math.round(Number(args.durationInFrames)));

    // The command layer clamps to the neighbouring clip lengths and replaces any
    // existing in-transition for this clip, so no extra validation is needed here.
    const id = ctx.commands.addTransition(incomingItemId, type, durationInFrames);
    const created = findTransition(ctx, id);
    return ok({
      resolvedFrom: requested,
      resolvedType: type,
      isGlsl: GLSL_TRANSITION_TYPES.has(type),
      transition: created ? transitionSummary(created) : { id, type, durationInFrames, incomingItemId },
    });
  }

  if (name === 'set_transition') {
    const transitionId = String(args.transitionId ?? '');
    const existing = findTransition(ctx, transitionId);
    if (!existing) {
      return fail(
        `no transition with id ${transitionId}`,
        'Use read_timeline to list transition ids, or add_transition to create one.',
      );
    }
    const patch: Partial<TransitionItem> = {};
    if (typeof args.transition === 'string' && args.transition.trim()) {
      const type = resolveTransitionRequest(args.transition);
      if (!type) return fail(`no transition matches "${args.transition}"`, 'Call list_transitions first.');
      patch.type = type;
    }
    if (args.durationInFrames !== undefined) {
      patch.durationInFrames = Math.max(MIN_DURATION_FRAMES, Math.round(Number(args.durationInFrames)));
    }
    if (typeof args.direction === 'string' && ['left', 'right', 'up', 'down'].includes(args.direction)) {
      patch.direction = args.direction as TransitionItem['direction'];
    }
    if (typeof args.enabled === 'boolean') patch.enabled = args.enabled;
    if (!Object.keys(patch).length) return fail('nothing to change — supply transition, durationInFrames, direction or enabled');

    ctx.commands.setTransition(transitionId, patch);
    return ok({ transitionId, applied: patch });
  }

  if (name === 'remove_transition') {
    const transitionId = String(args.transitionId ?? '');
    if (!findTransition(ctx, transitionId)) {
      return fail(`no transition with id ${transitionId}`, 'Use read_timeline to list transition ids.');
    }
    ctx.commands.removeTransition(transitionId);
    return ok({ transitionId, removed: true });
  }

  return fail(`unknown transition tool ${name}`);
}

/** Exported for unit tests. */
export const TRANSITION_TOOL_INTERNALS = { resolveTransitionRequest, DEFAULT_DURATION_FRAMES };
