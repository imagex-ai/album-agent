/**
 * usePlayerControlsAutoHide.ts
 *
 * Unified 2500ms controls auto-hide timer and interaction freeze locks.
 * Keeps controls visible whenever playback is paused or user interaction is active
 * (open overlay/menu/sheet, active scrubber drag, toolbar hover, keyboard focus-within,
 * or explicit disableAutoHide).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLAYER_HIDE_TIMEOUT_MS } from './videoPlayerCore';

export interface ControlsAutoHideLockState {
  isPlaying: boolean;
  autoHideWhilePaused?: boolean;
  hasOpenOverlay?: boolean;
  isScrubbing?: boolean;
  isToolbarHovered?: boolean;
  isFocusWithin?: boolean;
  disableAutoHide?: boolean;
}

export type TimerHandle = ReturnType<typeof setTimeout>;
export type SetTimeoutFn = (callback: () => void, delayMs: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle) => void;

export interface CreateControlsAutoHideControllerOptions {
  state: ControlsAutoHideLockState;
  hideTimeoutMs?: number;
  initialVisible?: boolean;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
  onVisibilityChange?: (visible: boolean) => void;
}

export interface ControlsAutoHideController {
  isVisible: () => boolean;
  showControls: () => void;
  notifyActivity: () => void;
  hideControls: (force?: boolean) => void;
  toggleControls: () => void;
  updateState: (nextState: ControlsAutoHideLockState) => void;
  destroy: () => void;
}

/**
 * Pure lock check determining whether controls must stay visible and suppress auto-hide.
 */
export function shouldPauseControlsAutoHide(state: ControlsAutoHideLockState): boolean {
  if (!state || typeof state !== 'object') return true;
  return (
    (!state.isPlaying && !state.autoHideWhilePaused) ||
    Boolean(state.hasOpenOverlay) ||
    Boolean(state.isScrubbing) ||
    Boolean(state.isToolbarHovered) ||
    Boolean(state.isFocusWithin) ||
    Boolean(state.disableAutoHide)
  );
}

/**
 * Pure stateful timer coordinator for deterministic testing and hook backing.
 */
export function createControlsAutoHideController(
  options: CreateControlsAutoHideControllerOptions
): ControlsAutoHideController {
  const timeoutMs =
    typeof options.hideTimeoutMs === 'number' &&
    Number.isFinite(options.hideTimeoutMs) &&
    options.hideTimeoutMs > 0
      ? options.hideTimeoutMs
      : PLAYER_HIDE_TIMEOUT_MS;

  const setTimer: SetTimeoutFn =
    options.setTimeoutFn || ((cb, ms) => globalThis.setTimeout(cb, ms));
  const clearTimer: ClearTimeoutFn =
    options.clearTimeoutFn || ((id) => globalThis.clearTimeout(id));

  let visible = shouldPauseControlsAutoHide(options.state)
    ? true
    : (options.initialVisible ?? true);
  let currentState: ControlsAutoHideLockState = { ...options.state };
  let timerId: TimerHandle | null = null;
  let destroyed = false;

  const clearPending = () => {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
  };

  const setVisible = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    options.onVisibilityChange?.(next);
  };

  const scheduleHide = () => {
    clearPending();
    if (destroyed || !visible || shouldPauseControlsAutoHide(currentState)) {
      return;
    }
    timerId = setTimer(() => {
      timerId = null;
      if (!destroyed && !shouldPauseControlsAutoHide(currentState)) {
        setVisible(false);
      }
    }, timeoutMs);
  };

  const showControls = () => {
    if (destroyed) return;
    setVisible(true);
    scheduleHide();
  };

  const hideControls = (force = false) => {
    if (destroyed) return;
    if (!force && shouldPauseControlsAutoHide(currentState)) {
      return;
    }
    clearPending();
    setVisible(false);
  };

  const toggleControls = () => {
    if (destroyed) return;
    if (visible && !shouldPauseControlsAutoHide(currentState)) {
      hideControls(false);
    } else {
      showControls();
    }
  };

  const updateState = (nextState: ControlsAutoHideLockState) => {
    if (destroyed) return;
    const prevPaused = shouldPauseControlsAutoHide(currentState);
    currentState = { ...nextState };
    const nextPaused = shouldPauseControlsAutoHide(currentState);

    if (nextPaused) {
      clearPending();
      setVisible(true);
      return;
    }

    if (visible && (prevPaused || timerId === null)) {
      scheduleHide();
    }
  };

  const destroy = () => {
    destroyed = true;
    clearPending();
  };

  if (visible && !shouldPauseControlsAutoHide(currentState)) {
    scheduleHide();
  }

  return {
    isVisible: () => visible,
    showControls,
    notifyActivity: showControls,
    hideControls,
    toggleControls,
    updateState,
    destroy,
  };
}

export interface UsePlayerControlsAutoHideOptions extends ControlsAutoHideLockState {
  hideTimeoutMs?: number;
  initialVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export interface UsePlayerControlsAutoHideResult {
  controlsVisible: boolean;
  isAutoHidePaused: boolean;
  showControls: () => void;
  notifyActivity: () => void;
  hideControls: (force?: boolean) => void;
  toggleControls: () => void;
  onPointerActivity: () => void;
}

/**
 * React hook managing controls visibility and 2500ms idle auto-hide with safety locks.
 */
export function usePlayerControlsAutoHide(
  options: UsePlayerControlsAutoHideOptions
): UsePlayerControlsAutoHideResult {
  const {
    isPlaying,
    autoHideWhilePaused = false,
    hasOpenOverlay = false,
    isScrubbing = false,
    isToolbarHovered = false,
    isFocusWithin = false,
    disableAutoHide = false,
    hideTimeoutMs = PLAYER_HIDE_TIMEOUT_MS,
    initialVisible = true,
    onVisibilityChange,
  } = options;

  const initialPaused = shouldPauseControlsAutoHide({
    isPlaying,
    autoHideWhilePaused,
    hasOpenOverlay,
    isScrubbing,
    isToolbarHovered,
    isFocusWithin,
    disableAutoHide,
  });
  const [controlsVisible, setControlsVisible] = useState<boolean>(() =>
    initialPaused ? true : initialVisible
  );
  const onVisibilityChangeRef = useRef(onVisibilityChange);
  onVisibilityChangeRef.current = onVisibilityChange;

  const controllerRef = useRef<ControlsAutoHideController | null>(null);

  useEffect(() => {
    const startState: ControlsAutoHideLockState = {
      isPlaying,
      autoHideWhilePaused,
      hasOpenOverlay,
      isScrubbing,
      isToolbarHovered,
      isFocusWithin,
      disableAutoHide,
    };
    const controller = createControlsAutoHideController({
      state: startState,
      hideTimeoutMs,
      initialVisible: shouldPauseControlsAutoHide(startState) ? true : controlsVisible,
      onVisibilityChange: (visible) => {
        setControlsVisible(visible);
        onVisibilityChangeRef.current?.(visible);
      },
    });
    controllerRef.current = controller;
    if (controller.isVisible() !== controlsVisible) {
      setControlsVisible(controller.isVisible());
    }
    return () => {
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
    // Controller rebinds only when hideTimeoutMs changes; state sync runs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideTimeoutMs]);

  useEffect(() => {
    controllerRef.current?.updateState({
      isPlaying,
      autoHideWhilePaused,
      hasOpenOverlay,
      isScrubbing,
      isToolbarHovered,
      isFocusWithin,
      disableAutoHide,
    });
  }, [
    isPlaying,
    autoHideWhilePaused,
    hasOpenOverlay,
    isScrubbing,
    isToolbarHovered,
    isFocusWithin,
    disableAutoHide,
  ]);

  const isAutoHidePaused = useMemo(
    () =>
      shouldPauseControlsAutoHide({
        isPlaying,
        autoHideWhilePaused,
        hasOpenOverlay,
        isScrubbing,
        isToolbarHovered,
        isFocusWithin,
        disableAutoHide,
      }),
    [
      isPlaying,
      autoHideWhilePaused,
      hasOpenOverlay,
      isScrubbing,
      isToolbarHovered,
      isFocusWithin,
      disableAutoHide,
    ]
  );

  const showControls = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.showControls();
    } else {
      setControlsVisible(true);
    }
  }, []);

  const hideControls = useCallback((force = false) => {
    if (controllerRef.current) {
      controllerRef.current.hideControls(force);
    } else if (force) {
      setControlsVisible(false);
    }
  }, []);

  const toggleControls = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.toggleControls();
    } else {
      setControlsVisible((prev) => !prev);
    }
  }, []);

  return {
    controlsVisible,
    isAutoHidePaused,
    showControls,
    notifyActivity: showControls,
    hideControls,
    toggleControls,
    onPointerActivity: showControls,
  };
}
