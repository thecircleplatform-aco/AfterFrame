import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/locale';
import { Icon } from '../../modules/icons';
import {
  AUTO_ANSWER_MS,
  autoAnswerValues,
  formatRemaining,
  isFieldAnswered,
} from './stepperDefaults';
import type { WidgetField } from './widget-parse';

interface QuestionStepperProps {
  fields: WidgetField[];
  title?: string;
  messagePrefix?: string;
  submitLabel?: string;
  /** Called once, with the same markdown answer a full-card submit produces. */
  onSubmit: (answer: string) => void;
  /** Called when the user cancels; the agent is told to proceed on its own. */
  onCancel: () => void;
}

/**
 * One-question-at-a-time dock that sits directly above the composer.
 *
 * Why a stepper instead of the inline form: a 12-question card pushed the
 * conversation off screen and had to be scrolled back to. Here the questions
 * stay pinned next to the input the user is already looking at, and each step
 * gets the full width for its options plus a free-text box.
 */
export function QuestionStepper({
  fields,
  title,
  messagePrefix,
  submitLabel,
  onSubmit,
  onCancel,
}: QuestionStepperProps) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(AUTO_ANSWER_MS);
  const submitted = useRef(false);

  const field = fields[index];
  const isLast = index === fields.length - 1;
  const answeredCount = useMemo(
    () => fields.filter((entry) => isFieldAnswered(entry, effectiveValue(entry, values, otherText))).length,
    [fields, values, otherText],
  );

  // Finish exactly once, whatever triggered it (submit, auto-answer, cancel).
  const finish = useCallback((answer: string) => {
    if (submitted.current) return;
    submitted.current = true;
    onSubmit(answer);
  }, [onSubmit]);

  const format = useCallback((source: Record<string, string | string[]>, others: Record<string, string>) => {
    const lines: string[] = [];
    for (const entry of fields) {
      const value = effectiveValue(entry, source, others);
      if (!isFieldAnswered(entry, value)) continue;
      lines.push(`- ${entry.label}：${displayValue(entry, value)}`);
    }
    return [messagePrefix?.trim(), ...lines].filter(Boolean).join('\n');
  }, [fields, messagePrefix]);

  const submit = useCallback(() => {
    // Merge any half-typed "Other" text so it isn't lost when the user submits.
    const merged = { ...values };
    for (const entry of fields) {
      const other = otherText[entry.id]?.trim();
      if (other && (entry.kind === 'single' || entry.kind === 'multi')) merged[entry.id] = OTHER;
    }
    finish(format(merged, otherText));
  }, [fields, finish, format, otherText, values]);

  // Countdown. On expiry the agent answers for the user so the run is never
  // stranded in `awaiting-user`.
  useEffect(() => {
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const left = AUTO_ANSWER_MS - (Date.now() - startedAt);
      setRemaining(left);
      if (left > 0) return;
      window.clearInterval(tick);
      // Prefer what the user already typed; fill the rest with the model's
      // first-choice defaults.
      const fallback = { ...autoAnswerValues(fields), ...values };
      finish(format(fallback, otherText) || t('Use your best judgement.'));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [field, fields, finish, format, otherText, t, values]);

  if (!field) return null;

  const value = effectiveValue(field, values, otherText);
  const canAdvance = !field.required || isFieldAnswered(field, value);

  const choose = (next: string, multiple: boolean) => {
    setValues((current) => {
      if (!multiple) return { ...current, [field.id]: next };
      const list = Array.isArray(current[field.id]) ? [...(current[field.id] as string[])] : [];
      const at = list.indexOf(next);
      if (at >= 0) list.splice(at, 1); else list.push(next);
      return { ...current, [field.id]: list };
    });
  };

  const setOther = (next: string) => {
    setOtherText((current) => ({ ...current, [field.id]: next }));
    if (next.trim()) setValues((current) => ({ ...current, [field.id]: OTHER }));
  };

  return (
    <div className="cc-qstep" role="group" aria-label={title ?? t('Questions')}>
      <header className="cc-qstep-head">
        <span className="cc-qstep-count">{index + 1}<span>/{fields.length}</span></span>
        {title && <strong className="cc-qstep-title">{title}</strong>}
        <span className="cc-qstep-timer" title={t('The agent will choose for you when this runs out')}>
          <Icon name="clock" size={11} />
          {formatRemaining(remaining)}
        </span>
        <button type="button" className="cc-qstep-cancel" onClick={onCancel}
          title={t('Cancel and let the agent decide')} aria-label={t('Cancel')}>
          <Icon name="x" size={13} />
        </button>
      </header>

      <div className="cc-qstep-progress" aria-hidden="true">
        <span style={{ width: `${((index + 1) / fields.length) * 100}%` }} />
      </div>

      <div className="cc-qstep-body">
        <p className="cc-qstep-label">
          {field.label}
          {field.required && <span className="cc-qstep-req" aria-hidden="true">*</span>}
        </p>
        {field.description && <p className="cc-qstep-desc">{field.description}</p>}

        {/* Every option type renders as one row per choice so the description has
            room to breathe. Long lists scroll inside the stepper instead of
            pushing the composer off screen. */}
        {(field.kind === 'single' || field.kind === 'multi') && (
          <div className="cc-qstep-options" role="group" aria-label={field.label}>
            {field.options.map((option) => {
              const on = field.kind === 'multi'
                ? Array.isArray(value) && value.includes(option.value)
                : value === option.value;
              return (
                <button key={option.value} type="button"
                  className={`cc-qstep-option${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => choose(option.value, field.kind === 'multi')}>
                  <span className={`cc-qstep-mark${field.kind === 'multi' ? ' is-box' : ''}`} aria-hidden="true" />
                  <span className="cc-qstep-rich-copy">
                    <span className="cc-qstep-rich-name">{option.display}</span>
                    {'description' in option && option.description && (
                      <span className="cc-qstep-rich-desc">{option.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {(field.kind === 'visual' || field.kind === 'voice' || field.kind === 'scenario') && (
          <div className="cc-qstep-options" role="group" aria-label={field.label}>
            {field.options.map((option) => {
              const on = field.multiple
                ? Array.isArray(value) && value.includes(option.value)
                : value === option.value;
              return (
                <button key={option.value} type="button"
                  className={`cc-qstep-option${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => choose(option.value, field.multiple)}>
                  <span className={`cc-qstep-mark${field.multiple ? ' is-box' : ''}`} aria-hidden="true" />
                  <span className="cc-qstep-rich-copy">
                    <span className="cc-qstep-rich-name">{option.name}</span>
                    {option.description && <span className="cc-qstep-rich-desc">{option.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Free text for every question type, including the option ones — the
            user should never be trapped into a choice the model didn't think of. */}
        <textarea
          className="cc-qstep-input"
          rows={field.kind === 'text' ? 3 : 2}
          value={field.kind === 'text'
            ? (typeof value === 'string' ? value : '')
            : (otherText[field.id] ?? '')}
          placeholder={field.kind === 'text'
            ? (field.placeholder ?? t('Type your answer…'))
            : t('Or type your own answer…')}
          onChange={(event) => {
            if (field.kind === 'text') {
              setValues((current) => ({ ...current, [field.id]: event.target.value }));
              return;
            }
            setOther(event.target.value);
          }}
        />
      </div>

      <footer className="cc-qstep-foot">
        <button type="button" className="cc-qstep-ghost" disabled={index === 0}
          onClick={() => setIndex((current) => Math.max(0, current - 1))}>
          <Icon name="prev" size={13} />
          {t('Back')}
        </button>
        <span className="cc-qstep-tally">{t('{n} of {total} answered', { n: String(answeredCount), total: String(fields.length) })}</span>
        <button type="button" className="cc-qstep-ghost" onClick={submit}
          title={t('Skip the rest and send what you have')}>
          {t('Skip')}
        </button>
        {isLast ? (
          <button type="button" className="cc-qstep-primary" onClick={submit}
            disabled={!canAdvance}>{submitLabel ?? t('Send')}</button>
        ) : (
          <button type="button" className="cc-qstep-primary"
            onClick={() => setIndex((current) => Math.min(fields.length - 1, current + 1))}
            disabled={!canAdvance}>
            {t('Next')}
            <Icon name="next" size={13} />
          </button>
        )}
      </footer>
    </div>
  );
}

/** Sentinel stored in `values` when the user typed a custom answer. */
const OTHER = '\u0000other';

function effectiveValue(
  field: WidgetField,
  values: Record<string, string | string[]>,
  otherText: Record<string, string>,
): string | string[] | undefined {
  const value = values[field.id];
  if (value === OTHER) return otherText[field.id] ?? '';
  return value;
}

function displayValue(field: WidgetField, value: string | string[] | undefined): string {
  if (value === undefined) return '';
  // Text fields carry the verbatim answer; there is nothing to look up.
  const options = 'options' in field ? field.options : [];
  const label = (entry: string): string => {
    const option = options.find((candidate) => candidate.value === entry);
    if (!option) return entry;
    if ('name' in option && option.name) return option.submitPrompt ?? option.name;
    return 'display' in option ? option.display : entry;
  };
  if (typeof value === 'string') return field.kind === 'text' ? value : label(value);
  return value.map(label).filter(Boolean).join('\u3001');
}
