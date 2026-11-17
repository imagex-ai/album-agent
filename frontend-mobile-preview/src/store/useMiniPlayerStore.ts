/**
 * useMiniPlayerStore.ts
 *
 * Global state store for IMAGEX.AI Floating Mini-Player.
 * Governs active floating video session, in-app lateral Edge-Stash snaps (<= 28px),
 * viewport clamp math clearing MiniTaskDock (--mini-task-dock-height),
 * size presets ('sm' | 'md' | 'lg'), queue advance, and handoff synchronization.
 *
 * Governed by:
 * - docs/video-player-architecture.md (Section 7)
 * - docs/superpowers/specs/2026-11-14-universal-video-player-design.md
 */

import { create } from 'zustand';
import {
  clampMiniPlayerRect,
  resolveEdgeStashSnap,
  EDGE_STASH_THRESHOLD_PX,
  type UniversalVideoSource,
  type PlaybackHandoffSnapshot,
  type PlayerViewportSize,
  type PlayerRectPosition,
  type PlayerRectSize,
} from '../components/video-player/engine/videoPlayerCore';
import { useAppStore } from './useAppStore';

export type { PlayerViewportSize, PlayerRectPosition, PlayerRectSize };

export const MINI_PLAYER_HEADER_HEIGHT = 36;
export const MINI_PLAYER_TOUCH_HEADER_HEIGHT = 50;
export const DEFAULT_MINI_PLAYER_VIEWPORT: PlayerViewportSize = { width: 1280, height: 720 };

export type MiniPlayerSizePreset = 'sm' | 'md' | 'lg';

// Keep the floating surface compact on phones in either orientation. These
// dimensions belong to the mini-player, independent of the cinema/feed layout.
const MINI_PLAYER_COMPACT_VIEWPORT_MAX = 480;
const MINI_PLAYER_VIEWPORT_GUTTER = 24;
const MINI_PLAYER_DESKTOP_WIDTHS: Record<MiniPlayerSizePreset, number> = { sm: 280, md: 340, lg: 420 };
const MINI_PLAYER_COMPACT_WIDTHS: Record<MiniPlayerSizePreset, number> = { sm: 176, md: 224, lg: 272 };

export interface MiniPlayerSession {
  source: UniversalVideoSource;
  handoff: PlaybackHandoffSnapshot;
  sessionKey: string;
  openedAt: number;
}

export interface OpenMiniPlayerPayload {
  source: UniversalVideoSource;
  handoff?: Partial<PlaybackHandoffSnapshot>;
  queue?: UniversalVideoSource[];
  position?: PlayerRectPosition;
  sizePreset?: MiniPlayerSizePreset;
}

export interface ShouldSuppressFloatingMiniPlayerParams {
  activeSession: MiniPlayerSession | null;
  currentView?: string | null;
  activePlayingVideo?: { id?: string | null } | null;
  activeWatchVideoId?: string | null;
}

export interface PendingExpandHandoffRecord {
  source: UniversalVideoSource;
  handoff: PlaybackHandoffSnapshot;
  capturedAt: number;
}

export interface MiniPlayerStoreState {
  activeSession: MiniPlayerSession | null;
  isStashedEdge: 'left' | 'right' | null;
  sizePreset: MiniPlayerSizePreset;
  position: PlayerRectPosition;
  queue: UniversalVideoSource[];
  autoPipOnTabSwitch: boolean;
  activeWatchVideoId: string | null;
  pendingExpandHandoff: PendingExpandHandoffRecord | null;

  // Actions
  setActiveWatchVideoId: (id: string | null) => void;
  consumePendingExpandHandoff: (videoIdOrKey?: string) => PlaybackHandoffSnapshot | null;
  openMiniPlayer: (
    payload: OpenMiniPlayerPayload,
    viewport?: PlayerViewportSize,
    dockHeight?: number
  ) => void;
  updatePosition: (
    pos: PlayerRectPosition,
    viewport?: PlayerViewportSize,
    dockHeight?: number
  ) => void;
  commitDragEnd: (viewport?: PlayerViewportSize, dockHeight?: number) => void;
  stashToEdge: (side: 'left' | 'right') => void;
  restoreFromEdge: (viewport?: PlayerViewportSize, dockHeight?: number) => void;
  setSizePreset: (
    preset: MiniPlayerSizePreset,
    viewport?: PlayerViewportSize,
    dockHeight?: number
  ) => void;
  cycleSizePreset: (viewport?: PlayerViewportSize, dockHeight?: number) => void;
  updateHandoff: (patch: Partial<PlaybackHandoffSnapshot>) => void;
  playNextInQueue: () => void;
  playPreviousInQueue: (liveCurrentTime?: number) => void;
  setAutoPipOnTabSwitch: (enabled: boolean) => void;
  expandToOrigin: (liveHandoff?: PlaybackHandoffSnapshot) => void;
  dismissMiniPlayer: () => void;
}

/**
 * Returns outer dimensions including the header bar height.
 */
export function getMiniPlayerOuterSize(size: PlayerRectSize): PlayerRectSize {
  const touchHeader = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return {
    width: size.width,
    height: size.height + (touchHeader ? MINI_PLAYER_TOUCH_HEADER_HEIGHT : MINI_PLAYER_HEADER_HEIGHT),
  };
}

/**
 * Resolves width & height in pixels for a given Mini-Player size preset.
 * Constrains width defensively against available viewport width minus margins.
 */
export function resolveMiniPlayerDimensions(
  preset: MiniPlayerSizePreset = 'md',
  viewport?: PlayerViewportSize
): PlayerRectSize {
  const vp =
    viewport && viewport.width > 0
      ? viewport
      : typeof window !== 'undefined' && window.innerWidth > 0
      ? { width: window.innerWidth, height: window.innerHeight }
      : DEFAULT_MINI_PLAYER_VIEWPORT;

  const shortEdge = vp.height > 0 ? Math.min(vp.width, vp.height) : vp.width;
  const widths = shortEdge <= MINI_PLAYER_COMPACT_VIEWPORT_MAX
    ? MINI_PLAYER_COMPACT_WIDTHS : MINI_PLAYER_DESKTOP_WIDTHS;
  const maxWidth = Math.max(1, Math.floor(vp.width - MINI_PLAYER_VIEWPORT_GUTTER));
  const width = Math.min(widths[preset], maxWidth);

  const height = Math.round((width * 9) / 16);
  return { width, height };
}

/**
 * Resolves current viewport size and safe bottom clearance (e.g. from MiniTaskDock).
 */
export function computeMiniPlayerViewportBounds(
  viewport?: PlayerViewportSize,
  dockHeight = 0
): { viewport: PlayerViewportSize; safeBottom: number } {
  let vpWidth = DEFAULT_MINI_PLAYER_VIEWPORT.width;
  let vpHeight = DEFAULT_MINI_PLAYER_VIEWPORT.height;

  if (viewport && typeof viewport.width === 'number' && viewport.width > 0) {
    vpWidth = viewport.width;
  } else if (typeof window !== 'undefined' && window.innerWidth > 0) {
    vpWidth = window.innerWidth;
  }

  if (viewport && typeof viewport.height === 'number' && viewport.height > 0) {
    vpHeight = viewport.height;
  } else if (typeof window !== 'undefined' && window.innerHeight > 0) {
    vpHeight = window.innerHeight;
  }

  let measuredDock = typeof dockHeight === 'number' && Number.isFinite(dockHeight) ? dockHeight : 0;
  if (measuredDock <= 0 && typeof document !== 'undefined') {
    try {
      const cssVar = document.documentElement.style.getPropertyValue('--mini-task-dock-height');
      const parsed = parseFloat(cssVar);
      if (Number.isFinite(parsed) && parsed > 0) {
        measuredDock = parsed;
      }
    } catch {
      // safe fallback
    }
  }

  return {
    viewport: { width: vpWidth, height: vpHeight },
    safeBottom: Math.max(0, measuredDock),
  };
}

/**
 * Calculates safe bottom-right corner docking position for mini-player.
 * Uses outer size (including header bar) to prevent colliding with task dock.
 */
export function resolveDefaultMiniPlayerPosition(
  size: PlayerRectSize,
  viewport?: PlayerViewportSize,
  dockHeight = 0
): PlayerRectPosition {
  const { viewport: vp, safeBottom } = computeMiniPlayerViewportBounds(viewport, dockHeight);
  const outer = getMiniPlayerOuterSize(size);
  const margin = 16;
  const targetX = Math.max(0, vp.width - outer.width - margin);
  const targetY = Math.max(0, vp.height - outer.height - safeBottom - margin);
  return clampMiniPlayerRect({ x: targetX, y: targetY }, outer, vp, safeBottom);
}

/**
 * Determines whether FloatingMiniPlayer must be suppressed/hidden from view:
 * 1. When no session is active.
 * 2. When currentView === 'shorts' (to avoid fighting vertical Shorts audio/scrolling).
 * 3. When full VideoPlayerModal is playing the same video.
 * 4. When TimelineWatchView is currently rendering the same video.
 */
export function shouldSuppressFloatingMiniPlayer(
  params: ShouldSuppressFloatingMiniPlayerParams
): boolean {
  if (!params.activeSession) return true;
  if (params.currentView === 'shorts') return true;
  if (
    params.activePlayingVideo &&
    params.activePlayingVideo.id &&
    params.activeSession.source &&
    params.activePlayingVideo.id === params.activeSession.source.id
  ) {
    return true;
  }
  if (
    params.activeWatchVideoId &&
    params.activeSession.source &&
    params.activeWatchVideoId === params.activeSession.source.id
  ) {
    return true;
  }
  return false;
}

const DEFAULT_INITIAL_POSITION: PlayerRectPosition = { x: 800, y: 500 };

export const useMiniPlayerStore = create<MiniPlayerStoreState>((set, get, api) => {
  // Support live SSR snapshot in Node renderToStaticMarkup environments
  if (api && typeof api === 'object') {
    (api as any).getServerState = () => get();
  }

  return {
    activeSession: null,
    isStashedEdge: null,
    sizePreset: 'md',
    position: DEFAULT_INITIAL_POSITION,
    queue: [],
    autoPipOnTabSwitch: false,
    activeWatchVideoId: null,
    pendingExpandHandoff: null,

    setActiveWatchVideoId: (id) => {
      set({ activeWatchVideoId: id });
    },

    consumePendingExpandHandoff: (videoIdOrKey) => {
      const record = get().pendingExpandHandoff;
      if (!record) return null;
      if (
        videoIdOrKey &&
        record.source.id !== videoIdOrKey &&
        record.source.streamUrl !== videoIdOrKey
      ) {
        return null;
      }
      set({ pendingExpandHandoff: null });
      return record.handoff;
    },

    openMiniPlayer: (payload, viewport, dockHeight) => {
      const preset = payload.sizePreset || get().sizePreset || 'md';
      const dims = resolveMiniPlayerDimensions(preset, viewport);
      const outerDims = getMiniPlayerOuterSize(dims);
      const { viewport: vp, safeBottom } = computeMiniPlayerViewportBounds(viewport, dockHeight);

      let initialPos = payload.position;
      if (!initialPos) {
        initialPos = resolveDefaultMiniPlayerPosition(dims, vp, safeBottom);
      } else {
        initialPos = clampMiniPlayerRect(initialPos, outerDims, vp, safeBottom);
      }

      const handoff: PlaybackHandoffSnapshot = {
        currentTime: payload.handoff?.currentTime ?? 0,
        isPlaying: payload.handoff?.isPlaying ?? true,
        isMuted: payload.handoff?.isMuted ?? false,
        volume: payload.handoff?.volume ?? 1,
        playbackRate: payload.handoff?.playbackRate ?? 1,
        selectedQuality: payload.handoff?.selectedQuality ?? 'auto',
        masterHlsUrl: payload.handoff?.masterHlsUrl,
        qualities: payload.handoff?.qualities,
      };

      const sessionKey = `${payload.source.id}_${Date.now()}`;
      const initialQueue =
        payload.queue && payload.queue.length > 0 ? payload.queue : [payload.source];

      set({
        activeSession: {
          source: payload.source,
          handoff,
          sessionKey,
          openedAt: Date.now(),
        },
        isStashedEdge: null,
        sizePreset: preset,
        position: initialPos,
        queue: initialQueue,
      });
    },

    updatePosition: (pos, viewport, dockHeight) => {
      const dims = resolveMiniPlayerDimensions(get().sizePreset, viewport);
      const outerDims = getMiniPlayerOuterSize(dims);
      const { viewport: vp, safeBottom } = computeMiniPlayerViewportBounds(viewport, dockHeight);
      const clamped = clampMiniPlayerRect(pos, outerDims, vp, safeBottom);
      const current = get().position;
      if (current.x === clamped.x && current.y === clamped.y) return;
      set({ position: clamped });
    },

    commitDragEnd: (viewport, dockHeight) => {
      const { position, sizePreset } = get();
      const { viewport: vp, safeBottom } = computeMiniPlayerViewportBounds(viewport, dockHeight);
      const dims = resolveMiniPlayerDimensions(sizePreset, vp);
      const outerDims = getMiniPlayerOuterSize(dims);

      const snap = resolveEdgeStashSnap(
        position.x,
        outerDims.width,
        vp.width,
        EDGE_STASH_THRESHOLD_PX
      );

      if (snap) {
        set({ isStashedEdge: snap });
      } else {
        const clamped = clampMiniPlayerRect(position, outerDims, vp, safeBottom);
        set({ isStashedEdge: null, position: clamped });
      }
    },

    stashToEdge: (side) => {
      set({ isStashedEdge: side });
    },

    restoreFromEdge: (viewport, dockHeight) => {
      const { isStashedEdge, position, sizePreset } = get();
      const { viewport: vp, safeBottom } = computeMiniPlayerViewportBounds(viewport, dockHeight);
      const dims = resolveMiniPlayerDimensions(sizePreset, vp);
      const outerDims = getMiniPlayerOuterSize(dims);

      let targetX = position.x;
      if (isStashedEdge === 'left') {
        targetX = 16;
      } else if (isStashedEdge === 'right') {
        targetX = Math.max(0, vp.width - outerDims.width - 16);
      }

      const clamped = clampMiniPlayerRect(
        { x: targetX, y: position.y },
        outerDims,
        vp,
        safeBottom
      );

      set({
        isStashedEdge: null,
        position: clamped,
      });
    },

    setSizePreset: (preset, viewport, dockHeight) => {
      const dims = resolveMiniPlayerDimensions(preset, viewport);
      const outerDims = getMiniPlayerOuterSize(dims);
      const { viewport: vp, safeBottom } = computeMiniPlayerViewportBounds(viewport, dockHeight);
      const clamped = clampMiniPlayerRect(get().position, outerDims, vp, safeBottom);

      set({
        sizePreset: preset,
        position: clamped,
      });
    },

    cycleSizePreset: (viewport, dockHeight) => {
      const current = get().sizePreset;
      const nextPreset: MiniPlayerSizePreset =
        current === 'sm' ? 'md' : current === 'md' ? 'lg' : 'sm';
      get().setSizePreset(nextPreset, viewport, dockHeight);
    },

    updateHandoff: (patch) => {
      const session = get().activeSession;
      if (!session) return;
      set({
        activeSession: {
          ...session,
          handoff: {
            ...session.handoff,
            ...patch,
          },
        },
      });
    },

    playNextInQueue: () => {
      const { activeSession, queue } = get();
      if (!activeSession || queue.length === 0) return;

      const currentIndex = queue.findIndex((item) => item.id === activeSession.source.id);
      if (currentIndex >= 0 && currentIndex < queue.length - 1) {
        const nextSource = queue[currentIndex + 1];
        set({
          activeSession: {
            source: nextSource,
            handoff: {
              currentTime: 0,
              isPlaying: true,
              isMuted: activeSession.handoff.isMuted,
              volume: activeSession.handoff.volume,
              playbackRate: activeSession.handoff.playbackRate,
            },
            sessionKey: `${nextSource.id}_${Date.now()}`,
            openedAt: Date.now(),
          },
          isStashedEdge: null,
        });
      }
    },

    playPreviousInQueue: (liveCurrentTime?: number) => {
      const { activeSession, queue } = get();
      if (!activeSession || queue.length === 0) return;

      const currentTime =
        typeof liveCurrentTime === 'number' && Number.isFinite(liveCurrentTime)
          ? liveCurrentTime
          : activeSession.handoff.currentTime;

      if (currentTime > 3) {
        get().updateHandoff({ currentTime: 0 });
        return;
      }

      const currentIndex = queue.findIndex((item) => item.id === activeSession.source.id);
      if (currentIndex > 0) {
        const prevSource = queue[currentIndex - 1];
        set({
          activeSession: {
            source: prevSource,
            handoff: {
              currentTime: 0,
              isPlaying: true,
              isMuted: activeSession.handoff.isMuted,
              volume: activeSession.handoff.volume,
              playbackRate: activeSession.handoff.playbackRate,
            },
            sessionKey: `${prevSource.id}_${Date.now()}`,
            openedAt: Date.now(),
          },
          isStashedEdge: null,
        });
      }
    },

    setAutoPipOnTabSwitch: (enabled) => {
      set({ autoPipOnTabSwitch: enabled });
    },

    expandToOrigin: (liveHandoff?: PlaybackHandoffSnapshot) => {
      const session = get().activeSession;
      if (!session) return;

      const source = session.source;
      const handoff = liveHandoff
        ? { ...session.handoff, ...liveHandoff }
        : session.handoff;

      // Retain pending expand handoff record for smooth destination adoption (Task 8 & 9)
      set({
        pendingExpandHandoff: {
          source,
          handoff,
          capturedAt: Date.now(),
        },
        activeSession: null,
        isStashedEdge: null,
      });

      // Invoke optional returnRoute onRestore callback if defined
      if (
        source.returnRoute &&
        typeof (source.returnRoute as { onRestore?: (h: PlaybackHandoffSnapshot) => void }).onRestore === 'function'
      ) {
        try {
          (source.returnRoute as { onRestore: (h: PlaybackHandoffSnapshot) => void }).onRestore(handoff);
        } catch {
          // Safe callback fallback
        }
      }

      // Navigate to return route if declared
      if (source.returnRoute?.view) {
        try {
          const rawView = String(source.returnRoute.view);
          const targetView = rawView === 'timeline' ? 'timeline-preview' : rawView;
          const albumId =
            typeof source.returnRoute.albumId === 'string'
              ? source.returnRoute.albumId
              : undefined;
          useAppStore.getState().navigateToView(targetView as any, albumId);
        } catch {
          // Safe navigation fallback
        }
      } else {
        // Fallback: open in full VideoPlayerModal with all handoff and library fields preserved
        try {
          const existingVideo = useAppStore
            .getState()
            .videos.find((v) => v.id === source.id);
          const modalItem = {
            ...(existingVideo || {}),
            id: source.id,
            title: source.title || existingVideo?.title || '',
            videoUrl:
              source.streamUrl ||
              (source.originalUrl as string) ||
              existingVideo?.streamUrl ||
              existingVideo?.url ||
              '',
            streamUrl: source.streamUrl || existingVideo?.streamUrl,
            sourceUrl: source.originalUrl || existingVideo?.sourceUrl,
            thumbnailUrl: source.thumbnailUrl || existingVideo?.thumbnailUrl,
            duration:
              existingVideo?.duration ??
              (typeof source.duration === 'number' ? source.duration : 0),
            durationSeconds:
              typeof source.duration === 'number'
                ? source.duration
                : existingVideo?.durationSeconds,
            currentTime: handoff.currentTime,
            isPlaying: handoff.isPlaying,
            isMuted: handoff.isMuted,
            playbackRate: handoff.playbackRate,
            quality:
              handoff.selectedQuality !== 'auto' && typeof handoff.selectedQuality === 'number'
                ? `${handoff.selectedQuality}p`
                : existingVideo?.resolution,
            qualities: handoff.qualities || existingVideo?.qualities,
            masterHlsUrl: handoff.masterHlsUrl || (existingVideo as any)?.masterHlsUrl,
          };
          useAppStore.getState().setActivePlayingVideo(modalItem as any);
        } catch {
          // Safe modal fallback
        }
      }
    },

    dismissMiniPlayer: () => {
      set({
        activeSession: null,
        isStashedEdge: null,
      });
    },
  };
});
