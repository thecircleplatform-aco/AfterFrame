// The agent panel as it appears inside the bottom sheet: the same ChatPanel,
// without the floating overlay's positioning, plus a header that carries the
// product lockup and the panel's own controls.
//
// The chat's built-in title bar is suppressed (`hideHeader`) because this header
// replaces it — two stacked bars showed the same logo twice. The controls that
// lived in the chat bar (phone remote, clear chat) moved here rather than being
// dropped, and the header now also owns full screen, a menu and notifications.
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../modules/icons';
import { useT } from '../i18n/locale';
import { closeMainTabSheet } from '../library/LibraryPanel';
import { ChatPanel } from '../components/chat/ChatPanel';
import {
  getAgentHeaderState,
  subscribeAgentHeader,
} from '../components/chat/agentHeaderBridge';

interface AgentPanelViewProps {
  panel: React.ComponentProps<typeof ChatPanel>;
  /** Expand the sheet to full screen (the grip can already do this by drag). */
  onToggleFullScreen?: () => void;
  fullScreen?: boolean;
}

export function AgentPanelView({ panel, onToggleFullScreen, fullScreen }: AgentPanelViewProps) {
  const t = useT();
  // Live values/actions published by the chat (see agentHeaderBridge).
  const bridge = useSyncExternalStore(subscribeAgentHeader, getAgentHeaderState, getAgentHeaderState);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  // Click-away / Escape for both popovers. Kept local: the header is the only
  // owner of these panels, so there is nothing to lift out.
  useEffect(() => {
    if (!menuOpen && !noticesOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (menuOpen && !menuRef.current?.contains(target) && !target.closest?.('[data-agent-header-menu]')) {
        setMenuOpen(false);
      }
      if (noticesOpen && !noticeRef.current?.contains(target) && !target.closest?.('[data-agent-header-notice]')) {
        setNoticesOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setNoticesOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, noticesOpen]);

  const clearChat = useCallback(() => {
    setMenuOpen(false);
    bridge.clearHistory();
  }, [bridge]);

  const openRemote = useCallback(() => {
    setMenuOpen(false);
    bridge.setRemoteOpen(true);
  }, [bridge]);

  return (
    <div className="cc-agent-panel">
      <div className="cc-library-sheet-head cc-agent-head">
        <button type="button" className="cc-library-sheet-back"
          onClick={closeMainTabSheet} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevronDown" size={14} />
        </button>
        <span className="cc-agent-brand">
          {/* The brain mark sits in a soft orbit ring and carries the brand
              spectrum, so the panel reads as "the agent is thinking" rather
              than as a static product logo. */}
          <span className="cc-agent-orbit" aria-hidden="true">
            <span className="cc-agent-orbit-ring" />
            <span className="cc-agent-orbit-core">
              <Icon name="brain" size={15} strokeWidth={1.9} />
            </span>
          </span>
          <span className="cc-agent-title">{t('Agent')}</span>
        </span>

        {/* Right-hand control cluster. */}
        <div className="cc-agent-head-actions">
          <div className="cc-agent-head-popover" ref={noticeRef}>
            <button
              type="button"
              className="cc-agent-head-btn"
              onClick={() => { setNoticesOpen((open) => !open); setMenuOpen(false); }}
              title={t('Notifications')}
              aria-label={t('Notifications')}
              aria-expanded={noticesOpen}
              data-agent-header-notice
            >
              <Icon name="bell" size={15} />
              {bridge.noticeCount > 0 && (
                <span className="cc-agent-head-badge">{bridge.noticeCount}</span>
              )}
            </button>
            {noticesOpen && (
              <div className="cc-agent-head-menu" role="dialog" aria-label={t('Notifications')}>
                {bridge.notices.map((notice) => (
                  <div key={notice.id} className="cc-agent-head-notice">
                    <div className="cc-agent-head-notice-body">
                      <p className="cc-agent-head-notice-title">{notice.title}</p>
                      {notice.detail && <p className="cc-agent-head-notice-detail">{notice.detail}</p>}
                    </div>
                    {notice.actionLabel && (
                      <button type="button" className="cc-agent-head-notice-action"
                        onClick={() => { notice.onAction?.(); setNoticesOpen(false); }}>
                        {notice.actionLabel}
                      </button>
                    )}
                    <button type="button" className="cc-agent-head-notice-close"
                      aria-label={t('Dismiss')} title={t('Dismiss')}
                      onClick={() => bridge.dismissNotice(notice.id)}>
                      <Icon name="x" size={11} />
                    </button>
                  </div>
                ))}
                {bridge.noticeCount === 0 && bridge.guestCount === 0 && !bridge.running && (
                  <p className="cc-agent-head-empty">{t('No new notifications')}</p>
                )}
                {bridge.guestCount > 0 && (
                  <p className="cc-agent-head-note">
                    {t('{n} device(s) connected to the phone remote', { n: String(bridge.guestCount) })}
                  </p>
                )}
                {bridge.running && (
                  <p className="cc-agent-head-note">{t('The agent is working on your edit.')}</p>
                )}
              </div>
            )}
          </div>

          {onToggleFullScreen && (
            <button
              type="button"
              className={`cc-agent-head-btn${fullScreen ? ' is-on' : ''}`}
              onClick={onToggleFullScreen}
              title={fullScreen ? t('Exit full screen') : t('Full screen')}
              aria-label={fullScreen ? t('Exit full screen') : t('Full screen')}
              aria-pressed={fullScreen}
            >
              <Icon name="fullscreen" size={15} />
            </button>
          )}

          <div className="cc-agent-head-popover" ref={menuRef}>
            <button
              type="button"
              className={`cc-agent-head-btn${menuOpen ? ' is-on' : ''}`}
              onClick={() => { setMenuOpen((open) => !open); setNoticesOpen(false); }}
              title={t('Agent menu')}
              aria-label={t('Agent menu')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-agent-header-menu
            >
              <Icon name="moreVertical" size={15} />
            </button>
            {menuOpen && (
              <div className="cc-agent-head-menu" role="menu" aria-label={t('Agent menu')}>
                <button type="button" role="menuitem" onClick={openRemote}>
                  <Icon name="qrCode" size={14} />
                  <span>{t('Phone remote')}</span>
                  {bridge.guestCount > 0 && <span className="cc-agent-head-live" aria-hidden="true" />}
                </button>
                <button type="button" role="menuitem" onClick={clearChat} disabled={bridge.running}>
                  <Icon name="trash" size={14} />
                  <span>{t('Clear chat')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="cc-library-sheet-body">
        <Suspense fallback={null}>
          <ChatPanel {...panel} collapsed={false} hideHeader />
        </Suspense>
      </div>
    </div>
  );
}
