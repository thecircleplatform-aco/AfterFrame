import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { theme, themeAlpha } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../../modules/icons';
import { signIn, signUp } from '../../auth/session';

/**
 * Sign in / create account, sized for the drawer footer that opens it. One form
 * with a mode switch rather than two screens: the fields are the same, only the
 * verb changes. Server errors are shown verbatim because the worker already
 * writes them for humans ("That email already has an account").
 */
export function AuthDialog({ mode, onClose }: { mode: 'signin' | 'signup'; onClose: () => void }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [current, setCurrent] = useState(mode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = current === 'signup'
      ? await signUp(email.trim(), password, name.trim() || undefined)
      : await signIn(email.trim(), password);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.message);
  };

  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', height: 36, padding: '0 11px',
    borderRadius: 9, border: `1px solid ${themeAlpha.ink(0.10)}`,
    background: themeAlpha.ink(0.04), color: theme.text, fontSize: 13,
    outline: 'none',
  };

  return (
    <motion.div
      style={{
        position: 'fixed', inset: 0, zIndex: 80, display: 'grid', placeItems: 'center',
        background: themeAlpha.shadow(0.55), backdropFilter: 'blur(3px)', padding: 20,
        // The dashboard header that hosts this dialog is `pointer-events: none`
        // so its floating pieces can be clicked through; the overlay has to opt
        // back in or every click lands on the drawer behind it.
        pointerEvents: 'auto',
      }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
    >
      <motion.form
        onSubmit={submit}
        role="dialog"
        aria-label={t('Account')}
        initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30, mass: 0.8 }}
        style={{
          width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', gap: 12,
          padding: 22, borderRadius: 18, background: theme.panel,
          boxShadow: `0 30px 70px ${themeAlpha.shadow(0.65)}, 0 0 0 1px ${themeAlpha.ink(0.09)}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <strong style={{ fontSize: 15, color: theme.textStrong }}>
            {current === 'signup' ? t('Create an account') : t('Sign in')}
          </strong>
          <button
            type="button" onClick={onClose} aria-label={t('Close')}
            style={{
              background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer',
              width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', padding: 0,
            }}
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        {current === 'signup' && (
          <input
            style={field} value={name} autoComplete="name"
            placeholder={t('Display name (optional)')}
            onChange={(event) => setName(event.target.value)}
          />
        )}
        <input
          style={field} value={email} type="email" required autoComplete="email"
          placeholder={t('Email')}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          style={field} value={password} type="password" required
          autoComplete={current === 'signup' ? 'new-password' : 'current-password'}
          placeholder={t('Password')}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && (
          <span role="alert" style={{ fontSize: 12, color: theme.danger, lineHeight: 1.45 }}>{error}</span>
        )}

        <button
          type="submit" disabled={busy}
          style={{
            height: 38, borderRadius: 999, border: 'none', cursor: busy ? 'default' : 'pointer',
            background: theme.accent, color: theme.onAccent,
            fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? t('Working…') : current === 'signup' ? t('Create account') : t('Sign in')}
        </button>

        <button
          type="button"
          onClick={() => { setCurrent(current === 'signup' ? 'signin' : 'signup'); setError(null); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 12, color: theme.textDim, alignSelf: 'center',
          }}
        >
          {current === 'signup' ? t('I already have an account') : t('Create an account instead')}
        </button>
      </motion.form>
    </motion.div>
  );
}
