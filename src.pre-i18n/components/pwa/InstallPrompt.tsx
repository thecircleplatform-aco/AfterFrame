import { motion, useReducedMotion } from 'motion/react';
import { theme, themeAlpha } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../../modules/icons';
import { usePwaInstall } from '../../pwa/usePwaInstall';

/**
 * "Install AfterFrame" nudge. Shows at most once an hour (see `usePwaInstall`),
 * never inside the installed app, and only when the browser is actually ready to
 * install — a button that cannot work is worse than no button.
 */
export function InstallPrompt() {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const { visible, install, dismiss } = usePwaInstall();
  if (!visible) return null;

  return (
    <motion.div
      role="dialog"
      aria-label={t('Install AfterFrame')}
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }}
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)',
        margin: '0 auto', maxWidth: 420, zIndex: 55,
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px 12px 14px',
        borderRadius: 16, background: 'rgba(255,255,255,0.07)',
        border: `1px solid ${themeAlpha.ink(0.10)}`,
        backdropFilter: 'blur(20px) saturate(140%)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
      }}
    >
      <span aria-hidden="true" style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        display: 'grid', placeItems: 'center',
        background: themeAlpha.ink(0.06), color: theme.textStrong,
      }}>
        <Icon name="download" size={16} />
      </span>

      <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: theme.textStrong }}>
          {t('Install AfterFrame')}
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: theme.textDim, lineHeight: 1.4 }}>
          {t('Opens full screen from your home screen, no browser chrome.')}
        </span>
      </span>

      <button
        type="button"
        onClick={() => { void install(); }}
        style={{
          height: 32, padding: '0 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: theme.accent, color: theme.onAccent, fontSize: 12, fontWeight: 600, flexShrink: 0,
        }}
      >
        {t('Install')}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('Not now')}
        style={{
          width: 28, height: 28, borderRadius: 8, border: 'none', background: 'none',
          color: theme.textDim, cursor: 'pointer', flexShrink: 0, display: 'grid', placeItems: 'center', padding: 0,
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </motion.div>
  );
}
