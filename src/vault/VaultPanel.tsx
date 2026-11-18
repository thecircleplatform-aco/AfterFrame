// Vault panel: where the user's projects and media live on this device.
//
// Design notes:
// - The two maintenance actions (relink, cleanup) are REPORT-FIRST. Both write or
//   delete files, so the panel counts exactly what will happen and waits for a
//   second click. Nothing is destructive on first press.
// - Counts are shown in the user's terms ("3 clips can be restored", "501 MB no
//   project uses") rather than file names, because the names are UUIDs.
// - A chosen folder needs a restart to become active (the storage profile
//   resolves at startup). That is stated up front instead of being discovered as
//   a bug after the picker closes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { theme, themeAlpha } from '../theme';
import { useT } from '../i18n/locale';
import { Icon } from '../modules/icons';
import {
  applyRelink, deleteUnusedMedia, formatBytes, initVault, planRelink, readUnusedMedia,
  readVaultStatus,
  type RelinkReport, type UnusedMediaReport, type VaultStatus,
} from './vaultApi';

type Busy = 'idle' | 'relink-plan' | 'relink-apply' | 'unused' | 'unused-delete' | 'init';

const card: React.CSSProperties = {
  border: `0.5px solid ${theme.border}`,
  borderRadius: 13,
  background: theme.panelAlt,
  padding: '13px 15px',
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
};

const titleRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 12.5, fontWeight: 620, color: theme.text,
};

const body: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.55, color: theme.textMuted,
};

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11, color: theme.textDim,
  overflowWrap: 'anywhere',
};

function actionButton(primary = false): React.CSSProperties {
  return {
    font: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 14px',
    borderRadius: 999,
    cursor: 'pointer',
    flex: '0 0 auto',
    border: primary ? 'none' : `0.5px solid ${theme.border}`,
    background: primary ? theme.text : 'transparent',
    color: primary ? theme.bg : theme.text,
    boxShadow: primary ? `0 8px 22px ${themeAlpha.shadow(0.5)}` : 'none',
  };
}

export function VaultPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [relink, setRelink] = useState<RelinkReport | null>(null);
  const [unused, setUnused] = useState<UnusedMediaReport | null>(null);
  const [pathDraft, setPathDraft] = useState('');
  /** Last value this component itself seeded, so user edits are never overwritten. */
  const seededRef = useRef('');

  const refresh = useCallback(async () => {
    try {
      const next = await readVaultStatus();
      setStatus(next);
      // Seed the field from the server ONLY while the user has not typed. A
      // `current || next...` guard looks equivalent but pins whatever value
      // arrived first — under StrictMode's double-effect that was a stale or
      // mocked response, and the folder shown never corrected itself again.
      setPathDraft((current) => (current === '' || current === seededRef.current
        ? (next.chosenPath || next.suggestedPath)
        : current));
      seededRef.current = next.chosenPath || next.suggestedPath;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (kind: Busy, work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNote(null);
    try { await work(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy('idle'); }
  };

  const chooseFolder = () => run('init', async () => {
    const result = await initVault(pathDraft);
    await refresh();
    setNote(result.restartRequired
      ? t('Folder saved. Restart AfterFrame to start using it.')
      : t('Folder is now in use.'));
  });

  const planRestore = () => run('relink-plan', async () => {
    const report = await planRelink();
    setRelink(report);
    if (report.recoverable.length === 0) {
      setNote(report.missingCount === 0
        ? t('Every referenced file is present.')
        : t('Nothing can be restored automatically: the missing files have no recorded fingerprint.'));
    }
  });

  const doRestore = () => run('relink-apply', async () => {
    const carried = relink?.recoverable ?? [];
    const result = await applyRelink(carried);
    setRelink(null);
    setNote(result.restored.length > 0
      ? t('{count} file(s) restored. Reload the project to see them.', { count: result.restored.length })
      : t('Nothing was restored.'));
    if (result.failed.length > 0) {
      setError(result.failed.map((entry) => `${entry.expectedName}: ${entry.error}`).join(' · '));
    }
  });

  const scanUnused = () => run('unused', async () => {
    const report = await readUnusedMedia();
    setUnused(report);
    if (report.files.length === 0) setNote(t('No unused media — the vault is clean.'));
  });

  const deleteUnused = () => run('unused-delete', async () => {
    const names = unused?.files.map((file) => file.name) ?? [];
    if (names.length === 0) return;
    const result = await deleteUnusedMedia(names);
    setUnused(null);
    setNote(t('Deleted {count} file(s), {size} freed.', {
      count: result.deleted.length,
      size: formatBytes(unused?.totalBytes ?? 0),
    }));
    if (result.kept.length > 0) {
      setError(t('{count} file(s) were kept because a project now uses them.', { count: result.kept.length }));
    }
  });

  const idle = busy === 'idle';

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {/* ---- location ---- */}
    <div style={card}>
      <div style={titleRow}><Icon name="folder" size={14} />{t('Storage folder')}</div>
      <div style={body}>
        {status?.portable
          ? t('Your projects and media live in the folder below. Copy that folder to move everything to another device.')
          : t('Your work is in AfterFrame\'s default location. Choose a folder to keep it somewhere you can find, back up, or move.')}
      </div>
      <div style={mono}>{status ? (status.state === 'none' ? status.mediaDir : status.activeRoot) : ''}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={pathDraft}
          onChange={(event) => setPathDraft(event.target.value)}
          aria-label={t('Storage folder path')}
          style={{
            flex: '1 1 220px', minWidth: 0, font: 'inherit', fontSize: 12,
            padding: '7px 11px', borderRadius: 9,
            border: `0.5px solid ${theme.border}`, background: theme.inset, color: theme.text,
          }}
        />
        <button type="button" style={actionButton(true)} disabled={!idle} onClick={chooseFolder}>
          {busy === 'init' ? t('Saving…') : t('Use this folder')}
        </button>
      </div>
      {status?.state === 'invalid' && (
        <div style={{ ...body, color: 'var(--cc-danger)' }}>{status.reason}</div>
      )}
    </div>

    {/* ---- relink ---- */}
    <div style={card}>
      <div style={titleRow}><Icon name="database" size={14} />{t('Restore offline media')}</div>
      <div style={body}>
        {t('If a file is missing but identical bytes are still in your folder, AfterFrame can put it back in place. Matching is by content fingerprint, never by filename.')}
      </div>
      {relink && (
        <div style={{ ...body, color: theme.text }}>
          {relink.recoverable.length > 0
            ? t('{count} file(s) can be restored ({size}).', {
              count: relink.recoverable.length,
              size: formatBytes(relink.recoverable.reduce((total, entry) => total + entry.bytes, 0)),
            })
            : t('Nothing to restore.')}
          {relink.unrecoverable.length > 0 && ` ${t('{count} reference(s) have no usable match.', { count: relink.unrecoverable.length })}`}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={actionButton(!!relink && relink.recoverable.length > 0)} disabled={!idle} onClick={relink && relink.recoverable.length > 0 ? doRestore : planRestore}>
          {busy === 'relink-plan' ? t('Checking…')
            : busy === 'relink-apply' ? t('Restoring…')
              : relink && relink.recoverable.length > 0 ? t('Restore now') : t('Check for missing files')}
        </button>
      </div>
    </div>

    {/* ---- cleanup ---- */}
    <div style={card}>
      <div style={titleRow}><Icon name="trash" size={14} />{t('Clean up unused media')}</div>
      <div style={body}>
        {t('Deleting a project keeps its media so other projects never break. Files that no project uses any more can be removed here.')}
      </div>
      {unused && (
        <div style={{ ...body, color: theme.text }}>
          {unused.files.length > 0
            ? t('{count} file(s), {size}, are not used by any project.', {
              count: unused.files.length, size: formatBytes(unused.totalBytes),
            })
            : t('Nothing unused.')}
          {unused.missingReferences > 0 && ` ${t('{count} reference(s) point at missing files.', { count: unused.missingReferences })}`}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={actionButton(!!unused && unused.files.length > 0)} disabled={!idle} onClick={unused && unused.files.length > 0 ? deleteUnused : scanUnused}>
          {busy === 'unused' ? t('Scanning…')
            : busy === 'unused-delete' ? t('Deleting…')
              : unused && unused.files.length > 0 ? t('Delete {count} file(s)', { count: unused.files.length }) : t('Scan for unused media')}
        </button>
      </div>
    </div>

    {note && <div style={{ ...body, color: theme.textMuted }}>{note}</div>}
    {error && <div style={{ ...body, color: 'var(--cc-danger)' }}>{error}</div>}

    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button type="button" style={actionButton()} onClick={onClose}>{t('Close')}</button>
    </div>
  </div>;
}
