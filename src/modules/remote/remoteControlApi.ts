// Browser client for the desktop half of LAN remote control. Every call here is
// loopback + same-origin, so the existing local-device trust model applies; the
// phone never sees these endpoints.

export interface RemoteAddress {
  readonly label: string;
  readonly address: string;
  readonly url: string;
  readonly hotspot: boolean;
}

export interface RemoteSession {
  readonly id: string;
  readonly addresses: RemoteAddress[];
  readonly expiresAt: number;
  readonly hostAttached: boolean;
  readonly guestCount: number;
}

export interface RemoteMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly text: string;
  /** Tool rows only: the human-readable outcome of the call. */
  readonly detail?: string;
}

export interface RemoteSnapshot {
  readonly running: boolean;
  readonly liveTool: string | null;
  readonly messages: RemoteMessage[];
  readonly projectName?: string;
}

export type RemoteGuestAction =
  | { type: 'prompt'; text: string }
  | { type: 'stop' }
  | { type: 'image'; name: string; mime: string; url: string };

/** Where a phone-uploaded image lands so the tab can import it as a pool asset. */
export function remoteImageUrl(url: string): string {
  return url.startsWith('/') ? url : `/${url}`;
}

const BASE = '/api/remote-control/sessions';

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return new Error(body.error);
  } catch {
    // The body was not JSON; fall through to the status-based message.
  }
  return new Error(`${fallback} (HTTP ${response.status})`);
}

export async function createRemoteSession(locale: string): Promise<RemoteSession> {
  const response = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
  if (!response.ok) throw await errorFrom(response, 'Could not open the phone remote');
  return readJson<RemoteSession>(response);
}

export async function readRemoteSession(id: string): Promise<RemoteSession | null> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw await errorFrom(response, 'Could not read the pairing');
  return readJson<RemoteSession>(response);
}

export async function closeRemoteSession(id: string): Promise<void> {
  await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
}

export async function publishRemoteSnapshot(id: string, snapshot: RemoteSnapshot): Promise<void> {
  await fetch(`${BASE}/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  });
}

/**
 * Long-lived action channel from the service to the desktop tab.
 *
 * Uses `fetch` streaming rather than EventSource so the abort controller can
 * tear it down deterministically when the tab switches project or the pairing
 * dialog closes; EventSource also cannot be cancelled mid-connect.
 *
 * The loop is deliberate: a single dropped stream used to end the channel for
 * good, so a phone kept sending prompts into a dead socket and the remote
 * silently stopped working until the pairing sheet was closed and reopened.
 * Reconnecting is what makes Stop reach the desktop after a hiccup.
 */
export function streamRemoteActions(
  id: string,
  onAction: (action: RemoteGuestAction) => void,
  onState: (connected: boolean) => void,
): () => void {
  const abort = new AbortController();
  let retry = 0;

  const deliver = (frame: string): void => {
    const event = /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim() ?? 'message';
    if (event !== 'action') return;
    const data = frame.split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return;
    try {
      const parsed = JSON.parse(data) as RemoteGuestAction;
      if (parsed.type === 'prompt' && typeof parsed.text === 'string') onAction(parsed);
      else if (parsed.type === 'stop') onAction(parsed);
      else if (parsed.type === 'image' && typeof parsed.url === 'string') onAction(parsed);
    } catch {
      // A malformed frame must not kill the channel.
    }
  };

  const pump = async (): Promise<void> => {
    if (abort.signal.aborted) return;
    const response = await fetch(`${BASE}/${encodeURIComponent(id)}/host`, {
      signal: abort.signal,
      cache: 'no-store',
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    retry = 0;
    onState(true);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        deliver(frame);
      }
    }
  };

  void (async () => {
    for (;;) {
      if (abort.signal.aborted) return;
      try {
        await pump();
      } catch (error) {
        if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      }
      if (abort.signal.aborted) return;
      onState(false);
      // 500ms doubling to an 8s ceiling: fast enough to survive an HMR reload,
      // slow enough that a closed session does not spin a battery-draining loop.
      const wait = Math.min(500 * 2 ** retry, 8_000);
      retry += 1;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  })();

  return () => abort.abort();
}
