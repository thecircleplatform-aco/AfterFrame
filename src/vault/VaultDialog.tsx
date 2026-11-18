// Overlay shell for the vault panel, matching the app's other workspace dialogs:
// a dimmed backdrop, a rounded card, Esc to dismiss, and focus restored to
// whatever opened it.
//
// Kept separate from VaultPanel so the panel itself stays a plain component that
// can be mounted inline (first-run flow) without inheriting overlay behaviour.
import { useEffect, useRef } from 'react';
import { theme, themeAlpha } from '../theme';
import { useT } from '../i18n/locale';
import { Icon } from '../modules/icons';
import { VaultPanel } from './VaultPanel';

export function VaultDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    cardRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Restore focus so keyboard users are not dropped back at the document top.
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus();
    };
  }, [onClose]);

  return <div
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    style={{
      position: 'fixed', inset: 0, zIndex: 90,
      display: 'grid', placeItems: 'center',
      background: themeAlpha.ink(0.55),
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      padding: 20,
    }}
  >
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('Storage folder')}
      tabIndex={-1}
      style={{
        width: 'min(560px, 100%)',
        maxHeight: 'min(720px, calc(100vh - 40px))',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '18px 20px 20px',
        borderRadius: 18,
        border: `0.5px solid ${theme.border}`,
        background: theme.panel,
        color: theme.text,
        fontFamily: 'var(--cc-font)',
        boxShadow: `0 30px 90px ${themeAlpha.shadow(0.7)}`,
        outline: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name="folder" size={16} />
        <div style={{ fontSize: 14.5, fontWeight: 650, letterSpacing: '-0.2px' }}>{t('Your vault')}</div>
        <button
          type="button"
          aria-label={t('Close')}
          onClick={onClose}
          style={{
            marginLeft: 'auto', appearance: 'none', border: 0, cursor: 'pointer',
            background: 'transparent', color: theme.textMuted,
            fontSize: 18, lineHeight: 1, padding: 4,
          }}
        >×</button>
      </div>
      <VaultPanel onClose={onClose} />
    </div>
  </div>;
}
