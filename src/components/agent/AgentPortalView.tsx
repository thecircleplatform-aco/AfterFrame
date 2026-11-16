// The Agent portal: the same agent the editor uses, mounted on the dashboard so
// it can work ACROSS projects — list them, create them, duplicate or retarget
// them — instead of being locked inside one open timeline.
//
// It reuses `ChatPanel` and the full tool catalog unchanged. The only new piece
// is `useAgentPortalContext`, which supplies a project-less context so portfolio
// tools run while timeline edits have nowhere to land (until the agent opens a
// project, at which point we navigate into the editor).
import { useCallback, useState } from 'react';
import { theme, themeAlpha } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../../modules/icons';
import { ChatPanel } from '../chat/ChatPanel';
import { AGENT_PORTAL_PROJECT_ID, useAgentPortalContext } from '../../agent/agentPortalContext';
import type { TimelineState } from '../../editor/types';
import type { ChatMediaImporter } from '../chat/chatAttachmentImport';

/**
 * Attachments become media-pool assets on whatever project is open. The portal
 * has none, so importing there would invent an orphan asset. Refusing keeps the
 * media pool honest; the agent can still create a project and import inside it.
 */
const portalImportMedia: ChatMediaImporter = async () => {
  throw new Error('Attach media from inside a project — the Agent portal has no media pool.');
};

export function AgentPortalView({
  onProjectsChanged,
  onBack,
}: {
  onProjectsChanged?: () => void | Promise<void>;
  onBack?: () => void;
}) {
  const t = useT();
  const [creativeMode, setCreativeMode] = useState<string | null>(null);
  const ctx = useAgentPortalContext({ onProjectsChanged });

  // The editor's side panel mirrors the agent's preview selection. There is no
  // preview on the portal, so this is a no-op that keeps `ChatPanel` happy.
  const onPreviewState = useCallback((_state: TimelineState | null): void => {}, []);

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: theme.bg }}>
      {/* One screen, one surface: the chat panel fills the page edge to edge.
          A floating back button sits in the top-left corner over the panel. */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={t('Back to projects')}
          data-tip={t('Back to projects')}
          className="cc-tip cc-tip-r"
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 12,
            width: 30, height: 30, padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `0.5px solid ${themeAlpha.ink(0.14)}`, borderRadius: 8,
            background: theme.panelAlt, color: theme.textDim, cursor: 'pointer',
            boxShadow: `0 4px 14px ${themeAlpha.shadow(0.35)}`,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.color = theme.text; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = theme.textDim; }}
        >
          <Icon name="prev" size={14} />
        </button>
      )}

      {/* Constrain the conversation to a readable column, like every chat app,
          while the panel itself fills the viewport. */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        width: '100%', maxWidth: 860, margin: '0 auto', alignSelf: 'center',
        paddingTop: 6,
      }}>
        <ChatPanel
          ctx={ctx}
          projectId={AGENT_PORTAL_PROJECT_ID}
          // Collapse is an editor-side-panel affordance. The portal IS the page,
          // so there is nothing to collapse into — keep it permanently expanded
          // and give it a no-op toggle rather than a stranded 40px rail.
          collapsed={false}
          onToggleCollapse={() => {}}
          onPreviewState={onPreviewState}
          seed={null}
          creativeMode={creativeMode}
          onCreativeModeChange={setCreativeMode}
          hideHeader
          onImportMedia={portalImportMedia}
        />
      </div>
    </div>
  );
}
