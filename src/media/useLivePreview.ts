import { useEffect, useRef, useState } from 'react';

/**
 * Live-preview budget for the media pool.
 *
 * Every video tile wants to play at once, but a phone can only decode a handful
 * of streams before the whole grid stutters — and each one holds a decoder until
 * it is explicitly released. So previews are paced two ways:
 *
 *   1. only tiles inside the scroll viewport are candidates (IntersectionObserver)
 *   2. among those, at most `MAX_CONCURRENT` actually play; the rest keep their
 *      poster. When a playing tile scrolls away its slot is handed to the next
 *      waiting tile, so the visible set is always covered first.
 *
 * The cap is deliberately small: 4 simultaneous 1080p decodes is already more
 * than a mid-range phone comfortably sustains while scrolling a grid.
 */
const MAX_CONCURRENT = 4;

interface Waiter {
  id: string;
  /** called when a slot frees up */
  grant: () => void;
}

/** Slots currently in use, by asset id. Module-level so every card shares one budget. */
const granted = new Set<string>();
const waiting: Waiter[] = [];

function requestSlot(id: string, grant: () => void): void {
  if (granted.has(id)) return;
  if (granted.size < MAX_CONCURRENT) {
    granted.add(id);
    grant();
    return;
  }
  if (!waiting.some((w) => w.id === id)) waiting.push({ id, grant });
}

function releaseSlot(id: string): void {
  if (!granted.delete(id)) {
    // Never granted — drop it from the queue so a scrolled-away tile cannot
    // claim a slot later.
    const index = waiting.findIndex((w) => w.id === id);
    if (index >= 0) waiting.splice(index, 1);
    return;
  }
  const next = waiting.shift();
  if (next) {
    granted.add(next.id);
    next.grant();
  }
}

/** Test/teardown hook: forget every slot so a remounted grid starts clean. */
export function resetPreviewBudget(): void {
  granted.clear();
  waiting.length = 0;
}

/**
 * @param enabled false for cards that must never animate (missing media, list
 *   view, non-video kinds) — the observer and the budget are skipped entirely.
 */
export function useLivePreview(enabled: boolean): {
  ref: React.RefObject<HTMLDivElement | null>;
  live: boolean;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [live, setLive] = useState(false);
  const idRef = useRef(`preview-${Math.random().toString(36).slice(2)}`);

  // Viewport gate. `rootMargin` pre-warms slightly below the fold so a tile that
  // scrolls in is already decoding rather than showing a poster for a beat.
  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      // No observer (old browser / test env): treat as visible so previews still
      // work rather than silently never starting.
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { rootMargin: '120px 0px', threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  // Budget gate: ask for a decode slot once the tile is on screen.
  useEffect(() => {
    if (!enabled || !inView) {
      setLive(false);
      releaseSlot(idRef.current);
      return;
    }
    requestSlot(idRef.current, () => setLive(true));
    return () => releaseSlot(idRef.current);
  }, [enabled, inView]);

  // A tile that unmounts must give its slot back or the budget leaks until the
  // page reloads.
  useEffect(() => {
    const id = idRef.current;
    return () => releaseSlot(id);
  }, []);

  return { ref, live: enabled && live };
}
