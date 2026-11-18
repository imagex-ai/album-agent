/**
 * UniversalVideoPlayer.tsx
 *
 * IMAGEX.AI Universal Video Player & Adaptive Container-Query UI Shell.
 * Single unified player engine & container-query shell supporting card, cinema,
 * compact, and mini density modes across desktop and mobile.
 *
 * Governed by:
 * - docs/video-player-architecture.md
 * - docs/superpowers/specs/2026-11-14-universal-video-player-design.md
 * - PROJECT_RULES.md (100% i18n, zero hardcoding, zero nested interactive controls)
 */

import React, {
  Suspense,
  forwardRef,
  lazy,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import './universal-player.css';
import {
  useUniversalVideoEngine,
  type PlaybackErrorCode,
} from '../engine/useUniversalVideoEngine';
import { usePlayerControlsAutoHide } from '../engine/usePlayerControlsAutoHide';
import { playbackDiagnosticMessage } from '../engine/playbackDiagnostics';
import { usePlayerGestures } from '../engine/usePlayerGestures';
import { usePlayerShortcuts } from '../engine/usePlayerShortcuts';
import { useMediaSession } from '../engine/useMediaSession';
import { createPlayerFullscreen } from '../engine/playerFullscreen';
import { useExternalPictureInPicture } from '../engine/useExternalPictureInPicture';
import {
  PLAYER_OVERLAY_PRIORITY,
  registerPlayerOverlayLayer,
} from '../engine/playerOverlayStack';
import { resolvePlayerMotionClasses } from '../engine/playerMotion';
import {
  type UniversalPlayerDensity,
  type UniversalVideoSource,
  type PlaybackHandoffSnapshot,
  type StreamQualityCandidate,
} from '../engine/videoPlayerCore';
import { PlayerControlBar } from './PlayerControlBar';
import { PlayerHighlightMarkers } from './PlayerHighlights';
import { usePlayerHighlights } from '../engine/usePlayerHighlights';
import { PlayerGestureOverlay } from './PlayerGestureOverlay';
import { PlayerSettingsSheet } from './PlayerSettingsSheet';
import { useAppStore } from '../../../store/useAppStore';
import { translations } from '../../../i18n/translations';
import type { AppSettings, Language } from '../../../types';

const PlayerShortcutsDialogLazy = lazy(
  () => import('./PlayerShortcutsDialog')
);

export interface UniversalVideoPlayerHandle {
  capturePlaybackSnapshot: () => PlaybackHandoffSnapshot;
  play: () => Promise<void> | void;
  pause: () => void;
  seekTo: (time: number) => void;
  toggleMute: () => void;
  getVideoElement: () => HTMLVideoElement | null;
}

export interface UniversalVideoPlayerProps {
  source?: UniversalVideoSource | null;
  density?: UniversalPlayerDensity;
  posterUrl?: string;
  aspectRatio?: string | number;
  autoPlayOnActive?: boolean;
  ambientGlowEnabled?: boolean;
  suspended?: boolean;
  preloadMetadata?: boolean;
  initialHandoff?: PlaybackHandoffSnapshot | null;
  isActive?: boolean;
  playing?: boolean;
  muted?: boolean;
  initialMuted?: boolean;
  initialVolume?: number;
  initialPlaybackRate?: number;
  initialQuality?: number | 'auto';
  language?: Language;
  motionSettings?: Partial<AppSettings>;
  onPlaybackSnapshot?: (snapshot: PlaybackHandoffSnapshot) => void;
  onPlaybackStateChange?: (state: {
    isPlaying: boolean;
    isMuted: boolean;
    isBuffering: boolean;
    isVideoReady: boolean;
    currentTime: number;
    duration: number;
    playbackError: PlaybackErrorCode | null;
  }) => void;
  onAutoplayBlocked?: () => void;
  onRequestWatch?: (
    source: UniversalVideoSource,
    handoff: PlaybackHandoffSnapshot
  ) => void;
  onMinimizeToMiniPlayer?: () => void;
  isTheater?: boolean;
  onToggleTheater?: (next: boolean) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onErrorFallback?: () => void;
  onRenewStream?: () => Promise<any> | any;
  onQualitiesFetched?: (data: {
    qualities: StreamQualityCandidate[];
    masterHlsUrl?: string;
  }) => void;
  onClose?: () => void;
  renderTrackMarkers?:
    | React.ReactNode
    | ((params: { duration: number }) => React.ReactNode);
  renderRightControlsSlot?: React.ReactNode;
  renderTopActionsSlot?: React.ReactNode;
  className?: string;
}

export const UniversalVideoPlayer = forwardRef<
  UniversalVideoPlayerHandle,
  UniversalVideoPlayerProps
>((props, ref) => {
  const {
    source,
    density = 'cinema',
    posterUrl,
    aspectRatio = '16/9',
    autoPlayOnActive = false,
    ambientGlowEnabled = false,
    suspended = false,
    preloadMetadata = true,
    initialHandoff = null,
    isActive = true,
    playing,
    muted,
    initialMuted = false,
    initialVolume = 1,
    initialPlaybackRate = 1,
    initialQuality = 'auto',
    language,
    motionSettings,
    onPlaybackSnapshot,
    onPlaybackStateChange,
    onAutoplayBlocked,
    onRequestWatch,
    onMinimizeToMiniPlayer,
    isTheater: controlledTheater,
    onToggleTheater,
    onNext,
    onPrevious,
    onErrorFallback,
    onRenewStream,
    onQualitiesFetched,
    renderTrackMarkers,
    renderRightControlsSlot,
    renderTopActionsSlot,
    className = '',
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomBarWrapRef = useRef<HTMLDivElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const settingsCloseRef = useRef<(() => void) | null>(null);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [internalTheater, setInternalTheater] = useState<boolean>(Boolean(controlledTheater));
  const isTheater = controlledTheater !== undefined ? controlledTheater : internalTheater;
  const handleToggleTheater = useCallback(() => {
    const next = !isTheater;
    setInternalTheater(next);
    onToggleTheater?.(next);
  }, [isTheater, onToggleTheater]);
  const [ambientGlowState, setAmbientGlowState] = useState<boolean>(ambientGlowEnabled);
  useEffect(() => {
    setAmbientGlowState(ambientGlowEnabled);
  }, [ambientGlowEnabled]);
  const [fillMode, setFillMode] = useState<'contain' | 'cover'>('contain');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [isToolbarHovered, setIsToolbarHovered] = useState<boolean>(false);
  const [isFocusWithin, setIsFocusWithin] = useState<boolean>(false);
  const lastPointerTypeRef = useRef<string>('mouse');

  // App store fallbacks for language and motion settings
  const storeLanguage = useAppStore?.((s) => s.settings?.language);
  const resolvedLanguage: Language = language || storeLanguage || 'pt-BR';

  const storeSettings = useAppStore?.((s) => s.settings);
  const resolvedMotionSettings = motionSettings || storeSettings;
  const motionClasses = resolvePlayerMotionClasses(resolvedMotionSettings);

  const t =
    translations[resolvedLanguage]?.player || translations['pt-BR'].player;

  // 1. Core Video Playback Engine Hook
  const engine = useUniversalVideoEngine({
    source,
    initialHandoff,
    autoPlay: autoPlayOnActive,
    playing,
    muted,
    initialMuted,
    initialVolume,
    initialPlaybackRate,
    initialQuality,
    suspended,
    preloadMetadata,
    onAutoplayBlocked,
    onPlaybackStateChange,
    onRenewStream,
    onQualitiesFetched,
  });

  const highlights = usePlayerHighlights(source, {
    enabled: engine.isVideoReady && isActive && !suspended && !engine.isBuffering,
    duration: engine.duration,
  });
  // Imperative handle export via forwardRef
  useImperativeHandle(
    ref,
    () => ({
      capturePlaybackSnapshot: engine.capturePlaybackSnapshot,
      play: engine.play,
      pause: engine.pause,
      seekTo: engine.seekTo,
      toggleMute: engine.toggleMute,
      getVideoElement: () => engine.videoRef.current,
    }),
    [engine]
  );

  // Sync snapshot callback ONLY on intentional boundaries (pause transition, unmount) - NO 4Hz re-render churn!
  const snapshotContextRef = useRef({
    onPlaybackSnapshot,
    isVideoReady: engine.isVideoReady,
    capturePlaybackSnapshot: engine.capturePlaybackSnapshot,
  });
  snapshotContextRef.current = {
    onPlaybackSnapshot,
    isVideoReady: engine.isVideoReady,
    capturePlaybackSnapshot: engine.capturePlaybackSnapshot,
  };

  const prevPlayingRef = useRef(engine.isPlaying);
  useEffect(() => {
    if (
      prevPlayingRef.current &&
      !engine.isPlaying &&
      snapshotContextRef.current.onPlaybackSnapshot &&
      snapshotContextRef.current.isVideoReady
    ) {
      snapshotContextRef.current.onPlaybackSnapshot(
        snapshotContextRef.current.capturePlaybackSnapshot()
      );
    }
    prevPlayingRef.current = engine.isPlaying;
  }, [engine.isPlaying, engine.isVideoReady]);

  useEffect(() => {
    return () => {
      if (
        snapshotContextRef.current.onPlaybackSnapshot &&
        snapshotContextRef.current.isVideoReady
      ) {
        try {
          snapshotContextRef.current.onPlaybackSnapshot(
            snapshotContextRef.current.capturePlaybackSnapshot()
          );
        } catch {
          // Safe fallback on unmount
        }
      }
    };
  }, []);

  // 2. Controls Auto-Hide Hook
  const autoHide = usePlayerControlsAutoHide({
    isPlaying: engine.isPlaying,
    autoHideWhilePaused: true,
    initialVisible: false,
    hasOpenOverlay: isSettingsOpen || isShortcutsOpen,
    isScrubbing,
    isToolbarHovered,
    isFocusWithin,
  });

  const quickHideTimerRef = useRef<number | null>(null);
  const cancelQuickHide = useCallback(() => {
    if (quickHideTimerRef.current !== null) {
      window.clearTimeout(quickHideTimerRef.current);
      quickHideTimerRef.current = null;
    }
  }, []);
  const scheduleQuickHide = useCallback(
    (delayMs: number) => {
      cancelQuickHide();
      if (typeof window === 'undefined') return;
      quickHideTimerRef.current = window.setTimeout(() => {
        quickHideTimerRef.current = null;
        autoHide.hideControls();
      }, delayMs);
    },
    [cancelQuickHide, autoHide.hideControls]
  );
  useEffect(() => () => cancelQuickHide(), [cancelQuickHide]);

  // Hide controls in < 1s when user clicks Play (both desktop & mobile)
  const prevIsPlayingRef = useRef(engine.isPlaying);
  useEffect(() => {
    if (!prevIsPlayingRef.current && engine.isPlaying && !isSettingsOpen && !isShortcutsOpen && !isScrubbing) {
      scheduleQuickHide(750);
    }
    prevIsPlayingRef.current = engine.isPlaying;
  }, [engine.isPlaying, isSettingsOpen, isShortcutsOpen, isScrubbing, scheduleQuickHide]);

  // On mobile touch, tapping outside the player hides controls immediately
  useEffect(() => {
    if (typeof document === 'undefined' || !autoHide.controlsVisible) return;
    const onOutsidePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        scheduleQuickHide(150);
      }
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onOutsidePointerDown);
  }, [autoHide.controlsVisible, scheduleQuickHide]);

  const prevDensityRef = useRef(density);
  useEffect(() => {
    if (prevDensityRef.current === density) return;
    prevDensityRef.current = density;
    setIsToolbarHovered(false);
    setIsFocusWithin(false);
    setIsScrubbing(false);
    if (density === 'mini') {
      autoHide.hideControls(true);
    }
  }, [density, autoHide.hideControls]);

  // Bind native iPhone events and the in-page fallback to this same player.
  const fullscreenRef = useRef<ReturnType<typeof createPlayerFullscreen> | null>(null);
  useEffect(() => {
    setIsFullscreen(false);
    if (!containerRef.current || suspended) {
      return;
    }
    const fullscreen = createPlayerFullscreen(containerRef.current, engine.videoRef.current, setIsFullscreen);
    fullscreenRef.current = fullscreen;
    return () => {
      fullscreen.dispose();
      fullscreenRef.current = null;
    };
  }, [suspended, engine.videoRef, density, source?.id]);
  const toggleFullscreen = useCallback(() => fullscreenRef.current?.toggle(), []);

  // Measure real bottom bar height so center HUD and settings popover adapt dynamically to any container size
  useEffect(() => {
    const stage = containerRef.current;
    const barWrap = bottomBarWrapRef.current;
    if (!stage || !barWrap) return;
    const syncBarHeight = () => {
      const h = autoHide.controlsVisible ? Math.ceil(barWrap.getBoundingClientRect().height) : 0;
      stage.style.setProperty('--uvp-bar-h', `${h}px`);
    };
    syncBarHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(syncBarHeight);
    ro.observe(barWrap);
    return () => ro.disconnect();
  }, [autoHide.controlsVisible, density]);

  // 3. Gestures Hook
  const gestures = usePlayerGestures({
    playbackRate: engine.playbackRate,
    sourceKey: source?.id || '',
    isFullscreen,
    disabled: suspended,
    onSetPlaybackRate: engine.setPlaybackRate,
    onSeekDelta: engine.skipBy,
    onSingleTap: () => {
      if (lastPointerTypeRef.current === 'mouse') {
        engine.togglePlay();
        autoHide.onPointerActivity();
      } else {
        autoHide.toggleControls();
      }
    },
    onCenterDoubleTap: () => {
      toggleFullscreen();
    },
    onSwipeUp: () => {
      if (!isFullscreen && density !== 'mini') {
        void toggleFullscreen();
      }
    },
    onSwipeDown: () => {
      if (isFullscreen) {
        void toggleFullscreen();
      } else if (density !== 'mini' && onMinimizeToMiniPlayer) {
        onMinimizeToMiniPlayer();
      }
    },
  });

  // 4. Keyboard Shortcuts Hook
  usePlayerShortcuts({
    id: `uvp-shortcuts-${source?.id || 'surface'}`,
    enabled: !suspended,
    isActive,
    isFullscreen,
    containerRef,
    currentTime: engine.currentTime,
    duration: engine.duration,
    volume: engine.volume,
    playbackRate: engine.playbackRate,
    actions: {
      togglePlay: engine.togglePlay,
      play: engine.play,
      pause: engine.pause,
      skipBy: engine.skipBy,
      seekTo: engine.seekTo,
      setVolume: engine.setVolume,
      adjustVolume: (delta) =>
        engine.setVolume(Math.min(1, Math.max(0, engine.volume + delta))),
      toggleMute: engine.toggleMute,
      toggleFullscreen: () => toggleFullscreen(),
      toggleTheater: handleToggleTheater,
      toggleFillMode: () =>
        setFillMode((prev) => (prev === 'contain' ? 'cover' : 'contain')),
      toggleMiniPlayer: onMinimizeToMiniPlayer,
      toggleShortcutsHelp: () => setIsShortcutsOpen((prev) => !prev),
      setPlaybackRate: engine.setPlaybackRate,
      stepFrame: (dir) => engine.skipBy(dir * (1 / 30)),
    },
  });

  // 5. Media Session Hook
  useMediaSession({
    id: `uvp-session-${source?.id || 'surface'}`,
    active: Boolean(isActive && engine.isPlaying),
    isPlaying: engine.isPlaying,
    currentTime: engine.currentTime,
    duration: engine.duration,
    playbackRate: engine.playbackRate,
    metadata: source
      ? {
          title: source.title || t.untitledVideo,
          artist: source.creatorName,
          artwork: source.posterUrl
            ? [{ src: source.posterUrl, sizes: '512x512', type: 'image/jpeg' }]
            : undefined,
        }
      : null,
    onPlay: engine.play,
    onPause: engine.pause,
    onSeekBackward: (offset) => engine.skipBy(-offset),
    onSeekForward: (offset) => engine.skipBy(offset),
    onSeekTo: (time) => engine.seekTo(time),
    onPreviousTrack: onPrevious,
    onNextTrack: onNext,
  });

  // 6. External Picture-in-Picture Hook
  const pip = useExternalPictureInPicture({
    videoRef: engine.videoRef,
    isPlaying: engine.isPlaying,
    allowMiniFallback: Boolean(onMinimizeToMiniPlayer),
    onEnterMiniPlayer: onMinimizeToMiniPlayer,
  });

  // Fullscreen overlay stack registration for capture-phase Escape
  useEffect(() => {
    if (!isFullscreen) return;

    const unregister = registerPlayerOverlayLayer({
      id: 'uvp-fullscreen-overlay',
      priority: PLAYER_OVERLAY_PRIORITY.FULLSCREEN,
      onDismiss: () => { void fullscreenRef.current?.exit(); },
      triggerElement: containerRef.current,
    });

    return () => {
      unregister();
    };
  }, [isFullscreen]);

  // Expand / onRequestWatch handler with snapshot
  const handleRequestWatch = useCallback(() => {
    if (!source || !onRequestWatch) return;
    const snapshot = engine.capturePlaybackSnapshot();
    onPlaybackSnapshot?.(snapshot);
    onRequestWatch(source, snapshot);
  }, [source, onRequestWatch, engine, onPlaybackSnapshot]);

  // Localized error message mapping
  const resolveErrorMessage = (err: PlaybackErrorCode | null): string => {
    if (!err) return '';
    return playbackDiagnosticMessage(engine.playbackDiagnostic ?? {
      stage: err === 'stream_unavailable' ? 'resolution' : 'playback',
      code: err === 'startup_timeout' ? 'startup_timeout' : err === 'hls_fatal' ? 'hls_error' : 'unknown',
    }, resolvedLanguage);
  };

  const effectiveAspectRatio =
    aspectRatio === 'auto'
      ? undefined
      : aspectRatio === '9:16' || aspectRatio === 9 / 16
        ? '9 / 16'
        : aspectRatio === '16:9' || aspectRatio === 16 / 9
          ? '16 / 9'
          : String(aspectRatio);

  const isPortrait =
    aspectRatio === '9:16' ||
    aspectRatio === 9 / 16 ||
    (typeof aspectRatio === 'number' && aspectRatio < 1) ||
    (typeof engine.decodedAspectRatio === 'number' &&
      engine.decodedAspectRatio > 0 &&
      engine.decodedAspectRatio < 0.85);

  const showAmbientGlow =
    ambientGlowState &&
    isPortrait &&
    resolvedMotionSettings?.disableAllAnimations !== true;

  return (
    <div
      ref={containerRef}
      data-uvp-root="true"
      data-video-surface="true"
      data-density={density}
      data-motion-disabled={resolvedMotionSettings?.disableAllAnimations ? 'true' : 'false'}
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      data-fill-mode={fillMode}
      className={`uvp-stage uvp-density-${density} ${motionClasses.playerAnimationClass} ${className}`}
      style={{
        aspectRatio: isFullscreen ? 'unset' : effectiveAspectRatio,
        touchAction: isFullscreen ? 'none' : 'pan-y',
        '--uvp-motion-duration': `${motionClasses.speedMs}ms`,
      } as React.CSSProperties}
      tabIndex={0}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          cancelQuickHide();
          autoHide.onPointerActivity();
        }
      }}
      onMouseLeave={() => {
        setIsToolbarHovered(false);
        if (!isSettingsOpen && !isShortcutsOpen && !isScrubbing) {
          scheduleQuickHide(650);
        }
      }}
      onPointerDown={(e) => {
        lastPointerTypeRef.current = e.pointerType || 'mouse';
        if (lastPointerTypeRef.current === 'mouse') autoHide.onPointerActivity();
        gestures.gestureHandlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') {
          lastPointerTypeRef.current = 'mouse';
          cancelQuickHide();
          autoHide.onPointerActivity();
        }
        gestures.gestureHandlers.onPointerMove(e);
      }}
      onPointerUp={gestures.gestureHandlers.onPointerUp}
      onPointerCancel={gestures.gestureHandlers.onPointerCancel}
      onDoubleClick={gestures.gestureHandlers.onDoubleClick}
      onFocusCapture={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) {
          setIsFocusWithin(true);
          autoHide.onPointerActivity();
        }
      }}
      onBlurCapture={(e) => {
        if (
          !e.currentTarget.contains(
            (e.relatedTarget as Node | null) || null
          )
        ) {
          setIsFocusWithin(false);
        }
      }}
    >
      {/* Ambient Cinema Glow backdrop */}
      {showAmbientGlow && <div className="uvp-ambient-glow" aria-hidden="true" />}

      {/* Video Element */}
      <video
        ref={engine.videoRef as any}
        poster={posterUrl || source?.posterUrl || source?.thumbnailUrl}
        className="uvp-video-el"
        playsInline
      />

      {/* Gesture Feedback & Buffering Overlay */}
      <PlayerGestureOverlay
        gestureFeedback={gestures.gestureFeedback}
        isHold2xActive={gestures.isHold2xActive}
        isBuffering={engine.isBuffering}
        isVideoReady={engine.isVideoReady}
        showCenterMobileHud={density !== 'mini' && (!engine.isPlaying || autoHide.controlsVisible)}
        isPlaying={engine.isPlaying}
        language={resolvedLanguage}
        onTogglePlay={engine.togglePlay}
        onSeekBack10={() => engine.skipBy(-10)}
        onSeekForward10={() => engine.skipBy(10)}
      />

      {/* Playback Error Overlay Scrim */}
      {engine.playbackError && (
        <div className="uvp-error-scrim" role="alert">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-red-400"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm font-medium max-w-xs">
            {resolveErrorMessage(engine.playbackError)}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              className="px-4 py-1.5 rounded-lg bg-[var(--tl-accent)] text-white font-medium text-xs hover:opacity-90 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                engine.retryRenewal();
                engine.play();
              }}
            >
              {t.retryStream}
            </button>
            {onErrorFallback && (
              <button
                type="button"
                className="px-4 py-1.5 rounded-lg bg-white/20 text-white font-medium text-xs hover:bg-white/30 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onErrorFallback();
                }}
              >
                {t.reloadStream}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top Actions Slot */}
      {renderTopActionsSlot && (
        <div className="uvp-top-bar absolute top-0 left-0 right-0 z-25 pointer-events-auto">
          {renderTopActionsSlot}
        </div>
      )}

      {/* Controls Chrome Overlay */}
      <div
        data-player-chrome="true"
        data-visible={autoHide.controlsVisible ? 'true' : 'false'}
        className="uvp-chrome"
      >
        <div />
        <div
          ref={bottomBarWrapRef}
          onMouseEnter={() => {
            if (lastPointerTypeRef.current === 'mouse') {
              setIsToolbarHovered(true);
              autoHide.onPointerActivity();
            }
          }}
          onMouseLeave={() => setIsToolbarHovered(false)}
        >
          <PlayerControlBar
            isPlaying={engine.isPlaying}
            isMuted={engine.isMuted}
            volume={engine.volume}
            currentTime={engine.currentTime}
            duration={engine.duration}
            bufferedPercent={engine.bufferedPercent}
            isFullscreen={isFullscreen}
            isTheater={isTheater}
            density={density}
            language={resolvedLanguage}
            settingsButtonRef={settingsBtnRef}
            onTogglePlay={engine.togglePlay}
            onSeek={engine.seekTo}
            onSkipBy={engine.skipBy}
            onToggleMute={engine.toggleMute}
            onVolumeChange={engine.setVolume}
            onToggleFullscreen={toggleFullscreen}
            onToggleTheater={handleToggleTheater}
            onTogglePip={onMinimizeToMiniPlayer || pip.togglePip}
            onOpenSettings={() => {
              if (isSettingsOpen) settingsCloseRef.current?.();
              else setIsSettingsOpen(true);
            }}
            onRequestWatch={onRequestWatch ? handleRequestWatch : undefined}
            onScrubbingChange={setIsScrubbing}
            renderTrackMarkers={renderTrackMarkers !== undefined ? renderTrackMarkers : (
              <PlayerHighlightMarkers highlights={highlights} duration={engine.duration} />
            )}
            renderRightControlsSlot={renderRightControlsSlot}
          />
        </div>
      </div>

      {/* Responsive Settings Sheet / Popover */}
      <PlayerSettingsSheet
        isOpen={isSettingsOpen}
        qualities={engine.qualities}
        selectedQuality={engine.selectedQuality}
        playbackRate={engine.playbackRate}
        ambientGlowEnabled={ambientGlowState}
        disableAnimations={resolvedMotionSettings?.disableAllAnimations}
        closeRequestRef={settingsCloseRef}
        language={resolvedLanguage}
        triggerRef={settingsBtnRef}
        onClose={() => setIsSettingsOpen(false)}
        onSelectQuality={engine.selectQuality}
        onSelectPlaybackRate={engine.setPlaybackRate}
        onToggleAmbientGlow={() => setAmbientGlowState((prev) => !prev)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
      />

      {/* Lazy Keyboard Shortcuts Dialog */}
      {isShortcutsOpen && (
        <Suspense fallback={null}>
          <PlayerShortcutsDialogLazy
            isOpen={isShortcutsOpen}
            language={resolvedLanguage}
            triggerRef={settingsBtnRef}
            disableAnimations={resolvedMotionSettings?.disableAllAnimations}
            onClose={() => setIsShortcutsOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
});

UniversalVideoPlayer.displayName = 'UniversalVideoPlayer';

export default UniversalVideoPlayer;
