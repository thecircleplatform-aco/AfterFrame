import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closeRemoteSession,
  createRemoteSession,
  publishRemoteSnapshot,
  readRemoteSession,
  remoteImageUrl,
  streamRemoteActions,
  type RemoteSession,
  type RemoteSnapshot,
} from './remoteControlApi';

/** How often the desktop pushes transcript edits to attached phones. */
const PUBLISH_INTERVAL_MS = 500;
/** How often the dialog refreshes how many phones are attached. */
const STATUS_POLL_MS = 3_000;

export interface RemoteControlHostOptions {
  /** Pairing only runs while the dialog is open: no socket, no QR, no session. */
  readonly enabled: boolean;
  readonly locale: string;
  readonly onPrompt: (text: string) => void;
  readonly onStop: () => void;
  /** A phone attached an image; the file is already downloaded as a Blob. */
  readonly onImage: (file: File) => void | Promise<void>;
  /** A phone asked for (or stopped) the live preview stream. */
  readonly onWatch: (watching: boolean) => void;
  readonly readSnapshot: () => RemoteSnapshot;
}

export interface RemoteControlHost {
  readonly session: RemoteSession | null;
  readonly guestCount: number;
  readonly starting: boolean;
  readonly error: string | null;
  /** Drop this pairing and mint a fresh one (rotates the token). */
  readonly restart: () => void;
}

/**
 * Desktop-side host for LAN remote control.
 *
 * The tab is the only executor: prompts arriving from a phone are handed to the
 * very same `agent.send` the composer uses, and the transcript read back out of
 * the agent controller is what phones display. Nothing here can reach the
 * project document directly, so a phone cannot do anything the user could not
 * have typed themselves.
 */
export function useRemoteControlHost(options: RemoteControlHostOptions): RemoteControlHost {
  const { enabled, locale } = options;
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [guestCount, setGuestCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Callbacks and the reader change every render; keeping them in refs means the
  // session and its sockets survive re-renders instead of being torn down.
  const onPrompt = useRef(options.onPrompt);
  const onStop = useRef(options.onStop);
  const onImage = useRef(options.onImage);
  const onWatch = useRef(options.onWatch);
  const readSnapshot = useRef(options.readSnapshot);
  onPrompt.current = options.onPrompt;
  onStop.current = options.onStop;
  onImage.current = options.onImage;
  onWatch.current = options.onWatch;
  readSnapshot.current = options.readSnapshot;

  const sessionId = session?.id ?? null;

  useEffect(() => {
    if (!enabled) { setSession(null); setGuestCount(0); setError(null); return; }
    let cancelled = false;
    setStarting(true);
    setError(null);
    void (async () => {
      try {
        const created = await createRemoteSession(locale);
        if (cancelled) { void closeRemoteSession(created.id); return; }
        setSession(created);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, locale, nonce]);

  // Tear the session down when pairing stops or the id rotates.
  useEffect(() => {
    if (!sessionId) return;
    return () => { void closeRemoteSession(sessionId); };
  }, [sessionId]);

  // Phone → desktop command channel.
  useEffect(() => {
    if (!sessionId) return;
    return streamRemoteActions(
      sessionId,
      (action) => {
        if (action.type === 'prompt') onPrompt.current(action.text);
        else if (action.type === 'stop') onStop.current();
        else if (action.type === 'watch' || action.type === 'unwatch') {
          onWatch.current(action.type === 'watch');
        }
        else if (action.type === 'image') {
          // The bytes are already saved next to every other upload; pulling them
          // back as a File makes a phone photo an ordinary media-pool import.
          void (async () => {
            try {
              const response = await fetch(remoteImageUrl(action.url), { cache: 'no-store' });
              if (!response.ok) return;
              const blob = await response.blob();
              await onImage.current(new File([blob], action.name, { type: action.mime || blob.type }));
            } catch {
              // A dropped image must never take the control channel down.
            }
          })();
        }
      },
      (connected) => setError(connected ? null : 'Lost the desktop control channel'),
    );
  }, [sessionId, nonce]);

  // Desktop → phone transcript channel.
  useEffect(() => {
    if (!sessionId) return;
    let last = '';
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      let snapshot: RemoteSnapshot;
      try { snapshot = readSnapshot.current(); } catch { return; }
      const serialized = JSON.stringify(snapshot);
      if (serialized === last) return;
      inFlight = true;
      void publishRemoteSnapshot(sessionId, snapshot)
        .then(() => { last = serialized; })
        .catch(() => undefined)
        .finally(() => { inFlight = false; });
    }, PUBLISH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [sessionId, nonce]);

  // Guest count is the only state the host cannot observe directly.
  useEffect(() => {
    if (!sessionId || !enabled) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void readRemoteSession(sessionId)
        .then((next) => { if (!cancelled && next) setGuestCount(next.guestCount); })
        .catch(() => undefined);
    }, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sessionId, enabled]);

  const restart = useCallback(() => { setNonce((value) => value + 1); }, []);

  return { session, guestCount, starting, error, restart };
}
