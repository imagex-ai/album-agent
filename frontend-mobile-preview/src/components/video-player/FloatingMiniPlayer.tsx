/**
 * FloatingMiniPlayer.tsx
 *
 * Floating Mini-Player host component with 60fps drag physics, lateral Edge-Stash,
 * dynamic MiniTaskDock clearance, and external Picture-in-Picture bridge.
 *
 * Governed by:
 * - docs/video-player-architecture.md (Sections 4, 7, 8, 11)
 * - docs/superpowers/specs/2026-11-14-universal-video-player-design.md
 * - .superpowers/sdd/2026-11-14-universal-video-player/task-7-brief.md
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Move,
  Pause,
  PictureInPicture,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import {
  useMiniPlayerStore,
  resolveMiniPlayerDimensions,
  getMiniPlayerOuterSize,
  computeMiniPlayerViewportBounds,
  shouldSuppressFloatingMiniPlayer,
  DEFAULT_MINI_PLAYER_VIEWPORT,
  type PlayerRectSize,
  type PlayerViewportSize,
} from '../../store/useMiniPlayerStore';
import { UniversalVideoPlayer, type UniversalVideoPlayerHandle } from './ui/UniversalVideoPlayer';
import { useExternalPictureInPicture } from './engine/useExternalPictureInPicture';
import { createPipVideoTransfer } from './engine/pipVideoTransfer';
import { registerPlayerOverlayLayer, PLAYER_OVERLAY_PRIORITY } from './engine/playerOverlayStack';
import { closeWithExitTransition } from './engine/playerMotion';
import { useAppStore } from '../../store/useAppStore';
import { usePersistentPlayerStore } from '../../store/usePersistentPlayerStore';
import { translations } from '../../i18n/translations';
import type { Language } from '../../types';
import type { PlaybackHandoffSnapshot } from './engine/videoPlayerCore';
import './floating-mini-player.css';

export interface DragDismissParams {
  targetX: number;
  targetY: number;
  outerDims: PlayerRectSize;
  viewport: PlayerViewportSize;
}

export interface DragDismissResult {
  shouldDismiss: boolean;
  opacity: number;
  reason?: 'left' | 'right' | 'bottom';
}

/**
 * Resolves whether a drag movement constitutes an intentional outward dismissal
 * past screen boundaries, and calculates a proportional fade preview.
 */
export function resolveDragDismissState({
  targetX,
  targetY,
  outerDims,
  viewport,
}: DragDismissParams): DragDismissResult {
  const OUTWARD_THRESHOLD = 60;
  const isPastLeft = targetX < -OUTWARD_THRESHOLD;
  const isPastRight = targetX + outerDims.width > viewport.width + OUTWARD_THRESHOLD;
  const isPastBottom = targetY > viewport.height - 40;

  if (isPastLeft || isPastRight || isPastBottom) {
    let overflow = 0;
    if (isPastLeft) overflow = -targetX;
    else if (isPastRight) overflow = targetX + outerDims.width - viewport.width;
    else overflow = targetY + 40 - viewport.height;

    const opacity = Math.max(0.15, 1 - overflow / 200);
    return {
      shouldDismiss: true,
      opacity,
      reason: isPastLeft ? 'left' : isPastRight ? 'right' : 'bottom',
    };
  }

  // Subtle opacity preview when partially crossing edge bounds
  if (targetX < 0) {
    const overflow = -targetX;
    return { shouldDismiss: false, opacity: Math.max(0.65, 1 - overflow / 180) };
  }
  if (targetX + outerDims.width > viewport.width) {
    const overflow = targetX + outerDims.width - viewport.width;
    return { shouldDismiss: false, opacity: Math.max(0.65, 1 - overflow / 180) };
  }
  if (targetY > viewport.height - outerDims.height) {
    const overflow = targetY + outerDims.height - viewport.height;
    return { shouldDismiss: false, opacity: Math.max(0.7, 1 - overflow / 160) };
  }

  return { shouldDismiss: false, opacity: 1 };
}

export interface FloatingMiniPlayerProps {
  language?: Language;
}

export const FloatingMiniPlayer: React.FC<FloatingMiniPlayerProps> = ({ language: propLanguage }) => {
  const storeLanguage = useAppStore((s) => (s.settings.language || 'pt-BR') as Language);
  const language: Language = (propLanguage || storeLanguage || 'pt-BR') as Language;
  const t = (translations[language] || translations['pt-BR']).player;
  const settings = useAppStore((s) => s.settings);
  const currentView = useAppStore((s) => s.currentView);
  const activePlayingVideo = useAppStore((s) => s.activePlayingVideo);

  // App-level modal state: Escape must NOT close MiniPlayer if a foreground modal is active (I3)
  const hasBlockingAppModal = useAppStore((s: any) =>
    Boolean(
      s.activePlayingVideo ||
      s.activeFolderModal ||
      s.lightboxImage ||
      s.slideshowOpen ||
      s.contactSheetOpen ||
      s.coPilotOpen ||
      s.exportModalOpen ||
      s.keybindingsModalOpen ||
      s.webhookModalOpen ||
      s.commandPaletteOpen ||
      s.notificationDrawerOpen ||
      s.albumDiffModalOpen ||
      s.colorHarmonyOpen ||
      s.aiChatOpen
    )
  );

  const activeSession = useMiniPlayerStore((s) => s.activeSession);
  const isStashedEdge = useMiniPlayerStore((s) => s.isStashedEdge);
  const sizePreset = useMiniPlayerStore((s) => s.sizePreset);
  const position = useMiniPlayerStore((s) => s.position);
  const queue = useMiniPlayerStore((s) => s.queue);
  const autoPipOnTabSwitch = useMiniPlayerStore((s) => s.autoPipOnTabSwitch);
  const activeWatchVideoId = useMiniPlayerStore((s) => s.activeWatchVideoId);

  const updatePosition = useMiniPlayerStore((s) => s.updatePosition);
  const commitDragEnd = useMiniPlayerStore((s) => s.commitDragEnd);
  const stashToEdge = useMiniPlayerStore((s) => s.stashToEdge);
  const restoreFromEdge = useMiniPlayerStore((s) => s.restoreFromEdge);
  const cycleSizePreset = useMiniPlayerStore((s) => s.cycleSizePreset);
  const updateHandoff = useMiniPlayerStore((s) => s.updateHandoff);
  const playNextInQueue = useMiniPlayerStore((s) => s.playNextInQueue);
  const playPreviousInQueue = useMiniPlayerStore((s) => s.playPreviousInQueue);
  const setAutoPipOnTabSwitch = useMiniPlayerStore((s) => s.setAutoPipOnTabSwitch);
  const expandToOrigin = useMiniPlayerStore((s) => s.expandToOrigin);
  const dismissMiniPlayer = useMiniPlayerStore((s) => s.dismissMiniPlayer);

  const playerRef = useRef<UniversalVideoPlayerHandle | null>(null);
  const hostMounted = usePersistentPlayerStore((s) => s.hostMounted);
  const persistentActiveSourceKey = usePersistentPlayerStore((s) => s.activeSourceKey);
  const persistentPlayerHandle = usePersistentPlayerStore((s) => s.playerHandle);
  const isHostedByPersistentPortal =
    hostMounted &&
    Boolean(activeSession) &&
    (!persistentActiveSourceKey || persistentActiveSourceKey === activeSession?.source.id);

  useEffect(() => {
    if (isHostedByPersistentPortal) {
      playerRef.current = persistentPlayerHandle;
      videoRef.current = persistentPlayerHandle?.getVideoElement() ?? null;
    }
  }, [isHostedByPersistentPortal, persistentPlayerHandle]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [liveIsPlaying, setLiveIsPlaying] = useState<boolean>(() =>
    Boolean(activeSession?.handoff?.isPlaying)
  );
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Sync live isPlaying whenever session changes
  useEffect(() => {
    setLiveIsPlaying(Boolean(activeSession?.handoff?.isPlaying));
  }, [activeSession?.sessionKey]);

  // Seed initialHandoff only when sessionKey or source.id changes so live updateHandoff() writes
  // never feed back into UniversalVideoPlayer's initialHandoff prop and trigger a seek loop.
  const seedHandoff = useMemo<PlaybackHandoffSnapshot | undefined>(() => {
    return activeSession?.handoff;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.sessionKey, activeSession?.source.id]);

  // Viewport state for responsive dimensions and reclamping (I1)
  const [viewport, setViewport] = useState<PlayerViewportSize>(() => {
    if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return DEFAULT_MINI_PLAYER_VIEWPORT;
  });
  const [pointerRevision, setPointerRevision] = useState(0);

  // Calculate inner and outer dimensions for current preset and responsive viewport
  const dims = useMemo(() => {
    return resolveMiniPlayerDimensions(sizePreset, viewport);
  }, [sizePreset, viewport]);

  const outerDims = useMemo(() => {
    return getMiniPlayerOuterSize(dims);
  }, [dims, pointerRevision]);

  // Sync internal video ref whenever playerRef mounts/updates
  const syncVideoRef = useCallback(() => {
    const el = playerRef.current?.getVideoElement() ?? null;
    videoRef.current = el;
  }, []);

  useEffect(() => {
    syncVideoRef();
  }, [activeSession?.source.id, syncVideoRef]);

  const isSuppressed = shouldSuppressFloatingMiniPlayer({
    activeSession,
    currentView,
    activePlayingVideo,
    activeWatchVideoId,
  });

  const handleMiniPlaybackStateChange = useCallback(
    (st: { isPlaying: boolean }) => {
      setLiveIsPlaying((prev) => (prev === st.isPlaying ? prev : st.isPlaying));
      syncVideoRef();
    },
    [syncVideoRef]
  );

  useEffect(() => {
    if (!isHostedByPersistentPortal || !activeSession || !playerContainerRef.current) {
      usePersistentPlayerStore.getState().setMiniSlot(null);
      return;
    }
    usePersistentPlayerStore.getState().setMiniSlot({
      element: playerContainerRef.current,
      sourceId: activeSession.source.id,
      suspended: currentView === 'shorts',
      isActive: !isSuppressed && isStashedEdge === null,
      language,
      motionSettings: settings,
      onPlaybackStateChange: handleMiniPlaybackStateChange,
      onPlaybackSnapshot: updateHandoff,
    });
    return () => {
      usePersistentPlayerStore.getState().setMiniSlot(null);
    };
  }, [
    isHostedByPersistentPortal,
    activeSession,
    currentView,
    isSuppressed,
    isStashedEdge,
    language,
    settings,
    handleMiniPlaybackStateChange,
    updateHandoff,
  ]);

  // Capture snapshot before being suppressed (e.g. entering Shorts or modal)
  const prevSuppressedRef = useRef(isSuppressed);
  useEffect(() => {
    if (!prevSuppressedRef.current && isSuppressed && playerRef.current) {
      try {
        const snap = playerRef.current.capturePlaybackSnapshot();
        updateHandoff(snap);
      } catch {
        // Safe capture fallback
      }
    }
    prevSuppressedRef.current = isSuppressed;
  }, [isSuppressed, updateHandoff]);

  // Maintain inert & visibility on player container when hidden or stashed (I3)
  useEffect(() => {
    if (!playerContainerRef.current) return;
    const shouldHide = isSuppressed || isStashedEdge !== null;
    playerContainerRef.current.style.visibility = shouldHide ? 'hidden' : 'visible';
    if ('inert' in playerContainerRef.current) {
      (playerContainerRef.current as any).inert = shouldHide;
    }
    if (shouldHide) {
      playerContainerRef.current.setAttribute('aria-hidden', 'true');
    } else {
      playerContainerRef.current.removeAttribute('aria-hidden');
    }
  }, [isSuppressed, isStashedEdge]);

  // Restore the adopted element before a closing PiP document tears down its media.
  const originalVideoParentRef = useRef<HTMLElement | null>(null);
  const originalVideoNextSiblingRef = useRef<Node | null>(null);
  const pipTransferRef = useRef<ReturnType<typeof createPipVideoTransfer> | null>(null);
  const restorePipVideo = useCallback(() => {
    const vid = playerRef.current?.getVideoElement() ?? videoRef.current;
    const parent = originalVideoParentRef.current;
    if (!vid || !parent) return;
    try {
      if (vid.parentElement !== parent) {
        if (!pipTransferRef.current) return;
        pipTransferRef.current.move(parent, originalVideoNextSiblingRef.current);
      }
    } catch {
      try {
        // Retry without insertion ordering if the first DOM operation failed.
        pipTransferRef.current?.move(parent);
      } catch {
        // Keep the original parent available for the effect cleanup to retry.
        return;
      }
    }
    originalVideoParentRef.current = null;
    originalVideoNextSiblingRef.current = null;
  }, []);

  // Register before the PiP hook: on unmount, return the media before that
  // hook closes its document. The same video element stays in PiP across
  // session changes, so its transfer must survive those changes as well.
  useEffect(() => () => {
    restorePipVideo();
    pipTransferRef.current?.dispose();
    pipTransferRef.current = null;
  }, [restorePipVideo]);

  // External Picture-in-Picture bridge
  const { togglePip, exitPip, pipMode, pipContainer } = useExternalPictureInPicture({
    videoRef,
    isPlaying: liveIsPlaying,
    autoPipOnTabSwitch,
    onPipExit: (mode) => {
      if (mode === 'document') restorePipVideo();
    },
  });

  // Document PiP video reparenting & restore on exit (I4)
  useEffect(() => {
    if (pipMode === 'document' && pipContainer) {
      const vid = playerRef.current?.getVideoElement() ?? videoRef.current;
      if (vid && vid.parentElement && vid.parentElement !== pipContainer) {
        originalVideoParentRef.current = vid.parentElement;
        originalVideoNextSiblingRef.current = vid.nextSibling;
        const targetSlot = pipContainer.querySelector('[data-fmp-pip-video-slot]') || pipContainer;
        pipTransferRef.current?.dispose();
        pipTransferRef.current = createPipVideoTransfer(vid, () => playerRef.current?.play());
        try {
          pipTransferRef.current.move(targetSlot);
        } catch {
          restorePipVideo();
          void exitPip().catch(() => {});
        }
      }
    } else {
      restorePipVideo();
    }

    return restorePipVideo;
  }, [pipMode, pipContainer, restorePipVideo, exitPip]);

  // 60fps drag physics refs (I5)
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    lastDx: number;
    lastDy: number;
    isDragging: boolean;
  }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    lastDx: 0,
    lastDy: 0,
    isDragging: false,
  });
  const rafIdRef = useRef<number>(0);

  // Unmount rAF cleanup (I5)
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    if (shellRef.current) {
      closeWithExitTransition(
        shellRef.current,
        undefined,
        () => {
          dismissMiniPlayer();
        },
        { disableAllAnimations: settings?.disableAllAnimations }
      );
    } else {
      dismissMiniPlayer();
    }
  }, [dismissMiniPlayer, settings?.disableAllAnimations]);

  // Smooth FLIP entrance animation when minimizing from cinema/watch into the mini-player
  useEffect(() => {
    if (!activeSession || isSuppressed || isStashedEdge !== null) return;
    const shell = shellRef.current;
    if (!shell || settings?.disableAllAnimations || typeof shell.animate !== 'function') return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const from = usePersistentPlayerStore.getState().consumePendingFlipRect();
    if (!from || from.width <= 0 || from.height <= 0) return;
    const to = shell.getBoundingClientRect();
    if (to.width <= 0 || to.height <= 0) return;

    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = from.width / to.width;
    const sy = from.height / to.height;

    const anim = shell.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate3d(calc(var(--fmp-x, ${position.x}px) + ${dx}px), calc(var(--fmp-y, ${position.y}px) + ${dy}px), 0) scale(${sx}, ${sy})`,
        },
        {
          transformOrigin: 'top left',
          transform: `translate3d(var(--fmp-x, ${position.x}px), var(--fmp-y, ${position.y}px), 0) scale(1, 1)`,
        },
      ],
      { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
    return () => {
      anim.cancel();
    };
  }, [activeSession?.sessionKey, isSuppressed, isStashedEdge, settings?.disableAllAnimations]);

  const handleExpand = useCallback(() => {
    let snap: PlaybackHandoffSnapshot | undefined;
    if (playerRef.current) {
      try {
        snap = playerRef.current.capturePlaybackSnapshot();
        updateHandoff(snap);
      } catch {
        // Safe capture fallback
      }
    }
    const sourceEl = playerContainerRef.current || shellRef.current;
    if (sourceEl && typeof sourceEl.getBoundingClientRect === 'function') {
      const rect = sourceEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        usePersistentPlayerStore.getState().setPendingFlipRect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          capturedAt: Date.now(),
        });
      }
    }
    expandToOrigin(snap);
  }, [expandToOrigin, updateHandoff]);

  // Escape key registration via playerOverlayStack (I3)
  useEffect(() => {
    if (
      isSuppressed ||
      isStashedEdge !== null ||
      !activeSession ||
      hasBlockingAppModal
    ) {
      return;
    }

    const unregister = registerPlayerOverlayLayer({
      id: 'floating-mini-player',
      priority: PLAYER_OVERLAY_PRIORITY.MINI_PLAYER,
      onDismiss: () => {
        // Double-check DOM fallback before handling dismiss
        if (typeof document !== 'undefined') {
          const hasDomModal = document.querySelector(
            '[role="dialog"]:not([data-player-overlay-layer]), .fixed.inset-0.z-50:not([data-player-overlay-layer])'
          );
          if (hasDomModal) return;
        }
        handleClose();
      },
      dialogElement: shellRef.current,
    });

    return unregister;
  }, [isSuppressed, isStashedEdge, Boolean(activeSession), hasBlockingAppModal, handleClose]);

  // Reactive Viewport & Dock Resize (I1, I2)
  const handleReclamp = useCallback(() => {
    const vp =
      typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0
        ? { width: window.innerWidth, height: window.innerHeight }
        : DEFAULT_MINI_PLAYER_VIEWPORT;
    setViewport((prev: PlayerViewportSize) => {
      if (prev.width === vp.width && prev.height === vp.height) return prev;
      return vp;
    });
    const current = useMiniPlayerStore.getState();
    if (!current.activeSession || current.isStashedEdge !== null) return;
    const { safeBottom } = computeMiniPlayerViewportBounds(vp);
    current.updatePosition(current.position, vp, safeBottom);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const pointerMedia = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    const handlePointerChange = () => {
      setPointerRevision(revision => revision + 1);
      handleReclamp();
    };
    window.addEventListener('resize', handleReclamp);
    window.addEventListener('imagex:mini-task-dock-height', handleReclamp);
    pointerMedia?.addEventListener?.('change', handlePointerChange);

    return () => {
      window.removeEventListener('resize', handleReclamp);
      window.removeEventListener('imagex:mini-task-dock-height', handleReclamp);
      pointerMedia?.removeEventListener?.('change', handlePointerChange);
    };
  }, [handleReclamp]);

  // Coalesced Drag event handlers (C3, I5)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.closest('.fmp-header-actions') || target.closest('button') || target.closest('input') || target.closest('select'))) {
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // safe fallback
    }

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
      lastDx: 0,
      lastDy: 0,
      isDragging: true,
    };
    setIsDragging(true);

    if (shellRef.current) {
      shellRef.current.style.setProperty('--fmp-dx', '0px');
      shellRef.current.style.setProperty('--fmp-dy', '0px');
      shellRef.current.style.setProperty('--fmp-swipe-opacity', '1');
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.isDragging) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    dragRef.current.lastDx = dx;
    dragRef.current.lastDy = dy;

    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (shellRef.current && dragRef.current.isDragging) {
          shellRef.current.style.setProperty('--fmp-dx', `${dragRef.current.lastDx}px`);
          shellRef.current.style.setProperty('--fmp-dy', `${dragRef.current.lastDy}px`);

          const targetX = dragRef.current.initialX + dragRef.current.lastDx;
          const targetY = dragRef.current.initialY + dragRef.current.lastDy;
          const dismissState = resolveDragDismissState({
            targetX,
            targetY,
            outerDims,
            viewport,
          });
          shellRef.current.style.setProperty('--fmp-swipe-opacity', String(dismissState.opacity));
        }
        rafIdRef.current = 0;
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;
    setIsDragging(false);

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // safe fallback
    }

    const dx = dragRef.current.lastDx;
    const dy = dragRef.current.lastDy;
    const targetX = dragRef.current.initialX + dx;
    const targetY = dragRef.current.initialY + dy;

    const dismissState = resolveDragDismissState({
      targetX,
      targetY,
      outerDims,
      viewport,
    });

    if (dismissState.shouldDismiss) {
      handleClose();
      return;
    }

    if (shellRef.current) {
      shellRef.current.style.removeProperty('--fmp-dx');
      shellRef.current.style.removeProperty('--fmp-dy');
      shellRef.current.style.removeProperty('--fmp-swipe-opacity');
    }

    const { safeBottom } = computeMiniPlayerViewportBounds(viewport);
    updatePosition({ x: targetX, y: targetY }, viewport, safeBottom);
    commitDragEnd(viewport, safeBottom);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;
    setIsDragging(false);
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    if (shellRef.current) {
      shellRef.current.style.removeProperty('--fmp-dx');
      shellRef.current.style.removeProperty('--fmp-dy');
      shellRef.current.style.removeProperty('--fmp-swipe-opacity');
    }
  };

  // Dynamic Stash Side calculation from horizontal midpoint (M1)
  const isLeftSide = position.x + outerDims.width / 2 < viewport.width / 2;
  const handleStashButtonClick = () => {
    stashToEdge(isLeftSide ? 'left' : 'right');
  };

  // Live Prev In Queue with timestamp restart (I6)
  const handlePreviousInQueue = () => {
    let currentLiveTime: number | undefined;
    if (playerRef.current) {
      try {
        const snap = playerRef.current.capturePlaybackSnapshot();
        currentLiveTime = snap.currentTime;
      } catch {
        // Safe capture fallback
      }
    }
    playPreviousInQueue(currentLiveTime);
  };

  if (!activeSession) {
    return null;
  }

  // C1 FIX: SINGLE STABLE ROOT JSX TREE
  // Child 1 (Edge-Stash Tab), Child 2 (Header bar), Child 3 (Player Surface)
  // are permanent direct children of shellRef. When active, card styling lives directly on shellRef!
  const isStashed = isStashedEdge !== null;
  const currentTitle = activeSession.source.title || t.untitledVideo;

  return (
    <div
      ref={shellRef}
      data-visible={!isStashed && !isSuppressed ? 'true' : 'false'}
      className={`fixed z-[45] fmp-shell ${
        !isStashed && !isSuppressed
          ? 'flex flex-col rounded-2xl overflow-hidden border border-[var(--tl-border)] bg-[var(--tl-surface)]/95 shadow-2xl backdrop-blur-xl focus-within:ring-2 focus-within:ring-[var(--tl-accent)]'
          : ''
      } ${isDragging ? 'fmp-dragging' : ''} ${
        settings?.disableAllAnimations ? 'fmp-reduced-motion' : ''
      }`}
      style={
        isSuppressed
          ? {
              left: '-9999px',
              top: '-9999px',
              width: '1px',
              height: '1px',
              opacity: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
            }
          : isStashed
          ? {
              left: isStashedEdge === 'left' ? 0 : 'auto',
              right: isStashedEdge === 'right' ? 0 : 'auto',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '28px',
              height: '72px',
              ['--fmp-x' as any]: '0px',
              ['--fmp-y' as any]: '0px',
            }
          : {
              left: 0,
              top: 0,
              width: `${outerDims.width}px`,
              height: `${outerDims.height}px`,
              ['--fmp-x' as any]: `${position.x}px`,
              ['--fmp-y' as any]: `${position.y}px`,
              transform: `translate3d(calc(var(--fmp-x, ${position.x}px) + var(--fmp-dx, 0px)), calc(var(--fmp-y, ${position.y}px) + var(--fmp-dy, 0px)), 0)`,
              opacity: 'var(--fmp-swipe-opacity, 1)',
            }
      }
      data-testid="floating-mini-player"
      data-stashed={isStashed ? isStashedEdge : undefined}
    >
      {/* 1. EDGE-STASH TAB: Sleek 28×72px lateral tab (Fixed Child 0, visible when stashed) */}
      <div
        data-stashed={isStashedEdge || undefined}
        className={`fmp-stash-tab w-7 h-[72px] ${
          isStashedEdge === 'left'
            ? 'rounded-r-2xl border-l-0'
            : 'rounded-l-2xl border-r-0'
        } glass-panel-elevated bg-[var(--tl-surface)]/95 hover:bg-[var(--tl-surface)] border border-[var(--tl-border)] shadow-2xl flex-col items-center justify-between py-2 cursor-pointer transition-transform active:scale-95 group select-none ${
          isStashed && !isSuppressed ? 'flex' : 'hidden'
        }`}
        onClick={() => restoreFromEdge(viewport)}
        role="button"
        tabIndex={isStashed && !isSuppressed ? 0 : -1}
        aria-label={t.restoreFromEdge}
        title={t.restoreFromEdge}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            restoreFromEdge(viewport);
          }
        }}
      >
        {isStashedEdge === 'left' ? (
          <ChevronRight
            size={13}
            className="text-[var(--tl-accent)] group-hover:translate-x-0.5 transition-transform"
          />
        ) : (
          <ChevronLeft
            size={13}
            className="text-[var(--tl-accent)] group-hover:-translate-x-0.5 transition-transform"
          />
        )}

        {/* Equalizer playback indicator with compositor transform: scaleY (I5) */}
        <div
          className={`flex items-end justify-center gap-0.5 h-3.5 w-3.5 ${
            !liveIsPlaying ? 'fmp-eq-paused' : ''
          }`}
          aria-hidden="true"
        >
          <span className="w-0.5 h-2.5 bg-[var(--tl-accent)] rounded-full fmp-eq-bar" />
          <span className="w-0.5 h-3.5 bg-[var(--tl-accent)] rounded-full fmp-eq-bar" />
          <span className="w-0.5 h-2 bg-[var(--tl-accent)] rounded-full fmp-eq-bar" />
        </div>
      </div>

      {/* 2. HEADER BAR / DRAG HANDLE: Visible when active (h-9 shrink-0) */}
      <div
        className={`fmp-header h-9 shrink-0 px-2 bg-[var(--tl-surface)]/80 border-b border-[var(--tl-border)]/50 items-center justify-between gap-1 cursor-grab active:cursor-grabbing select-none text-[var(--tl-text-primary)] ${
          isStashed || isSuppressed ? 'hidden' : 'flex'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{ height: outerDims.height - dims.height, minHeight: outerDims.height - dims.height }}
      >
        {/* Left: Move icon & Title */}
        <div className="fmp-header-title flex items-center self-stretch gap-1.5 min-w-0 flex-1">
          <Move size={12} className="text-[var(--tl-text-muted)] shrink-0 opacity-70" />
          <span className="text-xs font-semibold truncate leading-none text-[var(--tl-text-primary)]">
            {currentTitle}
          </span>
        </div>

        {/* Right: Actions */}
        <div className="fmp-header-actions flex items-center gap-0.5 shrink-0">
          {/* Queue Navigation (when queue has items) */}
          {queue.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePreviousInQueue}
                aria-label={t.previousVideo}
                title={t.previousVideo}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] cute-press cursor-pointer"
              >
                <SkipBack size={13} />
              </button>
              <button
                type="button"
                onClick={playNextInQueue}
                aria-label={t.nextVideo}
                title={t.nextVideo}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] cute-press cursor-pointer"
              >
                <SkipForward size={13} />
              </button>
            </>
          )}

          {/* Size Cycle Preset */}
          <button
            type="button"
            onClick={() => cycleSizePreset(viewport)}
            aria-label={`${t.miniPlayer} (${sizePreset.toUpperCase()})`}
            title={`${t.miniPlayer} (${sizePreset.toUpperCase()})`}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] cute-press cursor-pointer font-mono text-[10px] font-bold"
          >
            {sizePreset.toUpperCase()}
          </button>

          {/* Edge-Stash Button with dynamic midpoint direction (M1) */}
          <button
            type="button"
            onClick={handleStashButtonClick}
            aria-label={t.stashToEdge}
            title={t.stashToEdge}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] cute-press cursor-pointer"
          >
            {isLeftSide ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
          </button>

          {/* Auto-PiP on Tab Switch Toggle (I4) */}
          <button
            type="button"
            onClick={() => setAutoPipOnTabSwitch(!autoPipOnTabSwitch)}
            aria-pressed={autoPipOnTabSwitch}
            aria-label={t.autoPipOnTabSwitch}
            title={t.autoPipOnTabSwitch}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all cute-press cursor-pointer relative ${
              autoPipOnTabSwitch
                ? 'text-[var(--tl-accent)] bg-[var(--tl-surface-hover)] font-bold'
                : 'text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)]'
            }`}
          >
            <Repeat size={12} />
            {autoPipOnTabSwitch && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--tl-accent)] absolute top-1 right-1" />
            )}
          </button>

          {/* External Picture-in-Picture Button (I4) */}
          <button
            type="button"
            onClick={() => togglePip()}
            aria-label={t.externalPip}
            title={t.externalPip}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all cute-press cursor-pointer ${
              pipMode !== 'none'
                ? 'text-[var(--tl-accent)] bg-[var(--tl-surface-hover)]'
                : 'text-[var(--tl-text-muted)] hover:text-[var(--tl-accent)] hover:bg-[var(--tl-surface-hover)]'
            }`}
          >
            <PictureInPicture size={13} />
          </button>

          {/* Expand to Watch / Modal (C4) */}
          <button
            type="button"
            onClick={handleExpand}
            aria-label={t.expandPlayer}
            title={t.expandPlayer}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tl-text-muted)] hover:text-[var(--tl-accent)] hover:bg-[var(--tl-surface-hover)] cute-press cursor-pointer"
          >
            <Maximize2 size={13} />
          </button>

          {/* Dismiss Mini Player */}
          <button
            type="button"
            onClick={handleClose}
            aria-label={t.closePlayer}
            title={t.closePlayer}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tl-text-muted)] hover:text-rose-400 hover:bg-[var(--tl-surface-hover)] cute-press cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 3. SINGLE STABLE PLAYER SURFACE: Holds <UniversalVideoPlayer> inside card (C1, C2, I3) */}
      <div
        ref={playerContainerRef}
        className={
          isStashed || isSuppressed
            ? 'pointer-events-none fixed -top-[9999px] -left-[9999px] w-[1px] h-[1px] overflow-hidden opacity-0'
            : 'flex-1 min-h-0 w-full bg-black relative overflow-hidden'
        }
      >
        {!isHostedByPersistentPortal && (
          <UniversalVideoPlayer
            ref={playerRef}
            source={activeSession.source}
            density="mini"
            suspended={isSuppressed}
            isActive={!isSuppressed && !isStashed}
            initialHandoff={seedHandoff}
            language={language}
            motionSettings={settings}
            onPlaybackStateChange={handleMiniPlaybackStateChange}
            onPlaybackSnapshot={updateHandoff}
          />
        )}
      </div>

      {/* 4. DOCUMENT PIP PORTAL UI (I4): Render clean compact controls inside OS Document PiP window */}
      {pipMode === 'document' && pipContainer && createPortal(
        <div className="w-full h-full bg-[var(--tl-surface)] text-[var(--tl-text-primary)] border border-[var(--tl-border)] flex flex-col justify-between select-none">
          {/* Header strip */}
          <div className="h-8 px-2 bg-[var(--tl-surface)] border-b border-[var(--tl-border)]/60 flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs font-semibold truncate text-[var(--tl-text-primary)]">
              {currentTitle}
            </span>
            <button
              type="button"
              onClick={() => togglePip()}
              aria-label={t.externalPip}
              title={t.externalPip}
              className="text-xs px-2 py-0.5 rounded bg-[var(--tl-surface-hover)] text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] border border-[var(--tl-border)] transition-colors cursor-pointer"
            >
              {t.externalPip}
            </button>
          </div>

          {/* Video slot: live video element gets mounted here */}
          <div
            data-fmp-pip-video-slot="true"
            className="flex-1 min-h-0 w-full bg-black relative flex items-center justify-center overflow-hidden"
          />

          {/* Footer controls strip */}
          <div className="h-10 px-3 bg-[var(--tl-surface)] border-t border-[var(--tl-border)]/60 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              {queue.length > 1 && (
                <button
                  type="button"
                  onClick={handlePreviousInQueue}
                  aria-label={t.previousVideo}
                  title={t.previousVideo}
                  className="p-1 rounded text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors cursor-pointer"
                >
                  <SkipBack size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (liveIsPlaying) {
                    playerRef.current?.pause();
                  } else {
                    playerRef.current?.play();
                  }
                }}
                aria-label={liveIsPlaying ? t.pause : t.play}
                title={liveIsPlaying ? t.pause : t.play}
                className="p-1.5 rounded-full bg-[var(--tl-accent)] text-white shadow transition-transform active:scale-95 cursor-pointer"
              >
                {liveIsPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              {queue.length > 1 && (
                <button
                  type="button"
                  onClick={playNextInQueue}
                  aria-label={t.nextVideo}
                  title={t.nextVideo}
                  className="p-1 rounded text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors cursor-pointer"
                >
                  <SkipForward size={14} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleClose}
              aria-label={t.closePlayer}
              title={t.closePlayer}
              className="text-xs px-2 py-0.5 rounded text-[var(--tl-text-muted)] hover:text-rose-400 hover:bg-[var(--tl-surface-hover)] transition-colors cursor-pointer"
            >
              {t.closePlayer}
            </button>
          </div>
        </div>,
        pipContainer
      )}
    </div>
  );
};

export default FloatingMiniPlayer;
