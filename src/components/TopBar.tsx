import { lazy, Suspense, useState, useEffect } from 'react';
import { theme } from '../theme';
import { Icon } from '../modules/icons';
import { loadMcpGuideDialog } from './settings/mcpGuideLoader';
import { ALL_LOCALES, getLocale, setLocale, useT } from '../i18n/locale';
import { invokeAction, bindAction } from '../shortcuts/actionRegistry';
import { DesktopWindowControls } from './DesktopWindowControls';
import { TopBarIconButton } from './TopBarIconButton';
import { ReviewCommentsButton, type ReviewOpenRequest } from '../modules/review/ReviewCommentsButton';
import type { TimelineState } from '../editor/types';

// Lazy, like the dashboard's copy of this dialog. A static import here put the
// whole MCP guide into the editor's eager chunk and made every lazy() built on
// loadMcpGuideDialog ineffective, dashboard included — both top bars have to go
// through the thunk for either to be split.
const McpGuideDialog = lazy(() => loadMcpGuideDialog().then((m) => ({ default: m.McpGuideDialog })));

// Language switching: The text pill displays the current language; clicking
// cycles through the supported locales. First run defaults to the
// system language (or English) — see i18n/locale.ts. Chinese and Korean show
// their own script; the others show the locale code.
export function LocaleToggle() {
  const t = useT();
  const locale = getLocale();
  const next = ALL_LOCALES[(ALL_LOCALES.indexOf(locale) + 1) % ALL_LOCALES.length]!;
  return (
    <button
      className="cc-tip cc-tip-r"
      data-tip={t('Switch UI language')}
      aria-label={t('Switch UI language')}
      onClick={() => setLocale(next)}
      style={{ minWidth: locale === 'th' ? 36 : 30, height: 22, background: 'none', border: `0.5px solid ${theme.border}`, borderRadius: 4, cursor: 'pointer', padding: '0 5px', fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color: theme.textDim, display: 'grid', placeItems: 'center' }}
      onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; e.currentTarget.style.background = theme.panelAlt; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.background = 'none'; }}>
      {locale === 'zh' ? 'Center' : locale === 'ko' ? '\ud55c' : locale === 'th' ? 'ไทย' : locale.toUpperCase()}
    </button>
  );
}

interface TopBarProps {
  projectId: string;
  projectName: string;
  canUndo: boolean;
  canRedo: boolean;
  exporting?: boolean;
  exportJobCount?: number;
  /**
   * Kept in the interface for callers, but no longer consumed here: the
   * generation-activity indicator moved out of the toolbar (it now lives with
   * the other project panels behind the hamburger menu).
   */
  onResumeGeneration?: () => Promise<void>;
  onHome?: () => void;
  onRename?: (name: string) => void;
  /** Review comments live in the top bar (they used to sit in the preview header). */
  review?: {
    timelineId: string;
    state: TimelineState;
    openRequest?: ReviewOpenRequest | null;
    getCurrentFrame: () => number;
    onSeek: (frame: number) => void;
  } | null;
}

/**
 * Top-left hamburger menu.
 *
 * Replaces the old one-purpose home button: project-level actions were spread
 * across a crowded toolbar, so they live behind one menu anchored to the corner.
 * Closes on outside click, Escape, and after any action runs.
 */
function TopBarMenu({ projectName, onHome, onRename, onNewDraft, onOpenMcp }: {
  projectName: string;
  onHome?: () => void;
  onRename?: (name: string) => void;
  onNewDraft: () => void;
  onOpenMcp: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-topbar-menu]')) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void) => () => { setOpen(false); action(); };

  const item = (
    icon: React.ComponentProps<typeof Icon>['name'],
    label: string,
    action: () => void,
    opts: { disabled?: boolean } = {},
  ) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      disabled={opts.disabled}
      onClick={run(action)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px',
        background: 'none', border: 'none', borderRadius: 5, textAlign: 'left',
        color: opts.disabled ? theme.textDim : theme.text,
        fontSize: 12.5, cursor: opts.disabled ? 'default' : 'pointer', opacity: opts.disabled ? 0.45 : 1,
      }}
      onMouseEnter={(e) => { if (!opts.disabled) e.currentTarget.style.background = theme.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      <Icon name={icon} size={14} />
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );

  return (
    <div data-topbar-menu style={{ position: 'relative', display: 'flex' }}>
      <button
        type="button"
        className="cc-tip"
        data-tip={t('Project menu')}
        aria-label={t('Project menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 28, height: 28, background: open ? theme.panelAlt : 'none', border: 'none',
          borderRadius: 4, cursor: 'pointer', padding: 0, lineHeight: 0,
          display: 'grid', placeItems: 'center', color: open ? theme.text : theme.textDim,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; e.currentTarget.style.background = theme.panelAlt; }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.background = 'none'; } }}
      >
        <Icon name="menu" size={16} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('Project menu')}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 120,
            minWidth: 218, padding: 5, borderRadius: 8,
            border: `0.5px solid ${theme.border}`, background: theme.panel,
            boxShadow: '0 12px 32px rgba(var(--cc-shadow-rgb), 0.5)',
          }}
        >
          <div style={{ padding: '4px 10px 7px', color: theme.textDim, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {projectName}
          </div>
          {item('home', t('Back to projects'), () => onHome?.(), { disabled: !onHome })}
          {item('pencil', t('Rename project'), onNewDraft, { disabled: !onRename })}
          <span style={{ display: 'block', height: 0.5, margin: '5px 6px', background: theme.border }} />
          {item('keyboard', t('Keyboard shortcuts'), () => invokeAction('keyboard-shortcuts', undefined, 'toolbar'))}
          {item('palette', t('Design style'), () => invokeAction('open-design', undefined, 'toolbar'))}
          {item('history', t('Version history'), () => invokeAction('open-history', undefined, 'toolbar'))}
          {item('folder', t('Storage folder'), () => invokeAction('open-vault', undefined, 'toolbar'))}
          {item('plug', t('External agents (MCP)'), onOpenMcp)}
          <span style={{ display: 'block', height: 0.5, margin: '5px 6px', background: theme.border }} />
          {item('download', t('Export MP4'), () => invokeAction('open-export', undefined, 'toolbar'))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ projectId, projectName, canUndo, canRedo, exporting, exportJobCount = 0, onHome, onRename, review }: TopBarProps) {
  const t = useT();
  const isMacDesktop = window.AfterFrameDesktop?.platform === 'darwin';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const [mcpOpen, setMcpOpen] = useState(false);
  // The settings dialog (and anything else) can summon the MCP guide through the
  // action registry: the Anthropic pane names this panel as the way in for
  // Claude Code subscribers, so it has to be able to actually open it.
  useEffect(() => bindAction('open-mcp-guide', () => setMcpOpen(true)), []);
  const commit = () => { setEditing(false); if (onRename && draft.trim() && draft.trim() !== projectName) onRename(draft.trim()); };

  return (
    <header className={`cc-topbar cc-window-titlebar${isMacDesktop ? ' cc-window-titlebar--mac' : ''}`} style={{ gridColumn: '1 / -1', gridRow: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'center', padding: '0 6px', borderBottom: `0.5px solid ${theme.border}`, background: theme.panel, gap: 4 }}>
      <DesktopWindowControls />
      {/* hamburger: the project-level menu, opened from the top-left corner */}
      <TopBarMenu
        projectName={projectName}
        onHome={onHome}
        onRename={onRename}
        onNewDraft={() => { setDraft(projectName); setEditing(true); }}
        onOpenMcp={() => setMcpOpen(true)}
      />
      <span style={{ width: 1, height: 20, background: theme.border, margin: '0 4px' }} />

      {/* center: project title (no collaboration on local single machine, no collaborator users icon)*/}
      <div className="cc-topbar-title" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', fontSize: 12, color: theme.text }}>
        {editing ? (
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            style={{ font: 'inherit', fontSize: 14, textAlign: 'center', background: theme.panelAlt, color: theme.text, border: `0.5px solid ${theme.accent}`, borderRadius: 5, padding: '2px 8px', minWidth: 200 }} />
        ) : (
          <span onDoubleClick={() => { if (onRename) { setDraft(projectName); setEditing(true); } }} title={onRename ? t('Double-click to rename') : undefined} style={{ cursor: onRename ? 'text' : 'default' }}>{projectName}</span>
        )}
      </div>

      <div className="cc-topbar-actions">

      {/* right: undo · redo · shortcuts · history · layout · export · avatar */}
      <TopBarIconButton icon="undo" label={t('Undo')} onClick={() => invokeAction('undo', undefined, 'toolbar')} disabled={!canUndo} />
      <TopBarIconButton icon="redo" label={t('Redo')} onClick={() => invokeAction('redo', undefined, 'toolbar')} disabled={!canRedo} />
      <span id="cc-agent-change-log-slot" style={{ display: 'contents' }} />
      {review && (
        <ReviewCommentsButton
          projectId={projectId}
          timelineId={review.timelineId}
          state={review.state}
          selectedItem={null}
          openRequest={review.openRequest}
          getCurrentFrame={review.getCurrentFrame}
          onSeek={review.onSeek}
        />
      )}
      <button onClick={() => invokeAction('open-export', undefined, 'toolbar')}
        className="cc-tip cc-tip-r cc-brand-gradient"
        data-tip={exporting ? t('View background export tasks') : t('Export MP4')}
        aria-label={exporting ? t('View background export tasks') : t('Export MP4')}
        style={{ minWidth: 58, height: 26, background: theme.accent, color: theme.onAccent, border: 'none', borderRadius: 2, padding: '0 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginLeft: 4 }}>
        {exporting ? t('{n} exports', { n: Math.max(1, exportJobCount) }) : t('Export')}
      </button>
      </div>
      {/* No fallback: a dialog that is still loading shows nothing, exactly as it
          did before it was opened — the same treatment the other overlays get. */}
      <Suspense fallback={null}>
        {mcpOpen && <McpGuideDialog onClose={() => setMcpOpen(false)} />}
      </Suspense>
    </header>
  );
}
