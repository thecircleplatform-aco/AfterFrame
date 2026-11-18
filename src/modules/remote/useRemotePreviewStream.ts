// Desktop side of the live preview stream.
//
// Watches the preview canvas and pushes JPEG stills to the paired phone while
// (and only while) the phone is actually watching. Everything here is built
// around not wasting CPU: the loop is frame-budgeted, skips a tick if the last
// frame has not finished, and stops entirely when the phone leaves.
import { useEffect, useRef, useState } from 'react';
import {
  PREVIEW_FPS, PREVIEW_MAX_INFLIGHT, capturePreviewFrame, findPreviewCanvas,
} from './previewStream';

const FRAME_INTERVAL_MS = Math.round(1000 / PREVIEW_FPS);
const BASE = '/api/remote-control/sessions';

async function postPreviewFrame(id: string, data: string, frame: number, width: number, height: number): Promise<number> {
  const response = await fetch(`${BASE}/${encodeURIComponent(id)}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frame: { data, frame, width, height } }),
  });
  if (!response.ok) return 0;
  const body = await response.json().catch(() => null) as { delivered?: unknown } | null;
  return typeof body?.delivered === 'number' ? body.delivered : 0;
}

/**
 * Drive the preview stream for `sessionId` while `active` is true.
 *
 * Returns whether the stream is currently pushing, so the UI can show an honest
 * "live preview on/off" state instead of a spinner that never resolves.
 */
export function useRemotePreviewStream(options: {
  sessionId: string | null;
  active: boolean;
  /**
   * Current playhead frame, used only to label the image.
   *
   * Optional on purpose: the canvas is discovered from the DOM, so the picture
   * streams correctly even when the caller has no cheap way to read the
   * playhead — the label just reads `f 0` instead of going stale or throwing.
   */
  currentFrame?: () => number;
}): { streaming: boolean } {
  const { sessionId, active } = options;
  const [streaming, setStreaming] = useState(false);
  const frameRef = useRef(options.currentFrame);
  frameRef.current = options.currentFrame;

  useEffect(() => {
    if (!sessionId || !active) { setStreaming(false); return; }
    let cancelled = false;
    let inflight = 0;
    let timer: number | null = null;
    // A phone that left mid-flight leaves inflight > 0 forever; reset on stop.
    setStreaming(true);

    const tick = async () => {
      if (cancelled) return;
      timer = null;
      if (inflight >= PREVIEW_MAX_INFLIGHT) { schedule(); return; }
      const canvas = findPreviewCanvas();
      if (!canvas) { schedule(); return; }
      const frame = capturePreviewFrame(canvas, frameRef.current?.() ?? 0);
      if (!frame) { schedule(); return; }
      inflight += 1;
      try {
        const delivered = await postPreviewFrame(sessionId, frame.data, frame.frame, frame.width, frame.height);
        if (cancelled) return;
        // Nobody is watching any more: stop capturing rather than encode frames
        // into the void. The phone re-sends `watch` when it comes back.
        if (delivered === 0) { setStreaming(false); return; }
        setStreaming(true);
      } catch {
        // A failed frame is not fatal; the next tick retries.
      } finally {
        inflight -= 1;
      }
      schedule();
    };

    const schedule = () => {
      if (cancelled || timer !== null) return;
      timer = window.setTimeout(() => { void tick(); }, FRAME_INTERVAL_MS);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      setStreaming(false);
    };
  }, [sessionId, active]);

  return { streaming };
}
