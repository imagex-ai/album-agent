/**
 * streamAttachCoordinator.ts
 *
 * Pure async playback transport coordinator and shared DOM/stream helpers
 * extracted from useUniversalVideoEngine. Handles generation-guarded quality
 * resolution, relative/localhost transport reuse, HLS.js vs native iOS Safari
 * playback, playbackRate preservation, 20s startup timeout, max-1 stream
 * renewal + ABR candidate downgrade, and snapshot serialization.
 */

import * as HlsNamespace from 'hls.js';
import { fromHlsError, fromMediaError, type PlaybackDiagnostic } from './playbackDiagnostics';
import {
  PLAYER_STARTUP_TIMEOUT_MS,
  isHlsStreamUrl,
  classifyPlayError,
  pickFallbackStreamCandidate,
  normalizeComparableStreamUrl,
  clampSeekTime,
  formatQualityLabel,
  type StreamQualityCandidate,
  type PlaybackHandoffSnapshot,
  type TimelineVideoQuality,
  type StreamFallbackCandidate,
} from './videoPlayerCore';
import {
  buildTimelineStreamUrl,
  isWatchPageOnlyUrl,
  normalizeTimelineQualities,
} from '../../profile-hub/timeline/timelineModel';

export type PlaybackErrorCode =
  | 'playback_failed'
  | 'startup_timeout'
  | 'hls_fatal'
  | 'stream_unavailable';

export interface AttachableVideoElement {
  src: string;
  paused: boolean;
  ended?: boolean;
  muted: boolean;
  defaultMuted?: boolean;
  playsInline?: boolean;
  preload?: string;
  volume: number;
  playbackRate: number;
  defaultPlaybackRate?: number;
  readyState: number;
  duration: number;
  currentTime: number;
  videoWidth?: number;
  videoHeight?: number;
  buffered?: {
    length: number;
    start(index: number): number;
    end(index: number): number;
  };
  error?: unknown;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  load?(): void;
  play(): Promise<void> | undefined;
  pause(): void;
  addEventListener(
    type: string,
    listener: (...args: any[]) => void,
    options?: AddEventListenerOptions | boolean
  ): void;
  removeEventListener(
    type: string,
    listener: (...args: any[]) => void,
    options?: AddEventListenerOptions | boolean
  ): void;
}

export interface HlsLevelLike {
  height?: number;
  bitrate?: number;
  name?: string;
}

export interface HlsLikeInstance {
  levels: HlsLevelLike[];
  currentLevel: number;
  loadSource(url: string): void;
  attachMedia(media: any): void;
  on(event: string, listener: (event: string, data?: any) => void): void;
  startLoad?(startPosition?: number): void;
  stopLoad?(): void;
  destroy(): void;
}

export interface HlsConstructorLike {
  isSupported(): boolean;
  Events: {
    MANIFEST_PARSED: string;
    ERROR: string;
    LEVEL_SWITCHED?: string;
    LEVEL_LOADED?: string;
    BUFFER_APPENDED?: string;
  };
  new (config?: Record<string, unknown>): HlsLikeInstance;
}

export const DefaultHlsClass: HlsConstructorLike | null = (() => {
  const ns = HlsNamespace as unknown as { default?: HlsConstructorLike };
  if (ns?.default && typeof ns.default === 'function') {
    return ns.default;
  }
  if (typeof HlsNamespace === 'function') {
    return HlsNamespace as unknown as HlsConstructorLike;
  }
  return null;
})();

export type TimerHandle = ReturnType<typeof setTimeout>;
export type SetTimeoutFn = (callback: () => void, delayMs: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle) => void;

export function clampVolume(value: unknown, fallback = 1): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 1;
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : safeFallback;
  return Math.min(1, Math.max(0, raw));
}

export function sanitizePlaybackRate(rate: unknown, fallback = 1): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return safeFallback;
  }
  return Math.min(4, Math.max(0.25, rate));
}

export function applyInlineVideoAttrs(video: AttachableVideoElement, muted: boolean): void {
  video.defaultMuted = muted;
  video.muted = muted;
  video.playsInline = true;
  video.setAttribute?.('playsinline', '');
  video.setAttribute?.('webkit-playsinline', '');
  if (muted) {
    video.setAttribute?.('muted', '');
  } else {
    video.removeAttribute?.('muted');
  }
}

export function applyPlaybackRateToVideo(
  video: AttachableVideoElement,
  rate: unknown
): void {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return;
  const safeRate = sanitizePlaybackRate(rate, 1);
  try {
    video.defaultPlaybackRate = safeRate;
    video.playbackRate = safeRate;
  } catch {
    // Ignore read-only stub failures in non-browser harnesses.
  }
}

export interface TeardownMediaTransportOptions {
  video?: AttachableVideoElement | null;
  hlsRef: { current: HlsLikeInstance | null };
  loadedSrcRef: { current: string };
  loadedMasterHlsRef: { current: string | undefined };
  startupTimeoutRef?: { current: TimerHandle | null };
  clearTimeoutFn?: ClearTimeoutFn;
  pendingMetadataCleanupRef?: { current: (() => void) | null };
  ignoringMediaEventsRef?: { current: boolean };
  pendingResumeTimeRef?: { current: number | null };
  preserveResumeTime?: boolean;
  preloadNone?: boolean;
  stripSrc?: boolean;
  pauseVideo?: boolean;
}

export function teardownMediaTransport(options: TeardownMediaTransportOptions): void {
  const {
    video,
    hlsRef,
    loadedSrcRef,
    loadedMasterHlsRef,
    startupTimeoutRef,
    clearTimeoutFn = (id) => globalThis.clearTimeout(id),
    pendingMetadataCleanupRef,
    ignoringMediaEventsRef,
    pendingResumeTimeRef,
    preserveResumeTime = false,
    preloadNone = false,
    stripSrc = true,
    pauseVideo = true,
  } = options;

  if (startupTimeoutRef && startupTimeoutRef.current !== null) {
    clearTimeoutFn(startupTimeoutRef.current);
    startupTimeoutRef.current = null;
  }
  if (pendingMetadataCleanupRef?.current) {
    pendingMetadataCleanupRef.current();
    pendingMetadataCleanupRef.current = null;
  }

  if (ignoringMediaEventsRef) {
    ignoringMediaEventsRef.current = true;
  }
  try {
    if (video) {
      if (
        preserveResumeTime &&
        pendingResumeTimeRef &&
        loadedSrcRef.current &&
        (video.readyState >= 1 || video.currentTime > 0)
      ) {
        pendingResumeTimeRef.current = video.currentTime;
      }
      try {
        if (pauseVideo) {
          video.pause();
        }
        if (preloadNone) {
          video.preload = 'none';
        }
        if (stripSrc) {
          video.removeAttribute?.('src');
          video.load?.();
        }
      } catch {
        // Detached or partial mock DOM safety.
      }
    }

    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        // Ignore cleanup failure on detached Hls instance.
      }
      hlsRef.current = null;
    }
  } finally {
    if (ignoringMediaEventsRef) {
      ignoringMediaEventsRef.current = false;
    }
  }

  if (stripSrc) {
    loadedSrcRef.current = '';
    loadedMasterHlsRef.current = undefined;
  }
}

export interface VideoElementStatePatch {
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playbackRate: number;
  currentTime: number;
  duration: number;
  bufferedPercent: number;
  isBuffering: boolean;
  isVideoReady: boolean;
  decodedHeight: number | null;
  decodedAspectRatio: number | null;
  playbackError: PlaybackErrorCode | null;
}

export function computeBufferedPercent(
  video: AttachableVideoElement,
  fallbackDuration: number
): number {
  const dur =
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : fallbackDuration;
  if (!dur || dur <= 0 || !video.buffered || video.buffered.length === 0) return 0;
  const cur = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  let endSec = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    const start = video.buffered.start(i);
    const end = video.buffered.end(i);
    if (cur >= start - 0.5 && cur <= end + 0.5) {
      endSec = Math.max(endSec, end);
    }
  }
  if (endSec === 0) {
    endSec = video.buffered.end(video.buffered.length - 1);
  }
  const pct = Math.min(100, Math.max(0, (endSec / dur) * 100));
  return Math.round(pct * 10) / 10;
}

export interface BindVideoElementEventsOptions<T extends VideoElementStatePatch> {
  video: AttachableVideoElement;
  stateMirrorRef: { current: T };
  loadedSrcRef: { current: string };
  ignoringMediaEventsRef: { current: boolean };
  playbackIntentRef: { current: PlaybackIntentState };
  restorePausedActiveRef: { current: boolean };
  activeFailureHandlerRef: { current: (failedUrl?: string, error?: unknown) => Promise<void> };
  mountedRef: { current: boolean };
  patchState: (patch: Partial<T>) => void;
  updateState: (updater: (prev: T) => T) => void;
  onTimeUpdateFrame?: (currentTime: number, duration: number) => void;
  onPlaybackError?: (error: PlaybackErrorCode | null) => void;
  onEnded?: () => void;
}

/**
 * Attaches HTML5 <video> lifecycle, buffering, volume/rate, and error listeners,
 * returning an idempotent cleanup function.
 */
export function bindVideoElementEvents<T extends VideoElementStatePatch>(
  options: BindVideoElementEventsOptions<T>
): () => void {
  const {
    video,
    stateMirrorRef,
    loadedSrcRef,
    ignoringMediaEventsRef,
    playbackIntentRef,
    restorePausedActiveRef,
    activeFailureHandlerRef,
    mountedRef,
    patchState,
    updateState,
    onTimeUpdateFrame,
    onPlaybackError,
    onEnded,
  } = options;

  const syncDimensionsAndMetadataPatch = (): Partial<T> => {
    const dur =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : stateMirrorRef.current.duration;
    const vh = video.videoHeight || 0;
    const vw = video.videoWidth || 0;
    return {
      ...(dur > 0 ? { duration: dur } : {}),
      ...(vh > 0
        ? {
            decodedHeight: vh,
            ...(vw > 0 ? { decodedAspectRatio: vw / vh } : {}),
          }
        : {}),
      bufferedPercent: computeBufferedPercent(video, dur),
    } as Partial<T>;
  };

  const onLoadedMetadata = () => {
    applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
    patchState(syncDimensionsAndMetadataPatch());
  };

  const onReady = () => {
    patchState({
      ...syncDimensionsAndMetadataPatch(),
      isVideoReady: true,
      isBuffering: false,
    } as Partial<T>);
  };

  const onPlayingEvent = () => {
    patchState({
      ...syncDimensionsAndMetadataPatch(),
      isVideoReady: true,
      isBuffering: false,
      playbackError: null,
      ...(!ignoringMediaEventsRef.current && playbackIntentRef.current.isPlaying
        ? { isPlaying: true }
        : {}),
    } as Partial<T>);
    onPlaybackError?.(null);
  };

  const onWaiting = () => {
    if (!ignoringMediaEventsRef.current && playbackIntentRef.current.isPlaying) {
      patchState({ isBuffering: true } as Partial<T>);
    }
  };

  const onPauseEvent = () => {
    const shouldPauseState =
      !ignoringMediaEventsRef.current &&
      !video.ended &&
      loadedSrcRef.current &&
      stateMirrorRef.current.isPlaying;
    patchState({
      isBuffering: false,
      ...(shouldPauseState ? { isPlaying: false } : {}),
    } as Partial<T>);
  };

  const onEndedEvent = () => {
    patchState({ isBuffering: false, isPlaying: false } as Partial<T>);
    onEnded?.();
  };

  const onTimeUpdate = () => {
    const cur =
      Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0;
    const dur =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : stateMirrorRef.current.duration;
    const becameReady = cur > 0.05 && !stateMirrorRef.current.isVideoReady;
    const nextBuf = computeBufferedPercent(video, dur);

    updateState((prev) => ({
      ...prev,
      currentTime: cur,
      ...(dur > 0 && dur !== prev.duration ? { duration: dur } : {}),
      ...(becameReady ? { isVideoReady: true, isBuffering: false } : {}),
      ...(nextBuf !== prev.bufferedPercent ? { bufferedPercent: nextBuf } : {}),
    }));
    onTimeUpdateFrame?.(cur, dur);
  };

  const onProgress = () => {
    const nextBuf = computeBufferedPercent(video, stateMirrorRef.current.duration);
    if (nextBuf !== stateMirrorRef.current.bufferedPercent) {
      patchState({ bufferedPercent: nextBuf } as Partial<T>);
    }
  };

  const onVolumeChange = () => {
    if (ignoringMediaEventsRef.current) return;
    const patch: Partial<VideoElementStatePatch> = {};
    if (video.muted !== stateMirrorRef.current.isMuted) {
      patch.isMuted = video.muted;
    }
    if (
      Number.isFinite(video.volume) &&
      Math.abs(video.volume - stateMirrorRef.current.volume) > 0.001
    ) {
      patch.volume = clampVolume(video.volume, stateMirrorRef.current.volume);
    }
    if (Object.keys(patch).length > 0) {
      patchState(patch as Partial<T>);
    }
  };

  const onRateChange = () => {
    if (ignoringMediaEventsRef.current) return;
    const intendedRate = playbackIntentRef.current.playbackRate ?? 1;
    // Guard against HTML5 media load resetting playbackRate to 1 when defaultPlaybackRate is custom
    if (
      video.playbackRate === 1 &&
      intendedRate !== 1 &&
      (video.readyState < 1 || video.defaultPlaybackRate === intendedRate)
    ) {
      applyPlaybackRateToVideo(video, intendedRate);
      return;
    }
    if (
      Number.isFinite(video.playbackRate) &&
      video.playbackRate > 0 &&
      video.playbackRate !== stateMirrorRef.current.playbackRate
    ) {
      const safeRate = sanitizePlaybackRate(video.playbackRate, 1);
      playbackIntentRef.current.playbackRate = safeRate;
      video.defaultPlaybackRate = safeRate;
      patchState({ playbackRate: safeRate } as Partial<T>);
    }
  };

  const onError = () => {
    if (
      ignoringMediaEventsRef.current ||
      !mountedRef.current ||
      !loadedSrcRef.current ||
      (!playbackIntentRef.current.isPlaying && !restorePausedActiveRef.current)
    ) {
      return;
    }
    void activeFailureHandlerRef.current(loadedSrcRef.current, video.error);
  };

  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('loadeddata', onReady);
  video.addEventListener('canplay', onReady);
  video.addEventListener('playing', onPlayingEvent);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('stalled', onWaiting);
  video.addEventListener('pause', onPauseEvent);
  video.addEventListener('ended', onEndedEvent);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('progress', onProgress);
  video.addEventListener('volumechange', onVolumeChange);
  video.addEventListener('ratechange', onRateChange);
  video.addEventListener('error', onError);

  return () => {
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('loadeddata', onReady);
    video.removeEventListener('canplay', onReady);
    video.removeEventListener('playing', onPlayingEvent);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('stalled', onWaiting);
    video.removeEventListener('pause', onPauseEvent);
    video.removeEventListener('ended', onEndedEvent);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('volumechange', onVolumeChange);
    video.removeEventListener('ratechange', onRateChange);
    video.removeEventListener('error', onError);
  };
}

export interface FetchQualitiesGuardedOptions<T> {
  generation: number;
  generationRef: { current: number };
  mountedRef?: { current: boolean };
  signal?: AbortSignal;
  fetcher: () => Promise<T | null | undefined>;
  onApply?: (data: T) => void;
}

/**
 * Runs an async quality-discovery request guarded by generation counter,
 * mount status, and optional AbortSignal so stale responses never overwrite state.
 */
export async function fetchQualitiesGuarded<T>(
  options: FetchQualitiesGuardedOptions<T>
): Promise<T | null> {
  const { generation, generationRef, mountedRef, signal, fetcher, onApply } = options;

  const isValid = () => {
    if (generationRef.current !== generation) return false;
    if (mountedRef && !mountedRef.current) return false;
    if (signal?.aborted) return false;
    return true;
  };

  if (!isValid()) return null;

  try {
    const result = await fetcher();
    if (!isValid()) return null;
    if (result === null || result === undefined) return null;
    onApply?.(result);
    return result;
  } catch {
    return null;
  }
}

export interface BuildPlaybackSnapshotOptions {
  videoElement?: Partial<AttachableVideoElement> | null;
  pendingResumeTime?: number | null;
  initialHandoff?: PlaybackHandoffSnapshot | null;
  isAttached?: boolean;
  loadedSrc?: string;
  isPlayingFallback?: boolean;
  isMutedFallback?: boolean;
  volumeFallback?: number;
  playbackRateFallback?: number;
  selectedQuality?: number | 'auto';
  masterHlsUrl?: string;
  qualities?: StreamQualityCandidate[];
}

/**
 * Builds a clean, portable PlaybackHandoffSnapshot from active media element state.
 * Preserves explicit 0 seeks and never copies ephemeral DOM sourceRect coordinates.
 */
export function buildPlaybackSnapshot(
  options: BuildPlaybackSnapshotOptions
): PlaybackHandoffSnapshot {
  const {
    videoElement,
    pendingResumeTime,
    initialHandoff,
    isAttached,
    loadedSrc,
    isPlayingFallback = false,
    isMutedFallback = true,
    volumeFallback = 1,
    playbackRateFallback = 1,
    selectedQuality = 'auto',
    masterHlsUrl,
    qualities,
  } = options;

  const attached =
    typeof isAttached === 'boolean'
      ? isAttached
      : loadedSrc !== undefined
        ? Boolean(loadedSrc)
        : Boolean(videoElement);

  const rawVideoTime = videoElement?.currentTime;
  const readyState = typeof videoElement?.readyState === 'number' ? videoElement.readyState : 0;

  let currentTime: number;
  if (
    attached &&
    videoElement &&
    readyState >= 1 &&
    typeof rawVideoTime === 'number' &&
    Number.isFinite(rawVideoTime) &&
    rawVideoTime >= 0
  ) {
    currentTime = rawVideoTime;
  } else if (
    typeof pendingResumeTime === 'number' &&
    Number.isFinite(pendingResumeTime) &&
    pendingResumeTime >= 0
  ) {
    currentTime = pendingResumeTime;
  } else if (
    typeof initialHandoff?.currentTime === 'number' &&
    Number.isFinite(initialHandoff.currentTime) &&
    initialHandoff.currentTime >= 0
  ) {
    currentTime = initialHandoff.currentTime;
  } else {
    currentTime = 0;
  }

  const isPlaying =
    attached && videoElement && typeof videoElement.paused === 'boolean'
      ? !videoElement.paused && !Boolean(videoElement.ended)
      : Boolean(isPlayingFallback);

  const isMuted =
    videoElement && typeof videoElement.muted === 'boolean'
      ? videoElement.muted
      : Boolean(isMutedFallback);

  const volume =
    videoElement && typeof videoElement.volume === 'number' && Number.isFinite(videoElement.volume)
      ? clampVolume(videoElement.volume, volumeFallback)
      : clampVolume(volumeFallback, 1);

  const playbackRate =
    videoElement &&
    typeof videoElement.playbackRate === 'number' &&
    Number.isFinite(videoElement.playbackRate) &&
    videoElement.playbackRate > 0
      ? videoElement.playbackRate
      : playbackRateFallback;

  return {
    currentTime,
    isPlaying,
    isMuted,
    volume,
    playbackRate,
    selectedQuality,
    qualities: Array.isArray(qualities) ? [...qualities] : [],
    ...(masterHlsUrl ? { masterHlsUrl } : {}),
  };
}

/**
 * Narrows StreamQualityCandidate[] into strict TimelineVideoQuality[] (positive numeric height)
 * for ABR fallback selection via pickFallbackStreamCandidate.
 */
export function toTimelineVideoQualities(
  qualities?: readonly StreamQualityCandidate[] | null
): TimelineVideoQuality[] {
  if (!Array.isArray(qualities) || qualities.length === 0) return [];
  const narrowed: TimelineVideoQuality[] = [];
  for (const q of qualities) {
    if (
      q &&
      typeof q.height === 'number' &&
      Number.isFinite(q.height) &&
      q.height > 0 &&
      typeof q.streamUrl === 'string' &&
      q.streamUrl
    ) {
      narrowed.push({
        height: q.height,
        label: q.label || formatQualityLabel(q.height),
        streamUrl: q.streamUrl,
        bitrate: q.bitrate,
        format_id: q.format_id,
        ext: q.ext,
      });
    }
  }
  return narrowed;
}

const LOCAL_DIRECT_API_PREFIXES = [
  '/api/videos/',
  '/api/albums/',
  '/api/trash/',
  '/api/scraper/',
];

const LOCAL_GIF_RESOLVER_PREFIXES = ['/api/profile-hub/gif-stream'];
const LOCAL_PROXY_STREAM_PREFIXES = ['/api/proxy-video-stream'];

function isLocalOriginPath(rawUrl: string, prefixes: readonly string[]): boolean {
  if (prefixes.some((prefix) => rawUrl.startsWith(prefix))) {
    return true;
  }
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    try {
      const parsed = new URL(rawUrl);
      return (
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        prefixes.some((prefix) => parsed.pathname.startsWith(prefix))
      );
    } catch {
      return false;
    }
  }
  return false;
}

function isLocalDirectApiUrl(rawUrl: string): boolean {
  return (
    isLocalOriginPath(rawUrl, LOCAL_DIRECT_API_PREFIXES) ||
    isLocalOriginPath(rawUrl, LOCAL_GIF_RESOLVER_PREFIXES)
  );
}

function isProxyOrResolverUrl(rawUrl: string): boolean {
  return (
    isLocalOriginPath(rawUrl, LOCAL_PROXY_STREAM_PREFIXES) ||
    isLocalOriginPath(rawUrl, LOCAL_GIF_RESOLVER_PREFIXES)
  );
}

/**
 * Resolves a playable URL preserving local API streams, blob/data URIs,
 * relative fixture paths, and proxying remote external URLs when needed.
 */
export function resolvePlayableStreamUrl(
  rawUrl?: string,
  referer?: string,
  height?: number,
  youtubeId?: string
): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) {
    return youtubeId ? buildTimelineStreamUrl(undefined, referer, height, youtubeId) : '';
  }
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:') || isLocalDirectApiUrl(trimmed)) {
    return trimmed;
  }
  if (isProxyOrResolverUrl(trimmed)) {
    return buildTimelineStreamUrl(trimmed, referer, height, youtubeId);
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return buildTimelineStreamUrl(trimmed, referer, height, youtubeId);
  }
  return trimmed;
}

export function normalizeQualityCandidates(
  qualities?: readonly StreamQualityCandidate[] | null,
  referer?: string
): StreamQualityCandidate[] {
  if (!Array.isArray(qualities) || qualities.length === 0) return [];
  const timelineItems: TimelineVideoQuality[] = [];
  const extraItems: StreamQualityCandidate[] = [];

  for (const q of qualities) {
    if (!q || typeof q.streamUrl !== 'string' || !q.streamUrl) continue;
    if (isWatchPageOnlyUrl(q.streamUrl)) continue;
    if (typeof q.height === 'number' && Number.isFinite(q.height) && q.height > 0) {
      if (
        isLocalDirectApiUrl(q.streamUrl) ||
        (!isProxyOrResolverUrl(q.streamUrl) &&
          !q.streamUrl.startsWith('http') &&
          !q.streamUrl.startsWith('/api/'))
      ) {
        extraItems.push({
          ...q,
          label: q.label || formatQualityLabel(q.height),
        });
      } else {
        timelineItems.push({
          height: q.height,
          label: q.label || formatQualityLabel(q.height),
          streamUrl: q.streamUrl,
          bitrate: q.bitrate,
          format_id: q.format_id,
          ext: q.ext,
        });
      }
    } else {
      extraItems.push(q);
    }
  }

  const normalizedTimeline = normalizeTimelineQualities(timelineItems, referer);
  const merged = [...normalizedTimeline, ...extraItems];
  const dedupedByHeight = new Map<number, StreamQualityCandidate>();
  const nonNumeric: StreamQualityCandidate[] = [];

  for (const item of merged) {
    if (typeof item.height === 'number' && item.height > 0) {
      if (!dedupedByHeight.has(item.height)) {
        dedupedByHeight.set(item.height, item);
      }
    } else {
      nonNumeric.push(item);
    }
  }

  return [
    ...Array.from(dedupedByHeight.values()).sort((a, b) => (b.height || 0) - (a.height || 0)),
    ...nonNumeric,
  ];
}

function buildNormalizedFailedSet(failedUrls: ReadonlySet<string>): Set<string> {
  const normalizedFailed = new Set<string>();
  for (const url of failedUrls) {
    const norm = normalizeComparableStreamUrl(url);
    if (norm) normalizedFailed.add(norm);
  }
  return normalizedFailed;
}

export function isUrlInFailedSet(
  url: string | undefined | null,
  failedUrls: ReadonlySet<string>
): boolean {
  if (!url) return false;
  if (failedUrls.has(url)) return true;
  const norm = normalizeComparableStreamUrl(url);
  if (!norm) return false;
  for (const failed of failedUrls) {
    if (normalizeComparableStreamUrl(failed) === norm) {
      return true;
    }
  }
  return false;
}

export function expandNormalizedFailedUrls(
  failedUrls: ReadonlySet<string>,
  qualities: readonly StreamQualityCandidate[],
  masterHlsUrl?: string
): Set<string> {
  const expanded = new Set<string>(failedUrls);
  const normalizedFailed = buildNormalizedFailedSet(failedUrls);
  for (const q of qualities) {
    if (q?.streamUrl) {
      const norm = normalizeComparableStreamUrl(q.streamUrl);
      if (norm && normalizedFailed.has(norm)) {
        expanded.add(q.streamUrl);
      }
    }
  }
  if (masterHlsUrl) {
    const normMaster = normalizeComparableStreamUrl(masterHlsUrl);
    if (normMaster && normalizedFailed.has(normMaster)) {
      expanded.add(masterHlsUrl);
    }
  }
  return expanded;
}

function resolveCandidateFromRenewalPayload(options: {
  streamUrl?: string;
  masterHlsUrl?: string;
  qualities: readonly StreamQualityCandidate[];
  selectedQuality: number | 'auto';
  failedUrls: ReadonlySet<string>;
}): StreamFallbackCandidate | null {
  const { streamUrl, masterHlsUrl, qualities, selectedQuality, failedUrls } = options;
  const expandedFailed = expandNormalizedFailedUrls(failedUrls, qualities, masterHlsUrl);
  const safeMasterHls =
    masterHlsUrl && !isUrlInFailedSet(masterHlsUrl, expandedFailed) ? masterHlsUrl : undefined;

  if (streamUrl && !isUrlInFailedSet(streamUrl, expandedFailed)) {
    const candidateMaster =
      safeMasterHls || (isHlsStreamUrl(streamUrl) ? streamUrl : undefined);
    return {
      streamUrl,
      masterHls: candidateMaster,
    };
  }

  if (safeMasterHls) {
    return { streamUrl: safeMasterHls, masterHls: safeMasterHls };
  }

  return pickFallbackStreamCandidate({
    activeStreamUrl: '',
    qualities: toTimelineVideoQualities(qualities),
    masterHlsUrl: undefined,
    selectedQuality,
    failedUrls: expandedFailed,
  });
}

export interface PlaybackIntentState {
  isPlaying: boolean;
  isMuted: boolean;
  playbackRate?: number;
  volume?: number;
}

export interface StreamQualitiesResolution {
  qualities: StreamQualityCandidate[];
  masterHls?: string;
  diagnostic?: PlaybackDiagnostic | null;
}

export interface StreamRenewalResolution {
  streamUrl?: string;
  masterHls?: string;
  masterHlsUrl?: string;
  qualities?: StreamQualityCandidate[];
  diagnostic?: PlaybackDiagnostic | null;
}

export interface RunStreamAttachOptions {
  video: AttachableVideoElement | null;
  generationRef: { current: number };
  mountedRef: { current: boolean };
  hlsRef: { current: HlsLikeInstance | null };
  loadedSrcRef: { current: string };
  loadedMasterHlsRef: { current: string | undefined };
  pendingResumeTimeRef: { current: number | null };
  pendingMetadataCleanupRef: { current: (() => void) | null };
  startupTimeoutRef: { current: TimerHandle | null };
  renewalAttemptedRef: { current: boolean };
  renewalInFlightRef: { current: boolean };
  failedUrlsRef: { current: Set<string> };
  playbackIntentRef: { current: PlaybackIntentState };
  restorePausedActiveRef?: { current: boolean };
  ignoringMediaEventsRef?: { current: boolean };
  streamUrl: string;
  masterHlsUrl?: string;
  sourceUrl?: string;
  sourceType?: string;
  qualities?: StreamQualityCandidate[];
  qualitiesFetchedRef?: { current: boolean };
  selectedQuality: number | 'auto';
  forceReload?: boolean;
  restorePaused?: boolean;
  HlsClass?: HlsConstructorLike | null;
  startupTimeoutMs?: number;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
  fetchFreshQualities?: (
    force: boolean,
    generation: number
  ) => Promise<StreamQualitiesResolution | null>;
  renewStream?: (
    failedUrl: string,
    generation: number
  ) => Promise<StreamRenewalResolution | null>;
  onFailureHandlerReady?: (
    generation: number,
    handler: (failedUrl?: string, error?: unknown) => Promise<void>
  ) => void;
  onQualitiesUpdated?: (qualities: StreamQualityCandidate[], masterHls?: string) => void;
  onHlsLevelsParsed?: (levels: StreamQualityCandidate[], activeHeight?: number) => void;
  onDecodedHeight?: (height: number | null) => void;
  onBufferingChange?: (buffering: boolean) => void;
  onVideoReadyChange?: (ready: boolean) => void;
  onRetriedRenewalChange?: (retried: boolean) => void;
  onAutoplayBlocked?: () => void;
  onPlaybackError?: (error: PlaybackErrorCode | null) => void;
  onPlaybackDiagnostic?: (diagnostic: PlaybackDiagnostic | null) => void;
  onFatalFailure?: (error: PlaybackErrorCode) => void;
}

export interface StreamAttachResult {
  status:
    | 'aborted'
    | 'stale'
    | 'reused_hls_level'
    | 'reused_transport'
    | 'attached_hls'
    | 'attached_native'
    | 'failed';
  generation: number;
  playPromise: Promise<void>;
  handleFailure: (failedUrl?: string, error?: unknown) => Promise<void>;
  cleanup: () => void;
}

interface SharedAttachSessionState {
  qualities: StreamQualityCandidate[];
  masterHlsUrl?: string;
  selectedQuality: number | 'auto';
  diagnostic?: PlaybackDiagnostic | null;
}

function buildHlsLevelQualities(levels: HlsLevelLike[]): StreamQualityCandidate[] {
  const deduped = new Map<number, StreamQualityCandidate>();
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const h = lvl.height || (lvl.name ? parseInt(lvl.name, 10) : 0);
    if (!h || !Number.isFinite(h) || h <= 0) continue;
    const candidate: StreamQualityCandidate = {
      height: h,
      label: formatQualityLabel(h),
      streamUrl: '',
      bitrate: lvl.bitrate,
    };
    const existing = deduped.get(h);
    if (!existing || (candidate.bitrate && (!existing.bitrate || candidate.bitrate > existing.bitrate))) {
      deduped.set(h, candidate);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => (b.height || 0) - (a.height || 0));
}

export function applyHlsQualityLevel(
  hls: HlsLikeInstance,
  selectedQuality: number | 'auto'
): void {
  if (!hls.levels || hls.levels.length <= 1) return;
  if (selectedQuality === 'auto') {
    hls.currentLevel = -1;
    return;
  }
  const idx = hls.levels.findIndex((lvl) => lvl.height === selectedQuality);
  if (idx !== -1) {
    hls.currentLevel = idx;
  }
}

interface AttachSessionRuntime {
  options: RunStreamAttachOptions;
  video: AttachableVideoElement;
  sessionState: SharedAttachSessionState;
  generation: number;
  restorePaused: boolean;
  startupTimeoutMs: number;
  setTimeoutFn: SetTimeoutFn;
  clearTimeoutFn: ClearTimeoutFn;
  isRestoreOrPlayActive: () => boolean;
  isCurrent: () => boolean;
  clearStartupTimeout: () => void;
  cleanupListeners: () => void;
  noopResult: (status: StreamAttachResult['status'], gen: number) => StreamAttachResult;
  markPlaybackFailed: (code?: PlaybackErrorCode, diagnostic?: PlaybackDiagnostic | null) => void;
  restorePosition: (allowAcrossGeneration?: boolean) => void;
  armStartupReadiness: (activeGeneration: number) => void;
  syncPendingResumeForReusedTransport: () => void;
}

/**
 * Merges renewed/fresh qualities and master HLS URL into session state
 * and selects the next playable candidate.
 */
function applyRenewalResolution(params: {
  streamUrl?: string;
  masterHls?: string;
  qualities?: StreamQualityCandidate[];
  sessionState: SharedAttachSessionState;
  failedUrls: ReadonlySet<string>;
  onQualitiesUpdated?: (qualities: StreamQualityCandidate[], masterHls?: string) => void;
}): StreamFallbackCandidate | null {
  const { streamUrl, masterHls, qualities, sessionState, failedUrls, onQualitiesUpdated } = params;
  const nextQualities = Array.isArray(qualities) ? qualities : [];
  if (nextQualities.length > 0) {
    sessionState.qualities = nextQualities;
  }
  if (masterHls) {
    sessionState.masterHlsUrl = masterHls;
  }
  if (nextQualities.length > 0 || masterHls) {
    onQualitiesUpdated?.(sessionState.qualities, sessionState.masterHlsUrl);
  }
  return resolveCandidateFromRenewalPayload({
    streamUrl,
    masterHlsUrl: masterHls,
    qualities: sessionState.qualities,
    selectedQuality: sessionState.selectedQuality,
    failedUrls,
  });
}

function createAttachSessionRuntime(
  options: RunStreamAttachOptions,
  video: AttachableVideoElement,
  sessionState: SharedAttachSessionState,
  generation: number
): AttachSessionRuntime {
  const {
    generationRef,
    mountedRef,
    hlsRef,
    loadedSrcRef,
    loadedMasterHlsRef,
    pendingResumeTimeRef,
    pendingMetadataCleanupRef,
    startupTimeoutRef,
    playbackIntentRef,
    restorePausedActiveRef,
    ignoringMediaEventsRef,
    restorePaused = false,
    startupTimeoutMs = PLAYER_STARTUP_TIMEOUT_MS,
    setTimeoutFn = (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeoutFn = (id) => globalThis.clearTimeout(id),
    onDecodedHeight,
    onBufferingChange,
    onPlaybackError,
    onPlaybackDiagnostic,
    onFatalFailure,
  } = options;

  const isRestoreOrPlayActive = () =>
    playbackIntentRef.current.isPlaying ||
    Boolean(restorePausedActiveRef ? restorePausedActiveRef.current : restorePaused);

  const isCurrent = () =>
    mountedRef.current && generationRef.current === generation && isRestoreOrPlayActive();

  const clearStartupTimeout = () => {
    if (startupTimeoutRef.current !== null) {
      clearTimeoutFn(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
  };

  const cleanupListeners = () => {
    clearStartupTimeout();
    pendingMetadataCleanupRef.current?.();
    pendingMetadataCleanupRef.current = null;
  };

  const noopResult = (
    status: StreamAttachResult['status'],
    gen: number
  ): StreamAttachResult => ({
    status,
    generation: gen,
    playPromise: Promise.resolve(),
    handleFailure: async () => {},
    cleanup: cleanupListeners,
  });

  const markPlaybackFailed = (code: PlaybackErrorCode = 'playback_failed', diagnostic?: PlaybackDiagnostic | null) => {
    if (!mountedRef.current) return;
    generationRef.current += 1;
    teardownMediaTransport({
      video,
      hlsRef,
      loadedSrcRef,
      loadedMasterHlsRef,
      startupTimeoutRef,
      clearTimeoutFn,
      pendingMetadataCleanupRef,
      ignoringMediaEventsRef,
      stripSrc: true,
      pauseVideo: true,
    });
    onBufferingChange?.(false);
    onDecodedHeight?.(null);
    onPlaybackDiagnostic?.(diagnostic ?? (code === 'startup_timeout' ? { stage: 'playback', code: 'startup_timeout' } : sessionState.diagnostic ?? null));
    onPlaybackError?.(code);
    onFatalFailure?.(code);
  };

  const restorePosition = (allowAcrossGeneration = false) => {
    if (!mountedRef.current) return;
    if (!allowAcrossGeneration && !isCurrent()) return;
    const resumeTime = pendingResumeTimeRef.current;
    if (resumeTime === null || resumeTime === undefined) return;
    if (resumeTime === 0) {
      pendingResumeTimeRef.current = null;
      if (video.readyState >= 1 && video.currentTime !== 0) {
        try {
          video.currentTime = 0;
        } catch {
          // Ignore seek errors on unready mock elements.
        }
      }
      return;
    }
    if (
      typeof resumeTime === 'number' &&
      Number.isFinite(resumeTime) &&
      resumeTime > 0 &&
      typeof video.duration === 'number' &&
      Number.isFinite(video.duration) &&
      video.duration > 0
    ) {
      const target = clampSeekTime(resumeTime, video.duration);
      try {
        video.currentTime = target;
        pendingResumeTimeRef.current = null;
      } catch {
        // Metadata may still be incomplete; loadedmetadata retries seek.
      }
    }
  };

  const armStartupReadiness = (activeGeneration: number) => {
    const onReadyClear = () => {
      if (!mountedRef.current) return;
      clearStartupTimeout();
    };
    const onMetadataEvent = () => {
      applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
      restorePosition(false);
    };

    if (!restorePaused && startupTimeoutMs > 0 && startupTimeoutRef.current === null) {
      startupTimeoutRef.current = setTimeoutFn(() => {
        startupTimeoutRef.current = null;
        if (!mountedRef.current || generationRef.current !== activeGeneration) return;
        if (!playbackIntentRef.current.isPlaying) return;
        markPlaybackFailed('startup_timeout');
      }, startupTimeoutMs);
    }

    pendingMetadataCleanupRef.current?.();
    video.addEventListener('loadedmetadata', onMetadataEvent);
    video.addEventListener('loadeddata', onReadyClear);
    video.addEventListener('canplay', onReadyClear);
    video.addEventListener('playing', onReadyClear);

    pendingMetadataCleanupRef.current = () => {
      video.removeEventListener('loadedmetadata', onMetadataEvent);
      video.removeEventListener('loadeddata', onReadyClear);
      video.removeEventListener('canplay', onReadyClear);
      video.removeEventListener('playing', onReadyClear);
    };
  };

  const syncPendingResumeForReusedTransport = () => {
    if (pendingResumeTimeRef.current === null) return;
    if (video.readyState >= 1) {
      restorePosition(false);
    } else if (restorePaused) {
      armStartupReadiness(generation);
    }
  };

  return {
    options,
    video,
    sessionState,
    generation,
    restorePaused,
    startupTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    isRestoreOrPlayActive,
    isCurrent,
    clearStartupTimeout,
    cleanupListeners,
    noopResult,
    markPlaybackFailed,
    restorePosition,
    armStartupReadiness,
    syncPendingResumeForReusedTransport,
  };
}

function createFailureHandler(
  runtime: AttachSessionRuntime,
  attachAgain: (
    nextOptions: RunStreamAttachOptions,
    shared: SharedAttachSessionState
  ) => Promise<StreamAttachResult>
): (failedUrl?: string, error?: unknown) => Promise<void> {
  const { options, sessionState, isRestoreOrPlayActive, markPlaybackFailed } = runtime;
  const {
    mountedRef,
    generationRef,
    loadedSrcRef,
    failedUrlsRef,
    renewalAttemptedRef,
    renewalInFlightRef,
    streamUrl,
    fetchFreshQualities,
    renewStream,
    onQualitiesUpdated,
    onRetriedRenewalChange,
  } = options;

  return async (failedUrl?: string, error?: unknown) => {
    if (!mountedRef.current || !isRestoreOrPlayActive() || renewalInFlightRef.current) return;

    const hlsFailure = typeof error === 'object' && error !== null && 'hlsDiagnostic' in error;
    const diagnostic = hlsFailure
      ? fromHlsError((error as { hlsDiagnostic: unknown }).hlsDiagnostic)
      : error === 'startup_timeout'
        ? { stage: 'playback' as const, code: 'startup_timeout' as const }
        : fromMediaError(error);
    if (diagnostic && diagnostic.code !== 'unknown') sessionState.diagnostic = diagnostic;

    const failedTarget = failedUrl || loadedSrcRef.current || streamUrl;
    if (failedTarget) {
      failedUrlsRef.current.add(failedTarget);
    }

    const effectiveFailedSet = expandNormalizedFailedUrls(
      failedUrlsRef.current,
      sessionState.qualities,
      sessionState.masterHlsUrl
    );
    const safeCatalogMaster =
      sessionState.masterHlsUrl && !isUrlInFailedSet(sessionState.masterHlsUrl, effectiveFailedSet)
        ? sessionState.masterHlsUrl
        : undefined;
    const maxCandidatesBound = Math.max(8, sessionState.qualities.length + 3);

    const localFallback =
      failedUrlsRef.current.size < maxCandidatesBound
        ? pickFallbackStreamCandidate({
            activeStreamUrl: failedTarget,
            qualities: toTimelineVideoQualities(sessionState.qualities),
            masterHlsUrl: safeCatalogMaster,
            selectedQuality: sessionState.selectedQuality,
            failedUrls: effectiveFailedSet,
          })
        : null;

    if (localFallback && !isUrlInFailedSet(localFallback.streamUrl, effectiveFailedSet)) {
      await attachAgain(
        {
          ...options,
          streamUrl: localFallback.streamUrl,
          masterHlsUrl:
            localFallback.masterHls && !isUrlInFailedSet(localFallback.masterHls, effectiveFailedSet)
              ? localFallback.masterHls
              : undefined,
          qualities: sessionState.qualities,
          selectedQuality: sessionState.selectedQuality,
          forceReload: true,
        },
        sessionState
      );
      return;
    }

    const canRenew =
      !renewalAttemptedRef.current && Boolean(renewStream || fetchFreshQualities);
    if (canRenew) {
      renewalAttemptedRef.current = true;
      renewalInFlightRef.current = true;
      onRetriedRenewalChange?.(true);
      const renewalGeneration = generationRef.current;

      let renewedCandidate: StreamFallbackCandidate | null = null;
      try {
        if (renewStream) {
          const renewed = await renewStream(failedTarget, renewalGeneration);
          if (!mountedRef.current || generationRef.current !== renewalGeneration) return;
          if (!isRestoreOrPlayActive()) return;
          if (renewed) {
            if (renewed.diagnostic && (renewed.diagnostic.code !== 'unknown' || !sessionState.diagnostic)) sessionState.diagnostic = renewed.diagnostic;
            renewedCandidate = applyRenewalResolution({
              streamUrl: renewed.streamUrl,
              masterHls: renewed.masterHls || renewed.masterHlsUrl,
              qualities: renewed.qualities,
              sessionState,
              failedUrls: failedUrlsRef.current,
              onQualitiesUpdated,
            });
          }
        } else if (fetchFreshQualities) {
          const fresh = await fetchFreshQualities(true, renewalGeneration);
          if (!mountedRef.current || generationRef.current !== renewalGeneration) return;
          if (!isRestoreOrPlayActive()) return;
          if (fresh) {
            if (fresh.diagnostic && (fresh.diagnostic.code !== 'unknown' || !sessionState.diagnostic)) sessionState.diagnostic = fresh.diagnostic;
            renewedCandidate = applyRenewalResolution({
              masterHls: fresh.masterHls,
              qualities: fresh.qualities,
              sessionState,
              failedUrls: failedUrlsRef.current,
              onQualitiesUpdated,
            });
          }
        }
      } catch {
        renewedCandidate = null;
      } finally {
        renewalInFlightRef.current = false;
      }

      if (!mountedRef.current || generationRef.current !== renewalGeneration) return;
      if (!isRestoreOrPlayActive()) return;

      if (renewedCandidate) {
        const postRenewalFailed = expandNormalizedFailedUrls(
          failedUrlsRef.current,
          sessionState.qualities,
          sessionState.masterHlsUrl
        );
        if (!isUrlInFailedSet(renewedCandidate.streamUrl, postRenewalFailed)) {
          await attachAgain(
            {
              ...options,
              streamUrl: renewedCandidate.streamUrl,
              masterHlsUrl:
                renewedCandidate.masterHls &&
                !isUrlInFailedSet(renewedCandidate.masterHls, postRenewalFailed)
                  ? renewedCandidate.masterHls
                  : undefined,
              qualities: sessionState.qualities,
              selectedQuality: sessionState.selectedQuality,
              forceReload: true,
            },
            sessionState
          );
          return;
        }
      }
    }

    const code: PlaybackErrorCode =
      error === 'startup_timeout'
        ? 'startup_timeout'
        : error === 'hls_fatal' || hlsFailure
          ? 'hls_fatal'
          : 'playback_failed';
    markPlaybackFailed(code);
  };
}

function createPlayExecutor(
  runtime: AttachSessionRuntime,
  chosenStream: string,
  handleFailure: (failedUrl?: string, error?: unknown) => Promise<void>
): (activeHls?: HlsLikeInstance) => Promise<void> {
  const { options, video, isCurrent, clearStartupTimeout } = runtime;
  const {
    hlsRef,
    loadedSrcRef,
    playbackIntentRef,
    onBufferingChange,
    onVideoReadyChange,
    onPlaybackError,
    onAutoplayBlocked,
  } = options;

  return (activeHls?: HlsLikeInstance): Promise<void> => {
    let result: Promise<void> | undefined;
    try {
      result = video.play();
    } catch (syncError) {
      result = Promise.reject(syncError);
    }
    if (!result || typeof result.then !== 'function') {
      if (video.readyState >= 2) {
        clearStartupTimeout();
        onBufferingChange?.(false);
        onVideoReadyChange?.(true);
      }
      return Promise.resolve();
    }
    return result.then(
      () => {
        if (activeHls ? hlsRef.current !== activeHls : !isCurrent()) return;
        if (video.readyState >= 2) {
          clearStartupTimeout();
          onBufferingChange?.(false);
          onVideoReadyChange?.(true);
        }
      },
      (error: unknown) => {
        const action = classifyPlayError(error);
        if (action === 'ignore') return;
        if (activeHls ? hlsRef.current !== activeHls : !isCurrent()) return;
        if (action === 'autoplay_blocked') {
          clearStartupTimeout();
          playbackIntentRef.current.isPlaying = false;
          onBufferingChange?.(false);
          onPlaybackError?.(null);
          onAutoplayBlocked?.();
          return;
        }
        return handleFailure(loadedSrcRef.current || chosenStream, error);
      }
    );
  };
}

async function resolveInitialWatchStream(
  runtime: AttachSessionRuntime,
  handleFailure: (failedUrl?: string, error?: unknown) => Promise<void>
): Promise<
  | { kind: 'ok'; chosenStream: string; effectiveMasterHls: string | undefined }
  | { kind: 'done'; result: StreamAttachResult }
> {
  const {
    options,
    sessionState,
    generation,
    restorePaused,
    isCurrent,
    cleanupListeners,
    markPlaybackFailed,
  } = runtime;
  const {
    failedUrlsRef,
    qualitiesFetchedRef,
    streamUrl,
    masterHlsUrl,
    sourceUrl,
    sourceType,
    fetchFreshQualities,
    onQualitiesUpdated,
    onBufferingChange,
  } = options;

  let effectiveStream = streamUrl;
  let effectiveMasterHls = masterHlsUrl;

  const initialFailedSet = expandNormalizedFailedUrls(
    failedUrlsRef.current,
    sessionState.qualities,
    effectiveMasterHls
  );
  if (effectiveMasterHls && isUrlInFailedSet(effectiveMasterHls, initialFailedSet)) {
    effectiveMasterHls = undefined;
  }

  if (!effectiveStream && !effectiveMasterHls) {
    markPlaybackFailed('stream_unavailable');
    return {
      kind: 'done',
      result: {
        status: 'failed',
        generation,
        playPromise: Promise.resolve(),
        handleFailure,
        cleanup: cleanupListeners,
      },
    };
  }

  const needsInitialWatchResolution =
    (sourceType === 'youtube' || isWatchPageOnlyUrl(effectiveStream || sourceUrl)) &&
    !effectiveMasterHls &&
    sessionState.qualities.length === 0;

  if (needsInitialWatchResolution && fetchFreshQualities) {
    onBufferingChange?.(true);
    const fresh = await fetchFreshQualities(true, generation);
    if (!isCurrent()) {
      return {
        kind: 'done',
        result: {
          status: 'stale',
          generation,
          playPromise: Promise.resolve(),
          handleFailure,
          cleanup: cleanupListeners,
        },
      };
    }
    if (fresh) {
      if (fresh.diagnostic) sessionState.diagnostic = fresh.diagnostic;
      if (fresh.qualities.length > 0) {
        sessionState.qualities = fresh.qualities;
      }
      const postFetchFailed = expandNormalizedFailedUrls(
        failedUrlsRef.current,
        sessionState.qualities,
        fresh.masterHls
      );
      if (fresh.masterHls && !isUrlInFailedSet(fresh.masterHls, postFetchFailed)) {
        sessionState.masterHlsUrl = fresh.masterHls;
        effectiveMasterHls = fresh.masterHls;
        effectiveStream = fresh.masterHls;
      } else if (fresh.qualities.length > 0) {
        const pref = fresh.qualities.find((q) => q.height === 720) || fresh.qualities[0];
        if (pref?.streamUrl) {
          effectiveStream = pref.streamUrl;
        }
      }
      if (fresh.qualities.length > 0 || fresh.masterHls) {
        onQualitiesUpdated?.(sessionState.qualities, effectiveMasterHls);
      }
    }
    if (
      !effectiveMasterHls &&
      sessionState.qualities.length === 0 &&
      isWatchPageOnlyUrl(effectiveStream)
    ) {
      markPlaybackFailed('stream_unavailable');
      return {
        kind: 'done',
        result: {
          status: 'failed',
          generation,
          playPromise: Promise.resolve(),
          handleFailure,
          cleanup: cleanupListeners,
        },
      };
    }
  } else if (!restorePaused && !qualitiesFetchedRef?.current && fetchFreshQualities) {
    void fetchFreshQualities(false, generation);
  }

  const runtimeFailedSet = expandNormalizedFailedUrls(
    failedUrlsRef.current,
    sessionState.qualities,
    effectiveMasterHls
  );
  if (effectiveMasterHls && isUrlInFailedSet(effectiveMasterHls, runtimeFailedSet)) {
    effectiveMasterHls = undefined;
  }

  let chosenStream =
    effectiveMasterHls && (sessionState.selectedQuality === 'auto' || sourceType === 'youtube')
      ? effectiveMasterHls
      : effectiveStream;

  if (chosenStream && isUrlInFailedSet(chosenStream, runtimeFailedSet)) {
    const recovered = pickFallbackStreamCandidate({
      activeStreamUrl: chosenStream,
      qualities: toTimelineVideoQualities(sessionState.qualities),
      masterHlsUrl: effectiveMasterHls,
      selectedQuality: sessionState.selectedQuality,
      failedUrls: runtimeFailedSet,
    });
    if (recovered && !isUrlInFailedSet(recovered.streamUrl, runtimeFailedSet)) {
      chosenStream = recovered.streamUrl;
      effectiveMasterHls =
        recovered.masterHls && !isUrlInFailedSet(recovered.masterHls, runtimeFailedSet)
          ? recovered.masterHls
          : undefined;
    } else {
      chosenStream = '';
    }
  }

  if (!chosenStream) {
    markPlaybackFailed('stream_unavailable');
    return {
      kind: 'done',
      result: {
        status: 'failed',
        generation,
        playPromise: Promise.resolve(),
        handleFailure,
        cleanup: cleanupListeners,
      },
    };
  }

  return { kind: 'ok', chosenStream, effectiveMasterHls };
}

async function tryReuseActiveTransport(
  runtime: AttachSessionRuntime,
  chosenStream: string,
  effectiveMasterHls: string | undefined,
  handleFailure: (failedUrl?: string, error?: unknown) => Promise<void>,
  playWithErrorHandling: (activeHls?: HlsLikeInstance) => Promise<void>
): Promise<StreamAttachResult | null> {
  const {
    options,
    video,
    sessionState,
    generation,
    restorePaused,
    cleanupListeners,
    armStartupReadiness,
    syncPendingResumeForReusedTransport,
  } = runtime;
  const { hlsRef, loadedSrcRef, playbackIntentRef, forceReload = false } = options;

  if (
    !forceReload &&
    hlsRef.current &&
    effectiveMasterHls &&
    normalizeComparableStreamUrl(loadedSrcRef.current) ===
      normalizeComparableStreamUrl(effectiveMasterHls) &&
    hlsRef.current.levels &&
    hlsRef.current.levels.length > 1
  ) {
    applyHlsQualityLevel(hlsRef.current, sessionState.selectedQuality);
    applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
    syncPendingResumeForReusedTransport();
    let playTask = Promise.resolve();
    if (video.paused && !restorePaused) {
      if (video.readyState < 2) {
        armStartupReadiness(generation);
      }
      hlsRef.current.startLoad?.();
      playTask = playWithErrorHandling(hlsRef.current);
      await Promise.resolve();
    }
    return {
      status: 'reused_hls_level',
      generation,
      playPromise: playTask,
      handleFailure,
      cleanup: cleanupListeners,
    };
  }

  const hasActiveElementSrc = Boolean(
    video.src || video.getAttribute?.('src') || hlsRef.current
  );
  if (
    !forceReload &&
    hasActiveElementSrc &&
    loadedSrcRef.current &&
    normalizeComparableStreamUrl(loadedSrcRef.current) ===
      normalizeComparableStreamUrl(chosenStream)
  ) {
    video.preload = 'auto';
    applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
    syncPendingResumeForReusedTransport();
    let playTask = Promise.resolve();
    if (video.paused && !restorePaused) {
      if (video.readyState < 2) {
        armStartupReadiness(generation);
      }
      hlsRef.current?.startLoad?.();
      playTask = playWithErrorHandling(hlsRef.current ?? undefined);
      await Promise.resolve();
    }
    return {
      status: 'reused_transport',
      generation,
      playPromise: playTask,
      handleFailure,
      cleanup: cleanupListeners,
    };
  }

  return null;
}

function attachHlsTransport(
  runtime: AttachSessionRuntime,
  chosenStream: string,
  HlsClass: HlsConstructorLike,
  handleFailure: (failedUrl?: string, error?: unknown) => Promise<void>,
  playWithErrorHandling: (activeHls?: HlsLikeInstance) => Promise<void>
): StreamAttachResult {
  const {
    options,
    video,
    sessionState,
    generation,
    restorePaused,
    isRestoreOrPlayActive,
    cleanupListeners,
    restorePosition,
  } = runtime;
  const {
    mountedRef,
    hlsRef,
    loadedSrcRef,
    playbackIntentRef,
    restorePausedActiveRef,
    ignoringMediaEventsRef,
    onHlsLevelsParsed,
    onDecodedHeight,
    onBufferingChange,
  } = options;

  loadedSrcRef.current = chosenStream;
  const hls = new HlsClass({
    enableWorker: true,
    lowLatencyMode: false,
    startLevel: -1,
  });
  hlsRef.current = hls;
  hls.loadSource(chosenStream);
  if (ignoringMediaEventsRef) ignoringMediaEventsRef.current = true;
  try {
    hls.attachMedia(video);
    applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
  } finally {
    if (ignoringMediaEventsRef) ignoringMediaEventsRef.current = false;
  }

  // Guard Hls callbacks by active instance identity so lifecycle bumps (pause/play/selectQuality) never orphan events
  const isActiveHlsInstance = () => mountedRef.current && hlsRef.current === hls;

  hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
    if (!isActiveHlsInstance()) return;
    if (hls.levels && hls.levels.length > 0) {
      const parsedLevels = buildHlsLevelQualities(hls.levels);
      applyHlsQualityLevel(hls, sessionState.selectedQuality);
      const activeHeight =
        hls.currentLevel >= 0 ? hls.levels[hls.currentLevel]?.height : parsedLevels[0]?.height;
      onHlsLevelsParsed?.(parsedLevels, activeHeight);
    }
    applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
    restorePosition(true);
    video.muted = playbackIntentRef.current.isMuted;
    const shouldPlayNow =
      playbackIntentRef.current.isPlaying &&
      (restorePausedActiveRef ? !restorePausedActiveRef.current : !restorePaused);
    if (shouldPlayNow) {
      void playWithErrorHandling(hls);
    } else {
      onBufferingChange?.(false);
    }
  });

  if (HlsClass.Events.LEVEL_SWITCHED) {
    hls.on(HlsClass.Events.LEVEL_SWITCHED, (_evt, data) => {
      if (!isActiveHlsInstance()) return;
      const lvl = hls.levels?.[data?.level];
      if (lvl?.height) {
        onDecodedHeight?.(lvl.height);
      }
    });
  }

  if (HlsClass.Events.LEVEL_LOADED) {
    hls.on(HlsClass.Events.LEVEL_LOADED, (_evt, data) => {
      if (!isActiveHlsInstance()) return;
      const lvl = hls.levels?.[data?.level];
      if (lvl?.height) {
        onDecodedHeight?.(lvl.height);
      }
    });
  }

  hls.on(HlsClass.Events.ERROR, (_evt, data) => {
    if (data?.fatal && isActiveHlsInstance() && isRestoreOrPlayActive()) {
      void handleFailure(chosenStream, { hlsDiagnostic: data });
    }
  });

  return {
    status: 'attached_hls',
    generation,
    playPromise: Promise.resolve(),
    handleFailure,
    cleanup: cleanupListeners,
  };
}

async function attachNativeTransport(
  runtime: AttachSessionRuntime,
  chosenStream: string,
  handleFailure: (failedUrl?: string, error?: unknown) => Promise<void>,
  playWithErrorHandling: (activeHls?: HlsLikeInstance) => Promise<void>
): Promise<StreamAttachResult> {
  const { options, video, generation, restorePaused, cleanupListeners, restorePosition } = runtime;
  const { loadedSrcRef, playbackIntentRef, ignoringMediaEventsRef, onBufferingChange } = options;

  loadedSrcRef.current = chosenStream;
  applyInlineVideoAttrs(video, playbackIntentRef.current.isMuted);
  if (ignoringMediaEventsRef) ignoringMediaEventsRef.current = true;
  try {
    applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
    video.src = chosenStream;
    applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
  } finally {
    if (ignoringMediaEventsRef) ignoringMediaEventsRef.current = false;
  }

  if (video.readyState >= 1) {
    restorePosition(false);
  }
  if (video.readyState >= 2) {
    runtime.clearStartupTimeout();
    onBufferingChange?.(false);
    options.onVideoReadyChange?.(true);
  }

  let playTask = Promise.resolve();
  if (!restorePaused) {
    playTask = playWithErrorHandling();
    await Promise.resolve();
  } else {
    onBufferingChange?.(false);
  }

  return {
    status: 'attached_native',
    generation,
    playPromise: playTask,
    handleFailure,
    cleanup: cleanupListeners,
  };
}

/**
 * Pure async coordinator managing generation-guarded stream attachment,
 * HLS MSE vs native iOS Safari fallback, relative/localhost URL reuse,
 * 20s startup timeout, non-fatal autoplay block handling, and max-1 stream renewal
 * with ABR candidate downgrade.
 */
export async function runStreamAttachWithGeneration(
  options: RunStreamAttachOptions,
  internalSessionState?: SharedAttachSessionState
): Promise<StreamAttachResult> {
  const {
    video,
    generationRef,
    mountedRef,
    hlsRef,
    loadedSrcRef,
    loadedMasterHlsRef,
    pendingMetadataCleanupRef,
    startupTimeoutRef,
    playbackIntentRef,
    streamUrl,
    masterHlsUrl,
    qualities = [],
    selectedQuality,
    restorePaused = false,
    HlsClass = DefaultHlsClass,
    onDecodedHeight,
    onBufferingChange,
    onVideoReadyChange,
    onPlaybackError,
    onFailureHandlerReady,
  } = options;

  const sessionState: SharedAttachSessionState = internalSessionState || {
    qualities: [...qualities],
    masterHlsUrl,
    selectedQuality,
  };
  if (!internalSessionState) {
    sessionState.qualities = [...qualities];
    sessionState.masterHlsUrl = masterHlsUrl;
    sessionState.selectedQuality = selectedQuality;
  }

  const noopPrecheck = (status: StreamAttachResult['status']): StreamAttachResult => ({
    status,
    generation: generationRef.current,
    playPromise: Promise.resolve(),
    handleFailure: async () => {},
    cleanup: () => {
      if (startupTimeoutRef.current !== null) {
        (options.clearTimeoutFn || ((id) => globalThis.clearTimeout(id)))(startupTimeoutRef.current);
        startupTimeoutRef.current = null;
      }
      pendingMetadataCleanupRef.current?.();
      pendingMetadataCleanupRef.current = null;
    },
  });

  if (!video || !mountedRef.current) {
    return noopPrecheck('aborted');
  }
  const restoreActive = Boolean(
    options.restorePausedActiveRef ? options.restorePausedActiveRef.current : restorePaused
  );
  if (!playbackIntentRef.current.isPlaying && !restoreActive && !restorePaused) {
    return noopPrecheck('aborted');
  }

  const generation = ++generationRef.current;
  const runtime = createAttachSessionRuntime(options, video, sessionState, generation);
  const handleFailure = createFailureHandler(runtime, runStreamAttachWithGeneration);
  onFailureHandlerReady?.(generation, handleFailure);

  video.muted = playbackIntentRef.current.isMuted;

  const resolved = await resolveInitialWatchStream(runtime, handleFailure);
  if (resolved.kind === 'done') {
    return resolved.result;
  }

  const { chosenStream, effectiveMasterHls } = resolved;
  const playWithErrorHandling = createPlayExecutor(runtime, chosenStream, handleFailure);

  const reused = await tryReuseActiveTransport(
    runtime,
    chosenStream,
    effectiveMasterHls,
    handleFailure,
    playWithErrorHandling
  );
  if (reused) {
    return reused;
  }

  teardownMediaTransport({
    video: null,
    hlsRef,
    loadedSrcRef,
    loadedMasterHlsRef,
    startupTimeoutRef,
    clearTimeoutFn: runtime.clearTimeoutFn,
    pendingMetadataCleanupRef,
    stripSrc: false,
    pauseVideo: false,
  });

  onVideoReadyChange?.(false);
  onDecodedHeight?.(null);
  onBufferingChange?.(true);
  onPlaybackError?.(null);

  const useHls = isHlsStreamUrl(chosenStream);
  const hlsSupported = Boolean(
    HlsClass && typeof HlsClass.isSupported === 'function' && HlsClass.isSupported()
  );
  loadedMasterHlsRef.current = useHls ? chosenStream : undefined;

  runtime.armStartupReadiness(generation);

  applyPlaybackRateToVideo(video, playbackIntentRef.current.playbackRate);
  if (
    typeof playbackIntentRef.current.volume === 'number' &&
    Number.isFinite(playbackIntentRef.current.volume)
  ) {
    video.volume = clampVolume(playbackIntentRef.current.volume, 1);
  }

  if (useHls && hlsSupported && HlsClass) {
    return attachHlsTransport(runtime, chosenStream, HlsClass, handleFailure, playWithErrorHandling);
  }

  return attachNativeTransport(runtime, chosenStream, handleFailure, playWithErrorHandling);
}
