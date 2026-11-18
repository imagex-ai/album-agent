/**
 * playerMotion.ts
 *
 * Motion Engine & Web Platform Transition Manager for IMAGEX.AI Universal Video Player.
 * - Discrete display exit transitions avoiding Firefox Bug 1882408 via [data-closing="true"]
 *   and settled animation promises + 2000ms failsafe timeout
 * - Safe document.startViewTransition wrapper assigning & clearing transient view-transition-name
 *   with focus preservation ({ preventScroll: true })
 * - Integrates motionConfig.ts settings respecting disableAllAnimations and prefers-reduced-motion
 */

import {
  getVideoPlayerAnimationClass,
  getFullscreenAnimationClass,
  getSpeedClass,
  getSpeedMs,
} from '../../../services/motionConfig';
import type { AppSettings } from '../../../types';

export interface ResolvedPlayerMotionClasses {
  playerAnimationClass: string;
  fullscreenAnimationClass: string;
  speedClass: string;
  speedMs: number;
}

export interface CloseWithExitTransitionOptions {
  timeoutMs?: number;
  prefersReducedMotion?: boolean;
  disableAllAnimations?: boolean;
}

export interface ElementWithAnimations {
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
  getAnimations?: () => Array<{ finished: Promise<unknown> }>;
}

export interface RunViewTransitionOptions {
  element?: HTMLElement | { style?: { viewTransitionName?: string } } | null;
  transitionName?: string;
  focusTarget?: HTMLElement | { focus?: (options?: FocusOptions) => void } | null;
  prefersReducedMotion?: boolean;
  disableAllAnimations?: boolean;
  onDone?: () => void;
}

export interface RunViewTransitionResult {
  transitionRan: boolean;
  transition?: unknown;
}

/**
 * Returns true if the browser supports discrete display transitions (allow-discrete).
 */
export function canTransitionDisplay(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return false;
  }
  try {
    return CSS.supports('transition-behavior', 'allow-discrete');
  } catch {
    return false;
  }
}

/**
 * Checks if the user environment requests reduced motion.
 */
export function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Resolves animation classes and speed from application motion settings,
 * returning 'animate-photo-none' and 0ms when disableAllAnimations is active.
 */
export function resolvePlayerMotionClasses(
  settings?: Partial<AppSettings> | null
): ResolvedPlayerMotionClasses {
  if (settings?.disableAllAnimations) {
    return {
      playerAnimationClass: 'animate-photo-none',
      fullscreenAnimationClass: 'animate-photo-none',
      speedClass: 'anim-speed-normal',
      speedMs: 0,
    };
  }

  return {
    playerAnimationClass: getVideoPlayerAnimationClass(settings?.videoPlayerAnimation, false),
    fullscreenAnimationClass: getFullscreenAnimationClass(settings?.fullscreenAnimation, false),
    speedClass: getSpeedClass(settings?.animationSpeed),
    speedMs: getSpeedMs(settings?.animationSpeed),
  };
}

/**
 * Safely closes an overlay or dialog element with CSS exit transitions:
 * 1. Skips immediately to onDone() if reduced motion or animations are disabled
 * 2. Sets [data-closing="true"] to trigger CSS exit keyframes / transitions
 * 3. Awaits all active element.getAnimations() .finished promises
 * 4. Cleans up [data-closing] and calls onDone()
 * 5. Guarantees completion within timeoutMs (default 2000ms) even if animations stall
 */
export function closeWithExitTransition(
  el: ElementWithAnimations | null | undefined,
  triggerClose?: () => void,
  onDone?: () => void,
  options?: CloseWithExitTransitionOptions | number
): Promise<void> {
  const timeoutMs =
    typeof options === 'number'
      ? options
      : typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : 2000;

  const reducedMotion =
    typeof options === 'object' && options?.prefersReducedMotion !== undefined
      ? options.prefersReducedMotion
      : isReducedMotionPreferred();

  const disabledAnimations =
    typeof options === 'object' && Boolean(options?.disableAllAnimations);

  if (reducedMotion || disabledAnimations || !el || typeof el.getAnimations !== 'function') {
    triggerClose?.();
    onDone?.();
    return Promise.resolve();
  }

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<void>((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        el.removeAttribute?.('data-closing');
      } catch {
        // Safe fallback
      }
      try {
        onDone?.();
      } finally {
        resolve();
      }
    };

    try {
      el.setAttribute?.('data-closing', 'true');
    } catch {
      // Safe fallback
    }

    try {
      triggerClose?.();
    } catch {
      // Safe fallback
    }

    timer = setTimeout(finish, timeoutMs);

    let animations: Promise<unknown>[] = [];
    try {
      const active = el.getAnimations?.() || [];
      animations = active.map((anim) => anim.finished);
    } catch {
      animations = [];
    }

    if (animations.length === 0) {
      finish();
      return;
    }

    Promise.allSettled(animations).then(finish).catch(finish);
  });
}

/**
 * Safely executes document.startViewTransition with fallback and error guards:
 * - Directly executes mutateDom when unsupported, disabled, or under prefers-reduced-motion
 * - Assigns transient view-transition-name before transition and removes it in finished.finally
 * - Catches .ready rejections gracefully
 * - Shifts focus to focusTarget with { preventScroll: true }
 */
export async function runViewTransitionSafe(
  mutateDom: () => void | Promise<void>,
  options?: RunViewTransitionOptions
): Promise<RunViewTransitionResult> {
  const reducedMotion =
    options?.prefersReducedMotion !== undefined
      ? options.prefersReducedMotion
      : isReducedMotionPreferred();

  const disabled = Boolean(options?.disableAllAnimations || reducedMotion);

  const doc = typeof document !== 'undefined' ? (document as unknown as { startViewTransition?: (cb: () => void | Promise<void>) => any }) : null;
  const supportsViewTransition = Boolean(doc && typeof doc.startViewTransition === 'function');

  if (disabled || !supportsViewTransition || !doc?.startViewTransition) {
    await mutateDom();
    if (options?.focusTarget && typeof (options.focusTarget as any).focus === 'function') {
      try {
        (options.focusTarget as any).focus({ preventScroll: true });
      } catch {
        // Safe fallback
      }
    }
    options?.onDone?.();
    return { transitionRan: false };
  }

  if (options?.element && options?.transitionName && (options.element as any).style) {
    try {
      (options.element as any).style.viewTransitionName = options.transitionName;
    } catch {
      // Safe fallback
    }
  }

  let transition: any;
  try {
    transition = doc.startViewTransition(async () => {
      await mutateDom();
    });
  } catch {
    await mutateDom();
    options?.onDone?.();
    return { transitionRan: false };
  }

  if (transition?.ready && typeof transition.ready.catch === 'function') {
    transition.ready.catch(() => {});
  }

  const cleanup = () => {
    if (options?.element && (options.element as any).style) {
      try {
        (options.element as any).style.viewTransitionName = '';
      } catch {
        // Safe fallback
      }
    }
    if (options?.focusTarget && typeof (options.focusTarget as any).focus === 'function') {
      try {
        (options.focusTarget as any).focus({ preventScroll: true });
      } catch {
        // Safe fallback
      }
    }
    options?.onDone?.();
  };

  if (transition?.finished && typeof transition.finished.finally === 'function') {
    try {
      await transition.finished.finally(cleanup);
    } catch {
      cleanup();
    }
  } else {
    cleanup();
  }

  return { transitionRan: true, transition };
}
