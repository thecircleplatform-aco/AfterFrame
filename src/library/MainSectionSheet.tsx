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
import { createPortal } from 'react-dom';
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

/**
 * A freshly opened section is a working panel, not a page: it tops out just
 * under the dock line so the timeline stays reachable, and the grabber drags
 * it further up when the user actually wants the whole screen. */
function expandedHeight(): number {
  return maxHeight();
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
  // Sheet-wide filter, owned here because the field lives in the sheet header
  // rather than inside any one panel.
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Filled by LibraryPanel so the header badge can show how many filters are
  // narrowing the list without the sheet reaching into the panel's state.
  const [activeFilterCount, setActiveFilterCount] = useState(0);
  /**
   * Fullscreen is not just "tall": the sheet normally lives inside
   * `.cc-main-dock-host`, which is `position: fixed; z-index: 60`. Anything
   * inside it is trapped under that stacking context, so a "fullscreen" sheet
   * still painted *below* the dock that shares its host. Hoisting it to
   * `document.body` in this state is what lets it cover the whole viewport.
   */
  const [fullscreen, setFullscreen] = useState(false);

  // Fullscreen is portalled to <body>, so keyboard focus is usually still on the
  // editor shell and the sheet's own onKeyDown never fires. Listen at document
  // level so Escape reliably backs out of fullscreen (the panel's own handler
  // then continues to treat Escape as "close the section").
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setFullscreen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [fullscreen]);
  // A query belongs to the section it was typed in; carrying it across sections
  // hides results the user did not ask to hide.
  useEffect(() => { setQuery(''); }, [tab]);

  // Keep a remembered height inside the viewport when the window shrinks.
  useEffect(() => {
    const onResize = () => setHeight((current) => clampHeight(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The dock used to slide away whenever a sheet opened, because the sheet
  // carried its own tab strip and the two competed for the same space. The dock
  // is now the ONLY section switcher (Library sub-sections live there too), so
  // hiding it stranded the user inside a section with no way to reach another.
  // It stays put and the sheet simply rests on top of it.
  useEffect(() => {
    if (!open) return;
    setHeight((current) => clampHeight(storedHeight() ?? defaultHeight() ?? current));
  }, [open]);

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

  // The sheet's inner content, identical in both modes. Only the wrapper and the
  // grabber behaviour differ, so this stays in one place.
  const content = (
    <>
      <div
        className="cc-library-sheet-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('Drag to resize')}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maxHeight()}
        aria-valuenow={fullscreen ? maxHeight() : height}
        tabIndex={0}
        onPointerDown={fullscreen ? undefined : onGripDown}
        onPointerMove={fullscreen ? undefined : onGripMove}
        onPointerUp={fullscreen ? undefined : onGripUp}
        onPointerCancel={fullscreen ? undefined : onGripUp}
        onKeyDown={fullscreen ? undefined : onGripKey}
        onDoubleClick={() => (fullscreen ? setFullscreen(false) : commitHeight(defaultHeight()))}
      />
      {tab === 'Agent' ? (
        /* The chat is a page-like panel with its own chrome, so it takes the
           whole sheet; the header inside AgentPanelView carries the brand
           and the controls, and the grabber stays so it is still resizable. */
        <div className="cc-library-sheet-body" ref={bodyRef} tabIndex={0} onKeyDown={onBodyKey}>
          {agent && (
            <AgentPanelView
              panel={agent}
              fullScreen={fullscreen}
              onToggleFullScreen={() => setFullscreen((on) => !on)}
            />
          )}
        </div>
      ) : (
        <>
          <div className="cc-library-sheet-head">
            <button type="button" className="cc-library-sheet-back"
              onClick={closeMainTabSheet} title={t('Back')} aria-label={t('Back')}>
              <Icon name="chevronDown" size={14} />
            </button>
            {/* The section name is redundant here — the dock pill below is
                already highlighted for it. A sheet-wide filter is what the
                header should actually offer, so the row is a back button
                plus a search field instead of a title bar. */}
            <label className="cc-library-sheet-search">
              <Icon name="search" size={12} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    setQuery('');
                  }
                }}
                placeholder={t('Search')}
                aria-label={t('Search')}
              />
              {query && (
                <button
                  type="button"
                  className="cc-library-sheet-search-clear"
                  onClick={() => setQuery('')}
                  aria-label={t('Clear')}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </label>
            {/* Filters live at the right corner of the header so the search
                field can span the middle without competing with it. */}
            <button
              type="button"
              className={`cc-library-sheet-filter${filtersOpen ? ' is-open' : ''}`}
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-label={t('Filter')}
              title={t('Filter')}
              data-cc-toolbar-anchor="filter"
            >
              <Icon name="filter" size={14} />
              {activeFilterCount > 0 && (
                <span className="cc-library-sheet-filter-badge">{activeFilterCount}</span>
              )}
            </button>
          </div>
          <div className="cc-library-sheet-body" ref={bodyRef} tabIndex={0} onKeyDown={onBodyKey}>
            <Suspense fallback={null}>
              {panel && (
                <LibraryPanel
                  {...panel}
                  sheetQuery={query}
                  filtersOpen={filtersOpen}
                  onActiveFilterCountChange={setActiveFilterCount}
                />
              )}
            </Suspense>
          </div>
        </>
      )}
    </>
  );

  const sheet = (
    <motion.section
      key="library-sheet"
      className={`cc-library-sheet${fullscreen ? ' is-fullscreen' : ''}`}
      role="dialog"
      aria-label={t(tab)}
      /*
       * Animate TRANSFORM, never `y`.
       *
       * `y` is a layout property: animating it re-runs layout for the entire
       * subtree on every spring frame. The Agent panel mounts a ~3,200px
       * transcript plus ~140 tool schemas, so that was ~20 full relayouts of the
       * whole message list per open — 3.5s instead of 0.7s (measured: identical
       * reopen, 3,515ms with `y`, 718ms with the transform). `y` also silently
       * promoted the sheet to a per-frame compositing layer, which is why the
       * cost scaled with transcript length rather than with sheet size.
       *
       * `translateY` stays on the compositor: the layer is rasterized once and
       * merely slides, so layout runs exactly once no matter how long the chat
       * history is. Without `style.transformTemplate` Motion writes
       * `transform: translateY(...)` into a `transform` value that it also uses
       * for scale/rotate, so nothing else here is affected.
       */
      initial={reduceMotion ? false : { transform: 'translateY(100%)', opacity: 0.6 }}
      animate={{ transform: 'translateY(0%)', opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { transform: 'translateY(100%)', opacity: 0.6 }}
      transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
      style={{
        pointerEvents: 'auto',
        height: fullscreen ? '100dvh' : height,
        maxHeight: 'none',
        // Keep the slide off the layout thread and hint the compositor up front
        // so the first animated frame does not pay for layer creation.
        willChange: reduceMotion ? undefined : 'transform',
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        // Escape backs out one level: fullscreen first, then the section.
        if (fullscreen) setFullscreen(false); else closeMainTabSheet();
      }}
    >
      {content}
    </motion.section>
  );

  const visible = open && (panel || agent);

  return (
    <>
      {/* In place: normal bottom sheet, still inside the dock host. */}
      <AnimatePresence>
        {visible && !fullscreen && sheet}
      </AnimatePresence>
      {/*
        Fullscreen must escape `.cc-main-dock-host` (fixed, z-index 60). That host
        is a stacking context, so a sheet inside it can never paint over the dock
        it shares the host with — which is why "fullscreen" still appeared from
        the bottom, behind the bar. Portalling to <body> lifts it out.
        Rendered outside AnimatePresence because portals and presence don't mix.
      */}
      {visible && fullscreen && createPortal(sheet, document.body)}
    </>
  );
}
