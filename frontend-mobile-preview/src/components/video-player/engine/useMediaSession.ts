/**
 * useMediaSession.ts
 *
 * OS Lockscreen & Hardware Media Keys integration via Navigator MediaSession API.
 * - Defensively verifies navigator.mediaSession + setActionHandler alongside detectPipCapabilities()
 * - Strict priority-based active owner arbitration: paused/inactive background cards
 *   never overwrite or wipe an active Watch/Modal/MiniPlayer MediaSession
 * - Never fabricates author or artwork metadata
 * - Safely guards MediaMetadata constructor and setPositionState inside try/catch
 */

import { useEffect, useRef } from 'react';
import { detectPipCapabilities } from './videoPlayerCore';

export interface MediaArtworkItem {
  src: string;
  sizes?: string;
  type?: string;
}

export interface PlayerMediaMetadataInput {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: readonly MediaArtworkItem[];
}

export interface UseMediaSessionOptions {
  id?: string;
  active: boolean;
  priority?: number;
  metadata?: PlayerMediaMetadataInput | null;
  isPlaying: boolean;
  currentTime?: number;
  duration?: number;
  playbackRate?: number;
  defaultSeekOffsetSeconds?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onSeekBackward?: (seekOffset: number) => void;
  onSeekForward?: (seekOffset: number) => void;
  onSeekTo?: (seekTime: number, fastSeek: boolean) => void;
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
  onEnterPictureInPicture?: () => void;
}

export interface UseMediaSessionResult {
  supported: boolean;
}

const MANAGED_MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
] as const;

interface MediaSessionOwnerEntry {
  id: string;
  seq: number;
  priority: number;
  optionsRef: { current: UseMediaSessionOptions };
  registeredEnterPip: boolean;
}

interface MediaSessionRegistry {
  stack: MediaSessionOwnerEntry[];
  seqCounter: number;
  lastMetadataSig: string;
  lastOwnerId: string | null;
}

const mediaSessionRegistries = new WeakMap<object, MediaSessionRegistry>();
let fallbackOwnerCounter = 0;

function getSafeMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined') return null;
  // Reconcile with canonical capability detector + tighten method guard
  detectPipCapabilities();
  const ms = (navigator as unknown as { mediaSession?: MediaSession }).mediaSession;
  if (!ms || typeof ms.setActionHandler !== 'function') {
    return null;
  }
  return ms;
}

function getRegistry(ms: object): MediaSessionRegistry {
  let reg = mediaSessionRegistries.get(ms);
  if (!reg) {
    reg = {
      stack: [],
      seqCounter: 0,
      lastMetadataSig: '',
      lastOwnerId: null,
    };
    mediaSessionRegistries.set(ms, reg);
  }
  return reg;
}

function getTopOwner(reg: MediaSessionRegistry): MediaSessionOwnerEntry | null {
  if (reg.stack.length === 0) return null;
  let top = reg.stack[0];
  for (let i = 1; i < reg.stack.length; i += 1) {
    const candidate = reg.stack[i];
    if (
      candidate.priority > top.priority ||
      (candidate.priority === top.priority && candidate.seq > top.seq)
    ) {
      top = candidate;
    }
  }
  return top;
}

function normalizeMetadataInit(input?: PlayerMediaMetadataInput | null): {
  init: MediaMetadataInit;
  sig: string;
} | null {
  if (!input) return null;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const artist = typeof input.artist === 'string' ? input.artist.trim() : '';
  const album = typeof input.album === 'string' ? input.album.trim() : '';
  const artwork: MediaImage[] = Array.isArray(input.artwork)
    ? input.artwork
        .filter((a) => a && typeof a.src === 'string' && a.src.trim().length > 0)
        .map((a) => ({
          src: a.src.trim(),
          ...(a.sizes ? { sizes: a.sizes } : {}),
          ...(a.type ? { type: a.type } : {}),
        }))
    : [];

  if (!title && !artist && !album && artwork.length === 0) {
    return null;
  }

  const init: MediaMetadataInit = {
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(artwork.length > 0 ? { artwork } : {}),
  };
  const sig = JSON.stringify(init);
  return { init, sig };
}

function setHandlerSafe(ms: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    ms.setActionHandler(action, handler);
  } catch {
    // Unsupported action in current runtime
  }
}

function syncActionHandlers(ms: MediaSession, entry: MediaSessionOwnerEntry) {
  const opts = entry.optionsRef.current;

  setHandlerSafe(
    ms,
    'play',
    opts.onPlay ? () => entry.optionsRef.current.onPlay?.() : null
  );
  setHandlerSafe(
    ms,
    'pause',
    opts.onPause ? () => entry.optionsRef.current.onPause?.() : null
  );
  setHandlerSafe(
    ms,
    'seekbackward',
    opts.onSeekBackward || opts.onSeekTo
      ? (details) => {
          const curOpts = entry.optionsRef.current;
          const offset =
            typeof details?.seekOffset === 'number' && Number.isFinite(details.seekOffset) && details.seekOffset > 0
              ? details.seekOffset
              : curOpts.defaultSeekOffsetSeconds ?? 10;
          if (curOpts.onSeekBackward) {
            curOpts.onSeekBackward(offset);
          } else if (curOpts.onSeekTo) {
            const cur = typeof curOpts.currentTime === 'number' && Number.isFinite(curOpts.currentTime) ? curOpts.currentTime : 0;
            curOpts.onSeekTo(Math.max(0, cur - offset), false);
          }
        }
      : null
  );
  setHandlerSafe(
    ms,
    'seekforward',
    opts.onSeekForward || opts.onSeekTo
      ? (details) => {
          const curOpts = entry.optionsRef.current;
          const offset =
            typeof details?.seekOffset === 'number' && Number.isFinite(details.seekOffset) && details.seekOffset > 0
              ? details.seekOffset
              : curOpts.defaultSeekOffsetSeconds ?? 10;
          if (curOpts.onSeekForward) {
            curOpts.onSeekForward(offset);
          } else if (curOpts.onSeekTo) {
            const cur = typeof curOpts.currentTime === 'number' && Number.isFinite(curOpts.currentTime) ? curOpts.currentTime : 0;
            const dur = typeof curOpts.duration === 'number' && Number.isFinite(curOpts.duration) && curOpts.duration > 0 ? curOpts.duration : Infinity;
            curOpts.onSeekTo(Math.min(dur, cur + offset), false);
          }
        }
      : null
  );
  setHandlerSafe(
    ms,
    'seekto',
    opts.onSeekTo
      ? (details) => {
          if (typeof details?.seekTime === 'number' && Number.isFinite(details.seekTime)) {
            entry.optionsRef.current.onSeekTo?.(Math.max(0, details.seekTime), Boolean(details.fastSeek));
          }
        }
      : null
  );
  setHandlerSafe(
    ms,
    'previoustrack',
    opts.onPreviousTrack ? () => entry.optionsRef.current.onPreviousTrack?.() : null
  );
  setHandlerSafe(
    ms,
    'nexttrack',
    opts.onNextTrack ? () => entry.optionsRef.current.onNextTrack?.() : null
  );

  if (opts.onEnterPictureInPicture) {
    entry.registeredEnterPip = true;
    setHandlerSafe(ms, 'enterpictureinpicture' as MediaSessionAction, () => {
      entry.optionsRef.current.onEnterPictureInPicture?.();
    });
  } else if (entry.registeredEnterPip) {
    entry.registeredEnterPip = false;
    setHandlerSafe(ms, 'enterpictureinpicture' as MediaSessionAction, null);
  }
}

function syncPositionStateSafe(ms: MediaSession, opts: UseMediaSessionOptions) {
  if (typeof ms.setPositionState !== 'function') return;
  const duration = opts.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return;
  }
  const rawPos = typeof opts.currentTime === 'number' && Number.isFinite(opts.currentTime) ? opts.currentTime : 0;
  const position = Math.min(Math.max(0, rawPos), duration);
  const playbackRate =
    typeof opts.playbackRate === 'number' && Number.isFinite(opts.playbackRate) && opts.playbackRate > 0
      ? opts.playbackRate
      : 1;
  try {
    ms.setPositionState({ duration, playbackRate, position });
  } catch {
    // Guard against browser timing errors during stream transitions
  }
}

function syncMetadataAndPlaybackState(ms: MediaSession, reg: MediaSessionRegistry, owner: MediaSessionOwnerEntry) {
  const opts = owner.optionsRef.current;
  const ownerChanged = reg.lastOwnerId !== owner.id;
  reg.lastOwnerId = owner.id;

  const normalizedMeta = normalizeMetadataInit(opts.metadata);
  const nextSig = normalizedMeta ? normalizedMeta.sig : '';
  if (ownerChanged || reg.lastMetadataSig !== nextSig) {
    reg.lastMetadataSig = nextSig;
    try {
      if (!normalizedMeta) {
        ms.metadata = null;
      } else if (typeof MediaMetadata === 'function') {
        ms.metadata = new MediaMetadata(normalizedMeta.init);
      } else {
        ms.metadata = normalizedMeta.init as unknown as MediaMetadata;
      }
    } catch {
      // Safe guard in restricted contexts
    }
  }

  try {
    ms.playbackState = opts.isPlaying ? 'playing' : 'paused';
  } catch {
    // Ignore read-only playbackState errors
  }
}

function applyOwnerState(ms: MediaSession, reg: MediaSessionRegistry, owner: MediaSessionOwnerEntry) {
  syncMetadataAndPlaybackState(ms, reg, owner);
  syncActionHandlers(ms, owner);
  syncPositionStateSafe(ms, owner.optionsRef.current);
}

function clearMediaSession(ms: MediaSession, reg: MediaSessionRegistry, clearedOwner: MediaSessionOwnerEntry) {
  reg.lastOwnerId = null;
  reg.lastMetadataSig = '';
  try {
    ms.metadata = null;
  } catch {
    // Safe guard
  }
  try {
    ms.playbackState = 'none';
  } catch {
    // Safe guard
  }
  for (const action of MANAGED_MEDIA_SESSION_ACTIONS) {
    setHandlerSafe(ms, action, null);
  }
  if (clearedOwner.registeredEnterPip) {
    clearedOwner.registeredEnterPip = false;
    setHandlerSafe(ms, 'enterpictureinpicture' as MediaSessionAction, null);
  }
}

/**
 * React hook registering lockscreen metadata, playback state, position state,
 * and hardware media control handlers for the highest-priority active player.
 */
export function useMediaSession(options: UseMediaSessionOptions): UseMediaSessionResult {
  const { id, active, priority = 0, metadata, isPlaying, currentTime, duration, playbackRate } = options;

  const latestOptionsRef = useRef<UseMediaSessionOptions>(options);
  latestOptionsRef.current = options;

  const ownerIdRef = useRef<string>(id || `media-session-${++fallbackOwnerCounter}`);
  if (id) {
    ownerIdRef.current = id;
  }

  const supported = getSafeMediaSession() !== null;

  const metaSig = normalizeMetadataInit(metadata)?.sig || '';
  const hasPrev = Boolean(options.onPreviousTrack);
  const hasNext = Boolean(options.onNextTrack);
  const hasEnterPip = Boolean(options.onEnterPictureInPicture);

  useEffect(() => {
    const ms = getSafeMediaSession();
    if (!ms || !active) return undefined;

    const reg = getRegistry(ms);
    reg.seqCounter += 1;
    const entry: MediaSessionOwnerEntry = {
      id: ownerIdRef.current,
      seq: reg.seqCounter,
      priority: typeof priority === 'number' && Number.isFinite(priority) ? priority : 0,
      optionsRef: latestOptionsRef,
      registeredEnterPip: false,
    };

    // Deduplicate if same id already exists
    const existingIdx = reg.stack.findIndex((item) => item.id === entry.id);
    if (existingIdx !== -1) {
      reg.stack.splice(existingIdx, 1);
    }
    reg.stack.push(entry);

    const top = getTopOwner(reg);
    if (top === entry) {
      applyOwnerState(ms, reg, entry);
    }

    return () => {
      const topBeforeRemove = getTopOwner(reg);
      const idx = reg.stack.indexOf(entry);
      if (idx !== -1) {
        reg.stack.splice(idx, 1);
      }

      if (topBeforeRemove === entry) {
        const nextTop = getTopOwner(reg);
        if (nextTop) {
          applyOwnerState(ms, reg, nextTop);
        } else {
          clearMediaSession(ms, reg, entry);
        }
      }
    };
  }, [active, priority, id]);

  // Sync metadata & playbackState while remaining the active top owner
  useEffect(() => {
    const ms = getSafeMediaSession();
    if (!ms || !active) return;

    const reg = getRegistry(ms);
    const top = getTopOwner(reg);
    if (top && top.id === ownerIdRef.current) {
      syncMetadataAndPlaybackState(ms, reg, top);
    }
  }, [active, isPlaying, metaSig]);

  // Sync hardware action handlers when handler availability changes
  useEffect(() => {
    const ms = getSafeMediaSession();
    if (!ms || !active) return;

    const reg = getRegistry(ms);
    const top = getTopOwner(reg);
    if (top && top.id === ownerIdRef.current) {
      syncActionHandlers(ms, top);
    }
  }, [active, hasPrev, hasNext, hasEnterPip]);

  // Sync positionState on time/duration/rate updates without re-registering action handlers
  useEffect(() => {
    const ms = getSafeMediaSession();
    if (!ms || !active) return;

    const reg = getRegistry(ms);
    const top = getTopOwner(reg);
    if (top && top.id === ownerIdRef.current) {
      syncPositionStateSafe(ms, top.optionsRef.current);
    }
  }, [active, currentTime, duration, playbackRate]);

  return { supported };
}
