/**
 * Universal Video Player Core Logic & Mini-Player Geometry
 *
 * Pure TypeScript functions, constants, geometry calculations, and types
 * governing all video player instances across IMAGEX.AI.
 *
 * Governed by docs/video-player-architecture.md & docs/superpowers/specs/2026-11-14-universal-video-player-design.md
 */

import {
  isHlsStreamUrl,
  classifyPlayError,
  pickFallbackStreamCandidate,
  type TimelineVideoQuality,
  type PlayErrorAction,
  type StreamFallbackCandidate,
} from '../../profile-hub/timeline/timelineModel';

// Re-export stream helpers and conventions from timelineModel
export {
  isHlsStreamUrl,
  classifyPlayError,
  pickFallbackStreamCandidate,
};
export type {
  TimelineVideoQuality,
  PlayErrorAction,
  StreamFallbackCandidate,
};

// --- Canonical Player Constants ---
export const EDGE_STASH_THRESHOLD_PX = 28;
export const PLAYER_HIDE_TIMEOUT_MS = 2500;
export const PLAYER_STARTUP_TIMEOUT_MS = 20000;
export const PLAYER_HOLD_2X_DELAY_MS = 350;
export const PLAYER_HOLD_MOVE_CANCEL_PX = 10;
export const PLAYER_DOUBLE_TAP_WINDOW_MS = 450;

// --- Density Modes ---
export type UniversalPlayerDensity = 'compact' | 'card' | 'cinema' | 'mini';

// --- Stream & Source Types ---
export interface StreamQualityCandidate {
  height?: number;
  label: string;
  streamUrl: string;
  bitrate?: number;
  format_id?: string;
  ext?: string;
}

export interface UniversalVideoSource {
  id: string;
  /** Explicit library identity; never infer this from a foreign post/album ID. */
  highlightVideoId?: string;
  highlights?: import('./playerHighlights').PlayerHighlight[];
  highlightStart?: number;
  highlightEnd?: number;
  title?: string;
  streamUrl?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  posterUrl?: string;
  duration?: number | string;
  sourceType?: 'timeline' | 'modal' | 'library' | 'album' | 'scraper' | 'trash' | 'generic' | string;
  sourceUrl?: string;
  durationSec?: number;
  creatorName?: string;
  creatorAvatar?: string;
  creatorHandle?: string;
  qualities?: StreamQualityCandidate[];
  masterHlsUrl?: string;
  previewVideoUrl?: string;
  returnRoute?: {
    view?: string;
    watchSessionKey?: string;
    albumId?: string;
    videoId?: string;
    [key: string]: unknown;
  };
  rawPost?: unknown;
  [key: string]: unknown;
}

export interface PlaybackHandoffSnapshot {
  currentTime: number;
  isPlaying: boolean;
  isMuted?: boolean;
  volume?: number;
  playbackRate?: number;
  selectedQuality?: number | 'auto';
  qualities?: StreamQualityCandidate[];
  masterHlsUrl?: string;
  sourceRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  [key: string]: unknown;
}

// --- Keyboard & Shortcuts ---
export type PlayerShortcutAction =
  | 'toggle_play'
  | 'seek_back_10'
  | 'seek_forward_10'
  | 'seek_back_5'
  | 'seek_forward_5'
  | 'volume_up'
  | 'volume_down'
  | 'toggle_mute'
  | 'toggle_fullscreen'
  | 'toggle_theater'
  | 'toggle_fill_mode'
  | 'toggle_mini_player'
  | 'toggle_shortcuts_help'
  | 'frame_back'
  | 'frame_forward'
  | 'decrease_speed'
  | 'increase_speed'
  | 'seek_percent_0'
  | 'seek_percent_10'
  | 'seek_percent_20'
  | 'seek_percent_30'
  | 'seek_percent_40'
  | 'seek_percent_50'
  | 'seek_percent_60'
  | 'seek_percent_70'
  | 'seek_percent_80'
  | 'seek_percent_90';

export interface KeyboardEventSnapshot {
  key: string;
  tagName?: string;
  isContentEditable?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

// --- PiP Capabilities ---
export interface PipEnvSnapshot {
  hasDocumentPip?: boolean;
  hasRequestPip?: boolean;
  hasWebkitPresentationMode?: boolean;
  hasMediaSession?: boolean;
  hasAutoPipAction?: boolean;
  isSecureContext?: boolean;
}

export interface PipCapabilities {
  documentPip: boolean;
  elementPip: boolean;
  webkitPresentationPip: boolean;
  autoPipAction: boolean;
}

// --- Geometry Coordinates ---
export interface PlayerRectPosition {
  x: number;
  y: number;
}

export interface PlayerRectSize {
  width: number;
  height: number;
}

export interface PlayerViewportSize {
  width: number;
  height: number;
}

/**
 * Formats a playback time in seconds into an accessible clock string.
 * Clamps negative/NaN/infinite inputs safely to '00:00'.
 * Uses 'H:MM:SS' when >= 3600 seconds, 'MM:SS' otherwise.
 */
export function formatPlayerClock(seconds: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const paddedMins = mins.toString().padStart(2, '0');
  const paddedSecs = secs.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }
  return `${paddedMins}:${paddedSecs}`;
}

/**
 * Formats a numeric video quality height in pixels into a consistent display label.
 * Returns 'Auto' for missing or non-positive values.
 */
export function formatQualityLabel(height?: number | null): string {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return 'Auto';
  }
  const rounded = Math.round(height);
  if (rounded >= 2160) return '4K 2160p';
  if (rounded >= 1440) return '2K 1440p';
  if (rounded >= 720) return `${rounded}p HD`;
  return `${rounded}p`;
}

/**
 * Clamps seek target cleanly between 0 and duration.
 * Guards against negative, NaN, or non-finite inputs.
 */
export function clampSeekTime(targetSeconds: number, durationSeconds: number): number {
  const safeDuration =
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0;
  if (typeof targetSeconds !== 'number' || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    return 0;
  }
  if (targetSeconds >= safeDuration) {
    return safeDuration;
  }
  return targetSeconds;
}

/**
 * Normalizes stream URLs for safe comparison across relative vs absolute origins.
 * Strips same-origin host and redundant trailing slashes without altering
 * query tokens, signatures, or hash identifiers.
 */
export function normalizeComparableStreamUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    const parsed = new URL(trimmed, base);
    const isSameOrigin =
      (typeof window !== 'undefined' && window.location?.origin && parsed.origin === window.location.origin) ||
      parsed.origin === 'http://localhost' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1';

    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
    const search = parsed.search || '';
    const hash = parsed.hash || '';

    if (isSameOrigin) {
      return `${cleanPath}${search}${hash}`;
    }
    return `${parsed.origin.toLowerCase()}${cleanPath}${search}${hash}`;
  } catch {
    return trimmed;
  }
}

/**
 * Resolves player density mode key. Extremely narrow containers (< 280px)
 * degrade 'cinema' density into 'compact' to prevent control collision.
 */
export function resolvePlayerDensityKey(
  containerWidthPx: number,
  preferredDensity: UniversalPlayerDensity = 'compact'
): UniversalPlayerDensity {
  if (preferredDensity === 'mini') {
    return 'mini';
  }
  const width =
    typeof containerWidthPx === 'number' && Number.isFinite(containerWidthPx) ? containerWidthPx : 0;
  if (width > 0 && width < 280 && preferredDensity === 'cinema') {
    return 'compact';
  }
  return preferredDensity || 'compact';
}

/**
 * Maps keyboard events to YouTube-style playback actions.
 * Ignores typing in form inputs (INPUT, TEXTAREA, SELECT, contentEditable),
 * rejects modifier key combinations (Ctrl, Alt, Meta), and handles Shift
 * exclusively for '?' (shortcuts dialog) and '<'/'>' (speed stepping).
 */
export function mapShortcutAction(event: KeyboardEventSnapshot): PlayerShortcutAction | null {
  if (!event || typeof event !== 'object') return null;

  // 1. Guard against typing targets
  if (event.isContentEditable) return null;
  const tag = String(event.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;

  // 2. Reject control / meta / alt modifier combinations
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const key = event.key;
  if (!key) return null;

  // 3. Handle shift-modified keys: only ? and </>, all others blocked
  if (event.shiftKey) {
    if (key === '?' || key === '/') return 'toggle_shortcuts_help';
    if (key === '<' || key === ',') return 'decrease_speed';
    if (key === '>' || key === '.') return 'increase_speed';
    return null;
  }

  // 4. Handle standard unmodified shortcuts
  if (key === ' ' || key === 'Space' || key === 'Spacebar' || key === 'k' || key === 'K') {
    return 'toggle_play';
  }
  if (key === 'j' || key === 'J') return 'seek_back_10';
  if (key === 'l' || key === 'L') return 'seek_forward_10';
  if (key === 'ArrowLeft') return 'seek_back_5';
  if (key === 'ArrowRight') return 'seek_forward_5';
  if (key === 'ArrowUp') return 'volume_up';
  if (key === 'ArrowDown') return 'volume_down';
  if (key === 'm' || key === 'M') return 'toggle_mute';
  if (key === 'f' || key === 'F') return 'toggle_fullscreen';
  if (key === 't' || key === 'T') return 'toggle_theater';
  if (key === 'p' || key === 'P') return 'toggle_fill_mode';
  if (key === 'i' || key === 'I') return 'toggle_mini_player';
  if (key === '?') return 'toggle_shortcuts_help';
  if (key === ',') return 'frame_back';
  if (key === '.') return 'frame_forward';
  if (key === '<') return 'decrease_speed';
  if (key === '>') return 'increase_speed';

  // 5. Number keys (0-9) seek by 10% fractions
  if (key >= '0' && key <= '9') {
    switch (key) {
      case '0': return 'seek_percent_0';
      case '1': return 'seek_percent_10';
      case '2': return 'seek_percent_20';
      case '3': return 'seek_percent_30';
      case '4': return 'seek_percent_40';
      case '5': return 'seek_percent_50';
      case '6': return 'seek_percent_60';
      case '7': return 'seek_percent_70';
      case '8': return 'seek_percent_80';
      case '9': return 'seek_percent_90';
    }
  }

  return null;
}

/**
 * Clamps floating mini-player coordinates inside the viewport boundaries,
 * clearing the safe-bottom clearance (e.g. MiniTaskDock height).
 */
export function clampMiniPlayerRect(
  pos: PlayerRectPosition,
  size: PlayerRectSize,
  viewport: PlayerViewportSize,
  safeBottomPx = 0
): PlayerRectPosition {
  const safeX = typeof pos?.x === 'number' && Number.isFinite(pos.x) ? pos.x : 0;
  const safeY = typeof pos?.y === 'number' && Number.isFinite(pos.y) ? pos.y : 0;
  const width =
    typeof size?.width === 'number' && Number.isFinite(size.width) && size.width > 0 ? size.width : 0;
  const height =
    typeof size?.height === 'number' && Number.isFinite(size.height) && size.height > 0 ? size.height : 0;
  const vpWidth =
    typeof viewport?.width === 'number' && Number.isFinite(viewport.width) && viewport.width > 0
      ? viewport.width
      : 0;
  const vpHeight =
    typeof viewport?.height === 'number' && Number.isFinite(viewport.height) && viewport.height > 0
      ? viewport.height
      : 0;
  const safeBottom =
    typeof safeBottomPx === 'number' && Number.isFinite(safeBottomPx) && safeBottomPx > 0
      ? safeBottomPx
      : 0;

  const maxX = Math.max(0, vpWidth - width);
  const clampedX = Math.min(Math.max(0, safeX), maxX);

  const maxY = Math.max(0, vpHeight - height - safeBottom);
  const clampedY = Math.min(Math.max(0, safeY), maxY);

  return { x: clampedX, y: clampedY };
}

/**
 * Resolves whether mini-player position should snap to lateral Edge-Stash handle.
 * Snaps when the player is dragged within thresholdPx (default 28px) of screen edges.
 */
export function resolveEdgeStashSnap(
  x: number,
  width: number,
  viewportWidth: number,
  thresholdPx: number = EDGE_STASH_THRESHOLD_PX
): 'left' | 'right' | null {
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    typeof viewportWidth !== 'number' ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  ) {
    return null;
  }
  const threshold =
    typeof thresholdPx === 'number' && Number.isFinite(thresholdPx)
      ? thresholdPx
      : EDGE_STASH_THRESHOLD_PX;
  const distFromLeft = x;
  const distFromRight = viewportWidth - (x + width);

  const snapLeft = distFromLeft <= threshold;
  const snapRight = distFromRight <= threshold;

  if (snapLeft && snapRight) {
    return distFromLeft <= distFromRight ? 'left' : 'right';
  }
  if (snapLeft) return 'left';
  if (snapRight) return 'right';
  return null;
}

/**
 * Detects Picture-in-Picture and MediaSession capabilities for the current environment.
 * Evaluates snapshot or current browser environment safely without false positives.
 */
export function detectPipCapabilities(env?: PipEnvSnapshot | null): PipCapabilities {
  if (env && typeof env === 'object') {
    const documentPip = Boolean(env.hasDocumentPip);
    const elementPip = Boolean(env.hasRequestPip);
    const webkitPresentationPip = Boolean(env.hasWebkitPresentationMode);
    const autoPipAction =
      typeof env.hasAutoPipAction === 'boolean'
        ? env.hasAutoPipAction
        : Boolean(
            env.hasMediaSession &&
            (documentPip || elementPip) &&
            env.isSecureContext !== false
          );
    return {
      documentPip,
      elementPip,
      webkitPresentationPip,
      autoPipAction,
    };
  }

  if (typeof window === 'undefined') {
    return {
      documentPip: false,
      elementPip: false,
      webkitPresentationPip: false,
      autoPipAction: false,
    };
  }

  const docPipObj = (window as unknown as { documentPictureInPicture?: { requestWindow?: unknown } })
    .documentPictureInPicture;
  const documentPip = Boolean(
    'documentPictureInPicture' in window &&
      docPipObj &&
      typeof docPipObj.requestWindow === 'function'
  );
  const elementPip = Boolean(
    typeof document !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    (document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled
  );
  const webkitPresentationPip = Boolean(
    typeof HTMLVideoElement !== 'undefined' &&
    'webkitSupportsPresentationMode' in HTMLVideoElement.prototype
  );
  const mediaSessionObj =
    typeof navigator !== 'undefined' && 'mediaSession' in navigator
      ? (navigator as unknown as { mediaSession?: { setActionHandler?: unknown } }).mediaSession
      : undefined;
  const hasMediaSession = Boolean(
    mediaSessionObj && typeof mediaSessionObj.setActionHandler === 'function'
  );
  const autoPipAction = Boolean(hasMediaSession && (documentPip || elementPip) && window.isSecureContext !== false);

  return {
    documentPip,
    elementPip,
    webkitPresentationPip,
    autoPipAction,
  };
}
