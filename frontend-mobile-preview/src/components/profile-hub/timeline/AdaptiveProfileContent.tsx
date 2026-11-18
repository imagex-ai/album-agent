import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Play, Menu, Film, Images, Sparkles, Loader2, X, ListVideo, ArrowLeft, Bookmark } from 'lucide-react';
import {
  TimelineCreator,
  TimelinePost,
  TimelinePhotoItem,
  TimelinePlaylist,
  doesPostMatchCreator,
  buildTimelineStreamUrl,
  upgradePhotoUrlFast,
} from './timelineModel';
import { timelinePlaybackRect, TimelinePlaybackHandoff, TimelinePostCard } from './TimelinePostCard';
import { fetchPlaylistVideos } from '../../../services/profileHubApi';
import { useProfileTimelineStore } from '../../../store/useProfileTimelineStore';
import { useProfileHubLibraryStore } from '../../../store/useProfileHubLibraryStore';
import { canonicalLibraryMediaKey, normalizeCreatorPlaylistToLibraryItem } from '../../../services/profileHubLibraryModel';
import { useAppStore } from '../../../store/useAppStore';
import { handleProxiedImageError } from '../../../services/profileHubImageFallback';

interface AdaptiveProfileContentProps {
  creator: TimelineCreator;
  posts: TimelinePost[];
  onOpenProfile: (creatorId: string) => void;
  onOpenComments: (postId: string) => void;
  onOpenLightbox: (
    images: string[],
    index: number,
    title?: string,
    albumUrl?: string,
    items?: TimelinePhotoItem[],
    expectedPhotoCount?: number
  ) => void;
  isDesktop?: boolean;
  suspended?: boolean;
  activeTab?: string;
  onActiveTabChange?: (tab: string) => void;
  onOpenVideo?: (post: TimelinePost, handoff: TimelinePlaybackHandoff) => void;
}

// Match the main timeline: one extra viewport, one card until geometry is available.
const FEED_BUFFER_VIEWPORTS = 1;
const FEED_UNMEASURED_CARD_COUNT = 1;

export const AdaptiveProfileContent: React.FC<AdaptiveProfileContentProps> = ({
  creator,
  posts,
  onOpenProfile,
  onOpenComments,
  onOpenLightbox,
  isDesktop = false,
  suspended = false,
  activeTab,
  onActiveTabChange,
  onOpenVideo,
}) => {
  const isEn = useAppStore((state) => state.settings?.language === 'en-US');
  const libraryFavorites = useProfileHubLibraryStore((state) => state.favorites);
  const setFavoriteItem = useProfileHubLibraryStore((state) => state.setFavoriteItem);
  const isCreatorPlaylistFavorited = (pl: TimelinePlaylist) => {
    const key = canonicalLibraryMediaKey({ id: pl.id, url: pl.url });
    return libraryFavorites.some(
      (entry) => entry.kind === 'playlist' && ((key && entry.key === key) || entry.id === pl.id)
    );
  };
  const toggleFavoriteCreatorPlaylist = (pl: TimelinePlaylist) => {
    const item = normalizeCreatorPlaylistToLibraryItem(pl, creator);
    if (!item) return;
    void setFavoriteItem(item, !isCreatorPlaylistFavorited(pl));
  };
  const { activeProfileTab: storedProfileTab, setActiveProfileTab: setStoredProfileTab, isDiscoveringCreator, activeAutoplayPostId } =
    useProfileTimelineStore();
  const activeProfileTab = activeTab ?? storedProfileTab;
  const setActiveProfileTab = onActiveTabChange ?? setStoredProfileTab;

  const [activeVideoPostId, setActiveVideoPostId] = useState<string | null>(null);
  const [hoveredGridVideoId, setHoveredGridVideoId] = useState<string | null>(null);


  // Playlists State
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [loadingPlaylistId, setLoadingPlaylistId] = useState<string | null>(null);
  const [playlistVideosMap, setPlaylistVideosMap] = useState<Record<string, TimelinePost[]>>({});
  const [activePlaylistVideoId, setActivePlaylistVideoId] = useState<string | null>(null);
  const [playlistError, setPlaylistError] = useState<{ id: string; message: string } | null>(null);
  const playlistRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!suspended) return;
    setHoveredGridVideoId(null);
    playlistRequestRef.current?.abort();
    playlistRequestRef.current = null;
    setLoadingPlaylistId(null);
  }, [suspended]);

  useEffect(() => {
    setSelectedPlaylistId(null);
    setActivePlaylistVideoId(null);
    setLoadingPlaylistId(null);
    setPlaylistError(null);
    return () => {
      playlistRequestRef.current?.abort();
      playlistRequestRef.current = null;
    };
  }, [creator.id]);

  const activePlayerRef = useRef<HTMLDivElement | null>(null);
  const activePlaylistPlayerRef = useRef<HTMLDivElement | null>(null);

  const isScanning = !!isDiscoveringCreator[creator.id];

  const creatorPosts = posts.filter((p) => doesPostMatchCreator(p, creator));
  const videoPosts = creatorPosts.filter((p) => p.type === 'video');
  const albumPosts = creatorPosts.filter((p) => p.type === 'photo_grid' || p.type === 'album');
  const gifPosts = creatorPosts.filter((p) => p.type === 'gif');
  const creatorPlaylists: TimelinePlaylist[] = creator.playlists || [];

  const feedListRef = useRef<HTMLDivElement | null>(null);
  const feedSentinelRef = useRef<HTMLDivElement | null>(null);
  const [feedWindow, setFeedWindow] = useState({key: creator.id, count: FEED_UNMEASURED_CARD_COUNT});
  const [feedPageSize, setFeedPageSize] = useState(FEED_UNMEASURED_CARD_COUNT);
  const pinnedFeedPostRef = useRef<string | null>(null);
  const mountedFeedPostIdsRef = useRef(new Set<string>());
  const pendingFeedFocusRef = useRef<string | null>(null);
  const feedWindowKey = creator.id;
  const feedCount = feedWindow.key === feedWindowKey ? feedWindow.count : FEED_UNMEASURED_CARD_COUNT;
  const activeIdx = creatorPosts.findIndex(post => post.id === activeAutoplayPostId);
  if (feedWindow.key === feedWindowKey && activeAutoplayPostId && activeIdx >= 0 &&
      (activeIdx < feedCount || mountedFeedPostIdsRef.current.has(activeAutoplayPostId))) {
    pinnedFeedPostRef.current = activeAutoplayPostId;
  }
  const pinnedFeedPostId = feedWindow.key === feedWindowKey ? pinnedFeedPostRef.current : null;
  const renderedFeedPosts = creatorPosts.filter((post, index) => index < feedCount || post.id === pinnedFeedPostId);
  const hasMoreFeedPosts = renderedFeedPosts.length < creatorPosts.length;
  const expandFeed = useCallback(() => {
    setFeedWindow(current => ({key: feedWindowKey, count: (current.key === feedWindowKey ? current.count : FEED_UNMEASURED_CARD_COUNT) + feedPageSize}));
  }, [feedWindowKey, feedPageSize]);

  useLayoutEffect(() => {
    if (activeProfileTab === 'timeline') mountedFeedPostIdsRef.current = new Set(renderedFeedPosts.map(post => post.id));
  });

  useLayoutEffect(() => {
    if (feedWindow.key === feedWindowKey) return;
    pinnedFeedPostRef.current = null;
    pendingFeedFocusRef.current = null;
    setFeedPageSize(FEED_UNMEASURED_CARD_COUNT);
    setFeedWindow({key: feedWindowKey, count: FEED_UNMEASURED_CARD_COUNT});
  }, [feedWindowKey, feedWindow.key]);

  useLayoutEffect(() => {
    if (suspended || activeProfileTab !== 'timeline') return;
    const list = feedListRef.current;
    const firstCard = list?.querySelector<HTMLElement>('[data-timeline-post-id]');
    const main = list?.closest('main');
    if (!list || !firstCard || !main) return;
    const measure = () => {
      const cardHeight = firstCard.getBoundingClientRect().height;
      // On mobile the main can grow with its content; measure the visible
      // viewport as well so ResizeObserver cannot expand the entire catalog.
      const viewportHeight = Math.min(main.clientHeight, window.innerHeight);
      if (cardHeight <= 0 || viewportHeight <= 0) return;
      const gap = parseFloat(getComputedStyle(list).rowGap) || parseFloat(getComputedStyle(firstCard.nextElementSibling || firstCard).marginTop) || 0;
      const pageSize = Math.max(FEED_UNMEASURED_CARD_COUNT, Math.ceil(viewportHeight * (1 + FEED_BUFFER_VIEWPORTS) / (cardHeight + gap)));
      setFeedPageSize(pageSize);
      setFeedWindow(current => ({key: feedWindowKey, count: Math.max(current.key === feedWindowKey ? current.count : 0, pageSize)}));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(main); observer.observe(firstCard);
    return () => observer.disconnect();
  }, [suspended, activeProfileTab, feedWindowKey, renderedFeedPosts[0]?.id]);

  useEffect(() => {
    if (suspended || activeProfileTab !== 'timeline' || !hasMoreFeedPosts) return;
    const main = feedListRef.current?.closest('main');
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
    // New catalog data or restored layout alone must not mount more cards.
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
  }, [suspended, activeProfileTab, hasMoreFeedPosts, expandFeed, feedCount]);

  useLayoutEffect(() => {
    if (suspended || activeProfileTab !== 'timeline') return;
    const id = pendingFeedFocusRef.current;
    if (!id) return;
    const card = Array.from(feedListRef.current?.querySelectorAll<HTMLElement>('[data-timeline-post-id]') || []).find(element => element.dataset.timelinePostId === id);
    const control = card?.querySelector<HTMLElement>('button, a[href], [tabindex="0"]');
    if (control) { control.focus({preventScroll:true}); pendingFeedFocusRef.current = null; }
  }, [suspended, activeProfileTab, feedCount]);

  const activeVideoPost = videoPosts.find((v) => v.id === activeVideoPostId) || null;

  // Selected playlist object & its videos
  const selectedPlaylist =
    creatorPlaylists.find((pl) => pl.id === selectedPlaylistId) ||
    creatorPlaylists.find(
      (pl) =>
        selectedPlaylistId &&
        (pl.id.includes(selectedPlaylistId) ||
          selectedPlaylistId.includes(pl.id) ||
          (pl.url && creatorPlaylists.some((x) => x.id === selectedPlaylistId && x.url === pl.url)))
    ) ||
    null;
  const currentPlaylistVideos: TimelinePost[] = selectedPlaylist
    ? (playlistVideosMap[selectedPlaylist.id] || selectedPlaylist.videos || [])
    : [];
  const activePlaylistVideoPost =
    currentPlaylistVideos.find((v) => v.id === activePlaylistVideoId) || null;

  const activateCardOnKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.currentTarget.click();
    }
  };

  // Abas disponíveis dinamicamente com base no conteúdo real
  const tabs = [
    {
      id: 'timeline',
      label: isEn ? 'Timeline' : 'Linha do Tempo',
      count: creatorPosts.length,
      icon: <Menu className="w-3.5 h-3.5" />,
    },
    {
      id: 'videos',
      label: isEn ? 'Videos' : 'Vídeos',
      count: videoPosts.length,
      icon: <Film className="w-3.5 h-3.5" />,
    },
    ...(creatorPlaylists.length > 0
      ? [
          {
            id: 'playlists',
            label: 'Playlists',
            count: creatorPlaylists.length,
            icon: <ListVideo className="w-3.5 h-3.5" />,
          },
        ]
      : []),
    ...(albumPosts.length > 0
      ? [
          {
            id: 'albums',
            label: isEn ? 'Photos / Albums' : 'Ensaios / Álbuns',
            count: albumPosts.length,
            icon: <Images className="w-3.5 h-3.5" />,
          },
        ]
      : []),
    ...(gifPosts.length > 0
      ? [
          {
            id: 'gifs',
            label: 'GIFs',
            count: gifPosts.length,
            icon: <Sparkles className="w-3.5 h-3.5" />,
          },
        ]
      : []),
  ];

  const handleSelectPlaylist = async (playlist: TimelinePlaylist) => {
    playlistRequestRef.current?.abort();
    playlistRequestRef.current = null;
    setLoadingPlaylistId(null);
    setPlaylistError(null);
    setSelectedPlaylistId(playlist.id);
    setActivePlaylistVideoId(null);

    // If videos already loaded or embedded, use them
    if (Object.prototype.hasOwnProperty.call(playlistVideosMap, playlist.id)) {
      return;
    }
    if (playlist.videos && playlist.videos.length > 0) {
      setPlaylistVideosMap((prev) => ({ ...prev, [playlist.id]: playlist.videos! }));
      return;
    }

    if (!playlist.url) {
      setPlaylistError({id: playlist.id, message: isEn ? 'The playlist source is unavailable.' : 'A origem da playlist está indisponível.'});
      return;
    }

    const controller = new AbortController();
    playlistRequestRef.current = controller;
    setLoadingPlaylistId(playlist.id);
    try {
      const res = await fetchPlaylistVideos(playlist.url, controller.signal);
      if (controller.signal.aborted || playlistRequestRef.current !== controller) return;
      if (res.metadataStatus === 'error' && !res.videos?.length) throw new Error('playlist-source-error');
      const mapped: TimelinePost[] = (res.videos || []).map((v, vIdx) => {
          const vUrl = (v.originalUrl || v.pageUrl || (v as any).url || '').trim();
          let ytId: string | undefined;
          if (vUrl.includes('youtube.com/watch') || vUrl.includes('youtu.be/')) {
            const m = vUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/) || vUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
            if (m) ytId = m[1];
          }
          const stream = buildTimelineStreamUrl(v.streamUrl || vUrl, vUrl, undefined, ytId);
          return {
            id: `pl-vid-${playlist.id}-${v.id || vIdx}`,
            creatorId: creator.id,
            creatorName: creator.name,
            creatorHandle: creator.handle,
            creatorAvatar: creator.avatar,
            type: 'video',
            source: creator.site || 'generic',
            youtubeId: ytId,
            videoUrl: stream,
            originalUrl: vUrl || undefined,
            previewVideoUrl: (v as any).previewVideoUrl || undefined,
            thumbnail: v.thumbnailUrl || creator.avatar,
            title: v.title || `${playlist.title} - ${isEn ? 'Video' : 'Vídeo'} ${vIdx + 1}`,
            duration: v.duration || undefined,
            views: v.views || undefined,
            resolution: v.resolution || undefined,
            comments: [],
            likes: null,
            date: v.timeAgo || v.uploadedAt || '',
          };
      });
      setPlaylistVideosMap((prev) => ({ ...prev, [playlist.id]: mapped }));
    } catch {
      if (!controller.signal.aborted && playlistRequestRef.current === controller) {
        setPlaylistError({id: playlist.id, message: isEn ? 'Unable to load playlist videos. Try again.' : 'Não foi possível carregar os vídeos da playlist. Tente novamente.'});
      }
    } finally {
      if (playlistRequestRef.current === controller) {
        playlistRequestRef.current = null;
        setLoadingPlaylistId(null);
      }
    }
  };

  return (
    <div className={`space-y-3 min-w-0 max-w-full ${activeProfileTab === 'timeline' ? '' : 'px-2.5 sm:px-0'}`}>
      {/* Barra de Abas Dinâmica */}
      <div className={`flex items-center gap-2 border-b border-[var(--tl-border)] pb-1 overflow-x-auto no-scrollbar ${activeProfileTab === 'timeline' ? 'px-3.5 sm:px-0' : 'px-1 sm:px-0'}`}>
        {tabs.map((tab) => {
          const isActive = activeProfileTab === tab.id;
          return (
            <button
              key={tab.id}
              data-profile-tab={tab.id}
              onClick={() => {
                if (tab.id !== 'playlists') {
                  playlistRequestRef.current?.abort();
                  playlistRequestRef.current = null;
                  setLoadingPlaylistId(null);
                }
                setActiveProfileTab(tab.id);
                setActiveVideoPostId(null);
              }}
              className={`flex items-center gap-2 py-2 px-3 border-b-2 font-bold text-xs whitespace-nowrap transition-all ${
                isActive
                  ? 'border-[var(--tl-accent)] text-[var(--tl-accent-text)]'
                  : 'border-transparent text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  isActive ? 'bg-[var(--tl-accent-soft)] text-[var(--tl-accent-text-strong)]' : 'bg-[var(--tl-surface-elevated)] text-[var(--tl-text-muted)]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
        {isScanning && (
          <div className="ml-auto pr-2 flex items-center gap-1.5 text-[10px] text-[var(--tl-accent-text)] whitespace-nowrap">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{isEn ? 'Syncing catalog...' : 'Sincronizando catálogo...'}</span>
          </div>
        )}
      </div>

      {/* Conteúdo da Aba: Linha do Tempo */}
      {activeProfileTab === 'timeline' && (
        <div ref={feedListRef} className="space-y-3.5">
          {renderedFeedPosts.map((post) => {
            const isNext = activeIdx !== -1 && post.id === creatorPosts[activeIdx + 1]?.id;
            return (
              <TimelinePostCard
                suspended={suspended}
                onOpenVideo={onOpenVideo}
                key={post.id}
                post={post}
                onOpenProfile={onOpenProfile}
                onOpenComments={onOpenComments}
                onOpenLightbox={onOpenLightbox}
                isDesktop={isDesktop}
                isNextInQueue={isNext}
              />
            );
          })}
          {hasMoreFeedPosts && <div className="pt-4 pb-6 flex flex-col items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                pendingFeedFocusRef.current = creatorPosts.find((post, index) => index >= feedCount && post.id !== pinnedFeedPostId)?.id || null;
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

      {/* Conteúdo da Aba: Vídeos */}
      {activeProfileTab === 'videos' && (
        <div className="space-y-3">
          {activeVideoPost && (
            <div ref={activePlayerRef} data-active-profile-player className="relative mb-3 animate-in fade-in-50 duration-200">
              <div className="flex justify-end px-3.5 sm:px-0 mb-1.5">
                <button
                  type="button"
                  onClick={() => setActiveVideoPostId(null)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--tl-surface-elevated)] hover:bg-[var(--tl-accent-soft)] border border-[var(--tl-border)] text-[var(--tl-text-primary)] text-[11px] font-semibold transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Close player' : 'Fechar reprodutor'}</span>
                </button>
              </div>
              <TimelinePostCard
                suspended={suspended}
                onOpenVideo={onOpenVideo}
                key={`active-player-${activeVideoPost.id}`}
                post={activeVideoPost}
                onOpenProfile={onOpenProfile}
                onOpenComments={onOpenComments}
                onOpenLightbox={onOpenLightbox}
                isDesktop={isDesktop}
                autoStartWithControls={true}
              />
            </div>
          )}

          {videoPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--tl-text-muted)] gap-2">
              {isScanning ? (
                <>
                  <Loader2 className="w-7 h-7 animate-spin text-[var(--tl-accent-text)]" />
                  <span className="text-xs">{isEn ? 'Discovering videos...' : 'Descobrindo vídeos...'}</span>
                </>
              ) : (
                <>
                  <Film className="w-8 h-8 opacity-60" />
                  <span className="text-xs">{isEn ? 'No videos found for this creator' : 'Nenhum vídeo encontrado para este criador'}</span>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 px-3.5 sm:px-0">
              {videoPosts.map((video) => {
                const isHovered = hoveredGridVideoId === video.id;
                const streamForHover = buildTimelineStreamUrl(
                  video.previewVideoUrl || video.videoUrl || video.originalUrl,
                  video.originalUrl,
                  undefined,
                  video.youtubeId
                );

                return (
                  <div
                    key={video.id}
                    data-video-card-id={video.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${isEn ? 'Play' : 'Reproduzir'} ${video.title}`}
                    onKeyDown={activateCardOnKeyDown}
                    onMouseEnter={() => setHoveredGridVideoId(video.id)}
                    onMouseLeave={() =>
                      setHoveredGridVideoId((prev) => (prev === video.id ? null : prev))
                    }
                    onClick={event => {
                      event.currentTarget.focus({preventScroll:true});
                      if (onOpenVideo) { setHoveredGridVideoId(null); onOpenVideo(video, {currentTime: 0, isMuted: true, isPlaying: true, sourceRect:timelinePlaybackRect(event.currentTarget.querySelector('video, img') || event.currentTarget)}); return; }
                      setActiveVideoPostId(video.id);
                      setTimeout(() => {
                        activePlayerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }, 60);
                    }}
                    className={`bg-[var(--tl-surface)] border ${
                      activeVideoPostId === video.id
                        ? 'border-[var(--tl-accent)] ring-2 ring-[var(--tl-accent-ring)]'
                        : 'border-[var(--tl-border)] hover:border-[var(--tl-accent-border)]'
                    } rounded-2xl overflow-hidden group cursor-pointer transition-all flex flex-col`}
                  >
                    <div className="relative aspect-video bg-black overflow-hidden">
                      {isHovered && video.youtubeId ? (
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&mute=1&controls=0&playsinline=1&modestbranding=1`}
                          title={video.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : isHovered && streamForHover ? (
                        <video
                          src={streamForHover}
                          autoPlay
                          muted
                          loop
                          playsInline
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src={video.thumbnail || video.creatorAvatar}
                          alt={video.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            const rawThumb = video.thumbnail || video.creatorAvatar || '';
                            handleProxiedImageError(e, {
                              rawUrl: rawThumb,
                              referer: video.originalUrl || creator.profileUrl || rawThumb,
                              fallbackSrc:
                                video.thumbnail && creator.avatar && creator.avatar !== video.thumbnail
                                  ? creator.avatar
                                  : undefined,
                              hideOnExhausted: true,
                            });
                          }}
                        />
                      )}
                      {!isHovered && (
                        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors flex items-center justify-center pointer-events-none">
                          <div className="w-8 h-8 rounded-full bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            <Play className="w-4 h-4 fill-white ml-0.5" />
                          </div>
                        </div>
                      )}
                      {video.duration && (
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white">
                          {video.duration}
                        </div>
                      )}
                    </div>

                    <div className="p-2 flex-1 flex flex-col justify-between">
                      <h4 className="text-[11px] font-bold text-[var(--tl-text-primary)] line-clamp-2 leading-tight">
                        {video.title}
                      </h4>
                      <div className="flex items-center justify-between text-[10px] text-[var(--tl-text-muted)] mt-1.5 font-mono">
                        <span>{video.views || video.resolution || '—'}</span>
                        <span>{video.date || (isEn ? 'Unknown date' : 'Data desconhecida')}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Conteúdo da Aba: Playlists */}
      {activeProfileTab === 'playlists' && (
        <div className="space-y-3.5">
          {selectedPlaylist ? (
            <div className="space-y-3">
              {/* Cabeçalho da Playlist Selecionada */}
              <div className="flex items-center justify-between px-3.5 sm:px-0">
                <button
                  type="button"
                  data-action="back-to-playlists"
                  onClick={() => {
                    playlistRequestRef.current?.abort();
                    playlistRequestRef.current = null;
                    setLoadingPlaylistId(null);
                    setPlaylistError(null);
                    setSelectedPlaylistId(null);
                    setActivePlaylistVideoId(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--tl-surface-elevated)] hover:bg-[var(--tl-surface-hover)] border border-[var(--tl-border)] text-[var(--tl-accent-text)] text-xs font-bold transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>{isEn ? 'Back to Playlists' : 'Voltar para Playlists'}</span>
                </button>

                <span className="text-[11px] font-mono text-[var(--tl-text-muted)]">
                  {currentPlaylistVideos.length}{' '}
                  {isEn ? 'loaded videos' : 'vídeos carregados'}
                </span>
              </div>

              <div className="px-3.5 sm:px-0 flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-base font-bold text-[var(--tl-text-primary)] flex items-center gap-2 min-w-0">
                  <ListVideo className="w-4 h-4 text-[var(--tl-accent-text)] shrink-0" />
                  <span className="truncate">{selectedPlaylist.title}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => toggleFavoriteCreatorPlaylist(selectedPlaylist)}
                  aria-pressed={isCreatorPlaylistFavorited(selectedPlaylist)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    isCreatorPlaylistFavorited(selectedPlaylist)
                      ? 'bg-[var(--tl-accent-soft)] border-[var(--tl-accent-border)] text-[var(--tl-accent-text-strong)]'
                      : 'bg-[var(--tl-surface)] border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-accent-text)] hover:border-[var(--tl-accent-border)]'
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${isCreatorPlaylistFavorited(selectedPlaylist) ? 'fill-current text-[var(--tl-accent-text)]' : ''}`} />
                  <span>{isEn ? 'Favorite' : 'Favoritar'}</span>
                </button>
              </div>

              {/* Player Ativo da Playlist (quando o usuário clica em um vídeo) */}
              {activePlaylistVideoPost && (
                <div ref={activePlaylistPlayerRef} data-active-playlist-player className="relative mb-3 animate-in fade-in-50 duration-200">
                  <div className="flex justify-end px-3.5 sm:px-0 mb-1.5">
                    <button
                      type="button"
                      onClick={() => setActivePlaylistVideoId(null)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--tl-surface-elevated)] hover:bg-[var(--tl-accent-soft)] border border-[var(--tl-border)] text-[var(--tl-text-primary)] text-[11px] font-semibold transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Close player' : 'Fechar reprodutor'}</span>
                    </button>
                  </div>
                  <TimelinePostCard
                suspended={suspended}
                onOpenVideo={onOpenVideo}
                    key={`pl-active-player-${activePlaylistVideoPost.id}`}
                    post={activePlaylistVideoPost}
                    onOpenProfile={onOpenProfile}
                    onOpenComments={onOpenComments}
                    onOpenLightbox={onOpenLightbox}
                    isDesktop={isDesktop}
                    autoStartWithControls={true}
                  />
                </div>
              )}

              {playlistError?.id === selectedPlaylist.id ? (
                <div role="alert" className="flex flex-col items-center justify-center py-16 text-[var(--tl-text-muted)] gap-2">
                  <span className="text-xs">{playlistError.message}</span>
                  {selectedPlaylist.url && <button
                    type="button"
                    onClick={() => handleSelectPlaylist(selectedPlaylist)}
                    className="text-xs font-semibold text-[var(--tl-accent-text)] underline hover:text-[var(--tl-text-primary)]"
                  >{isEn ? 'Retry' : 'Tentar novamente'}</button>}
                </div>
              ) : loadingPlaylistId === selectedPlaylist.id && currentPlaylistVideos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--tl-text-muted)] gap-2">
                  <Loader2 className="w-7 h-7 animate-spin text-[var(--tl-accent-text)]" />
                  <span className="text-xs">{isEn ? 'Loading playlist videos...' : 'Carregando vídeos da playlist...'}</span>
                </div>
              ) : currentPlaylistVideos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--tl-text-muted)] gap-2">
                  {selectedPlaylist.url
                    && !Object.prototype.hasOwnProperty.call(playlistVideosMap, selectedPlaylist.id)
                    && !(selectedPlaylist.videos && selectedPlaylist.videos.length > 0) ? (
                    <>
                      <span className="text-xs">{isEn ? 'Playlist loading was interrupted.' : 'O carregamento da playlist foi interrompido.'}</span>
                      <button
                        type="button"
                        onClick={() => handleSelectPlaylist(selectedPlaylist)}
                        className="text-xs font-semibold text-[var(--tl-accent-text)] underline hover:text-[var(--tl-text-primary)]"
                      >{isEn ? 'Retry' : 'Tentar novamente'}</button>
                    </>
                  ) : (
                    <span className="text-xs">{isEn ? 'No videos found in this playlist.' : 'Nenhum vídeo encontrado nesta playlist.'}</span>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 px-3.5 sm:px-0">
                  {currentPlaylistVideos.map((video) => {
                    const isHovered = hoveredGridVideoId === video.id;
                    const streamForHover = buildTimelineStreamUrl(
                      video.previewVideoUrl || video.videoUrl || video.originalUrl,
                      video.originalUrl,
                      undefined,
                      video.youtubeId
                    );

                    return (
                      <div
                        key={video.id}
                        data-playlist-video-id={video.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${isEn ? 'Play' : 'Reproduzir'} ${video.title}`}
                        onKeyDown={activateCardOnKeyDown}
                        onMouseEnter={() => setHoveredGridVideoId(video.id)}
                        onMouseLeave={() =>
                          setHoveredGridVideoId((prev) => (prev === video.id ? null : prev))
                        }
                        onClick={event => {
                          event.currentTarget.focus({preventScroll:true});
                          if (onOpenVideo) { setHoveredGridVideoId(null); onOpenVideo(video, {currentTime: 0, isMuted: true, isPlaying: true, sourceRect:timelinePlaybackRect(event.currentTarget.querySelector('video, img') || event.currentTarget)}); return; }
                          setActivePlaylistVideoId(video.id);
                          setTimeout(() => {
                            activePlaylistPlayerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }, 60);
                        }}
                        className={`bg-[var(--tl-surface)] border ${
                          activePlaylistVideoId === video.id
                            ? 'border-[var(--tl-accent)] ring-2 ring-[var(--tl-accent-ring)]'
                            : 'border-[var(--tl-border)] hover:border-[var(--tl-accent-border)]'
                        } rounded-2xl overflow-hidden group cursor-pointer transition-all flex flex-col`}
                      >
                        <div className="relative aspect-video bg-black overflow-hidden">
                          {isHovered && video.youtubeId ? (
                            <iframe
                              src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&mute=1&controls=0&playsinline=1&modestbranding=1`}
                              title={video.title}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              className="w-full h-full object-cover pointer-events-none"
                            />
                          ) : isHovered && streamForHover ? (
                            <video
                              src={streamForHover}
                              autoPlay
                              muted
                              loop
                              playsInline
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <img
                              src={video.thumbnail || video.creatorAvatar}
                              alt={video.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                const rawThumb = video.thumbnail || video.creatorAvatar || '';
                                handleProxiedImageError(e, {
                                  rawUrl: rawThumb,
                                  referer: video.originalUrl || creator.profileUrl || rawThumb,
                                  fallbackSrc:
                                    video.thumbnail && creator.avatar && creator.avatar !== video.thumbnail
                                      ? creator.avatar
                                      : undefined,
                                  hideOnExhausted: true,
                                });
                              }}
                            />
                          )}
                          {!isHovered && (
                            <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors flex items-center justify-center pointer-events-none">
                              <div className="w-8 h-8 rounded-full bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                <Play className="w-4 h-4 fill-white ml-0.5" />
                              </div>
                            </div>
                          )}
                          {video.duration && (
                            <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white">
                              {video.duration}
                            </div>
                          )}
                        </div>

                        <div className="p-2 flex-1 flex flex-col justify-between">
                          <h4 className="text-[11px] font-bold text-[var(--tl-text-primary)] line-clamp-2 leading-tight">
                            {video.title}
                          </h4>
                          <div className="flex items-center justify-between text-[10px] text-[var(--tl-text-muted)] mt-1.5 font-mono">
                            <span>{video.views || video.resolution || '—'}</span>
                            <span>{video.duration || '—'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Lista / Grade de Playlists */
            <div className="grid grid-cols-2 gap-2.5 px-3.5 sm:px-0">
              {creatorPlaylists.map((playlist) => (
                <div
                  key={playlist.id}
                  data-playlist-card-id={playlist.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${isEn ? 'View playlist' : 'Ver playlist'} ${playlist.title}`}
                  onKeyDown={activateCardOnKeyDown}
                  onClick={() => handleSelectPlaylist(playlist)}
                  className="bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-accent-border)] rounded-2xl overflow-hidden group cursor-pointer transition-all flex flex-col shadow-lg"
                >
                  <div className="relative aspect-video bg-black overflow-hidden">
                    <img
                      src={playlist.thumbnailUrl || creator.avatar}
                      alt={playlist.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        const rawThumb = playlist.thumbnailUrl || creator.avatar || '';
                        handleProxiedImageError(e, {
                          rawUrl: rawThumb,
                          referer: playlist.url || creator.profileUrl || rawThumb,
                          fallbackSrc:
                            playlist.thumbnailUrl && creator.avatar && creator.avatar !== playlist.thumbnailUrl
                              ? creator.avatar
                              : undefined,
                          hideOnExhausted: true,
                        });
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-between p-2">
                      <div className="flex items-start justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavoriteCreatorPlaylist(playlist);
                          }}
                          aria-pressed={isCreatorPlaylistFavorited(playlist)}
                          aria-label={isEn ? `Favorite playlist ${playlist.title}` : `Favoritar playlist ${playlist.title}`}
                          title={isEn ? 'Favorite playlist' : 'Favoritar playlist'}
                          className={`p-1.5 rounded-full backdrop-blur-md border transition-colors ${
                            isCreatorPlaylistFavorited(playlist)
                              ? 'bg-[var(--tl-accent)] border-[var(--tl-accent-hover)] text-[var(--tl-accent-contrast)]'
                              : 'bg-black/65 border-white/10 text-gray-200 hover:text-[var(--tl-accent-text)]'
                          }`}
                        >
                          <Bookmark className={`w-3.5 h-3.5 ${isCreatorPlaylistFavorited(playlist) ? 'fill-white' : ''}`} />
                        </button>
                        <span className="px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md text-[10px] font-bold text-white flex items-center gap-1 border border-white/10">
                          <ListVideo className="w-3 h-3 text-[var(--tl-accent-text)]" />
                          <span>
                            {playlist.videoCount ?? (playlist.videos ? playlist.videos.length : '—')}{' '}
                            {isEn ? 'videos' : 'vídeos'}
                          </span>
                        </span>
                      </div>

                      <div className="w-8 h-8 rounded-full bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform self-center">
                        <Play className="w-4 h-4 fill-white ml-0.5" />
                      </div>

                      <span className="text-[9px] font-mono text-gray-300">
                        {playlist.updatedAt || (isEn ? 'Collection' : 'Coleção')}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5">
                    <h4 className="text-xs font-bold text-[var(--tl-text-primary)] line-clamp-2 leading-tight">
                      {playlist.title}
                    </h4>
                    <span className="text-[10px] text-[var(--tl-accent-text)] font-semibold mt-1 block">
                      {isEn ? 'View playlist' : 'Ver playlist'} →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conteúdo da Aba: Ensaios / Álbuns */}
      {activeProfileTab === 'albums' && (
        <>
          {albumPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--tl-text-muted)] gap-2">
              {isScanning ? (
                <>
                  <Loader2 className="w-7 h-7 animate-spin text-[var(--tl-accent-text)]" />
                  <span className="text-xs">{isEn ? 'Discovering albums...' : 'Descobrindo ensaios/álbuns...'}</span>
                </>
              ) : (
                <>
                  <Images className="w-8 h-8 opacity-60" />
                  <span className="text-xs">{isEn ? 'No photo albums found for this creator' : 'Nenhum ensaio/álbum encontrado para este criador'}</span>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 px-3.5 sm:px-0">
              {albumPosts.map((album) => {
                const cover =
                  (album.photos && album.photos[0]) || album.thumbnail || creator.avatar;
                return (
                  <div
                    key={album.id}
                    data-album-card-id={album.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${isEn ? 'Open album' : 'Abrir álbum'} ${album.title}`}
                    onKeyDown={activateCardOnKeyDown}
                    onClick={() =>
                      onOpenLightbox(
                        album.photos || [cover || ''],
                        0,
                        album.title,
                        album.albumUrl || album.originalUrl,
                        album.photoItems,
                        album.photoCount
                      )
                    }
                    className="relative aspect-square rounded-2xl overflow-hidden group cursor-pointer bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-accent-border)] transition-all shadow-lg"
                  >
                    <img
                      src={cover}
                      loading="lazy"
                      alt={album.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        const imgEl = e.currentTarget as HTMLImageElement;
                        const rawThumb =
                          (album.photos && album.photos[0]) || album.thumbnail || '';
                        if (!imgEl.dataset.fallbackThumb && rawThumb && imgEl.src !== rawThumb) {
                          imgEl.dataset.fallbackThumb = '1';
                          imgEl.src = rawThumb;
                          return;
                        }
                        handleProxiedImageError(e, {
                          rawUrl: rawThumb,
                          referer: album.albumUrl || album.originalUrl || creator.profileUrl,
                          fallbackSrc: creator.avatar,
                        });
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-between p-2.5">
                      <div className="flex justify-end">
                        <span className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-[10px] font-bold text-white flex items-center gap-1 border border-white/10">
                          <Images className="w-3 h-3 text-[var(--tl-accent-text)]" />
                          <span>
                            {album.photoCount ?? (album.photos ? album.photos.length : '—')}{' '}
                            {isEn ? 'photos' : 'fotos'}
                          </span>
                        </span>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold text-white line-clamp-2 leading-tight drop-shadow">
                          {album.title}
                        </h4>
                        <span className="text-[10px] text-gray-300 font-medium mt-0.5 block">
                          {album.date || (isEn ? 'Unknown date' : 'Data desconhecida')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Conteúdo da Aba: GIFs */}
      {activeProfileTab === 'gifs' && (
        <div className="grid grid-cols-2 gap-2.5 px-3.5 sm:px-0">
          {gifPosts.map((gif) => {
            const mediaUrl = (gif.photos && gif.photos[0]) || gif.previewVideoUrl || gif.thumbnail || '';
            const isVideoClip =
              mediaUrl.toLowerCase().endsWith('.webm') || mediaUrl.toLowerCase().endsWith('.mp4');
            const isHovered = hoveredGridVideoId === gif.id;

            return (
              <div
                key={gif.id}
                role="button"
                tabIndex={0}
                aria-label={`${isEn ? 'Open GIF' : 'Abrir GIF'} ${gif.title}`}
                onKeyDown={activateCardOnKeyDown}
                onMouseEnter={() => setHoveredGridVideoId(gif.id)}
                onMouseLeave={() =>
                  setHoveredGridVideoId((prev) => (prev === gif.id ? null : prev))
                }
                onClick={() =>
                  onOpenLightbox(
                    gif.photos || [mediaUrl],
                    0,
                    gif.title,
                    gif.originalUrl,
                    gif.photoItems
                  )
                }
                className="relative aspect-square rounded-2xl overflow-hidden group cursor-pointer bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-accent-border)] transition-all shadow-lg"
              >
                {isVideoClip && isHovered ? (
                  <video
                    src={buildTimelineStreamUrl(mediaUrl, gif.originalUrl)}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={gif.thumbnail || mediaUrl}
                    alt={gif.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      const rawThumb = gif.thumbnail || mediaUrl || '';
                      handleProxiedImageError(e, {
                        rawUrl: rawThumb,
                        referer: gif.originalUrl || creator.profileUrl || rawThumb,
                        fallbackSrc: creator.avatar || undefined,
                        hideOnExhausted: true,
                      });
                    }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-between p-2.5">
                  <div className="flex justify-end">
                    <span className="px-2 py-0.5 rounded-full bg-[var(--tl-accent)] backdrop-blur-md text-[10px] font-bold text-[var(--tl-accent-contrast)] border border-white/10">
                      GIF
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white line-clamp-2 leading-tight drop-shadow">
                    {gif.title}
                  </h4>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
