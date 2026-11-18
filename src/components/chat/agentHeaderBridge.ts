/**
 * Bridge between the Agent sheet header and the chat panel's live controller.
 *
 * The sheet header draws the chrome (brand, full screen, menu, notifications)
 * but the actions it needs — clear history, open the phone remote — belong to
 * the chat controller, which lives inside `ChatPanel` and is not reachable from
 * the header's props. Rather than thread a dozen callbacks down through the
 * sheet, the chat publishes a small snapshot of what the header can do, and the
 * header subscribes to it. Same store pattern as `mainTab` in LibraryPanel: one
 * module-level source of truth read through `useSyncExternalStore`.
 */

/**
 * A one-off advisory the chat panel wants surfaced in the bell popover. It used
 * to be an inline banner, but that stole ~105px of conversation height on short
 * viewports, so the header owns it now.
 */
export interface AgentHeaderNotice {
  /** Stable id so the same notice is not re-shown after dismissal. */
  id: string;
  /** Short headline; the popover keeps it to one line. */
  title: string;
  /** Optional second line with the specifics. */
  detail?: string;
  /** Optional call to action rendered as a small pill. */
  actionLabel?: string;
  onAction?: () => void;
}

export interface AgentHeaderState {
  /** True while a run is in flight; destructive actions disable. */
  running: boolean;
  /** Unread/attention count for the notification badge. */
  noticeCount: number;
  /** Advisories shown inside the bell popover, newest first. */
  notices: AgentHeaderNotice[];
  /** Whether the QR phone-remote overlay is open. */
  remoteOpen: boolean;
  /** Connected devices on the phone remote (drives the live dot). */
  guestCount: number;
  /** Dismiss one advisory by id so it does not come back this session. */
  dismissNotice: (id: string) => void;
  /** Wipe the conversation. */
  clearHistory: () => void;
  /** Toggle the QR phone-remote overlay. */
  setRemoteOpen: (open: boolean) => void;
}

const EMPTY: AgentHeaderState = {
  running: false,
  noticeCount: 0,
  notices: [],
  remoteOpen: false,
  guestCount: 0,
  dismissNotice: () => undefined,
  clearHistory: () => undefined,
  setRemoteOpen: () => undefined,
};

let state: AgentHeaderState = EMPTY;
const listeners = new Set<() => void>();

export function getAgentHeaderState(): AgentHeaderState {
  return state;
}

export function subscribeAgentHeader(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Called by the chat panel whenever one of the exposed values changes. Actions
 * are compared by identity only for the fields that matter, so a stream of
 * no-op renders does not wake the header.
 */
export function publishAgentHeader(next: AgentHeaderState): void {
  const same = state.running === next.running
    && state.noticeCount === next.noticeCount
    && state.notices === next.notices
    && state.remoteOpen === next.remoteOpen
    && state.guestCount === next.guestCount
    && state.dismissNotice === next.dismissNotice
    && state.clearHistory === next.clearHistory
    && state.setRemoteOpen === next.setRemoteOpen;
  if (same) return;
  state = next;
  for (const listener of listeners) listener();
}

/** Reset on unmount so a header mounted later cannot call into a dead panel. */
export function clearAgentHeader(): void {
  if (state === EMPTY) return;
  state = EMPTY;
  for (const listener of listeners) listener();
}
