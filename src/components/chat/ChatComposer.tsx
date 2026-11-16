import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../theme';
import { localizedCatalogText, useT } from '../../i18n/locale';
import { Icon, type IconName } from '../../modules/icons';
import { MenuDrillHeader } from '../timeline/MenuDrillHeader';
import { findSkill, setCustomSkills, allCreativeSkills } from '../../agent/skills/skills-catalog';
import type { SkillDefinition } from '../../agent/skills/skill-types';
import { loadCustomSkills } from '../../persist/skillStore';
import {
  deleteCustomAgent,
  listCustomAgents,
  saveCustomAgent,
  subscribeCustomAgents,
  type CustomAgent,
} from '../../agent/customAgents';
import { usePersistedState } from '../../hooks/usePersistedState';
import {
  AgentModeIcon,
  ComposerMoreMenu,
  ComposerToolbar,
  type ComposerPopover as ComposerPopoverName,
} from './ComposerToolbar';
import { ComposerPopover } from './ComposerPopover';
import { ComposerModelPicker } from './ComposerModelPicker';
import { useComposerModelView } from './useComposerModelView';
import { hasPendingComposerAttachment, shouldSubmitComposerOnKeyDown } from './composerSubmitGate';
import { WorkflowPickerContent } from './WorkflowPickerContent';
import { hasEditorDrag, parseEditorDrag } from '../../editor/editorDrag';
import { droppedFiles, hasExternalFiles } from '../../media/externalFileDrop';
import { AgentComposerSettings } from './AgentComposerSettings';
import { ComposerSlashPopover, ComposerStatus } from './ChatComposerOverlays';
import { REF_ICON, type ChatComposerProps, type ChatMode, type RefItem } from './ChatComposerContract';

export type { ChatMode, RefItem } from './ChatComposerContract';

/** composer shell height (includes textarea + toolbar); drag the top handle to resize */
const COMPOSER_H_MIN = 88;
const COMPOSER_H_MAX = 420;
const COMPOSER_H_DEFAULT = 112;
/** The custom-agent form is a centered popup over the whole screen, so the
 *  composer keeps its shape and the form is never squeezed by the card width. */
const AGENT_EDITOR_PANEL: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 0, width: 'min(520px, calc(100vw - 32px))',
  height: 'min(620px, calc(100vh - 64px))', maxHeight: 'calc(100vh - 64px)',
  overflow: 'hidden', boxSizing: 'border-box',
  borderRadius: 16, border: '0.5px solid rgba(255,255,255,0.16)', background: '#000',
  boxShadow: '0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04) inset',
  color: '#fff',
};
/** Pinned title strip: the dialog never scrolls as a whole. */
const AGENT_EDITOR_HEAD: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px 10px',
  borderBottom: '0.5px solid rgba(255,255,255,0.10)', flex: '0 0 auto',
};
/** Name field sits directly under the title and stays put while the prompt scrolls. */
const AGENT_EDITOR_NAMEBAR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
  borderBottom: '0.5px solid rgba(255,255,255,0.10)', flex: '0 0 auto',
};
const AGENT_EDITOR_FOOT: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
  borderTop: '0.5px solid rgba(255,255,255,0.10)', flex: '0 0 auto',
};
const AGENT_EDITOR_BODY: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto', minHeight: 0,
  padding: '12px 18px 8px',
};
const agentEditorPanel = AGENT_EDITOR_PANEL;
/** Custom agents get a real brief: the system prompt must be at least this long. */
const AGENT_PROMPT_MIN = 3000;
function agentPromptReady(editor: { prompt: string }): boolean {
  return editor.prompt.trim().length >= AGENT_PROMPT_MIN;
}
const AGENT_EDITOR_SCRIM: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center',
  padding: 16, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
};
export const WORKFLOW_POPOVER_WIDTH = 400;

export function ChatComposer(props: ChatComposerProps) {
  const t = useT();
  // The skill catalog comes with its own official English name, which can be used directly in English without duplication in the dictionary; the summary is only in Chinese, so use t().
  const skillName = (s: { name: string; nameZh: string }): string =>
    localizedCatalogText(s.name, s.nameZh);
  const {
    value, onChange, onSubmit, onStop, onEnhance, enhancing, running, mode, onModeChange,
    agentPresetId = null, onAgentPresetChange,
    autoApply, onAutoApplyChange, contextUsage, selecting, onToggleSelecting,
    creativeMode, onCreativeModeChange, references, onInsertRef,
    selectedRefs = [], onRemoveRef, onPasteFiles, onDropFiles, pasting, pendingAttachmentCount = 0,
    pasteError, onDismissPasteError,
    onDropEditorItem,
    taRef, placeholder,
  } = props;
  const [editorDragOver, setEditorDragOver] = useState(false);
  // Custom agents: user presets (name + pasted prompt + optional read-only scope).
  const [agents, setAgents] = useState<CustomAgent[]>(() => listCustomAgents());
  useEffect(() => subscribeCustomAgents(() => setAgents(listCustomAgents())), []);
  const [agentEditor, setAgentEditor] = useState<{ id: string | null; name: string; prompt: string; readOnly: boolean } | null>(null);
  const editorDragDepth = useRef(0);
  // Hydration custom skill (manage_skill): read IDB → memory registry when mounting, bump triggers re-rendering
  // Make allCreativeSkills()/findSkill reflect custom skills. The real source is IDB, and the manage_skill tool is also the same.
  const [, bumpCustom] = useState(0);
  useEffect(() => {
    loadCustomSkills().then((list) => { setCustomSkills(list); bumpCustom((n) => n + 1); });
  }, []);
  const activeSkill = findSkill(creativeMode);
  // ArrowUp/ArrowDown prompt history, shell style. Entries run oldest → newest;
  // index -1 means "not browsing", so the live draft is stashed and restored.
  const promptHistory = useRef<string[]>([]);
  const historyPos = useRef(-1);
  const draftStash = useRef('');
  const submitPrompt = () => {
    const text = value.trim();
    if (text && promptHistory.current[promptHistory.current.length - 1] !== text) {
      promptHistory.current.push(text);
      if (promptHistory.current.length > 50) promptHistory.current.shift();
    }
    historyPos.current = -1;
    draftStash.current = '';
    onSubmit();
  };
  /** Returns true when the keystroke was consumed by history recall. */
  const recallPrompt = (direction: -1 | 1): boolean => {
    const history = promptHistory.current;
    if (history.length === 0) return false;
    if (direction === -1) {
      if (historyPos.current === -1) {
        draftStash.current = value;
        historyPos.current = history.length - 1;
      } else if (historyPos.current > 0) {
        historyPos.current -= 1;
      }
      onChange(history[historyPos.current] ?? '');
      return true;
    }
    if (historyPos.current === -1) return false;
    if (historyPos.current < history.length - 1) {
      historyPos.current += 1;
      onChange(history[historyPos.current] ?? '');
    } else {
      historyPos.current = -1;
      onChange(draftStash.current);
    }
    return true;
  };
  const modelView = useComposerModelView(contextUsage);
  const {
    activeModel, contextLabel, contextTitle, contextNearLimit, modelReady, modelState,
  } = modelView;
  const [pop, setPop] = useState<ComposerPopoverName>(null);
  const [popAnchor, setPopAnchor] = useState<HTMLElement | null>(null);
  /** @ picker drill level: root → assets/timeline/templates → track items. */
  type RefDrill = 'root' | 'assets' | 'timeline' | 'templates' | `track:${string}`;
  const [refDrill, setRefDrill] = useState<RefDrill>('root');
  const [refIndex, setRefIndex] = useState(-1);
  // `/` skill command: value starting with `/` opens completion. Two shapes:
  //   `/skill:<query>`  explicit skill command (matches slug/name strictly)
  //   `/<query>`        loose completion (slug prefix, then slug/name/nameZh substring)
  const slashQuery = value.startsWith('/') ? value.slice(1) : null;
  const slashExplicit = slashQuery !== null && slashQuery.startsWith('skill:');
  const slashMatchQuery = slashExplicit && slashQuery !== null ? slashQuery.slice('skill:'.length) : slashQuery;
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(-1);
  const slashListRef = useRef<HTMLDivElement>(null);
  const slashMatches = useMemo((): SkillDefinition[] => {
    if (slashMatchQuery === null) return [];
    const q = slashMatchQuery.toLowerCase().trim();
    const skills = allCreativeSkills();
    if (!q) return skills;
    if (slashExplicit) {
      const exact = skills.filter((s) => s.slug.toLowerCase() === q
        || s.name.toLowerCase() === q || s.nameZh.toLowerCase() === q);
      if (exact.length > 0) return exact;
      return skills.filter((s) => s.slug.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    const starts = skills.filter((s) => s.slug.toLowerCase().startsWith(q));
    const contains = skills.filter((s) => !starts.includes(s)
      && (s.slug.toLowerCase().includes(q)
        || s.name.toLowerCase().includes(q)
        || s.nameZh.includes(q)));
    return [...starts, ...contains];
  }, [slashExplicit, slashMatchQuery]);
  // Keyboard navigation scrolls the highlighted row into view — the list is
  // taller than its maxHeight once there are 5+ skills. Lives after the
  // useMemo: the dependency array evaluates immediately (TDZ).
  useEffect(() => {
    const list = slashListRef.current;
    if (!list || slashIndex < 0) return;
    const item = list.children[slashIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex, slashMatches.length]);
  useEffect(() => {
    if (slashMatchQuery === null) { setSlashOpen(false); return; }
    setSlashOpen(true);
    setSlashIndex((i) => (slashMatches.length > 0 ? Math.min(i, slashMatches.length - 1) : -1));
  }, [slashMatches.length, slashMatchQuery]);
  const activateSlash = (skill: SkillDefinition) => {
    // Skill selection never fills the composer: the user typed their own
    // task. Activation = creative mode set + clean input + focus.
    setSlashOpen(false);
    setSlashIndex(-1);
    onChange('');
    onCreativeModeChange(skill.id);
    taRef.current?.focus();
  };
  const { agentSettings, patchAgent } = props;
  const closePop = () => { setPop(null); setPopAnchor(null); };
  const toggle = (p: ComposerPopoverName, el?: EventTarget | null) => {
    const node = el instanceof HTMLElement ? el : null;
    setPop((cur) => {
      if (cur === p) { setPopAnchor(null); return null; }
      setPopAnchor(node);
      return p;
    });
  };
  const attachmentsPending = hasPendingComposerAttachment(pasting, pendingAttachmentCount);
  const canSend = !!value.trim() && !running && !attachmentsPending && modelReady;
  const canEnhance = !!value.trim() && !enhancing && !running && !attachmentsPending && modelReady;
  const pendingReason = t('Wait for the attachments to finish importing.');
  const sendTitle = attachmentsPending
    ? pendingReason
    : modelReady
      ? t('Send (Enter)')
      : modelState.loaded
        ? t('Configure a model provider in Settings first.')
        : t('Reading model configuration…');
  const refList = (kind: 'asset' | 'template') =>
    references.filter((r) => (kind === 'template' ? r.kind === 'template' : r.kind !== 'template'));

  const insert = (reference: RefItem) => { onInsertRef(reference); closePop(); taRef.current?.focus(); };

  // Drag up and down to change the height of the input area: top handle + localStorage memory
  const [shellH, setShellH] = usePersistedState('cc.composerShellH', COMPOSER_H_DEFAULT);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onResizePointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: shellH };
  }, [shellH]);
  const onResizePointerMove = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // drag up → taller (negative dy grows height)
    const next = Math.max(COMPOSER_H_MIN, Math.min(COMPOSER_H_MAX, d.startH + (d.startY - e.clientY)));
    setShellH(next);
  }, [setShellH]);
  const onResizePointerUp = useCallback(() => { dragRef.current = null; }, []);

  // Agent-mode menu: one line per mode — mark, name, and the key hint that
  // matches the shortcut bound on the composer.
  const modeRow = (m: ChatMode, label: string, desc: string, icon: IconName, keys?: string) => {
    // A custom preset owns the check mark while it is active; picking a built-in mode
    // clears the preset so its extra prompt cannot keep applying invisibly.
    const active = !agentPresetId && mode === m;
    return (
      <button key={m} type="button" className="cc-mode-row" data-active={active} title={desc}
        onClick={() => { onModeChange(m); onAgentPresetChange?.(null); closePop(); }}>
        <span className="cc-mode-icon">
          {m === 'agent' ? <AgentModeIcon live={active} size={14} /> : <Icon name={icon} size={14} />}
        </span>
        <span>{label}</span>
        {keys && <kbd className="cc-mode-keys">{keys}</kbd>}
      </button>
    );
  };

  const customAgentRow = (agent: CustomAgent) => {
    const active = agentPresetId === agent.id;
    return (
      <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button type="button" className="cc-mode-row" data-active={active}
          onClick={() => { onAgentPresetChange?.(active ? null : agent.id); closePop(); }}>
          <span className="cc-mode-icon"><Icon name="agentMark" size={14} /></span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
          {agent.readOnly && <span className="cc-mode-keys">{t('Read-only')}</span>}
        </button>
        <button type="button" title={t('Edit')}
          onClick={() => { setAgentEditor({ id: agent.id, name: agent.name, prompt: agent.prompt, readOnly: agent.readOnly }); closePop(); }}
          style={{ background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', padding: 4, borderRadius: 3, display: 'inline-flex', flex: '0 0 auto' }}>
          <Icon name="pencil" size={11} />
        </button>
      </div>
    );
  };

  const refRow = (r: RefItem) => (
    <button key={r.id} onClick={() => insert(r)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '7px 10px', cursor: 'pointer', color: theme.text }}
      onMouseEnter={(e) => { e.currentTarget.style.background = theme.panel; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
      <span style={{ color: theme.textDim, lineHeight: 0 }}><Icon name={REF_ICON[r.kind]} size={15} /></span>
      <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
    </button>
  );

  const refGroupTitle = (text: string) => (
    <div style={{ fontSize: 10.5, color: theme.textDim, padding: '6px 8px 2px', letterSpacing: 0.4 }}>{text}</div>
  );

  interface RefEntry { key: string; icon: IconName; label: string; sub?: string; action: () => void }

  const refEntries = (): RefEntry[] => {
    const assets = references.filter((r) => r.kind !== 'template' && r.kind !== 'item');
    const timelineItems = references.filter((r) => r.kind === 'item');
    const trackOf = (r: RefItem): string => (r.kind === 'item' && r.metadata?.trackAlias ? r.metadata.trackAlias : '');
    const tracks = [...new Set(timelineItems.map(trackOf))].filter(Boolean);
    const go = (drill: RefDrill) => () => { setRefDrill(drill); setRefIndex(0); };
    if (refDrill === 'assets') {
      return assets.map((r) => ({ key: r.id, icon: REF_ICON[r.kind], label: r.name, action: () => insert(r) }));
    }
    if (refDrill === 'timeline') {
      return tracks.map((alias) => ({
        key: alias, icon: 'film', label: alias,
        sub: `${timelineItems.filter((r) => trackOf(r) === alias).length}`,
        action: go(`track:${alias}`),
      }));
    }
    if (refDrill === 'templates') {
      return refList('template').map((r) => ({ key: r.id, icon: REF_ICON[r.kind], label: r.name, action: () => insert(r) }));
    }
    if (refDrill.startsWith('track:')) {
      const alias = refDrill.slice('track:'.length);
      return timelineItems.filter((r) => trackOf(r) === alias)
        .map((r) => ({ key: r.id, icon: REF_ICON[r.kind], label: r.name, action: () => insert(r) }));
    }
    return [
      { key: 'assets', icon: 'filePlay', label: t('Reference media pool assets'), sub: `${assets.length}`, action: go('assets') },
      { key: 'timeline', icon: 'film', label: t('Timeline'), sub: `${tracks.length}`, action: go('timeline') },
      { key: 'templates', icon: 'sparkles', label: t('Reference template library'), action: go('templates') },
    ];
  };

  const refDrillTitle = (): { title: string; onBack: (() => void) | null } => {
    if (refDrill === 'assets') return { title: t('Reference media pool assets'), onBack: () => { setRefDrill('root'); setRefIndex(0); } };
    if (refDrill === 'timeline') return { title: t('Timeline'), onBack: () => { setRefDrill('root'); setRefIndex(0); } };
    if (refDrill === 'templates') return { title: t('Reference template library'), onBack: () => { setRefDrill('root'); setRefIndex(0); } };
    if (refDrill.startsWith('track:')) return { title: refDrill.slice('track:'.length), onBack: () => { setRefDrill('timeline'); setRefIndex(0); } };
    return { title: t('Reference'), onBack: null };
  };

  const refPopoverBody = (kind: 'asset' | 'template', empty: string) => {
    if (kind === 'template') {
      const list = refList('template');
      return (
        <>
          {refGroupTitle(t('Reference template library'))}
          {list.length === 0 && <div style={{ fontSize: 12, color: theme.textDim, padding: '6px 10px' }}>{empty}</div>}
          {list.map(refRow)}
        </>
      );
    }
    const entries = refEntries();
    const drillTitle = refDrillTitle();
    return (
      <>
        {drillTitle.onBack
          ? <MenuDrillHeader title={drillTitle.title} onBack={drillTitle.onBack} />
          : refGroupTitle(drillTitle.title)}
        {entries.length === 0
          && <div style={{ fontSize: 12, color: theme.textDim, padding: '6px 10px' }}>{empty}</div>}
        {entries.map((entry, index) => (
          <button key={entry.key} onClick={entry.action}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', background: index === refIndex ? theme.panel : 'none', border: 'none', borderRadius: 3, padding: '7px 10px', cursor: 'pointer', color: theme.text }}
            onMouseEnter={() => setRefIndex(index)}
            onMouseLeave={() => { if (index === refIndex) setRefIndex(-1); }}>
            <span style={{ color: theme.textDim, lineHeight: 0 }}><Icon name={entry.icon} size={15} /></span>
            <span style={{ fontSize: 12.5, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.label}</span>
            {entry.sub && <span style={{ fontSize: 10, color: theme.textDim }}>{entry.sub}</span>}
            {drillTitle.onBack && <span style={{ color: theme.textDim }}>›</span>}
          </button>
        ))}
      </>
    );
  };

  return (
    <div
      className="cc-chat-composer cc-glass"
      data-cc-shortcut-surface="agent-input"
      data-editor-drag-over={editorDragOver ? 'true' : undefined}
      onDragEnter={(event) => {
        if (!hasEditorDrag(event) && !hasExternalFiles(event.dataTransfer)) return;
        event.preventDefault();
        editorDragDepth.current += 1;
        setEditorDragOver(true);
      }}
      onDragOver={(event) => {
        if (!hasEditorDrag(event) && !hasExternalFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!hasEditorDrag(event) && !hasExternalFiles(event.dataTransfer)) return;
        editorDragDepth.current = Math.max(0, editorDragDepth.current - 1);
        if (editorDragDepth.current === 0) setEditorDragOver(false);
      }}
      onDrop={(event) => {
        const files = droppedFiles(event.dataTransfer);
        const payload = parseEditorDrag(event);
        editorDragDepth.current = 0;
        setEditorDragOver(false);
        if (files.length > 0 && onDropFiles) {
          event.preventDefault();
          event.stopPropagation();
          onDropFiles(files);
          taRef.current?.focus();
          return;
        }
        if (!payload || !onDropEditorItem) return;
        event.preventDefault();
        event.stopPropagation();
        onDropEditorItem(payload);
        taRef.current?.focus();
      }}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        height: shellH, minHeight: COMPOSER_H_MIN, maxHeight: COMPOSER_H_MAX,
        width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'visible',
        boxSizing: 'border-box', borderRadius: 12,
        padding: '10px 6px 5px',
        boxShadow: editorDragOver ? `inset 0 0 0 1px ${theme.accent}` : undefined,
        transition: 'box-shadow 120ms ease',
      }}
    >
      {/* top edge drag handle — pull up to expand, down to shrink */}
      <div
        className="cc-chat-composer-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('Drag to resize the input')}
        title={t('Drag up or down to resize the input')}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      >
        <span className="cc-chat-composer-resize-grip" aria-hidden />
      </div>
      <ComposerStatus
        activeSkill={activeSkill}
        selectedRefs={selectedRefs}
        attachmentsPending={attachmentsPending}
        pendingReason={pendingReason}
        pasteError={pasteError}
        onCancelSkill={() => onCreativeModeChange(null)}
        onRemoveRef={onRemoveRef}
        onDismissPasteError={onDismissPasteError}
      />
      {/* Creating/editing a custom agent takes over the composer card itself:
          the widget becomes the agent form instead of a modal floating above it. */}
      {!agentEditor && (
        <>
      <textarea
        ref={taRef}
        data-cc-chat-composer
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) event.preventDefault();
          if (slashOpen && slashMatchQuery !== null) {
            if (event.key === 'ArrowDown' && slashMatches.length) {
              event.preventDefault();
              setSlashIndex((i) => (i + 1) % slashMatches.length);
              return;
            }
            if (event.key === 'ArrowUp' && slashMatches.length) {
              event.preventDefault();
              setSlashIndex((i) => (i <= 0 ? slashMatches.length - 1 : i - 1));
              return;
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && slashOpen) {
              // With the slash menu open, Enter/Tab must never fall through to
              // submitting the raw command text, even when there are zero
              // matches (e.g. a typo'ed skill name).
              event.preventDefault();
              if (slashMatches.length) activateSlash(slashMatches[Math.max(0, slashIndex)]);
              return;
            }
            if (event.key === 'Escape') {
              setSlashOpen(false);
              setSlashIndex(-1);
              onChange('');
              return;
            }
          }
          if (event.key === '@') {
            // @ opens the asset/timeline reference picker (anchored to the input).
            setPopAnchor(taRef.current);
            setRefDrill('root');
            setRefIndex(-1);
            setPop((cur) => (cur === 'assets' ? null : 'assets'));
            return;
          }
          if (pop === 'assets') {
            const entries = refEntries();
            if (event.key === 'ArrowDown' && entries.length) {
              event.preventDefault();
              setRefIndex((i) => (i + 1) % entries.length);
              return;
            }
            if (event.key === 'ArrowUp' && entries.length) {
              event.preventDefault();
              setRefIndex((i) => (i <= 0 ? entries.length - 1 : i - 1));
              return;
            }
            if (event.key === 'Enter' && entries.length) {
              event.preventDefault();
              entries[Math.max(0, refIndex)]?.action();
              return;
            }
          }
          // Shell-style prompt recall. Only when no menu owns the arrows, and only
          // with the caret parked at the start (↑) or end (↓), so editing a
          // multi-line draft with arrows keeps working.
          if (
            !slashOpen && pop === null && !event.shiftKey && !event.altKey
            && !event.ctrlKey && !event.metaKey
            && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
          ) {
            const ta = event.currentTarget;
            const collapsed = ta.selectionStart === ta.selectionEnd;
            const atStart = collapsed && ta.selectionStart === 0;
            const atEnd = collapsed && ta.selectionStart === value.length;
            const recalled = event.key === 'ArrowUp'
              ? (value === '' || atStart) && recallPrompt(-1)
              : (value === '' || atEnd) && recallPrompt(1);
            if (recalled) {
              event.preventDefault();
              return;
            }
          }
          // Ctrl/⌘+Shift+I snaps back to Agent mode — the hint on that row.
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
            event.preventDefault();
            onModeChange('agent');
            onAgentPresetChange?.(null);
            return;
          }
          if (shouldSubmitComposerOnKeyDown(event.key, event.shiftKey, canSend)) submitPrompt();
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (files.length > 0 && onPasteFiles) { e.preventDefault(); onPasteFiles(files); }
        }}
        placeholder={placeholder ?? t('Tell the AI what to change — @ to reference assets')}
        aria-describedby={attachmentsPending ? 'cc-chat-composer-import-status' : undefined}
        rows={1}
        style={{
          flex: 1, width: '100%', minHeight: 28, minWidth: 0, resize: 'none',
          overflowY: 'auto', background: 'transparent', border: 'none', outline: 'none',
          color: theme.text, fontSize: 13, fontFamily: 'inherit', lineHeight: 1.45,
        }}
      />
      <ComposerToolbar
        mode={mode} activeModel={activeModel} activeSkillName={activeSkill ? skillName(activeSkill) : undefined}
        agentPresetName={agents.find((agent) => agent.id === agentPresetId)?.name}
        contextLabel={contextLabel} contextTitle={contextTitle} contextNearLimit={contextNearLimit}
        pop={pop} selecting={selecting} enhancing={enhancing} running={running}
        canEnhance={canEnhance} canSend={canSend} sendTitle={sendTitle}
        onTogglePop={toggle} onToggleSelecting={onToggleSelecting} onEnhance={onEnhance}
        onSubmit={submitPrompt} onStop={onStop} />
        </>
      )}

      {/* menus rendered fixed — never clipped by composer bounds */}
      {pop === 'mode' && (
        <ComposerPopover width={252} anchor={popAnchor} onClose={closePop}>
          <div className="cc-mode-menu">
            {modeRow('agent', t('Agent'), t('Edits the timeline; changes are undoable'), 'brain', 'Ctrl+Shift+I')}
            {modeRow('ask', t('Ask'), t('Answers questions only; never changes the project'), 'info')}
            {modeRow('plan', t('Plan'), t('Researches first, then a step-by-step plan; changes nothing'), 'list')}
            {agents.length > 0 && <div className="cc-mode-divider" />}
            {agents.map(customAgentRow)}
            <div className="cc-mode-divider" />
            <button type="button" className="cc-mode-configure"
              onClick={() => { closePop(); setAgentEditor({ id: null, name: '', prompt: '', readOnly: false }); }}>
              <span><Icon name="plus" size={13} /></span>
              {t('Configure Custom Agents…')}
            </button>
          </div>
        </ComposerPopover>
      )}
      {agentEditor && createPortal(
        <div className="cc-agent-editor-scrim" style={AGENT_EDITOR_SCRIM}
          onMouseDown={() => setAgentEditor(null)}
          onKeyDown={(event) => { if (event.key === 'Escape') setAgentEditor(null); }}>
          <div className="cc-agent-editor" role="dialog" aria-modal="true" aria-label={t('Custom agent')}
            style={agentEditorPanel} onMouseDown={(event) => event.stopPropagation()}>
          <div style={AGENT_EDITOR_HEAD}>
            <span style={{ color: theme.accent, display: 'inline-flex' }}><Icon name="agentMark" size={15} /></span>
            <span style={{ fontSize: 14, fontWeight: 650, color: '#fff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agentEditor.id ? t('Edit custom agent') : t('Create custom agent')}
            </span>
            <button type="button" onClick={() => setAgentEditor(null)} title={t('Cancel')} aria-label={t('Cancel')}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
              <Icon name="x" size={15} />
            </button>
          </div>
          <div style={AGENT_EDITOR_NAMEBAR}>
            <input autoFocus value={agentEditor.name} onChange={(event) => setAgentEditor({ ...agentEditor, name: event.target.value })}
              placeholder={t('Name · e.g. short-form video editor')} aria-label={t('Name')}
              style={{ flex: 1, minWidth: 0, height: 34, padding: '0 11px', borderRadius: 9, border: '0.5px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 13, outline: 'none' }} />
          </div>
          <div style={AGENT_EDITOR_BODY}>
            <textarea value={agentEditor.prompt} onChange={(event) => setAgentEditor({ ...agentEditor, prompt: event.target.value })}
              placeholder={t('Paste this agent\'s behaviour: goal, style, usual tools, what it must not do…')}
              aria-label={t('System prompt')}
              style={{ flex: '1 1 auto', minHeight: 0, resize: 'none', overflowY: 'auto', padding: 11, borderRadius: 9, border: '0.5px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 13, lineHeight: 1.55, outline: 'none', fontFamily: 'inherit' }} />
            {/* The field fills the remaining card height and scrolls internally, so
                a long brief needs no oversized box and no page-level scrolling. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, flex: '0 0 auto' }}>
              <span style={{ color: agentPromptReady(agentEditor) ? 'rgba(255,255,255,0.55)' : theme.gold }}>
                {t('{n} / {min} characters', { n: agentEditor.prompt.trim().length, min: AGENT_PROMPT_MIN })}
              </span>
              {!agentPromptReady(agentEditor) && (
                <span style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {t('Describe the role, tone, tools and limits in detail.')}
                </span>
              )}
            </div>
          </div>
          <div style={AGENT_EDITOR_FOOT}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.65)', minWidth: 0 }}>
              <input type="checkbox" checked={agentEditor.readOnly} onChange={(event) => setAgentEditor({ ...agentEditor, readOnly: event.target.checked })} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('Read-only')}</span>
            </label>
            {agentEditor.id && (
              <button type="button" onClick={() => {
                const id = agentEditor.id!;
                deleteCustomAgent(id);
                if (agentPresetId === id) onAgentPresetChange?.(null);
                setAgentEditor(null);
              }}
                style={{ background: 'none', border: 'none', color: theme.danger, cursor: 'pointer', fontSize: 12, padding: 0 }}>{t('Delete')}</button>
            )}
            <button type="button" onClick={() => setAgentEditor(null)}
              style={{
                marginLeft: 'auto', height: 32, padding: '0 16px', borderRadius: 999,
                border: '0.5px solid rgba(255,255,255,0.18)', background: 'transparent',
                color: '#fff', fontSize: 12.5, cursor: 'pointer',
              }}>{t('Cancel')}</button>
            <button type="button" disabled={!agentEditor.name.trim() || !agentPromptReady(agentEditor)}
              onClick={() => {
                const saved = saveCustomAgent({ ...agentEditor, id: agentEditor.id ?? undefined });
                if (saved) { onAgentPresetChange?.(saved.id); setAgentEditor(null); }
              }}
              style={{
                height: 32, padding: '0 20px', borderRadius: 999, border: 'none',
                background: theme.accent, color: theme.onAccent, fontSize: 12.5, fontWeight: 650,
                cursor: (!agentEditor.name.trim() || !agentPromptReady(agentEditor)) ? 'default' : 'pointer',
                opacity: (!agentEditor.name.trim() || !agentPromptReady(agentEditor)) ? 0.5 : 1,
              }}>{t('Save')}</button>
          </div>
          </div>
        </div>,
        document.body,
      )}
      {pop === 'model' && (
        <ComposerModelPicker anchor={popAnchor} onClose={closePop} view={modelView} />
      )}
      {pop === 'settings' && (
        <ComposerPopover anchor={popAnchor} onClose={closePop}>
          <AgentComposerSettings
            autoApply={autoApply}
            onAutoApplyChange={onAutoApplyChange}
            settings={agentSettings}
            onSettingsChange={patchAgent}
          />
        </ComposerPopover>
      )}
      {pop === 'assets' && (
        <ComposerPopover anchor={popAnchor} onClose={closePop}>
          {refPopoverBody('asset', t('No media in the pool yet'))}
        </ComposerPopover>
      )}
      {pop === 'skill' && (
        <ComposerPopover
          width={WORKFLOW_POPOVER_WIDTH}
          className="cc-chat-popover--workflow"
          ariaLabel={t('Choose a workflow')}
          anchor={popAnchor}
          onClose={closePop}
        >
          <WorkflowPickerContent
            creativeMode={creativeMode}
            onCreativeModeChange={onCreativeModeChange}
            onRequestFocus={() => taRef.current?.focus()}
            onClose={closePop}
          />
        </ComposerPopover>
      )}
      {pop === 'templates' && (
        <ComposerPopover anchor={popAnchor} onClose={closePop}>
          {refPopoverBody('template', t('No templates yet'))}
        </ComposerPopover>
      )}
      {slashOpen && slashMatchQuery !== null && (
        <ComposerSlashPopover
          width={WORKFLOW_POPOVER_WIDTH}
          explicit={slashExplicit}
          query={slashMatchQuery}
          value={value}
          matches={slashMatches}
          activeIndex={slashIndex}
          creativeMode={creativeMode}
          anchor={taRef.current}
          listRef={slashListRef}
          onClose={() => { setSlashOpen(false); setSlashIndex(-1); }}
          onActivate={activateSlash}
          onHover={setSlashIndex}
        />
      )}
      {pop === 'more' && (
        <ComposerPopover anchor={popAnchor} onClose={closePop}>
          <ComposerMoreMenu
            selecting={selecting} activeSkillName={activeSkill ? skillName(activeSkill) : undefined}
            canEnhance={canEnhance} enhancing={enhancing}
            onChoosePopover={setPop} onToggleSelecting={onToggleSelecting}
            onEnhance={onEnhance} onClose={closePop} />
        </ComposerPopover>
      )}
    </div>
  );
}
