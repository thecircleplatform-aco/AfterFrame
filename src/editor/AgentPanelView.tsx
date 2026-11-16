// The agent panel as it appears inside the bottom sheet: the same ChatPanel,
// without the floating overlay's positioning, plus a capsule header that can
// drop the panel back down. Kept separate from ChatPanel so the panel keeps its
// own scroller, composer and keyboard handling untouched.
import { Suspense } from 'react';
import { Icon } from '../modules/icons';
import { useT } from '../i18n/locale';
import { closeMainTabSheet } from '../library/LibraryPanel';
import { ChatPanel } from '../components/chat/ChatPanel';

export function AgentPanelView({ panel }: { panel: React.ComponentProps<typeof ChatPanel> }) {
  const t = useT();
  return (
    <div className="cc-agent-panel">
      <div className="cc-library-sheet-head">
        <button type="button" className="cc-library-sheet-back"
          onClick={closeMainTabSheet} title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevronDown" size={14} />
        </button>
        <strong className="cc-library-sheet-title">{t('AfterFrame Agent')}</strong>
      </div>
      <div className="cc-library-sheet-body">
        <Suspense fallback={null}>
          <ChatPanel {...panel} collapsed={false} />
        </Suspense>
      </div>
    </div>
  );
}
