// First-run vault setup.
//
// Shown once, when the app is still using its hidden default location. The point
// is to get the user's projects and media into a folder they own before they
// create anything, because moving a populated store later requires a restart and
// a copy.
//
// Deliberately skippable: someone who declines keeps working exactly as before
// (hidden default), and can pick a folder later from the project menu. A setup
// prompt that blocks the editor is worse than the problem it solves.
import { useCallback, useEffect, useState } from 'react';
import { theme, themeAlpha } from '../theme';
import { useT } from '../i18n/locale';
import { Icon } from '../modules/icons';
import { initVault, readVaultStatus, type VaultStatus } from './vaultApi';

const DISMISSED_KEY = 'cc.vaultSetupDismissed';

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private mode / storage disabled: ask again rather than silently never ask.
    return false;
  }
}

function rememberAsked(): void {
  try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* non-fatal */ }
}

export function VaultSetupDialog() {
  const t = useT();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Never block the first paint on this: if the endpoint is unavailable (a
    // static deploy, an old server) the prompt simply does not appear.
    void readVaultStatus().then((next) => {
      if (cancelled) return;
      setStatus(next);
      setPath(next.chosenPath || next.suggestedPath);
      // Ask when no usable vault exists yet: never chosen, or chosen but the
      // initialisation never completed (no marker on disk).
      if (!next.portable && !alreadyAsked()) setVisible(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const dismiss = useCallback(() => {
    rememberAsked();
    setVisible(false);
  }, []);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await initVault(path);
      rememberAsked();
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!visible || !status) return null;

  return <div
    role="presentation"
    style={{
      position: 'fixed', inset: 0, zIndex: 95,
      display: 'grid', placeItems: 'center', padding: 20,
      background: themeAlpha.ink(0.62),
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('Choose where AfterFrame keeps your files')}
      style={{
        width: 'min(500px, 100%)',
        display: 'flex', flexDirection: 'column', gap: 14,
        padding: '22px 24px 20px', borderRadius: 18,
        border: `0.5px solid ${theme.border}`,
        background: theme.panel, color: theme.text,
        fontFamily: 'var(--cc-font)',
        boxShadow: `0 34px 100px ${themeAlpha.shadow(0.72)}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center',
          background: theme.panelAlt, border: `0.5px solid ${theme.border}`,
        }}>
          <Icon name="folder" size={16} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.2px' }}>
          {done ? t('All set') : t('Choose where AfterFrame keeps your files')}
        </div>
      </div>

      {done ? <>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: theme.textMuted }}>
          {t('Your projects and media will be saved in this folder from the next launch. Restart AfterFrame to start using it.')}
        </div>
        <div style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
          color: theme.textDim, overflowWrap: 'anywhere',
        }}>{path}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setVisible(false)} style={primaryButton}>{t('Got it')}</button>
        </div>
      </> : <>
        <div style={{ fontSize: 12.5, lineHeight: 1.62, color: theme.textMuted }}>
          {t('Pick a folder you can find, back up, or copy to another device. Everything you import stays inside it — no upload to our servers, no one-time links.')}
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase', color: theme.textDim }}>
            {t('Folder')}
          </span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            spellCheck={false}
            aria-label={t('Storage folder path')}
            style={{
              font: 'inherit', fontSize: 12.5, padding: '9px 12px', borderRadius: 10,
              border: `0.5px solid ${theme.border}`, background: theme.inset, color: theme.text,
            }}
          />
        </label>
        <div style={{ display: 'flex', fontSize: 11.5, lineHeight: 1.5, color: theme.textDim, gap: 7 }}>
          <Icon name="check" size={13} />
          <span>{t('You can change this later from the project menu.')}</span>
        </div>
        {error && <div style={{ fontSize: 12, color: 'var(--cc-danger)', lineHeight: 1.5 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
          <button type="button" onClick={dismiss} disabled={busy} style={ghostButton}>{t('Not now')}</button>
          <button type="button" onClick={() => void confirm()} disabled={busy || !path.trim()} style={primaryButton}>
            {busy ? t('Setting up…') : t('Use this folder')}
          </button>
        </div>
      </>}
    </div>
  </div>;
}

const primaryButton: React.CSSProperties = {
  font: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 18px',
  borderRadius: 999, border: 'none', cursor: 'pointer',
  background: theme.text, color: theme.bg,
  boxShadow: `0 10px 28px ${themeAlpha.shadow(0.55)}`,
};

const ghostButton: React.CSSProperties = {
  font: 'inherit', fontSize: 12.5, padding: '8px 16px',
  borderRadius: 999, cursor: 'pointer',
  border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.text,
};
