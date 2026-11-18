import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../modules/icons';
import { useT } from '../../i18n/locale';

export interface ResendImpact {
  /** Turns that will be dropped from the conversation. */
  turns: number;
  /** Timeline edit sessions that will be rolled back. */
  edits: { summary: string; operations: number }[];
}

/**
 * Confirmation for "edit and resend" / "resend".
 *
 * Re-sending a turn is not a cosmetic undo: `rewindTurn` truncates both the
 * display and the model history at that point, so every later exchange is gone,
 * and the timeline changes those turns produced are rolled back. That is
 * expensive and silent, so it is never done from a stray click — the user sees
 * exactly what disappears first.
 */
export function ResendConfirm({
  open, impact, busy, onConfirm, onCancel,
}: {
  open: boolean;
  impact: ResendImpact;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the safe action: a stray Enter would otherwise discard the turn
    // history and roll back the agent's timeline edits.
    const id = window.setTimeout(() => cancelRef.current?.focus({ preventScroll: true }), 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onCancel]);

  if (!open) return null;

  const hasEdits = impact.edits.length > 0;

  return createPortal(
    <div className="cc-resend-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="cc-resend"
        role="dialog"
        aria-modal="true"
        aria-label={t('Resend this message?')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cc-resend-head">
          <span className="cc-resend-icon" aria-hidden="true">
            <Icon name="undo" size={14} />
          </span>
          <p className="cc-resend-title">{t('Resend this message?')}</p>
          <button type="button" className="cc-resend-close" onClick={onCancel}
            aria-label={t('Cancel')} title={t('Cancel')}>
            <Icon name="x" size={12} />
          </button>
        </div>

        <p className="cc-resend-body">
          {impact.turns > 0
            ? t('This restarts the conversation from this point. {n} later exchange(s) will be removed.', { n: String(impact.turns) })
            : t('This restarts the conversation from this point.')}
        </p>

        {hasEdits && (
          <>
            <p className="cc-resend-sub">{t('These timeline edits will be undone:')}</p>
            <ul className="cc-resend-list">
              {impact.edits.map((edit, index) => (
                <li key={index} className="cc-resend-item">
                  <span className="cc-resend-item-dot" aria-hidden="true" />
                  <span className="cc-resend-item-text">{edit.summary}</span>
                  {edit.operations > 0 && (
                    <span className="cc-resend-item-count">
                      {t('{n} change(s)', { n: String(edit.operations) })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="cc-resend-warn">
              <Icon name="info" size={12} />
              {t('Undone edits cannot be restored.')}
            </p>
          </>
        )}

        <div className="cc-resend-foot">
          <button ref={cancelRef} type="button" className="cc-resend-cancel" onClick={onCancel} disabled={busy}>
            {t('Keep it')}
          </button>
          <button type="button" className={`cc-resend-go${hasEdits ? ' is-destructive' : ''}`}
            onClick={onConfirm} disabled={busy}>
            {t('Resend')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
