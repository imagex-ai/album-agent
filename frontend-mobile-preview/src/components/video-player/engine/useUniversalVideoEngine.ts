/**
 * useUniversalVideoEngine.ts
 *
 * Headless React hook orchestrating universal video playback across card,
 * cinema, compact, and mini-player shells. Delegates pure transport/HLS/
 * fallback/snapshot orchestration to ./streamAttachCoordinator.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  isHlsStreamUrl,
  normalizeComparableStreamUrl,
  clampSeekTime,
  type StreamQualityCandidate,
  type UniversalVideoSource,
  type PlaybackHandoffSnapshot,
} from './videoPlayerCore';
import { isWatchPageOnlyUrl } from '../../profile-hub/timeline/timelineModel';
import { parsePlaybackDiagnostic, type PlaybackDiagnostic } from './playbackDiagnostics';
import {
  DefaultHlsClass,
  applyHlsQualityLevel,
  applyInlineVideoAttrs,
  applyPlaybackRateToVideo,
  bindVideoElementEvents,
  buildPlaybackSnapshot,
  clampVolume,
  computeBufferedPercent,
  fetchQualitiesGuarded,
  normalizeQualityCandidates,
  resolvePlayableStreamUrl,
  runStreamAttachWithGeneration,
  sanitizePlaybackRate,
  teardownMediaTransport,
  toTimelineVideoQualities,
  type AttachableVideoElement,
  type ClearTimeoutFn,
  type FetchQualitiesGuardedOptions,
  type BuildPlaybackSnapshotOptions,
  type HlsConstructorLike,
  type HlsLevelLike,
  type HlsLikeInstance,
  type PlaybackErrorCode,
  type PlaybackIntentState,
  type RunStreamAttachOptions,
  type SetTimeoutFn,
  type StreamAttachResult,
  type StreamQualitiesResolution,
  type StreamRenewalResolution,
  type TimerHandle,
} from './streamAttachCoordinator';

export {
  fetchQualitiesGuarded,
  buildPlaybackSnapshot,
  toTimelineVideoQualities,
  resolvePlayableStreamUrl,
  runStreamAttachWithGeneration,
};
export type {
  PlaybackErrorCode,
  AttachableVideoElement,
  HlsLevelLike,
  HlsLikeInstance,
  HlsConstructorLike,
  TimerHandle,
  SetTimeoutFn,
  ClearTimeoutFn,
  FetchQualitiesGuardedOptions,
  BuildPlaybackSnapshotOptions,
  PlaybackIntentState,
  StreamQualitiesResolution,
  StreamRenewalResolution,
  RunStreamAttachOptions,
  StreamAttachResult,
};

export interface UseUniversalVideoEngineOptions {
  source: UniversalVideoSource | null | undefined;
  initialHandoff?: PlaybackHandoffSnapshot | null;
  autoPlay?: boolean;
  playing?: boolean;
  muted?: boolean;
  initialMuted?: boolean;
  initialVolume?: number;
  initialPlaybackRate?: number;
  initialQuality?: number | 'auto';
  suspended?: boolean;
  preloadMetadata?: boolean;
  restorePaused?: boolean;
  persistQualityKey?: string | false;
  HlsClass?: HlsConstructorLike | null;
  onQualitiesFetched?: (data: { qualities: StreamQualityCandidate[]; masterHlsUrl?: string }) => void;
  onFetchQualities?: (
    targetUrl: string,
    referer?: string,
    signal?: AbortSignal
  ) => Promise<{
    qualities?: StreamQualityCandidate[];
    master_hls_url?: string;
    masterHlsUrl?: string;
    masterHls?: string;
    target_page?: string;
    diagnostic?: unknown;
  } | null>;
  onRenewStream?: (
    failedUrl: string,
    source: UniversalVideoSource
  ) => Promise<StreamRenewalResolution | null>;
  onAutoplayBlocked?: () => void;
  onPlaybackError?: (error: PlaybackErrorCode | null) => void;
  onPlaybackStateChange?: (state: {
    isPlaying: boolean;
    isMuted: boolean;
    isBuffering: boolean;
    isVideoReady: boolean;
    currentTime: number;
    duration: number;
    playbackError: PlaybackErrorCode | null;
  }) => void;
  onEnded?: () => void;
  onTimeUpdateFrame?: (currentTime: number, duration: number) => void;
}

export interface UseUniversalVideoEngineResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  bufferedPercent: number;
  playbackRate: number;
  selectedQuality: number | 'auto';
  qualities: StreamQualityCandidate[];
  masterHlsUrl: string | undefined;
  activeStreamUrl: string;
  isBuffering: boolean;
  isVideoReady: boolean;
  decodedHeight: number | null;
  decodedAspectRatio: number | null;
  playbackError: PlaybackErrorCode | null;
  playbackDiagnostic: PlaybackDiagnostic | null;
  retriedRenewal: boolean;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seekTo: (seconds: number) => void;
  skipBy: (deltaSeconds: number) => void;
  setMuted: (muted: boolean | ((prev: boolean) => boolean)) => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  selectQuality: (quality: number | 'auto') => void;
  retryRenewal: () => void;
  suspendStream: () => void;
  capturePlaybackSnapshot: () => PlaybackHandoffSnapshot;
}

interface EngineSourceState {
  boundSourceKey: string;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playbackRate: number;
  currentTime: number;
  duration: number;
  bufferedPercent: number;
  qualities: StreamQualityCandidate[];
  masterHlsUrl: string | undefined;
  selectedQuality: number | 'auto';
  isBuffering: boolean;
  isVideoReady: boolean;
  decodedHeight: number | null;
  decodedAspectRatio: number | null;
  playbackError: PlaybackErrorCode | null;
  playbackDiagnostic: PlaybackDiagnostic | null;
  retriedRenewal: boolean;
}

function readPersistedQuality(key?: string | false): number | 'auto' | undefined {
  if (!key || typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return undefined;
    if (raw === 'auto') return 'auto';
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : undefined;
  } catch {
    return undefined;
  }
}

function resolveValidatedQuality(
  desired: number | 'auto',
  hasExplicitHandoffQuality: boolean,
  availableQualities: readonly StreamQualityCandidate[],
  hasMasterHls: boolean
): number | 'auto' {
  if (hasExplicitHandoffQuality) return desired;
  if (typeof desired === 'number' && !hasMasterHls && availableQualities.length > 0) {
    return availableQualities.some((q) => q.height === desired) ? desired : 'auto';
  }
  return desired;
}

function getHandoffSignature(handoff?: PlaybackHandoffSnapshot | null): string {
  if (!handoff) return '';
  const qCount = Array.isArray(handoff.qualities) ? handoff.qualities.length : 0;
  const firstUrl = qCount > 0 ? handoff.qualities?.[0]?.streamUrl || '' : '';
  return [
    handoff.currentTime,
    Boolean(handoff.isPlaying),
    handoff.isMuted,
    handoff.volume,
    handoff.playbackRate,
    handoff.selectedQuality,
    handoff.masterHlsUrl || '',
    qCount,
    firstUrl,
  ].join('|');
}

function resolveActiveStreamUrlFromParts(options: {
  selectedQuality: number | 'auto';
  qualities: readonly StreamQualityCandidate[];
  masterHlsUrl?: string;
  source: UniversalVideoSource | null | undefined;
  canonicalReferer?: string;
}): string {
  const { selectedQuality, qualities, masterHlsUrl, source, canonicalReferer } = options;
  if (selectedQuality !== 'auto') {
    const matched = qualities.find((q) => q.height === selectedQuality);
    if (matched?.streamUrl) return matched.streamUrl;
  }
  if (masterHlsUrl) return masterHlsUrl;
  if (qualities.length > 0) {
    const pref = qualities.find((q) => q.height === 720) || qualities[0];
    if (pref?.streamUrl) return pref.streamUrl;
  }
  const rawPost = source?.rawPost as { youtubeId?: string } | undefined;
  const ytId = rawPost?.youtubeId;
  if (source?.streamUrl && !isWatchPageOnlyUrl(source.streamUrl)) {
    return resolvePlayableStreamUrl(source.streamUrl, canonicalReferer, undefined, ytId);
  }
  if (source?.previewVideoUrl) {
    return resolvePlayableStreamUrl(source.previewVideoUrl, canonicalReferer);
  }
  return resolvePlayableStreamUrl(
    source?.streamUrl || source?.originalUrl || source?.sourceUrl,
    canonicalReferer,
    undefined,
    ytId
  );
}

function unwrapProxyTargetUrl(rawUrl: string): string {
  let current = rawUrl.trim();
  let guard = 0;
  while (current.includes('/api/proxy-video-stream') && guard < 5) {
    guard += 1;
    const mRef = current.match(/[?&]referer=([^&]+)/);
    const mUrl = current.match(/[?&]url=([^&]+)/);
    if (mRef) {
      current = decodeURIComponent(mRef[1]);
      break;
    }
    if (mUrl) {
      current = decodeURIComponent(mUrl[1]);
    } else {
      break;
    }
  }
  return current;
}

function isLocalNonWebQualitiesUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return true;
  const localPrefixes = ['/api/videos/', '/api/albums/', '/api/trash/', '/api/scraper/'];
  if (localPrefixes.some((p) => trimmed.startsWith(p))) return true;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        localPrefixes.some((p) => parsed.pathname.startsWith(p))
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * React headless hook orchestrating universal video playback across card, cinema,
 * compact, and mini-player shells.
 */
export function useUniversalVideoEngine(
  options: UseUniversalVideoEngineOptions
): UseUniversalVideoEngineResult {
  const {
    source,
    initialHandoff,
    autoPlay = false,
    playing: controlledPlaying,
    muted: controlledMuted,
    initialMuted = true,
    initialVolume = 1,
    initialPlaybackRate = 1,
    initialQuality = 'auto',
    suspended = false,
    preloadMetadata = false,
    restorePaused: restorePausedProp,
    persistQualityKey = false,
    HlsClass = DefaultHlsClass,
    onQualitiesFetched,
    onFetchQualities,
    onRenewStream,
    onAutoplayBlocked,
    onPlaybackError,
    onPlaybackStateChange,
    onEnded,
    onTimeUpdateFrame,
  } = options;

  const sourceKey = source
    ? source.id || source.originalUrl || source.sourceUrl || source.streamUrl || ''
    : '';

  const canonicalReferer = useMemo(() => {
    if (source?.originalUrl && source.originalUrl.startsWith('http')) return source.originalUrl;
    if (source?.sourceUrl && source.sourceUrl.startsWith('http')) return source.sourceUrl;
    const rawPost = source?.rawPost as { youtubeId?: string } | undefined;
    if (rawPost?.youtubeId) return `https://www.youtube.com/watch?v=${rawPost.youtubeId}`;
    return undefined;
  }, [source?.originalUrl, source?.sourceUrl, source?.rawPost]);

  const incomingQualities = useMemo(
    () =>
      normalizeQualityCandidates(
        initialHandoff?.qualities || source?.qualities,
        canonicalReferer
      ),
    [initialHandoff?.qualities, source?.qualities, canonicalReferer]
  );

  const incomingMasterHls = initialHandoff?.masterHlsUrl || source?.masterHlsUrl;

  const buildInitialStateForCurrentProps = (): EngineSourceState => {
    const rawDesiredQuality =
      initialHandoff?.selectedQuality ?? readPersistedQuality(persistQualityKey) ?? initialQuality;
    const hasExplicitHandoffQuality = initialHandoff?.selectedQuality !== undefined;
    const validatedQuality = resolveValidatedQuality(
      rawDesiredQuality,
      hasExplicitHandoffQuality,
      incomingQualities,
      Boolean(incomingMasterHls)
    );
    const resolvedIsPlaying =
      controlledPlaying !== undefined
        ? controlledPlaying
        : initialHandoff
          ? Boolean(initialHandoff.isPlaying)
          : Boolean(autoPlay);
    const resolvedIsMuted =
      controlledMuted !== undefined
        ? controlledMuted
        : initialHandoff?.isMuted !== undefined
          ? Boolean(initialHandoff.isMuted)
          : Boolean(initialMuted);

    return {
      boundSourceKey: sourceKey,
      isPlaying: Boolean(resolvedIsPlaying) && !suspended,
      isMuted: resolvedIsMuted,
      volume: clampVolume(initialHandoff?.volume ?? initialVolume, 1),
      playbackRate: sanitizePlaybackRate(initialHandoff?.playbackRate ?? initialPlaybackRate, 1),
      currentTime:
        typeof initialHandoff?.currentTime === 'number' &&
        Number.isFinite(initialHandoff.currentTime) &&
        initialHandoff.currentTime >= 0
          ? initialHandoff.currentTime
          : 0,
      duration:
        typeof source?.durationSec === 'number' &&
        Number.isFinite(source.durationSec) &&
        source.durationSec > 0
          ? source.durationSec
          : 0,
      bufferedPercent: 0,
      qualities: incomingQualities,
      masterHlsUrl: incomingMasterHls,
      selectedQuality: validatedQuality,
      isBuffering: false,
      isVideoReady: false,
      decodedHeight: null,
      decodedAspectRatio: null,
      playbackError: null,
      playbackDiagnostic: null,
      retriedRenewal: false,
    };
  };

  const [sourceState, setSourceState] = useState<EngineSourceState>(buildInitialStateForCurrentProps);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const [mediaElementRev, setMediaElementRev] = useState<number>(0);

  // During a sourceKey transition render, compute synchronously from incoming props so
  // refs, activeStreamUrl, and return values never leak the previous video's stream.
  const activeState: EngineSourceState =
    sourceState.boundSourceKey !== sourceKey
      ? buildInitialStateForCurrentProps()
      : sourceState;

  const latestSourceKeyRef = useRef<string>(sourceKey);
  latestSourceKeyRef.current = sourceKey;

  const buildInitialStateRef = useRef(buildInitialStateForCurrentProps);
  buildInitialStateRef.current = buildInitialStateForCurrentProps;

  const updateSourceState = useCallback(
    (updater: (prev: EngineSourceState) => EngineSourceState) => {
      setSourceState((prev) => {
        const base =
          prev.boundSourceKey === latestSourceKeyRef.current
            ? prev
            : buildInitialStateRef.current();
        return updater(base);
      });
    },
    []
  );

  const patchSourceState = useCallback(
    (patch: Partial<EngineSourceState>) => {
      updateSourceState((prev) => ({ ...prev, ...patch }));
    },
    [updateSourceState]
  );

  const backingVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsLikeInstance | null>(null);
  const loadedSrcRef = useRef<string>('');
  const loadedMasterHlsRef = useRef<string | undefined>(undefined);
  const appliedQualityRef = useRef<number | 'auto'>(activeState.selectedQuality);
  const pendingResumeTimeRef = useRef<number | null>(initialHandoff?.currentTime ?? null);
  // A destination can mount suspended while its previous surface still owns
  // playback. Preserve the incoming intent until that first handoff completes.
  const pendingInitialPlayRef = useRef<string | null>(
    suspended && initialHandoff?.isPlaying ? sourceKey : null
  );
  const mountedRef = useRef<boolean>(true);
  const hasCommittedMountRef = useRef<boolean>(false);
  const playbackGenerationRef = useRef<number>(0);
  const renewalAttemptedRef = useRef<boolean>(false);
  const renewalInFlightRef = useRef<boolean>(false);
  const qualitiesFetchedRef = useRef<boolean>(false);
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const qualitiesRequestRef = useRef<{
    controller: AbortController;
    promise: Promise<StreamQualitiesResolution | null>;
  } | null>(null);
  const renewRequestControllerRef = useRef<AbortController | null>(null);
  const pendingMetadataCleanupRef = useRef<(() => void) | null>(null);
  const startupTimeoutRef = useRef<TimerHandle | null>(null);
  const activeFailureHandlerRef = useRef<(failedUrl?: string, error?: unknown) => Promise<void>>(
    async () => {}
  );
  const ignoringMediaEventsRef = useRef<boolean>(false);
  const restorePausedActiveRef = useRef<boolean>(false);
  const committedSourceKeyRef = useRef<string>(sourceKey);
  const prevRetryNonceRef = useRef<number>(retryNonce);
  const prevHandoffSigRef = useRef<string>(getHandoffSignature(initialHandoff));
  const hasExplicitHandoffQualityRef = useRef<boolean>(initialHandoff?.selectedQuality !== undefined);
  hasExplicitHandoffQualityRef.current = initialHandoff?.selectedQuality !== undefined;

  const videoListenersCleanupRef = useRef<(() => void) | null>(null);

  const playbackIntentRef = useRef<PlaybackIntentState>({
    isPlaying: activeState.isPlaying && !suspended,
    isMuted: activeState.isMuted,
    playbackRate: activeState.playbackRate,
    volume: activeState.volume,
  });
  playbackIntentRef.current = {
    isPlaying: activeState.isPlaying && !suspended,
    isMuted: activeState.isMuted,
    playbackRate: activeState.playbackRate,
    volume: activeState.volume,
  };

  const stateMirrorRef = useRef<EngineSourceState>(activeState);
  stateMirrorRef.current = activeState;

  const callbacksRef = useRef({
    onQualitiesFetched,
    onFetchQualities,
    onRenewStream,
    onAutoplayBlocked,
    onPlaybackError,
    onPlaybackStateChange,
    onEnded,
    onTimeUpdateFrame,
  });
  callbacksRef.current = {
    onQualitiesFetched,
    onFetchQualities,
    onRenewStream,
    onAutoplayBlocked,
    onPlaybackError,
    onPlaybackStateChange,
    onEnded,
    onTimeUpdateFrame,
  };

  const setPlaybackError = useCallback(
    (next: PlaybackErrorCode | null) => {
      patchSourceState({ playbackError: next, ...(next === null ? { playbackDiagnostic: null } : {}) });
      callbacksRef.current.onPlaybackError?.(next);
    },
    [patchSourceState]
  );

  const attachVideoElementListeners = useCallback(
    (video: HTMLVideoElement): (() => void) =>
      bindVideoElementEvents<EngineSourceState>({
        video: video as unknown as AttachableVideoElement,
        stateMirrorRef,
        loadedSrcRef,
        ignoringMediaEventsRef,
        playbackIntentRef,
        restorePausedActiveRef,
        activeFailureHandlerRef,
        mountedRef,
        patchState: patchSourceState,
        updateState: updateSourceState,
        onTimeUpdateFrame: (cur, dur) => callbacksRef.current.onTimeUpdateFrame?.(cur, dur),
        onPlaybackError: (next) => {
          if (next === null) patchSourceState({ playbackDiagnostic: null });
          callbacksRef.current.onPlaybackError?.(next);
        },
        onEnded: () => callbacksRef.current.onEnded?.(),
      }),
    [patchSourceState, updateSourceState]
  );

  const attachListenersRef = useRef(attachVideoElementListeners);
  attachListenersRef.current = attachVideoElementListeners;

  // Callback-backed RefObject so conditionally mounted <video> elements attach/clean up cleanly
  const videoRef = useMemo<RefObject<HTMLVideoElement | null>>(() => {
    const holder = {};
    Object.defineProperty(holder, 'current', {
      enumerable: true,
      configurable: true,
      get: () => backingVideoRef.current,
      set: (nextEl: HTMLVideoElement | null) => {
        if (nextEl === backingVideoRef.current) return;
        if (videoListenersCleanupRef.current) {
          videoListenersCleanupRef.current();
          videoListenersCleanupRef.current = null;
        }
        const prevEl = backingVideoRef.current;
        if (prevEl && !nextEl) {
          teardownMediaTransport({
            video: prevEl as unknown as AttachableVideoElement,
            hlsRef,
            loadedSrcRef,
            loadedMasterHlsRef,
            startupTimeoutRef,
            pendingMetadataCleanupRef,
            ignoringMediaEventsRef,
            pendingResumeTimeRef,
            preserveResumeTime: true,
            stripSrc: true,
            pauseVideo: true,
          });
        }
        backingVideoRef.current = nextEl;
        if (nextEl) {
          const media = nextEl as unknown as AttachableVideoElement;
          applyInlineVideoAttrs(media, playbackIntentRef.current.isMuted);
          media.volume = clampVolume(playbackIntentRef.current.volume, 1);
          applyPlaybackRateToVideo(media, playbackIntentRef.current.playbackRate);
          videoListenersCleanupRef.current = attachListenersRef.current(nextEl);
          if (hasCommittedMountRef.current) {
            setMediaElementRev((n) => n + 1);
          }
        }
      },
    });
    return holder as RefObject<HTMLVideoElement | null>;
  }, []);

  // 0. Mount & unmount lifecycle MUST run before attach effects so React 18 <StrictMode>
  // simulated unmount/remount restores mountedRef.current = true and re-binds <video> listeners
  // BEFORE Effect 3 (runStreamAttachWithGeneration) executes on Pass 2.
  useEffect(() => {
    mountedRef.current = true;
    hasCommittedMountRef.current = true;
    if (backingVideoRef.current && !videoListenersCleanupRef.current) {
      const media = backingVideoRef.current as unknown as AttachableVideoElement;
      applyInlineVideoAttrs(media, playbackIntentRef.current.isMuted);
      media.volume = clampVolume(playbackIntentRef.current.volume, 1);
      applyPlaybackRateToVideo(media, playbackIntentRef.current.playbackRate);
      videoListenersCleanupRef.current = attachListenersRef.current(backingVideoRef.current);
    }
    return () => {
      mountedRef.current = false;
      playbackGenerationRef.current += 1;
      qualitiesRequestRef.current?.controller.abort();
      renewRequestControllerRef.current?.abort();
      if (videoListenersCleanupRef.current) {
        videoListenersCleanupRef.current();
        videoListenersCleanupRef.current = null;
      }
      teardownMediaTransport({
        video: backingVideoRef.current as unknown as AttachableVideoElement | null,
        hlsRef,
        loadedSrcRef,
        loadedMasterHlsRef,
        startupTimeoutRef,
        pendingMetadataCleanupRef,
        ignoringMediaEventsRef,
        stripSrc: true,
        pauseVideo: true,
      });
    };
  }, []);

  // Sync controlled playing/muted props
  useEffect(() => {
    if (controlledPlaying !== undefined) {
      patchSourceState({ isPlaying: controlledPlaying && !suspended });
    }
  }, [controlledPlaying, suspended, patchSourceState]);

  useEffect(() => {
    if (controlledMuted !== undefined) {
      patchSourceState({ isMuted: controlledMuted });
    }
  }, [controlledMuted, patchSourceState]);

  useEffect(() => {
    if (suspended || pendingInitialPlayRef.current !== sourceKey) return;
    pendingInitialPlayRef.current = null;
    if (controlledPlaying === undefined) patchSourceState({ isPlaying: true });
  }, [suspended, sourceKey, controlledPlaying, patchSourceState]);

  // Lifecycle state observer (deliberately omits currentTime so 4Hz timeupdate uses onTimeUpdateFrame)
  useEffect(() => {
    callbacksRef.current.onPlaybackStateChange?.({
      isPlaying: activeState.isPlaying,
      isMuted: activeState.isMuted,
      isBuffering: activeState.isBuffering,
      isVideoReady: activeState.isVideoReady,
      currentTime: stateMirrorRef.current.currentTime,
      duration: activeState.duration,
      playbackError: activeState.playbackError,
    });
  }, [
    activeState.isPlaying,
    activeState.isMuted,
    activeState.isBuffering,
    activeState.isVideoReady,
    activeState.duration,
    activeState.playbackError,
  ]);

  // 1. Reset per-source state on sourceKey change BEFORE main attach/preload effects run
  useEffect(() => {
    if (committedSourceKeyRef.current === sourceKey) return;
    committedSourceKeyRef.current = sourceKey;

    playbackGenerationRef.current += 1;
    qualitiesRequestRef.current?.controller.abort();
    qualitiesRequestRef.current = null;
    renewRequestControllerRef.current?.abort();
    renewRequestControllerRef.current = null;

    teardownMediaTransport({
      video: backingVideoRef.current as unknown as AttachableVideoElement | null,
      hlsRef,
      loadedSrcRef,
      loadedMasterHlsRef,
      startupTimeoutRef,
      pendingMetadataCleanupRef,
      ignoringMediaEventsRef,
      stripSrc: true,
      pauseVideo: true,
    });

    failedUrlsRef.current.clear();
    renewalAttemptedRef.current = false;
    renewalInFlightRef.current = false;
    qualitiesFetchedRef.current = false;
    restorePausedActiveRef.current = false;
    prevHandoffSigRef.current = getHandoffSignature(initialHandoff);

    const freshState = buildInitialStateRef.current();
    pendingInitialPlayRef.current = suspended && initialHandoff?.isPlaying ? sourceKey : null;
    appliedQualityRef.current = freshState.selectedQuality;
    pendingResumeTimeRef.current = initialHandoff?.currentTime ?? null;
    setSourceState(freshState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // 2. Adopt fuller source.qualities / masterHlsUrl or updated initialHandoff on identical sourceKey
  useEffect(() => {
    if (committedSourceKeyRef.current !== sourceKey) return;

    const handoffSig = getHandoffSignature(initialHandoff);
    if (initialHandoff && handoffSig !== prevHandoffSigRef.current) {
      prevHandoffSigRef.current = handoffSig;
      let nextPendingResume: number | null = initialHandoff.currentTime;
      const video = backingVideoRef.current;
      if (
        loadedSrcRef.current &&
        video &&
        video.readyState >= 1 &&
        Number.isFinite(video.duration) &&
        video.duration > 0
      ) {
        try {
          video.currentTime = clampSeekTime(initialHandoff.currentTime, video.duration);
          nextPendingResume = null;
        } catch {
          nextPendingResume = initialHandoff.currentTime;
        }
      }
      pendingResumeTimeRef.current = nextPendingResume;
      updateSourceState((prev) => {
        const nextQualities =
          incomingQualities.length > prev.qualities.length ? incomingQualities : prev.qualities;
        const nextMaster = incomingMasterHls || prev.masterHlsUrl;
        const nextQuality =
          initialHandoff.selectedQuality !== undefined
            ? initialHandoff.selectedQuality
            : resolveValidatedQuality(
                prev.selectedQuality,
                false,
                nextQualities,
                Boolean(nextMaster)
              );
        return {
          ...prev,
          currentTime: initialHandoff.currentTime,
          qualities: nextQualities,
          masterHlsUrl: nextMaster,
          selectedQuality: nextQuality,
          ...(controlledPlaying === undefined ? { isPlaying: Boolean(initialHandoff.isPlaying) && !suspended } : {}),
          ...(controlledMuted === undefined && initialHandoff.isMuted !== undefined
            ? { isMuted: Boolean(initialHandoff.isMuted) }
            : {}),
          ...(initialHandoff.volume !== undefined ? { volume: clampVolume(initialHandoff.volume, prev.volume) } : {}),
          ...(initialHandoff.playbackRate !== undefined
            ? { playbackRate: sanitizePlaybackRate(initialHandoff.playbackRate, prev.playbackRate) }
            : {}),
        };
      });
      return;
    }
    if (!initialHandoff) {
      prevHandoffSigRef.current = '';
    }

    updateSourceState((prev) => {
      const adoptQualities = incomingQualities.length > prev.qualities.length;
      const adoptMaster = Boolean(incomingMasterHls && !prev.masterHlsUrl);
      if (!adoptQualities && !adoptMaster) return prev;
      const nextQualities = adoptQualities ? incomingQualities : prev.qualities;
      const nextMaster = adoptMaster ? incomingMasterHls : prev.masterHlsUrl;
      const nextSelected = resolveValidatedQuality(
        prev.selectedQuality,
        hasExplicitHandoffQualityRef.current,
        nextQualities,
        Boolean(nextMaster)
      );
      return {
        ...prev,
        qualities: nextQualities,
        masterHlsUrl: nextMaster,
        selectedQuality: nextSelected,
      };
    });
  }, [
    sourceKey,
    initialHandoff,
    incomingQualities,
    incomingMasterHls,
    controlledPlaying,
    controlledMuted,
    suspended,
    updateSourceState,
  ]);

  const activeStreamUrl = useMemo(
    () =>
      resolveActiveStreamUrlFromParts({
        selectedQuality: activeState.selectedQuality,
        qualities: activeState.qualities,
        masterHlsUrl: activeState.masterHlsUrl,
        source,
        canonicalReferer,
      }),
    [
      activeState.selectedQuality,
      activeState.qualities,
      activeState.masterHlsUrl,
      source,
      canonicalReferer,
    ]
  );

  const fetchFreshQualities = useCallback(
    async (
      force = false,
      requestGeneration?: number
    ): Promise<StreamQualitiesResolution | null> => {
      if (qualitiesRequestRef.current && !force) {
        return qualitiesRequestRef.current.promise;
      }
      if (qualitiesFetchedRef.current && !force) return null;

      const rawTargetUrl =
        canonicalReferer ||
        source?.originalUrl ||
        source?.sourceUrl ||
        source?.streamUrl ||
        '';
      if (!rawTargetUrl) return null;

      const customFetcher = callbacksRef.current.onFetchQualities;
      const targetUrl = customFetcher ? rawTargetUrl : unwrapProxyTargetUrl(rawTargetUrl);
      if (!targetUrl) return null;
      if (!customFetcher && isLocalNonWebQualitiesUrl(targetUrl)) {
        qualitiesFetchedRef.current = true;
        return null;
      }

      const effectiveGen =
        typeof requestGeneration === 'number'
          ? requestGeneration
          : playbackGenerationRef.current;

      const controller = new AbortController();
      const promise = fetchQualitiesGuarded<StreamQualitiesResolution>({
        generation: effectiveGen,
        generationRef: playbackGenerationRef,
        mountedRef,
        signal: controller.signal,
        fetcher: async () => {
          const activeCustomFetcher = callbacksRef.current.onFetchQualities;
          let data;
          try {
            data = activeCustomFetcher
              ? await activeCustomFetcher(targetUrl, canonicalReferer, controller.signal)
              : await (async () => {
                if (typeof fetch !== 'function') return null;
                const cacheBust = force ? `&_t=${Date.now()}` : '';
                const res = await fetch(
                  `/api/video-stream-qualities?url=${encodeURIComponent(
                    targetUrl
                  )}&referer=${encodeURIComponent(canonicalReferer || '')}${cacheBust}`,
                  { signal: controller.signal }
                );
                if (!res.ok) return { diagnostic: { stage: 'resolution', code: 'request_failed', httpStatus: res.status } };
                try {
                  return await res.json();
                } catch {
                  return { diagnostic: { stage: 'resolution', code: 'unknown' } };
                }
              })();
          } catch {
            if (controller.signal.aborted) return null;
            return { qualities: [], diagnostic: { stage: 'resolution', code: 'network_error' } };
          }

          if (!data) return null;
          const norm = normalizeQualityCandidates(
            data.qualities,
            data.target_page || canonicalReferer
          );
          const rawMaster = data.master_hls_url || data.masterHlsUrl || data.masterHls;
          const mHls = typeof rawMaster === 'string' && rawMaster ? rawMaster : undefined;
          return { qualities: norm, masterHls: mHls, diagnostic: parsePlaybackDiagnostic(data.diagnostic) };
        },
        onApply: (resolved) => {
          if (resolved.qualities.length > 0 || resolved.masterHls) {
            qualitiesFetchedRef.current = true;
            updateSourceState((prev) => {
              const nextQualities =
                resolved.qualities.length > 0 ? resolved.qualities : prev.qualities;
              const nextMaster = resolved.masterHls || prev.masterHlsUrl;
              const nextSelected = resolveValidatedQuality(
                prev.selectedQuality,
                hasExplicitHandoffQualityRef.current,
                nextQualities,
                Boolean(nextMaster)
              );
              return {
                ...prev,
                qualities: nextQualities,
                masterHlsUrl: nextMaster,
                selectedQuality: nextSelected,
              };
            });
            callbacksRef.current.onQualitiesFetched?.({
              qualities: resolved.qualities,
              masterHlsUrl: resolved.masterHls,
            });
          }
        },
      }).finally(() => {
        if (qualitiesRequestRef.current?.controller === controller) {
          qualitiesRequestRef.current = null;
        }
      });

      qualitiesRequestRef.current = { controller, promise };
      return promise;
    },
    [canonicalReferer, source?.streamUrl, source?.originalUrl, source?.sourceUrl, updateSourceState]
  );

  const renewStreamGuarded = useCallback(
    async (
      failedUrl: string,
      renewalGeneration: number
    ): Promise<StreamRenewalResolution | null> => {
      if (!source) return null;
      renewRequestControllerRef.current?.abort();
      const controller = new AbortController();
      renewRequestControllerRef.current = controller;

      try {
        return await fetchQualitiesGuarded<StreamRenewalResolution>({
          generation: renewalGeneration,
          generationRef: playbackGenerationRef,
          mountedRef,
          signal: controller.signal,
          fetcher: async () => {
            if (callbacksRef.current.onRenewStream) {
              return callbacksRef.current.onRenewStream(failedUrl, source);
            }
            const fresh = await fetchFreshQualities(true, renewalGeneration);
            if (!fresh) return null;
            const top = fresh.qualities.find((q) => q.height === 720) || fresh.qualities[0];
            return {
              streamUrl: fresh.masterHls || top?.streamUrl,
              masterHls: fresh.masterHls,
              qualities: fresh.qualities,
              diagnostic: fresh.diagnostic,
            };
          },
          onApply: (resolved) => {
            const nextMaster = resolved.masterHls || resolved.masterHlsUrl;
            const nextList = Array.isArray(resolved.qualities) ? resolved.qualities : [];
            if (nextList.length > 0 || nextMaster) {
              updateSourceState((prev) => {
                const mergedQualities = nextList.length > 0 ? nextList : prev.qualities;
                const mergedMaster = nextMaster || prev.masterHlsUrl;
                return {
                  ...prev,
                  qualities: mergedQualities,
                  masterHlsUrl: mergedMaster,
                  selectedQuality: resolveValidatedQuality(
                    prev.selectedQuality,
                    hasExplicitHandoffQualityRef.current,
                    mergedQualities,
                    Boolean(mergedMaster)
                  ),
                };
              });
            }
          },
        });
      } finally {
        if (renewRequestControllerRef.current === controller) {
          renewRequestControllerRef.current = null;
        }
      }
    },
    [source, fetchFreshQualities, updateSourceState]
  );

  // Sync muted/volume/playbackRate onto <video>
  useEffect(() => {
    const video = backingVideoRef.current;
    if (!video) return;
    video.muted = activeState.isMuted;
    video.defaultMuted = activeState.isMuted;
  }, [activeState.isMuted]);

  useEffect(() => {
    const video = backingVideoRef.current;
    if (!video) return;
    video.volume = activeState.volume;
  }, [activeState.volume]);

  useEffect(() => {
    const video = backingVideoRef.current;
    if (!video) return;
    applyPlaybackRateToVideo(
      video as unknown as AttachableVideoElement,
      activeState.playbackRate
    );
  }, [activeState.playbackRate]);

  const suspendStream = useCallback(() => {
    playbackGenerationRef.current += 1;
    restorePausedActiveRef.current = false;
    qualitiesRequestRef.current?.controller.abort();
    qualitiesRequestRef.current = null;
    renewRequestControllerRef.current?.abort();
    renewRequestControllerRef.current = null;

    teardownMediaTransport({
      video: backingVideoRef.current as unknown as AttachableVideoElement | null,
      hlsRef,
      loadedSrcRef,
      loadedMasterHlsRef,
      startupTimeoutRef,
      pendingMetadataCleanupRef,
      ignoringMediaEventsRef,
      pendingResumeTimeRef,
      preserveResumeTime: true,
      preloadNone: true,
      stripSrc: true,
      pauseVideo: true,
    });

    patchSourceState({
      isPlaying: false,
      isBuffering: false,
      isVideoReady: false,
      decodedHeight: null,
    });
  }, [patchSourceState]);

  // Stabilize unattached-stream key so populating loadedSrcRef during attach does not re-trigger Effect 3
  const unattachedStreamKeyRef = useRef<string>('');
  if (committedSourceKeyRef.current !== sourceKey) {
    unattachedStreamKeyRef.current = !activeState.playbackError ? activeStreamUrl : '';
  } else if (!loadedSrcRef.current && !activeState.playbackError) {
    unattachedStreamKeyRef.current = activeStreamUrl;
  }
  const unattachedStreamDep = unattachedStreamKeyRef.current;

  // 3. Main playback / attach effect
  useEffect(() => {
    const video = backingVideoRef.current;
    if (!video || !source) return;

    if (suspended) {
      suspendStream();
      return;
    }

    const isRetryTransition = prevRetryNonceRef.current !== retryNonce;
    prevRetryNonceRef.current = retryNonce;

    const qualityChanged = appliedQualityRef.current !== activeState.selectedQuality;
    const shouldRestorePaused =
      !activeState.isPlaying &&
      !activeState.playbackError &&
      (Boolean(restorePausedProp) ||
        (Boolean(initialHandoff) &&
          !initialHandoff?.isPlaying &&
          (!loadedSrcRef.current || qualityChanged)) ||
        (Boolean(loadedSrcRef.current) && qualityChanged));

    if (!activeState.playbackError && (activeState.isPlaying || shouldRestorePaused)) {
      restorePausedActiveRef.current = shouldRestorePaused;
      appliedQualityRef.current = activeState.selectedQuality;
      const reuseTransport =
        Boolean(loadedSrcRef.current) && !qualityChanged && !isRetryTransition;
      const switchWithinHls =
        activeState.selectedQuality !== 'auto' &&
        Boolean(hlsRef.current) &&
        normalizeComparableStreamUrl(loadedMasterHlsRef.current) ===
          normalizeComparableStreamUrl(activeState.masterHlsUrl) &&
        Boolean(
          hlsRef.current?.levels?.some((lvl) => lvl.height === activeState.selectedQuality)
        );
      const requestedMaster =
        activeState.selectedQuality === 'auto' ||
        isHlsStreamUrl(activeStreamUrl) ||
        switchWithinHls
          ? activeState.masterHlsUrl
          : undefined;

      const streamArg = reuseTransport ? loadedSrcRef.current : activeStreamUrl;
      const masterArg = reuseTransport ? loadedMasterHlsRef.current : requestedMaster;

      void runStreamAttachWithGeneration({
        video: video as unknown as AttachableVideoElement,
        generationRef: playbackGenerationRef,
        mountedRef,
        hlsRef,
        loadedSrcRef,
        loadedMasterHlsRef,
        pendingResumeTimeRef,
        pendingMetadataCleanupRef,
        startupTimeoutRef,
        renewalAttemptedRef,
        renewalInFlightRef,
        failedUrlsRef,
        playbackIntentRef,
        restorePausedActiveRef,
        ignoringMediaEventsRef,
        streamUrl: streamArg,
        masterHlsUrl: masterArg,
        sourceUrl: canonicalReferer || source.originalUrl || source.sourceUrl || source.streamUrl,
        sourceType: source.sourceType,
        qualities: activeState.qualities,
        qualitiesFetchedRef,
        selectedQuality: activeState.selectedQuality,
        forceReload: isRetryTransition,
        restorePaused: shouldRestorePaused,
        HlsClass,
        fetchFreshQualities: (force, gen) => fetchFreshQualities(force, gen),
        renewStream: (failedUrl, gen) => renewStreamGuarded(failedUrl, gen),
        onFailureHandlerReady: (gen, handler) => {
          if (playbackGenerationRef.current === gen) {
            activeFailureHandlerRef.current = handler;
          }
        },
        onHlsLevelsParsed: (parsedLevels, activeHeight) => {
          if (parsedLevels.length > 0) {
            updateSourceState((prev) => {
              const adoptLevels =
                !(parsedLevels.length === 1 && prev.qualities.length > 0) &&
                !(parsedLevels.length > 1 && prev.qualities.length > 1);
              const nextQualities = adoptLevels ? parsedLevels : prev.qualities;
              const nextSelected = !hasExplicitHandoffQualityRef.current
                ? resolveValidatedQuality(prev.selectedQuality, false, parsedLevels, false)
                : prev.selectedQuality;
              const nextHeight =
                typeof activeHeight === 'number' && activeHeight > 0
                  ? activeHeight
                  : prev.decodedHeight;
              if (
                nextQualities === prev.qualities &&
                nextSelected === prev.selectedQuality &&
                nextHeight === prev.decodedHeight
              ) {
                return prev;
              }
              if (nextSelected !== prev.selectedQuality) {
                appliedQualityRef.current = nextSelected;
              }
              return {
                ...prev,
                qualities: nextQualities,
                selectedQuality: nextSelected,
                decodedHeight: nextHeight,
              };
            });
          }
        },
        onDecodedHeight: (h) => patchSourceState({ decodedHeight: h }),
        onBufferingChange: (b) => patchSourceState({ isBuffering: b }),
        onVideoReadyChange: (r) => patchSourceState({ isVideoReady: r }),
        onRetriedRenewalChange: (r) => patchSourceState({ retriedRenewal: r }),
        onAutoplayBlocked: () => {
          patchSourceState({ isPlaying: false });
          callbacksRef.current.onAutoplayBlocked?.();
        },
        onPlaybackError: setPlaybackError,
        onPlaybackDiagnostic: (diagnostic) => patchSourceState({ playbackDiagnostic: diagnostic }),
        onFatalFailure: () => {
          patchSourceState({ isPlaying: false });
        },
      });
    } else {
      restorePausedActiveRef.current = false;
      playbackGenerationRef.current += 1;
      if (startupTimeoutRef.current !== null) {
        globalThis.clearTimeout(startupTimeoutRef.current);
        startupTimeoutRef.current = null;
      }
      pendingMetadataCleanupRef.current?.();
      pendingMetadataCleanupRef.current = null;
      hlsRef.current?.stopLoad?.();
      ignoringMediaEventsRef.current = true;
      try {
        if (!video.paused) {
          video.pause();
        }
      } finally {
        ignoringMediaEventsRef.current = false;
      }
      patchSourceState({ isBuffering: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeState.isPlaying,
    suspended,
    activeState.selectedQuality,
    sourceKey,
    retryNonce,
    restorePausedProp,
    mediaElementRev,
    unattachedStreamDep,
  ]);

  // 4. Silent idle metadata preload (non-HLS only)
  useEffect(() => {
    if (
      suspended ||
      !preloadMetadata ||
      activeState.isPlaying ||
      activeState.playbackError ||
      !activeStreamUrl
    ) {
      return;
    }
    const video = backingVideoRef.current;
    if (!video) return;

    if (
      isWatchPageOnlyUrl(activeStreamUrl) ||
      Boolean(source?.streamUrl && isWatchPageOnlyUrl(source.streamUrl))
    ) {
      return;
    }

    const isHls =
      isHlsStreamUrl(activeStreamUrl, activeState.masterHlsUrl) &&
      Boolean(HlsClass?.isSupported?.());
    if (isHls) return;

    if (!video.getAttribute('src') && !hlsRef.current && !loadedSrcRef.current) {
      ignoringMediaEventsRef.current = true;
      try {
        video.defaultMuted = true;
        video.muted = true;
        video.preload = 'metadata';
        applyPlaybackRateToVideo(
          video as unknown as AttachableVideoElement,
          playbackIntentRef.current.playbackRate
        );
        video.src = activeStreamUrl;
        applyPlaybackRateToVideo(
          video as unknown as AttachableVideoElement,
          playbackIntentRef.current.playbackRate
        );
      } finally {
        ignoringMediaEventsRef.current = false;
      }
      loadedSrcRef.current = activeStreamUrl;
      loadedMasterHlsRef.current = undefined;
    }
  }, [
    sourceKey,
    suspended,
    preloadMetadata,
    activeState.isPlaying,
    activeState.playbackError,
    activeState.masterHlsUrl,
    activeStreamUrl,
    source?.streamUrl,
    HlsClass,
    mediaElementRev,
  ]);

  const play = useCallback(() => {
    if (suspended) return;
    setPlaybackError(null);
    patchSourceState({ isPlaying: true });
  }, [suspended, setPlaybackError, patchSourceState]);

  const pause = useCallback(() => {
    patchSourceState({ isPlaying: false });
  }, [patchSourceState]);

  const togglePlay = useCallback(() => {
    if (suspended) return;
    updateSourceState((prev) => {
      const nextPlaying = !prev.isPlaying;
      if (nextPlaying) callbacksRef.current.onPlaybackError?.(null);
      return {
        ...prev,
        isPlaying: nextPlaying,
        ...(nextPlaying ? { playbackError: null, playbackDiagnostic: null } : {}),
      };
    });
  }, [suspended, updateSourceState]);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = backingVideoRef.current;
      const knownDuration =
        video && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : stateMirrorRef.current.duration;
      const clamped =
        knownDuration > 0
          ? clampSeekTime(seconds, knownDuration)
          : Math.max(0, typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : 0);

      callbacksRef.current.onTimeUpdateFrame?.(clamped, knownDuration);

      let nextBuffered = stateMirrorRef.current.bufferedPercent;
      if (video && video.readyState >= 1) {
        try {
          video.currentTime = clamped;
          pendingResumeTimeRef.current = null;
        } catch {
          pendingResumeTimeRef.current = clamped;
        }
        nextBuffered = computeBufferedPercent(
          video as unknown as AttachableVideoElement,
          knownDuration
        );
      } else {
        pendingResumeTimeRef.current = clamped;
      }
      patchSourceState({ currentTime: clamped, bufferedPercent: nextBuffered });
    },
    [patchSourceState]
  );

  const skipBy = useCallback(
    (deltaSeconds: number) => {
      const video = backingVideoRef.current;
      const base =
        video && video.readyState >= 1 && Number.isFinite(video.currentTime)
          ? video.currentTime
          : stateMirrorRef.current.currentTime;
      const safeDelta =
        typeof deltaSeconds === 'number' && Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
      seekTo(base + safeDelta);
    },
    [seekTo]
  );

  const setMuted = useCallback(
    (muted: boolean | ((prev: boolean) => boolean)) => {
      updateSourceState((prev) => {
        const next = typeof muted === 'function' ? muted(prev.isMuted) : Boolean(muted);
        playbackIntentRef.current.isMuted = next;
        const video = backingVideoRef.current;
        let nextVolume = prev.volume;
        if (video) {
          video.muted = next;
          video.defaultMuted = next;
          if (!next && video.volume === 0) {
            video.volume = 1;
            nextVolume = 1;
          }
        }
        return { ...prev, isMuted: next, volume: nextVolume };
      });
    },
    [updateSourceState]
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, [setMuted]);

  const setVolume = useCallback(
    (nextVolume: number) => {
      const clamped = clampVolume(nextVolume, 1);
      playbackIntentRef.current.volume = clamped;
      const video = backingVideoRef.current;
      if (video) {
        video.volume = clamped;
      }
      updateSourceState((prev) => {
        const nextMuted = clamped > 0 ? false : clamped === 0 ? true : prev.isMuted;
        playbackIntentRef.current.isMuted = nextMuted;
        if (video) {
          video.muted = nextMuted;
          video.defaultMuted = nextMuted;
        }
        return { ...prev, volume: clamped, isMuted: nextMuted };
      });
    },
    [updateSourceState]
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const safeRate = sanitizePlaybackRate(rate, 1);
      playbackIntentRef.current.playbackRate = safeRate;
      patchSourceState({ playbackRate: safeRate });
      if (backingVideoRef.current) {
        applyPlaybackRateToVideo(
          backingVideoRef.current as unknown as AttachableVideoElement,
          safeRate
        );
      }
    },
    [patchSourceState]
  );

  const selectQuality = useCallback(
    (quality: number | 'auto') => {
      const video = backingVideoRef.current;
      const currentMaster = stateMirrorRef.current.masterHlsUrl;
      const isInPlaceHlsSwitch = Boolean(
        hlsRef.current &&
          currentMaster &&
          normalizeComparableStreamUrl(loadedSrcRef.current) ===
            normalizeComparableStreamUrl(currentMaster) &&
          hlsRef.current.levels.length > 1
      );

      if (isInPlaceHlsSwitch && hlsRef.current) {
        applyHlsQualityLevel(hlsRef.current, quality);
        appliedQualityRef.current = quality;
        // Clear pendingResumeTimeRef when switching levels in-place without reloading src
        pendingResumeTimeRef.current = null;
      } else if (video) {
        pendingResumeTimeRef.current =
          loadedSrcRef.current && video.readyState >= 1
            ? video.currentTime
            : pendingResumeTimeRef.current ?? initialHandoff?.currentTime ?? 0;
      }

      patchSourceState({ selectedQuality: quality });

      if (persistQualityKey && typeof window !== 'undefined') {
        try {
          window.localStorage?.setItem(persistQualityKey, String(quality));
        } catch {
          // Ignore storage quota / private mode failures.
        }
      }
    },
    [initialHandoff?.currentTime, persistQualityKey, patchSourceState]
  );

  const retryRenewal = useCallback(() => {
    failedUrlsRef.current.clear();
    renewalAttemptedRef.current = false;
    renewalInFlightRef.current = false;
    qualitiesFetchedRef.current = false;
    loadedSrcRef.current = '';
    loadedMasterHlsRef.current = undefined;
    patchSourceState({
      retriedRenewal: false,
      playbackError: null,
      playbackDiagnostic: null,
      isVideoReady: false,
      isBuffering: true,
      isPlaying: true,
    });
    callbacksRef.current.onPlaybackError?.(null);
    setRetryNonce((n) => n + 1);
  }, [patchSourceState]);

  const capturePlaybackSnapshot = useCallback((): PlaybackHandoffSnapshot => {
    const snap = stateMirrorRef.current;
    return buildPlaybackSnapshot({
      videoElement: backingVideoRef.current as unknown as Partial<AttachableVideoElement> | null,
      pendingResumeTime: pendingResumeTimeRef.current,
      initialHandoff,
      isAttached: Boolean(loadedSrcRef.current),
      isPlayingFallback: snap.isPlaying,
      isMutedFallback: snap.isMuted,
      volumeFallback: snap.volume,
      playbackRateFallback: snap.playbackRate,
      selectedQuality: snap.selectedQuality,
      masterHlsUrl: snap.masterHlsUrl,
      qualities: snap.qualities,
    });
  }, [initialHandoff]);

  return {
    videoRef,
    isPlaying: activeState.isPlaying,
    isMuted: activeState.isMuted,
    volume: activeState.volume,
    currentTime: activeState.currentTime,
    duration: activeState.duration,
    bufferedPercent: activeState.bufferedPercent,
    playbackRate: activeState.playbackRate,
    selectedQuality: activeState.selectedQuality,
    qualities: activeState.qualities,
    masterHlsUrl: activeState.masterHlsUrl,
    activeStreamUrl,
    isBuffering: activeState.isBuffering,
    isVideoReady: activeState.isVideoReady,
    decodedHeight: activeState.decodedHeight,
    decodedAspectRatio: activeState.decodedAspectRatio,
    playbackError: activeState.playbackError,
    playbackDiagnostic: activeState.playbackDiagnostic,
    retriedRenewal: activeState.retriedRenewal,
    play,
    pause,
    togglePlay,
    seekTo,
    skipBy,
    setMuted,
    toggleMute,
    setVolume,
    setPlaybackRate,
    selectQuality,
    retryRenewal,
    suspendStream,
    capturePlaybackSnapshot,
  };
}
