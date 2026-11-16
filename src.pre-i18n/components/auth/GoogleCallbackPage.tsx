import { useEffect, useState } from 'react';
import { theme, themeAlpha } from '../../theme';
import { useT } from '../../i18n/locale';
import { AfterFrameLogo } from '../brand/afterframe-logo';
import { completeGoogleAuth } from '../../auth/session';
import { navigateTo } from '../../app/appShell';

/**
 * Google returns to `/` with `?code=…&state=…`, so this screen owns the moment
 * between "clicked Continue with Google" and "signed in". It renders in place of
 * the app while the code is exchanged, then hands over to the gate.
 */
export function GoogleCallbackPage({ search }: { search: string }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await completeGoogleAuth(search);
      if (!alive) return;
      if (result.ok) {
        // Drop the query string so a reload doesn't replay a spent code.
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
        navigateTo('#/');
        return;
      }
      setError(result.message);
    })();
    return () => { alive = false; };
  }, [search]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 16, padding: 24,
      background: theme.bg, color: theme.text, fontFamily: 'var(--cc-font)',
    }}>
      <AfterFrameLogo size="md" glow />
      {error ? (
        <>
          <span role="alert" style={{ fontSize: 13, color: theme.danger, maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>
            {error}
          </span>
          <button
            type="button"
            onClick={() => navigateTo('#/signin')}
            style={{
              height: 38, padding: '0 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
              background: theme.accent, color: theme.onAccent, fontSize: 13, fontWeight: 600,
              boxShadow: `0 10px 24px -12px ${themeAlpha.accent(0.6)}`,
            }}
          >
            {t('Back to sign in')}
          </button>
        </>
      ) : (
        <span style={{ fontSize: 13, color: theme.textDim }}>{t('Finishing sign-in…')}</span>
      )}
    </div>
  );
}
