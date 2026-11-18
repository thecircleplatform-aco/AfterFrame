import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../modules/icons';
import { useT } from '../../i18n/locale';
import { reindexPlanSteps, type PlanStep } from './plan-parse';

/**
 * The plan, as an object the user can act on.
 *
 * Plan mode used to end with the model telling the user to switch modes and
 * retype their request. This card closes that loop: the steps are editable,
 * removable and re-orderable, and Run hands them back as a single message.
 */
export function PlanCard({
  steps: initialSteps, title, note, running, onRun,
}: {
  steps: PlanStep[];
  title?: string;
  note?: string;
  /** A run is already in flight; block editing and re-running. */
  running?: boolean;
  onRun: (steps: PlanStep[]) => void;
}) {
  const t = useT();
  const [steps, setSteps] = useState<PlanStep[]>(() => reindexPlanSteps(initialSteps));
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [ran, setRan] = useState(false);

  // A re-render from streaming must not throw away the user's edits; only a
  // genuinely different plan (new ids) resets the card.
  useEffect(() => {
    setSteps((current) => {
      const sameLength = current.length === initialSteps.length;
      const sameTitles = sameLength && current.every((step, i) => step.title === initialSteps[i]?.title);
      return sameTitles ? current : reindexPlanSteps(initialSteps);
    });
  }, [initialSteps]);

  const startEdit = useCallback((step: PlanStep) => {
    setEditing(step.id);
    setDraft(step.detail ? `${step.title}\n${step.detail}` : step.title);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const [first, ...rest] = draft.split('\n');
    const titleText = (first ?? '').trim();
    const detail = rest.join('\n').trim();
    setSteps((current) => {
      // Clearing the title deletes the step: an empty row is not a step.
      const next = titleText
        ? current.map((step) => (step.id === editing
          ? { ...step, title: titleText, ...(detail ? { detail } : { detail: undefined }) }
          : step))
        : current.filter((step) => step.id !== editing);
      return reindexPlanSteps(next);
    });
    setEditing(null);
    setDraft('');
  }, [draft, editing]);

  const remove = useCallback((id: string) => {
    setSteps((current) => reindexPlanSteps(current.filter((step) => step.id !== id)));
  }, []);

  const move = useCallback((id: string, delta: number) => {
    setSteps((current) => {
      const at = current.findIndex((step) => step.id === id);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(at, 1);
      next.splice(to, 0, item!);
      return reindexPlanSteps(next);
    });
  }, []);

  const disabled = !!running || ran;
  const dirty = steps.length !== initialSteps.length
    || steps.some((step, index) => step.title !== initialSteps[index]?.title
      || step.detail !== initialSteps[index]?.detail);

  return (
    <section className="cc-plan" aria-label={title ?? t('Plan')}>
      <header className="cc-plan-head">
        <span className="cc-plan-mark" aria-hidden="true">
          <Icon name="list" size={13} />
        </span>
        <h3 className="cc-plan-title">{title ?? t('Plan')}</h3>
        <span className="cc-plan-count">{t('{n} steps', { n: String(steps.length) })}</span>
      </header>

      {note && <p className="cc-plan-note">{note}</p>}

      <ol className="cc-plan-steps">
        {steps.map((step, index) => {
          const isEditing = editing === step.id;
          return (
            <li key={step.id} className={`cc-plan-step${isEditing ? ' is-editing' : ''}`}>
              <span className="cc-plan-step-no" aria-hidden="true">{index + 1}</span>
              {isEditing ? (
                <textarea
                  className="cc-plan-step-input"
                  value={draft}
                  autoFocus
                  rows={draft.includes('\n') ? 3 : 2}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') { event.preventDefault(); setEditing(null); setDraft(''); }
                    // Enter commits; Shift+Enter starts the detail line.
                    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitEdit(); }
                  }}
                  aria-label={t('Step {n}', { n: String(index + 1) })}
                />
              ) : (
                <button type="button" className="cc-plan-step-text" disabled={disabled}
                  onClick={() => startEdit(step)} title={t('Edit this step')}>
                  <span className="cc-plan-step-title">{step.title}</span>
                  {step.detail && <span className="cc-plan-step-detail">{step.detail}</span>}
                </button>
              )}
              {!disabled && !isEditing && (
                <span className="cc-plan-step-tools">
                  <button type="button" className="cc-plan-step-tool is-up" onClick={() => move(step.id, -1)}
                    disabled={index === 0} aria-label={t('Move up')} title={t('Move up')}>
                    <Icon name="arrowheadUp" size={11} />
                  </button>
                  <button type="button" className="cc-plan-step-tool is-down" onClick={() => move(step.id, 1)}
                    disabled={index === steps.length - 1} aria-label={t('Move down')} title={t('Move down')}>
                    <Icon name="arrowheadDown" size={11} />
                  </button>
                  <button type="button" className="cc-plan-step-tool is-danger" onClick={() => remove(step.id)}
                    aria-label={t('Delete step')} title={t('Delete step')}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {steps.length === 0 && <li className="cc-plan-step-empty">{t('No steps left — nothing to run.')}</li>}
      </ol>

      <footer className="cc-plan-foot">
        {dirty && steps.length > 0 && !ran && (
          <span className="cc-plan-dirty">
            <Icon name="info" size={11} />
            {t('Edited')}
          </span>
        )}
        <button type="button" className="cc-plan-run" disabled={disabled || steps.length === 0}
          onClick={() => { setRan(true); onRun(steps); }}>
          <Icon name="play" size={12} />
          {ran ? t('Running…') : t('Run this plan')}
        </button>
      </footer>
    </section>
  );
}
