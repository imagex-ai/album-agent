import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { 
  Sparkles, 
  Clock, 
  Loader2, 
  RefreshCw,
  Compass,
  ChevronLeft,
  Heart
} from 'lucide-react';
import { TimelineStoriesBar } from './TimelineStoriesBar';
import { TimelinePlaybackHandoff, TimelinePostCard } from './TimelinePostCard';
import { AdaptiveProfileHeader } from './AdaptiveProfileHeader';
import { AdaptiveProfileContent } from './AdaptiveProfileContent';
import { TimelineWatchSession, TimelineWatchView } from './TimelineWatchView';
import { createTimelineWatchHistory } from '../../../services/timelineWatchHistory';
import { loadTimelineCreatorProfile, TimelineCreatorProfileSnapshot } from '../../../services/timelineCreatorProfile';
import { engagementSourceUrl } from '../../../services/profileHubEngagement';
import {
  TimelineCreator,
  TimelinePost,
  TIMELINE_BACKGROUND_POLL_MS,
  doesPostMatchCreator,
  findUndiscoveredCreatorIds,
  shouldAutoRefreshTimeline,
  sortTimelinePostsByPublication,
} from './timelineModel';
import { CommentsBottomSheet } from './CommentsBottomSheet';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { useShallow } from 'zustand/react/shallow';
import { CreatorWatchReturnTarget, useProfileTimelineStore } from '../../../store/useProfileTimelineStore';
import { useProfileHubLibraryStore } from '../../../store/useProfileHubLibraryStore';
import { useMiniPlayerStore } from '../../../store/useMiniPlayerStore';
import { usePersistentPlayerStore } from '../../../store/usePersistentPlayerStore';
import { rankForYouPosts } from '../../../services/timelineRecommendation';
import { useAppStore } from '../../../store/useAppStore';

interface ProfileTimelineViewProps {
  active?: boolean;
  isMobileOnly?: boolean;
  onWatchOpenChange?: (open: boolean) => void;
}

type CreatorSnapshot = TimelineCreatorProfileSnapshot;
type CreatorSeed = {name?: string; avatar?: string | null};
type CreatorEntry = {url: string; snapshot?: CreatorSnapshot; scroll: number; activeTab: string; error?: boolean; seed?: CreatorSeed; returnTo?: CreatorWatchReturnTarget | null};
const TIMELINE_CREATOR_HISTORY_KEY = 'imagexTimelineCreator';
type WatchEntry = {session: TimelineWatchSession; scroll: number; section: 'comments' | 'related'};
// UI cache retains the active viewer and one neighbor in each direction. History is not truncated.
const WATCH_UI_NEIGHBOR_RADIUS = 1;
// Bound layout restoration to the player startup window; a quiet completed/error layout
// gets one second for its final render/observer delivery before accepting a clamped target.
const WATCH_SCROLL_RESTORE_MAX_WAIT_MS = 20_000;
const WATCH_SCROLL_LAYOUT_SETTLE_MS = 1_000;
const WATCH_SCROLL_PIXEL_TOLERANCE = 1;
// One extra viewport absorbs normal scrolling without mounting the whole catalog.
const FEED_BUFFER_VIEWPORTS = 1;
// SSR / an unmeasured or hidden layout starts with one card, then uses real geometry.
const FEED_UNMEASURED_CARD_COUNT = 1;

export const ProfileTimelineView: React.FC<ProfileTimelineViewProps> = ({
  active = true,
  isMobileOnly = false,
  onWatchOpenChange,
}) => {
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastRefreshAtRef = useRef<number | null>(null);
  const isRefreshingFeedRef = useRef(false);
  const isEn = useAppStore(state => state.settings?.language === 'en-US');
  const disableAllAnimations = useAppStore(state => state.settings?.disableAllAnimations);

  const {
    history: libraryHistory,
    liked: libraryLiked,
    favorites: libraryFavorites,
    playlists: libraryPlaylists,
    hydrateLibrary,
  } = useProfileHubLibraryStore(
    useShallow((state) => ({
      history: state.history,
      liked: state.liked,
      favorites: state.favorites,
      playlists: state.playlists,
      hydrateLibrary: state.hydrateLibrary,
    }))
  );

  useEffect(() => {
    if (active) {
      void hydrateLibrary();
      void useAppStore.getState().syncVideos();
    }
  }, [active, hydrateLibrary]);

  const {
    creators,
    creatorProfiles,
    posts,
    likedPostIds,
    favoritedPostIds,
    savedPostIds,
    isLoading,
    error,
    activeFilter,
    searchQuery,
    selectedCreatorId,
    activeCommentsPostId,
    activeAutoplayPostId,
    lightbox,
    pendingCreatorProfileUrl,
    pendingCreatorSeed,
    pendingCreatorReturn,
    setPendingCreatorProfileUrl,
    setPendingLibraryWatchRestore,
    refreshTimeline,
    refreshMissingCreators,
    discoverCreatorCatalog,
    isDiscoveringCreator,
    creatorRefreshErrors,
    creatorRefreshedAt,
    setActiveFilter,
    setSelectedCreatorId,
    setActiveAutoplayPostId,
    openComments,
    closeComments,
    openLightbox,
    closeLightbox,
    nextLightboxImage,
    prevLightboxImage
  } = useProfileTimelineStore();
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const feedListRef = useRef<HTMLDivElement | null>(null);
  const feedSentinelRef = useRef<HTMLDivElement | null>(null);
  const [feedWindow, setFeedWindow] = useState({key: '', count: FEED_UNMEASURED_CARD_COUNT});
  const [feedPageSize, setFeedPageSize] = useState(FEED_UNMEASURED_CARD_COUNT);
  const pinnedFeedPostRef = useRef<string | null>(null);
  const mountedFeedPostIdsRef = useRef(new Set<string>());
  const pendingFeedFocusRef = useRef<string | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const [isRefreshingTimeline, setIsRefreshingTimeline] = useState(false);
  const refreshFeed = useCallback(async (signal?: AbortSignal) => {
    if (!activeRef.current || signal?.aborted || isRefreshingFeedRef.current) return;
    isRefreshingFeedRef.current = true;
    setIsRefreshingTimeline(true);
    try {
      await refreshTimeline(signal);
      if (!signal?.aborted) lastRefreshAtRef.current = Date.now();
    } finally {
      isRefreshingFeedRef.current = false;
      if (!signal?.aborted) setIsRefreshingTimeline(false);
    }
  }, [refreshTimeline]);
  const feedScrollRef = useRef(0);
  const [watchSession, setWatchSession] = useState<TimelineWatchSession | null>(null);
  const watchRef = useRef<TimelineWatchSession | null>(null);
  watchRef.current = watchSession;
  const historyRef = useRef<ReturnType<typeof createTimelineWatchHistory<WatchEntry>> | null>(null);
  if (!historyRef.current) historyRef.current = createTimelineWatchHistory<WatchEntry>({
    location: () => window.location.href, state: () => window.history.state,
    push: (state, url) => {const next = {...state}; delete next[TIMELINE_CREATOR_HISTORY_KEY]; window.history.pushState(next, '', url);}, back: () => window.history.back(),
    token: () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  });
  const watchHistory = historyRef.current;
  const creatorHistoryRef = useRef<ReturnType<typeof createTimelineWatchHistory<CreatorEntry>> | null>(null);
  if (!creatorHistoryRef.current) creatorHistoryRef.current = createTimelineWatchHistory<CreatorEntry>({
    stateKey: TIMELINE_CREATOR_HISTORY_KEY,
    retainKnownEntries: true,
    location: () => window.location.href, state: () => window.history.state,
    push: (state, url) => window.history.pushState(state, '', url), back: () => window.history.back(),
    token: () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  });
  const creatorHistory = creatorHistoryRef.current;
  const [creatorEntry, setCreatorEntry] = useState<{token:string;value:CreatorEntry} | null>(null);
  const [creatorEntries, setCreatorEntries] = useState(creatorHistory.entries);
  const creatorEntryRef = useRef(creatorEntry);
  creatorEntryRef.current = creatorEntry;
  const creatorCacheRef = useRef(new Map<string, CreatorSnapshot>());
  const settledCreatorTokensRef = useRef(new Set<string>());
  const completedCreatorTokensRef = useRef(new Set<string>());
  const creatorRequestRef = useRef<AbortController | null>(null);
  const [creatorLoading, setCreatorLoading] = useState(false);
  const [creatorAttempt, setCreatorAttempt] = useState(0);
  const pendingCreatorScrollRef = useRef<number | null>(null);
  const snapshotCreator = useCallback(() => {
    const entry = creatorEntryRef.current;
    if (!activeRef.current || !entry || creatorHistory.current()?.token !== entry.token) return;
    const value = {...entry.value, scroll:timelineRef.current?.closest('main')?.scrollTop ?? entry.value.scroll};
    creatorHistory.save(value);
    creatorEntryRef.current = {...entry, value};
  }, [creatorHistory]);
  const [watchEntries, setWatchEntries] = useState(watchHistory.entries);
  const [activeWatchToken, setActiveWatchToken] = useState<string | null>(null);
  const playerSnapshotRef = useRef<(() => TimelinePlaybackHandoff) | null>(null);
  const sectionSnapshotRef = useRef<'comments'|'related'>('related');
  const watchClosingRef = useRef(false);
  const watchSuspendedRef = useRef(false);
  const restoreWatchReturnRef = useRef(false);
  const pendingWatchScrollRef = useRef<number | null>(null);
  useEffect(() => { onWatchOpenChange?.(!!watchSession && !creatorEntry); }, [!!watchSession, !!creatorEntry, onWatchOpenChange]);
  useEffect(() => () => onWatchOpenChange?.(false), [onWatchOpenChange]);
  const watchReturnRef = useRef<{scroll: number; trigger: HTMLElement | null}>({scroll:0, trigger:null});
  const snapshotWatch = useCallback(() => {
    const entry = watchHistory.current();
    if (!activeRef.current || creatorEntryRef.current || watchSuspendedRef.current || !entry) return;
    const handoff = playerSnapshotRef.current?.() || entry.value.session.handoff;
    watchHistory.save({session:{...entry.value.session, handoff}, scroll:pendingWatchScrollRef.current ?? timelineRef.current?.closest('main')?.scrollTop ?? 0, section:sectionSnapshotRef.current});
  }, [watchHistory]);
  const openWatchCreator = (sourceUrl: string, seed?: CreatorSeed, returnTo?: CreatorWatchReturnTarget | null) => {
    if (!activeRef.current) return;
    const url = engagementSourceUrl(sourceUrl);
    if (!url) return;
    snapshotWatch(); snapshotCreator();
    try {
      const known = Object.values(creatorProfiles).find(creator => engagementSourceUrl(creator.profileUrl) === url);
      const cached = creatorCacheRef.current.get(url) || (known ? {creator:known,posts:posts.filter(post => doesPostMatchCreator(post, known))} : undefined);
      const entry = creatorHistory.open({url, snapshot:cached, scroll:0, activeTab:'timeline', seed, returnTo});
      creatorRequestRef.current?.abort();
      watchSuspendedRef.current = true;
      setWatchEntries(watchHistory.entries());
      setCreatorEntries(creatorHistory.entries());
      setCreatorEntry(entry); creatorEntryRef.current = entry;
      pendingCreatorScrollRef.current = 0;
      setActiveAutoplayPostId(null); closeComments();
    } catch {
      const app = useAppStore.getState();
      const english = app.settings.language === 'en-US';
      app.addNotification({type:'error', title:english ? 'Could not open profile' : 'Não foi possível abrir o perfil', message:english ? 'The profile could not be added to navigation history. Try again.' : 'Não foi possível adicionar o perfil ao histórico de navegação. Tente novamente.'});
    }
  };
  const closeCreator = () => {
    const activeEntry = creatorEntryRef.current;
    if (creatorHistory.entries().length <= 1 && activeEntry?.value.returnTo) {
      const returnTarget = activeEntry.value.returnTo;
      if (returnTarget.watchSession) {
        setPendingLibraryWatchRestore(returnTarget);
      }
      settledCreatorTokensRef.current.clear();
      completedCreatorTokensRef.current.clear();
      creatorHistory.clear();
      creatorRequestRef.current?.abort();
      creatorEntryRef.current = null;
      setCreatorEntry(null);
      setCreatorEntries([]);
      useAppStore.getState().navigateToView(returnTarget.viewId);
      return;
    }
    snapshotCreator();
    creatorHistory.back();
  };
  useEffect(() => {
    if (!active || !pendingCreatorProfileUrl) return;
    const targetUrl = pendingCreatorProfileUrl;
    const targetSeed = pendingCreatorSeed || undefined;
    const targetReturn = pendingCreatorReturn || null;
    setPendingCreatorProfileUrl(null);
    openWatchCreator(targetUrl, targetSeed, targetReturn);
  }, [active, pendingCreatorProfileUrl, pendingCreatorSeed, pendingCreatorReturn, setPendingCreatorProfileUrl]);
  useEffect(() => {
    if (!active || !creatorEntry) { creatorRequestRef.current?.abort(); setCreatorLoading(false); return; }
    if (completedCreatorTokensRef.current.has(creatorEntry.token) || settledCreatorTokensRef.current.has(creatorEntry.token)) {setCreatorLoading(false); return;}
    const controller = new AbortController();
    creatorRequestRef.current = controller;
    const token = creatorEntry.token;
    const url = creatorEntry.value.url;
    setCreatorLoading(true);
    const apply = (snapshot: CreatorSnapshot, error = false) => {
      if (controller.signal.aborted || creatorRequestRef.current !== controller || creatorEntryRef.current?.token !== token) return;
      creatorCacheRef.current.set(url, snapshot);
      const value = {...creatorEntryRef.current.value,snapshot,error:error || !!snapshot.incomplete};
      creatorHistory.save(value);
      const next = {token,value}; creatorEntryRef.current = next; setCreatorEntry(next); setCreatorEntries(creatorHistory.entries());
    };
    const cached = creatorEntry.value.snapshot;
    const seed = creatorEntry.value.seed;
    void loadTimelineCreatorProfile({url, existingCreator:cached?.creator, expectedName:seed?.name, seedAvatar:seed?.avatar, existingPosts:cached?.posts || [], signal:controller.signal, onSnapshot:snapshot => apply(snapshot), unnamedLabel:''}).then(snapshot => {if (!controller.signal.aborted) {settledCreatorTokensRef.current.add(token); if (!snapshot.incomplete) completedCreatorTokensRef.current.add(token);} apply(snapshot);}).catch(() => {
      if (controller.signal.aborted || creatorRequestRef.current !== controller || creatorEntryRef.current?.token !== token) return;
      settledCreatorTokensRef.current.add(token);
      const next = {token,value:{...creatorEntryRef.current.value,error:true}};
      creatorHistory.save(next.value); creatorEntryRef.current = next; setCreatorEntry(next); setCreatorEntries(creatorHistory.entries());
    }).finally(() => {
      if (!controller.signal.aborted && creatorRequestRef.current === controller) setCreatorLoading(false);
    });
    return () => {controller.abort(); if (creatorRequestRef.current === controller) creatorRequestRef.current = null;};
  }, [active, creatorEntry?.token, creatorAttempt, creatorHistory]);
  useLayoutEffect(() => {
    if (!active || !creatorEntry || pendingCreatorScrollRef.current === null) return;
    const targetScroll = pendingCreatorScrollRef.current;
    const main = timelineRef.current?.closest('main');
    if (main) main.scrollTop = targetScroll;
    let rafId = 0;
    if (typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(() => {
        const container = timelineRef.current?.closest('main');
        if (container && activeRef.current && creatorEntryRef.current?.token === creatorEntry.token) {
          container.scrollTop = targetScroll;
        }
      });
    }
    if (creatorEntry.value.snapshot || creatorEntry.value.error) pendingCreatorScrollRef.current = null;
    return () => {
      if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
    };
  }, [active, creatorEntry]);
  useLayoutEffect(() => {
    if (!active || !creatorEntry) return;
    timelineRef.current?.querySelector<HTMLElement>('[data-creator-active="true"] button')?.focus({preventScroll:true});
  }, [active, creatorEntry?.token]);
  const openWatchSession = (session: TimelineWatchSession) => {
    if (!activeRef.current || watchClosingRef.current) return false;
    snapshotCreator(); snapshotWatch();
    let entry: ReturnType<typeof watchHistory.open>;
    try {
      entry = watchHistory.open({session, scroll:0, section:'related'});
    } catch {
      watchClosingRef.current = false;
      const app = useAppStore.getState();
      const english = app.settings.language === 'en-US';
      app.addNotification({type:'error', title:english ? 'Could not open video' : 'Não foi possível abrir o vídeo', message:english ? 'Your browser could not add this video to navigation history. Try again.' : 'O navegador não conseguiu adicionar este vídeo ao histórico de navegação. Tente novamente.'});
      return false;
    }
    if (!watchRef.current) watchReturnRef.current = {scroll:timelineRef.current?.closest('main')?.scrollTop ?? 0, trigger:document.activeElement instanceof HTMLElement ? document.activeElement : null};
    creatorRequestRef.current?.abort();
    creatorEntryRef.current = null; setCreatorEntry(null); watchSuspendedRef.current = false;
    sectionSnapshotRef.current = 'related';
    closeComments(); setActiveAutoplayPostId(null);
    watchRef.current = session;
    playerSnapshotRef.current = null;
    setWatchEntries(watchHistory.entries());
    setActiveWatchToken(entry.token); setWatchSession(session);
    pendingWatchScrollRef.current = 0;
    return true;
  };
  const openVideo = (post: TimelinePost, handoff: TimelinePlaybackHandoff) => openWatchSession({post, handoff, authorUrl:engagementSourceUrl(creatorEntryRef.current?.value.snapshot?.creator.profileUrl || creatorProfiles[post.creatorId]?.profileUrl) || undefined});
  const pendingExpandHandoff = useMiniPlayerStore(state => state.pendingExpandHandoff);
  const handledExpandAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !pendingExpandHandoff) return;
    if (handledExpandAtRef.current === pendingExpandHandoff.capturedAt) return;
    const { source, handoff: consumed } = pendingExpandHandoff;
    const originCtx = source.originContext as { surface?: string; creatorUrl?: string } | undefined;
    if (
      originCtx?.surface !== 'timeline-watch' &&
      source.returnRoute?.view !== 'timeline-preview' &&
      source.returnRoute?.view !== 'timeline'
    ) {
      return;
    }
    const targetPost =
      posts.find(p => p.id === source.id) ||
      ((source as unknown as { rawPost?: TimelinePost }).rawPost ?? null);
    if (!targetPost) return;
    handledExpandAtRef.current = pendingExpandHandoff.capturedAt;
    const flipRect = usePersistentPlayerStore.getState().consumePendingFlipRect();
    openWatchSession({
      post: targetPost,
      handoff: {
        currentTime: consumed.currentTime,
        sourceRect: flipRect
          ? { x: flipRect.left, y: flipRect.top, width: flipRect.width, height: flipRect.height }
          : (consumed.sourceRect ?? undefined),
        isMuted: Boolean(consumed.isMuted),
        isPlaying: consumed.isPlaying,
        volume: consumed.volume,
        playbackRate: consumed.playbackRate,
        selectedQuality: consumed.selectedQuality,
        qualities: consumed.qualities
          ? consumed.qualities
              .filter((q): q is { height: number; label: string; streamUrl: string } => Boolean(q.streamUrl))
              .map(q => ({ label: q.label, streamUrl: q.streamUrl, height: q.height }))
          : targetPost.qualities,
        masterHlsUrl: consumed.masterHlsUrl ?? targetPost.masterHlsUrl,
      },
      authorUrl:
        originCtx?.creatorUrl ||
        engagementSourceUrl(creatorProfiles[targetPost.creatorId]?.profileUrl) ||
        undefined,
    });
  }, [active, pendingExpandHandoff, posts, creatorProfiles]);
  const closeWatch = useCallback(() => {
    if (!watchRef.current || watchClosingRef.current) return;
    snapshotWatch();
    if (watchHistory.back()) { watchClosingRef.current = true; return; }
    restoreWatchReturnRef.current = true;
    watchRef.current = null; playerSnapshotRef.current = null;
    setActiveAutoplayPostId(null); setActiveWatchToken(null); setWatchSession(null);
  }, [setActiveAutoplayPostId, snapshotWatch, snapshotCreator, watchHistory, creatorHistory]);
  useLayoutEffect(() => {
    if (!active || creatorEntry) return;
    const container = timelineRef.current?.closest('main');
    if (watchSession && pendingWatchScrollRef.current !== null && container) {
      const target = pendingWatchScrollRef.current;
      const activeView = timelineRef.current?.querySelector<HTMLElement>('[data-watch-active="true"]');
      let stopped = false;
      let frame: number | null = null;
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      let resize: ResizeObserver | null = null;
      let mutations: MutationObserver | null = null;
      const stop = (clearTarget = true) => {
        stopped = true;
        if (clearTarget) pendingWatchScrollRef.current = null;
        if (frame !== null) cancelAnimationFrame(frame);
        if (quietTimer !== null) clearTimeout(quietTimer);
        if (deadline !== null) clearTimeout(deadline);
        resize?.disconnect(); mutations?.disconnect();
        container.removeEventListener('wheel', intent);
        container.removeEventListener('touchstart', intent);
        container.removeEventListener('touchmove', intent);
        container.removeEventListener('pointerdown', intent);
        window.removeEventListener('keydown', keyIntent);
      };
      const intent = () => stop();
      const keyIntent = (event: KeyboardEvent) => {
        if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)) stop();
      };
      const retry = () => {
        if (stopped) return;
        frame = null;
        container.scrollTop = target;
        if (Math.abs(container.scrollTop - target) <= WATCH_SCROLL_PIXEL_TOLERANCE) {stop(); return;}
        if (quietTimer !== null) clearTimeout(quietTimer);
        // Loaded comments may have fewer rows after cache eviction (collapsed replies),
        // or an origin can terminate/fail before the old height. Accept the available
        // position after the layout settles; restoration never dispatches page requests.
        if (!activeView?.querySelector('[aria-busy="true"], [data-watch-loading="true"]')) {
          quietTimer = setTimeout(() => stop(), WATCH_SCROLL_LAYOUT_SETTLE_MS);
        }
      };
      const changed = () => {
        if (!stopped && frame === null) frame = requestAnimationFrame(retry);
      };
      container.addEventListener('wheel', intent, {passive:true});
      container.addEventListener('touchstart', intent, {passive:true});
      container.addEventListener('touchmove', intent, {passive:true});
      container.addEventListener('pointerdown', intent, {passive:true});
      window.addEventListener('keydown', keyIntent, {passive:true});
      if (activeView && typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(changed); resize.observe(activeView);
      }
      if (activeView && typeof MutationObserver !== 'undefined') {
        mutations = new MutationObserver(changed);
        mutations.observe(activeView, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['aria-busy','data-watch-loading','hidden','style']});
      }
      deadline = setTimeout(() => stop(), WATCH_SCROLL_RESTORE_MAX_WAIT_MS);
      retry(); // Keep the existing pre-paint restoration when the cached height is ready.
      return () => stop(false);
    } else if (!watchSession && restoreWatchReturnRef.current) {
      restoreWatchReturnRef.current = false;
      if (container) container.scrollTop = watchReturnRef.current.scroll;
      const trigger = watchReturnRef.current.trigger;
      if (trigger?.isConnected) trigger.focus({preventScroll:true});
    }
  }, [active, !!creatorEntry, watchSession, activeWatchToken]);
  useEffect(() => {
    const restore = () => {
      // Ignore unrelated route locations; only opaque local timeline entries restore here.
      if (window.location.hash !== '#/timeline-preview') return;
      snapshotCreator(); snapshotWatch();
      const restoredCreator = creatorHistory.restore().entry;
      creatorRequestRef.current?.abort();
      creatorEntryRef.current = restoredCreator; setCreatorEntry(restoredCreator); setCreatorEntries(creatorHistory.entries());
      pendingCreatorScrollRef.current = restoredCreator?.value.scroll ?? null;
      watchClosingRef.current = false;
      const {entry, sameLocation} = watchHistory.restore();
      if (!sameLocation) return;
      watchSuspendedRef.current = !!restoredCreator;
      restoreWatchReturnRef.current = !entry && sameLocation && !!watchRef.current;
      watchRef.current = entry?.value.session || null;
      playerSnapshotRef.current = null;
      pendingWatchScrollRef.current = restoredCreator ? null : entry?.value.scroll ?? null;
      sectionSnapshotRef.current = entry?.value.section ?? 'related';
      setActiveAutoplayPostId(null);
      setWatchEntries(watchHistory.entries()); setActiveWatchToken(entry?.token || null);
      setWatchSession(entry?.value.session || null);
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.currentView === previous.currentView) return;
      if (state.currentView === 'timeline-preview') { restore(); return; }
      settledCreatorTokensRef.current.clear(); completedCreatorTokensRef.current.clear(); creatorHistory.clear(); creatorRequestRef.current?.abort(); creatorEntryRef.current = null; setCreatorEntry(null); setCreatorEntries([]);
      watchHistory.clear(); watchClosingRef.current = false; watchSuspendedRef.current = false;
      restoreWatchReturnRef.current = false; watchRef.current = null; playerSnapshotRef.current = null;
      setWatchEntries([]); setActiveWatchToken(null); setWatchSession(null);
    });
    return () => {
      window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore);
      unsubscribe();
      // Do not clear here: StrictMode replays effect setup/cleanup on the same mount.
      // The session registry is released with the component instance on actual unmount.
    };
  }, [setActiveAutoplayPostId, snapshotWatch, snapshotCreator, watchHistory, creatorHistory]);
  const previousCreatorRef = useRef(selectedCreatorId);
  const currentCreatorRef = useRef(selectedCreatorId);
  currentCreatorRef.current = selectedCreatorId;

  const openCreator = (id: string | null) => {
    const container = timelineRef.current?.closest('main');
    if (!selectedCreatorId && id && container) feedScrollRef.current = container.scrollTop;
    setSelectedCreatorId(id);
  };

  useEffect(() => {
    if (!active || creatorEntry || watchSession) {
      refreshControllerRef.current?.abort();
      useProfileTimelineStore.getState().suspendRequests();
      setIsRefreshingTimeline(false);
      return;
    }
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const runAutoCheck = () => {
      if (controller.signal.aborted) return;
      if (shouldAutoRefreshTimeline({
        active: activeRef.current,
        inCreatorProfile: Boolean(creatorEntry),
        inWatchSession: Boolean(watchSession),
        isRefreshing: isRefreshingFeedRef.current,
        lastRefreshAt: lastRefreshAtRef.current,
        now: Date.now(),
      })) {
        void refreshFeed(controller.signal);
      }
    };
    // Defer one microtask so StrictMode's setup replay does not consume bootstrap
    // with an already-aborted signal. Short returns stay debounced by cooldown.
    void Promise.resolve().then(runAutoCheck);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runAutoCheck();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const pollTimer = window.setInterval(runAutoCheck, TIMELINE_BACKGROUND_POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(pollTimer);
      controller.abort();
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
    };
  }, [active, !!creatorEntry, !!watchSession, refreshFeed]);

  useEffect(() => {
    if (!active || creatorEntry || watchSession || lastRefreshAtRef.current === null || isRefreshingFeedRef.current) {
      return;
    }
    const missingIds = findUndiscoveredCreatorIds(creators, creatorRefreshedAt, isDiscoveringCreator, creatorRefreshErrors);
    if (missingIds.length === 0) return;
    const signal = refreshControllerRef.current?.signal;
    if (signal?.aborted) return;
    void refreshMissingCreators(missingIds, signal);
  }, [active, !!creatorEntry, !!watchSession, creators, creatorRefreshedAt, isDiscoveringCreator, creatorRefreshErrors, refreshMissingCreators]);

  // Filtragem dos posts
  const query = (searchQuery || '').trim().toLowerCase();
  const displayedCreators = query
    ? creators.filter(creator => [creator.name, creator.handle].some(value => value?.toLowerCase().includes(query)))
    : creators;
  const displayedPosts = useMemo(() => {
    const savedCreatorIds = new Set(creators.map(creator => creator.id));
    const savedPosts = posts.filter(post => savedCreatorIds.has(post.creatorId));
    const searchedPosts = query
      ? savedPosts.filter(post => [post.title, post.caption, post.creatorName, post.creatorHandle]
        .some(value => value?.toLowerCase().includes(query)))
      : savedPosts;
    if (activeFilter === 'para_voce') {
      return rankForYouPosts(searchedPosts, {
        creators,
        history: libraryHistory,
        liked: libraryLiked,
        favorites: libraryFavorites,
        playlists: libraryPlaylists,
        likedPostIds,
        favoritedPostIds,
        savedPostIds,
      });
    }
    return sortTimelinePostsByPublication(searchedPosts);
  }, [
    activeFilter,
    posts,
    query,
    creators,
    libraryHistory,
    libraryLiked,
    libraryFavorites,
    libraryPlaylists,
    likedPostIds,
    favoritedPostIds,
    savedPostIds,
  ]);
  const activeIdx = displayedPosts.findIndex(post => post.id === activeAutoplayPostId);
  const feedWindowKey = JSON.stringify([activeFilter, query]);
  const feedCount = feedWindow.key === feedWindowKey ? feedWindow.count : feedPageSize;
  if (feedWindow.key === feedWindowKey && activeAutoplayPostId && activeIdx >= 0 &&
      (activeIdx < feedCount || mountedFeedPostIdsRef.current.has(activeAutoplayPostId))) {
    pinnedFeedPostRef.current = activeAutoplayPostId;
  }
  const pinnedFeedPostId = feedWindow.key === feedWindowKey ? pinnedFeedPostRef.current : null;
  // Keep a playing/handoff card's keyed node even if new posts push it beyond the prefix.
  const renderedFeedPosts = displayedPosts.filter((post, index) => index < feedCount || post.id === pinnedFeedPostId);
  useLayoutEffect(() => {
    mountedFeedPostIdsRef.current = new Set(renderedFeedPosts.map(post => post.id));
  });
  const hasMoreFeedPosts = renderedFeedPosts.length < displayedPosts.length;
  const expandFeed = useCallback(() => {
    setFeedWindow(current => ({key: feedWindowKey, count: (current.key === feedWindowKey ? current.count : feedPageSize) + feedPageSize}));
  }, [feedWindowKey, feedPageSize]);

  useLayoutEffect(() => {
    if (feedWindow.key !== feedWindowKey) {
      pinnedFeedPostRef.current = null;
      setFeedWindow({key: feedWindowKey, count: feedPageSize});
    }
  }, [feedWindowKey, feedWindow.key, feedPageSize]);

  useLayoutEffect(() => {
    if (!active || watchSession || selectedCreatorId) return;
    const list = feedListRef.current;
    const firstCard = list?.querySelector<HTMLElement>('[data-timeline-post-id]');
    const main = timelineRef.current?.closest('main');
    if (!list || !firstCard || !main) return;
    const measure = () => {
      const cardHeight = firstCard.getBoundingClientRect().height;
      const viewportHeight = main.clientHeight;
      if (cardHeight <= 0 || viewportHeight <= 0) return;
      const gap = parseFloat(getComputedStyle(list).rowGap) || parseFloat(getComputedStyle(firstCard.nextElementSibling || firstCard).marginTop) || 0;
      const pageSize = Math.max(FEED_UNMEASURED_CARD_COUNT, Math.ceil(viewportHeight * (1 + FEED_BUFFER_VIEWPORTS) / (cardHeight + gap)));
      setFeedPageSize(pageSize);
      // Resize can fill the viewport, but never discard cards already reached.
      setFeedWindow(current => ({key: feedWindowKey, count: Math.max(current.key === feedWindowKey ? current.count : 0, pageSize)}));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(main); observer.observe(firstCard);
    return () => observer.disconnect();
  }, [active, feedWindowKey, renderedFeedPosts[0]?.id, watchSession, selectedCreatorId]);

  useEffect(() => {
    if (!active || !hasMoreFeedPosts || watchSession || selectedCreatorId) return;
    const main = timelineRef.current?.closest('main');
    const sentinel = feedSentinelRef.current;
    if (!main || !sentinel) return;
    let armed = false;
    const checkEnd = () => {
      if (!armed) return;
      const end = sentinel.getBoundingClientRect();
      const viewport = main.getBoundingClientRect();
      if (end.top < viewport.bottom && end.bottom > viewport.top) {
        armed = false;
        expandFeed();
      }
    };
    // Intersection alone (including new data/layout/return from watch) never expands.
    // A fresh downward input is required for every automatic batch.
    const wheel = (event: WheelEvent) => { if (event.deltaY > 0) armed = true; };
    let touchY: number | null = null;
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; };
    const touchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (touchY !== null && nextY !== undefined && nextY < touchY) armed = true;
      touchY = nextY ?? null;
    };
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) && !event.shiftKey) armed = true;
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(checkEnd, {root: main});
    observer?.observe(sentinel);
    main.addEventListener('wheel', wheel, {passive:true});
    main.addEventListener('touchstart', touchStart, {passive:true});
    main.addEventListener('touchmove', touchMove, {passive:true});
    main.addEventListener('keydown', key);
    main.addEventListener('scroll', checkEnd, {passive:true});
    return () => {
      observer?.disconnect();
      main.removeEventListener('wheel', wheel); main.removeEventListener('touchstart', touchStart);
      main.removeEventListener('touchmove', touchMove); main.removeEventListener('keydown', key);
      main.removeEventListener('scroll', checkEnd);
    };
  }, [active, hasMoreFeedPosts, watchSession, selectedCreatorId, expandFeed, feedCount]);

  useLayoutEffect(() => {
    if (!active) return;
    const id = pendingFeedFocusRef.current;
    if (!id) return;
    const card = Array.from(feedListRef.current?.querySelectorAll<HTMLElement>('[data-timeline-post-id]') || []).find(element => element.dataset.timelinePostId === id);
    const control = card?.querySelector<HTMLElement>('button, a[href], [tabindex="0"]');
    if (control) { control.focus({preventScroll:true}); pendingFeedFocusRef.current = null; }
  }, [active, feedCount]);

  // Autoplay automático do primeiro vídeo quando o feed carrega no mobile
  useEffect(() => {
    if (active && !watchSession && !selectedCreatorId && activeIdx === -1) {
      const firstVideo = displayedPosts.find(p => p.type === 'video' || p.type === 'gif');
      if (firstVideo) {
        setActiveAutoplayPostId(firstVideo.id);
      } else if (activeAutoplayPostId) setActiveAutoplayPostId(null);
    }
  }, [active, watchSession, selectedCreatorId, activeAutoplayPostId, activeIdx, displayedPosts, setActiveAutoplayPostId]);

  // App's main owns scrolling. Keep the feed position locally while a profile is open.
  useEffect(() => {
    if (!active) return;
    const container = timelineRef.current?.closest('main');
    if (!container) return;
    const rememberFeedScroll = () => {
      if (!watchRef.current && !currentCreatorRef.current) feedScrollRef.current = container.scrollTop;
    };
    rememberFeedScroll();
    container.addEventListener('scroll', rememberFeedScroll, { passive: true });
    return () => container.removeEventListener('scroll', rememberFeedScroll);
  }, [active]);

  useLayoutEffect(() => {
    if (!active || previousCreatorRef.current === selectedCreatorId) return;
    const container = timelineRef.current?.closest('main');
    if (container) container.scrollTop = selectedCreatorId ? 0 : feedScrollRef.current;
    previousCreatorRef.current = selectedCreatorId;
  }, [active, selectedCreatorId]);

  const selectedCreator = selectedCreatorId ? creatorProfiles?.[selectedCreatorId] || creators.find(c => c.id === selectedCreatorId) : undefined;
  const refreshCreators = selectedCreator ? [selectedCreator] : creators;
  const isRefreshingScope = selectedCreator
    ? Boolean(isDiscoveringCreator[selectedCreator.id])
    : isRefreshingTimeline || refreshCreators.some(creator => isDiscoveringCreator[creator.id]);
  const scopeRefreshFailed = refreshCreators.some(creator => creatorRefreshErrors[creator.id]);
  const refreshIconClass = `w-3.5 h-3.5 ${isRefreshingScope && !disableAllAnimations ? 'animate-spin motion-reduce:animate-none' : ''}`;
  const refreshButtonClass = 'flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[var(--tl-surface)] border border-[var(--tl-border)] text-xs font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:border-[var(--tl-accent-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tl-accent-hover)] disabled:opacity-50 disabled:cursor-wait transition-colors shrink-0';
  const activeCommentPost = posts.find(post => post.id === activeCommentsPostId)
    || creatorEntry?.value.snapshot?.posts.find(post => post.id === activeCommentsPostId)
    || null;

  const activeWatchIndex = watchEntries.findIndex(entry => entry.token === activeWatchToken);
  const cachedWatchEntries = watchEntries.slice(Math.max(0, activeWatchIndex - WATCH_UI_NEIGHBOR_RADIUS), Math.max(0, activeWatchIndex) + WATCH_UI_NEIGHBOR_RADIUS + 1);

  return (
    <div ref={timelineRef} className={`w-full max-w-full min-w-0 text-[var(--tl-text-primary)] flex flex-col space-y-4 ${watchSession && !creatorEntry ? 'max-w-7xl mx-auto' : isMobileOnly ? '' : 'max-w-2xl mx-auto'}`}>
      {cachedWatchEntries.map(entry => <div key={entry.token} data-watch-entry={entry.token} data-watch-active={active && !creatorEntry && entry.token === activeWatchToken} hidden={!!creatorEntry || entry.token !== activeWatchToken}>
        <TimelineWatchView onOpenCreator={openWatchCreator} initialSection={entry.value.section} onSectionChange={value => {if (entry.token === activeWatchToken) sectionSnapshotRef.current = value;}} session={entry.value.session} active={active && !creatorEntry && entry.token === activeWatchToken} onClose={closeWatch} onChangeVideo={openWatchSession} registerPlaybackSnapshot={entry.token === activeWatchToken ? snapshot => {playerSnapshotRef.current = snapshot;} : undefined}/>
      </div>)}
      {creatorEntries.map(profileEntry => <div key={profileEntry.token} data-timeline-creator data-creator-active={profileEntry.token === creatorEntry?.token} hidden={profileEntry.token !== creatorEntry?.token} className="space-y-4">
        {!profileEntry.value.snapshot && <button type="button" onClick={closeCreator} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"><ChevronLeft className="w-4 h-4"/>{creatorEntries.length <= 1 && profileEntry.value.returnTo?.watchSession ? (isEn ? 'Back to Video' : 'Voltar ao vídeo') : (isEn ? 'Back' : 'Voltar')}</button>}
        {creatorLoading && profileEntry.token === creatorEntry?.token && <p role="status" className="px-3.5 text-xs text-[var(--tl-text-muted)]">{isEn ? 'Loading creator profile…' : 'Carregando perfil do criador…'}</p>}
        {profileEntry.value.error && <div role="alert" className="px-3.5 text-xs text-[var(--tl-text-muted)]"><p>{profileEntry.value.snapshot?.incomplete ? (isEn ? 'Some profile content could not be loaded. Available content is preserved; try again to check the source.' : 'Parte do conteúdo do perfil não pôde ser carregada. O conteúdo disponível foi preservado; tente consultar a fonte novamente.') : (isEn ? 'Could not load the creator profile. Available content is preserved.' : 'Não foi possível carregar o perfil do criador. O conteúdo disponível foi preservado.')}</p><button type="button" disabled={creatorLoading} onClick={() => {completedCreatorTokensRef.current.delete(profileEntry.token); settledCreatorTokensRef.current.delete(profileEntry.token); setCreatorAttempt(value => value + 1);}} className={refreshButtonClass}><RefreshCw className="w-3.5 h-3.5"/>{isEn ? 'Try again' : 'Tentar novamente'}</button></div>}
        {profileEntry.value.snapshot && <>
          <AdaptiveProfileHeader
            creator={profileEntry.value.snapshot.creator}
            onBack={closeCreator}
            backLabel={
              creatorEntries.length <= 1 && profileEntry.value.returnTo
                ? (profileEntry.value.returnTo.watchSession
                    ? (isEn ? 'Back to Video' : 'Voltar ao vídeo')
                    : (isEn ? 'Back' : 'Voltar'))
                : undefined
            }
          />
          <AdaptiveProfileContent key={profileEntry.value.url} activeTab={profileEntry.value.activeTab} onActiveTabChange={tab => {
            if (creatorEntryRef.current?.token !== profileEntry.token) return;
            const next = {token:profileEntry.token,value:{...creatorEntryRef.current.value,activeTab:tab}};
            creatorHistory.save(next.value); creatorEntryRef.current = next; setCreatorEntry(next); setCreatorEntries(creatorHistory.entries());
          }} suspended={!active || profileEntry.token !== creatorEntry?.token} creator={profileEntry.value.snapshot.creator} posts={profileEntry.value.snapshot.posts} onOpenVideo={openVideo} onOpenProfile={id => {const creator = creatorProfiles[id] || profileEntry.value.snapshot?.creator; if (creator?.profileUrl) openWatchCreator(creator.profileUrl);}} onOpenComments={openComments} onOpenLightbox={openLightbox} isDesktop={!isMobileOnly}/>
        </>}
      </div>)}
      <div hidden={!!watchSession || !!creatorEntry} className="space-y-4">
      {/* Topo / Cabeçalho da Linha do Tempo */}
      {!selectedCreator && (
        <div className="px-3.5">
          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <h2 className="text-xl font-black text-[var(--tl-text-primary)] min-w-0 truncate">
              {isEn ? 'Timeline' : 'Linha do tempo'}
            </h2>

            <div className="flex items-center gap-2 shrink-0">
              {/* Filtros Recentes / Para você */}
              <div className="flex items-center gap-1 bg-[var(--tl-surface)] p-1 rounded-xl border border-[var(--tl-border)]">
                <button
                  type="button"
                  onClick={() => setActiveFilter('recentes')}
                  aria-pressed={activeFilter === 'recentes'}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    activeFilter === 'recentes'
                      ? 'bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] shadow-md'
                      : 'text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'
                  }`}
                >
                  {isEn ? 'Recent' : 'Recentes'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('para_voce')}
                  aria-pressed={activeFilter === 'para_voce'}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    activeFilter === 'para_voce'
                      ? 'bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] shadow-md'
                      : 'text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'
                  }`}
                >
                  {isEn ? 'For you' : 'Para você'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => void refreshFeed(refreshControllerRef.current?.signal)}
                disabled={isLoading || isRefreshingScope}
                aria-busy={isRefreshingScope}
                title={isEn ? 'Refresh' : 'Atualizar'}
                aria-label={isEn ? 'Refresh' : 'Atualizar'}
                className={refreshButtonClass}
              >
                <RefreshCw aria-hidden="true" className={refreshIconClass} />
                <span className="sr-only sm:not-sr-only">{isEn ? 'Refresh' : 'Atualizar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {scopeRefreshFailed && (
        <p className="px-3.5 text-xs text-amber-300" role="status">
          {isEn
            ? 'Some sources could not be checked. Loaded content is preserved; try refreshing again.'
            : 'Não foi possível consultar algumas fontes. O conteúdo carregado foi preservado; tente atualizar novamente.'}
        </p>
      )}

      {/* Stories de Criadores (exibido no feed) */}
      {!selectedCreator && (
        <div className="min-w-0">
          <TimelineStoriesBar
            creators={displayedCreators}
            selectedCreatorId={selectedCreatorId}
            onSelectCreator={openCreator}
          />
        </div>
      )}

      {/* Estado de Carregamento */}
      {isLoading && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-[var(--tl-text-muted)] gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--tl-accent)]" />
          <span className="text-xs font-semibold">
            {isEn ? 'Loading timeline content...' : 'Carregando conteúdo da linha do tempo...'}
          </span>
        </div>
      )}

      {/* Estado de Erro */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/35 text-rose-300 text-xs flex items-center justify-between mb-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refreshFeed(refreshControllerRef.current?.signal)}
            disabled={isLoading || isRefreshingTimeline}
            aria-busy={isRefreshingTimeline}
            className="flex items-center gap-1 font-bold underline hover:text-[var(--tl-text-primary)]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isEn ? 'Retry' : 'Tentar novamente'}</span>
          </button>
        </div>
      )}

      {!selectedCreator && !isLoading && !error && displayedPosts.length === 0 && (
        <div role="status" className="flex flex-col items-center justify-center py-24 px-4 text-center text-[var(--tl-text-muted)] text-xs gap-3">
          <span>{query
            ? (isEn ? 'No posts match this search in the loaded content.' : 'Nenhuma publicação corresponde à busca no conteúdo carregado.')
            : (isEn ? 'No timeline posts available.' : 'Nenhuma publicação disponível na linha do tempo.')}</span>
        </div>
      )}

      {/* Perfil Adaptativo Selecionado */}
      {selectedCreator ? (
        <div key={`profile-${selectedCreator.id}`} className="space-y-4">
          <div className="flex justify-end px-3.5">
            <button
              type="button"
              onClick={() => void discoverCreatorCatalog(selectedCreator.id, refreshControllerRef.current?.signal, true)}
              disabled={isRefreshingScope}
              aria-busy={isRefreshingScope}
              className={refreshButtonClass}
            >
              <RefreshCw aria-hidden="true" className={refreshIconClass} />
              <span>{isEn ? 'Refresh profile' : 'Atualizar perfil'}</span>
            </button>
          </div>
          <AdaptiveProfileHeader
            creator={selectedCreator}
            onBack={() => openCreator(null)}
          />
          <AdaptiveProfileContent
            suspended={!active || !!watchSession}
            onOpenVideo={openVideo}
            creator={selectedCreator}
            posts={posts}
            onOpenProfile={openCreator}
            onOpenComments={(id) => openComments(id)}
            onOpenLightbox={(imgs, idx, ttl, albUrl, items, expectedCount) =>
              openLightbox(imgs, idx, ttl, albUrl, items, expectedCount)
            }
            isDesktop={!isMobileOnly}
          />
        </div>
      ) : (
        /* Feed da Linha do Tempo */
        <div key="timeline-feed" ref={feedListRef} className="space-y-3.5 min-w-0">
          {renderedFeedPosts.map((post) => {
            const isNext = activeIdx !== -1 && post.id === displayedPosts[activeIdx + 1]?.id;
            return (
              <TimelinePostCard
                suspended={!active || !!watchSession}
                onOpenVideo={openVideo}
                key={post.id}
                post={post}
                onOpenProfile={openCreator}
                onOpenComments={(id) => openComments(id)}
                onOpenLightbox={(imgs, idx, ttl, albUrl, items, expectedCount) =>
                  openLightbox(imgs, idx, ttl, albUrl, items, expectedCount)
                }
                isDesktop={!isMobileOnly}
                isNextInQueue={isNext}
              />
            );
          })}
          {hasMoreFeedPosts && <div className="pt-4 pb-6 flex flex-col items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                pendingFeedFocusRef.current = displayedPosts.find((post, index) => index >= feedCount && post.id !== pinnedFeedPostId)?.id || null;
                expandFeed();
              }}
              style={{ boxShadow: '0 10px 24px -6px var(--tl-accent-shadow)' }}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-[var(--tl-gradient-from)] to-[var(--tl-gradient-to)] hover:brightness-110 text-[var(--tl-accent-contrast)] font-bold text-xs sm:text-sm flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tl-accent-hover)] transition-all"
            >
              {isEn ? 'Load more posts' : 'Carregar mais publicações'}
            </button>
            <div ref={feedSentinelRef} className="h-4 w-full pointer-events-none" aria-hidden="true" />
          </div>}
        </div>
      )}

      </div>
      {/* Gaveta Bottom Sheet de Comentários */}
      <CommentsBottomSheet
        post={activeCommentPost}
        isOpen={active && !!activeCommentsPostId}
        onClose={closeComments}
      />

      {/* Lightbox de Fotos */}
      {active && <PhotoLightboxModal
        lightbox={lightbox}
        onClose={closeLightbox}
        onNext={nextLightboxImage}
        onPrev={prevLightboxImage}
      />}
    </div>
  );
};
