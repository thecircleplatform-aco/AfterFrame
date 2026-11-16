import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { theme, themeAlpha } from '../../theme';
import { placeChatPopover, type ChatPopoverPlacement, type PopoverRect } from './chatPopoverGeometry';

interface ComposerPopoverProps {
  readonly children: ReactNode | ((close: () => void) => ReactNode);
  readonly onClose: () => void;
  readonly width?: number;
  readonly anchor: HTMLElement | null;
  readonly className?: string;
  readonly ariaLabel?: string;
  /**
   * Raise the computed height cap. The geometry helper sizes the menu for a list
   * of rows; a caller embedding a taller card (the token-usage panel) needs room
   * the default cap would crop.
   */
  readonly minMaxHeight?: number;
}

function viewportBoundary(): PopoverRect {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/** Keep fixed composer menus inside the Agent workspace that owns the trigger. */
export function ComposerPopover({
  children,
  onClose,
  anchor,
  width = 220,
  className,
  ariaLabel,
  minMaxHeight,
}: ComposerPopoverProps) {
  const [box, setBox] = useState<ChatPopoverPlacement | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const boundary = anchor.closest<HTMLElement>('[data-cc-chat-popover-boundary]');
    const place = () => {
      setBox(placeChatPopover({
        anchor: anchor.getBoundingClientRect(),
        boundary: boundary?.getBoundingClientRect() ?? viewportBoundary(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        requestedWidth: width,
      }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(anchor);
    if (boundary && boundary !== anchor) observer?.observe(boundary);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [anchor, width]);

  // ── Open / close animation ──────────────────────────────────────────────
  // `visible` keeps the node mounted through the exit transition; `shown` drives
  // the transform. Two states (rather than one) is what allows a real close
  // animation instead of an instant unmount.
  const [visible, setVisible] = useState(true);
  const [shown, setShown] = useState(false);
  const reduceMotion = usePrefersReducedMotion();
  const closeTimer = useRef<number | null>(null);

  // The popover "opens downward" from the composer edge, so the transform origin
  // is the bottom edge nearest the trigger.
  const originY = 'bottom';
  // Placement arrives after first paint (layout effect), so the entrance starts
  // once `box` exists. `shown` only ever goes false→true here; a re-place (resize
  // / scroll) re-runs the effect but the early return keeps it settled.
  useEffect(() => {
    if (!box) return;
    // Two frames: one for React to commit the collapsed styles, one for the
    // browser to have a value to interpolate from. Strict mode's double-invoke
    // is harmless because the second pass also resolves to `true`.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [box]);

  // Ask to close: collapse first, unmount once the transition has finished.
  const requestClose = useCallback((): void => {
    setShown(false);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setVisible(false);
      onClose();
    }, reduceMotion ? 0 : 150);
  }, [onClose, reduceMotion]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  // Escape must animate out too, so it is bound after `requestClose` exists.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  if (!box || !visible) return null;
  // Portalled to <body>: the chat panel and composer both establish containing
  // blocks (transform/backdrop-filter), which would otherwise trap this fixed
  // menu inside the composer — clipped, and offset from the trigger.
  return createPortal(
    <>
      <div
        className="cc-chat-popover-backdrop"
        onPointerDown={requestClose}
        style={{
          opacity: shown ? 1 : 0,
          transition: reduceMotion ? 'none' : 'opacity 140ms ease',
          // Only accept the dismiss gesture once the panel is actually visible,
          // so the opening tap cannot immediately close it.
          pointerEvents: shown ? 'auto' : 'none',
        }}
      />
      <div
        className={`cc-chat-popover${className ? ` ${className}` : ''}`}
        role="menu"
        aria-label={ariaLabel}
        style={{
          left: box.left,
          bottom: box.bottom,
          width: box.width,
          minWidth: box.width,
          maxWidth: box.width,
          maxHeight: minMaxHeight ? Math.max(box.maxHeight, minMaxHeight) : box.maxHeight,
          // Opaque surface: `panelAlt` is a 5% wash, so the transcript behind it
          // showed through and the rows were unreadable.
          background: theme.panel,
          borderColor: theme.borderLight,
          boxShadow: `0 12px 40px ${themeAlpha.shadow(0.5)}`,
          backdropFilter: 'blur(18px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.3)',
          // Rail motion: it slides out of the composer edge and settles, with the
          // contents clipped to the rounded shape while it grows.
          transformOrigin: originY,
          transform: shown || reduceMotion ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.97)',
          opacity: shown || reduceMotion ? 1 : 0,
          transition: reduceMotion
            ? 'none'
            : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease',
          willChange: 'transform, opacity',
        }}
      >
        {/* `close` is the animated variant: children that dismiss the menu
            themselves (picking a model, a workflow) call it instead of the
            parent's `onClose`, so their choice also plays the exit transition
            rather than snapping the panel away. */}
        {typeof children === 'function' ? children(requestClose) : children}
      </div>
    </>,
    document.body,
  );
}

/** Honour the OS "reduce motion" setting. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}
