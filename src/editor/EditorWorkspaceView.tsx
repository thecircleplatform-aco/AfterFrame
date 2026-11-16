import { Suspense, useSyncExternalStore, type ComponentProps } from 'react';
import { theme } from '../theme';
import { getChatSide, subscribeChatSide } from './chatSide';
import { TopBar } from '../components/TopBar';
import type { ChatPanel } from '../components/chat/ChatPanel';
import { LibraryPanel } from '../library/LibraryPanel';
import { MainSectionDock } from '../library/MainSectionDock';
import { MainSectionSheet } from '../library/MainSectionSheet';
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
  // The work area is one rounded card, so it re-uses the outer track sizes inside a
  // nested grid: ratios, resize handles and divider positions stay identical.
  // The library column moved into the bottom sheet, so its track (and the
  // divider beside it) collapse to zero and the preview gets the whole width.
  const workColumns = `0px 0 ${splitTracks(props.gridTemplateColumns).slice(-1).join(' ') || '1fr'}`;
  const workRows = splitTracks(props.gridTemplateRows).slice(1).join(' ') || '1fr';
  // The chat is a dock section now, so neither it nor the library occupies a
  // grid track: the two leading tracks collapse and the work card — still placed
  // at column 3 — gets the whole width.
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
      {/* The agent now lives in the bottom sheet as the dock's first section, so
          the floating overlay (and its edge handle) is gone: one panel, one
          entry point, always anchored to the screen footer. */}
      {/* Second main widget: one rounded card holding the library, the preview/inspector
          and the timeline, matching the chat card's frame. */}
      <div
        className="cc-work-card"
        style={{
          gridColumn: '3 / -1',
          gridRow: '2 / -1',
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
        {/* Preview panel (and its 30px header) removed: the upper work area and
            its resize divider collapse so the timeline fills the whole card. */}
        <div style={{ gridColumn: 1, gridRow: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }} />
        <div style={{ gridColumn: 2, gridRow: 1 }} />
        <div style={{ gridColumn: '1 / -1', gridRow: 3, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <TimelineTabs {...props.timelineTabs} />
          <Timeline {...props.timeline} />
        </div>
        <BrandRim radius={18} />
      </div>
      <div className="cc-main-dock-host">
        <MainSectionSheet panel={props.libraryPanel} agent={props.chatPanel} />
        <MainSectionDock />
      </div>
      <AppToastHost />
    </div>
  );
}
