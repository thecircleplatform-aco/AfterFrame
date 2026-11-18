export { PLAN_TOOL_SCHEMAS, PLAN_TOOL_NAMES } from './schemas/plan-tools';
import type { AgentContext } from '../context';

type Args = Record<string, unknown>;

const esc = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

interface RawStep {
  title?: unknown;
  detail?: unknown;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Matches MAX_PLAN_STEPS in the UI parser; a longer plan is a planning failure, not a form. */
const MAX_STEPS = 40;

/**
 * Serializes steps into a `<plan>` block. Mirrors `buildFollowupWidget`: the tool
 * returns markup that the runtime appends to the assistant message, and the UI
 * parses it back into a card.
 */
export function buildPlanBlock(
  rawSteps: readonly RawStep[],
  options: { title?: string; note?: string } = {},
): string {
  const tags: string[] = [];
  for (const step of rawSteps.slice(0, MAX_STEPS)) {
    const title = textValue(step.title);
    if (!title) continue;
    const detail = textValue(step.detail);
    tags.push(`<plan-step title="${esc(title)}"${detail ? ` detail="${esc(detail)}"` : ''}/>`);
  }
  if (!tags.length) return '';
  const attrs = [
    options.title ? ` title="${esc(options.title)}"` : '',
    options.note ? ` note="${esc(options.note)}"` : '',
  ].join('');
  return `<plan${attrs}>\n${tags.join('\n')}\n</plan>`;
}

export function execPlanTool(name: string, args: Args, _ctx: AgentContext): unknown {
  if (name !== 'propose_plan') return { error: `unknown tool ${name}` };
  const steps = Array.isArray(args.steps) ? (args.steps as RawStep[]) : [];
  if (!steps.length) return { error: 'propose_plan requires a non-empty steps array' };
  const block = buildPlanBlock(steps, {
    title: textValue(args.title) || undefined,
    note: textValue(args.note) || undefined,
  });
  if (!block) return { error: 'no renderable steps (each needs a non-empty title)' };
  return {
    __followup: block,
    note: 'Plan shown to the user as an editable card. They may edit steps or press Run; then the plan arrives as their next message.',
  };
}
