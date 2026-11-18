/**
 * Plans are a first-class object, not free text.
 *
 * Plan mode used to rely on the model writing a numbered list in prose and then
 * saying "Switch to Agent mode to run this plan" — the user had to retype the
 * request, and nothing persisted. `propose_plan` emits a `<plan>` block that the
 * UI parses into editable steps with an Execute button, mirroring how
 * `ask_followup_questions` emits `<widget>`.
 *
 * Parsing is deliberately forgiving: this is untrusted model output, and a
 * malformed step must degrade to something the user can still read rather than
 * throwing away the whole plan.
 */

export interface PlanStep {
  /** Stable within a plan; regenerated on edit so React keys stay correct. */
  id: string;
  title: string;
  detail?: string;
}

export interface PlanSegment {
  type: 'plan';
  steps: PlanStep[];
  title?: string;
  /** Free-text caveats the plan itself carries (e.g. "needs the 4K source"). */
  note?: string;
}

const PLAN_RE = /<plan\b([^>]*)>([\s\S]*?)<\/plan>/g;
const STEP_TAG_RE = /<plan-step\b([^>]*?)(\/?)>/g;
const ATTR_RE = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*'([^']*)'/g;
const PLAN_MARKUP_RE = /<\/?(?:plan|plan-step)\b[^>]*>/g;
const PLAN_TAIL_RE = /<plan\b[\s\S]*$/;

/** Guards against a runaway model emitting hundreds of steps. */
export const MAX_PLAN_STEPS = 40;

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw))) {
    attrs[match[1] ?? match[3]] = decodeEntities(match[2] ?? match[4] ?? '');
  }
  return attrs;
}

/**
 * `<plan-step title="..." detail="..."/>`, and also the bare form where the
 * whole step is the text content: `<plan-step>Cut the intro</plan-step>`.
 * The bare form is what a model produces half the time when only a short
 * step is needed, so both have to work.
 */
function parseSteps(content: string): PlanStep[] {
  const steps: PlanStep[] = [];
  STEP_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STEP_TAG_RE.exec(content))) {
    const attrs = parseAttrs(match[1]);
    const title = (attrs.title ?? '').trim();
    const detail = (attrs.detail ?? '').trim();
    if (title) {
      steps.push({ id: `step-${steps.length}`, title, ...(detail ? { detail } : {}) });
      continue;
    }
    // No title attribute: take the element's text content.
    const rest = content.slice(STEP_TAG_RE.lastIndex);
    const close = rest.indexOf('</plan-step>');
    const inner = close < 0 ? rest : rest.slice(0, close);
    if (close >= 0) STEP_TAG_RE.lastIndex += close + '</plan-step>'.length;
    const text = decodeEntities(inner).trim();
    if (!text) continue;
    // `Title — detail` on one line, or just the title.
    const split = text.split(/\s+[—–-]\s+/);
    steps.push({
      id: `step-${steps.length}`,
      title: split[0]!.trim(),
      ...(split.length > 1 ? { detail: split.slice(1).join(' — ').trim() } : {}),
    });
  }
  return steps.slice(0, MAX_PLAN_STEPS);
}

/** Once a plan is identified, reassign ids so edits cannot collide. */
export function reindexPlanSteps(steps: readonly PlanStep[]): PlanStep[] {
  return steps.map((step, index) => ({ ...step, id: `step-${index}` }));
}

export type PlanMessageSegment = { type: 'text'; text: string } | PlanSegment;

/**
 * Everything an assistant message can contain. Widgets and plans both parse out
 * of the model's markup, and a single message may hold either, so the renderer
 * works over one union rather than branching into two codepaths.
 */
export type AssistantSegment =
  | { type: 'text'; text: string }
  | PlanSegment
  | import('./widget-parse').WidgetSegment;

export function parsePlans(text: string): PlanMessageSegment[] {
  const segments: PlanMessageSegment[] = [];
  PLAN_RE.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAN_RE.exec(text))) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) segments.push({ type: 'text', text: before });
    const attrs = parseAttrs(match[1]);
    const steps = parseSteps(match[2]);
    if (steps.length) {
      segments.push({
        type: 'plan',
        steps,
        ...(attrs.title ? { title: attrs.title } : {}),
        ...(attrs.note ? { note: attrs.note } : {}),
      });
    }
    lastIndex = PLAN_RE.lastIndex;
  }
  const tail = text.slice(lastIndex).replace(PLAN_TAIL_RE, '').replace(PLAN_MARKUP_RE, '').trim();
  if (tail) segments.push({ type: 'text', text: tail });
  return segments;
}

/** True when the text carries a plan block, used to decide whether to show the card. */
export function hasPlan(text: string | undefined): boolean {
  if (!text) return false;
  PLAN_RE.lastIndex = 0;
  return PLAN_RE.test(text);
}

/**
 * The message the composer sends when the user presses Execute.
 *
 * It carries the steps verbatim so the run does not have to re-derive them, and
 * pins the order so the model does not quietly re-plan.
 */
export function planExecutionMessage(steps: readonly PlanStep[]): string {
  const body = steps
    .map((step, index) => `${index + 1}. ${step.title}${step.detail ? ` — ${step.detail}` : ''}`)
    .join('\n');
  return `Run this plan exactly as written, in order. Do not re-plan or skip steps.\n\n${body}`;
}
