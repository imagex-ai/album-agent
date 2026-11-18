/**
 * usePlayerShortcuts.ts
 *
 * YouTube-style keyboard shortcuts manager for Universal Video Player.
 * - Reuses canonical mapShortcutAction from ./videoPlayerCore
 * - Arbitrates single-owner handling per Document so 10+ feed cards never fire at once
 * - Respects ./playerOverlayStack priority (suppresses shortcuts when Menu/BottomSheet/
 *   ShortcutsDialog is open above the active player, and ignores external <dialog open>)
 * - Leaves Escape solely to capture-phase playerOverlayStack dismissal
 * - Guards editable controls & [role="slider"] arrows; calls preventDefault() ONLY when handled
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import {
  mapShortcutAction,
  type KeyboardEventSnapshot,
  type PlayerShortcutAction,
} from './videoPlayerCore';
import {
  PLAYER_OVERLAY_LAYER_ATTR,
  PLAYER_OVERLAY_PRIORITY,
  hasActivePlayerOverlayAbove,
  type OverlayDocumentLike,
} from './playerOverlayStack';

export const PLAYBACK_SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_FRAME_DURATION_SECONDS = 1 / 30;
const DEFAULT_VOLUME_STEP = 0.05;

export interface PlayerShortcutActions {
  togglePlay?: () => void;
  play?: () => void;
  pause?: () => void;
  skipBy?: (deltaSeconds: number) => void;
  seekTo?: (seconds: number) => void;
  setVolume?: (volume: number) => void;
  adjustVolume?: (delta: number) => void;
  toggleMute?: () => void;
  toggleFullscreen?: () => void;
  toggleTheater?: () => void;
  toggleFillMode?: () => void;
  toggleMiniPlayer?: () => void;
  toggleShortcutsHelp?: () => void;
  setPlaybackRate?: (rate: number) => void;
  stepFrame?: (direction: -1 | 1) => void;
}

export interface ExecuteShortcutContext {
  duration?: number;
  currentTime?: number;
  volume?: number;
  playbackRate?: number;
  volumeStep?: number;
  frameDurationSeconds?: number;
  actions: PlayerShortcutActions;
}

export interface UsePlayerShortcutsOptions extends ExecuteShortcutContext {
  id?: string;
  enabled?: boolean;
  isActive?: boolean;
  isFullscreen?: boolean;
  priority?: number;
  scope?: 'global' | 'focused';
  containerRef?: RefObject<HTMLElement | null>;
  doc?: OverlayDocumentLike | null;
  onShortcutAction?: (action: PlayerShortcutAction) => void;
}

export interface UsePlayerShortcutsResult {
  activateShortcutOwner: () => void;
}

interface RegisteredShortcutEntry {
  id: string;
  seq: number;
  lastInteractedAt: number;
  enabled: boolean;
  isActive: boolean;
  effectivePriority: number;
  scope: 'global' | 'focused';
  containerRef?: RefObject<HTMLElement | null>;
  latestOptionsRef: RefObject<UsePlayerShortcutsOptions>;
}

interface DocumentShortcutRegistry {
  entries: RegisteredShortcutEntry[];
  listener: ((event: any) => void) | null;
  seqCounter: number;
}

const documentRegistries = new WeakMap<object, DocumentShortcutRegistry>();
let fallbackOwnerCounter = 0;
let nextShortcutActivationSeq = 0;

const IDEMPOTENT_TOGGLE_ACTIONS = new Set<PlayerShortcutAction>([
  'toggle_play',
  'toggle_mute',
  'toggle_fullscreen',
  'toggle_theater',
  'toggle_fill_mode',
  'toggle_mini_player',
  'toggle_shortcuts_help',
]);

function resolveDoc(doc?: OverlayDocumentLike | null): OverlayDocumentLike | null {
  if (doc === null) return null;
  if (doc !== undefined) return doc;
  if (typeof document !== 'undefined') return document as unknown as OverlayDocumentLike;
  return null;
}

function clamp01(val: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 1;
  return Math.min(1, Math.max(0, Math.round(val * 100) / 100));
}

/**
 * Steps playbackRate cleanly along PLAYBACK_SPEED_STEPS (-1 = slower, +1 = faster).
 */
export function stepPlaybackRate(currentRate: number, direction: -1 | 1): number {
  const safeRate =
    typeof currentRate === 'number' && Number.isFinite(currentRate) && currentRate > 0 ? currentRate : 1;

  let nearestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < PLAYBACK_SPEED_STEPS.length; i += 1) {
    const diff = Math.abs(PLAYBACK_SPEED_STEPS[i] - safeRate);
    if (diff < minDiff) {
      minDiff = diff;
      nearestIdx = i;
    }
  }
  const nextIdx = Math.min(PLAYBACK_SPEED_STEPS.length - 1, Math.max(0, nearestIdx + direction));
  return PLAYBACK_SPEED_STEPS[nextIdx];
}

function readAttr(node: unknown, name: string): string | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as { getAttribute?: (k: string) => string | null; hasAttribute?: (k: string) => boolean };
  if (typeof el.getAttribute === 'function') return el.getAttribute(name);
  if (typeof el.hasAttribute === 'function' && el.hasAttribute(name)) return '';
  return null;
}

function isEditableOrSliderTarget(target: unknown, key: string): boolean {
  let current: unknown = target;
  let guard = 0;
  const isArrowOrNavKey =
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown';
  const isSpaceKey = key === ' ' || key === 'Space' || key === 'Spacebar';

  while (current && typeof current === 'object' && guard < 32) {
    guard += 1;
    const node = current as {
      tagName?: string;
      isContentEditable?: boolean;
      parentElement?: unknown;
      parentNode?: unknown;
    };

    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true;
    }
    if (isSpaceKey && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) {
      return true;
    }

    if (node.isContentEditable) {
      return true;
    }
    const rawContentEditable = readAttr(node, 'contenteditable');
    if (rawContentEditable !== null) {
      const contentEditable = rawContentEditable.toLowerCase();
      if (contentEditable === '' || contentEditable === 'true' || contentEditable === 'plaintext-only') {
        return true;
      }
    }

    const role = (readAttr(node, 'role') || '').toLowerCase();
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      return true;
    }
    if (role === 'slider' && isArrowOrNavKey) {
      return true;
    }
    if (
      isSpaceKey &&
      (role === 'button' ||
        role === 'menuitem' ||
        role === 'menuitemradio' ||
        role === 'menuitemcheckbox' ||
        role === 'switch' ||
        role === 'tab' ||
        role === 'checkbox' ||
        role === 'radio' ||
        role === 'option')
    ) {
      return true;
    }

    current = node.parentElement ?? node.parentNode ?? null;
  }

  return false;
}

function isExternalDialogOpen(doc: OverlayDocumentLike): boolean {
  if (typeof doc.querySelectorAll === 'function') {
    try {
      const openDialogs = Array.from(doc.querySelectorAll('dialog[open]') || []);
      if (openDialogs.length === 0) return false;
      const topmost = openDialogs[openDialogs.length - 1] as { hasAttribute?: (k: string) => boolean };
      if (typeof topmost?.hasAttribute === 'function' && topmost.hasAttribute(PLAYER_OVERLAY_LAYER_ATTR)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  if (typeof doc.querySelector === 'function') {
    try {
      return Boolean(doc.querySelector(`dialog[open]:not([${PLAYER_OVERLAY_LAYER_ATTR}])`));
    } catch {
      return false;
    }
  }
  return false;
}

function isTargetInsideElement(container: unknown, target: unknown): boolean {
  if (!container || !target || typeof container !== 'object') return false;
  const el = container as { contains?: (t: unknown) => boolean };
  if (typeof el.contains === 'function') {
    try {
      return el.contains(target);
    } catch {
      return false;
    }
  }
  let cur: unknown = target;
  let guard = 0;
  while (cur && typeof cur === 'object' && guard < 32) {
    guard += 1;
    if (cur === container) return true;
    cur = (cur as { parentElement?: unknown; parentNode?: unknown }).parentElement ??
      (cur as { parentNode?: unknown }).parentNode ??
      null;
  }
  return false;
}

/**
 * Executes a mapped PlayerShortcutAction against a player's action callbacks.
 */
export function executePlayerShortcutAction(
  action: PlayerShortcutAction,
  ctx: ExecuteShortcutContext
): boolean {
  const { actions } = ctx;
  if (!actions) return false;

  const duration = typeof ctx.duration === 'number' && Number.isFinite(ctx.duration) ? ctx.duration : 0;
  const currentTime = typeof ctx.currentTime === 'number' && Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0;
  const volume = typeof ctx.volume === 'number' && Number.isFinite(ctx.volume) ? ctx.volume : 1;
  const playbackRate = typeof ctx.playbackRate === 'number' && Number.isFinite(ctx.playbackRate) ? ctx.playbackRate : 1;
  const volumeStep =
    typeof ctx.volumeStep === 'number' && Number.isFinite(ctx.volumeStep) && ctx.volumeStep > 0
      ? ctx.volumeStep
      : DEFAULT_VOLUME_STEP;
  const frameDuration =
    typeof ctx.frameDurationSeconds === 'number' &&
    Number.isFinite(ctx.frameDurationSeconds) &&
    ctx.frameDurationSeconds > 0
      ? ctx.frameDurationSeconds
      : DEFAULT_FRAME_DURATION_SECONDS;

  const skip = (delta: number): boolean => {
    if (actions.skipBy) {
      actions.skipBy(delta);
      return true;
    }
    if (actions.seekTo) {
      const nextTime = duration > 0 ? Math.min(duration, Math.max(0, currentTime + delta)) : Math.max(0, currentTime + delta);
      actions.seekTo(nextTime);
      return true;
    }
    return false;
  };

  const invokeSimple = (fn?: () => void): boolean => {
    if (!fn) return false;
    fn();
    return true;
  };

  switch (action) {
    case 'toggle_play':
      return invokeSimple(actions.togglePlay);
    case 'seek_back_10':
      return skip(-10);
    case 'seek_forward_10':
      return skip(10);
    case 'seek_back_5':
      return skip(-5);
    case 'seek_forward_5':
      return skip(5);
    case 'volume_up':
      if (actions.adjustVolume) {
        actions.adjustVolume(volumeStep);
        return true;
      }
      if (actions.setVolume) {
        actions.setVolume(clamp01(volume + volumeStep));
        return true;
      }
      return false;
    case 'volume_down':
      if (actions.adjustVolume) {
        actions.adjustVolume(-volumeStep);
        return true;
      }
      if (actions.setVolume) {
        actions.setVolume(clamp01(volume - volumeStep));
        return true;
      }
      return false;
    case 'toggle_mute':
      return invokeSimple(actions.toggleMute);
    case 'toggle_fullscreen':
      return invokeSimple(actions.toggleFullscreen);
    case 'toggle_theater':
      return invokeSimple(actions.toggleTheater);
    case 'toggle_fill_mode':
      return invokeSimple(actions.toggleFillMode);
    case 'toggle_mini_player':
      return invokeSimple(actions.toggleMiniPlayer);
    case 'toggle_shortcuts_help':
      return invokeSimple(actions.toggleShortcutsHelp);
    case 'frame_back':
      if (actions.stepFrame) {
        actions.stepFrame(-1);
        return true;
      }
      if (!actions.skipBy && !actions.seekTo) return false;
      actions.pause?.();
      return skip(-frameDuration);
    case 'frame_forward':
      if (actions.stepFrame) {
        actions.stepFrame(1);
        return true;
      }
      if (!actions.skipBy && !actions.seekTo) return false;
      actions.pause?.();
      return skip(frameDuration);
    case 'decrease_speed':
      if (!actions.setPlaybackRate) return false;
      actions.setPlaybackRate(stepPlaybackRate(playbackRate, -1));
      return true;
    case 'increase_speed':
      if (!actions.setPlaybackRate) return false;
      actions.setPlaybackRate(stepPlaybackRate(playbackRate, 1));
      return true;
    case 'seek_percent_0':
    case 'seek_percent_10':
    case 'seek_percent_20':
    case 'seek_percent_30':
    case 'seek_percent_40':
    case 'seek_percent_50':
    case 'seek_percent_60':
    case 'seek_percent_70':
    case 'seek_percent_80':
    case 'seek_percent_90': {
      const pct = Number(action.slice('seek_percent_'.length));
      if (!actions.seekTo || duration <= 0 || !Number.isFinite(pct)) {
        return false;
      }
      actions.seekTo((duration * pct) / 100);
      return true;
    }
    default:
      return false;
  }
}

function pickWinningEntry(
  entries: RegisteredShortcutEntry[],
  target: unknown,
  doc: OverlayDocumentLike
): RegisteredShortcutEntry | null {
  const enabledEntries = entries.filter(
    (entry) => entry.enabled && !hasActivePlayerOverlayAbove(entry.effectivePriority, doc)
  );
  if (enabledEntries.length === 0) return null;

  // 1. Prefer player whose container physically holds focus/target
  const focusedMatches = enabledEntries.filter((entry) =>
    isTargetInsideElement(entry.containerRef?.current, target)
  );
  const pool =
    focusedMatches.length > 0
      ? focusedMatches
      : enabledEntries.filter((entry) => entry.isActive && entry.scope !== 'focused');

  if (pool.length === 0) return null;

  let winner = pool[0];
  for (let i = 1; i < pool.length; i += 1) {
    const candidate = pool[i];
    if (
      candidate.effectivePriority > winner.effectivePriority ||
      (candidate.effectivePriority === winner.effectivePriority &&
        (candidate.lastInteractedAt > winner.lastInteractedAt ||
          (candidate.lastInteractedAt === winner.lastInteractedAt && candidate.seq > winner.seq)))
    ) {
      winner = candidate;
    }
  }
  return winner;
}

function createDocumentKeydownHandler(
  registry: DocumentShortcutRegistry,
  doc: OverlayDocumentLike
): (event: any) => void {
  return function handlePlayerShortcutKeydown(event: any) {
    if (!event || event.defaultPrevented) return;
    if (event.key === 'Escape' || event.key === 'Esc') return;
    if (isEditableOrSliderTarget(event.target, event.key)) return;
    if (isExternalDialogOpen(doc)) return;

    const targetNode = event.target as { tagName?: string; isContentEditable?: boolean } | null;
    const snapshot: KeyboardEventSnapshot = {
      key: event.key,
      tagName: targetNode?.tagName,
      isContentEditable: Boolean(targetNode?.isContentEditable),
      shiftKey: Boolean(event.shiftKey),
      ctrlKey: Boolean(event.ctrlKey),
      metaKey: Boolean(event.metaKey),
      altKey: Boolean(event.altKey),
    };

    const action = mapShortcutAction(snapshot);
    if (!action) return;

    const winner = pickWinningEntry(registry.entries, event.target, doc);
    if (!winner || !winner.latestOptionsRef.current) return;

    const opts = winner.latestOptionsRef.current;
    if (event.repeat && IDEMPOTENT_TOGGLE_ACTIONS.has(action)) {
      // Keep native scroll prevented when Spacebar is held while avoiding repeated play/pause flicker
      if (
        action === 'toggle_play' &&
        (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Space') &&
        opts.actions?.togglePlay &&
        typeof event.preventDefault === 'function'
      ) {
        event.preventDefault();
      }
      return;
    }

    const handled = executePlayerShortcutAction(action, opts);
    if (!handled) return;

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    opts.onShortcutAction?.(action);
  };
}

function removeEntryFromRegistry(
  entry: RegisteredShortcutEntry,
  registry: DocumentShortcutRegistry,
  doc: OverlayDocumentLike
) {
  const idx = registry.entries.indexOf(entry);
  if (idx !== -1) {
    registry.entries.splice(idx, 1);
  }
  if (registry.entries.length === 0 && registry.listener) {
    try {
      doc.removeEventListener('keydown', registry.listener);
    } catch {
      // Safe cleanup
    }
    registry.listener = null;
  }
}

/**
 * React hook binding YouTube-style keyboard shortcuts to a single winning player owner
 * per Document, respecting overlay stack priority and form/slider focus boundaries.
 */
export function usePlayerShortcuts(options: UsePlayerShortcutsOptions): UsePlayerShortcutsResult {
  const {
    id,
    enabled = true,
    isActive = true,
    isFullscreen = false,
    priority = 0,
    scope = 'global',
    containerRef,
    doc,
  } = options;

  const latestOptionsRef = useRef<UsePlayerShortcutsOptions>(options);
  latestOptionsRef.current = options;

  const stableIdRef = useRef<string>(id || `player-shortcuts-${++fallbackOwnerCounter}`);
  if (id) {
    stableIdRef.current = id;
  }

  const effectivePriority = Math.max(
    typeof priority === 'number' && Number.isFinite(priority) ? priority : 0,
    isFullscreen ? PLAYER_OVERLAY_PRIORITY.FULLSCREEN : 0
  );

  const entryRef = useRef<RegisteredShortcutEntry | null>(null);

  const activateShortcutOwner = useCallback(() => {
    if (entryRef.current) {
      entryRef.current.lastInteractedAt = ++nextShortcutActivationSeq;
    }
  }, []);

  useEffect(() => {
    const resolvedDoc = resolveDoc(doc);
    if (!resolvedDoc) return undefined;

    let registry = documentRegistries.get(resolvedDoc as object);
    if (!registry) {
      registry = { entries: [], listener: null, seqCounter: 0 };
      documentRegistries.set(resolvedDoc as object, registry);
    }

    registry.seqCounter += 1;
    const entry: RegisteredShortcutEntry = {
      id: stableIdRef.current,
      seq: registry.seqCounter,
      lastInteractedAt: isActive ? ++nextShortcutActivationSeq : 0,
      enabled,
      isActive,
      effectivePriority,
      scope,
      containerRef,
      latestOptionsRef,
    };
    entryRef.current = entry;
    registry.entries.push(entry);

    if (!registry.listener) {
      const listener = createDocumentKeydownHandler(registry, resolvedDoc);
      resolvedDoc.addEventListener('keydown', listener);
      registry.listener = listener;
    }

    return () => {
      if (entryRef.current === entry) {
        entryRef.current = null;
      }
      removeEntryFromRegistry(entry, registry!, resolvedDoc);
    };
  }, [doc]);

  // Synchronize mutable flags in-place without churning document listener registration
  useEffect(() => {
    const entry = entryRef.current;
    if (!entry) return;
    const becameActive = !entry.isActive && isActive;
    entry.id = stableIdRef.current;
    entry.enabled = enabled;
    entry.isActive = isActive;
    entry.effectivePriority = effectivePriority;
    entry.scope = scope;
    entry.containerRef = containerRef;
    if (becameActive) {
      entry.lastInteractedAt = ++nextShortcutActivationSeq;
    }
  }, [enabled, isActive, effectivePriority, scope, containerRef]);

  return {
    activateShortcutOwner,
  };
}
