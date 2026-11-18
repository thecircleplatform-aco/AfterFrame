import { useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface FixedVirtualGridOptions {
  itemCount: number;
  cardWidth: number;
  rowHeight: number;
  columnGap?: number;
  rowGap?: number;
  overscanRows?: number;
  fixedColumnCount?: number;
  pinnedIndexes?: readonly number[];
}

export interface FixedVirtualRow {
  rowIndex: number;
  startIndex: number;
  endIndex: number;
  top: number;
}

interface GridWindow {
  width: number;
  columnCount: number;
  startRow: number;
  endRow: number;
}

const INITIAL_WINDOW: GridWindow = {
  width: 0,
  columnCount: 1,
  startRow: 0,
  endRow: 0,
};

function sameWindow(a: GridWindow, b: GridWindow): boolean {
  return a.width === b.width
    && a.columnCount === b.columnCount
    && a.startRow === b.startRow
    && a.endRow === b.endRow;
}

function findScrollContainer(node: HTMLElement): HTMLElement {
  let current = node.parentElement;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return current;
    current = current.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function columnCountFor(width: number, cardWidth: number, gap: number, fixed?: number): number {
  if (fixed != null) return Math.max(1, fixed);
  return Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useFixedVirtualGrid({
  itemCount,
  cardWidth,
  rowHeight,
  columnGap = 0,
  rowGap = 0,
  overscanRows = 1,
  fixedColumnCount,
  pinnedIndexes = [],
}: FixedVirtualGridOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gridWindow, setGridWindow] = useState<GridWindow>(INITIAL_WINDOW);
  const rowStride = rowHeight + rowGap;
  // Identity of the pinned set, not of the array literal that carries it.
  const pinnedKey = pinnedIndexes.join(',');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scrollContainer = findScrollContainer(container);
    let animationFrame = 0;

    const measure = () => {
      animationFrame = 0;
      const width = container.clientWidth;
      const columnCount = columnCountFor(width, cardWidth, columnGap, fixedColumnCount);
      const rowCount = Math.ceil(itemCount / columnCount);
      const containerRect = container.getBoundingClientRect();
      const documentScroll = scrollContainer === document.documentElement || scrollContainer === document.body;
      const viewportTop = documentScroll ? 0 : scrollContainer.getBoundingClientRect().top;
      const viewportHeight = documentScroll ? window.innerHeight : scrollContainer.clientHeight;
      const localTop = viewportTop - containerRect.top;
      const localBottom = localTop + viewportHeight;
      const firstVisible = clamp(Math.floor(localTop / rowStride), 0, rowCount);
      const lastVisible = clamp(Math.ceil(localBottom / rowStride), 0, rowCount);
      const nextWindow = {
        width,
        columnCount,
        startRow: Math.max(0, firstVisible - overscanRows),
        endRow: Math.min(rowCount, lastVisible + overscanRows),
      };
      setGridWindow((current) => sameWindow(current, nextWindow) ? current : nextWindow);
    };

    const scheduleMeasure = () => {
      if (!animationFrame) animationFrame = requestAnimationFrame(measure);
    };
    const scrollTarget: EventTarget = scrollContainer === document.documentElement
      || scrollContainer === document.body ? window : scrollContainer;
    scrollTarget.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(container);
    if (scrollContainer !== document.documentElement && scrollContainer !== document.body) {
      resizeObserver?.observe(scrollContainer);
    }
    measure();

    return () => {
      cancelAnimationFrame(animationFrame);
      scrollTarget.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, [cardWidth, columnGap, fixedColumnCount, itemCount, overscanRows, rowStride]);

  // `gridWindow` is the only source of truth for the column count. Everything
  // that depends on it — row slicing, row tops, total height, the rendered
  // `gridTemplateColumns` and the scroll height — is derived from this one value,
  // so they can never disagree.
  //
  // Reading the live container width here instead (to shave the one-frame lag)
  // caused a permanent oscillation: the tile width is computed from this count, so
  // a wider measurement produced a taller grid, which added a scrollbar, which
  // narrowed the container, which changed the count again — 3 columns one frame,
  // 2 the next, forever. The fix for the lag is at the source (see `.cc-media-grid`
  // `scrollbar-gutter: stable`), not by making this value unstable during render.
  const columnCount = gridWindow.columnCount;
  const rowCount = Math.ceil(itemCount / columnCount);
  const totalHeight = rowCount === 0 ? 0 : rowCount * rowStride - rowGap;
  const rows = useMemo(() => {
    const indexes = new Set<number>();
    for (let row = gridWindow.startRow; row < gridWindow.endRow; row += 1) indexes.add(row);
    for (const index of pinnedIndexes) {
      if (index >= 0 && index < itemCount) indexes.add(Math.floor(index / columnCount));
    }
    return [...indexes].sort((a, b) => a - b).map<FixedVirtualRow>((rowIndex) => ({
      rowIndex,
      startIndex: rowIndex * columnCount,
      endIndex: Math.min(itemCount, (rowIndex + 1) * columnCount),
      top: rowIndex * rowStride,
    }));
    // `pinnedIndexes` is a fresh array at most call sites, so depending on its
    // identity rebuilt every row (and remounted the cards) on unrelated parent
    // renders — the visible flicker. Snapshot it to a string key instead.
  }, [columnCount, gridWindow.endRow, gridWindow.startRow, itemCount, pinnedKey, rowStride]);

  return {
    containerRef,
    columnCount,
    columnWidth: Math.min(cardWidth, gridWindow.width || cardWidth),
    rowHeight,
    rows,
    totalHeight,
    visibleStartIndex: gridWindow.startRow * columnCount,
    visibleEndIndex: Math.min(itemCount, gridWindow.endRow * columnCount),
  };
}
