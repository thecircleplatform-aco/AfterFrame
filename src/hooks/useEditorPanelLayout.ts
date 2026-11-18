import { usePersistedState } from './usePersistedState';

const HEADER_HEIGHT = 41;
const COLLAPSED_CHAT_WIDTH = 46;
const BASELINE_WIDTH = 1463;
const BASELINE_CONTENT_HEIGHT = 761;

const DEFAULT_CHAT_RATIO = 356 / BASELINE_WIDTH;
const DEFAULT_LIBRARY_RATIO = 406 / BASELINE_WIDTH;
const DEFAULT_TIMELINE_RATIO = 350 / BASELINE_CONTENT_HEIGHT;
const MIN_CHAT_RATIO = 320 / BASELINE_WIDTH;
const MIN_LIBRARY_RATIO = 176 / BASELINE_WIDTH;
const MIN_PREVIEW_RATIO = 280 / BASELINE_WIDTH;
const MIN_TIMELINE_RATIO = 260 / BASELINE_CONTENT_HEIGHT;
const MIN_UPPER_RATIO = 300 / BASELINE_CONTENT_HEIGHT;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteRatio(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? BASELINE_WIDTH : Math.max(1, window.innerWidth);
}

function contentHeight(): number {
  if (typeof window === 'undefined') return BASELINE_CONTENT_HEIGHT;
  return Math.max(1, window.innerHeight - HEADER_HEIGHT);
}

function normalizeRatios(chat: number, library: number, timeline: number) {
  const chatRatio = clamp(
    finiteRatio(chat, DEFAULT_CHAT_RATIO),
    MIN_CHAT_RATIO,
    1 - MIN_LIBRARY_RATIO - MIN_PREVIEW_RATIO,
  );
  return {
    chatRatio,
    libraryRatio: clamp(
      finiteRatio(library, DEFAULT_LIBRARY_RATIO),
      MIN_LIBRARY_RATIO,
      1 - chatRatio - MIN_PREVIEW_RATIO,
    ),
    timelineRatio: clamp(
      finiteRatio(timeline, DEFAULT_TIMELINE_RATIO),
      MIN_TIMELINE_RATIO,
      1 - MIN_UPPER_RATIO,
    ),
  };
}

export interface EditorPanelLayout {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  resizeChat: (delta: number) => void;
  resizeLibrary: (delta: number) => void;
  resizeTimeline: (delta: number) => void;
}

/**
 * Keeps user-resized editor panels as viewport-relative ratios. CSS vw/fr tracks
 * then react to both window resizing and browser zoom without a JS resize loop.
 */
export function useEditorPanelLayout(chatCollapsed: boolean): EditorPanelLayout {
  const [storedChatRatio, setChatRatio] = usePersistedState(
    'afterframe.chatRatio.ui-v2',
    DEFAULT_CHAT_RATIO,
  );
  const [storedLibraryRatio, setLibraryRatio] = usePersistedState(
    'afterframe.libraryRatio.ui-v2',
    DEFAULT_LIBRARY_RATIO,
  );
  const [storedTimelineRatio, setTimelineRatio] = usePersistedState(
    'afterframe.timelineRatio.ui-v2',
    DEFAULT_TIMELINE_RATIO,
  );

  const { chatRatio, libraryRatio, timelineRatio } = normalizeRatios(
    storedChatRatio,
    storedLibraryRatio,
    storedTimelineRatio,
  );

  const chatTrack = chatCollapsed ? `${COLLAPSED_CHAT_WIDTH}px` : `${chatRatio * 100}vw`;
  const gridTemplateColumns = `${chatTrack} 0 ${libraryRatio * 100}vw 0 minmax(0, 1fr)`;
  // Row 1 top bar, row 2 preview (timelineRatio is the TIMELINE's share, so the
  // preview takes whatever is left), row 3 the drag divider, row 4 the timeline.
  // The timeline keeps a real minimum so a short viewport cannot squeeze it away.
  const timelinePct = Math.round(timelineRatio * 1000) / 10;
  const gridTemplateRows = `${HEADER_HEIGHT}px minmax(${MIN_UPPER_RATIO * 100}px, 1fr) 0 minmax(${MIN_TIMELINE_RATIO * 100}px, ${timelinePct}%)`;

  const resizeChat = (delta: number) => setChatRatio((current) => roundRatio(clamp(
    finiteRatio(current, DEFAULT_CHAT_RATIO) + delta / viewportWidth(),
    MIN_CHAT_RATIO,
    1 - libraryRatio - MIN_PREVIEW_RATIO,
  )));
  const resizeLibrary = (delta: number) => setLibraryRatio((current) => {
    const chatShare = chatCollapsed ? COLLAPSED_CHAT_WIDTH / viewportWidth() : chatRatio;
    return roundRatio(clamp(
      finiteRatio(current, DEFAULT_LIBRARY_RATIO) + delta / viewportWidth(),
      MIN_LIBRARY_RATIO,
      1 - chatShare - MIN_PREVIEW_RATIO,
    ));
  });
  const resizeTimeline = (delta: number) => setTimelineRatio((current) => roundRatio(clamp(
    finiteRatio(current, DEFAULT_TIMELINE_RATIO) - delta / contentHeight(),
    MIN_TIMELINE_RATIO,
    1 - MIN_UPPER_RATIO,
  )));

  return { gridTemplateColumns, gridTemplateRows, resizeChat, resizeLibrary, resizeTimeline };
}
