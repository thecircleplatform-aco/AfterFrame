import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Icon } from '../../modules/icons';
import { useT } from '../../i18n/locale';
import { setChatSide, type ChatSide } from '../../editor/chatSide';

interface AgentEdgeButtonProps {
  /** Whether the agent panel is currently open (the handle hides while it is). */
  open: boolean;
  /** Which border the handle is parked on. Mirrors the panel's docking side. */
  side: ChatSide;
  onToggle: () => void;
}

/** Pixels the handle must travel before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 6;

/**
 * The agent's handle on the screen border.
 *
 * Deliberately one-dimensional: it lives at the vertical middle of the left or
 * right edge and can only be thrown to the other edge. There is no free
 * placement and no up/down movement — the panel is full-height, so a handle that
 * could sit anywhere would imply a docking behaviour the layout does not have.
 *
 * A press that never moves is a click (open the agent); a press that moves is a
 * drag (re-dock), decided on release. While the agent is open the handle is
 * hidden, because the panel already occupies that whole edge.
 */
export function AgentEdgeButton({ open, side, onToggle }: AgentEdgeButtonProps) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, moved: false };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    if (Math.abs(dx) > DRAG_THRESHOLD) state.moved = true;
    // Only horizontal: the handle never leaves the vertical middle.
    setDragX(dx);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    setDragX(0);
    if (!state) return;
    if (!state.moved) {
      onToggle();
      return;
    }
    const nextSide: ChatSide = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
    if (nextSide !== side) setChatSide(nextSide);
  };

  const cancelDrag = (): void => {
    drag.current = null;
    setDragging(false);
    setDragX(0);
  };

  const label = t('Expand AfterFrame Agent');

  return (
    <AnimatePresence>
      {!open && (
        <motion.button
          key="agent-edge"
          type="button"
          className="cc-agent-edge"
          data-side={side}
          data-dragging={dragging || undefined}
          aria-label={label}
          aria-expanded={false}
          title={label}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={reduceMotion
            ? { duration: 0.12 }
            : { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
          // `y` is a motion style, not a CSS transform: motion owns the element's
          // transform, so centring it in CSS would be overwritten on the first
          // frame and the handle would sit half its height too low.
          style={{ x: dragX, y: '-50%' }}
        >
          <Icon name="agentMark" size={16} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
