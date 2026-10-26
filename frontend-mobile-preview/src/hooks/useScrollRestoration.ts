import { useLayoutEffect, useEffect, useRef } from 'react';
import { ViewId } from '../types';
import { useAppStore } from '../store/useAppStore';
import {
  scrollRestorationManager,
  getTabScrollKey,
  getViewScrollKey
} from '../services/scrollRestoration';

interface UseScrollRestorationOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  currentView: ViewId;
  activeTabId: string;
  activeAlbumId: string | null;
}

/**
 * useScrollRestoration
 *
 * Manages zero-flicker pre-paint scroll position restoration and post-layout
 * synchronization across views and top session tabs.
 */
export function useScrollRestoration({
  containerRef,
  currentView,
  activeTabId,
  activeAlbumId
}: UseScrollRestorationOptions) {
  const isRestoringRef = useRef(false);
  const restorationActiveRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store latest values in refs to avoid stale closures in event listeners
  const activeTabIdRef = useRef(activeTabId);
  const currentViewRef = useRef(currentView);
  const activeAlbumIdRef = useRef(activeAlbumId);

  activeTabIdRef.current = activeTabId;
  currentViewRef.current = currentView;
  activeAlbumIdRef.current = activeAlbumId;

  // Cleanup helper for the restoration loop
  const stopRestorationLoop = (reason?: string) => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (mutationObserverRef.current) {
      mutationObserverRef.current.disconnect();
      mutationObserverRef.current = null;
    }
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
    restorationActiveRef.current = false;
    isRestoringRef.current = false;
    scrollRestorationManager.setLocked(false);
  };

  // 1. Setup continuous scroll and user interaction listeners on container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    scrollRestorationManager.registerContainer(container);

    // Passive scroll handler: records user's manual scroll position
    const handleScroll = () => {
      // Ignore programmatic scrolls during restoration or while locked
      if (isRestoringRef.current || scrollRestorationManager.isRestorationLocked()) {
        return;
      }
      const currentScroll = container.scrollTop;
      const tabId = activeTabIdRef.current;
      const view = currentViewRef.current;
      const albumId = activeAlbumIdRef.current;

      if (tabId) {
        scrollRestorationManager.savePosition(getTabScrollKey(tabId), currentScroll);
      }
      if (view) {
        scrollRestorationManager.savePosition(getViewScrollKey(view, albumId), currentScroll);
      }
    };

    // User interaction handler: aborts restoration if user starts scrolling manually
    const handleUserInteraction = () => {
      if (restorationActiveRef.current) {
        stopRestorationLoop('user_interaction');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) {
        handleUserInteraction();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleUserInteraction, { passive: true });
    container.addEventListener('touchstart', handleUserInteraction, { passive: true });
    container.addEventListener('touchmove', handleUserInteraction, { passive: true });
    container.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    window.addEventListener('keydown', handleKeyDown, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleUserInteraction);
      container.removeEventListener('touchstart', handleUserInteraction);
      container.removeEventListener('touchmove', handleUserInteraction);
      container.removeEventListener('pointerdown', handleUserInteraction);
      window.removeEventListener('keydown', handleKeyDown);
      stopRestorationLoop('unmount');
    };
  }, [containerRef]);

  // 2. Perform synchronous pre-paint restoration & post-layout sync on view/tab switch
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Stop any existing restoration loop from previous view
    stopRestorationLoop('navigation_switch');

    // If navigating directly to a highlighted item/task, let scrollIntoView handle positioning
    if (useAppStore.getState().highlightedItemId) {
      return;
    }

    // Register container in manager
    scrollRestorationManager.registerContainer(container);

    // Resolve target scroll position
    const targetScrollTop = scrollRestorationManager.getSavedPosition(
      activeTabId,
      currentView,
      activeAlbumId
    );

    // Lock to prevent scroll events during layout / restoration from overwriting saved state
    isRestoringRef.current = true;
    restorationActiveRef.current = true;
    scrollRestorationManager.setLocked(true);

    // Initial pre-paint attempt: sets scroll position before browser paints the frame
    container.scrollTop = targetScrollTop;

    // Case A: Target is 0
    if (targetScrollTop === 0) {
      container.scrollTop = 0;
      // Allow one frame for layout to settle, then unlock
      rafIdRef.current = requestAnimationFrame(() => {
        stopRestorationLoop('zero_settled');
      });
      return;
    }

    // Case B: Target > 0 - Setup Post-Layout Synchronization Loop
    // Handles dynamic rendering, card grids, masonry, and asynchronous content growth
    let consecutiveStableMatches = 0;
    let lastHeight = container.scrollHeight;
    const startTime = performance.now();
    const maxDurationMs = 1200;

    const syncStep = () => {
      if (!restorationActiveRef.current || !containerRef.current) {
        return;
      }

      const c = containerRef.current;
      const now = performance.now();

      // Check timeout
      if (now - startTime > maxDurationMs) {
        stopRestorationLoop('timeout_max_duration');
        return;
      }

      const currentScroll = c.scrollTop;
      const currentHeight = c.scrollHeight;
      const clientHeight = c.clientHeight;
      const maxScrollPossible = Math.max(0, currentHeight - clientHeight);
      const effectiveTarget = Math.min(targetScrollTop, maxScrollPossible);

      // If current scroll is not at the target, adjust it
      if (Math.abs(currentScroll - effectiveTarget) > 1 || (currentScroll < targetScrollTop && maxScrollPossible > currentScroll)) {
        c.scrollTop = targetScrollTop;
      }

      // Check if target is fully reached
      const diff = Math.abs(c.scrollTop - targetScrollTop);
      if (diff <= 1) {
        // Target reached. Verify stability across consecutive frames to guard against late layout shifts
        if (currentHeight === lastHeight) {
          consecutiveStableMatches++;
        } else {
          consecutiveStableMatches = 0;
        }
        lastHeight = currentHeight;

        if (consecutiveStableMatches >= 3) {
          stopRestorationLoop('target_reached_stable');
          return;
        }
      } else {
        consecutiveStableMatches = 0;
        lastHeight = currentHeight;
      }

      rafIdRef.current = requestAnimationFrame(syncStep);
    };

    // Start RAF loop
    rafIdRef.current = requestAnimationFrame(syncStep);

    // Attach ResizeObserver to detect layout expansions (e.g. 100+ cards loaded or rendered)
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (restorationActiveRef.current && containerRef.current) {
          if (Math.abs(containerRef.current.scrollTop - targetScrollTop) > 1) {
            containerRef.current.scrollTop = targetScrollTop;
          }
        }
      });
      ro.observe(container);
      if (container.firstElementChild) {
        ro.observe(container.firstElementChild);
      }
      resizeObserverRef.current = ro;
    }

    // Attach MutationObserver for dynamic child additions
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => {
        if (restorationActiveRef.current && containerRef.current) {
          if (Math.abs(containerRef.current.scrollTop - targetScrollTop) > 1) {
            containerRef.current.scrollTop = targetScrollTop;
          }
        }
      });
      mo.observe(container, { childList: true, subtree: true });
      mutationObserverRef.current = mo;
    }

    // Safety timeout
    safetyTimeoutRef.current = setTimeout(() => {
      stopRestorationLoop('safety_timeout');
    }, maxDurationMs);

    return () => {
      stopRestorationLoop('layout_effect_cleanup');
    };
  }, [activeTabId, currentView, activeAlbumId]);
}
