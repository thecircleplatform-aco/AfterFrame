import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../modules/icons';

/**
 * A small anchored panel for the preview toolbar.
 *
 * The preview used to put every control directly on the picture: a row of three
 * text-edit buttons that floated over the clip you selected, plus quality/guides
 * toggles in the corner. Both fought the frame for attention. Controls now live
 * in one top bar, and anything with more than an on/off state opens one of these
 * panels instead — anchored under its own button, dismissed on outside click or
 * Escape.
 *
 * Portalled to <body> because the preview stage has `overflow: hidden` and would
 * clip a panel that hangs past the picture's edge.
 */
export function PreviewPopover({
  open, anchor, title, onClose, children, width = 216,
}: {
  open: boolean;
  /** The button this panel belongs to; the panel positions itself under it. */
  anchor: HTMLElement | null;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    // Capture, so a canvas gesture under the panel cannot swallow the dismissal.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, onClose]);

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  // Right-align to the button, then clamp into the viewport so a panel opened
  // from a corner control cannot hang off the edge on a narrow screen.
  const margin = 8;
  const right = Math.min(
    Math.max(margin, window.innerWidth - rect.right),
    Math.max(margin, window.innerWidth - width - margin),
  );

  return createPortal(
    <div
      ref={panelRef}
      className="cc-preview-pop"
      role="dialog"
      aria-label={title}
      style={{ top: rect.bottom + 6, right, width }}
    >
      <header className="cc-preview-pop-head">
        <span className="cc-preview-pop-title">{title}</span>
        <button type="button" className="cc-preview-pop-close" onClick={onClose}
          aria-label="Close" title="Close">
          <Icon name="x" size={11} />
        </button>
      </header>
      <div className="cc-preview-pop-body">{children}</div>
    </div>,
    document.body,
  );
}

/** One row inside a popover: label, optional hint, and a control on the right. */
export function PreviewPopoverRow({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="cc-preview-pop-row">
      <div className="cc-preview-pop-row-copy">
        <span className="cc-preview-pop-row-label">{label}</span>
        {hint && <span className="cc-preview-pop-row-hint">{hint}</span>}
      </div>
      <div className="cc-preview-pop-row-control">{children}</div>
    </div>
  );
}
