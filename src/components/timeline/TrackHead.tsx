// Track header unit: highlighted track label + show/mute/lock/caption menu/dodge/delete actions,
// plus the "Auto-dodge · mix role" popover. Cross-track menu exclusivity stays in Timeline;
// this component only renders and forwards commands.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { theme } from '../../theme';
import { Icon } from '../../modules/icons';
import type { EditorCommands } from '../../editor/store';
import type { TrackFlags, TrackId, TrackKind } from '../../editor/types';
import { useT } from '../../i18n/locale';
import type { TrackDeletePlan } from './trackDelete';
import { MenuDrillHeader } from './MenuDrillHeader';
import { COMPACT_HEADER_W } from './timelineUtil';

const flagBtn = (active: boolean): React.CSSProperties => ({
  width: 20, height: 20, display: 'grid', placeItems: 'center',
  background: active ? 'rgba(255,255,255,0.08)' : 'none', border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0,
  color: active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.72)', opacity: 1, flexShrink: 0,
});

interface TrackHeadProps {
  trackId: TrackId;
  kind: TrackKind;
  /** Stable title, e.g. Video1 / V1 — never the custom name. */
  trackName: string;
  /** Optional custom name rendered as a second row under the title. */
  customName?: string;
  config: TrackFlags;
  deleteBlockedReason: TrackDeletePlan['blockedReason'];
  onDelete: () => void;
  /** caption menu open on this track → raise head above neighbors */
  menuElevated: boolean;
  width: number;
  commands: EditorCommands;
  onToggleCaptions: () => void;
  onToggleCaptionMenu: (rect: DOMRect) => void;
  onToggleDuckMenu: (rect: DOMRect) => void;
  duckMenuPos: { left: number; top: number } | null;
  onCloseDuckMenu: () => void;
  onBackDuckMenu?: () => void;
  /** the open CaptionStyleMenu (fixed-positioned), when this track owns it */
  children?: ReactNode;
}

function trackDeleteTitle(
  blockedReason: TrackDeletePlan['blockedReason'],
  t: ReturnType<typeof useT>,
): string {
  if (blockedReason === 'last-video') return t('Keep at least one video track');
  if (blockedReason === 'locked') return t('Unlock the track first');
  return t('Delete track');
}

export function TrackHead({
  trackId, kind, trackName, customName, config, deleteBlockedReason, onDelete, menuElevated, width,
  commands, onToggleCaptions, onToggleCaptionMenu, onToggleDuckMenu, duckMenuPos, onCloseDuckMenu, onBackDuckMenu, children,
}: TrackHeadProps) {
  const t = useT();
  const hidden = config.hidden ?? false;
  const muted = config.muted ?? false;
  const locked = config.locked ?? false;
  const isCaption = kind === 'caption';
  const deleteTitle = trackDeleteTitle(deleteBlockedReason, t);
  const tagColor = kind === 'video' ? theme.trackVideo : kind === 'audio' ? theme.trackAudioA1 : theme.trackCaption;
  const nameTitle = config.role === 'anchor' ? `${trackName} · ${t('Anchor (ducking)')}`
    : config.role === 'follower' ? `${trackName} · ${t('Follower (ducking)')}`
      : trackName;
  // Below COMPACT_HEADER_W the name keeps the row and every action folds into
  // one "⋯" popover — a manually narrowed head (or a narrow window) stays legible.
  const compact = width < COMPACT_HEADER_W;
  /** Below MINI_HEADER_W there is no room for the name: only the caret shows. */
  const mini = width < 52;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!compact) setActionsOpen(false); }, [compact]);
  useEffect(() => {
    if (!actionsOpen) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-track-actions]')) return;
      // The caption-style / duck menus opened from the popover are fixed panes
      // outside this root — closing here would kill them the instant they open.
      if (target.closest('.cc-caption-style-menu')) return;
      setActionsOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [actionsOpen]);
  useEffect(() => {
    if (!renaming) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [renaming]);
  const startRename = () => {
    setActionsOpen(false);
    setRenaming(true);
  };
  const cancelRename = () => setRenaming(false);
  const commitRename = () => {
    const next = (nameInputRef.current?.value ?? '').trim();
    setRenaming(false);
    if (next === (customName ?? '').trim()) return;
    commands.updateTrack(trackId, { name: next || undefined });
  };
  const actions = (
    <>
      <button style={flagBtn(hidden)} title={hidden ? t('Show track') : t('Hide track')} onClick={isCaption ? onToggleCaptions : () => commands.toggleTrackFlag(trackId, 'hidden')}><Icon name={hidden ? 'eyeOff' : 'eye'} size={14} /></button>
      {!isCaption && <button style={flagBtn(muted)} title={muted ? t('Unmute') : t('Mute track')} onClick={() => commands.toggleTrackFlag(trackId, 'muted')}><Icon name={muted ? 'volumeOff' : 'volume'} size={14} /></button>}
      <button style={{ ...flagBtn(locked), color: locked ? theme.gold : 'rgba(255,255,255,0.72)' }} title={locked ? t('Unlock track') : t('Lock track (no moving / trimming / deleting / dropping)')} onClick={() => commands.toggleTrackFlag(trackId, 'locked')}><Icon name={locked ? 'lock' : 'unlock'} size={14} /></button>
      {isCaption && <button data-caption-menu-trigger style={flagBtn(false)} title={t('Caption style & translation')} onClick={(e) => onToggleCaptionMenu(e.currentTarget.getBoundingClientRect())}><Icon name="chevronDown" size={12} /></button>}
      {!isCaption && <button data-duck-menu-trigger style={{ ...flagBtn(config.role === 'anchor' || config.role === 'follower'), color: config.role === 'anchor' || config.role === 'follower' ? theme.gold : 'rgba(255,255,255,0.72)' }} title={t('Auto-ducking (mix roles: anchor speech / follower music)')} onClick={(e) => onToggleDuckMenu(e.currentTarget.getBoundingClientRect())}><Icon name="sliders" size={13} /></button>}
      <button
        type="button"
        className="cc-track-fixed-action"
        disabled={deleteBlockedReason !== null}
        title={deleteTitle}
        onClick={onDelete}
      >
        <Icon name="trash" size={13} />
      </button>
    </>
  );
  return (
    <div
      className={`cc-track-head${compact ? ' is-compact' : ''}${mini ? ' is-mini' : ''}`}
      style={{ width, ...(menuElevated ? { zIndex: 40 } : {}) }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        startRename();
      }}
    >
      <div className="cc-track-head-controls">
        {renaming ? (
          <input
            ref={nameInputRef}
            className="cc-track-name-input"
            defaultValue={customName ?? ''}
            aria-label={t('Track name')}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="cc-track-name"
            title={customName ? `${nameTitle} · ${customName}` : t('{name}（{id}）', { name: nameTitle, id: trackId })}
            data-kind={kind}
          >
            <span className="cc-track-name-dot" aria-hidden style={{ background: `color-mix(in srgb, ${tagColor} 55%, rgba(255,255,255,0.8))` }} />
            <span className="cc-track-name-title">{trackName}</span>
            {customName && <span className="cc-track-name-custom">{customName}</span>}
          </span>
        )}
        <span className="cc-track-actions">{actions}</span>
        {compact && (
          <button
            type="button"
            className="cc-track-actions-toggle"
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            title={t('Track options')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (actionsOpen) { setActionsOpen(false); return; }
              const r = e.currentTarget.getBoundingClientRect();
              setPopoverPos({ left: r.left, top: r.bottom + 4 });
              setActionsOpen(true);
            }}
          >
            <span style={{ display: 'grid', placeItems: 'center', transform: actionsOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms ease' }}>
              <Icon name="chevronDown" size={13} />
            </span>
          </button>
        )}
      </div>
      {actionsOpen && popoverPos && (
        <div
          className="cc-track-actions-popover"
          role="menu"
          data-track-actions
          style={{ position: 'fixed', left: popoverPos.left, top: popoverPos.top }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="cc-track-actions-popover-row">{actions}</div>
          <button type="button" role="menuitem" className="cc-track-actions-popover-item" onClick={startRename}>
            <Icon name="pencil" size={13} />
            <span>{t('Rename track')}</span>
          </button>
        </div>
      )}
      {children}
      {duckMenuPos && (
        <DuckMenu trackId={trackId} config={config} pos={duckMenuPos} commands={commands} onClose={onCloseDuckMenu} onBack={onBackDuckMenu ?? onCloseDuckMenu} />
      )}
    </div>
  );
}

// Duck (auto-dodge) role menu is a track-head menu item, not a
// permanent widget. Sets the per-track role (anchor speech / follower music) + duck depth;
// the engine (TimelineComposition duckGain) already reacts to it.
function DuckMenu({ trackId, config, pos, commands, onClose, onBack }: {
  trackId: TrackId;
  config: TrackFlags;
  pos: { left: number; top: number };
  commands: EditorCommands;
  onClose: () => void;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <div className="cc-caption-style-menu cc-duck-menu" style={{ position: 'fixed', left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
      <MenuDrillHeader title={t('Auto duck')} onBack={onBack} />
      <div className="cc-caption-style-list">
        {([
          { role: null, label: 'Close', hint: 'Not part of auto-ducking' },
          { role: 'anchor', label: 'Anchor · Speech', hint: 'Speech ducks the other tracks' },
          { role: 'follower', label: 'Follower · Background music', hint: 'Automatically lowered while the anchor speaks' },
        ] as const).map((opt) => (
          <button key={opt.label} className={(config.role ?? null) === opt.role ? 'active' : ''}
            onClick={() => { commands.updateTrack(trackId, { role: opt.role }); if (opt.role !== 'follower') onClose(); }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.25 }}>
              <span>{t(opt.label)}</span>
              <span style={{ fontSize: 11, color: theme.textMuted }}>{t(opt.hint)}</span>
            </span>
          </button>
        ))}
      </div>
      {config.role === 'follower' && (
        <div style={{ borderTop: `0.5px solid ${theme.border}`, padding: '7px 10px 9px' }}>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 5 }}>{t('Duck depth (dB)')}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[-6, -12, -18, -24].map((db) => {
              const cur = config.audioRouting?.duckDepthDb ?? -12;
              return (
                <button key={db} onClick={() => commands.updateTrack(trackId, { audioRouting: { duckDepthDb: db } })}
                  style={{ flex: 1, padding: '4px 0', borderRadius: 4, border: `0.5px solid ${theme.borderLight}`, cursor: 'pointer',
                    background: cur === db ? `color-mix(in srgb, ${theme.select} 30%, ${theme.hover})` : 'transparent', color: cur === db ? theme.textStrong : theme.textMuted, fontSize: 11 }}>
                  {db}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
