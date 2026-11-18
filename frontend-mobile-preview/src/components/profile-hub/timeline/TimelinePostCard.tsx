import React, { useState, useRef, useEffect, useCallback, useMemo, useId, useLayoutEffect } from 'react';
import Hls from 'hls.js';
import {
  Heart,
  MessageSquare,
  Bookmark,
  Save,
  Share2,
  MoreHorizontal,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Youtube,
  Settings,
  Check,
  Loader2,
  Globe,
  UserPlus,
  ListPlus,
  AlertCircle,
  X,
} from 'lucide-react';
import { useProfileHubLibraryStore } from '../../../store/useProfileHubLibraryStore';
import { canonicalLibraryMediaKey, normalizeTimelinePostToLibraryItem } from '../../../services/profileHubLibraryModel';
import {
  TimelinePost,
  TimelinePhotoItem,
  TimelineVideoQuality,
  createInitialAutoplayState,
  computeAutoplayTransition,
  classifyPlayError,
  pickFallbackStreamCandidate,
  buildTimelineStreamUrl,
  isHlsStreamUrl,
  isWatchPageOnlyUrl,
  normalizeTimelineQualities,
  resolveCreatorHandle,
  upgradePhotoUrlFast,
} from './timelineModel';
import { getInitialsAvatar } from './TimelineStoriesBar';
import { SourceAvatar } from '../common/SourceAvatar';
import { useProfileTimelineStore } from '../../../store/useProfileTimelineStore';
import { useAppStore } from '../../../store/useAppStore';
import { useProfileHubEngagementState } from '../../../hooks/useProfileHubEngagement';
import { timelineCommentsSourceUrl } from '../../../services/profileHubComments';
import { formatTimelineDate } from '../../../services/timelineDate';
import { readTimelineSavedVideo, saveTimelineVideo, timelineVideoIdentity } from '../../../services/timelineVideoSave';
import {
  UniversalVideoPlayer,
  type UniversalVideoPlayerHandle,
} from '../../video-player/ui/UniversalVideoPlayer';
import { MorphingPlayPauseIcon } from '../../video-player/ui/MorphingPlayPauseIcon';
import { usePersistentPlayerStore } from '../../../store/usePersistentPlayerStore';
import { type UniversalVideoSource } from '../../video-player/engine/videoPlayerCore';
import { normalizePlayerHighlights } from '../../video-player/engine/playerHighlights';
import { usePlayerHighlights } from '../../video-player/engine/usePlayerHighlights';
import { PlayerHighlightMarkers } from '../../video-player/ui/PlayerHighlights';
import { isReducedMotionPreferred, runViewTransitionSafe } from '../../video-player/engine/playerMotion';
import { getSpeedMs } from '../../../services/motionConfig';
import { type PlaybackDiagnostic, fromMediaError, fromHlsError, parsePlaybackDiagnostic, playbackDiagnosticMessage } from '../../video-player/engine/playbackDiagnostics';
import './timeline-save-feedback.css';

const useIsomorphicLayoutEffect =
  typeof document !== 'undefined' ? useLayoutEffect : useEffect;

// A stalled origin must expose recovery instead of leaving an endless spinner.
const PLAYBACK_STARTUP_TIMEOUT_MS = 20_000;
const SAVE_CONFIRM_ANIMATION_TIMEOUT_MS = 600;
type FreshTimelineStreams = { qualities: TimelineVideoQuality[]; masterHls?: string; diagnostic?: PlaybackDiagnostic | null };

export interface TimelinePlaybackHandoff {
  currentTime: number;
  isMuted: boolean;
  isPlaying: boolean;
  volume?: number;
  playbackRate?: number;
  selectedQuality?: number | 'auto';
  qualities?: TimelineVideoQuality[];
  masterHlsUrl?: string;
  sourceRect?: {x:number; y:number; width:number; height:number};
}
export function timelinePlaybackRect(element: Element | null): TimelinePlaybackHandoff['sourceRect'] {
  if (!element) return undefined;
  const {x,y,width,height} = element.getBoundingClientRect();
  return width > 0 && height > 0 ? {x,y,width,height} : undefined;
}

interface TimelinePostCardProps {
  post: TimelinePost;
  onOpenProfile: (creatorId: string) => void;
  onOpenComments: (postId: string) => void;
  onOpenLightbox: (
    images: string[],
    index: number,
    title: string,
    albumUrl?: string,
    items?: TimelinePhotoItem[],
    expectedPhotoCount?: number
  ) => void;
  isDesktop?: boolean;
  autoStartWithControls?: boolean;
  isNextInQueue?: boolean;
  onOpenVideo?: (post: TimelinePost, handoff: TimelinePlaybackHandoff) => void | boolean;
  watchPresentation?: boolean;
  playbackHandoff?: TimelinePlaybackHandoff;
  registerPlaybackSnapshot?: (snapshot: (() => TimelinePlaybackHandoff) | null) => void;
  suspended?: boolean;
  onMinimizeToMiniPlayer?: () => void;
  isTheater?: boolean;
  onToggleTheater?: (next: boolean) => void;
}

export const TimelinePostCard: React.FC<TimelinePostCardProps> = ({
  post,
  onOpenProfile,
  onOpenComments,
  onOpenLightbox,
  isDesktop = false,
  autoStartWithControls = false,
  isNextInQueue = false,
  onOpenVideo,
  watchPresentation = false,
  playbackHandoff,
  registerPlaybackSnapshot,
  suspended = false,
  onMinimizeToMiniPlayer,
  isTheater,
  onToggleTheater,
}) => {
  const isEn = useAppStore((state) => state.settings?.language === 'en-US');
  const disableMotion = useAppStore((state) => Boolean(state.settings?.disableAllAnimations));
  const animationSpeed = useAppStore((state) => state.settings?.animationSpeed);
  const addNotification = useAppStore((state) => state.addNotification);

  const {
    likedPostIds,
    favoritedPostIds,
    toggleLike,
    toggleFavorite,
    activeAutoplayPostId,
    setActiveAutoplayPostId,
    updatePostStream,
  } = useProfileTimelineStore();

  const libraryLiked = useProfileHubLibraryStore((state) => state.liked);
  const libraryFavorites = useProfileHubLibraryStore((state) => state.favorites);
  const openPlaylistModal = useProfileHubLibraryStore((state) => state.openPlaylistModal);
  const postLibKey = canonicalLibraryMediaKey(post);

  const isLiked = Boolean(
    likedPostIds[post.id] ||
    (postLibKey && libraryLiked.some((entry) => entry.key === postLibKey || entry.id === post.id))
  );
  const videoIdentityKey = timelineVideoIdentity(post.originalUrl);
  const galleryVideos = useAppStore((state) => state.videos);
  const [savedVideo, setSavedVideo] = useState<{id: string; folder: string} | null>(null);
  const [isSavingVideo, setIsSavingVideo] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{kind: 'saving' | 'saved' | 'already' | 'error'; folder?: string; code?: string} | null>(null);
  const [saveConfirmedMotion, setSaveConfirmedMotion] = useState(false);
  const [closingSaveFeedback, setClosingSaveFeedback] = useState(false);
  const feedbackKindRef = useRef(saveFeedback?.kind);
  feedbackKindRef.current = saveFeedback?.kind;
  const clearFeedbackRef = useRef<(() => void) | null>(null);
  const savedStatusVersion = useRef(0);
  const activeVideoIdentity = useRef(videoIdentityKey);
  activeVideoIdentity.current = videoIdentityKey;
  useEffect(() => {
    const version = ++savedStatusVersion.current;
    if (post.type === 'video' && post.originalUrl && videoIdentityKey) {
      void readTimelineSavedVideo(post.originalUrl).then(status => {
        if (status === undefined || savedStatusVersion.current !== version) return;
        setSavedVideo(status);
        if (status === null && (feedbackKindRef.current === 'saved' || feedbackKindRef.current === 'already')) clearFeedbackRef.current?.();
      });
    }
    return () => { if (savedStatusVersion.current === version) savedStatusVersion.current++; };
  }, [post.type, post.originalUrl, videoIdentityKey, galleryVideos]);
  const isFav = Boolean(
    favoritedPostIds[post.id] ||
    (postLibKey && libraryFavorites.some((entry) => entry.key === postLibKey || entry.id === post.id))
  );
  const articleRef = useRef<HTMLElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const saveFeedbackRef = useRef<HTMLDivElement | null>(null);
  const saveOutlineRef = useRef<HTMLSpanElement | null>(null);
  const feedbackLayout = useRef<{height: number; siblings: Array<{element: HTMLElement; top: number}>} | null>(null);
  const feedbackAnimations = useRef<Animation[]>([]);
  const closingAnimation = useRef<Animation | null>(null);
  const restoreSaveFocus = useRef(false);
  useEffect(() => {
    setSavedVideo(null);
    closingAnimation.current?.cancel();
    closingAnimation.current = null;
    setSaveFeedback(null);
    setSaveConfirmedMotion(false);
    setClosingSaveFeedback(false);
  }, [videoIdentityKey]);
  useEffect(() => {
    if (!saveConfirmedMotion) return;
    const timer = window.setTimeout(() => setSaveConfirmedMotion(false), SAVE_CONFIRM_ANIMATION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [saveConfirmedMotion]);
  const motionAllowed = () => !disableMotion && !isReducedMotionPreferred();
  const captureFeedbackLayout = () => {
    const article = articleRef.current;
    if (!article || !motionAllowed() || typeof article.animate !== 'function') { feedbackLayout.current = null; return; }
    const siblings: Array<{element: HTMLElement; top: number}> = [];
    for (let node = article.nextElementSibling; node; node = node.nextElementSibling) {
      if (!(node instanceof HTMLElement)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.top > window.innerHeight + 100) break;
      if (rect.bottom >= -100) siblings.push({element: node, top: rect.top});
    }
    feedbackLayout.current = {height: article.getBoundingClientRect().height, siblings};
  };
  const updateSaveFeedback = (value: typeof saveFeedback) => {
    closingAnimation.current?.cancel();
    closingAnimation.current = null;
    setClosingSaveFeedback(false);
    captureFeedbackLayout();
    setSaveFeedback(value);
  };
  useIsomorphicLayoutEffect(() => {
    const previous = feedbackLayout.current;
    feedbackLayout.current = null;
    const article = articleRef.current;
    if (!previous || !article || !motionAllowed()) return;
    const height = article.getBoundingClientRect().height;
    if (!height || Math.abs(height - previous.height) < 1) return;
    feedbackAnimations.current.forEach(animation => animation.cancel());
    const duration = getSpeedMs();
    const options: KeyframeAnimationOptions = {duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)'};
    const animations: Animation[] = [];
    for (const {element, top} of previous.siblings) {
      const offset = top - element.getBoundingClientRect().top;
      if (Math.abs(offset) >= 1 && typeof element.animate === 'function') {
        animations.push(element.animate([{transform: `translateY(${offset}px)`}, {transform: 'translateY(0)'}], options));
      }
    }
    const outline = saveOutlineRef.current;
    if (outline && typeof outline.animate === 'function') {
      article.dataset.saveLayoutMotion = 'true';
      const animation = outline.animate([{transform: `scaleY(${previous.height / height})`, opacity: 1}, {transform: 'scaleY(1)', opacity: 1}], options);
      animations.push(animation);
      void animation.finished.catch(() => {}).finally(() => {
        if (feedbackAnimations.current.includes(animation)) delete article.dataset.saveLayoutMotion;
      });
    }
    feedbackAnimations.current = animations;
    return () => {
      animations.forEach(animation => animation.cancel());
      delete article.dataset.saveLayoutMotion;
      feedbackAnimations.current = [];
    };
  }, [saveFeedback]);
  useEffect(() => {
    const stopMotion = () => {
      feedbackAnimations.current.forEach(animation => animation.cancel());
      feedbackAnimations.current = [];
      if (articleRef.current) delete articleRef.current.dataset.saveLayoutMotion;
      if (closingAnimation.current) {
        closingAnimation.current.cancel(); closingAnimation.current = null;
        if (restoreSaveFocus.current && (saveFeedbackRef.current?.contains(document.activeElement) || document.activeElement === document.body)) {
          saveButtonRef.current?.focus({preventScroll: true});
        }
        restoreSaveFocus.current = false;
        setSaveFeedback(null); setClosingSaveFeedback(false);
      }
      setSaveConfirmedMotion(false);
    };
    if (disableMotion) stopMotion();
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onChange = (event: MediaQueryListEvent) => { if (event.matches) stopMotion(); };
    query?.addEventListener?.('change', onChange);
    return () => query?.removeEventListener?.('change', onChange);
  }, [disableMotion]);
  useEffect(() => () => { closingAnimation.current?.cancel(); feedbackAnimations.current.forEach(animation => animation.cancel()); }, []);
  const closeSaveFeedback = () => {
    if (closingSaveFeedback) return;
    const panel = saveFeedbackRef.current;
    restoreSaveFocus.current = Boolean(panel?.contains(document.activeElement));
    const finish = () => {
      closingAnimation.current = null;
      if (restoreSaveFocus.current && (panel?.contains(document.activeElement) || document.activeElement === document.body)) saveButtonRef.current?.focus({preventScroll: true});
      restoreSaveFocus.current = false;
      captureFeedbackLayout();
      setSaveFeedback(null);
      setClosingSaveFeedback(false);
    };
    if (!panel || !motionAllowed() || typeof panel.animate !== 'function') { finish(); return; }
    setClosingSaveFeedback(true);
    const animation = panel.animate([{opacity: 1, transform: 'translateY(0)'}, {opacity: 0, transform: 'translateY(-4px)'}],
      {duration: getSpeedMs('fast'), easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards'});
    closingAnimation.current = animation;
    void animation.finished.then(() => { if (closingAnimation.current === animation) finish(); }).catch(() => {});
  };
  clearFeedbackRef.current = closeSaveFeedback;
  const engagementState = useProfileHubEngagementState(post.type === 'video' && !watchPresentation && !suspended ? timelineCommentsSourceUrl(post) : null, articleRef);
  const engagement = engagementState.data;
  const engagementLoading = engagementState.status === 'loading';
  const engagementMessage = engagementLoading
    ? (isEn ? 'Loading source counts…' : 'Carregando contagens da origem…')
    : engagementState.status === 'error'
      ? (isEn ? 'Could not update source counts.' : 'Não foi possível atualizar as contagens da origem.')
      : engagementState.status === 'unsupported'
        ? (isEn ? 'Source counts are not supported.' : 'Contagens indisponíveis nesta origem.')
        : '';
  const unknownCountLabel = isEn ? 'Count not provided by the source' : 'Contagem não informada pela origem';

  // Autoplay & Player State Machine (YouTube-style: always muted on autoplay, controls only on click)
  const [autoplayState, setAutoplayState] = useState(() => watchPresentation ? {
    ...createInitialAutoplayState(), isPlaying: playbackHandoff?.isPlaying ?? true,
    isMuted: playbackHandoff?.isMuted ?? true, hasUserClickedVideo: true, showControls: true,
  } : createInitialAutoplayState());
  const { isPlaying, isAutoplayPreview, hasUserClickedVideo, showControls, isMuted } = autoplayState;

  const [isVideoReady, setIsVideoReady] = useState(false);
  const [decodedHeight, setDecodedHeight] = useState<number | null>(null);
  const [decodedAspect, setDecodedAspect] = useState<{identity: string; ratio: number} | null>(null);
  const videoIdentity = JSON.stringify([post.id, post.originalUrl, post.videoUrl]);
  const rememberDecodedDimensions = (video: HTMLVideoElement) => {
    setDecodedHeight(video.videoHeight || null);
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const ratio = video.videoWidth / video.videoHeight;
      setDecodedAspect(previous => previous?.identity === videoIdentity && previous.ratio === ratio
        ? previous : {identity: videoIdentity, ratio});
    }
  };
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  const [progress, setProgress] = useState(0);

  // Qualities & Stream State
  const initialQualities = useMemo(
    () => normalizeTimelineQualities(playbackHandoff?.qualities || post.qualities, post.originalUrl),
    [playbackHandoff?.qualities, post.qualities, post.originalUrl]
  );
  const [qualities, setQualities] = useState<TimelineVideoQuality[]>(initialQualities);
  const [masterHlsUrl, setMasterHlsUrl] = useState<string | undefined>(playbackHandoff?.masterHlsUrl || post.masterHlsUrl);
  const [selectedQuality, setSelectedQuality] = useState<number | 'auto'>(playbackHandoff?.selectedQuality ?? 'auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [hasFetchedQualities, setHasFetchedQualities] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackDiagnostic, setPlaybackDiagnostic] = useState<PlaybackDiagnostic | null>(null);
  const [isCardHovered, setIsCardHovered] = useState(false);

  const optionsMenuId = useId();
  const qualityMenuId = useId();
  const optionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const qualityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const optionsMenuRef = useRef<HTMLDivElement | null>(null);
  const qualityMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showOptionsMenu && !showQualityMenu) return;
    const menuRef = showOptionsMenu ? optionsMenuRef : qualityMenuRef;
    const triggerRef = showOptionsMenu ? optionsTriggerRef : qualityTriggerRef;
    const closeMenu = () => {
      setShowOptionsMenu(false);
      setShowQualityMenu(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeMenu();
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showOptionsMenu, showQualityMenu]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const uvpRef = useRef<UniversalVideoPlayerHandle | null>(null);
  const hostMounted = usePersistentPlayerStore((s) => s.hostMounted);
  const [watchSlotEl, setWatchSlotEl] = useState<HTMLDivElement | null>(null);
  const mediaContainerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const loadedSrcRef = useRef<string>('');
  const loadedMasterHlsRef = useRef<string | undefined>();
  const appliedQualityRef = useRef<number | 'auto'>(playbackHandoff?.selectedQuality ?? 'auto');
  const pendingResumeTimeRef = useRef<number | null>(playbackHandoff?.currentTime ?? null);
  const isHoveredRef = useRef<boolean>(false);
  const mountedRef = useRef(true);
  const playbackGenerationRef = useRef(0);
  const playbackIntentRef = useRef({ isPlaying, isMuted });
  playbackIntentRef.current = { isPlaying: isPlaying && !suspended, isMuted };
  // The owner reads the real element before navigation; no DOM/icon inference.
  const snapshotPlaybackRef = useRef<() => TimelinePlaybackHandoff>(() => playbackHandoff || {currentTime:0,isMuted:true,isPlaying:false});
  snapshotPlaybackRef.current = () => {
    const video = videoRef.current;
    const attached = !!loadedSrcRef.current;
    return {currentTime:attached && video && video.readyState >= 1 ? video.currentTime : pendingResumeTimeRef.current ?? playbackHandoff?.currentTime ?? 0,
      isMuted:video?.muted ?? isMuted, isPlaying:attached && video ? !video.paused && !video.ended : isPlaying,
      volume: video?.volume ?? playbackHandoff?.volume,
      playbackRate: video?.playbackRate ?? playbackHandoff?.playbackRate,
      selectedQuality, qualities, masterHlsUrl};
  };
  useIsomorphicLayoutEffect(() => {
    registerPlaybackSnapshot?.(() => {
      const activeWatchHandle = uvpRef.current || (hostMounted ? usePersistentPlayerStore.getState().playerHandle : null);
      if (watchPresentation && post.type !== 'gif' && activeWatchHandle) {
        const snap = activeWatchHandle.capturePlaybackSnapshot();
        return {
          currentTime: snap.currentTime,
          isMuted: Boolean(snap.isMuted ?? isMuted),
          isPlaying: snap.isPlaying,
          volume: snap.volume,
          playbackRate: snap.playbackRate,
          selectedQuality: snap.selectedQuality,
          qualities: (snap.qualities as TimelineVideoQuality[] | undefined) || qualities,
          masterHlsUrl: snap.masterHlsUrl || masterHlsUrl,
        };
      }
      return snapshotPlaybackRef.current();
    });
    return () => registerPlaybackSnapshot?.(null);
  }, [registerPlaybackSnapshot, watchPresentation, post.type, hostMounted, qualities, masterHlsUrl]);
  const renewalAttemptedRef = useRef(false);
  const renewalInFlightRef = useRef(false);
  const qualitiesFetchedRef = useRef(false);
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const qualitiesRequestRef = useRef<{ controller: AbortController; promise: Promise<FreshTimelineStreams | null> } | null>(null);
  const pendingMetadataCleanupRef = useRef<(() => void) | null>(null);
  const renewalHandlerRef = useRef<(diagnostic?: PlaybackDiagnostic | null) => void>(() => {});
  const playbackDiagnosticRef = useRef<PlaybackDiagnostic | null>(null);

  useEffect(() => {
    failedUrlsRef.current.clear();
    playbackDiagnosticRef.current = null;
    setPlaybackDiagnostic(null);
    setPlaybackError(false);
  }, [post.id]);

  const pauseForAutoplayBlock = useCallback(() => {
    if (!mountedRef.current) return;
    playbackGenerationRef.current++;
    setIsBuffering(false);
    setAutoplayState(prev => ({
      ...prev,
      isPlaying: false,
      hasUserClickedVideo: true,
      showControls: true,
    }));
  }, []);

  const markPlaybackFailed = useCallback((diagnostic?: PlaybackDiagnostic | null) => {
    if (!mountedRef.current) return;
    setPlaybackDiagnostic(diagnostic || playbackDiagnosticRef.current || { stage: 'playback', code: 'unknown' });
    playbackGenerationRef.current++;
    qualitiesRequestRef.current?.controller.abort();
    qualitiesRequestRef.current = null;
    pendingMetadataCleanupRef.current?.();
    pendingMetadataCleanupRef.current = null;
    const video = videoRef.current;
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    hlsRef.current?.destroy();
    hlsRef.current = null;
    loadedSrcRef.current = '';
    loadedMasterHlsRef.current = undefined;
    setIsBuffering(false);
    setDecodedHeight(null);
    setPlaybackError(true);
    setAutoplayState(prev => ({ ...prev, isPlaying: false, hasUserClickedVideo: true, showControls: true }));
  }, []);

  useEffect(() => {
    setQualities(normalizeTimelineQualities(playbackHandoff?.qualities || post.qualities, post.originalUrl));
    setMasterHlsUrl(playbackHandoff?.masterHlsUrl || post.masterHlsUrl);
  }, [playbackHandoff, post.id, post.qualities, post.originalUrl, post.masterHlsUrl]);

  const canonicalReferer = useMemo(() => {
    if (post.originalUrl && post.originalUrl.startsWith('http')) return post.originalUrl;
    if (post.youtubeId) return `https://www.youtube.com/watch?v=${post.youtubeId}`;
    return undefined;
  }, [post.originalUrl, post.youtubeId]);

  const activeStreamUrl = useMemo(() => {
    if (selectedQuality !== 'auto') {
      const matched = qualities.find((q) => q.height === selectedQuality);
      if (matched && matched.streamUrl) {
        return matched.streamUrl;
      }
    }
    if (masterHlsUrl) {
      return masterHlsUrl;
    }
    if (qualities.length > 0) {
      // Pick 720p by default for fast startup, or highest available
      const pref = qualities.find((q) => q.height === 720) || qualities[0];
      if (pref?.streamUrl) return pref.streamUrl;
    }
    if (post.videoUrl && !isWatchPageOnlyUrl(post.videoUrl)) {
      return buildTimelineStreamUrl(post.videoUrl, canonicalReferer, undefined, post.youtubeId);
    }
    if (post.previewVideoUrl) {
      return buildTimelineStreamUrl(post.previewVideoUrl, canonicalReferer);
    }
    return buildTimelineStreamUrl(post.videoUrl, canonicalReferer, undefined, post.youtubeId);
  }, [
    selectedQuality,
    qualities,
    masterHlsUrl,
    post.videoUrl,
    post.previewVideoUrl,
    post.youtubeId,
    canonicalReferer,
  ]);

  const fetchFreshQualities = useCallback(
    (force = false): Promise<FreshTimelineStreams | null> => {
      if (qualitiesRequestRef.current) return qualitiesRequestRef.current.promise;
      if (qualitiesFetchedRef.current && !force) return Promise.resolve(null);
      const targetUrl = canonicalReferer || post.videoUrl;
      if (!targetUrl) return Promise.resolve(null);
      const controller = new AbortController();
      const promise = (async (): Promise<FreshTimelineStreams | null> => { try {
        const res = await fetch(
          `/api/video-stream-qualities?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(
            canonicalReferer || ''
          )}${force ? `&_t=${Date.now()}` : ''}`, { signal: controller.signal }
        );
        if (!res.ok) return { qualities: [], diagnostic: { stage: 'resolution', code: 'request_failed', httpStatus: res.status } };
        let data: any;
        try {
          data = await res.json();
        } catch {
          return controller.signal.aborted ? null : { qualities: [], diagnostic: { stage: 'resolution', code: 'unknown' } };
        }
        if (!mountedRef.current || controller.signal.aborted) return null;
        const norm = normalizeTimelineQualities(
          data?.qualities,
          data?.target_page || canonicalReferer
        );
        const mHls =
          typeof data?.master_hls_url === 'string' && data.master_hls_url
            ? data.master_hls_url
            : undefined;

        if (norm.length > 0 || mHls) {
          qualitiesFetchedRef.current = true;
          setHasFetchedQualities(true);
        }
        if (norm.length > 0) {
          setQualities(norm);
        }
        if (mHls) {
          setMasterHlsUrl(mHls);
        }
        if (!watchPresentation) updatePostStream(post.id, {
          qualities: norm.length > 0 ? norm : undefined,
          masterHlsUrl: mHls,
          videoUrl: norm[0]?.streamUrl || mHls || post.videoUrl,
        });
        return { qualities: norm, masterHls: mHls, diagnostic: parsePlaybackDiagnostic(data?.diagnostic) || (!norm.length && !mHls ? { stage: 'resolution', code: data?.error || data?.is_hls ? 'unknown' : 'no_formats' } : null) };
      } catch {
        return controller.signal.aborted ? null : { qualities: [], diagnostic: { stage: 'resolution', code: 'network_error' } };
      } finally {
        if (qualitiesRequestRef.current?.controller === controller) qualitiesRequestRef.current = null;
      } })();
      qualitiesRequestRef.current = { controller, promise };
      return promise;
    },
    [canonicalReferer, post.videoUrl, post.id, updatePostStream, watchPresentation]
  );

  const attachAndPlayStream = useCallback(
    async (streamToLoad: string, hlsMaster?: string, forceReload = false, restorePaused = false) => {
      const video = videoRef.current;
      if (!video || !mountedRef.current || (!playbackIntentRef.current.isPlaying && !restorePaused)) return;
      if (!streamToLoad) { markPlaybackFailed(); return; }
      const generation = ++playbackGenerationRef.current;
      const isCurrent = () => mountedRef.current && (playbackIntentRef.current.isPlaying || restorePaused) && playbackGenerationRef.current === generation;

      // Enforce muted state from state machine
      video.muted = playbackIntentRef.current.isMuted;

      // If YouTube or watch-page-only URL hasn't resolved real stream qualities yet, resolve first
      let effectiveStream = streamToLoad;
      let effectiveMasterHls = hlsMaster;

      if (
        (post.source === 'youtube' || isWatchPageOnlyUrl(post.videoUrl)) &&
        !effectiveMasterHls &&
        qualities.length === 0
      ) {
        setIsBuffering(true);
        const fresh = await fetchFreshQualities(true);
        if (!isCurrent()) return;
        if (fresh) {
          if (fresh.masterHls) {
            effectiveMasterHls = fresh.masterHls;
            effectiveStream = fresh.masterHls;
          } else if (fresh.qualities.length > 0) {
            const pref =
              fresh.qualities.find((q) => q.height === 720) || fresh.qualities[0];
            effectiveStream = pref.streamUrl;
          }
        }
        if (!fresh?.masterHls && !fresh?.qualities.length) { markPlaybackFailed(fresh?.diagnostic); return; }
      } else if (!restorePaused && !qualitiesFetchedRef.current) {
        // Background fetch of full quality options without blocking playback
        void fetchFreshQualities(false);
      }

      // If using Hls.js with a multi-level master manifest and only changing quality level
      if (
        !forceReload &&
        hlsRef.current &&
        effectiveMasterHls &&
        loadedSrcRef.current === effectiveMasterHls &&
        hlsRef.current.levels.length > 1
      ) {
        if (selectedQuality === 'auto') {
          hlsRef.current.currentLevel = -1;
        } else {
          const levelIdx = hlsRef.current.levels.findIndex(
            (lvl) => lvl.height === selectedQuality
          );
          if (levelIdx !== -1) {
            hlsRef.current.currentLevel = levelIdx;
          }
        }
        if (video.paused && !restorePaused) {
          hlsRef.current.startLoad();
          video.play().catch(() => {});
        }
        return;
      }

      if (!forceReload && loadedSrcRef.current === effectiveStream && video.src) {
        if (video.paused && !restorePaused) {
          hlsRef.current?.startLoad();
          video.play().catch(() => {});
        }
        return;
      }

      const resumeTime = pendingResumeTimeRef.current ?? video.currentTime;

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      setIsVideoReady(false);
      setDecodedHeight(null);
      setIsBuffering(true);
      const chosenStream =
        effectiveMasterHls && (selectedQuality === 'auto' || post.source === 'youtube')
          ? effectiveMasterHls
          : effectiveStream;
      const useHls = isHlsStreamUrl(chosenStream);
      const targetHlsSrc = chosenStream;
      loadedMasterHlsRef.current = useHls ? targetHlsSrc : undefined;

      const handlePlayRejection = (error: unknown, activeHls?: Hls) => {
        const action = classifyPlayError(error);
        if (action === 'ignore') return;
        if (activeHls ? hlsRef.current !== activeHls : !isCurrent()) return;
        if (action === 'autoplay_blocked') {
          pauseForAutoplayBlock();
          return;
        }
        renewalHandlerRef.current();
      };

      pendingMetadataCleanupRef.current?.();
      const restorePosition = () => {
        if (!isCurrent()) return;
        if (resumeTime === 0) pendingResumeTimeRef.current = null;
        if (resumeTime > 0 && video.duration && resumeTime < video.duration) {
          try {
            video.currentTime = resumeTime;
            pendingResumeTimeRef.current = null;
          } catch {
            // Metadata may still be incomplete; the metadata event retries the seek.
          }
        }
      };
      video.addEventListener('loadedmetadata', restorePosition, { once: true });
      pendingMetadataCleanupRef.current = () => video.removeEventListener('loadedmetadata', restorePosition);
      if (useHls && Hls.isSupported()) {
        loadedSrcRef.current = targetHlsSrc;
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          startLevel: -1,
        });
        hlsRef.current = hls;
        hls.loadSource(targetHlsSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!isCurrent() || hlsRef.current !== hls) return;
          if (selectedQuality !== 'auto' && hls.levels.length > 1) {
            const idx = hls.levels.findIndex((l) => l.height === selectedQuality);
            if (idx !== -1) hls.currentLevel = idx;
          }
          restorePosition();
          video.muted = playbackIntentRef.current.isMuted;
          if (!restorePaused) video.play().catch(error => handlePlayRejection(error, hls));
        });

        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal && hlsRef.current === hls) renewalHandlerRef.current(fromHlsError(data));
        });
      } else {
        // iOS Safari nativo (suporta HLS direto no <video src>) ou streams progressivos MP4/WebM
        const streamSource = chosenStream;
        loadedSrcRef.current = streamSource;
        video.src = streamSource;
        if (video.readyState >= 1) restorePosition();
        video.defaultMuted = true;
        video.muted = playbackIntentRef.current.isMuted;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        if (playbackIntentRef.current.isMuted) {
          video.setAttribute('muted', '');
        }

        // play() already waits for enough data; extra canplay handlers can revive paused media.
        if (!restorePaused) video.play().catch(error => handlePlayRejection(error));
      }
    },
    [
      masterHlsUrl,
      post.source,
      post.videoUrl,
      qualities.length,
      fetchFreshQualities,
      selectedQuality,
      markPlaybackFailed,
      pauseForAutoplayBlock,
    ]
  );

  // Callback state (quality loading/renewal) must not restart media attachment.
  const attachStreamRef = useRef(attachAndPlayStream);
  attachStreamRef.current = attachAndPlayStream;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
  }, [isMuted]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const qualityChanged = appliedQualityRef.current !== selectedQuality;
    // A paused watch entry still restores metadata and its decoded frame, without play().
    const restorePaused = watchPresentation && !!playbackHandoff && !isPlaying && (!loadedSrcRef.current || qualityChanged);
    if (!suspended && (isPlaying || restorePaused)) {
      appliedQualityRef.current = selectedQuality;
      const reuseTransport = Boolean(loadedSrcRef.current) && !qualityChanged;
      const switchWithinHls = selectedQuality !== 'auto' && hlsRef.current
        && loadedMasterHlsRef.current === masterHlsUrl
        && hlsRef.current.levels.some(level => level.height === selectedQuality);
      const requestedMaster = selectedQuality === 'auto' || isHlsStreamUrl(activeStreamUrl) || switchWithinHls
        ? masterHlsUrl : undefined;
      void attachStreamRef.current(
        reuseTransport ? loadedSrcRef.current : activeStreamUrl,
        reuseTransport ? loadedMasterHlsRef.current : requestedMaster, false, restorePaused
      );
    } else {
      playbackGenerationRef.current++;
      pendingMetadataCleanupRef.current?.();
      pendingMetadataCleanupRef.current = null;
      hlsRef.current?.stopLoad();
      if (!video.paused) {
        video.pause();
      }
      setIsBuffering(false);
    }
    // Discovery only updates available options. It must not replace the transport
    // already waiting for metadata/playing. Explicit quality changes still apply.
  }, [isPlaying, suspended, selectedQuality, post.id]);

  useEffect(() => {
    if (suspended || !isPlaying || isVideoReady || playbackError) return;
    const timer = window.setTimeout(() => markPlaybackFailed({ stage: 'playback', code: 'startup_timeout' }), PLAYBACK_STARTUP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [suspended, isPlaying, isVideoReady, playbackError, selectedQuality, markPlaybackFailed]);

  // Configurações essenciais para iOS Safari e Android inline playback
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.defaultMuted = isMuted;
      v.muted = isMuted;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      if (isMuted) v.setAttribute('muted', '');
    }
  }, []);

  // Only idle adjacent/hovered media preload. The playback effect owns active src.
  useEffect(() => {
    if (suspended || post.type === 'photo_grid' || post.type === 'album') return;
    const v = videoRef.current;
    if (!v || !activeStreamUrl) return;

    const isHls = isHlsStreamUrl(activeStreamUrl) && Hls.isSupported();
    if (isHls) return;

    const shouldPreload = !isPlaying && !playbackError && (isNextInQueue || isCardHovered) && !isWatchPageOnlyUrl(post.videoUrl);

    if (shouldPreload) {
      if (!v.getAttribute('src') && !hlsRef.current) {
        v.defaultMuted = true;
        v.muted = true;
        v.preload = 'metadata';
        v.src = activeStreamUrl;
        loadedSrcRef.current = activeStreamUrl;
        loadedMasterHlsRef.current = undefined;
      }
    }
  }, [suspended, post.type, post.videoUrl, activeStreamUrl, isPlaying, playbackError, isNextInQueue, isCardHovered, masterHlsUrl]);

  useEffect(() => {
    if (suspended) {
      const video = videoRef.current;
      if (video) {
        pendingResumeTimeRef.current = video.currentTime;
        video.pause(); video.preload = 'none'; video.removeAttribute('src'); video.load();
      }
      hlsRef.current?.destroy(); hlsRef.current = null;
      loadedSrcRef.current = ''; loadedMasterHlsRef.current = undefined;
      qualitiesRequestRef.current?.controller.abort();
      setAutoplayState(prev => computeAutoplayTransition(prev, 'viewport_leave'));
    }
  }, [suspended]);

  // Se este post for ativado como post ativo de autoplay no feed
  useEffect(() => {
    if (
      !suspended && !watchPresentation && activeAutoplayPostId === post.id &&
      post.type !== 'photo_grid' &&
      post.type !== 'album'
    ) {
      // React to activation identity, not this card's own pause. Otherwise
      // hover/viewport leave immediately reactivates the same preview.
      setAutoplayState((prev) => prev.isPlaying || prev.hasUserClickedVideo
        ? prev : computeAutoplayTransition(prev, 'viewport_enter'));
    }
  }, [suspended, watchPresentation, activeAutoplayPostId, post.id, post.type]);

  // Pause autoplay preview if another post becomes the active autoplay post
  useEffect(() => {
    if (
      activeAutoplayPostId &&
      activeAutoplayPostId !== post.id &&
      isPlaying &&
      !hasUserClickedVideo
    ) {
      setAutoplayState((prev) => computeAutoplayTransition(prev, 'pause_external'));
    }
  }, [activeAutoplayPostId, post.id, isPlaying, hasUserClickedVideo]);

  // Support autoStartWithControls when opened from creator Videos tab
  useEffect(() => {
    if (!suspended && !watchPresentation && autoStartWithControls && post.type !== 'photo_grid' && post.type !== 'album') {
      setActiveAutoplayPostId(post.id);
      setAutoplayState((prev) => ({
        ...computeAutoplayTransition(prev, 'video_click'),
        isMuted: false,
      }));
    }
  }, [suspended, watchPresentation, autoStartWithControls, post.id, post.type, setActiveAutoplayPostId]);

  // Mobile / Viewport Scroll Autoplay via IntersectionObserver
  useEffect(() => {
    if (suspended || watchPresentation || post.type === 'photo_grid' || post.type === 'album') return;
    const el = mediaContainerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        // Dispara autoplay no celular quando ~35% do container do vídeo já está visível
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          const isTouchOrMobile =
            !isDesktop ||
            (typeof window !== 'undefined' &&
              (window.matchMedia?.('(hover: none), (pointer: coarse)').matches ||
                window.innerWidth < 768));
          if (isTouchOrMobile) {
            setActiveAutoplayPostId(post.id);
            setAutoplayState((prev) => computeAutoplayTransition(prev, 'viewport_enter'));
          }
        } else if (!entry.isIntersecting || entry.intersectionRatio < 0.15) {
          setAutoplayState((prev) => {
            if (!prev.isPlaying && !prev.showControls) return prev;
            return computeAutoplayTransition(prev, 'viewport_leave');
          });
        }
      },
      { threshold: [0, 0.15, 0.35, 0.6, 0.85] }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [suspended, watchPresentation, post.id, post.type, isDesktop, setActiveAutoplayPostId]);

  // Destrava reprodução no primeiro toque/rolagem do usuário se o navegador mobile tiver bloqueado
  useEffect(() => {
    const unlockOnTouch = () => {
      const v = videoRef.current;
      if (!suspended && v && v.paused && isPlaying) {
        v.play().catch(() => {});
      }
    };
    window.addEventListener('touchstart', unlockOnTouch, { once: true, passive: true });
    return () => window.removeEventListener('touchstart', unlockOnTouch);
  }, [isPlaying, suspended]);

  // Cleanup Hls.js on unmount
  useEffect(() => {
    mountedRef.current = true;
    const video = videoRef.current;
    return () => {
      mountedRef.current = false;
      playbackGenerationRef.current++;
      qualitiesRequestRef.current?.controller.abort();
      pendingMetadataCleanupRef.current?.();
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);

  // Desktop Hover Autoplay Handlers
  const handleMouseEnterVideo = () => {
    if (suspended || watchPresentation) return;
    isHoveredRef.current = true;
    setActiveAutoplayPostId(post.id);
    setAutoplayState((prev) => computeAutoplayTransition(prev, 'hover_enter'));
  };

  const handleMouseLeaveVideo = () => {
    if (suspended || watchPresentation) return;
    isHoveredRef.current = false;
    setShowQualityMenu(false);
    setAutoplayState((prev) => computeAutoplayTransition(prev, 'hover_leave'));
  };

  // User Click on Video -> Shows Controls & Plays (remains muted until user toggles mute)
  const handleVideoClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (suspended) return;
    if (onOpenVideo && post.type === 'video' && !watchPresentation) {
      const video = videoRef.current;
      const handoff: TimelinePlaybackHandoff = {currentTime: video?.currentTime || 0, isMuted: video?.muted ?? isMuted, isPlaying: true, ...(typeof video?.volume === 'number' ? {volume:video.volume} : {}), ...(typeof video?.playbackRate === 'number' ? {playbackRate:video.playbackRate} : {}), selectedQuality, qualities, masterHlsUrl, sourceRect:timelinePlaybackRect(mediaContainerRef.current)};
      mediaContainerRef.current?.focus({preventScroll:true});
      let opened = true;
      void runViewTransitionSafe(
        () => {
          if (onOpenVideo(post, handoff) === false) {
            opened = false;
          }
        },
        {
          element: mediaContainerRef.current,
          transitionName: 'timeline-video-morph',
          focusTarget: mediaContainerRef.current,
          disableAllAnimations: disableMotion,
        }
      );
      if (!opened) return;
      playbackIntentRef.current.isPlaying = false;
      video?.pause();
      hlsRef.current?.stopLoad();
      qualitiesRequestRef.current?.controller.abort();
      playbackGenerationRef.current++;
      setAutoplayState(prev => computeAutoplayTransition(prev, 'pause_external'));
      return;
    }
    setShowQualityMenu(false);
    setActiveAutoplayPostId(post.id);
    setAutoplayState((prev) => computeAutoplayTransition(prev, 'video_click'));
  };

  const handleTogglePlayPauseButton = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowQualityMenu(false);
    setActiveAutoplayPostId(post.id);
    setAutoplayState((prev) => {
      if (!prev.hasUserClickedVideo || !prev.showControls) {
        return computeAutoplayTransition(prev, 'video_click');
      }
      return {
        ...prev,
        isPlaying: !prev.isPlaying,
      };
    });
  };

  const handleToggleMuteButton = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAutoplayState((prev) => computeAutoplayTransition(prev, 'toggle_mute'));
  };

  const handleSelectQuality = (e: React.MouseEvent, heightOrAuto: number | 'auto') => {
    e.stopPropagation();
    if (videoRef.current) {
      pendingResumeTimeRef.current = loadedSrcRef.current ? videoRef.current.currentTime : pendingResumeTimeRef.current ?? playbackHandoff?.currentTime ?? 0;
    }
    setSelectedQuality(heightOrAuto);
    setShowQualityMenu(false);

    if (
      hlsRef.current &&
      masterHlsUrl &&
      loadedSrcRef.current === masterHlsUrl &&
      hlsRef.current.levels.length > 1
    ) {
      if (heightOrAuto === 'auto') {
        hlsRef.current.currentLevel = -1;
      } else {
        const idx = hlsRef.current.levels.findIndex((l) => l.height === heightOrAuto);
        if (idx !== -1) hlsRef.current.currentLevel = idx;
      }
    }
  };

  const formatSeconds = (sec: number) => {
    if (isNaN(sec) || sec <= 0) return '0:00';
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    const dur = videoRef.current.duration || 0;
    if (cur > 0.05 && !isVideoReady) {
      setIsVideoReady(true);
      setIsBuffering(false);
    }
    setCurrentTime(formatSeconds(cur));
    if (dur > 0 && Number.isFinite(dur)) {
      setDuration(formatSeconds(dur));
      setProgress((cur / dur) * 100);
    }
  };

  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const val = parseFloat(e.target.value);
    setProgress(val);
    if (videoRef.current && videoRef.current.duration && Number.isFinite(videoRef.current.duration)) {
      videoRef.current.currentTime = (val / 100) * videoRef.current.duration;
    }
  };

  const [isFullscreen, setIsFullscreen] = useState(false);
  const orientationLockOwnedRef = useRef(false);
  const unlockOrientation = useCallback(() => {
    if (!orientationLockOwnedRef.current) return;
    try { screen.orientation?.unlock?.(); } catch { /* Unsupported browser. */ }
    orientationLockOwnedRef.current = false;
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    const changed = () => {
      const nativeFullscreen = Boolean((video as HTMLVideoElement & {webkitDisplayingFullscreen?:boolean} | null)?.webkitDisplayingFullscreen);
      const active = document.fullscreenElement === mediaContainerRef.current || nativeFullscreen;
      setIsFullscreen(active);
      if (!active) unlockOrientation();
    };
    document.addEventListener('fullscreenchange', changed);
    video?.addEventListener('webkitbeginfullscreen', changed);
    video?.addEventListener('webkitendfullscreen', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      video?.removeEventListener('webkitbeginfullscreen', changed);
      video?.removeEventListener('webkitendfullscreen', changed);
      unlockOrientation();
    };
  }, [unlockOrientation]);
  const handleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current as HTMLVideoElement & {webkitEnterFullscreen?:()=>void; webkitExitFullscreen?:()=>void; webkitDisplayingFullscreen?:boolean} | null;
    if (!video) return;
    try {
      if (document.fullscreenElement === mediaContainerRef.current) { await document.exitFullscreen(); unlockOrientation(); return; }
      if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) { video.webkitExitFullscreen(); unlockOrientation(); return; }
      if (mediaContainerRef.current?.requestFullscreen) await mediaContainerRef.current.requestFullscreen();
      else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; }
      else throw new Error('Fullscreen unavailable');
    } catch {
      addNotification({type:'info', title:isEn ? 'Fullscreen unavailable' : 'Tela cheia indisponível', message:isEn ? 'Your browser did not allow fullscreen. You can continue watching here.' : 'O navegador não permitiu tela cheia. Você pode continuar assistindo aqui.'});
      return;
    }
    const orientation = screen.orientation as ScreenOrientation & {lock?: (value:string)=>Promise<void>};
    try {
      if (!orientation?.lock) throw new Error('Orientation lock unavailable');
      await orientation.lock('landscape');
      orientationLockOwnedRef.current = true;
      if (!mountedRef.current || document.fullscreenElement !== mediaContainerRef.current) unlockOrientation();
    } catch {
      if (window.innerHeight > window.innerWidth) addNotification({type:'info', title:isEn ? 'Rotate your device' : 'Gire seu dispositivo', message:isEn ? 'Fullscreen is open. Rotate your device for landscape viewing.' : 'A tela cheia está aberta. Gire seu dispositivo para assistir na horizontal.'});
    }
  };

  const handleVideoError = (diagnostic?: PlaybackDiagnostic | null) => {
    if (!mountedRef.current || !playbackIntentRef.current.isPlaying) return;
    if (renewalInFlightRef.current) return;
    if (diagnostic) playbackDiagnosticRef.current = diagnostic;
    const failedSrc = loadedSrcRef.current;
    if (failedSrc) failedUrlsRef.current.add(failedSrc);

    const localFallback =
      failedUrlsRef.current.size <= 4
        ? pickFallbackStreamCandidate({
            activeStreamUrl: failedSrc,
            qualities,
            masterHlsUrl,
            selectedQuality,
            failedUrls: failedUrlsRef.current,
          })
        : null;
    if (localFallback) {
      void attachStreamRef.current(localFallback.streamUrl, localFallback.masterHls, true);
      return;
    }

    if (!renewalAttemptedRef.current && canonicalReferer) {
      renewalAttemptedRef.current = true;
      renewalInFlightRef.current = true;
      const generation = playbackGenerationRef.current;
      void fetchFreshQualities(true).then((fresh) => {
        if (!mountedRef.current || !playbackIntentRef.current.isPlaying || generation !== playbackGenerationRef.current) return;
        const freshQualities = fresh?.qualities || [];
        const freshMaster = fresh?.masterHls;
        const freshCandidate =
          (freshMaster && !failedUrlsRef.current.has(freshMaster)
            ? { streamUrl: freshMaster, masterHls: freshMaster }
            : null) ||
          pickFallbackStreamCandidate({
            activeStreamUrl: '',
            qualities: freshQualities,
            masterHlsUrl: freshMaster,
            selectedQuality,
            failedUrls: failedUrlsRef.current,
          });
        if (freshCandidate) {
          void attachStreamRef.current(freshCandidate.streamUrl, freshCandidate.masterHls, true);
        } else {
          const resolutionDiagnostic = fresh?.diagnostic;
          markPlaybackFailed(resolutionDiagnostic?.code === 'unknown'
            ? playbackDiagnosticRef.current || resolutionDiagnostic
            : resolutionDiagnostic || playbackDiagnosticRef.current);
        }
      }).finally(() => { renewalInFlightRef.current = false; });
    } else {
      markPlaybackFailed();
    }
  };
  renewalHandlerRef.current = handleVideoError;

  const handleRetryPlayback = (event: React.MouseEvent) => {
    event.stopPropagation();
    failedUrlsRef.current.clear();
    renewalAttemptedRef.current = false;
    qualitiesFetchedRef.current = false;
    playbackDiagnosticRef.current = null;
    setPlaybackDiagnostic(null);
    setPlaybackError(false);
    setIsVideoReady(false);
    setIsBuffering(true);
    setAutoplayState(prev => ({ ...prev, isPlaying: true, hasUserClickedVideo: true, showControls: true }));
  };

  const handleShare = () => {
    const shareUrl = post.originalUrl || window.location.href;
    const showManualCopy = () => addNotification({
      type: 'info',
      title: isEn ? 'Copy link manually' : 'Copie o link manualmente',
      message: isEn ? `Automatic copying is unavailable. Copy this link: ${shareUrl}` : `A cópia automática está indisponível. Copie este link: ${shareUrl}`,
    });
    if (typeof navigator.clipboard?.writeText === 'function') {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          addNotification({
            type: 'info',
            title: isEn ? 'Link copied' : 'Link copiado',
            message: isEn
              ? 'Post link copied to clipboard'
              : 'Link do post copiado para a área de transferência',
          });
        })
        .catch(showManualCopy);
    } else showManualCopy();
  };

  const creatorProfileUrl = useProfileTimelineStore(
    (state) => state.creatorProfiles[post.creatorId]?.profileUrl || state.creators.find((c) => c.id === post.creatorId)?.profileUrl || null
  );
  const handleSaveVideo = async () => {
    if (isSavingVideo) return;
    if (savedVideo) {
      updateSaveFeedback({kind: 'already', folder: savedVideo.folder});
      addNotification({ type: 'info', title: isEn ? 'Already in video gallery' : 'Já está na galeria de vídeos',
        message: isEn ? `Folder: ${savedVideo.folder}.` : `Pasta: ${savedVideo.folder}.` });
      return;
    }
    if (!creatorProfileUrl || !post.originalUrl || !videoIdentityKey) {
      updateSaveFeedback({kind: 'error', code: 'missing_source'});
      addNotification({ type: 'error', title: isEn ? 'Could not save video' : 'Não foi possível salvar o vídeo',
        message: isEn ? 'The original video or profile address is unavailable.' : 'O endereço original do vídeo ou do perfil não está disponível.' });
      return;
    }
    savedStatusVersion.current++;
    setIsSavingVideo(true);
    updateSaveFeedback({kind: 'saving'});
    try {
      const result = await saveTimelineVideo({ profile_url: creatorProfileUrl, profile_name: post.creatorName,
        video_url: post.originalUrl, video_id: post.id, title: post.title, ...(timelineVideoIdentity(post.thumbnail) ? { thumbnail_url: post.thumbnail } : {}) });
      if (activeVideoIdentity.current === videoIdentityKey) {
        setSavedVideo({ id: result.id, folder: result.folder });
        updateSaveFeedback({kind: result.already_saved ? 'already' : 'saved', folder: result.folder});
        if (!result.already_saved && motionAllowed()) setSaveConfirmedMotion(true);
      }
      void useAppStore.getState().syncVideos();
      addNotification({ type: 'success', title: result.already_saved ? (isEn ? 'Already in video gallery' : 'Já está na galeria de vídeos') : (isEn ? 'Saved to video gallery' : 'Salvo na galeria de vídeos'),
        message: isEn ? `Folder: ${result.folder}. Available as a web stream.` : `Pasta: ${result.folder}. Disponível como Web Stream.` });
    } catch (error) {
      const unsupported = error instanceof Error && ['unsupported_execution_source', 'unsupported_media_route'].includes(error.message);
      const unresolved = error instanceof Error && error.message === 'video_stream_unresolved';
      if (activeVideoIdentity.current === videoIdentityKey) updateSaveFeedback({kind: 'error', code: unsupported ? 'unsupported' : unresolved ? 'unresolved' : 'unknown'});
      addNotification({ type: 'error', title: isEn ? 'Could not save video' : 'Não foi possível salvar o vídeo',
        message: unsupported ? (isEn ? 'Saving from this source is not supported yet.' : 'Ainda não é possível salvar desta fonte.')
          : unresolved ? (isEn ? 'A video stream with audio could not be resolved.' : 'Não foi possível obter uma transmissão de vídeo com áudio.')
          : (isEn ? 'Check the connection and try again. The video may not have been saved.' : 'Verifique a conexão e tente novamente. O vídeo pode não ter sido salvo.') });
    } finally { setIsSavingVideo(false); }
  };
  const initialFallback = getInitialsAvatar(post.creatorName);
  const hasValidAvatar = Boolean(
    post.creatorAvatar &&
      !post.creatorAvatar.startsWith('data:image/gif') &&
      post.creatorAvatar.length > 20
  );

  const currentQualityLabel = useMemo(() => {
    if (selectedQuality === 'auto') {
      return decodedHeight ? `${decodedHeight}p` : '—';
    }
    const found = qualities.find((q) => q.height === selectedQuality);
    return found?.label || `${selectedQuality}p`;
  }, [selectedQuality, decodedHeight, qualities]);

  const maxQualityLabel = useMemo(() => {
    if (qualities.length > 0) {
      const highest = [...qualities].sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      if (highest?.label) return highest.label;
      if (highest?.height) return `${highest.height}p HD`;
    }
    if (post.resolution) return post.resolution;
    return '—';
  }, [qualities, post.resolution]);

  const totalAlbumPhotos = Math.max(
    post.photoCount || 0,
    Array.isArray(post.photos) ? post.photos.length : 0
  );
  // Grids use the source thumbnail; only the lightbox receives original URLs.
  const albumGridUrls = [0, 1].map(index => post.photoItems?.[index]?.thumbnailUrl || post.photos?.[index] || '');

  const embeddedHighlights = useMemo(() => normalizePlayerHighlights(post), [post]);
  const universalVideoSource = useMemo<UniversalVideoSource>(() => ({
    id: post.id,
    sourceType: 'timeline',
    highlights: embeddedHighlights,
    title: post.title,
    creatorName: post.creatorName,
    streamUrl: activeStreamUrl,
    originalUrl: post.originalUrl || post.videoUrl,
    referer: canonicalReferer,
    posterUrl: post.thumbnail || post.creatorAvatar,
    thumbnailUrl: post.thumbnail || post.creatorAvatar,
    masterHlsUrl,
    qualities,
    source: post.source,
    youtubeId: post.youtubeId,
    isWatchPageOnly: isWatchPageOnlyUrl(post.videoUrl),
  }), [
    embeddedHighlights,
    post.id,
    post.title,
    post.creatorName,
    activeStreamUrl,
    post.originalUrl,
    post.videoUrl,
    canonicalReferer,
    post.thumbnail,
    post.creatorAvatar,
    masterHlsUrl,
    qualities,
    post.source,
    post.youtubeId,
  ]);
  const highlights = usePlayerHighlights(universalVideoSource, {
    enabled: !watchPresentation && post.type !== 'gif' && showControls && isVideoReady && !isBuffering && !suspended,
    duration: videoRef.current?.duration || 0,
  });

  const watchAspectRatio = decodedAspect?.identity === videoIdentity ? decodedAspect.ratio : '16/9';
  useEffect(() => {
    if (!hostMounted || !watchPresentation || post.type === 'gif' || !watchSlotEl) {
      return;
    }
    usePersistentPlayerStore.getState().setWatchSlot({
      element: watchSlotEl,
      source: universalVideoSource,
      initialHandoff: playbackHandoff
        ? {
            currentTime: playbackHandoff.currentTime,
            isMuted: playbackHandoff.isMuted,
            isPlaying: playbackHandoff.isPlaying,
            volume: playbackHandoff.volume,
            playbackRate: playbackHandoff.playbackRate,
            selectedQuality: playbackHandoff.selectedQuality ?? 'auto',
            masterHlsUrl: playbackHandoff.masterHlsUrl,
            qualities: playbackHandoff.qualities,
            sourceRect: playbackHandoff.sourceRect,
          }
        : null,
      posterUrl: post.thumbnail,
      aspectRatio: watchAspectRatio,
      autoPlayOnActive: playbackHandoff?.isPlaying ?? true,
      initialMuted: playbackHandoff?.isMuted ?? true,
      initialQuality: playbackHandoff?.selectedQuality ?? 'auto',
      suspended,
      isActive: !suspended,
      ambientGlowEnabled: true,
      isTheater,
      onToggleTheater,
      onMinimizeToMiniPlayer,
    });
    return () => {
      usePersistentPlayerStore.getState().setWatchSlot(null);
    };
  }, [
    hostMounted,
    watchPresentation,
    post.type,
    post.thumbnail,
    watchSlotEl,
    universalVideoSource,
    playbackHandoff,
    watchAspectRatio,
    suspended,
    isTheater,
    onToggleTheater,
    onMinimizeToMiniPlayer,
  ]);

  return (
    <article
      ref={articleRef}
      data-timeline-post-id={post.id}
      data-media-type={post.type}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
      className={watchPresentation ? "relative w-full max-w-full min-w-0 bg-black sm:rounded-2xl overflow-hidden" : "relative w-full max-w-full min-w-0 bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-border-strong)] rounded-2xl p-3.5 shadow-xl space-y-2.5 smooth-transition"}
    >
      {/* Topo do Card */}
      {!watchPresentation && <div className="flex items-center justify-between gap-2 min-w-0">
        <div
          data-post-creator-id={post.creatorId}
          role="button"
          tabIndex={0}
          aria-label={isEn ? `View ${post.creatorName}'s profile` : `Ver perfil de ${post.creatorName}`}
          onClick={() => onOpenProfile(post.creatorId)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenProfile(post.creatorId); }
          }}
          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group/author"
        >
          <SourceAvatar
            name={post.creatorName}
            src={hasValidAvatar ? post.creatorAvatar : null}
            profileUrl={creatorProfileUrl}
            referer={creatorProfileUrl || post.originalUrl}
            hydrate={!hasValidAvatar && Boolean(creatorProfileUrl)}
            alt={post.creatorName}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full object-cover border border-[var(--tl-border-strong)] group-hover/author:border-[var(--tl-accent-hover)] group-hover/author:scale-105 smooth-transition bg-[var(--tl-surface-elevated)] shrink-0 shadow-md"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="text-[15px] sm:text-base font-bold text-[var(--tl-text-primary)] group-hover/author:text-[var(--tl-accent-text)] smooth-transition truncate leading-tight">
                {post.creatorName}
              </h3>
              {post.creatorVerified === true && <span className="w-4 h-4 rounded-full bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] flex items-center justify-center text-[10px] font-bold shrink-0" aria-label={isEn ? 'Verified creator' : 'Criador verificado'}>✓</span>}
            </div>
            <div className="flex items-center gap-1.5 min-w-0 text-xs text-[var(--tl-text-muted)] leading-tight mt-0.5">
              {(() => {
                const cleanHandle = resolveCreatorHandle({
                  handle: post.creatorHandle,
                  name: post.creatorName,
                });
                return cleanHandle ? (
                  <>
                    <span className="truncate">{cleanHandle}</span>
                    <span className="opacity-70 shrink-0">•</span>
                  </>
                ) : null;
              })()}
              <span className="shrink-0">{formatTimelineDate(post, isEn ? 'en-US' : 'pt-BR')}</span>
            </div>
          </div>
        </div>

        <div className="relative shrink-0">
          <button
            ref={optionsTriggerRef}
            type="button"
            aria-expanded={showOptionsMenu}
            aria-controls={showOptionsMenu ? optionsMenuId : undefined}
            onClick={() => {
              setShowQualityMenu(false);
              setShowOptionsMenu((prev) => !prev);
            }}
            className="p-2 text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] rounded-lg smooth-transition -mr-1"
            title={isEn ? 'Options' : 'Opções'}
            aria-label={isEn ? 'Options' : 'Opções'}
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
          {showOptionsMenu && (
            <div ref={optionsMenuRef} id={optionsMenuId} className="absolute right-0 top-full mt-1 w-52 bg-[var(--tl-surface-elevated)] border border-[var(--tl-border-strong)] rounded-xl shadow-2xl p-1 z-30 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150">
              <button
                type="button"
                onClick={() => {
                  setShowOptionsMenu(false);
                  handleShare();
                }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-[var(--tl-accent-text)]" />
                <span>{isEn ? 'Copy post link' : 'Copiar link do post'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowOptionsMenu(false);
                  onOpenProfile(post.creatorId);
                }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 text-[var(--tl-accent-text)]" />
                <span>{isEn ? 'View creator profile' : 'Ver perfil do criador'}</span>
              </button>
              {post.originalUrl && (
                <a
                  href={post.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowOptionsMenu(false)}
                  className="w-full text-left px-3 py-2 text-xs text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{isEn ? 'Open original source' : 'Abrir no site original'}</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      }
      {/* Mídia do Post */}
      {(post.type === 'photo_grid' || post.type === 'album') ? (
        Array.isArray(post.photos) && post.photos.length > 0 ? (
        <div className={`grid ${post.photos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5 rounded-2xl overflow-hidden mt-2.5`}>
          <button
            type="button"
            aria-label={isEn ? 'Open album photo 1' : 'Abrir foto 1 do álbum'}
            className="relative cursor-pointer group overflow-hidden"
            onClick={() =>
              onOpenLightbox(
                post.photos || [],
                0,
                post.title,
                post.albumUrl || post.originalUrl,
                post.photoItems,
                post.photoCount
              )
            }
          >
            <img
              src={albumGridUrls[0]}
              loading="lazy"
              alt={isEn ? 'Photo 1' : 'Foto 1'}
              referrerPolicy="no-referrer"
              className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
              onError={(e) => {
                const imgEl = e.currentTarget as HTMLImageElement;
                const rawUrl = albumGridUrls[0];
                if (!imgEl.dataset.proxied && rawUrl.startsWith('http')) {
                  imgEl.dataset.proxied = '1';
                  imgEl.src = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(
                    post.albumUrl || post.originalUrl || rawUrl
                  )}`;
                } else {
                  imgEl.style.visibility = 'hidden';
                }
              }}
            />
          </button>
          {post.photos.length > 1 && <button
            type="button"
            aria-label={isEn ? 'Open album photo 2' : 'Abrir foto 2 do álbum'}
            className="relative cursor-pointer group overflow-hidden"
            onClick={() =>
              onOpenLightbox(
                post.photos || [],
                1,
                post.title,
                post.albumUrl || post.originalUrl,
                post.photoItems,
                post.photoCount
              )
            }
          >
            <img
              src={albumGridUrls[1]}
              loading="lazy"
              alt={isEn ? 'Photo 2' : 'Foto 2'}
              referrerPolicy="no-referrer"
              className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
              onError={(e) => {
                const imgEl = e.currentTarget as HTMLImageElement;
                const rawUrl = albumGridUrls[1];
                if (!imgEl.dataset.proxied && rawUrl.startsWith('http')) {
                  imgEl.dataset.proxied = '1';
                  imgEl.src = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(
                    post.albumUrl || post.originalUrl || rawUrl
                  )}`;
                } else {
                  imgEl.style.visibility = 'hidden';
                }
              }}
            />
            {totalAlbumPhotos > 2 && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center font-bold text-white text-sm backdrop-blur-[2px]">
                +{totalAlbumPhotos - 2}
              </div>
            )}
          </button>}
        </div>
        ) : (
          <div className="w-full aspect-video rounded-2xl bg-black flex items-center justify-center mt-2.5 text-xs text-gray-400">
            {post.albumUrl || post.originalUrl ? (
              <button type="button" className="rounded-lg bg-[var(--tl-accent)] px-3 py-2 text-[var(--tl-accent-contrast)] hover:bg-[var(--tl-accent-hover)]" onClick={() => onOpenLightbox([], 0, post.title, post.albumUrl || post.originalUrl, post.photoItems, post.photoCount)}>
                {isEn ? 'Load album photos' : 'Carregar fotos do álbum'}
              </button>
            ) : <span>{isEn ? 'No photos available' : 'Nenhuma foto disponível'}</span>}
          </div>
        )
      ) : (
        <div
          ref={mediaContainerRef}
          data-video-container
          data-video-surface="true"
          data-density={watchPresentation ? 'cinema' : 'card'}
          tabIndex={0}
          aria-label={onOpenVideo && !watchPresentation ? (isEn ? `Open video ${post.title}` : `Abrir vídeo ${post.title}`) : (isEn ? `Play or pause ${post.title}` : `Reproduzir ou pausar ${post.title}`)}
          onKeyDown={event => {
            if (!watchPresentation && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault(); handleVideoClick(event);
            }
          }}
          onClick={watchPresentation ? undefined : handleVideoClick}
          onMouseEnter={handleMouseEnterVideo}
          onMouseLeave={handleMouseLeaveVideo}
          style={watchPresentation ? {'--timeline-watch-aspect': decodedAspect?.identity === videoIdentity ? decodedAspect.ratio : '16 / 9'} as React.CSSProperties : { touchAction: 'pan-y' }}
          className={`relative overflow-hidden bg-black border-y border-[var(--tl-border)] ${watchPresentation ? '' : 'cursor-pointer'} [&:fullscreen]:max-h-none [&:fullscreen]:w-screen [&:fullscreen]:h-screen [&:fullscreen]:aspect-auto ${watchPresentation ? (isTheater ? "w-full aspect-[var(--timeline-watch-aspect)] max-h-[min(78dvh,720px)]" : "w-full aspect-[var(--timeline-watch-aspect)] max-h-[60dvh]") : "-mx-3.5 !w-[calc(100%+1.75rem)] !max-w-none aspect-video mt-2.5"}`}
        >
          {watchPresentation && post.type !== 'gif' ? (
            hostMounted ? (
              <div ref={setWatchSlotEl} data-persistent-watch-slot="true" className="w-full h-full" />
            ) : (
              <UniversalVideoPlayer
                ref={uvpRef}
                source={universalVideoSource}
                density="cinema"
                posterUrl={post.thumbnail}
                aspectRatio={watchAspectRatio}
                autoPlayOnActive={playbackHandoff?.isPlaying ?? true}
                initialMuted={playbackHandoff?.isMuted ?? true}
                initialQuality={playbackHandoff?.selectedQuality ?? 'auto'}
                initialHandoff={
                  playbackHandoff
                    ? {
                        currentTime: playbackHandoff.currentTime,
                        isMuted: playbackHandoff.isMuted,
                        isPlaying: playbackHandoff.isPlaying,
                        volume: playbackHandoff.volume,
                        playbackRate: playbackHandoff.playbackRate,
                        selectedQuality: playbackHandoff.selectedQuality ?? 'auto',
                        masterHlsUrl: playbackHandoff.masterHlsUrl,
                        qualities: playbackHandoff.qualities,
                        sourceRect: playbackHandoff.sourceRect,
                      }
                    : null
                }
                suspended={suspended}
                isActive={!suspended}
                ambientGlowEnabled={true}
                isTheater={isTheater}
                onToggleTheater={onToggleTheater}
                onMinimizeToMiniPlayer={onMinimizeToMiniPlayer}
                className="w-full h-full"
              />
            )
          ) : (
          <div className="w-full h-full relative group">
            <video
              ref={videoRef}
              playsInline
              aria-hidden={!isPlaying}
              loop={post.type === 'gif'}
              preload={suspended ? "none" : "metadata"}
              muted={isMuted}
              poster={watchPresentation ? post.thumbnail : post.thumbnail || post.creatorAvatar}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={event => {rememberDecodedDimensions(event.currentTarget); handleTimeUpdate();}}
              onLoadedData={() => {if (watchPresentation) {setIsVideoReady(true); setIsBuffering(false); handleTimeUpdate();}}}
              onSeeked={() => {if (watchPresentation) {setIsVideoReady(true); setIsBuffering(false); handleTimeUpdate();}}}
              onPlaying={event => {
                rememberDecodedDimensions(event.currentTarget);
                playbackDiagnosticRef.current = null;
                setPlaybackDiagnostic(null);
                setIsVideoReady(true);
                setIsBuffering(false);
              }}
              onWaiting={() => setIsBuffering(true)}
              onError={() => handleVideoError(fromMediaError(videoRef.current?.error))}
              onClick={handleVideoClick}
              className={`w-full h-full ${watchPresentation ? 'object-contain' : 'object-cover'} cursor-pointer`}
            />

            {/* Poster e Badges Iniciais (exibidos quando pausado ou antes do primeiro frame) */}
            {(watchPresentation ? !isVideoReady : !isPlaying || !isVideoReady) && (!watchPresentation || post.thumbnail) && (
              <>
                <img
                  src={post.thumbnail || post.creatorAvatar || initialFallback}
                  alt={post.title}
                  referrerPolicy="no-referrer"
                  onClick={handleVideoClick}
                  onError={(e) => {
                    const imgEl = e.currentTarget as HTMLImageElement;
                    const rawThumb = post.thumbnail || post.creatorAvatar || '';
                    if (!imgEl.dataset.proxied && rawThumb.startsWith('http')) {
                      imgEl.dataset.proxied = '1';
                      imgEl.src = `/api/proxy-image?url=${encodeURIComponent(rawThumb)}`;
                    } else {
                      imgEl.src = initialFallback;
                    }
                  }}
                  className={`absolute inset-0 w-full h-full ${watchPresentation ? 'object-contain' : 'object-cover'} cursor-pointer`}
                />
                {/* Tag de Visualização na Esquerda Superior */}
                {post.views ? (
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 pointer-events-none z-10">
                    {post.source === 'youtube' && (
                      <span className="bg-red-600/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-md">
                        <Youtube className="w-3 h-3 fill-white" />
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-gray-200 font-semibold text-[10px] shadow-sm">
                      {post.views}
                    </span>
                  </div>
                ) : post.source === 'youtube' ? (
                  <div className="absolute top-2.5 left-2.5 bg-red-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 shadow-md pointer-events-none z-10">
                    <Youtube className="w-3.5 h-3.5 fill-white" />
                    <span>YouTube</span>
                  </div>
                ) : null}

                {/* Qualidade Máxima do Vídeo na Direita Superior */}
                <div className="absolute top-2.5 right-2.5 pointer-events-none z-10">
                  <span className="px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-white font-bold text-[10px] font-mono shadow-sm">
                    {maxQualityLabel}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleVideoClick}
                  className={`cute-press absolute inset-0 m-auto w-12 h-12 rounded-full ${
                    post.source === 'youtube'
                      ? 'bg-red-600 hover:bg-red-500'
                      : 'bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)]'
                  } text-white flex items-center justify-center shadow-2xl transition-opacity duration-200 ${
                    isPlaying ? 'opacity-0 pointer-events-none scale-75' : 'opacity-100 scale-100'
                  }`}
                  title={isEn ? (isPlaying ? 'Pause' : 'Play video') : (isPlaying ? 'Pausar' : 'Reproduzir vídeo')}
                  aria-label={isEn ? (isPlaying ? 'Pause' : 'Play video') : (isPlaying ? 'Pausar' : 'Reproduzir vídeo')}
                  tabIndex={isPlaying ? -1 : 0}
                >
                  <MorphingPlayPauseIcon isPlaying={isPlaying} size={26} />
                </button>
              </>
            )}

            {/* Indicador discreto durante Autoplay no Mudo (estilo YouTube: totalmente limpo sem nenhum timestamp sobreposto) */}
            {isPlaying && isAutoplayPreview && !showControls && isBuffering && (
              <div className="absolute bottom-2.5 right-2.5 flex items-center pointer-events-none">
                <Loader2 className="w-4 h-4 text-white animate-spin drop-shadow" />
              </div>
            )}

            {playbackError && (
              <div role="status" data-playback-error className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-xs text-gray-200" onClick={event => event.stopPropagation()}>
                <span>{playbackDiagnosticMessage(playbackDiagnostic, isEn ? 'en-US' : 'pt-BR')}</span>
                <button type="button" onClick={handleRetryPlayback} className="rounded-lg bg-[var(--tl-accent)] px-3 py-2 font-semibold text-[var(--tl-accent-contrast)] hover:bg-[var(--tl-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]">
                  {isEn ? 'Retry video' : 'Tentar vídeo novamente'}
                </button>
                {post.originalUrl && <a href={post.originalUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">{isEn ? 'Open original source' : 'Abrir no site original'}</a>}
              </div>
            )}

            {/* Barra de Controles Inferior (APENAS quando o usuário clica no vídeo!) */}
              <div
                onClick={(e) => e.stopPropagation()}
                data-visible={showControls}
                data-motion-disabled={disableMotion}
                aria-hidden={!showControls}
                {...(!showControls ? { inert: '' } : {})}
                style={{ '--timeline-motion-duration': `${getSpeedMs(animationSpeed)}ms` } as React.CSSProperties}
                className="timeline-video-controls absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col gap-1.5 z-20"
              >
                <div className="relative flex items-center h-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progress}
                  step="0.1"
                  aria-label={isEn ? 'Video progress' : 'Progresso do vídeo'}
                  onChange={handleScrubberChange}
                  style={{ accentColor: 'var(--tl-accent)' }}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
                  {post.type !== 'gif' && (
                    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                      <PlayerHighlightMarkers highlights={highlights} duration={videoRef.current?.duration || 0} />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-200">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTogglePlayPauseButton}
                      className="p-1 hover:text-[var(--tl-accent-text)]"
                      title={isPlaying ? (isEn ? 'Pause' : 'Pausar') : isEn ? 'Play' : 'Reproduzir'}
                      aria-label={isPlaying ? (isEn ? 'Pause' : 'Pausar') : isEn ? 'Play' : 'Reproduzir'}
                    >
                      {isPlaying ? (
                        <Pause className="w-4 h-4 fill-white" />
                      ) : (
                        <Play className="w-4 h-4 fill-white" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleMuteButton}
                      className="p-1 hover:text-[var(--tl-accent-text)]"
                      title={isMuted ? (isEn ? 'Unmute' : 'Ativar som') : isEn ? 'Mute' : 'Silenciar'}
                      aria-label={isMuted ? (isEn ? 'Unmute' : 'Ativar som') : isEn ? 'Mute' : 'Silenciar'}
                    >
                      {isMuted ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                    <span className="font-mono text-[10px] tabular-nums whitespace-nowrap">
                      {currentTime} / {post.duration || duration}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 relative">
                    {/* Seletor de Qualidades de Streaming */}
                    <button
                      ref={qualityTriggerRef}
                      type="button"
                      aria-expanded={showQualityMenu}
                      aria-controls={showQualityMenu ? qualityMenuId : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!hasFetchedQualities) {
                          void fetchFreshQualities(true);
                        }
                        setShowOptionsMenu(false);
                        setShowQualityMenu((prev) => !prev);
                      }}
                      className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-[var(--tl-accent)] text-[10px] font-mono font-bold text-white flex items-center gap-1 transition-colors"
                      title={isEn ? 'Video quality' : 'Qualidade do vídeo'}
                      aria-label={isEn ? 'Video quality' : 'Qualidade do vídeo'}
                    >
                      <Settings className="w-3 h-3" />
                      <span>
                        {selectedQuality === 'auto'
                          ? `${isEn ? 'Auto' : 'Auto'} (${currentQualityLabel})`
                          : currentQualityLabel}
                      </span>
                    </button>

                      <div
                        ref={qualityMenuRef}
                        id={qualityMenuId}
                        data-visible={showQualityMenu && showControls}
                        aria-hidden={!showQualityMenu || !showControls}
                        {...(!showQualityMenu || !showControls ? { inert: '' } : {})}
                        onClick={(e) => e.stopPropagation()}
                        className="timeline-quality-menu absolute bottom-7 right-6 min-w-[130px] rounded-xl bg-[var(--tl-surface-glass)] border border-[var(--tl-border-strong)] shadow-2xl py-1 z-30 backdrop-blur-md"
                      >
                        <div className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--tl-text-muted)] border-b border-[var(--tl-border)]">
                          {isEn ? 'Quality' : 'Qualidade'}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleSelectQuality(e, 'auto')}
                          className="w-full px-2.5 py-1.5 text-left text-[11px] font-mono text-[var(--tl-text-primary)] hover:bg-[var(--tl-accent-soft)] flex items-center justify-between"
                        >
                          <span>{isEn ? 'Auto' : 'Automático'}</span>
                          {selectedQuality === 'auto' && (
                            <Check className="w-3.5 h-3.5 text-[var(--tl-accent-text)]" />
                          )}
                        </button>
                        {qualities.map((q) => (
                          <button
                            key={q.height}
                            type="button"
                            onClick={(e) => handleSelectQuality(e, q.height)}
                            className="w-full px-2.5 py-1.5 text-left text-[11px] font-mono text-[var(--tl-text-primary)] hover:bg-[var(--tl-accent-soft)] flex items-center justify-between"
                          >
                            <span>{q.label}</span>
                            {selectedQuality === q.height && (
                              <Check className="w-3.5 h-3.5 text-[var(--tl-accent-text)]" />
                            )}
                          </button>
                        ))}
                      </div>

                    <button
                      type="button"
                      onClick={handleFullscreen}
                      className="p-1 hover:text-[var(--tl-accent-text)]"
                      title={isFullscreen ? (isEn ? 'Exit fullscreen' : 'Sair da tela cheia') : (isEn ? 'Fullscreen' : 'Tela cheia')}
                      aria-label={isFullscreen ? (isEn ? 'Exit fullscreen' : 'Sair da tela cheia') : (isEn ? 'Fullscreen' : 'Tela cheia')}
                    >
                      {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
          </div>
          )}
        </div>
      )}

      {!watchPresentation && <>
      {/* Título Limpo */}
      <h4 className="text-xs font-bold text-[var(--tl-text-primary)] line-clamp-2 pt-1 leading-snug break-words min-w-0">
        {post.title}
      </h4>

      {/* Barra de Ações Mobile & Desktop: Ícones Puros Sem Quebra */}
      <div className="flex items-center justify-between gap-2 min-w-0 pt-1 border-t border-[var(--tl-border)] text-xs">
        <div className="flex items-center gap-4">
          {/* Curtir */}
          <button
            type="button"
            onClick={() => toggleLike(post.id, post)}
            className={`flex items-center gap-1.5 smooth-transition active:scale-95 ${
              isLiked ? 'text-rose-500 fill-rose-500' : 'text-[var(--tl-text-muted)] hover:text-rose-400'
            }`}
            title={isLiked ? (isEn ? 'Remove local like mark' : 'Remover marcação local de curtida') : isEn ? 'Mark as liked on this device' : 'Marcar curtida neste dispositivo'}
            aria-label={isLiked ? (isEn ? 'Remove local like mark' : 'Remover marcação local de curtida') : isEn ? 'Mark as liked on this device' : 'Marcar curtida neste dispositivo'}
            aria-pressed={isLiked}
          >
            <Heart className={`w-4 h-4 ${isLiked ? `fill-rose-500 text-rose-500${disableMotion ? '' : ' heart-pop'}` : ''}`} />
            <span data-source-like-count className="text-[11px] font-mono" title={engagement?.like_count == null ? engagementMessage || unknownCountLabel : undefined}>
              {engagementLoading && engagement?.like_count == null
                ? <Loader2 aria-hidden="true" className="w-3 h-3 animate-spin motion-reduce:animate-none" />
                : engagement?.like_count ?? '—'}
            </span>
          </button>

          {/* Comentários */}
          <button
            type="button"
            onClick={() => onOpenComments(post.id)}
            className="flex items-center gap-1.5 text-[var(--tl-text-muted)] hover:text-[var(--tl-accent-text)] active:text-[var(--tl-accent-text-strong)] smooth-transition active:scale-95"
            title={isEn ? 'View comments' : 'Ver comentários'}
            aria-label={isEn ? 'View comments' : 'Ver comentários'}
          >
            <MessageSquare className="w-4 h-4" />
            <span data-source-comment-count className="text-[11px] font-mono" title={engagement?.comment_count == null ? engagementMessage || unknownCountLabel : undefined}>
              {engagementLoading && engagement?.comment_count == null
                ? <Loader2 aria-hidden="true" className="w-3 h-3 animate-spin motion-reduce:animate-none" />
                : engagement?.comment_count ?? '—'}
            </span>
          </button>
        </div>

        {/* Salvar, Favoritar e Compartilhar */}
        <div className="flex items-center gap-3">
          {/* Favoritar */}
          <button
            type="button"
            onClick={() => toggleFavorite(post.id, post)}
            className={`p-1 smooth-transition cute-press ${
              isFav ? 'text-[var(--tl-accent-text)] fill-current' : 'text-[var(--tl-text-muted)] hover:text-[var(--tl-accent-text)]'
            }`}
            title={isEn ? 'Favorite post' : 'Favoritar post'}
            aria-label={isEn ? 'Favorite post' : 'Favoritar post'}
            aria-pressed={isFav}
          >
            <Bookmark className={`w-4 h-4 ${isFav ? 'fill-current bookmark-boing' : ''}`} />
          </button>

          {/* Salvar na Biblioteca */}
          {post.type === 'video' && <button
            ref={saveButtonRef}
            type="button"
            onClick={handleSaveVideo}
            disabled={isSavingVideo}
            className={`p-1 smooth-transition cute-press ${
              savedVideo ? 'text-blue-400 fill-blue-400' : 'text-[var(--tl-text-muted)] hover:text-blue-400'
            }`}
            title={isSavingVideo ? (isEn ? 'Saving video…' : 'Salvando vídeo…') : savedVideo ? (isEn ? `Saved in ${savedVideo.folder}` : `Salvo em ${savedVideo.folder}`) : (isEn ? 'Save to video gallery' : 'Salvar na galeria de vídeos')}
            aria-label={isSavingVideo ? (isEn ? 'Saving video…' : 'Salvando vídeo…') : savedVideo ? (isEn ? `Saved in ${savedVideo.folder}` : `Salvo em ${savedVideo.folder}`) : (isEn ? 'Save to video gallery' : 'Salvar na galeria de vídeos')}
            aria-busy={isSavingVideo}
          >
            <span className="timeline-save-icon" data-saved={Boolean(savedVideo)} data-animate={saveConfirmedMotion && !disableMotion}>
              <Save aria-hidden="true" className="timeline-save-disk w-4 h-4" />
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" onAnimationEnd={() => setSaveConfirmedMotion(false)} className={`timeline-save-happy w-4 h-4 ${saveConfirmedMotion && !disableMotion ? 'bookmark-boing' : ''}`}><path d="M3 6.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M8 12.5h.01M15 12.5h.01M8.5 16c.9 1.4 4.1 1.4 5 0M16.5 9.5l1 1 2-2" /></svg>
            </span>
          </button>}

          {/* Adicionar à Playlist */}
          <button
            type="button"
            data-post-playlist
            onClick={() => {
              const item = normalizeTimelinePostToLibraryItem(post);
              if (item) openPlaylistModal(item);
            }}
            className="group/pl p-1 text-[var(--tl-text-muted)] hover:text-[var(--tl-accent-text)] active:text-[var(--tl-accent-text-strong)] smooth-transition cute-press"
            title={isEn ? 'Add to playlist' : 'Adicionar à playlist'}
            aria-label={isEn ? 'Add to playlist' : 'Adicionar à playlist'}
          >
            <ListPlus className="w-4 h-4 transition-transform duration-200 group-hover/pl:-rotate-6 group-hover/pl:-translate-y-0.5 motion-reduce:transform-none" />
          </button>

          {/* Compartilhar */}
          <button
            type="button"
            onClick={handleShare}
            className="p-1 text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] active:text-[var(--tl-text-primary)] smooth-transition cute-press"
            title={isEn ? 'Share post' : 'Compartilhar post'}
            aria-label={isEn ? 'Share post' : 'Compartilhar post'}
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {saveFeedback && <div ref={saveFeedbackRef} role="status" aria-live="polite" aria-atomic="true" data-timeline-save-status={saveFeedback.kind} data-closing={closingSaveFeedback || undefined}
        className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${disableMotion ? '' : 'watch-artist-chip-enter'} ${saveFeedback.kind === 'error' ? 'bg-rose-500/10 text-[var(--tl-text-primary)]' : 'bg-[var(--tl-accent-soft)] text-[var(--tl-accent-text)]'}`}>
        {saveFeedback.kind === 'error' ? <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" /> : saveFeedback.kind === 'saving' ? <Save aria-hidden="true" className="h-4 w-4 shrink-0" /> : <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 break-words">{saveFeedback.kind === 'saving' ? (isEn ? 'Saving to video gallery…' : 'Salvando na galeria de vídeos…')
          : saveFeedback.kind === 'saved' ? (isEn ? `Saved in ${saveFeedback.folder}` : `Salvo em ${saveFeedback.folder}`)
          : saveFeedback.kind === 'already' ? (isEn ? `Already saved in ${saveFeedback.folder}` : `Já salvo em ${saveFeedback.folder}`)
          : saveFeedback.code === 'unsupported' ? (isEn ? 'Saving from this source is not supported yet.' : 'Ainda não é possível salvar desta fonte.')
          : saveFeedback.code === 'unresolved' ? (isEn ? 'Could not find a video stream with audio.' : 'Não foi possível obter uma transmissão com áudio.')
          : saveFeedback.code === 'missing_source' ? (isEn ? 'The original video or profile address is unavailable.' : 'O endereço original do vídeo ou perfil não está disponível.')
          : (isEn ? 'Could not confirm the save. Check your connection and try again.' : 'Não foi possível confirmar o salvamento. Verifique a conexão e tente novamente.')}</span>
        {saveFeedback.kind === 'error' && <button type="button" onClick={handleSaveVideo} className="shrink-0 font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]">{isEn ? 'Retry' : 'Tentar novamente'}</button>}
        {saveFeedback.kind !== 'saving' && <button type="button" onClick={closeSaveFeedback} disabled={closingSaveFeedback} aria-label={isEn ? 'Dismiss save message' : 'Fechar mensagem de salvamento'} className="shrink-0 rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>}
      </div>}
      <div role="status" aria-live="polite" aria-atomic="true" data-source-count-status={engagementState.status} className={engagementMessage ? 'flex flex-wrap items-center gap-2 text-[11px] text-[var(--tl-text-muted)]' : 'sr-only'}>
        <span>{engagementMessage}</span>
        {engagementState.status === 'error' && (
          <button type="button" onClick={engagementState.retry} className="rounded px-1.5 py-1 text-[var(--tl-accent-text)] hover:text-[var(--tl-accent-text-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]">
            {isEn ? 'Retry counts' : 'Tentar contagens novamente'}
          </button>
        )}
      </div>
      </>}
      {!watchPresentation && <span ref={saveOutlineRef} aria-hidden="true" className="timeline-save-outline" />}
    </article>
  );
};
