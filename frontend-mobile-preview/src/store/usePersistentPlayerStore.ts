import { create } from 'zustand';
import type {
  PlaybackHandoffSnapshot,
  StreamQualityCandidate,
  UniversalVideoSource,
} from '../components/video-player/engine/videoPlayerCore';
import type { UniversalVideoPlayerHandle } from '../components/video-player/ui/UniversalVideoPlayer';
import type { PlaybackErrorCode } from '../components/video-player/engine/useUniversalVideoEngine';
import type { AppSettings, Language } from '../types';

export interface PersistentModalSlot {
  element: HTMLElement | null;
  source: UniversalVideoSource;
  initialHandoff?: PlaybackHandoffSnapshot;
  autoPlayOnActive?: boolean;
  initialMuted?: boolean;
  isTheater?: boolean;
  onToggleTheater?: (next: boolean) => void;
  onPlaybackSnapshot?: (snapshot: PlaybackHandoffSnapshot) => void;
  onQualitiesFetched?: (data: {
    qualities: StreamQualityCandidate[];
    masterHlsUrl?: string;
  }) => void;
  onRenewStream?: () => Promise<any> | any;
  onMinimizeToMiniPlayer?: () => void;
  onClose?: () => void;
}

export interface PersistentWatchSlot {
  element: HTMLElement | null;
  source: UniversalVideoSource;
  initialHandoff?: PlaybackHandoffSnapshot | null;
  posterUrl?: string;
  aspectRatio?: string | number;
  autoPlayOnActive?: boolean;
  initialMuted?: boolean;
  initialQuality?: number | 'auto';
  suspended?: boolean;
  isActive?: boolean;
  ambientGlowEnabled?: boolean;
  isTheater?: boolean;
  onToggleTheater?: (next: boolean) => void;
  onMinimizeToMiniPlayer?: () => void;
}

export interface PersistentMiniSlot {
  element: HTMLElement | null;
  sourceId: string;
  suspended?: boolean;
  isActive?: boolean;
  language?: Language;
  motionSettings?: Partial<AppSettings>;
  onPlaybackStateChange?: (state: {
    isPlaying: boolean;
    isMuted: boolean;
    isBuffering: boolean;
    isVideoReady: boolean;
    currentTime: number;
    duration: number;
    playbackError: PlaybackErrorCode | null;
  }) => void;
  onPlaybackSnapshot?: (snapshot: PlaybackHandoffSnapshot) => void;
}

export interface PersistentPlayerRect {
  left: number;
  top: number;
  width: number;
  height: number;
  capturedAt: number;
}

export interface PersistentPlayerStoreState {
  hostMounted: boolean;
  pendingFlipRect: PersistentPlayerRect | null;
  activeSourceKey: string;
  playerHandle: UniversalVideoPlayerHandle | null;
  modalSlot: PersistentModalSlot | null;
  watchSlot: PersistentWatchSlot | null;
  miniSlot: PersistentMiniSlot | null;
  setHostMounted: (mounted: boolean) => void;
  setActiveSourceKey: (key: string) => void;
  setPlayerHandle: (handle: UniversalVideoPlayerHandle | null) => void;
  setModalSlot: (slot: PersistentModalSlot | null) => void;
  setWatchSlot: (slot: PersistentWatchSlot | null) => void;
  setMiniSlot: (slot: PersistentMiniSlot | null) => void;
  setPendingFlipRect: (rect: PersistentPlayerRect | null) => void;
  consumePendingFlipRect: () => PersistentPlayerRect | null;
}

export const usePersistentPlayerStore = create<PersistentPlayerStoreState>((set, get) => ({
  hostMounted: false,
  pendingFlipRect: null,
  activeSourceKey: '',
  playerHandle: null,
  modalSlot: null,
  watchSlot: null,
  miniSlot: null,
  setHostMounted: (hostMounted) => set({ hostMounted }),
  setActiveSourceKey: (activeSourceKey) => set({ activeSourceKey }),
  setPlayerHandle: (playerHandle) => set({ playerHandle }),
  setModalSlot: (modalSlot) => set({ modalSlot }),
  setWatchSlot: (watchSlot) => set({ watchSlot }),
  setMiniSlot: (miniSlot) => set({ miniSlot }),
  setPendingFlipRect: (pendingFlipRect) => set({ pendingFlipRect }),
  consumePendingFlipRect: () => {
    const rect = get().pendingFlipRect;
    if (!rect) return null;
    set({ pendingFlipRect: null });
    if (Date.now() - rect.capturedAt > 2000) return null;
    return rect;
  },
}));
