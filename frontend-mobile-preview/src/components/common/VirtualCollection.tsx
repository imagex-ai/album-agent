import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { scrollRestorationManager } from '../../services/scrollRestoration';

// Keep measured row geometry when navigating away and back. Bounded to avoid
// retaining a separate DOM measurement for every search performed in a session.
const measuredHeights = new Map<string, number>();
const rememberHeight = (key: string, height: number) => {
  if (measuredHeights.size > 6000) measuredHeights.delete(measuredHeights.keys().next().value!);
  measuredHeights.set(key, height);
};

/** Preserve the first rendered table's column geometry as rows enter/leave. */
export function StableVirtualTable({ children, className }: { children: React.ReactNode; className: string }) {
  const table = useRef<HTMLTableElement>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const measuredWidth = useRef(0);
  useLayoutEffect(() => {
    const element = table.current;
    if (!element) return;
    if (!widths.length) {
      const cells = Array.from(element.querySelectorAll('thead th'));
      const total = element.getBoundingClientRect().width;
      if (total && cells.length) setWidths(cells.map(cell => cell.getBoundingClientRect().width / total * 100));
    }
    const container = element.parentElement;
    if (!container) return;
    measuredWidth.current = container.clientWidth;
    const resize = new ResizeObserver(() => {
      if (container.clientWidth !== measuredWidth.current) { measuredWidth.current = container.clientWidth; setWidths([]); }
    });
    resize.observe(container);
    return () => resize.disconnect();
  }, [widths.length]);
  return <table ref={table} className={className} style={{ tableLayout: widths.length ? 'fixed' : 'auto' }}>
    {widths.length > 0 && <colgroup>{widths.map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>}
    {children}
  </table>;
}

export function rowOffsets(heights: number[], gap: number): number[] {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets[offsets.length - 1] + height + gap);
  return offsets;
}

export function visibleRowRange(offsets: number[], top: number, viewport: number, overscan = 800) {
  const rows = offsets.length - 1;
  const search = (target: number) => {
    let low = 0, high = rows;
    while (low < high) { const mid = (low + high) >>> 1; if (offsets[mid + 1] <= target) low = mid + 1; else high = mid; }
    return Math.min(Math.max(0, rows - 1), low);
  };
  return { start: search(Math.max(0, top - overscan)), end: Math.min(rows, search(top + viewport + overscan) + 1) };
}

interface CollectionProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
  className?: string;
  /** Tailwind viewport breakpoints, matching the existing column classes. */
  columns?: readonly (readonly [number, number])[];
  estimatedRowHeight?: number;
  gap?: number;
  pinnedKeys?: string[];
  highlightedKey?: string | null;
  layoutKey: string;
  tableColumns?: number;
}

export function VirtualCollection<T>({ items, itemKey, renderItem, className = '', columns = [[0, 1]], estimatedRowHeight = 360, gap: configuredGap, pinnedKeys = [], highlightedKey, layoutKey, tableColumns }: CollectionProps<T>) {
  const root = useRef<HTMLDivElement & HTMLTableSectionElement>(null);
  const main = useRef<HTMLElement | null>(null);
  const observed = useRef(new Map<number, Element>());
  const observer = useRef<ResizeObserver>();
  const frame = useRef<number>();
  const [geometry, setGeometry] = useState({ width: 0, viewport: 900, top: 0, gap: 20, screenWidth: typeof window === 'undefined' ? 1200 : window.innerWidth });
  const gap = configuredGap ?? geometry.gap;
  const lastHighlighted = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pendingFocus = useRef<{ index: number; backwards: boolean } | null>(null);
  const count = columns.reduce((value, [minWidth, size]) => geometry.screenWidth >= minWidth ? size : value, 1);
  const rowCount = Math.ceil(items.length / count);
  const cachePrefix = `${layoutKey}:${count}:${Math.round(geometry.width)}`;
  const rowKey = useCallback((row: number) => `${cachePrefix}:${items[row * count] ? itemKey(items[row * count]) : row}`, [cachePrefix, items, count, itemKey]);
  const offsets = useMemo(() => rowOffsets(Array.from({ length: rowCount }, (_, row) => measuredHeights.get(rowKey(row)) || estimatedRowHeight), gap), [rowCount, rowKey, estimatedRowHeight, gap, revision]);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const topRef = useRef(geometry.top);
  topRef.current = geometry.top;

  const refresh = useCallback(() => {
    const element = root.current, scroller = main.current;
    if (!element || !scroller) return;
    const top = scroller.getBoundingClientRect().top - element.getBoundingClientRect().top;
    const next = { top, viewport: scroller.clientHeight, width: element.clientWidth, gap: parseFloat(getComputedStyle(element).rowGap) || 0, screenWidth: window.innerWidth };
    setGeometry(previous => Object.keys(next).every(key => (next as any)[key] === (previous as any)[key]) ? previous : next);
  }, []);
  const scheduleRefresh = useCallback(() => {
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => { frame.current = undefined; refresh(); });
  }, [refresh]);

  useLayoutEffect(() => {
    main.current = root.current?.closest('main') || null;
    const scroller = main.current;
    if (!scroller) return;
    refresh();
    scroller.addEventListener('scroll', scheduleRefresh, { passive: true });
    window.addEventListener('resize', scheduleRefresh);
    const resize = new ResizeObserver(scheduleRefresh);
    resize.observe(scroller);
    if (root.current) resize.observe(root.current);
    return () => {
      scroller.removeEventListener('scroll', scheduleRefresh);
      window.removeEventListener('resize', scheduleRefresh);
      resize.disconnect();
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, [refresh, scheduleRefresh]);

  useLayoutEffect(() => {
    const resize = new ResizeObserver(entries => {
      let changed = false, correction = 0;
      for (const entry of entries) {
        const row = Number((entry.target as HTMLElement).dataset.virtualRow);
        const height = entry.borderBoxSize?.[0]?.blockSize || entry.target.getBoundingClientRect().height;
        if (!height) continue;
        const key = rowKey(row);
        const previous = measuredHeights.get(key) || estimatedRowHeight;
        if (Math.abs(previous - height) < 0.5) continue;
        if (offsetsRef.current[row + 1] <= topRef.current) correction += height - previous;
        rememberHeight(key, height);
        changed = true;
      }
      if (changed) {
        // Content loading above the viewport must not move the item being read.
        if (correction && main.current && !scrollRestorationManager.isRestorationLocked()) main.current.scrollTop += correction;
        setRevision(value => value + 1);
        scheduleRefresh();
      }
    });
    observer.current = resize;
    observed.current.forEach(element => resize.observe(element));
    return () => { resize.disconnect(); observer.current = undefined; };
  }, [rowKey, estimatedRowHeight, scheduleRefresh]);

  const measureRow = useCallback((row: number, element: Element | null) => {
    const previous = observed.current.get(row);
    if (previous) observer.current?.unobserve(previous);
    if (element) { observed.current.set(row, element); observer.current?.observe(element); }
    else observed.current.delete(row);
  }, []);

  useLayoutEffect(refresh, [items, count, refresh]);
  const range = visibleRowRange(offsets, geometry.top, geometry.viewport);
  const rows = new Set<number>();
  for (let row = range.start; row < range.end; row++) rows.add(row);
  const retain = new Set([...pinnedKeys, ...(focusedKey ? [focusedKey] : [])]);
  items.forEach((item, index) => { if (retain.has(itemKey(item))) rows.add(Math.floor(index / count)); });
  const indices = [...rows].filter(row => row < rowCount).sort((a, b) => a - b);

  useLayoutEffect(() => {
    if (!highlightedKey) { lastHighlighted.current = null; return; }
    if (lastHighlighted.current === highlightedKey || !main.current || !root.current) return;
    const index = items.findIndex(item => itemKey(item) === highlightedKey);
    if (index < 0) return;
    lastHighlighted.current = highlightedKey;
    const start = root.current.getBoundingClientRect().top - main.current.getBoundingClientRect().top + main.current.scrollTop;
    main.current.scrollTo({ top: start + offsetsRef.current[Math.floor(index / count)], behavior: 'auto' });
    refresh();
  }, [highlightedKey, items, count, itemKey, refresh]);

  const focusProps = {
    onFocusCapture: (event: React.FocusEvent) => setFocusedKey((event.target as HTMLElement).closest<HTMLElement>('[data-virtual-key]')?.dataset.virtualKey || null),
    onBlurCapture: (event: React.FocusEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null); },
    onKeyDownCapture: (event: React.KeyboardEvent) => {
      if (event.key !== 'Tab' || !root.current) return;
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]');
      if (!card) return;
      const targets = Array.from(card.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
      const boundary = event.shiftKey ? targets[0] : targets[targets.length - 1];
      const index = Number(card.dataset.virtualIndex) + (event.shiftKey ? -1 : 1);
      if (event.target !== boundary || index < 0 || index >= items.length || root.current.querySelector(`[data-virtual-index="${index}"]`)) return;
      event.preventDefault();
      pendingFocus.current = { index, backwards: event.shiftKey };
      setFocusedKey(itemKey(items[index]));
    },
  };
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !root.current) return;
    const card = root.current.querySelector<HTMLElement>(`[data-virtual-index="${pending.index}"]`);
    if (!card) return;
    const targets = Array.from(card.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
    const target = pending.backwards ? targets[targets.length - 1] : targets[0];
    pendingFocus.current = null;
    target?.focus();
    card.scrollIntoView({ block: 'nearest' });
    refresh();
  });
  if (tableColumns) {
    const children: React.ReactNode[] = [];
    let previous = 0;
    for (const row of indices) {
      if (row > previous) children.push(<tr key={`gap-${row}`} aria-hidden="true"><td colSpan={tableColumns} style={{ height: offsets[row] - offsets[previous], padding: 0, border: 0 }} /></tr>);
      const item = items[row];
      children.push(React.cloneElement(renderItem(item, row), { key: itemKey(item), ref: (element: Element | null) => measureRow(row, element), 'data-virtual-row': row, 'data-virtual-key': itemKey(item), 'data-virtual-index': row }));
      previous = row + 1;
    }
    if (previous < rowCount) children.push(<tr key="tail" aria-hidden="true"><td colSpan={tableColumns} style={{ height: offsets[rowCount] - offsets[previous], padding: 0, border: 0 }} /></tr>);
    return <tbody ref={root} className={className} {...focusProps}>{children}</tbody>;
  }
  // Cards remain direct siblings with stable item keys. A prepend, re-sort or
  // responsive column change must not remount an already-playing video.
  const children: React.ReactNode[] = [];
  let previous = 0;
  for (const row of indices) {
    if (row > previous) children.push(<div key={`gap-${row}`} aria-hidden="true" style={{ gridColumn: '1 / -1', height: Math.max(0, offsets[row] - offsets[previous] - gap), pointerEvents: 'none' }} />);
    for (let index = row * count; index < Math.min(items.length, (row + 1) * count); index++) {
      const item = items[index];
      children.push(React.cloneElement(renderItem(item, index), {
        key: itemKey(item), ref: (element: Element | null) => measureRow(index, element),
        'data-virtual-row': row, 'data-virtual-key': itemKey(item), 'data-virtual-index': index,
      }));
    }
    previous = row + 1;
  }
  if (previous < rowCount) children.push(<div key="tail" aria-hidden="true" style={{ gridColumn: '1 / -1', height: Math.max(0, offsets[rowCount] - offsets[previous] - gap), pointerEvents: 'none' }} />);
  return <div ref={root} className={className} style={{ overflowAnchor: 'none' }} {...focusProps}>{children}</div>;
}
