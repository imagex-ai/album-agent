import React, {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {ArrowLeft, Bookmark, Check, ChevronDown, ExternalLink, Heart, ListPlus, Share2, ThumbsDown, UserPlus} from 'lucide-react';
import {timelinePlaybackRect, TimelinePostCard, TimelinePlaybackHandoff} from './TimelinePostCard';
import {
  buildTimelineStreamUrl,
  buildWatchFollowTarget,
  isWatchPageOnlyUrl,
  normalizeTimelineQualities,
  shouldRetryTransientWatchFetch,
  TimelinePost,
  TimelineVideoQuality,
} from './timelineModel';
import {useProfileTimelineStore} from '../../../store/useProfileTimelineStore';
import {useProfileHubLibraryStore} from '../../../store/useProfileHubLibraryStore';
import {canonicalLibraryMediaKey, normalizeTimelinePostToLibraryItem} from '../../../services/profileHubLibraryModel';
import {profileShortcutIdentity, useProfileDirectoryLibraryStore} from '../../../store/useProfileDirectoryLibraryStore';
import {useMiniPlayerStore} from '../../../store/useMiniPlayerStore';
import {usePersistentPlayerStore} from '../../../store/usePersistentPlayerStore';
import {runViewTransitionSafe} from '../../video-player/engine/playerMotion';
import {SourceComments} from './SourceComments';
import {SourceAvatar} from '../common/SourceAvatar';
import {avatarIdentityKey, useProfileAvatarStore, useResolvedAvatar} from '../../../store/useProfileAvatarStore';
import {getSpeedMs} from '../../../services/motionConfig';
import {useAppStore} from '../../../store/useAppStore';
import {timelineCommentsSourceUrl} from '../../../services/profileHubComments';
import {engagementSourceUrl} from '../../../services/profileHubEngagement';
import {handleProxiedImageError} from '../../../services/profileHubImageFallback';
import {fetchProfileHubRelated, ProfileHubRelatedResponse, ProfileHubRelatedVideo} from '../../../services/profileHubRelated';
import {fetchWatchVideoDetails, WatchVideoArtist, WatchVideoDetails} from '../../../services/profileHubWatchApi';
import {WatchArtistsRow} from './WatchArtistsRow';

export interface TimelineWatchSession {post: TimelinePost; handoff: TimelinePlaybackHandoff; authorUrl?: string;}
export interface WatchCreatorSeed {name?: string; avatar?: string | null;}
// Match the existing md layout breakpoint to the actual viewer width, including phone preview frames.
const WATCH_SIDEBAR_MIN_WIDTH = 768;
// Existing app entrance easing from index.css; duration comes from its motion settings.
const WATCH_OPEN_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
interface Props {onOpenCreator: (url: string, seed?: WatchCreatorSeed) => void; initialSection?: 'comments'|'related'; onSectionChange?: (value:'comments'|'related') => void; active?: boolean; registerPlaybackSnapshot?: (snapshot: (() => TimelinePlaybackHandoff) | null) => void; session: TimelineWatchSession; onClose: () => void; onChangeVideo: (session: TimelineWatchSession) => void;}
const watchMetadataCache = new Map<string, { related?: ProfileHubRelatedResponse; details?: WatchVideoDetails }>();

export const TimelineWatchView: React.FC<Props> = ({session, onClose, onChangeVideo, onOpenCreator, active = true, registerPlaybackSnapshot, initialSection = 'related', onSectionChange}) => {
  const isEn = useAppStore(state => state.settings.language === 'en-US');
  const disableMotion = useAppStore(state => state.settings.disableAllAnimations);
  const animationSpeed = useAppStore(state => state.settings.animationSpeed);
  const addNotification = useAppStore(state => state.addNotification);
  const creators = useProfileTimelineStore(state => state.creators);
  const creatorProfiles = useProfileTimelineStore(state => state.creatorProfiles);
  const likedPostIds = useProfileTimelineStore(state => state.likedPostIds);
  const favoritedPostIds = useProfileTimelineStore(state => state.favoritedPostIds);
  const toggleLike = useProfileTimelineStore(state => state.toggleLike);
  const toggleFavorite = useProfileTimelineStore(state => state.toggleFavorite);
  const toggleFollowCreator = useProfileTimelineStore(state => state.toggleFollowCreator);
  const favorites = useProfileDirectoryLibraryStore(state => state.favorites);
  const libraryLiked = useProfileHubLibraryStore(state => state.liked);
  const libraryFavorites = useProfileHubLibraryStore(state => state.favorites);
  const recordHistory = useProfileHubLibraryStore(state => state.recordHistory);
  const openPlaylistModal = useProfileHubLibraryStore(state => state.openPlaylistModal);
  const hydrateLibrary = useProfileHubLibraryStore(state => state.hydrateLibrary);
  const lastRecordedWatchRef = useRef<string | null>(null);
  const lastEnrichedHistoryRef = useRef<string | null>(null);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [followPulseKey, setFollowPulseKey] = useState(0);
  const [likePulseKey, setLikePulseKey] = useState(0);
  const [favoritePulseKey, setFavoritePulseKey] = useState(0);
  const [playlistPulseKey, setPlaylistPulseKey] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const shareResetTimerRef = useRef<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const animatedSessionRef = useRef<TimelineWatchSession | null>(null);
  const sourceUrl = timelineCommentsSourceUrl(session.post);
  const watchContainerRef = useRef<HTMLElement | null>(null);
  const relatedRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const [section, setSection] = useState<{source:string|null; value:'comments'|'related'}>(() => ({source:sourceUrl,value:initialSection}));
  const activeSection = section.source === sourceUrl ? section.value : 'related';
  const pendingSectionScroll = useRef(false);
  const [commentTotal, setCommentTotal] = useState<{source:string|null; total:number|null}>({source:null,total:null});
  const [wide, setWide] = useState<boolean | null>(null);
  const [isTheater, setIsTheater] = useState(false);
  const toggleTheaterWithMotion = useCallback((next: boolean) => {
    void runViewTransitionSafe(() => flushSync(() => setIsTheater(next)), {
      element: playerRef.current,
      transitionName: 'timeline-theater-player',
      disableAllAnimations: disableMotion,
    });
  }, [disableMotion]);
  const localSnapshotRef = useRef<(() => TimelinePlaybackHandoff) | null>(null);
  const handleRegisterPlaybackSnapshot = useCallback((snapshot: (() => TimelinePlaybackHandoff) | null) => {
    localSnapshotRef.current = snapshot;
    registerPlaybackSnapshot?.(snapshot);
  }, [registerPlaybackSnapshot]);
  useEffect(() => {
    if (!active) return;
    useMiniPlayerStore.getState().setActiveWatchVideoId(session.post.id);
    return () => {
      useMiniPlayerStore.getState().setActiveWatchVideoId(null);
    };
  }, [active, session.post.id]);
  const effectiveHandoff = useMemo<TimelinePlaybackHandoff>(() => {
    const pendingRecord = useMiniPlayerStore.getState().pendingExpandHandoff;
    const miniHandoff =
      pendingRecord &&
      (pendingRecord.source.id === session.post.id ||
        pendingRecord.source.streamUrl === session.post.id)
        ? pendingRecord.handoff
        : null;
    if (miniHandoff) {
      return {
        ...session.handoff,
        currentTime: miniHandoff.currentTime,
        isMuted: Boolean(miniHandoff.isMuted ?? session.handoff.isMuted),
        isPlaying: miniHandoff.isPlaying,
        volume: miniHandoff.volume ?? session.handoff.volume,
        playbackRate: miniHandoff.playbackRate ?? session.handoff.playbackRate,
        selectedQuality: miniHandoff.selectedQuality ?? session.handoff.selectedQuality,
        qualities: miniHandoff.qualities
          ? miniHandoff.qualities
              .filter((q): q is { height: number; label: string; streamUrl: string } => Boolean(q.streamUrl))
              .map((q) => ({ label: q.label, streamUrl: q.streamUrl, height: q.height }))
          : session.handoff.qualities,
        masterHlsUrl: miniHandoff.masterHlsUrl ?? session.handoff.masterHlsUrl,
      };
    }
    return session.handoff;
  }, [session.handoff, session.post.id]);
  useEffect(() => {
    const id = session.post.id;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => useMiniPlayerStore.getState().consumePendingExpandHandoff(id))
      : window.setTimeout(() => useMiniPlayerStore.getState().consumePendingExpandHandoff(id), 0);
    return () => {
      if (typeof cancelAnimationFrame === 'function' && typeof raf === 'number') {
        cancelAnimationFrame(raf);
      } else {
        clearTimeout(raf);
      }
    };
  }, [session.post.id]);
  useLayoutEffect(() => {
    setSection(previous => previous.source === sourceUrl ? previous : {source:sourceUrl,value:'related'});
    setCommentTotal(previous => previous.source === sourceUrl ? previous : {source:sourceUrl,total:null});
    setAboutExpanded(false);
    setShareCopied(false);
    setIsTheater(false);
    if (shareResetTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(shareResetTimerRef.current);
      shareResetTimerRef.current = null;
    }
  }, [sourceUrl]);
  useEffect(() => () => {
    if (shareResetTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(shareResetTimerRef.current);
      shareResetTimerRef.current = null;
    }
  }, []);
  useLayoutEffect(() => {
    const element = watchContainerRef.current;
    if (!element || !active) return;
    const update = () => setWide(element.clientWidth >= WATCH_SIDEBAR_MIN_WIDTH);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [active]);
  useLayoutEffect(() => {
    const element = playerRef.current;
    const from = session.handoff.sourceRect;
    if (!active || !element || wide === null || !from || animatedSessionRef.current === session) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (disableMotion || reduced?.matches || typeof element.animate !== 'function') return;
    let animation: Animation | undefined;
    element.style.visibility = 'hidden';
    const frame = requestAnimationFrame(() => {
      element.style.visibility = '';
      const to = element.getBoundingClientRect();
      if (!to.width || !to.height) return;
      animatedSessionRef.current = session;
      animation = element.animate([
        {transformOrigin:'top left', transform:`translate(${from.x-to.x}px, ${from.y-to.y}px) scale(${from.width/to.width}, ${from.height/to.height})`},
        {transformOrigin:'top left', transform:'translate(0, 0) scale(1, 1)'},
      ], {duration:getSpeedMs(animationSpeed), easing:WATCH_OPEN_EASING});
    });
    const changed = () => { if (reduced?.matches) { cancelAnimationFrame(frame); animation?.cancel(); element.style.visibility = ''; } };
    reduced?.addEventListener?.('change', changed);
    return () => { cancelAnimationFrame(frame); animation?.cancel(); element.style.visibility = ''; reduced?.removeEventListener?.('change', changed); };
  }, [active, session, wide, disableMotion, animationSpeed]);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const commentsRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!active || !pendingSectionScroll.current) return;
    pendingSectionScroll.current = false;
    const panel = activeSection === 'comments' ? commentsRef.current : relatedRef.current;
    const player = playerRef.current;
    if (!panel || !player) return;
    const main = watchContainerRef.current?.closest('main');
    const stickyTop = parseFloat(getComputedStyle(player).top) || 0;
    const contentTop = (main?.getBoundingClientRect().top || 0) + stickyTop + player.getBoundingClientRect().height;
    const distance = panel.getBoundingClientRect().top-contentTop;
    // Keep focus on the clicked native button; move only the canonical scroller.
    if (main) main.scrollBy({top:distance, behavior:'instant' as ScrollBehavior});
    else window.scrollBy({top:distance, behavior:'instant' as ScrollBehavior});
  }, [active, section, activeSection, sourceUrl, wide]);
  const selectSection = (value:'comments'|'related') => {
    pendingSectionScroll.current = true;
    setSection({source:sourceUrl,value});
    onSectionChange?.(value);
  };
  const [attempt, setAttempt] = useState(0);
  const [related, setRelated] = useState<{key:string; data?:ProfileHubRelatedResponse; error?:boolean} | null>(() => {
    if (!sourceUrl) return null;
    const cached = watchMetadataCache.get(sourceUrl)?.related;
    return cached ? { key: sourceUrl, data: cached } : null;
  });
  const [details, setDetails] = useState<{key:string; data?:WatchVideoDetails; error?:boolean} | null>(() => {
    if (!sourceUrl) return null;
    const cached = watchMetadataCache.get(sourceUrl)?.details;
    return cached ? { key: sourceUrl, data: cached } : null;
  });
  useEffect(() => { if (active) backRef.current?.focus({preventScroll:true}); }, [active]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!active || event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]') || document.fullscreenElement) return;
      event.preventDefault(); onClose();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [active, onClose]);
  useEffect(() => {
    if (!active || !sourceUrl) return;
    const cached = watchMetadataCache.get(sourceUrl);
    if (cached?.related && (related?.key !== sourceUrl || !related.data)) {
      setRelated({ key: sourceUrl, data: cached.related });
    }
    if (cached?.details && (details?.key !== sourceUrl || !details.data)) {
      setDetails({ key: sourceUrl, data: cached.details });
    }
    const hasRelated = (related?.key === sourceUrl && !related.error && Boolean(related.data)) || Boolean(cached?.related);
    const hasDetails = (details?.key === sourceUrl && !details.error && Boolean(details.data)) || Boolean(cached?.details);
    if (hasRelated && hasDetails) return;
    const controller = new AbortController();
    let current = true;
    const retryTimers: number[] = [];

    const loadWithRetry = <T,>(
      fetcher: (url: string, signal: AbortSignal) => Promise<T>,
      onSuccess: (data: T) => void,
      onError: () => void,
    ) => {
      fetcher(sourceUrl, controller.signal)
        .then(data => { if (current) onSuccess(data); })
        .catch(error => {
          if (!current || controller.signal.aborted) return;
          if (!shouldRetryTransientWatchFetch(error, false)) {
            onError();
            return;
          }
          const timerId = window.setTimeout(() => {
            if (!current || controller.signal.aborted) return;
            fetcher(sourceUrl, controller.signal)
              .then(data => { if (current) onSuccess(data); })
              .catch(() => { if (current && !controller.signal.aborted) onError(); });
          }, 450);
          retryTimers.push(timerId);
        });
    };

    if (!hasRelated) {
      loadWithRetry(
        fetchProfileHubRelated,
        data => {
          const prev = watchMetadataCache.get(sourceUrl) || {};
          watchMetadataCache.set(sourceUrl, { ...prev, related: data });
          setRelated({key:sourceUrl,data});
        },
        () => setRelated({key:sourceUrl,error:true}),
      );
    }
    if (!hasDetails) {
      loadWithRetry(
        fetchWatchVideoDetails,
        data => {
          const prev = watchMetadataCache.get(sourceUrl) || {};
          watchMetadataCache.set(sourceUrl, { ...prev, details: data });
          setDetails({key:sourceUrl,data});
        },
        () => setDetails({key:sourceUrl,error:true}),
      );
    }
    return () => {
      current = false;
      retryTimers.forEach(timerId => window.clearTimeout(timerId));
      controller.abort();
    };
  }, [active, sourceUrl, attempt]);
  const activeRelated = related?.key === sourceUrl ? related : null;
  const activeDetails = details?.key === sourceUrl ? details : null;
  const data = activeDetails?.data;
  // Only source-confirmed uploader identity authorizes navigation and post fallbacks.
  // A followed profile is not evidence that it uploaded this particular video.
  const creatorUrl = engagementSourceUrl(data?.author_url);
  const creatorIdentity = creatorUrl ? profileShortcutIdentity(creatorUrl) : null;
  const knownCreatorsList = Object.keys(creatorProfiles).length ? Object.values(creatorProfiles) : creators;
  const knownCreator =
    knownCreatorsList.find(
      (c) =>
        (creatorIdentity && c.profileUrl && profileShortcutIdentity(c.profileUrl) === creatorIdentity) ||
        (!!creatorUrl && c.id === session.post.creatorId)
    ) || null;
  const knownCreatorAvatar =
    knownCreator?.profileUrl && creatorIdentity && profileShortcutIdentity(knownCreator.profileUrl) === creatorIdentity
      ? engagementSourceUrl(knownCreator.avatar)
      : null;
  const postCreatorMatches = Boolean(
    creatorUrl &&
      (typeof avatarIdentityKey === 'function'
        ? avatarIdentityKey(creatorUrl) && avatarIdentityKey(creatorUrl) === avatarIdentityKey(session.authorUrl)
        : engagementSourceUrl(session.authorUrl) === creatorUrl)
  );
  const creatorName = data?.author_name || (postCreatorMatches ? session.post.creatorName : '') || (isEn ? 'Unknown creator' : 'Criador desconhecido');
  const creatorAvatar = data?.author_avatar_url || (postCreatorMatches ? engagementSourceUrl(session.post.creatorAvatar) : null);
  const inlineOrKnownCreatorAvatar = creatorAvatar || knownCreatorAvatar;
  const creatorAvatarResolution = useResolvedAvatar(creatorUrl, inlineOrKnownCreatorAvatar, {
    hydrate: active && Boolean(creatorUrl) && !inlineOrKnownCreatorAvatar,
  });
  const resolvedCreatorAvatar = creatorAvatarResolution.src || inlineOrKnownCreatorAvatar;
  const creatorImage = (
    <SourceAvatar
      name={creatorName}
      src={inlineOrKnownCreatorAvatar}
      profileUrl={creatorUrl}
      referer={creatorUrl || sourceUrl}
      hydrate={active && Boolean(creatorUrl) && !inlineOrKnownCreatorAvatar}
      disableMotion={disableMotion}
      className="w-10 h-10 rounded-full object-cover shrink-0 bg-[var(--tl-surface-elevated)]"
    />
  );
  const creatorAudience = data?.audience_count_text && data.audience_kind ? data.audience_count_text :
    activeDetails?.error ? (isEn ? 'Could not load creator details.' : 'Não foi possível carregar os detalhes do criador.') :
    sourceUrl && !activeDetails ? (isEn ? 'Loading creator details…' : 'Carregando detalhes do criador…') :
    (isEn ? 'Audience unavailable from the source.' : 'Audiência indisponível na origem.');
  const followedProfileIdentities = favorites
    .filter(item => item.kind === 'profile')
    .map(item => profileShortcutIdentity(item.url))
    .filter((id): id is string => Boolean(id));
  const isFollowing = !!creatorIdentity && followedProfileIdentities.includes(creatorIdentity);
  const followTarget = buildWatchFollowTarget({
    creatorUrl,
    creatorName,
    creatorAvatar: resolvedCreatorAvatar,
    audienceCountText: data?.audience_count_text,
    audienceKind: data?.audience_kind,
    normalizedIdentity: creatorIdentity,
    existingCreators: knownCreatorsList,
  });
  const watchCreatorSnapshot = followTarget || (creatorName || creatorUrl ? {
    id: knownCreator?.id || creatorUrl || session.post.creatorId,
    name: creatorName || knownCreator?.name || '',
    handle: knownCreator?.handle || '',
    avatar: resolvedCreatorAvatar || knownCreator?.avatar || '',
    profileUrl: creatorUrl || knownCreator?.profileUrl || '',
    site: knownCreator?.site || session.post.source,
  } : knownCreator);
  const watchLibraryItem = normalizeTimelinePostToLibraryItem(session.post, watchCreatorSnapshot);
  const watchLibKey = canonicalLibraryMediaKey(session.post);
  useEffect(() => {
    void hydrateLibrary();
  }, [hydrateLibrary]);
  useEffect(() => {
    if (!active) {
      lastRecordedWatchRef.current = null;
      lastEnrichedHistoryRef.current = null;
      return;
    }
    const trackingKey = `${session.post.id}|${sourceUrl || ''}`;
    const creatorNameResolved = (watchCreatorSnapshot?.name || '').trim();
    const hasMeaningfulCreator = Boolean(
      creatorNameResolved && !/^(unknown creator|criador desconhecido|unknown)$/i.test(creatorNameResolved)
    );
    const enrichKey = `${trackingKey}|${creatorNameResolved}|${watchCreatorSnapshot?.profileUrl || ''}|${resolvedCreatorAvatar || ''}`;
    const historyItem = normalizeTimelinePostToLibraryItem(session.post, watchCreatorSnapshot);
    if (!historyItem) return;

    if (lastRecordedWatchRef.current !== trackingKey) {
      lastRecordedWatchRef.current = trackingKey;
      lastEnrichedHistoryRef.current = hasMeaningfulCreator ? enrichKey : null;
      void recordHistory(historyItem);
      return;
    }
    if (hasMeaningfulCreator && lastEnrichedHistoryRef.current !== enrichKey) {
      lastEnrichedHistoryRef.current = enrichKey;
      void recordHistory(historyItem, { enrichOnly: true });
    }
  }, [active, session.post, sourceUrl, watchCreatorSnapshot, recordHistory]);
  const isPostLiked = Boolean(
    likedPostIds[session.post.id] ||
    (watchLibKey && libraryLiked.some(item => item.key === watchLibKey || item.id === session.post.id))
  );
  const isPostFavorited = Boolean(
    favoritedPostIds[session.post.id] ||
    (watchLibKey && libraryFavorites.some(item => item.key === watchLibKey || item.id === session.post.id))
  );
  const handleToggleFollow = () => {
    if (!followTarget) return;
    if (!isFollowing && !disableMotion) {
      setFollowPulseKey(previous => previous + 1);
    }
    toggleFollowCreator(followTarget);
  };
  const handleToggleLike = () => {
    if (!isPostLiked && !disableMotion) {
      setLikePulseKey(previous => previous + 1);
    }
    toggleLike(session.post.id, session.post, watchCreatorSnapshot);
  };
  const handleToggleFavorite = () => {
    if (!isPostFavorited && !disableMotion) {
      setFavoritePulseKey(previous => previous + 1);
    }
    toggleFavorite(session.post.id, session.post, watchCreatorSnapshot);
  };
  const handleOpenPlaylist = () => {
    if (!watchLibraryItem) return;
    if (!disableMotion) {
      setPlaylistPulseKey(previous => previous + 1);
    }
    openPlaylistModal(watchLibraryItem);
  };
  const handleShareVideo = async () => {
    const shareTarget = sourceUrl || engagementSourceUrl(session.post.originalUrl);
    if (!shareTarget) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({title: data?.title || session.post.title, url: shareTarget});
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareTarget);
        setShareCopied(true);
        if (typeof window !== 'undefined') {
          if (shareResetTimerRef.current !== null) window.clearTimeout(shareResetTimerRef.current);
          shareResetTimerRef.current = window.setTimeout(() => {
            setShareCopied(false);
            shareResetTimerRef.current = null;
          }, 1800);
        }
        addNotification({type: 'success', title: isEn ? 'Share' : 'Compartilhar', message: isEn ? 'Video link copied!' : 'Link do vídeo copiado!'});
      }
    } catch {
      // User dismissed share sheet or clipboard was unavailable.
    }
  };
  const supportsNativeFocusgroup = typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;
  const syncToolbarRovingTabindex = (activeElement?: HTMLElement | null) => {
    if (supportsNativeFocusgroup) return;
    const container = toolbarRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
    if (items.length === 0) return;
    const target = activeElement && items.includes(activeElement)
      ? activeElement
      : items.find(el => el.getAttribute('tabindex') === '0') || items[0];
    items.forEach(el => el.setAttribute('tabindex', el === target ? '0' : '-1'));
  };
  useEffect(() => {
    syncToolbarRovingTabindex();
  }, [sourceUrl, Boolean(watchLibraryItem), data?.reaction_kind]);
  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (supportsNativeFocusgroup) return;
    const container = toolbarRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(event.target as HTMLElement);
    if (currentIndex === -1) return;
    const isRtl = typeof window !== 'undefined' && window.getComputedStyle(container).direction === 'rtl';
    let nextIndex = -1;
    if (event.key === 'ArrowRight') {
      nextIndex = isRtl ? (currentIndex - 1 + items.length) % items.length : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = isRtl ? (currentIndex + 1) % items.length : (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex === -1) return;
    event.preventDefault();
    const nextItem = items[nextIndex];
    syncToolbarRovingTabindex(nextItem);
    nextItem.focus();
  };
  const handleToolbarFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    if (supportsNativeFocusgroup) return;
    const target = event.target as HTMLElement | null;
    if (target && target.matches('button:not(:disabled), a[href]')) {
      syncToolbarRovingTabindex(target);
    }
  };
  const descriptionText = data?.description || session.post.caption || (activeDetails?.error
    ? (isEn ? 'Could not load video details.' : 'Não foi possível carregar os detalhes do vídeo.')
    : !activeDetails
      ? (isEn ? 'Loading video details…' : 'Carregando detalhes do vídeo…')
      : (isEn ? 'No description available from the source.' : 'Descrição indisponível na origem.'));
  const aboutPanelId = `${panelId}-about`;
  const openRelated = (video: ProfileHubRelatedVideo, sourceRect?:TimelinePlaybackHandoff['sourceRect']) => {
    const post: TimelinePost = {id:video.id, creatorId:'', creatorName:video.author_name || '', creatorHandle:'',creatorAvatar:'',type:'video',originalUrl:video.source_url,videoUrl:video.source_url,title:video.title || '',thumbnail:video.thumbnail_url || undefined,duration:video.duration || undefined,comments:[],likes:null,date:''};
    onChangeVideo({post,handoff:{currentTime:0,isMuted:true,isPlaying:true,sourceRect},authorUrl:video.author_url || undefined});
    backRef.current?.focus({preventScroll:true});
  };
  const handleMinimizeToMiniPlayer = useCallback(() => {
    const snap = localSnapshotRef.current ? localSnapshotRef.current() : effectiveHandoff;
    const rawQualities = normalizeTimelineQualities(snap.qualities ?? session.post.qualities);
    const qualities = rawQualities.map((q: TimelineVideoQuality) => ({
      label: q.label,
      streamUrl: buildTimelineStreamUrl(q.streamUrl, session.post.originalUrl || session.post.videoUrl),
      height: q.height,
    }));
    const selectedOpt = snap.selectedQuality !== undefined && snap.selectedQuality !== 'auto'
      ? qualities.find(q => q.height === snap.selectedQuality)
      : undefined;
    const rawFallbackUrl = selectedOpt?.streamUrl || session.post.videoUrl || session.post.originalUrl || '';
    const resolvedStreamUrl = isWatchPageOnlyUrl(rawFallbackUrl) && qualities.length > 0
      ? qualities[0].streamUrl
      : buildTimelineStreamUrl(rawFallbackUrl, session.post.originalUrl || session.post.videoUrl);
    if (!resolvedStreamUrl) return;
    const playerBox = playerRef.current?.getBoundingClientRect();
    if (playerBox && playerBox.width > 0 && playerBox.height > 0) {
      usePersistentPlayerStore.getState().setPendingFlipRect({
        left: playerBox.left,
        top: playerBox.top,
        width: playerBox.width,
        height: playerBox.height,
        capturedAt: Date.now(),
      });
    }
    useMiniPlayerStore.getState().openMiniPlayer({
      source: {
        id: session.post.id,
        sourceType: 'timeline',
        title: data?.title || session.post.title || (isEn ? 'Untitled video' : 'Vídeo sem título'),
        creatorName: creatorName || session.post.creatorName,
        streamUrl: resolvedStreamUrl,
        originalUrl: sourceUrl || session.post.originalUrl || session.post.videoUrl,
        sourceUrl: sourceUrl || session.post.originalUrl || session.post.videoUrl,
        referer: sourceUrl || session.post.originalUrl || session.post.videoUrl,
        posterUrl: session.post.thumbnail,
        thumbnailUrl: session.post.thumbnail,
        qualities,
        masterHlsUrl: snap.masterHlsUrl,
        source: session.post.source,
        youtubeId: session.post.youtubeId,
        isWatchPageOnly: isWatchPageOnlyUrl(session.post.videoUrl),
        rawPost: session.post,
        returnRoute: {
          view: 'timeline-preview',
        },
        originContext: {
          surface: 'timeline-watch',
          postId: session.post.id,
          creatorName: creatorName || session.post.creatorName,
          creatorAvatar: resolvedCreatorAvatar || session.post.creatorAvatar,
          creatorUrl: creatorUrl || session.authorUrl,
          routeHash: typeof window !== 'undefined' ? window.location.hash : '#/timeline-preview',
        },
      },
      handoff: {
        currentTime: snap.currentTime,
        isMuted: snap.isMuted,
        isPlaying: snap.isPlaying,
        volume: snap.volume,
        playbackRate: snap.playbackRate,
        selectedQuality: snap.selectedQuality,
        qualities,
        masterHlsUrl: snap.masterHlsUrl,
      },
    });
    useMiniPlayerStore.getState().setActiveWatchVideoId(null);
    onClose();
  }, [creatorName, creatorUrl, data?.title, effectiveHandoff, isEn, onClose, resolvedCreatorAvatar, session.authorUrl, session.post, sourceUrl]);
  const retryFailedRequests = () => {
    if (activeRelated?.error || !activeRelated) setRelated(null);
    if (activeDetails?.error || !activeDetails) setDetails(null);
    setAttempt(value => value + 1);
  };
  const retry = <button type="button" onClick={retryFailedRequests} className="py-2 text-xs font-semibold text-[var(--tl-accent-text)] underline">{isEn ? 'Try again' : 'Tentar novamente'}</button>;
  const relatedContent = (
    <aside className="min-w-0 space-y-3" aria-label={isEn ? 'Related videos' : 'Vídeos relacionados'}>
        <h3 className={wide ? 'text-sm font-bold text-[var(--tl-text-primary)]' : 'sr-only'}>{isEn ? 'Related videos' : 'Vídeos relacionados'}</h3>
        {!sourceUrl ? <p className="text-xs text-[var(--tl-text-muted)]">{isEn ? 'The original video URL is unavailable.' : 'A URL original do vídeo não está disponível.'}</p> : !activeRelated ? <p role="status" className="text-xs text-[var(--tl-text-muted)]">{isEn ? 'Loading related videos…' : 'Carregando vídeos relacionados…'}</p> : activeRelated.error ? <div role="alert" className="text-xs text-[var(--tl-text-muted)]"><p>{isEn ? 'Could not load related videos.' : 'Não foi possível carregar os vídeos relacionados.'}</p>{retry}</div> : activeRelated.data?.status === 'unsupported' ? <p className="text-xs text-[var(--tl-text-muted)]">{isEn ? 'Related videos are not supported for this source.' : 'Vídeos relacionados não são suportados nesta origem.'}</p> : activeRelated.data?.videos.length === 0 ? <p className="text-xs text-[var(--tl-text-muted)]">{isEn ? 'No related videos were confirmed by the source.' : 'Nenhum vídeo relacionado foi confirmado pela origem.'}</p> : activeRelated.data?.videos.map(video => <button key={video.id} type="button" onClick={event => openRelated(video, timelinePlaybackRect(event.currentTarget.querySelector('img') || event.currentTarget))} className={`group/rel w-full text-left flex gap-3 rounded-xl p-2 bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-accent-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]${disableMotion ? '' : ' cute-card-lift'}`}>
          <span className="relative w-36 sm:w-40 shrink-0 aspect-video rounded-lg bg-[var(--tl-surface-elevated)] overflow-hidden">{video.thumbnail_url && <img key={video.thumbnail_url} src={video.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className={`w-full h-full object-cover${disableMotion ? '' : ' transition-transform duration-300 group-hover/rel:scale-105'}`} onError={(e) => handleProxiedImageError(e, {rawUrl: video.thumbnail_url, referer: video.source_url, hideOnExhausted: true})}/>}{video.duration && <span className="absolute right-1 bottom-1 bg-black/80 px-1 rounded text-[10px] text-white font-mono">{video.duration}</span>}</span>
          <span className="min-w-0 space-y-1"><span className="block text-xs font-bold text-[var(--tl-text-primary)] line-clamp-2 leading-snug">{video.title || (isEn ? 'Untitled video' : 'Vídeo sem título')}</span>{video.author_name && <span className="block text-[10px] text-[var(--tl-text-muted)]">{video.author_name}</span>}</span>
        </button>)}
        {activeRelated?.data?.status === 'ready' && !activeRelated.data.complete && <p className="text-[10px] text-[var(--tl-text-muted)]">{isEn ? 'Related videos provided by the source; more may be available there.' : 'Vídeos relacionados fornecidos pela origem; pode haver mais no site.'}</p>}
      </aside>
  );
  return <section ref={watchContainerRef} data-timeline-watch data-watch-loading={!!sourceUrl && (!activeRelated || !activeDetails)} className="w-full max-w-full min-w-0 text-[var(--tl-text-primary)] space-y-4">
    <button ref={backRef} type="button" onClick={onClose} className={`group/back mx-2 sm:mx-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]${disableMotion ? '' : ' cute-press'}`}><ArrowLeft className={`w-4 h-4${disableMotion ? '' : ' cute-nudge-left'}`}/>{isEn ? 'Back' : 'Voltar'}</button>
    <div className="grid gap-x-5 gap-y-4 items-stretch min-w-0" style={{gridTemplateColumns:(wide && !isTheater) ? 'minmax(0,1fr) minmax(16rem,22rem)' : 'minmax(0,1fr)'}}>
      {/* Independent desktop flow avoids sidebar height stretching the player track.
          On mobile, contents keeps both panels inside the sticky player's containing grid. */}
      <div className={wide ? 'min-w-0 space-y-4' : 'min-w-0'} style={{display:(wide && !isTheater) ? 'block' : 'contents'}}>
        <div ref={playerRef} style={{top:'var(--timeline-watch-top, 0px)'}} className="sticky self-start z-20 min-w-0 bg-[var(--tl-bg)]" data-watch-sticky-player>
          {active && <TimelinePostCard registerPlaybackSnapshot={handleRegisterPlaybackSnapshot} key={`${session.post.id}:${sourceUrl}`} post={session.post} watchPresentation playbackHandoff={effectiveHandoff} isTheater={isTheater} onToggleTheater={toggleTheaterWithMotion} onMinimizeToMiniPlayer={handleMinimizeToMiniPlayer} onOpenProfile={() => {}} onOpenComments={() => selectSection('comments')} onOpenLightbox={() => {}}/>}
        </div>
        <div className="min-w-0 space-y-4 px-3.5 sm:px-0">
          <h2 className="text-lg sm:text-xl font-bold text-[var(--tl-text-primary)] leading-snug break-words">{data?.title || session.post.title || (isEn ? 'Untitled video' : 'Vídeo sem título')}</h2>
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div data-watch-creator className="flex items-center gap-3 min-w-0 flex-1">
              {creatorUrl ? <button type="button" onClick={() => onOpenCreator(creatorUrl, {name: creatorName, avatar: resolvedCreatorAvatar})} aria-label={isEn ? `Open ${creatorName}'s profile in Timeline` : `Abrir perfil de ${creatorName} na timeline`} className={`shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]${disableMotion ? '' : ' cute-press'}`}>{creatorImage}</button> : creatorImage}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-sm font-semibold text-[var(--tl-text-primary)] truncate min-w-0">{creatorUrl ? <button type="button" onClick={() => onOpenCreator(creatorUrl, {name: creatorName, avatar: resolvedCreatorAvatar})} aria-label={isEn ? `Open ${creatorName}'s profile in Timeline` : `Abrir perfil de ${creatorName} na timeline`} className="inline-flex items-center gap-1.5 text-left hover:text-[var(--tl-accent-text)] rounded max-w-full truncate focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]">{creatorName}</button> : <span className="truncate">{creatorName}</span>}</div>
                <p data-watch-creator-audience className="text-xs text-[var(--tl-text-muted)] truncate" role={sourceUrl && !activeDetails ? 'status' : undefined}>{creatorAudience}</p>
                {activeDetails?.error && <div>{retry}</div>}
              </div>
            </div>
            <button
              type="button"
              data-watch-follow
              disabled={!followTarget}
              onClick={handleToggleFollow}
              aria-pressed={isFollowing}
              aria-label={!followTarget ? (isEn ? 'Waiting for creator identity from source' : 'Aguardando identificação do criador na origem') : isFollowing ? (isEn ? 'Following' : 'Seguindo') : (isEn ? 'Follow' : 'Seguir')}
              title={!followTarget ? (isEn ? 'Waiting for creator identity from source' : 'Aguardando identificação do criador na origem') : isFollowing ? (isEn ? 'Following' : 'Seguindo') : (isEn ? 'Follow' : 'Seguir')}
              className={`shrink-0 inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-bold smooth-transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${
                disableMotion ? '' : 'cute-press '
              }${
                !followTarget
                  ? 'bg-[var(--tl-surface-elevated)] text-[var(--tl-text-muted)] border border-[var(--tl-border)] cursor-not-allowed opacity-60'
                  : isFollowing
                    ? 'bg-[var(--tl-accent-soft)] text-[var(--tl-accent-text-strong)] border border-[var(--tl-accent-border)] hover:bg-[var(--tl-accent-soft-hover)]'
                    : 'bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] hover:bg-[var(--tl-accent-hover)] shadow-sm'
              }`}
            >
              <span
                key={followPulseKey > 0 ? `follow-${followPulseKey}` : 'follow-idle'}
                className={`inline-flex items-center gap-1.5 ${
                  followPulseKey > 0 && isFollowing && !disableMotion ? 'follow-spring' : ''
                }`}
              >
                {isFollowing ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />}
                <span>{isFollowing ? (isEn ? 'Following' : 'Seguindo') : (isEn ? 'Follow' : 'Seguir')}</span>
              </span>
            </button>
          </div>
          <WatchArtistsRow
            artists={data?.artists || []}
            sourceUrl={sourceUrl}
            creatorIdentity={creatorIdentity}
            followedProfileIdentities={followedProfileIdentities}
            isEn={isEn}
            disableMotion={disableMotion}
            onOpenArtist={(artist: WatchVideoArtist) => {
              const resolvedArtistAvatar =
                artist.avatar_url || useProfileAvatarStore.getState().getAvatarEntry(artist.url)?.avatarUrl || null;
              onOpenCreator(artist.url, {name: artist.name, avatar: resolvedArtistAvatar});
            }}
          />
          <div
            ref={toolbarRef}
            data-watch-reaction-box
            role="toolbar"
            aria-label={isEn ? 'Video actions' : 'Ações do vídeo'}
            {...({ focusgroup: 'toolbar' } as Record<string, string>)}
            onKeyDown={handleToolbarKeyDown}
            onFocusCapture={handleToolbarFocusCapture}
            className="watch-swipe-row flex flex-nowrap items-center gap-2 min-w-0 overflow-x-auto py-1.5 px-0.5"
          >
            <div
              role="group"
              aria-label={isEn ? 'Reactions' : 'Reações'}
              className={`inline-flex items-center shrink-0 rounded-full border smooth-transition ${
                isPostLiked
                  ? 'bg-rose-500/15 border-rose-500/45 text-rose-200'
                  : 'bg-[var(--tl-surface)] border-[var(--tl-border)] text-[var(--tl-text-primary)] hover:border-rose-400/35'
              }`}
            >
              <button
                type="button"
                data-watch-like
                onClick={handleToggleLike}
                aria-pressed={isPostLiked}
                aria-label={isPostLiked ? (isEn ? 'Remove local like mark' : 'Remover marcação local de curtida') : (isEn ? 'Mark as liked on this device' : 'Marcar curtida neste dispositivo')}
                title={isPostLiked ? (isEn ? 'Remove local like mark' : 'Remover marcação local de curtida') : (isEn ? 'Mark as liked on this device' : 'Marcar curtida neste dispositivo')}
                className={`relative h-[36px] inline-flex items-center gap-1.5 ${
                  data?.like_count != null ? 'px-3' : 'w-[38px] justify-center'
                } text-xs font-semibold smooth-transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${
                  disableMotion ? '' : 'cute-press '
                }${
                  data?.reaction_kind === 'like_dislike' ? 'rounded-l-full ' : 'rounded-full '
                }${
                  isPostLiked ? 'text-rose-300' : 'text-[var(--tl-text-secondary)] hover:text-rose-300'
                }`}
              >
                {likePulseKey > 0 && isPostLiked && !disableMotion && (
                  <span
                    key={`like-halo-${likePulseKey}`}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full border border-rose-400/70 cute-halo-pulse"
                  />
                )}
                <Heart
                  key={likePulseKey > 0 && isPostLiked ? `heart-${likePulseKey}` : 'heart-idle'}
                  className={`w-4 h-4 shrink-0 ${
                    isPostLiked
                      ? `fill-rose-500 text-rose-500${likePulseKey > 0 && !disableMotion ? ' heart-pop' : ''}`
                      : ''
                  }`}
                  aria-hidden="true"
                />
                {data?.like_count != null && (
                  <span
                    data-source-like-count
                    title={isEn ? 'Source likes (read-only)' : 'Curtidas na origem (somente leitura)'}
                    className="font-mono text-[11px] font-semibold tabular-nums"
                  >
                    {data.like_count}
                  </span>
                )}
              </button>
              {data?.reaction_kind === 'like_dislike' && (
                <>
                  <span role="separator" aria-orientation="vertical" className="w-px h-4 bg-[var(--tl-border)] shrink-0" />
                  <span
                    aria-label={data.dislike_count != null ? (isEn ? `Source dislikes: ${data.dislike_count}` : `Descurtidas na origem: ${data.dislike_count}`) : (isEn ? 'Source dislikes unavailable' : 'Descurtidas indisponíveis na origem')}
                    title={data.dislike_count != null ? (isEn ? `Source dislikes: ${data.dislike_count}` : `Descurtidas na origem: ${data.dislike_count}`) : (isEn ? 'Source dislikes unavailable' : 'Descurtidas indisponíveis na origem')}
                    className="h-[36px] inline-flex items-center gap-1 px-2.5 text-xs text-[var(--tl-text-secondary)] rounded-r-full shrink-0"
                  >
                    <ThumbsDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    {data.dislike_count != null && (
                      <span className="font-mono text-[11px] tabular-nums">{data.dislike_count}</span>
                    )}
                  </span>
                </>
              )}
            </div>
            <div
              role="group"
              aria-label={isEn ? 'Post actions' : 'Ações do vídeo'}
              className="flex items-center gap-2 shrink-0"
            >
              <button
                type="button"
                data-watch-favorite
                onClick={handleToggleFavorite}
                aria-pressed={isPostFavorited}
                aria-label={isPostFavorited ? (isEn ? 'Remove from favorites' : 'Remover dos favoritos') : (isEn ? 'Favorite post' : 'Favoritar post')}
                title={isPostFavorited ? (isEn ? 'Remove from favorites' : 'Remover dos favoritos') : (isEn ? 'Favorite post' : 'Favoritar post')}
                className={`relative w-[38px] h-[38px] inline-flex items-center justify-center rounded-full border smooth-transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${
                  disableMotion ? '' : 'cute-icon-btn '
                }${
                  isPostFavorited
                    ? 'bg-[var(--tl-accent-soft)] border-[var(--tl-accent-border)] text-[var(--tl-accent-text)]'
                    : 'bg-[var(--tl-surface)] border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-accent-text)] hover:border-[var(--tl-accent-border)]'
                }`}
              >
                {favoritePulseKey > 0 && isPostFavorited && !disableMotion && (
                  <span
                    key={`fav-halo-${favoritePulseKey}`}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full border border-[var(--tl-accent-hover)] cute-halo-pulse"
                  />
                )}
                <Bookmark
                  key={favoritePulseKey > 0 && isPostFavorited ? `fav-${favoritePulseKey}` : 'fav-idle'}
                  className={`w-4 h-4 ${
                    isPostFavorited
                      ? `fill-current text-[var(--tl-accent-text)]${favoritePulseKey > 0 && !disableMotion ? ' bookmark-boing' : ''}`
                      : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
              {watchLibraryItem && (
                <button
                  type="button"
                  data-watch-playlist
                  aria-label={isEn ? 'Add to playlist' : 'Adicionar à playlist'}
                  title={isEn ? 'Add to playlist' : 'Adicionar à playlist'}
                  onClick={handleOpenPlaylist}
                  className={`relative w-[38px] h-[38px] inline-flex items-center justify-center rounded-full bg-[var(--tl-surface)] border border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-accent-text)] hover:border-[var(--tl-accent-border)] smooth-transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${
                    disableMotion ? '' : 'cute-icon-btn'
                  }`}
                >
                  <ListPlus
                    key={playlistPulseKey > 0 ? `pl-${playlistPulseKey}` : 'pl-idle'}
                    className={`w-4 h-4 ${disableMotion ? '' : playlistPulseKey > 0 ? 'bookmark-boing cute-tilt-hop' : 'cute-tilt-hop'}`}
                    aria-hidden="true"
                  />
                </button>
              )}
              {sourceUrl && (
                <button
                  type="button"
                  data-watch-share
                  aria-label={shareCopied ? (isEn ? 'Link copied' : 'Link copiado') : (isEn ? 'Share' : 'Compartilhar')}
                  title={shareCopied ? (isEn ? 'Link copied' : 'Link copiado') : (isEn ? 'Share' : 'Compartilhar')}
                  onClick={handleShareVideo}
                  className={`relative w-[38px] h-[38px] inline-flex items-center justify-center rounded-full border smooth-transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${
                    disableMotion ? '' : 'cute-icon-btn '
                  }${
                    shareCopied
                      ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-300'
                      : 'bg-[var(--tl-surface)] border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:border-[var(--tl-border-strong)]'
                  }`}
                >
                  {shareCopied
                    ? <Check className={`w-4 h-4 ${disableMotion ? '' : 'follow-spring'}`} aria-hidden="true" />
                    : <Share2 className="w-4 h-4" aria-hidden="true" />}
                </button>
              )}
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={isEn ? 'Open original source' : 'Abrir no site original'}
                  title={isEn ? 'Open original source' : 'Abrir no site original'}
                  className={`relative w-[38px] h-[38px] inline-flex items-center justify-center rounded-full bg-[var(--tl-surface)] border border-[var(--tl-border)] text-[var(--tl-accent-text)] hover:text-[var(--tl-text-primary)] hover:border-[var(--tl-accent-border)] smooth-transition shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${
                    disableMotion ? '' : 'cute-icon-btn'
                  }`}
                >
                  <ExternalLink className={`w-4 h-4 ${disableMotion ? '' : 'cute-nudge-ne'}`} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
          <div data-watch-about className="rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-accent-border)] smooth-transition overflow-hidden">
            <button
              type="button"
              data-watch-about-toggle
              aria-expanded={aboutExpanded}
              aria-controls={aboutPanelId}
              onClick={() => setAboutExpanded(previous => !previous)}
              className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--tl-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"
            >
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--tl-text-primary)] shrink-0">{isEn ? 'About' : 'Sobre'}</span>
                {!aboutExpanded && <span className="text-xs text-[var(--tl-text-muted)] truncate min-w-0">{descriptionText}</span>}
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--tl-accent-text)]">
                <span>{aboutExpanded ? (isEn ? 'Show less' : 'Mostrar menos') : (isEn ? 'Show more' : 'Mostrar mais')}</span>
                <ChevronDown className={`w-3.5 h-3.5 ${disableMotion ? '' : 'transition-transform duration-300 '}${aboutExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
              </span>
            </button>
            <div id={aboutPanelId} className="watch-about-accordion" data-expanded={aboutExpanded} aria-hidden={!aboutExpanded}>
              <div className="watch-about-accordion-inner">
                <div className="px-3.5 pb-3.5 pt-1 border-t border-[var(--tl-border)] text-xs text-[var(--tl-text-secondary)] whitespace-pre-wrap break-words leading-relaxed space-y-2">
                  <p>{descriptionText}</p>
                  {activeDetails?.error && <div>{retry}</div>}
                </div>
              </div>
            </div>
          </div>
          <div hidden={!!wide} data-watch-section-controls className={`${wide ? 'hidden' : 'flex'} items-center gap-2 border-b border-[var(--tl-border)] pb-1 overflow-x-auto no-scrollbar`}>
            {(['related','comments'] as const).map(value => <button key={value} type="button" data-watch-section={value} aria-pressed={activeSection === value} aria-controls={`${panelId}-${value}`} onClick={() => selectSection(value)} className={`flex items-center gap-2 py-2 px-3 border-b-2 font-bold text-xs whitespace-nowrap transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${disableMotion ? '' : 'cute-press '}${activeSection === value ? 'border-[var(--tl-accent)] text-[var(--tl-accent-text)]' : 'border-transparent text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'}`}>
              {value === 'related' ? (isEn ? 'Related videos' : 'Vídeos relacionados') : (isEn ? 'Comments' : 'Comentários')}
              {value === 'comments' && commentTotal.source === sourceUrl && commentTotal.total !== null && <span className={`px-1.5 rounded-full text-[10px] font-mono ${disableMotion ? '' : 'cute-badge-pop '}${activeSection === value ? 'bg-[var(--tl-accent-soft)] text-[var(--tl-accent-text-strong)]' : 'bg-[var(--tl-surface-elevated)] text-[var(--tl-text-muted)]'}`}>{commentTotal.total}</span>}
            </button>)}
          </div>
        </div>
        <div ref={commentsRef} id={`${panelId}-comments`} data-watch-comments-panel hidden={!wide && activeSection !== 'comments'} className={`min-w-0 max-w-full rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border)] p-3.5${!wide && activeSection === 'comments' && !disableMotion ? ' watch-panel-reveal' : ''}`}>{sourceUrl ? <SourceComments suspended={!active} sourceUrl={sourceUrl} active={active && (!!wide || activeSection === 'comments')} onReportedTotal={total => setCommentTotal({source:sourceUrl,total})}/> : <p className="text-xs text-[var(--tl-text-muted)]">{isEn ? 'The original video URL is unavailable.' : 'A URL original do vídeo não está disponível.'}</p>}</div>
      </div>
        <div ref={relatedRef} id={`${panelId}-related`} data-watch-related-panel hidden={!wide && activeSection !== 'related'} className={`min-w-0 max-w-full${!wide && activeSection === 'related' && !disableMotion ? ' watch-panel-reveal' : ''}`}>{relatedContent}</div>
    </div>
  </section>;
};
