import { useCallback, useEffect, useRef, useState } from 'react';

export type OverlayEdge = 'left' | 'right' | 'top' | 'bottom';

export interface OverlayBox {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

/** How long a pointer must rest on an edge before it turns into a resize drag. */
const LONG_PRESS_MS = 160;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 260;
/** Space kept between the panel and the viewport edges when clamping. */
const MARGIN = 8;
const STORAGE_KEY = 'af.chatOverlay.box';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A stored box is in *viewport* pixels, but viewports change: a box saved on a
 *  wider window hangs off the right edge on a phone (the default `width:
 *  min(420px, 100vw - 24px)` becomes a saved 390px on a 314px screen). Every
 *  read, resize and window change re-fits the box instead of trusting the old
 *  numbers. */
function fitBox(box: OverlayBox): OverlayBox {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxWidth = Math.max(MIN_WIDTH, vw - MARGIN * 2);
  const maxHeight = Math.max(MIN_HEIGHT, vh - MARGIN * 2);
  const width = clamp(box.width, MIN_WIDTH, maxWidth);
  const height = clamp(box.height, MIN_HEIGHT, maxHeight);
  return {
    left: clamp(box.left, MARGIN, Math.max(MARGIN, vw - MARGIN - width)),
    bottom: clamp(box.bottom, MARGIN, Math.max(MARGIN, vh - MARGIN - height)),
    width,
    height,
  };
}

function readStoredBox(): OverlayBox | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OverlayBox>;
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null;
    return fitBox({
      left: typeof parsed.left === 'number' ? parsed.left : MARGIN,
      bottom: typeof parsed.bottom === 'number' ? parsed.bottom : MARGIN,
      width: parsed.width,
      height: parsed.height,
    });
  } catch {
    return null;
  }
}

function persistBox(box: OverlayBox | null): void {
  try {
    if (box) localStorage.setItem(STORAGE_KEY, JSON.stringify(box));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A blocked localStorage must never break resizing.
  }
}

/**
 * Long-press-then-drag resizing for the floating agent chat.
 *
 * The overlay is anchored to the bottom-left and defaults to full height. Once an
 * edge is dragged the panel switches to an explicit pixel box, which is kept in
 * localStorage so the size a user chose survives a reload.
 *
 * A plain `pointerdown` is *not* enough: the edges sit over the panel's own
 * content, so a stray press while reaching for a button must not start a drag.
 * The press therefore has to be held for LONG_PRESS_MS first, and the pointer
 * must still be on the same edge.
 */
export function useChatOverlayResize() {
  const [box, setBox] = useState<OverlayBox | null>(readStoredBox);
  const [resizing, setResizing] = useState<OverlayEdge | null>(null);
  // Set once a long press has armed the edge, so the handle can show its grip.
  const [armed, setArmed] = useState<OverlayEdge | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    edge: OverlayEdge;
    startX: number;
    startY: number;
    start: OverlayBox;
  } | null>(null);

  const measure = useCallback((): OverlayBox | null => {
    const node = panelRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      bottom: window.innerHeight - rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  const endResize = useCallback(() => {
    if (dragRef.current) persistBox(box);
    dragRef.current = null;
    setResizing(null);
    setArmed(null);
  }, [box]);

  useEffect(() => {
    if (!resizing) return undefined;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const next: OverlayBox = { ...drag.start };

      if (drag.edge === 'right') {
        next.width = clamp(drag.start.width + dx, MIN_WIDTH, vw - drag.start.left - MARGIN);
      } else if (drag.edge === 'left') {
        const maxWidth = drag.start.left + drag.start.width - MARGIN;
        next.width = clamp(drag.start.width - dx, MIN_WIDTH, maxWidth);
        next.left = drag.start.left + (drag.start.width - next.width);
      } else if (drag.edge === 'top') {
        const maxHeight = vh - drag.start.bottom - MARGIN;
        next.height = clamp(drag.start.height - dy, MIN_HEIGHT, maxHeight);
      } else {
        const maxHeight = vh - MARGIN;
        const wanted = clamp(drag.start.height + dy, MIN_HEIGHT, maxHeight);
        next.height = wanted;
        next.bottom = drag.start.bottom + (drag.start.height - wanted);
        if (next.bottom < MARGIN) {
          next.height = clamp(next.height - (MARGIN - next.bottom), MIN_HEIGHT, maxHeight);
          next.bottom = MARGIN;
        }
      }
      setBox(next);
      event.preventDefault();
    };
    const onUp = () => endResize();
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizing, endResize]);

  const onHandlePointerDown = useCallback(
    (edge: OverlayEdge) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const { clientX, clientY } = event;
      setArmed(edge);
      const timer = window.setTimeout(() => {
        const start = box ?? measure();
        if (!start) return;
        dragRef.current = { edge, startX: clientX, startY: clientY, start };
        setBox(start);
        setResizing(edge);
      }, LONG_PRESS_MS);
      const cancel = () => {
        window.clearTimeout(timer);
        if (!dragRef.current) setArmed(null);
        window.removeEventListener('pointerup', cancel);
        window.removeEventListener('pointercancel', cancel);
      };
      window.addEventListener('pointerup', cancel);
      window.addEventListener('pointercancel', cancel);
      event.preventDefault();
    },
    [box, measure],
  );

  const reset = useCallback(() => {
    setBox(null);
    persistBox(null);
  }, []);

  // Rotation, window resize, a phone keyboard opening: an explicit box has to be
  // re-fitted or it drifts outside the new viewport.
  useEffect(() => {
    const onResize = () => setBox((current) => (current ? fitBox(current) : current));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return { box, resizing, armed, panelRef, onHandlePointerDown, reset };
}
