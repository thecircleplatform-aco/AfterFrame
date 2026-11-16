// The library panel is no longer a permanent column: picking a section in the
// bottom dock slides its content up from behind the bar, and a back button drops
// it down again. Keeps the timeline full-width on phones where a fixed sidebar
// would eat the whole viewport.
//
// The top edge is a real grabber, not a decoration: pointer-drag resizes the
// sheet (and the height is remembered), arrow keys do the same from the
// keyboard, and the body owns the arrow/Page keys so the section's own scroller
// moves instead of nothing happening.
import {
  Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Icon } from '../modules/icons';
import { useT } from '../i18n/locale';
import { closeMainTabSheet, getMainTab, getMainTabSheetOpen, subscribeMainTab } from './LibraryPanel';
import { LibraryPanel } from './LibraryPanel';
import { AgentPanelView } from '../editor/AgentPanelView';

const HEIGHT_KEY = 'cc.sheet.height';
const MIN_HEIGHT = 140;
const GRIP_KEY_STEP = 28;

/** The dock is a fixed footer, so keep the last couple of pixels of it clear. */
function dockHeight(): number {
  const declared = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cc-dock-h'));
  return Number.isFinite(declared) && declared > 0 ? declared : 58;
}

function maxHeight(): number {
  return Math.max(MIN_HEIGHT + 120, window.innerHeight - dockHeight() - 10);
}

/** The dock the sheet was opened from. It is the sheet's sibling inside
 *  `.cc-main-dock-host`, and it retreats downwards while a section is open so
 *  that the section owns the screen. */
function dockSibling(node: HTMLElement | null): HTMLElement | null {
  return node?.closest('.cc-main-dock-host')?.querySelector<HTMLElement>('.cc-main-dock') ?? null;
}

/** A freshly opened section is a full-screen layer, not a 62% panel: the dock
 *  falls out of the way, so the sheet takes everything above the bottom edge
 *  (minus the grabber's breathing room). The grabber still shrinks it back. */
function expandedHeight(): number {
  return Math.max(MIN_HEIGHT, window.innerHeight - 8);
}

function defaultHeight(): number {
  return Math.round(Math.min(maxHeight(), Math.max(240, window.innerHeight * 0.62)));
}

function clampHeight(value: number): number {
  return Math.min(Math.max(Math.round(value), MIN_HEIGHT), expandedHeight());
}

function storedHeight(): number | null {
  try {
    const raw = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(raw) && raw >= MIN_HEIGHT ? clampHeight(raw) : null;
  } catch {
    return null;
  }
}

function persistHeight(value: number): void {
  try { localStorage.setItem(HEIGHT_KEY, String(Math.round(value))); } catch { /* private mode */ }
}

/** The section panels each own their scroller; the sheet body is a flex slot,
 *  not a scroll container. Keyboard scrolling has to target the biggest
 *  scrollable descendant or the keys do nothing visible. */
function innerScroller(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  let best: HTMLElement | null = null;
  let bestArea = 0;
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.scrollHeight <= el.clientHeight + 4) return;
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) { bestArea = area; best = el; }
  });
  return best;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable;
}

export function MainSectionSheet({ panel, agent }: {
  panel: ComponentProps<typeof LibraryPanel> | null;
  agent?: ComponentProps<typeof AgentPanelView>['panel'] | null;
}) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const open = useSyncExternalStore(subscribeMainTab, getMainTabSheetOpen, getMainTabSheetOpen);
  const tab = useSyncExternalStore(subscribeMainTab, getMainTab, getMainTab);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; startHeight: number; max: number } | null>(null);
  const [height, setHeight] = useState<number>(() => storedHeight() ?? defaultHeight());

  // Keep a remembered height inside the viewport when the window shrinks.
  useEffect(() => {
    const onResize = () => setHeight((current) => clampHeight(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Opening a section is a mode switch: the sheet rises to the full screen and
  // the dock it came from drops away. Closing reverses both, and the deck is
  // put back exactly as it was found (inline styles restored, not guessed).
  // Everything is driven from this one effect so the two can never desync.
  useEffect(() => {
    const dock = dockSibling(bodyRef.current);
    if (!dock) return;
    if (!open) return;
    const previous = { transform: dock.style.transform, opacity: dock.style.opacity };
    const ease = reduceMotion ? '0s' : 'transform .26s cubic-bezier(.32,.72,0,1), opacity .18s ease';
    dock.style.transition = ease;
    dock.style.transformOrigin = 'bottom';
    dock.style.transform = 'translateY(115%)';
    dock.style.opacity = '0';
    setHeight(expandedHeight());
    return () => {
      dock.style.transition = ease;
      dock.style.transform = previous.transform;
      dock.style.opacity = previous.opacity;
      const clear = () => {
        dock.style.transition = '';
        dock.style.transformOrigin = '';
        dock.style.transform = '';
        dock.style.opacity = '';
      };
      if (reduceMotion) clear();
      else window.setTimeout(clear, 280);
    };
  }, [open, reduceMotion]);

  // A freshly opened sheet owns the keyboard, so arrows and Page Up/Down scroll
  // its content right away instead of going nowhere.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => bodyRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, [open, tab]);

  const commitHeight = useCallback((next: number) => {
    setHeight(clampHeight(next));
  }, []);

  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!sheet) return;
    // The sheet's bottom edge is pinned to the viewport bottom, so its bottom
    // offset is the ceiling for how tall the drag (or the keyboard) can go.
    drag.current = { startY: event.clientY, startHeight: sheet.height, max: Math.max(MIN_HEIGHT + 60, sheet.bottom - 6) };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const next = Math.min(Math.max(current.startHeight + (current.startY - event.clientY), MIN_HEIGHT), current.max);
    setHeight(Math.round(next));
  };

  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setHeight((current) => { persistHeight(current); return current; });
  };

  const onGripKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const sheet = event.currentTarget.parentElement;
    const max = sheet ? Math.max(MIN_HEIGHT + 60, sheet.getBoundingClientRect().bottom - 6) : maxHeight();
    const page = Math.round((bodyRef.current?.clientHeight ?? 320) * 0.9);
    const step: Record<string, number | 'min' | 'max'> = {
      ArrowUp: GRIP_KEY_STEP,
      ArrowDown: -GRIP_KEY_STEP,
      PageUp: page,
      PageDown: -page,
      Home: 'max',
      End: 'min',
    };
    const action = step[event.key];
    if (action === undefined) return;
    event.preventDefault();
    if (action === 'max') { commitHeight(max); return; }
    if (action === 'min') { commitHeight(MIN_HEIGHT); return; }
    commitHeight(Math.min(Math.max(height + action, MIN_HEIGHT), max));
  };

  const onBodyKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isTyping(event.target)) return;
    const scroller = innerScroller(bodyRef.current);
    if (!scroller) return;
    const page = Math.round(scroller.clientHeight * 0.9);
    const delta: Record<string, number | 'top' | 'bottom'> = {
      ArrowDown: 48,
      ArrowUp: -48,
      PageDown: page,
      PageUp: -page,
      Home: 'top',
      End: 'bottom',
    };
    const action = delta[event.key];
    if (action === undefined) return;
    event.preventDefault();
    const behavior = reduceMotion ? 'auto' : 'smooth';
    if (action === 'top') { scroller.scrollTo({ top: 0, behavior }); return; }
    if (action === 'bottom') { scroller.scrollTo({ top: scroller.scrollHeight, behavior }); return; }
    scroller.scrollBy({ top: action, behavior });
  };

  return (
    <AnimatePresence>
      {open && (panel || agent) && (
        <motion.section
          key="library-sheet"
          className="cc-library-sheet"
          role="dialog"
          aria-label={t(tab)}
          initial={reduceMotion ? false : { y: '100%', opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: '100%', opacity: 0.6 }}
          transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
          style={{ pointerEvents: 'auto', height, maxHeight: 'none' }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeMainTabSheet(); } }}
        >
          <div
            className="cc-library-sheet-grip"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('Drag to resize')}
            aria-valuemin={MIN_HEIGHT}
            aria-valuemax={maxHeight()}
            aria-valuenow={height}
            tabIndex={0}
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onKeyDown={onGripKey}
            onDoubleClick={() => commitHeight(defaultHeight())}
          />
          {tab === 'Agent' ? (
            /* The chat is already a page-like panel with its own header, so it
               takes the whole sheet instead of sitting under a second title
               bar; only the grabber stays, so the sheet is still resizable. */
            <div className="cc-library-sheet-body" ref={bodyRef} tabIndex={0} onKeyDown={onBodyKey}>
              {agent && <AgentPanelView panel={agent} />}
            </div>
          ) : (
            <>
              <div className="cc-library-sheet-head">
                <button type="button" className="cc-library-sheet-back"
                  onClick={closeMainTabSheet} title={t('Back')} aria-label={t('Back')}>
                  <Icon name="chevronDown" size={14} />
                </button>
                <strong className="cc-library-sheet-title">{t(tab)}</strong>
              </div>
              <div className="cc-library-sheet-body" ref={bodyRef} tabIndex={0} onKeyDown={onBodyKey}>
                <Suspense fallback={null}>
                  {panel && <LibraryPanel {...panel} />}
                </Suspense>
              </div>
            </>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
