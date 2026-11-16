import { Suspense, useSyncExternalStore, type ComponentProps } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { theme } from '../theme';
import { getChatSide, subscribeChatSide } from './chatSide';
import { TopBar } from '../components/TopBar';
import { ChatPanel } from '../components/chat/ChatPanel';
import { AgentEdgeButton } from '../components/chat/AgentEdgeButton';
import { LibraryPanel } from '../library/LibraryPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { InspectorPanel } from '../components/InspectorPanel';
import { Timeline } from '../components/timeline/Timeline';
import { TimelineTabs } from '../components/timeline/TimelineTabs';
import { Divider } from '../components/Divider';
import { BrandRim } from '../components/BrandRim';
import { AppToastHost } from '../ui/AppToastHost';
// Opened on demand, so they load on demand — see workspaceDialogs.tsx.
import {
  DesignStylePanel, ExportDialog, SettingsDialog, ShortcutsDialog, VersionHistory,
} from './workspaceDialogs';
import { useWorkspaceDialogPrefetch } from './workspaceDialogLoaders';
import { useChatOverlayResize } from './useChatOverlayResize';

export interface EditorWorkspaceViewProps {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  topBar: ComponentProps<typeof TopBar>;
  exportDialog: ComponentProps<typeof ExportDialog> | null;
  designStylePanel: ComponentProps<typeof DesignStylePanel> | null;
  versionHistory: ComponentProps<typeof VersionHistory> | null;
  shortcutsDialog: ComponentProps<typeof ShortcutsDialog> | null;
  settingsDialog: ComponentProps<typeof SettingsDialog> | null;
  chatPanel: ComponentProps<typeof ChatPanel>;
  chatCollapsed: boolean;
  onResizeChat: ComponentProps<typeof Divider>['onResize'];
  libraryPanel: ComponentProps<typeof LibraryPanel>;
  onResizeLibrary: ComponentProps<typeof Divider>['onResize'];
  previewPanel: ComponentProps<typeof PreviewPanel>;
  inspectorPanel: ComponentProps<typeof InspectorPanel> | null;
  onResizeTimeline: ComponentProps<typeof Divider>['onResize'];
  timelineTabs: ComponentProps<typeof TimelineTabs>;
  timeline: ComponentProps<typeof Timeline>;
}


/** Split a CSS track list on top-level whitespace (keeps `minmax(a, b)` intact). */
function splitTracks(value: string): string[] {
  const tracks: string[] = [];
  let current = '';
  let depth = 0;
  for (const character of value.trim()) {
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(character)) {
      if (current) tracks.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) tracks.push(current);
  return tracks;
}

export function EditorWorkspaceView(props: EditorWorkspaceViewProps) {
  useWorkspaceDialogPrefetch();
  // Mirrors the grid when the chat is docked right; every child is reset to ltr
  // in index.css so only the panel order flips, never the text inside them.
  const chatSide = useSyncExternalStore(subscribeChatSide, getChatSide, getChatSide);
  // Same entrance/exit as the home-screen drawer (spring 380/34/0.9, ±28px slide),
  // so opening the agent reads as the same gesture as opening the menu.
  const reduceMotion = useReducedMotion();
  // Full-height by default; edges are resizable via long-press drag, and the
  // chosen box persists across reloads.
  const overlay = useChatOverlayResize();
  // The work area is one rounded card, so it re-uses the outer track sizes inside a
  // nested grid: ratios, resize handles and divider positions stay identical.
  const workColumns = splitTracks(props.gridTemplateColumns).slice(2).join(' ') || '1fr';
  const workRows = splitTracks(props.gridTemplateRows).slice(1).join(' ') || '1fr';
  // The chat no longer occupies a grid track: it floats above the work card, so the
  // two leading tracks (chat + its resize gutter) collapse to zero and the work card
  // — still placed at column 3 — gets the whole width.
  const headerTrack = splitTracks(props.gridTemplateRows)[0] ?? '56px';
  return (
    <div
      className="cc-editor-shell"
      data-chat-side={chatSide}
      style={{
        display: 'grid',
        gridTemplateColumns: `0px 0 ${workColumns}`,
        gridTemplateRows: props.gridTemplateRows,
        direction: chatSide === 'right' ? 'rtl' : 'ltr',
        height: '100vh',
        overflow: 'hidden',
        background: theme.bg,
        color: theme.text,
        fontFamily: 'var(--cc-font)',
      }}
    >
      <TopBar {...props.topBar} />
      {/* No fallback: an overlay that is still loading shows nothing, exactly as
          it did before it was opened. The idle prefetch keeps that window tiny. */}
      <Suspense fallback={null}>
        {props.exportDialog && <ExportDialog {...props.exportDialog} />}
        {props.settingsDialog && <SettingsDialog {...props.settingsDialog} />}
        {props.designStylePanel && <DesignStylePanel {...props.designStylePanel} />}
        {props.versionHistory && <VersionHistory {...props.versionHistory} />}
        {props.shortcutsDialog && <ShortcutsDialog {...props.shortcutsDialog} />}
      </Suspense>
      {/* Agent chat floats over the work card instead of taking a column of its own.
          `collapsed` is forced off: the overlay is either open or not rendered, so the
          old 46px rail would be a second, redundant way to reach the same panel. */}
      <AnimatePresence>
        {!props.chatCollapsed && (
          <motion.div
            key="agent-chat"
            ref={overlay.panelRef}
            className="cc-chat-overlay"
            data-resizing={overlay.resizing ?? undefined}
            initial={reduceMotion ? false : { x: chatSide === 'right' ? 28 : -28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion
              ? { opacity: 0 }
              : { x: chatSide === 'right' ? 28 : -28, opacity: 0 }}
            transition={reduceMotion
              ? { duration: 0.12 }
              : { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
            style={{
              ...(overlay.box
                ? {
                  left: overlay.box.left,
                  bottom: overlay.box.bottom,
                  width: overlay.box.width,
                  height: overlay.box.height,
                  top: 'auto',
                }
                : { top: `calc(${headerTrack} + 8px)` }),
            }}
          >
            {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
              <div
                key={edge}
                className="cc-chat-resize-handle"
                data-edge={edge}
                data-armed={overlay.armed === edge || undefined}
                role="separator"
                aria-orientation={edge === 'left' || edge === 'right' ? 'vertical' : 'horizontal'}
                aria-label={`Resize agent chat (${edge} edge) — hold and drag`}
                title="Hold and drag to resize"
                onPointerDown={overlay.onHandlePointerDown(edge)}
              />
            ))}
            <ChatPanel {...props.chatPanel} collapsed={false} />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Always-on handle on the screen border: click opens the agent, a horizontal
          drag re-docks the panel to the other side. */}
      <AgentEdgeButton
        open={!props.chatCollapsed}
        side={chatSide}
        onToggle={props.chatPanel.onToggleCollapse}
      />
      {/* Second main widget: one rounded card holding the library, the preview/inspector
          and the timeline, matching the chat card's frame. */}
      <div
        className="cc-work-card"
        style={{
          gridColumn: '3 / -1',
          gridRow: '2 / 5',
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: workColumns,
          gridTemplateRows: workRows,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          borderRadius: 18,
          border: `0.5px solid ${theme.border}`,
          background: theme.panel,
        }}
      >
        <div style={{ gridColumn: 1, gridRow: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
          <LibraryPanel {...props.libraryPanel} />
        </div>
        <div style={{ gridColumn: 2, gridRow: 1 }}>
          <Divider onResize={props.onResizeLibrary} />
        </div>
        <div className="cc-preview-workspace" style={{ gridColumn: 3, gridRow: 1 }}>
          <PreviewPanel {...props.previewPanel} />
          {props.inspectorPanel && <InspectorPanel {...props.inspectorPanel} />}
        </div>
        <div style={{ gridColumn: '1 / -1', gridRow: 2 }}>
          <Divider orientation="horizontal" onResize={props.onResizeTimeline} />
        </div>
        <div style={{ gridColumn: '1 / -1', gridRow: 3, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <TimelineTabs {...props.timelineTabs} />
          <Timeline {...props.timeline} />
        </div>
        <BrandRim radius={18} />
      </div>
      <AppToastHost />
    </div>
  );
}
