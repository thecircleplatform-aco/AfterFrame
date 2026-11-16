import { createPortal } from 'react-dom';
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { QrCodeIcon } from '@animateicons/react/lucide/qr-code-icon';
import { TrashIcon } from '@animateicons/react/lucide/trash-icon';
import { theme } from '../../theme';
import { Icon } from '../../modules/icons';
import { AfterFrameMark } from '../brand/afterframe-mark';
import { AfterFrameWordmark as AfterFrameWordmarkText } from '../brand/afterframe-logo';
import { AgentChangeLogMenu } from './AgentChangeLogMenu';
import { AgentRunInspector } from './AgentRunInspector';
import { ChatComposer } from './ChatComposer';
import { playMessageSentSound } from './sendSound';
import { ChatMessage } from './ChatMessage';
import { ChatRunStatus } from './ChatRunStatus.tsx';
import { ExternalProposalCard } from './ExternalProposalCard';
import { ProposalCard } from './ProposalCard';
import { ToolGroupRow } from './ToolGroupRow';
import { groupMessages } from './message-groups';
import type { DisplayMessage } from '../../agent/agent-session';
import { readStoredServerRun } from '../../agent/serverRunSessionStorage';
import type { ChatPanelController } from './chatPanelController';
import { CapabilityBanner } from './CapabilityGapBanner';
import { RemotePairDialog } from '../../modules/remote/RemotePairDialog';

/** Purple → pink → blue, matching the agent panel's edge mist. */
/** The welcome mark's tint lives in index.css (`.cc-chat-welcome-mark > span`),
 *  where it can also animate; a static inline gradient would override it. */

const MESSAGE_WINDOW_SIZE = 40;

function ChangeLogPortal({ controller }: { controller: ChatPanelController }) {
  const { changeLogSlot, agent } = controller;
  if (!changeLogSlot) return null;
  return createPortal(
    <AgentChangeLogMenu
      changeLog={agent.changeLog}
      running={agent.running}
      canRollback={agent.canRollbackChangeSession}
      onRollback={agent.rollbackChangeSession}
    />,
    changeLogSlot,
  );
}

function CollapsedPanel({ controller }: { controller: ChatPanelController }) {
  const { props, t } = controller;
  return <>
    <ChangeLogPortal controller={controller} />
    <aside className="cc-chat-panel collapsed" data-cc-shortcut-surface="agent-chat" tabIndex={-1}
      style={{ gridColumn: 1, gridRow: '2 / -2', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '10px 0', background: theme.panel }}>
      <button type="button" onClick={props.onToggleCollapse} title={t('Expand AfterFrame Agent')}
        style={{ background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer' }}>
        <ChevronRightIcon size={14} color="currentColor" />
      </button>
      <div className="cc-chat-collapsed-brand">AfterFrame</div>
    </aside>
  </>;
}

function ChatHeader({ controller }: { controller: ChatPanelController }) {
  const { props, t, agent } = controller;
  return <div className="cc-chat-header">
    <div className="cc-chat-brand">
      <AfterFrameMark size={20} />
      <span className="cc-chat-brand-copy">
        <AfterFrameWordmarkText size="sm" />
        <small>{t('Agent workspace')}</small>
      </span>
    </div>
    <AgentRunInspector projectId={props.projectId} />
    <button type="button" onClick={() => controller.setRemoteOpen((open) => !open)} title={t('Phone remote')}
      aria-pressed={controller.remoteOpen}
      style={{ position: 'relative', background: 'none', border: 'none', color: controller.remote.guestCount > 0 ? theme.accent : theme.textDim, cursor: 'pointer', padding: 2, lineHeight: 0 }}>
      <QrCodeIcon size={14} color="currentColor" />
      {controller.remote.guestCount > 0 && <span className="cc-remote-header-live" />}
    </button>
    <button type="button" onClick={agent.clearHistory} disabled={agent.running} title={t('Clear chat')}
      style={{ background: 'none', border: 'none', color: theme.textDim, cursor: agent.running ? 'default' : 'pointer', opacity: agent.running ? 0.4 : 1, padding: 2, lineHeight: 0 }}>
      <TrashIcon size={14} color="currentColor" />
    </button>
    {/* No collapse affordance for hosts that are themselves the whole page. */}
    {!props.hideHeader && (
      <button type="button" onClick={props.onToggleCollapse} title={t('Collapse AfterFrame Agent')}
        style={{ background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', padding: 2, lineHeight: 0 }}>
        <ChevronLeftIcon size={14} color="currentColor" />
      </button>
    )}
  </div>;
}

function ChatOnboarding({ controller }: { controller: ChatPanelController }) {
  const { t } = controller;
  return <div className="cc-chat-onboarding">
    <h2 className="cc-chat-welcome">
      {/* Brand mark in the agent's purple→pink→blue mix, set inline before the
          headline so the empty state still reads as "this is the Agent". */}
      <span className="cc-chat-welcome-mark" aria-hidden="true">
        <AfterFrameMark size={22} />
      </span>
      <span>{t('Start with an editing goal')}</span>
    </h2>
    <p>{t('Describe the finished video you want, or pick a workflow to begin.')}</p>
  </div>;
}

function EarlierMessagesButton({ controller }: { controller: ChatPanelController }) {
  const { visibleFrom, composer, t, scroll } = controller;
  if (visibleFrom === 0) return null;
  return <button type="button"
    onClick={() => {
      // Keep the current viewport anchored: the newly loaded history is
      // inserted above, so restore the previous bottom offset after render.
      const node = scroll.scrollRef.current;
      const bottomBefore = node ? node.scrollHeight - node.scrollTop : 0;
      composer.setVisibleMessageCount((count) => count + MESSAGE_WINDOW_SIZE);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (node) node.scrollTop = node.scrollHeight - bottomBefore;
      }));
    }}
    style={{ display: 'block', margin: '4px auto 12px', padding: '5px 10px', border: `0.5px solid ${theme.border}`, borderRadius: 6, background: 'transparent', color: theme.textDim, cursor: 'pointer', fontSize: 12 }}>
    {t('Load earlier messages')}（{visibleFrom}）
  </button>;
}

function lastUserTurn(messages: readonly DisplayMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === 'user') return index;
  }
  return -1;
}

function MessageEntries({ controller }: { controller: ChatPanelController }) {
  const { agent, composer, props, visibleMessages, visibleFrom } = controller;
  // Retry re-runs the turn instead of asking again after it: the failed attempt is rewound
  // out of both histories first, so an error or a half-finished tool call cannot steer the
  // second try. Only the latest turn offers it — rewinding an earlier one would discard
  // every turn after it as well.
  const lastUser = lastUserTurn(agent.messages);
  const onRetry = (index: number, retry: NonNullable<DisplayMessage['retry']>) => {
    if (agent.running) return;
    agent.rewindTurn(index);
    playMessageSentSound();
    void agent.send(retry.text, {
      askOnly: retry.askOnly,
      mode: retry.mode,
      customAgent: retry.customAgent,
      references: retry.references,
    });
  };
  return <>
    {groupMessages(visibleMessages, visibleFrom).map((item) => item.kind === 'toolgroup' ? (
      <ToolGroupRow key={item.index} name={item.name} items={item.items} onOpenSettings={props.onOpenSettings} />
    ) : (
      <ChatMessage key={item.index} msg={item.msg} running={agent.running}
        onOpenSettings={props.onOpenSettings}
        retry={item.msg.role === 'user' && item.index === lastUser ? item.msg.retry : undefined}
        streaming={agent.running && item.index === agent.messages.length - 1 && item.msg.role === 'assistant'}
        widgetSubmitted={agent.messages.slice(item.index + 1).some((message) => message.role === 'user')}
        onRetry={(retry) => onRetry(item.index, retry)}
        onContinue={item.msg.role === 'continue' && item.index === agent.messages.length - 1 && !agent.running
          ? () => { playMessageSentSound(); void agent.send('Continue'); } : null}
        onWidgetSubmit={(answer) => {
          if (!agent.running) { playMessageSentSound(); void agent.send(answer, { askOnly: composer.mode !== 'agent', mode: composer.mode }); }
        }} />
    ))}
  </>;
}

function AgentRunCards({ controller }: { controller: ChatPanelController }) {
  const { agent, composer, externalProposal, props, streamingThinking, runSeed } = controller;
  const showProposal = agent.proposal
    && !composer.autoApply;
  return <>
    <ChatRunStatus running={agent.running} liveTool={agent.liveTool}
      streamingThinking={streamingThinking} phraseSeed={runSeed}
      startedAt={readStoredServerRun(props.projectId)?.createdAt ?? Date.now()} />
    {showProposal && agent.proposal && (
      <ProposalCard proposal={agent.proposal} onApply={agent.applyProposal} onReject={agent.rejectProposal}
        stale={agent.proposalStale} onForceApply={agent.forceApplyProposal} onRePropose={agent.reProposeStale}
        onPreview={(on) => props.onPreviewState(on ? agent.proposal?.resultState ?? null : null)} />
    )}
    <ExternalProposalCard external={externalProposal} onPreviewState={props.onPreviewState} />
  </>;
}

function ScrollNavigation({ controller }: { controller: ChatPanelController }) {
  const { scroll, t } = controller;
  const target = scroll.target;
  if (!target) return null;
  const label = t(target === 'top' ? 'Jump to top' : 'Jump to bottom');
  return <div className={`cc-chat-scroll-navigation cc-chat-scroll-navigation--${target}`}
    aria-label={t('Chat scroll shortcuts')}>
    <button type="button"
      className={`cc-chat-scroll-navigation-button cc-tip${target === 'bottom' ? ' cc-chat-scroll-navigation-button--bottom cc-tip-up' : ''}`}
      data-tip={label} aria-label={label} onClick={() => scroll.scrollTo(target)}>
      <Icon name="arrowUp" size={14} />
    </button>
  </div>;
}

function MessageWorkspace({ controller }: { controller: ChatPanelController }) {
  const { agent, scroll } = controller;
  return <div className="cc-chat-messages-shell">
    <div ref={scroll.scrollRef} onScroll={scroll.onScroll}
      className={`cc-chat-messages${agent.messages.length === 0 ? ' empty' : ''}`}>
      {agent.messages.length === 0 && <ChatOnboarding controller={controller} />}
      <EarlierMessagesButton controller={controller} />
      <MessageEntries controller={controller} />
      <AgentRunCards controller={controller} />
    </div>
    <ScrollNavigation controller={controller} />
  </div>;
}

function ComposerInput({ controller }: { controller: ChatPanelController }) {  const { props, agent, composer, actions, references, t } = controller;
  return <ChatComposer
    value={composer.input} onChange={actions.onComposerChange}
    onSubmit={actions.submit} onStop={agent.stop}
    onEnhance={actions.runEnhance} enhancing={composer.enhancing} running={agent.running}
    mode={composer.mode} onModeChange={composer.setMode}
    agentPresetId={composer.agentPresetId} onAgentPresetChange={composer.setAgentPresetId}
    autoApply={composer.autoApply} onAutoApplyChange={composer.setAutoApply}
    agentSettings={composer.agentSettings} patchAgent={composer.patchAgent}
    contextUsage={agent.contextUsage}
    selecting={composer.selecting} onToggleSelecting={() => composer.setSelecting((value) => !value)}
    creativeMode={props.creativeMode} onCreativeModeChange={props.onCreativeModeChange}
    references={references} onInsertRef={actions.insertRef}
    selectedRefs={composer.selectedRefs} onRemoveRef={actions.removeRef}
    onPasteFiles={actions.importPastedFiles} onDropFiles={actions.importPastedFiles}
    pasting={composer.pendingAttachmentCount > 0}
    pendingAttachmentCount={composer.pendingAttachmentCount}
    pasteError={composer.pasteError} onDismissPasteError={() => composer.setPasteError(null)}
    onDropEditorItem={actions.onDropEditorItem} taRef={composer.taRef}
    placeholder={agent.messages.length === 0
      ? t('Describe what you want to create...') : t('Tell the AI what to change — @ to reference assets')} />;
}

function ComposerSection({ controller }: { controller: ChatPanelController }) {
  return <div style={{ padding: '2px 12px 12px', minWidth: 0, flexShrink: 0, boxSizing: 'border-box' }}>
    <ComposerInput controller={controller} />
  </div>;
}

function ExpandedPanel({ controller }: { controller: ChatPanelController }) {
  const { scroll } = controller;
  return <>
    <ChangeLogPortal controller={controller} />
    <aside className="cc-chat-panel" data-cc-chat-popover-boundary data-cc-shortcut-surface="agent-chat"
      data-running={controller.agent.running ? 'true' : undefined}
      tabIndex={-1} onKeyDown={scroll.onKeyDown}
      onPointerDownCapture={(event) => {
        if (!(event.target instanceof HTMLElement)) return;
        if (!event.target.closest('button, input, select, textarea, [contenteditable="true"]')) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      style={{
        gridColumn: 1, gridRow: '2 / -2', display: 'flex', flexDirection: 'column',
        background: theme.panel, minHeight: 0, minWidth: 0,
        // In the editor the panel is a grid cell and sized by the shell. When a
        // host renders it as the whole page (the Agent portal) it must claim the
        // full height itself, or it collapses to the height of its content.
        ...(controller.props.hideHeader ? { flex: 1, height: '100%', borderRadius: 0, border: 'none' } : {}),
      }}>
      {/* Hosts that draw their own chrome (the Agent portal) pass `hideHeader`
          so the workspace does not end up with two stacked title bars. */}
      {!controller.props.hideHeader && <ChatHeader controller={controller} />}
      <CapabilityBanner controller={controller} />
      <MessageWorkspace controller={controller} />
      <ComposerSection controller={controller} />
      {controller.remoteOpen && <RemotePairDialog host={controller.remote} onClose={() => controller.setRemoteOpen(false)} />}
    </aside>
  </>;
}

export function ChatPanelView({ controller }: { controller: ChatPanelController }) {
  return controller.props.collapsed
    ? <CollapsedPanel controller={controller} />
    : <ExpandedPanel controller={controller} />;
}
