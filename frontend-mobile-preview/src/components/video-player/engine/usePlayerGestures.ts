/**
 * usePlayerGestures.ts
 *
 * Pure gesture state machine + React hook for Universal Video Player touch/pointer
 * interactions:
 * - Double-tap +/-10s side-zone accumulation (left/right 35% zones within 450ms)
 * - Center double-tap / double-click fullscreen or toggle callback
 * - 350ms hold-for-2x speed boost (canceled immediately on >10px scroll movement,
 *   pointercancel, blur, visibilitychange, disabled, or unmount; always restores
 *   exact prior playbackRate)
 * - Vertical fine-scrubbing multiplier (1.0x / 0.5x / 0.25x)
 * - Vertical swipe up/down gestures with horizontal movement & control target guards
 *
 * Produces typed gestureFeedback objects only (zero hardcoded UI text).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PLAYER_DOUBLE_TAP_WINDOW_MS,
  PLAYER_HOLD_2X_DELAY_MS,
  PLAYER_HOLD_MOVE_CANCEL_PX,
} from './videoPlayerCore';

export type GestureTapZone = 'left' | 'center' | 'right';
export type GestureSingleTapMode = 'auto' | 'delayed' | 'immediate';
export type GestureTimerHandle = ReturnType<typeof setTimeout>;
export type GestureSetTimeoutFn = (callback: () => void, delayMs: number) => GestureTimerHandle;
export type GestureClearTimeoutFn = (handle: GestureTimerHandle) => void;

export type PlayerGestureFeedback =
  | {
      kind: 'seek';
      direction: 'back' | 'forward';
      zone: 'left' | 'right';
      deltaSeconds: number;
      totalDeltaSeconds: number;
      tapCount: number;
    }
  | {
      kind: 'hold2x';
      rate: number;
      previousRate: number;
      active: boolean;
    }
  | {
      kind: 'play_toggle';
      action: 'play' | 'pause';
    }
  | {
      kind: 'volume';
      volume: number;
      muted: boolean;
      delta: number;
    }
  | {
      kind: 'fine_scrub';
      multiplier: 1 | 0.5 | 0.25;
      upwardDistancePx: number;
    };

export interface GesturePointerDownInput {
  pointerId: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  now?: number;
  pointerType?: string;
  button?: number;
  isPrimary?: boolean;
}

export interface GesturePointerMoveInput {
  pointerId: number;
  x: number;
  y: number;
  now?: number;
}

export interface GesturePointerUpInput {
  pointerId: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  now?: number;
  pointerType?: string;
}

export interface GestureTapInput {
  zone: GestureTapZone;
  now?: number;
  immediateSingleTap?: boolean;
}

export interface DoubleTapSeekMeta {
  zone: 'left' | 'right';
  tapCount: number;
}

export interface CreateGestureLogicOptions {
  holdDelayMs?: number;
  moveThresholdPx?: number;
  doubleTapWindowMs?: number;
  seekStepSeconds?: number;
  sideZoneRatio?: number;
  verticalSwipeThresholdPx?: number;
  enableVerticalSwipe?: boolean;
  disabled?: boolean;
  setTimeoutFn?: GestureSetTimeoutFn;
  clearTimeoutFn?: GestureClearTimeoutFn;
  onSpeedHoldStart?: () => void;
  onSpeedHoldEnd?: (wasCancelled: boolean) => void;
  onDoubleTapSeek?: (deltaSeconds: number, totalComboSeconds: number, meta: DoubleTapSeekMeta) => void;
  onCenterDoubleTap?: () => void;
  onSingleTap?: (zone: GestureTapZone) => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

export interface GestureLogicMachine {
  onPointerDown: (input: GesturePointerDownInput) => void;
  onPointerMove: (input: GesturePointerMoveInput) => void;
  onPointerUp: (input: GesturePointerUpInput) => void;
  onPointerCancel: (pointerId?: number) => void;
  onExternalPointerEnd: (pointerId?: number) => boolean;
  hasActivePointer: () => boolean;
  registerTap: (input: GestureTapInput) => void;
  tick: (now: number) => void;
  cancelHold: () => void;
  isHoldActive: () => boolean;
  isHoldCancelled: () => boolean;
  getComboTotal: () => number;
  destroy: () => void;
}

const DEFAULT_SEEK_STEP_SECONDS = 10;
const DEFAULT_SIDE_ZONE_RATIO = 0.35;
const DEFAULT_VERTICAL_SWIPE_THRESHOLD_PX = 48;
const VERTICAL_DOMINANCE_RATIO = 1.5;

const INTERACTIVE_TAG_NAMES = new Set([
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'A',
  'LABEL',
  'OPTION',
  'SUMMARY',
  'DIALOG',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'slider',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'switch',
  'tab',
  'option',
  'textbox',
  'searchbox',
  'combobox',
]);

/**
 * Computes fine-scrubbing velocity multiplier as pointer pulls upward away from scrubber track.
 */
export function computeFineScrubMultiplier(upwardDistancePx: number): 1 | 0.5 | 0.25 {
  if (typeof upwardDistancePx !== 'number' || !Number.isFinite(upwardDistancePx) || upwardDistancePx < 40) {
    return 1;
  }
  if (upwardDistancePx < 100) {
    return 0.5;
  }
  return 0.25;
}

/**
 * Resolves horizontal tap zone into left 35% (-10s), center 30% (play/fullscreen), or right 35% (+10s).
 */
export function resolveGestureTapZone(
  localX: number,
  containerWidth: number,
  sideZoneRatio: number = DEFAULT_SIDE_ZONE_RATIO
): GestureTapZone {
  if (
    typeof localX !== 'number' ||
    !Number.isFinite(localX) ||
    typeof containerWidth !== 'number' ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0
  ) {
    return 'center';
  }
  const ratio =
    typeof sideZoneRatio === 'number' && Number.isFinite(sideZoneRatio) && sideZoneRatio > 0 && sideZoneRatio < 0.5
      ? sideZoneRatio
      : DEFAULT_SIDE_ZONE_RATIO;

  const fraction = localX / containerWidth;
  if (fraction < ratio) return 'left';
  if (fraction > 1 - ratio) return 'right';
  return 'center';
}

function readElAttr(el: unknown, name: string): string | null {
  if (!el || typeof el !== 'object') return null;
  const candidate = el as { getAttribute?: (k: string) => string | null; hasAttribute?: (k: string) => boolean };
  if (typeof candidate.getAttribute === 'function') {
    return candidate.getAttribute(name);
  }
  if (typeof candidate.hasAttribute === 'function' && candidate.hasAttribute(name)) {
    return '';
  }
  return null;
}

function hasElAttr(el: unknown, name: string): boolean {
  if (!el || typeof el !== 'object') return false;
  const candidate = el as { hasAttribute?: (k: string) => boolean; getAttribute?: (k: string) => string | null };
  if (typeof candidate.hasAttribute === 'function') {
    return candidate.hasAttribute(name);
  }
  if (typeof candidate.getAttribute === 'function') {
    return candidate.getAttribute(name) !== null;
  }
  return false;
}

/**
 * Returns true if the event target lies inside a player control, form field, slider, or opt-out marker.
 * Walks parent references defensively without assuming DOM `.closest()` exists.
 */
export function isInteractiveGestureTarget(target: unknown, boundary?: unknown): boolean {
  let current: unknown = target;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 32) {
    guard += 1;
    if (boundary && current === boundary) {
      return false;
    }

    const node = current as {
      tagName?: string;
      isContentEditable?: boolean;
      parentElement?: unknown;
      parentNode?: unknown;
    };

    const tag = String(node.tagName || '').toUpperCase();
    if (INTERACTIVE_TAG_NAMES.has(tag)) {
      return true;
    }

    if (node.isContentEditable) {
      return true;
    }
    const contentEditableAttr = readElAttr(node, 'contenteditable');
    if (contentEditableAttr === '' || contentEditableAttr === 'true') {
      return true;
    }

    const role = (readElAttr(node, 'role') || '').toLowerCase();
    if (INTERACTIVE_ROLES.has(role)) {
      return true;
    }

    if (hasElAttr(node, 'data-player-control') || hasElAttr(node, 'data-no-player-gesture')) {
      return true;
    }

    current = node.parentElement ?? node.parentNode ?? null;
  }

  return false;
}

/**
 * Pure, DOM-free gesture state machine handling hold-2x, double-tap seek combos,
 * single-tap delay arbitration, and vertical swipe classification.
 */
export function createGestureLogic(options: CreateGestureLogicOptions = {}): GestureLogicMachine {
  const holdDelayMs =
    typeof options.holdDelayMs === 'number' && Number.isFinite(options.holdDelayMs) && options.holdDelayMs >= 0
      ? options.holdDelayMs
      : PLAYER_HOLD_2X_DELAY_MS;
  const moveThresholdPx =
    typeof options.moveThresholdPx === 'number' && Number.isFinite(options.moveThresholdPx) && options.moveThresholdPx > 0
      ? options.moveThresholdPx
      : PLAYER_HOLD_MOVE_CANCEL_PX;
  const doubleTapWindowMs =
    typeof options.doubleTapWindowMs === 'number' &&
    Number.isFinite(options.doubleTapWindowMs) &&
    options.doubleTapWindowMs > 0
      ? options.doubleTapWindowMs
      : PLAYER_DOUBLE_TAP_WINDOW_MS;
  const seekStepSeconds =
    typeof options.seekStepSeconds === 'number' &&
    Number.isFinite(options.seekStepSeconds) &&
    options.seekStepSeconds > 0
      ? options.seekStepSeconds
      : DEFAULT_SEEK_STEP_SECONDS;
  const sideZoneRatio =
    typeof options.sideZoneRatio === 'number' && Number.isFinite(options.sideZoneRatio)
      ? options.sideZoneRatio
      : DEFAULT_SIDE_ZONE_RATIO;
  const verticalSwipeThresholdPx =
    typeof options.verticalSwipeThresholdPx === 'number' &&
    Number.isFinite(options.verticalSwipeThresholdPx) &&
    options.verticalSwipeThresholdPx > 0
      ? options.verticalSwipeThresholdPx
      : DEFAULT_VERTICAL_SWIPE_THRESHOLD_PX;

  const setTimer: GestureSetTimeoutFn =
    options.setTimeoutFn || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer: GestureClearTimeoutFn =
    options.clearTimeoutFn || ((id) => globalThis.clearTimeout(id));

  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let downTime = 0;
  let pointerType = 'touch';
  let movedPastThreshold = false;
  let holdCancelled = false;
  let holdActive = false;
  let holdTimer: GestureTimerHandle | null = null;

  let lastTapZone: GestureTapZone | null = null;
  let lastTapTime = -Infinity;
  let inCombo = false;
  let comboTotal = 0;
  let comboTapCount = 0;
  let singleTapTimer: GestureTimerHandle | null = null;
  let destroyed = false;

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      clearTimer(holdTimer);
      holdTimer = null;
    }
  };

  const clearSingleTapTimer = () => {
    if (singleTapTimer !== null) {
      clearTimer(singleTapTimer);
      singleTapTimer = null;
    }
  };

  const resetCombo = () => {
    lastTapZone = null;
    lastTapTime = -Infinity;
    inCombo = false;
    comboTotal = 0;
    comboTapCount = 0;
  };

  const activateHold = () => {
    clearHoldTimer();
    if (destroyed || options.disabled || activePointerId === null || holdCancelled || holdActive) {
      return;
    }
    holdActive = true;
    clearSingleTapTimer();
    resetCombo();
    options.onSpeedHoldStart?.();
  };

  const deactivateHold = (wasCancelled: boolean) => {
    clearHoldTimer();
    if (!holdActive) return;
    holdActive = false;
    options.onSpeedHoldEnd?.(wasCancelled);
  };

  const resetPointerTracking = () => {
    activePointerId = null;
    clearHoldTimer();
  };

  const registerTap = ({ zone, now = Date.now(), immediateSingleTap = false }: GestureTapInput) => {
    if (destroyed || options.disabled) return;

    const withinWindow = lastTapZone === zone && now - lastTapTime <= doubleTapWindowMs;

    if (withinWindow && (zone === 'left' || zone === 'right')) {
      clearSingleTapTimer();
      inCombo = true;
      comboTapCount = comboTapCount >= 1 ? comboTapCount + 1 : 2;
      const delta = zone === 'left' ? -seekStepSeconds : seekStepSeconds;
      comboTotal += delta;
      lastTapTime = now;
      lastTapZone = zone;
      options.onDoubleTapSeek?.(delta, comboTotal, { zone, tapCount: comboTapCount });
      return;
    }

    if (withinWindow && zone === 'center') {
      clearSingleTapTimer();
      resetCombo();
      options.onCenterDoubleTap?.();
      return;
    }

    // Fresh tap sequence (first tap or cross-zone or expired window)
    clearSingleTapTimer();
    inCombo = false;
    comboTotal = 0;
    comboTapCount = 1;
    lastTapZone = zone;
    lastTapTime = now;

    if (!options.onSingleTap) return;

    if (immediateSingleTap) {
      options.onSingleTap(zone);
      return;
    }

    singleTapTimer = setTimer(() => {
      singleTapTimer = null;
      if (!destroyed && !holdActive && !inCombo) {
        options.onSingleTap?.(zone);
      }
    }, doubleTapWindowMs);
  };

  const onPointerDown = (input: GesturePointerDownInput) => {
    if (destroyed || options.disabled) return;
    if (input.isPrimary === false) return;
    if (input.button !== undefined && input.button !== 0) return;

    // Multi-touch secondary pointer cancels hold cleanly so pinch/zoom doesn't race
    if (activePointerId !== null && activePointerId !== input.pointerId) {
      holdCancelled = true;
      deactivateHold(true);
      resetPointerTracking();
      return;
    }

    activePointerId = input.pointerId;
    startX = input.x;
    startY = input.y;
    startWidth = typeof input.width === 'number' && Number.isFinite(input.width) ? input.width : 0;
    downTime = typeof input.now === 'number' ? input.now : Date.now();
    pointerType = input.pointerType || 'touch';
    movedPastThreshold = false;
    holdCancelled = false;

    clearHoldTimer();
    if (holdDelayMs > 0) {
      holdTimer = setTimer(() => {
        holdTimer = null;
        activateHold();
      }, holdDelayMs);
    }
  };

  const onPointerMove = (input: GesturePointerMoveInput) => {
    if (destroyed || activePointerId === null || input.pointerId !== activePointerId) return;

    const dx = input.x - startX;
    const dy = input.y - startY;
    const distance = Math.hypot(dx, dy);

    if (distance > moveThresholdPx) {
      movedPastThreshold = true;
      // Moving > 10px BEFORE hold activation cancels hold immediately so vertical scroll works
      if (!holdActive && !holdCancelled) {
        holdCancelled = true;
        clearHoldTimer();
      }
    }
  };

  const onPointerUp = (input: GesturePointerUpInput) => {
    if (destroyed || activePointerId === null || input.pointerId !== activePointerId) return;

    const endX = typeof input.x === 'number' ? input.x : startX;
    const endY = typeof input.y === 'number' ? input.y : startY;
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.hypot(dx, dy);
    const width = typeof input.width === 'number' && input.width > 0 ? input.width : startWidth;
    const now = typeof input.now === 'number' ? input.now : Date.now();
    const resolvedPointerType = input.pointerType || pointerType;

    const wasHoldActive = holdActive;
    clearHoldTimer();
    activePointerId = null;

    if (wasHoldActive) {
      deactivateHold(false);
      return;
    }

    if (distance > moveThresholdPx) {
      movedPastThreshold = true;
      holdCancelled = true;

      if (
        options.enableVerticalSwipe &&
        !options.disabled &&
        Math.abs(dy) >= verticalSwipeThresholdPx &&
        Math.abs(dy) > Math.abs(dx) * VERTICAL_DOMINANCE_RATIO
      ) {
        clearSingleTapTimer();
        resetCombo();
        if (dy < 0) {
          options.onSwipeUp?.();
        } else {
          options.onSwipeDown?.();
        }
      }
      return;
    }

    if (movedPastThreshold) {
      return;
    }

    const zone = resolveGestureTapZone(endX, width, sideZoneRatio);
    registerTap({
      zone,
      now,
      immediateSingleTap: resolvedPointerType === 'mouse',
    });
  };

  const onPointerCancel = (pointerId?: number) => {
    if (pointerId !== undefined && activePointerId !== null && pointerId !== activePointerId) {
      return;
    }
    holdCancelled = true;
    deactivateHold(true);
    resetPointerTracking();
  };

  const onExternalPointerEnd = (pointerId?: number): boolean => {
    if (activePointerId === null) {
      return false;
    }
    if (pointerId !== undefined && pointerId !== activePointerId) {
      return false;
    }
    holdCancelled = true;
    deactivateHold(true);
    resetPointerTracking();
    return true;
  };

  const cancelHold = () => {
    holdCancelled = true;
    deactivateHold(true);
    resetPointerTracking();
  };

  const tick = (now: number) => {
    if (
      !destroyed &&
      !options.disabled &&
      activePointerId !== null &&
      !holdActive &&
      !holdCancelled &&
      now - downTime >= holdDelayMs
    ) {
      activateHold();
    }
  };

  const destroy = () => {
    destroyed = true;
    clearHoldTimer();
    clearSingleTapTimer();
    deactivateHold(true);
    activePointerId = null;
    resetCombo();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onExternalPointerEnd,
    hasActivePointer: () => activePointerId !== null,
    registerTap,
    tick,
    cancelHold,
    isHoldActive: () => holdActive,
    isHoldCancelled: () => holdCancelled,
    getComboTotal: () => comboTotal,
    destroy,
  };
}

/** Alias preserving specification interface naming. */
export const createGestureRecognizerState = createGestureLogic;

export interface GesturePointerEventLike {
  pointerId?: number;
  pointerType?: string;
  button?: number;
  isPrimary?: boolean;
  clientX?: number;
  clientY?: number;
  target?: unknown;
  currentTarget?: unknown;
}

export interface GestureMouseEventLike {
  clientX?: number;
  clientY?: number;
  target?: unknown;
  currentTarget?: unknown;
}

export interface UsePlayerGesturesOptions {
  playbackRate: number;
  sourceKey?: string;
  isFullscreen?: boolean;
  disabled?: boolean;
  singleTapMode?: GestureSingleTapMode;
  enableVerticalSwipe?: boolean;
  holdRate?: number;
  holdDelayMs?: number;
  moveThresholdPx?: number;
  doubleTapWindowMs?: number;
  seekStepSeconds?: number;
  feedbackDurationMs?: number;
  edgeGuardPx?: number;
  setTimeoutFn?: GestureSetTimeoutFn;
  clearTimeoutFn?: GestureClearTimeoutFn;
  onSetPlaybackRate?: (rate: number) => void;
  onSeekDelta?: (deltaSeconds: number) => void;
  onSingleTap?: (zone: GestureTapZone) => void;
  onCenterDoubleTap?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onFeedbackChange?: (feedback: PlayerGestureFeedback | null) => void;
}

export interface UsePlayerGesturesResult {
  gestureFeedback: PlayerGestureFeedback | null;
  isHold2xActive: boolean;
  prefersReducedMotion: boolean;
  surfaceStyle: { touchAction: 'pan-y' | 'none' };
  clearGestureFeedback: () => void;
  cancelActiveGestures: () => void;
  gestureHandlers: {
    onPointerDown: (e: GesturePointerEventLike) => void;
    onPointerMove: (e: GesturePointerEventLike) => void;
    onPointerUp: (e: GesturePointerEventLike) => void;
    onPointerCancel: (e: GesturePointerEventLike) => void;
    onDoubleClick: (e: GestureMouseEventLike) => void;
  };
}

function resolveRelativePointerCoords(e: { clientX?: number; clientY?: number; currentTarget?: unknown }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const clientX = typeof e.clientX === 'number' && Number.isFinite(e.clientX) ? e.clientX : 0;
  const clientY = typeof e.clientY === 'number' && Number.isFinite(e.clientY) ? e.clientY : 0;
  const el = e.currentTarget as { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } } | null;
  const rect = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;

  if (!rect) {
    return { x: clientX, y: clientY, width: 0, height: 0 };
  }
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function resolveValidRate(rate: number, fallback = 1): number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : fallback;
}

/**
 * React hook wiring pure gesture recognition to player playback controls,
 * safely saving/restoring playbackRate across React re-renders, blur, visibilitychange,
 * disabled transitions, and unmount.
 */
export function usePlayerGestures(options: UsePlayerGesturesOptions): UsePlayerGesturesResult {
  const {
    playbackRate,
    sourceKey = '',
    isFullscreen = false,
    disabled = false,
    singleTapMode = 'auto',
    enableVerticalSwipe = false,
    holdRate = 2,
    holdDelayMs = PLAYER_HOLD_2X_DELAY_MS,
    moveThresholdPx = PLAYER_HOLD_MOVE_CANCEL_PX,
    doubleTapWindowMs = PLAYER_DOUBLE_TAP_WINDOW_MS,
    seekStepSeconds = DEFAULT_SEEK_STEP_SECONDS,
    feedbackDurationMs = 750,
    edgeGuardPx = 0,
    setTimeoutFn,
    clearTimeoutFn,
  } = options;

  const [gestureFeedback, setGestureFeedback] = useState<PlayerGestureFeedback | null>(null);
  const [isHold2xActive, setIsHold2xActive] = useState<boolean>(false);

  const setTimer: GestureSetTimeoutFn = useMemo(
    () => setTimeoutFn || ((fn, ms) => globalThis.setTimeout(fn, ms)),
    [setTimeoutFn]
  );
  const clearTimer: GestureClearTimeoutFn = useMemo(
    () => clearTimeoutFn || ((id) => globalThis.clearTimeout(id)),
    [clearTimeoutFn]
  );

  const playbackRateRef = useRef<number>(resolveValidRate(playbackRate, 1));
  playbackRateRef.current = resolveValidRate(playbackRate, 1);

  const savedPriorRateRef = useRef<number | null>(null);
  const holdBoostingRef = useRef<boolean>(false);
  const lastDoubleTapHandledRef = useRef<{ zone: GestureTapZone; time: number } | null>(null);
  const feedbackTimerRef = useRef<GestureTimerHandle | null>(null);
  const windowPointerSafetyCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef<boolean>(true);

  const callbacksRef = useRef({
    onSetPlaybackRate: options.onSetPlaybackRate,
    onSeekDelta: options.onSeekDelta,
    onSingleTap: options.onSingleTap,
    onCenterDoubleTap: options.onCenterDoubleTap,
    onSwipeUp: options.onSwipeUp,
    onSwipeDown: options.onSwipeDown,
    onFeedbackChange: options.onFeedbackChange,
  });
  callbacksRef.current = {
    onSetPlaybackRate: options.onSetPlaybackRate,
    onSeekDelta: options.onSeekDelta,
    onSingleTap: options.onSingleTap,
    onCenterDoubleTap: options.onCenterDoubleTap,
    onSwipeUp: options.onSwipeUp,
    onSwipeDown: options.onSwipeDown,
    onFeedbackChange: options.onFeedbackChange,
  };

  const optionsFlagsRef = useRef({
    disabled,
    singleTapMode,
    enableVerticalSwipe,
    holdRate,
    feedbackDurationMs,
    edgeGuardPx,
  });
  optionsFlagsRef.current = {
    disabled,
    singleTapMode,
    enableVerticalSwipe,
    holdRate,
    feedbackDurationMs,
    edgeGuardPx,
  };

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      clearTimer(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, [clearTimer]);

  const emitFeedback = useCallback(
    (next: PlayerGestureFeedback | null, autoClearMs?: number) => {
      clearFeedbackTimer();
      if (mountedRef.current) {
        setGestureFeedback(next);
      }
      callbacksRef.current.onFeedbackChange?.(next);
      if (next && typeof autoClearMs === 'number' && autoClearMs > 0) {
        feedbackTimerRef.current = setTimer(() => {
          feedbackTimerRef.current = null;
          if (mountedRef.current) {
            setGestureFeedback(null);
          }
          callbacksRef.current.onFeedbackChange?.(null);
        }, autoClearMs);
      }
    },
    [clearFeedbackTimer, setTimer]
  );

  const clearGestureFeedback = useCallback(() => {
    emitFeedback(null);
  }, [emitFeedback]);

  const restoreHoldPlaybackRate = useCallback(() => {
    if (!holdBoostingRef.current) return;
    holdBoostingRef.current = false;
    const priorRate = savedPriorRateRef.current;
    savedPriorRateRef.current = null;
    if (mountedRef.current) {
      setIsHold2xActive(false);
    }
    if (priorRate !== null) {
      callbacksRef.current.onSetPlaybackRate?.(priorRate);
    }
    emitFeedback(null);
  }, [emitFeedback]);

  const machineRef = useRef<GestureLogicMachine | null>(null);
  const buildMachineRef = useRef<() => GestureLogicMachine>(() => createGestureLogic());

  buildMachineRef.current = () =>
    createGestureLogic({
      holdDelayMs,
      moveThresholdPx,
      doubleTapWindowMs,
      seekStepSeconds,
      enableVerticalSwipe,
      disabled,
      setTimeoutFn: setTimer,
      clearTimeoutFn: clearTimer,
      onSpeedHoldStart: () => {
        if (optionsFlagsRef.current.disabled) return;
        const prior = playbackRateRef.current;
        savedPriorRateRef.current = prior;
        holdBoostingRef.current = true;
        const targetRate = resolveValidRate(optionsFlagsRef.current.holdRate, 2);
        if (mountedRef.current) {
          setIsHold2xActive(true);
        }
        callbacksRef.current.onSetPlaybackRate?.(targetRate);
        emitFeedback({
          kind: 'hold2x',
          rate: targetRate,
          previousRate: prior,
          active: true,
        });
      },
      onSpeedHoldEnd: () => {
        restoreHoldPlaybackRate();
      },
      onDoubleTapSeek: (deltaSeconds, totalDeltaSeconds, meta) => {
        lastDoubleTapHandledRef.current = { zone: meta.zone, time: Date.now() };
        callbacksRef.current.onSeekDelta?.(deltaSeconds);
        emitFeedback(
          {
            kind: 'seek',
            direction: deltaSeconds < 0 ? 'back' : 'forward',
            zone: meta.zone,
            deltaSeconds,
            totalDeltaSeconds,
            tapCount: meta.tapCount,
          },
          optionsFlagsRef.current.feedbackDurationMs
        );
      },
      onCenterDoubleTap: () => {
        lastDoubleTapHandledRef.current = { zone: 'center', time: Date.now() };
        callbacksRef.current.onCenterDoubleTap?.();
      },
      onSingleTap: (zone) => {
        callbacksRef.current.onSingleTap?.(zone);
      },
      onSwipeUp: () => {
        callbacksRef.current.onSwipeUp?.();
      },
      onSwipeDown: () => {
        callbacksRef.current.onSwipeDown?.();
      },
    });

  const detachWindowPointerSafety = useCallback(() => {
    if (windowPointerSafetyCleanupRef.current) {
      windowPointerSafetyCleanupRef.current();
      windowPointerSafetyCleanupRef.current = null;
    }
  }, []);

  const cancelActiveGestures = useCallback(() => {
    detachWindowPointerSafety();
    machineRef.current?.cancelHold();
    restoreHoldPlaybackRate();
  }, [detachWindowPointerSafety, restoreHoldPlaybackRate]);

  const attachWindowPointerSafety = useCallback(() => {
    detachWindowPointerSafety();
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    const handleExternalPointerEnd = (ev: GesturePointerEventLike) => {
      const pid = typeof ev?.pointerId === 'number' ? ev.pointerId : undefined;
      const ended = machineRef.current?.onExternalPointerEnd(pid);
      if (ended) {
        restoreHoldPlaybackRate();
        detachWindowPointerSafety();
      } else if (!machineRef.current?.hasActivePointer()) {
        detachWindowPointerSafety();
      }
    };
    window.addEventListener('pointerup', handleExternalPointerEnd as EventListener);
    window.addEventListener('pointercancel', handleExternalPointerEnd as EventListener);
    windowPointerSafetyCleanupRef.current = () => {
      window.removeEventListener('pointerup', handleExternalPointerEnd as EventListener);
      window.removeEventListener('pointercancel', handleExternalPointerEnd as EventListener);
    };
  }, [detachWindowPointerSafety, restoreHoldPlaybackRate]);

  // Track true component mount state separately from config rebinds
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mount & config-change lifecycle (pure during render, StrictMode-safe)
  useEffect(() => {
    const machine = buildMachineRef.current();
    machineRef.current = machine;

    return () => {
      detachWindowPointerSafety();
      clearFeedbackTimer();
      machine.destroy();
      if (machineRef.current === machine) {
        machineRef.current = null;
      }
      restoreHoldPlaybackRate();
    };
  }, [
    holdDelayMs,
    moveThresholdPx,
    doubleTapWindowMs,
    seekStepSeconds,
    enableVerticalSwipe,
    disabled,
    setTimer,
    clearTimer,
    clearFeedbackTimer,
    detachWindowPointerSafety,
    restoreHoldPlaybackRate,
  ]);

  // Cancel active hold cleanly if sourceKey changes
  useEffect(() => {
    cancelActiveGestures();
  }, [sourceKey, cancelActiveGestures]);

  // Global safety listeners: window blur + document visibilitychange
  useEffect(() => {
    const handleBlur = () => {
      cancelActiveGestures();
    };
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        cancelActiveGestures();
      }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('blur', handleBlur);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('blur', handleBlur);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [cancelActiveGestures]);

  const onPointerDown = useCallback((e: GesturePointerEventLike) => {
    if (optionsFlagsRef.current.disabled) return;
    if (e?.isPrimary === false) return;
    if (isInteractiveGestureTarget(e?.target, e?.currentTarget)) return;

    const coords = resolveRelativePointerCoords(e);
    const guard = optionsFlagsRef.current.edgeGuardPx;
    if (guard > 0) {
      const outsideHorizontal =
        coords.width > guard * 2 && (coords.x < guard || coords.x > coords.width - guard);
      const outsideVertical =
        coords.height > guard * 2 && (coords.y < guard || coords.y > coords.height - guard);
      if (outsideHorizontal || outsideVertical) {
        return;
      }
    }

    machineRef.current?.onPointerDown({
      pointerId: typeof e.pointerId === 'number' ? e.pointerId : 1,
      x: coords.x,
      y: coords.y,
      width: coords.width,
      height: coords.height,
      pointerType: e.pointerType || 'touch',
      button: e.button,
      isPrimary: e.isPrimary,
    });
    if (machineRef.current?.hasActivePointer()) {
      attachWindowPointerSafety();
    } else {
      detachWindowPointerSafety();
    }
  }, [attachWindowPointerSafety, detachWindowPointerSafety]);

  const onPointerMove = useCallback((e: GesturePointerEventLike) => {
    const coords = resolveRelativePointerCoords(e);
    machineRef.current?.onPointerMove({
      pointerId: typeof e.pointerId === 'number' ? e.pointerId : 1,
      x: coords.x,
      y: coords.y,
    });
  }, []);

  const onPointerUp = useCallback((e: GesturePointerEventLike) => {
    if (isInteractiveGestureTarget(e?.target, e?.currentTarget)) {
      machineRef.current?.cancelHold();
      detachWindowPointerSafety();
      return;
    }
    const coords = resolveRelativePointerCoords(e);
    const mode = optionsFlagsRef.current.singleTapMode;
    const effectivePointerType =
      mode === 'delayed' ? 'touch' : mode === 'immediate' ? 'mouse' : e.pointerType || 'touch';

    machineRef.current?.onPointerUp({
      pointerId: typeof e.pointerId === 'number' ? e.pointerId : 1,
      x: coords.x,
      y: coords.y,
      width: coords.width,
      height: coords.height,
      pointerType: effectivePointerType,
    });
    if (!machineRef.current?.hasActivePointer()) {
      detachWindowPointerSafety();
    }
  }, [detachWindowPointerSafety]);

  const onPointerCancel = useCallback((e: GesturePointerEventLike) => {
    machineRef.current?.onPointerCancel(typeof e?.pointerId === 'number' ? e.pointerId : undefined);
    if (!machineRef.current?.hasActivePointer()) {
      detachWindowPointerSafety();
    }
  }, [detachWindowPointerSafety]);

  const onDoubleClick = useCallback(
    (e: GestureMouseEventLike) => {
      if (optionsFlagsRef.current.disabled) return;
      if (isInteractiveGestureTarget(e?.target, e?.currentTarget)) return;

      const coords = resolveRelativePointerCoords(e);
      const zone = resolveGestureTapZone(coords.x, coords.width);
      const lastHandled = lastDoubleTapHandledRef.current;
      if (lastHandled && lastHandled.zone === zone && Date.now() - lastHandled.time <= doubleTapWindowMs) {
        return;
      }

      if (zone === 'center') {
        callbacksRef.current.onCenterDoubleTap?.();
      } else {
        const delta = zone === 'left' ? -seekStepSeconds : seekStepSeconds;
        callbacksRef.current.onSeekDelta?.(delta);
        emitFeedback(
          {
            kind: 'seek',
            direction: delta < 0 ? 'back' : 'forward',
            zone,
            deltaSeconds: delta,
            totalDeltaSeconds: delta,
            tapCount: 2,
          },
          optionsFlagsRef.current.feedbackDurationMs
        );
      }
    },
    [doubleTapWindowMs, seekStepSeconds, emitFeedback]
  );

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    try {
      return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }, []);

  const surfaceStyle = useMemo<{ touchAction: 'pan-y' | 'none' }>(
    () => ({ touchAction: isFullscreen ? 'none' : 'pan-y' }),
    [isFullscreen]
  );

  const gestureHandlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onDoubleClick,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick]
  );

  return {
    gestureFeedback,
    isHold2xActive,
    prefersReducedMotion,
    surfaceStyle,
    clearGestureFeedback,
    cancelActiveGestures,
    gestureHandlers,
  };
}
