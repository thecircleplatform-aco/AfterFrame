import type { WidgetField } from './widget-parse';

/**
 * How long the agent waits for a human before answering on their behalf.
 * Ten minutes is long enough to read a 12-question brief and short enough that a
 * tab left open overnight doesn't strand the run in `awaiting-user` forever.
 */
export const AUTO_ANSWER_MS = 10 * 60 * 1000;

/** Shown in the header so the countdown is never a surprise. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Pick the answer the agent should assume when the user never replies.
 *
 * This is a *personalization* default, not a random one:
 *  - a `text` field is left blank (inventing prose would put words in the user's
 *    mouth, and the formatter drops empty fields)
 *  - a field the model marked `required` takes its first option, because the
 *    model listed options in its own preferred order
 *  - anything else takes its first option too, which keeps the answer coherent
 *    with the model's ranking rather than picking something arbitrary
 *
 * The important contract: an auto-answer always fills at least one field, so the
 * run resumes instead of waiting forever.
 */
export function autoAnswerValues(fields: WidgetField[]): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const field of fields) {
    if (field.kind === 'text') continue;
    if (field.kind === 'multi') {
      const first = field.options[0];
      if (first) values[field.id] = [first.value];
      continue;
    }
    if (field.kind === 'visual' || field.kind === 'voice' || field.kind === 'scenario') {
      const first = field.options[0];
      if (first) values[field.id] = field.multiple ? [first.value] : first.value;
      continue;
    }
    const first = field.options[0];
    if (first) values[field.id] = first.value;
  }
  return values;
}

/** True when the user has given this field an answer worth submitting. */
export function isFieldAnswered(field: WidgetField, value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (field.kind === 'text') return value.trim().length > 0;
  return value.length > 0;
}
