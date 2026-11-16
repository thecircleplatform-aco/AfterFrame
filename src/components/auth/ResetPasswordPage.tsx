import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { theme, themeAlpha } from '../../theme';
import { useT } from '../../i18n/locale';
import { AfterFrameLogo } from '../brand/afterframe-logo';
import { AcoCredit } from '../brand/aco-mark';
import { LocaleToggle } from '../TopBar';
import { resetPassword } from '../../auth/session';
import { navigateTo } from '../../app/appShell';

/**
 * The other end of the reset email. The token arrives in the hash
 * (`#/reset-password?token=…`), which keeps it out of the server's request log,
 * and it is single-use: the worker marks the row used and signs the account in,
 * so success means the user is already back inside.
 */
export function ResetPasswordPage({ token }: { token: string }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) { setError(t('Both passwords must match.')); return; }
    setBusy(true);
    setError(null);
    const result = await resetPassword(token, password);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    // Every session was invalidated by the change, so this is a fresh sign-in.
    navigateTo('#/signin');
  };

  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', height: 44, padding: '0 14px',
    borderRadius: 11, border: `1px solid ${themeAlpha.ink(0.12)}`,
    background: themeAlpha.ink(0.04), color: theme.text, fontSize: 14,
  };

  return (
    <div tabIndex={-1} className="cc-auth-scroll" style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 18, padding: '40px 24px',
      background: theme.bg, color: theme.text, fontFamily: 'var(--cc-font)',
    }}>
      <div style={{ width: '100%', maxWidth: 380, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <AfterFrameLogo size="sm" />
        <LocaleToggle />
      </div>

      <motion.form
        onSubmit={submit}
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }}
        style={{
          width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14,
          padding: 26, borderRadius: 20, background: theme.panel,
          boxShadow: `0 24px 60px ${themeAlpha.shadow(0.5)}, 0 0 0 1px ${themeAlpha.ink(0.08)}`,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', color: theme.textStrong }}>
            {t('Choose a new password')}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: theme.textDim, lineHeight: 1.5 }}>
            {t('This link works once. Pick something you have not used before.')}
          </p>
        </div>

        {!token && (
          <span role="alert" style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.danger }}>
            {t('This reset link is missing its token. Ask for a new one.')}
          </span>
        )}

        <input
          type="password" style={field} value={password} required minLength={8}
          autoComplete="new-password" placeholder={t('New password (at least 8 characters)')}
          onChange={(event) => setPassword(event.target.value)}
        />
        <input
          type="password" style={field} value={confirm} required minLength={8}
          autoComplete="new-password" placeholder={t('Repeat the new password')}
          onChange={(event) => setConfirm(event.target.value)}
        />

        {error && (
          <span role="alert" style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.danger }}>{error}</span>
        )}

        <button
          type="submit" disabled={busy || !token}
          style={{
            height: 44, borderRadius: 999, border: 'none',
            cursor: busy || !token ? 'default' : 'pointer',
            background: theme.accent, color: theme.onAccent,
            fontSize: 14, fontWeight: 620, opacity: busy || !token ? 0.65 : 1,
            boxShadow: `0 10px 24px -12px ${themeAlpha.accent(0.6)}`,
          }}
        >
          {busy ? t('Working…') : t('Set new password')}
        </button>

        <button
          type="button" onClick={() => navigateTo('#/signin')}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 12, color: theme.textDim, alignSelf: 'center',
          }}
        >
          {t('Back to sign in')}
        </button>
      </motion.form>

      <AcoCredit />
    </div>
  );
}
