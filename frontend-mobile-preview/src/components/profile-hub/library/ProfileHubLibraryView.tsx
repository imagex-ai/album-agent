import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Bookmark,
  Check,
  Clock,
  ExternalLink,
  Film,
  Heart,
  History,
  Images,
  ListPlus,
  ListVideo,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  ThumbsUp,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { Language } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import {
  CreatorWatchReturnTarget,
  useProfileTimelineStore,
} from '../../../store/useProfileTimelineStore';
import { useProfileHubLibraryStore } from '../../../store/useProfileHubLibraryStore';
import { translations } from '../../../i18n/translations';
import { handleProxiedImageError } from '../../../services/profileHubImageFallback';
import {
  FavoritesMediaFilter,
  LibraryMediaItem,
  LibraryPlaylist,
  filterLibraryFavoritesByKind,
  libraryItemToTimelinePost,
} from '../../../services/profileHubLibraryModel';
import { TimelineWatchSession, TimelineWatchView } from '../timeline/TimelineWatchView';
import { TimelineLightboxState } from '../timeline/timelineModel';
import { PhotoLightboxModal } from '../timeline/PhotoLightboxModal';
import { SourceAvatar } from '../common/SourceAvatar';
import { useProfileAvatarStore } from '../../../store/useProfileAvatarStore';
import { fetchAlbumPhotos } from '../../../services/profileHubApi';

export type ProfileHubLibraryMode = 'history' | 'playlists' | 'favorites' | 'liked';

const LIBRARY_VIEW_BY_MODE: Record<ProfileHubLibraryMode, CreatorWatchReturnTarget['viewId']> = {
  history: 'timeline-history',
  playlists: 'timeline-playlists',
  favorites: 'timeline-favorites',
  liked: 'timeline-liked',
};

interface ProfileHubLibraryViewProps {
  mode: ProfileHubLibraryMode;
  onOpenMobileMenu?: () => void;
}

function formatActionTimestamp(ms: number | undefined, language: Language): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);
  if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    if (absSec < 60) return rtf.format(diffSec, 'second');
    if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (absSec < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
  }
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(ms));
}

function matchesSearch(item: LibraryMediaItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const fields = [
    item.title,
    item.creatorName,
    item.creatorHandle,
    item.platform,
    ...(item.tags || []),
  ];
  return fields.some((field) => field && field.toLowerCase().includes(normalizedQuery));
}

export const ProfileHubLibraryView: React.FC<ProfileHubLibraryViewProps> = ({
  mode,
  onOpenMobileMenu,
}) => {
  const language = useAppStore((state) => state.settings.language);
  const isEn = language === 'en-US';
  const navigateToView = useAppStore((state) => state.navigateToView);
  const addNotification = useAppStore((state) => state.addNotification);
  const setNotificationDrawerOpen = useAppStore((state) => state.setNotificationDrawerOpen);
  const unreadCount = useAppStore((state) => state.notifications.filter((n) => !n.isRead).length);

  const t = translations[language].profileHubLibrary;
  const sidebarT = translations[language].sidebar;

  const history = useProfileHubLibraryStore((state) => state.history);
  const liked = useProfileHubLibraryStore((state) => state.liked);
  const favorites = useProfileHubLibraryStore((state) => state.favorites);
  const playlists = useProfileHubLibraryStore((state) => state.playlists);
  const hydrateLibrary = useProfileHubLibraryStore((state) => state.hydrateLibrary);
  const removeHistoryItem = useProfileHubLibraryStore((state) => state.removeHistoryItem);
  const clearHistory = useProfileHubLibraryStore((state) => state.clearHistory);
  const setLikedItem = useProfileHubLibraryStore((state) => state.setLikedItem);
  const setFavoriteItem = useProfileHubLibraryStore((state) => state.setFavoriteItem);
  const createPlaylist = useProfileHubLibraryStore((state) => state.createPlaylist);
  const renamePlaylist = useProfileHubLibraryStore((state) => state.renamePlaylist);
  const deletePlaylist = useProfileHubLibraryStore((state) => state.deletePlaylist);
  const setPlaylistItem = useProfileHubLibraryStore((state) => state.setPlaylistItem);
  const openPlaylistModal = useProfileHubLibraryStore((state) => state.openPlaylistModal);

  const setPendingCreatorProfileUrl = useProfileTimelineStore((state) => state.setPendingCreatorProfileUrl);
  const pendingLibraryWatchRestore = useProfileTimelineStore((state) => state.pendingLibraryWatchRestore);
  const clearPendingLibraryWatchRestore = useProfileTimelineStore((state) => state.clearPendingLibraryWatchRestore);

  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoritesMediaFilter>('all');
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);

  // Playlists sub-navigation state
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editPlaylistName, setEditPlaylistName] = useState('');
  const [editPlaylistDesc, setEditPlaylistDesc] = useState('');
  const [confirmDeletePlaylistId, setConfirmDeletePlaylistId] = useState<string | null>(null);

  // Inline playback (Watch View + Album Lightbox)
  const [watchSession, setWatchSession] = useState<TimelineWatchSession | null>(null);
  const [watchPlaylistContext, setWatchPlaylistContext] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<TimelineLightboxState>({
    isOpen: false,
    images: [],
    items: [],
    currentIndex: 0,
    title: '',
    albumUrl: undefined,
    isLoadingAlbum: false,
  });

  useEffect(() => {
    void hydrateLibrary(true);
  }, [hydrateLibrary, mode]);

  useEffect(() => {
    setWatchSession(null);
    setWatchPlaylistContext(null);
    setConfirmClearHistory(false);
    setConfirmDeletePlaylistId(null);
    setEditingPlaylistId(null);
    if (mode !== 'playlists') {
      setSelectedPlaylistId(null);
    }
  }, [mode]);

  useEffect(() => {
    if (!pendingLibraryWatchRestore) return;
    if (pendingLibraryWatchRestore.viewId !== LIBRARY_VIEW_BY_MODE[mode]) return;
    if (pendingLibraryWatchRestore.playlistId && mode === 'playlists') {
      setSelectedPlaylistId(pendingLibraryWatchRestore.playlistId);
    }
    if (pendingLibraryWatchRestore.watchSession) {
      setWatchPlaylistContext(pendingLibraryWatchRestore.playlistId);
      setWatchSession(pendingLibraryWatchRestore.watchSession);
    }
    clearPendingLibraryWatchRestore();
  }, [pendingLibraryWatchRestore, mode, clearPendingLibraryWatchRestore]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const selectedPlaylist = useMemo<LibraryPlaylist | null>(
    () => (selectedPlaylistId ? playlists.find((pl) => pl.id === selectedPlaylistId) || null : null),
    [playlists, selectedPlaylistId]
  );

  const displayedItems = useMemo(() => {
    if (mode === 'history') {
      return history.filter((item) => matchesSearch(item, normalizedQuery));
    }
    if (mode === 'liked') {
      return liked.filter((item) => matchesSearch(item, normalizedQuery));
    }
    if (mode === 'favorites') {
      return filterLibraryFavoritesByKind(favorites, favoriteFilter).filter((item) =>
        matchesSearch(item, normalizedQuery)
      );
    }
    if (mode === 'playlists' && selectedPlaylist) {
      return selectedPlaylist.items.filter((item) => matchesSearch(item, normalizedQuery));
    }
    return [];
  }, [mode, history, liked, favorites, favoriteFilter, selectedPlaylist, normalizedQuery]);

  const filteredPlaylists = useMemo(() => {
    if (mode !== 'playlists' || selectedPlaylist) return [];
    if (!normalizedQuery) return playlists;
    return playlists.filter(
      (pl) =>
        pl.name.toLowerCase().includes(normalizedQuery) ||
        pl.description.toLowerCase().includes(normalizedQuery)
    );
  }, [mode, selectedPlaylist, playlists, normalizedQuery]);

  const handleOpenWatch = (item: LibraryMediaItem, playlistId: string | null = null) => {
    const post = libraryItemToTimelinePost(item);
    setWatchPlaylistContext(playlistId);
    setWatchSession({
      post,
      handoff: { currentTime: 0, isMuted: false, isPlaying: true },
      authorUrl: item.creatorUrl || undefined,
    });
  };

  const handleOpenAlbum = async (item: LibraryMediaItem) => {
    const initialImages = item.photos && item.photos.length > 0 ? item.photos : item.thumbnailUrl ? [item.thumbnailUrl] : [];
    setLightbox({
      isOpen: true,
      images: initialImages,
      items: initialImages.map((url) => ({ url, thumbnailUrl: url })),
      currentIndex: 0,
      title: item.title || t.unknownTitle,
      albumUrl: item.sourceUrl,
      isLoadingAlbum: Boolean(item.sourceUrl && initialImages.length <= 1),
    });
    if (item.sourceUrl) {
      try {
        const res = await fetchAlbumPhotos(item.sourceUrl);
        if (Array.isArray(res.photos) && res.photos.length > 0) {
          const resolvedItems = res.photos
            .map((photo) => {
              const url = photo.originalUrl || photo.thumbnailUrl || '';
              if (!url) return null;
              return {
                url,
                thumbnailUrl: photo.thumbnailUrl,
                pageUrl: photo.pageUrl,
              };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
          if (resolvedItems.length > 0) {
            setLightbox((prev) => ({
              ...prev,
              images: resolvedItems.map((entry) => entry.url),
              items: resolvedItems,
              isLoadingAlbum: false,
            }));
            return;
          }
        }
      } catch {
        // Keep available cover image on fetch failure.
      }
      setLightbox((prev) => ({ ...prev, isLoadingAlbum: false }));
    }
  };

  const handleActivateItem = (item: LibraryMediaItem, playlistId: string | null = null) => {
    if (item.kind === 'album') {
      void handleOpenAlbum(item);
      return;
    }
    if (item.kind === 'playlist') {
      if (item.creatorUrl) {
        setPendingCreatorProfileUrl(item.creatorUrl);
        navigateToView('timeline-preview');
        return;
      }
      if (item.sourceUrl) {
        window.open(item.sourceUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    handleOpenWatch(item, playlistId);
  };

  const handleOpenCreator = (creatorUrl: string, seed?: { name?: string; avatar?: string | null }) => {
    const isDesktopViewport = typeof window !== 'undefined' && window.innerWidth >= 768;
    const returnTarget: CreatorWatchReturnTarget = {
      viewId: LIBRARY_VIEW_BY_MODE[mode],
      watchSession,
      playlistId: selectedPlaylistId || watchPlaylistContext || null,
      preferDesktopPreview: isDesktopViewport,
    };
    setWatchSession(null);
    setPendingCreatorProfileUrl(creatorUrl, seed || null, returnTarget);
    navigateToView('timeline-preview');
  };

  const handleCreatePlaylist = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    const created = await createPlaylist(trimmed, newPlaylistDesc.trim());
    if (created) {
      addNotification({
        type: 'success',
        title: created.name,
        message: t.playlistCreatedToast.replace('{name}', created.name),
      });
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      setCreatingPlaylist(false);
    }
  };

  const handleSaveRename = async (event: React.FormEvent, playlistId: string) => {
    event.preventDefault();
    const trimmed = editPlaylistName.trim();
    if (!trimmed) return;
    await renamePlaylist(playlistId, trimmed, editPlaylistDesc.trim());
    setEditingPlaylistId(null);
  };

  const handleConfirmDeletePlaylist = async (playlistId: string) => {
    await deletePlaylist(playlistId);
    setConfirmDeletePlaylistId(null);
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
    }
    addNotification({
      type: 'info',
      title: sidebarT.hubPlaylists,
      message: t.playlistDeletedToast,
    });
  };

  const headerMeta: Record<ProfileHubLibraryMode, { title: string; subtitle: string; icon: React.ReactNode; count: number }> = {
    history: {
      title: t.historyTitle,
      subtitle: t.historySubtitle,
      icon: <History className="w-5 h-5 text-[var(--tl-accent-text)] shrink-0" />,
      count: history.length,
    },
    playlists: {
      title: selectedPlaylist ? selectedPlaylist.name : t.playlistsTitle,
      subtitle: selectedPlaylist
        ? (selectedPlaylist.description || t.playlistsSubtitle)
        : t.playlistsSubtitle,
      icon: <ListVideo className="w-5 h-5 text-[var(--tl-accent-text)] shrink-0" />,
      count: selectedPlaylist ? selectedPlaylist.items.length : playlists.length,
    },
    favorites: {
      title: t.favoritesTitle,
      subtitle: t.favoritesSubtitle,
      icon: <Heart className="w-5 h-5 text-[var(--tl-accent-text)] shrink-0" />,
      count: filterLibraryFavoritesByKind(favorites, 'all').length,
    },
    liked: {
      title: t.likedTitle,
      subtitle: t.likedSubtitle,
      icon: <ThumbsUp className="w-5 h-5 text-rose-400 shrink-0" />,
      count: liked.length,
    },
  };

  const meta = headerMeta[mode];
  const quickTabs: Array<{ mode: ProfileHubLibraryMode; viewId: 'timeline-history' | 'timeline-playlists' | 'timeline-favorites' | 'timeline-liked'; label: string }> = [
    { mode: 'history', viewId: 'timeline-history', label: sidebarT.hubHistory },
    { mode: 'playlists', viewId: 'timeline-playlists', label: sidebarT.hubPlaylists },
    { mode: 'favorites', viewId: 'timeline-favorites', label: sidebarT.hubFavorites },
    { mode: 'liked', viewId: 'timeline-liked', label: sidebarT.hubLiked },
  ];

  const activeWatchPlaylist = watchPlaylistContext
    ? playlists.find((pl) => pl.id === watchPlaylistContext) || null
    : null;

  return (
    <div className="flex-1 tl-themed bg-[var(--tl-bg)] text-[var(--tl-text-primary)] flex flex-col w-full max-w-full min-w-0">
      {/* Mobile Header matching Timeline's approved app-icon + IMAGEX menu trigger */}
      <header className="md:hidden sticky top-0 z-40 bg-[var(--tl-surface-glass)] backdrop-blur-xl border-b border-[var(--tl-border)] px-3.5 py-2.5 shrink-0 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenMobileMenu?.()}
          className="flex items-center gap-2.5 min-w-0 cursor-pointer group rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tl-accent-text)]"
          title={isEn ? 'Open navigation menu' : 'Abrir menu de navegação'}
          aria-label={isEn ? 'Open navigation menu' : 'Abrir menu de navegação'}
        >
          <img
            src="/app-icon.png"
            alt="IMAGEX"
            className="w-7 h-7 rounded-lg object-cover shadow-md shrink-0"
          />
          <span className="font-extrabold text-sm text-[var(--tl-text-primary)] tracking-tight truncate">
            IMAGEX
          </span>
        </button>

        <button
          type="button"
          onClick={() => setNotificationDrawerOpen(true)}
          className="w-8 h-8 rounded-full bg-[var(--tl-surface-elevated)] border border-[var(--tl-border-strong)] flex items-center justify-center text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] transition-colors relative shrink-0"
          title={isEn ? 'Notifications' : 'Notificações'}
          aria-label={isEn ? `Notifications (${unreadCount} unread)` : `Notificações (${unreadCount} não lidas)`}
        >
          <Bell className="w-3.5 h-3.5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--tl-accent)] ring-2 ring-[var(--tl-surface)]" />
          )}
        </button>
      </header>

      {watchSession ? (
        <div className="w-full max-w-7xl mx-auto px-0 sm:px-6 py-2 sm:py-4 space-y-4">
          {activeWatchPlaylist && activeWatchPlaylist.items.length > 1 && (
            <div className="mx-3.5 sm:mx-0 rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border)] p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <ListVideo className="w-4 h-4 text-[var(--tl-accent-text)] shrink-0" />
                <span className="text-xs font-bold text-[var(--tl-text-primary)] truncate">
                  {activeWatchPlaylist.name}
                </span>
                <span className="text-[11px] text-[var(--tl-text-muted)] shrink-0">
                  • {t.playlistVideosUpNext}
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-full no-scrollbar">
                {activeWatchPlaylist.items
                  .filter((plItem) => plItem.kind === 'video' || plItem.kind === 'gif')
                  .slice(0, 8)
                  .map((plItem) => {
                    const activeItem = plItem.id === watchSession.post.id;
                    return (
                      <button
                        key={plItem.key}
                        type="button"
                        onClick={() => handleOpenWatch(plItem, activeWatchPlaylist.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold truncate max-w-[160px] transition-colors ${
                          activeItem
                            ? 'bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)]'
                            : 'bg-[var(--tl-surface-elevated)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)]'
                        }`}
                      >
                        {plItem.title || t.unknownTitle}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
          <TimelineWatchView
            session={watchSession}
            active={true}
            onClose={() => {
              setWatchSession(null);
              setWatchPlaylistContext(null);
            }}
            onChangeVideo={(next) => {
              setWatchSession(next);
              return true;
            }}
            onOpenCreator={handleOpenCreator}
          />
        </div>
      ) : (
        <div className="w-full max-w-6xl mx-auto px-3.5 sm:px-6 py-4 sm:py-6 space-y-4 pb-24">
          {/* Header & Primary Action */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              {mode === 'playlists' && selectedPlaylist && (
                <button
                  type="button"
                  data-back-to-playlists
                  onClick={() => {
                    setSelectedPlaylistId(null);
                    setEditingPlaylistId(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--tl-accent-text)] hover:text-[var(--tl-text-primary)] mb-1 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{t.backToPlaylists}</span>
                </button>
              )}
              <div className="flex items-center gap-2.5 min-w-0">
                {meta.icon}
                <h1 className="text-xl sm:text-2xl font-black text-[var(--tl-text-primary)] tracking-tight break-words min-w-0">
                  {meta.title}
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-[var(--tl-surface-elevated)] border border-[var(--tl-border-strong)] text-xs font-mono text-[var(--tl-accent-text)] shrink-0">
                  {meta.count}
                </span>
              </div>
              <p className="text-xs text-[var(--tl-text-muted)] break-words">{meta.subtitle}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {mode === 'playlists' && !selectedPlaylist && (
                <button
                  type="button"
                  data-new-playlist-button
                  onClick={() => setCreatingPlaylist((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] text-xs font-bold text-[var(--tl-accent-contrast)] shadow-lg shadow-[var(--tl-accent-shadow)] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t.newPlaylist}</span>
                </button>
              )}

              {mode === 'playlists' && selectedPlaylist && (
                <>
                  {selectedPlaylist.items.some((entry) => entry.kind === 'video' || entry.kind === 'gif') && (
                    <button
                      type="button"
                      data-playlist-play-all
                      onClick={() => {
                        const first = selectedPlaylist.items.find((entry) => entry.kind === 'video' || entry.kind === 'gif');
                        if (first) handleOpenWatch(first, selectedPlaylist.id);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] text-xs font-bold text-[var(--tl-accent-contrast)] transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{t.playAll}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPlaylistId(selectedPlaylist.id);
                      setEditPlaylistName(selectedPlaylist.name);
                      setEditPlaylistDesc(selectedPlaylist.description);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--tl-surface-elevated)] border border-[var(--tl-border-strong)] hover:border-[var(--tl-accent-border)] text-xs font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>{t.renamePlaylist}</span>
                  </button>
                </>
              )}

              {mode === 'history' && history.length > 0 && (
                confirmClearHistory ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-confirm-clear-history
                      onClick={() => {
                        void clearHistory();
                        setConfirmClearHistory(false);
                        addNotification({
                          type: 'info',
                          title: t.historyTitle,
                          message: t.historyClearedToast,
                        });
                      }}
                      className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition-colors"
                    >
                      {t.confirmClearHistory}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearHistory(false)}
                      className="px-3 py-1.5 rounded-xl bg-[var(--tl-surface-elevated)] border border-[var(--tl-border-strong)] text-xs font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] transition-colors"
                    >
                      {t.cancel}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-clear-history
                    onClick={() => setConfirmClearHistory(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--tl-surface-elevated)] border border-[var(--tl-border-strong)] hover:border-rose-500/40 text-xs font-semibold text-[var(--tl-text-secondary)] hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.clearHistory}</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* Quick section tabs */}
          <nav aria-label={sidebarT.profileHub} className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {quickTabs.map((tab) => (
              <button
                key={tab.viewId}
                type="button"
                aria-current={mode === tab.mode ? 'page' : undefined}
                onClick={() => navigateToView(tab.viewId)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${
                  mode === tab.mode
                    ? 'bg-[var(--tl-accent-soft)] border-[var(--tl-accent-border)] text-[var(--tl-accent-text-strong)]'
                    : 'bg-[var(--tl-surface)] border-[var(--tl-border)] text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Search & Favorites Media Type Filters (ONLY Videos / Albums / Playlists / GIFs) */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-[var(--tl-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                data-library-search
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full rounded-xl bg-[var(--tl-surface)] border border-[var(--tl-border)] pl-9 pr-3 py-2 text-xs text-[var(--tl-text-primary)] placeholder-[var(--tl-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-ring)]"
              />
            </div>

            {mode === 'favorites' && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0" role="group" aria-label={t.favoritesTitle}>
                {(
                  [
                    { id: 'all', label: t.filterAll },
                    { id: 'video', label: t.filterVideos },
                    { id: 'album', label: t.filterAlbums },
                    { id: 'playlist', label: t.filterPlaylists },
                    { id: 'gif', label: t.filterGifs },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    data-favorites-filter={chip.id}
                    aria-pressed={favoriteFilter === chip.id}
                    onClick={() => setFavoriteFilter(chip.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border transition-colors ${
                      favoriteFilter === chip.id
                        ? 'bg-[var(--tl-accent)] border-[var(--tl-accent-border)] text-[var(--tl-accent-contrast)]'
                        : 'bg-[var(--tl-surface)] border-[var(--tl-border)] text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Inline Create Playlist Form */}
          {mode === 'playlists' && !selectedPlaylist && creatingPlaylist && (
            <form
              onSubmit={(e) => void handleCreatePlaylist(e)}
              data-create-playlist-panel
              className="rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-accent-border)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[var(--tl-text-primary)]">{t.createPlaylist}</h2>
                <button
                  type="button"
                  onClick={() => setCreatingPlaylist(false)}
                  aria-label={t.closeModal}
                  className="p-1 rounded-lg text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="lib-new-playlist-name" className="block text-[11px] font-semibold text-[var(--tl-text-secondary)] mb-1">
                    {t.playlistNameLabel}
                  </label>
                  <input
                    id="lib-new-playlist-name"
                    type="text"
                    required
                    data-library-playlist-name
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    placeholder={t.playlistNamePlaceholder}
                    maxLength={120}
                    className="w-full rounded-xl bg-[var(--tl-bg)] border border-[var(--tl-border-strong)] px-3 py-2 text-xs text-[var(--tl-text-primary)] placeholder-[var(--tl-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-ring)]"
                  />
                </div>
                <div>
                  <label htmlFor="lib-new-playlist-desc" className="block text-[11px] font-semibold text-[var(--tl-text-secondary)] mb-1">
                    {t.playlistDescriptionLabel}
                  </label>
                  <input
                    id="lib-new-playlist-desc"
                    type="text"
                    value={newPlaylistDesc}
                    onChange={(e) => setNewPlaylistDesc(e.target.value)}
                    placeholder={t.playlistDescriptionPlaceholder}
                    maxLength={400}
                    className="w-full rounded-xl bg-[var(--tl-bg)] border border-[var(--tl-border-strong)] px-3 py-2 text-xs text-[var(--tl-text-primary)] placeholder-[var(--tl-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-ring)]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreatingPlaylist(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)]"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  data-library-create-playlist-submit
                  disabled={!newPlaylistName.trim()}
                  className="px-4 py-1.5 rounded-xl bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] disabled:opacity-50 text-xs font-bold text-[var(--tl-accent-contrast)] transition-colors"
                >
                  {t.createPlaylist}
                </button>
              </div>
            </form>
          )}

          {/* Inline Rename Form */}
          {mode === 'playlists' && editingPlaylistId && (
            <form
              onSubmit={(e) => void handleSaveRename(e, editingPlaylistId)}
              className="rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-accent-border)] p-4 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="lib-edit-playlist-name" className="block text-[11px] font-semibold text-[var(--tl-text-secondary)] mb-1">
                    {t.playlistNameLabel}
                  </label>
                  <input
                    id="lib-edit-playlist-name"
                    type="text"
                    required
                    value={editPlaylistName}
                    onChange={(e) => setEditPlaylistName(e.target.value)}
                    maxLength={120}
                    className="w-full rounded-xl bg-[var(--tl-bg)] border border-[var(--tl-border-strong)] px-3 py-2 text-xs text-[var(--tl-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-ring)]"
                  />
                </div>
                <div>
                  <label htmlFor="lib-edit-playlist-desc" className="block text-[11px] font-semibold text-[var(--tl-text-secondary)] mb-1">
                    {t.playlistDescriptionLabel}
                  </label>
                  <input
                    id="lib-edit-playlist-desc"
                    type="text"
                    value={editPlaylistDesc}
                    onChange={(e) => setEditPlaylistDesc(e.target.value)}
                    maxLength={400}
                    className="w-full rounded-xl bg-[var(--tl-bg)] border border-[var(--tl-border-strong)] px-3 py-2 text-xs text-[var(--tl-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-ring)]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingPlaylistId(null)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)]"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] text-xs font-bold text-[var(--tl-accent-contrast)]"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{t.saveChanges}</span>
                </button>
              </div>
            </form>
          )}

          {/* PLAYLISTS OVERVIEW GRID */}
          {mode === 'playlists' && !selectedPlaylist ? (
            filteredPlaylists.length === 0 ? (
              <div className="rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border)] p-8 text-center space-y-3">
                <ListVideo className="w-10 h-10 text-[var(--tl-accent-text)] opacity-75 mx-auto" />
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-[var(--tl-text-primary)]">
                    {normalizedQuery ? t.emptySearchTitle : t.emptyPlaylistsTitle}
                  </h2>
                  <p className="text-xs text-[var(--tl-text-muted)] max-w-md mx-auto">
                    {normalizedQuery ? t.emptySearchDesc : t.emptyPlaylistsDesc}
                  </p>
                </div>
                {!normalizedQuery && (
                  <button
                    type="button"
                    onClick={() => setCreatingPlaylist(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] text-xs font-bold text-[var(--tl-accent-contrast)]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t.createPlaylist}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredPlaylists.map((playlist) => {
                  const thumbItems = playlist.items
                    .filter((item): item is LibraryMediaItem & { thumbnailUrl: string } => Boolean(item.thumbnailUrl))
                    .slice(0, 4);
                  const countLabel =
                    playlist.items.length === 1 ? t.itemsCountSingular : t.itemsCountPlural;
                  const confirmingDelete = confirmDeletePlaylistId === playlist.id;
                  return (
                    <div
                      key={playlist.id}
                      data-library-playlist-card={playlist.id}
                      className="rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-accent-border)] overflow-hidden flex flex-col transition-colors shadow-lg"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPlaylistId(playlist.id)}
                        className="text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-text)]"
                      >
                        <div className="relative aspect-video bg-[var(--tl-surface-elevated)] overflow-hidden">
                          {thumbItems.length >= 4 ? (
                            <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-0.5 bg-[var(--tl-surface-elevated)]">
                              {thumbItems.map((thumbItem, idx) => (
                                <img
                                  key={`${playlist.id}-${idx}`}
                                  src={thumbItem.thumbnailUrl}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                  onError={(e) =>
                                    handleProxiedImageError(e, {
                                      rawUrl: thumbItem.thumbnailUrl,
                                      referer: thumbItem.sourceUrl || thumbItem.creatorUrl,
                                      hideOnExhausted: true,
                                    })
                                  }
                                />
                              ))}
                            </div>
                          ) : thumbItems.length > 0 ? (
                            <img
                              src={thumbItems[0].thumbnailUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) =>
                                handleProxiedImageError(e, {
                                  rawUrl: thumbItems[0].thumbnailUrl,
                                  referer: thumbItems[0].sourceUrl || thumbItems[0].creatorUrl,
                                  hideOnExhausted: true,
                                })
                              }
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-[var(--tl-surface-elevated)]">
                              <ListVideo className="w-10 h-10 text-[var(--tl-accent-text)] opacity-65" />
                            </div>
                          )}
                          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/80 text-[11px] font-bold text-white border border-white/10">
                            {playlist.items.length} {countLabel}
                          </div>
                        </div>
                      </button>

                      <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => setSelectedPlaylistId(playlist.id)}
                          className="text-left min-w-0 space-y-0.5"
                        >
                          <h2 className="text-sm font-bold text-[var(--tl-text-primary)] truncate">{playlist.name}</h2>
                          {playlist.description && (
                            <p className="text-xs text-[var(--tl-text-muted)] line-clamp-2 break-words">
                              {playlist.description}
                            </p>
                          )}
                        </button>

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--tl-border)]">
                          <span className="text-[11px] text-[var(--tl-text-muted)]">
                            {formatActionTimestamp(playlist.updatedAt, language)}
                          </span>
                          <div className="flex items-center gap-1">
                            {confirmingDelete ? (
                              <>
                                <button
                                  type="button"
                                  data-confirm-delete-playlist={playlist.id}
                                  onClick={() => void handleConfirmDeletePlaylist(playlist.id)}
                                  className="px-2 py-1 rounded-lg bg-rose-600 text-[11px] font-bold text-white"
                                >
                                  {t.confirmDeletePlaylist}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeletePlaylistId(null)}
                                  className="px-2 py-1 rounded-lg text-[11px] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)]"
                                >
                                  {t.cancel}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPlaylistId(playlist.id);
                                    setEditPlaylistName(playlist.name);
                                    setEditPlaylistDesc(playlist.description);
                                  }}
                                  aria-label={t.renamePlaylist}
                                  title={t.renamePlaylist}
                                  className="p-1.5 rounded-lg text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  data-delete-playlist={playlist.id}
                                  onClick={() => setConfirmDeletePlaylistId(playlist.id)}
                                  aria-label={t.deletePlaylist}
                                  title={t.deletePlaylist}
                                  className="p-1.5 rounded-lg text-[var(--tl-text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : displayedItems.length === 0 ? (
            <div className="rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border)] p-8 text-center space-y-3">
              {mode === 'history' && <Clock className="w-10 h-10 text-[var(--tl-accent-text)] opacity-75 mx-auto" />}
              {mode === 'liked' && <ThumbsUp className="w-10 h-10 text-rose-400 opacity-75 mx-auto" />}
              {mode === 'favorites' && <Bookmark className="w-10 h-10 text-[var(--tl-accent-text)] opacity-75 mx-auto" />}
              {mode === 'playlists' && <ListVideo className="w-10 h-10 text-[var(--tl-accent-text)] opacity-75 mx-auto" />}
              <div className="space-y-1">
                <h2 className="text-sm font-bold text-[var(--tl-text-primary)]">
                  {normalizedQuery
                    ? t.emptySearchTitle
                    : mode === 'history'
                      ? t.emptyHistoryTitle
                      : mode === 'liked'
                        ? t.emptyLikedTitle
                        : mode === 'favorites'
                          ? t.emptyFavoritesTitle
                          : t.emptyPlaylistDetailTitle}
                </h2>
                <p className="text-xs text-[var(--tl-text-muted)] max-w-md mx-auto">
                  {normalizedQuery
                    ? t.emptySearchDesc
                    : mode === 'history'
                      ? t.emptyHistoryDesc
                      : mode === 'liked'
                        ? t.emptyLikedDesc
                        : mode === 'favorites'
                          ? t.emptyFavoritesDesc
                          : t.emptyPlaylistDetailDesc}
                </p>
              </div>
              {!normalizedQuery && mode !== 'playlists' && (
                <button
                  type="button"
                  onClick={() => navigateToView('timeline-preview')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] text-xs font-bold text-[var(--tl-accent-contrast)]"
                >
                  <span>{t.exploreTimelineCta}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {displayedItems.map((item) => {
                const timestamp = formatActionTimestamp(
                  mode === 'history'
                    ? item.watchedAt || item.addedAt
                    : mode === 'liked'
                      ? item.likedAt || item.addedAt
                      : item.addedAt,
                  language
                );
                const creatorDisplay = item.creatorName || item.creatorHandle || item.platform || '';
                const kindBadge =
                  item.kind === 'album'
                    ? { icon: <Images className="w-3 h-3" />, label: t.filterAlbums }
                    : item.kind === 'playlist'
                      ? { icon: <ListVideo className="w-3 h-3" />, label: t.filterPlaylists }
                      : item.kind === 'gif'
                        ? { icon: <Sparkles className="w-3 h-3" />, label: t.filterGifs }
                        : { icon: <Film className="w-3 h-3" />, label: t.filterVideos };

                return (
                  <article
                    key={item.key}
                    data-library-card={item.key}
                    className="rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border)] hover:border-[var(--tl-accent-border)] overflow-hidden flex flex-col transition-colors shadow-lg min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() => handleActivateItem(item, selectedPlaylist?.id || null)}
                      className="text-left group relative aspect-video bg-black overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-text)]"
                    >
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title || t.unknownTitle}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={(e) =>
                            handleProxiedImageError(e, {
                              rawUrl: item.thumbnailUrl,
                              referer: item.sourceUrl || item.creatorUrl,
                              hideOnExhausted: true,
                            })
                          }
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-[var(--tl-surface-elevated)]">
                          <Play className="w-9 h-9 text-[var(--tl-accent-text)] opacity-75" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25 pointer-events-none" />
                      <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 text-[10px] font-bold text-white border border-white/10">
                        {kindBadge.icon}
                        <span>{kindBadge.label}</span>
                      </div>
                      {item.duration && (
                        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 font-mono text-[10px] font-bold text-white">
                          {item.duration}
                        </span>
                      )}
                      {item.kind === 'album' && item.imageCount != null && (
                        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 font-mono text-[10px] font-bold text-white">
                          {item.imageCount}
                        </span>
                      )}
                    </button>

                    <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5 min-w-0">
                      <div className="space-y-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleActivateItem(item, selectedPlaylist?.id || null)}
                          className="text-left w-full"
                        >
                          <h2 className="text-xs sm:text-sm font-bold text-[var(--tl-text-primary)] line-clamp-2 break-words hover:text-[var(--tl-accent-text)] transition-colors">
                            {item.title || t.unknownTitle}
                          </h2>
                        </button>

                        <div className="flex items-center justify-between gap-2 min-w-0">
                          {item.creatorUrl ? (
                            <button
                              type="button"
                              onClick={() => {
                                const resolvedAvatar =
                                  item.creatorAvatar ||
                                  useProfileAvatarStore.getState().getAvatarEntry(item.creatorUrl)?.avatarUrl ||
                                  null;
                                handleOpenCreator(item.creatorUrl!, {
                                  name: creatorDisplay || undefined,
                                  avatar: resolvedAvatar,
                                });
                              }}
                              className="inline-flex items-center gap-1.5 min-w-0 text-xs text-[var(--tl-text-secondary)] hover:text-[var(--tl-accent-text)] transition-colors"
                            >
                              <SourceAvatar
                                name={creatorDisplay || 'creator'}
                                src={item.creatorAvatar}
                                profileUrl={item.creatorUrl}
                                referer={item.creatorUrl || item.sourceUrl}
                                hydrate
                                className="w-5 h-5 rounded-full object-cover shrink-0 bg-[var(--tl-surface-elevated)]"
                              />
                              <span className="truncate font-medium">
                                {creatorDisplay}
                              </span>
                            </button>
                          ) : creatorDisplay ? (
                            <span className="inline-flex items-center gap-1.5 min-w-0 text-xs text-[var(--tl-text-muted)]">
                              <UserRound className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{creatorDisplay}</span>
                            </span>
                          ) : (
                            <span />
                          )}

                          {timestamp && (
                            <span className="text-[11px] text-[var(--tl-text-muted)] shrink-0 whitespace-nowrap">
                              {timestamp}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--tl-border)]">
                        <div className="flex items-center gap-2 min-w-0">
                          {mode === 'history' && item.watchCount && item.watchCount > 1 && (
                            <span className="text-[10px] font-mono text-[var(--tl-accent-text)] bg-[var(--tl-accent-soft)] px-2 py-0.5 rounded-full border border-[var(--tl-accent-border)]">
                              {t.watchedCountLabel.replace('{count}', String(item.watchCount))}
                            </span>
                          )}
                          {item.sourceUrl && (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={t.openOriginalSource}
                              aria-label={t.openOriginalSource}
                              className="p-1.5 rounded-lg text-[var(--tl-text-muted)] hover:text-[var(--tl-accent-text)] hover:bg-[var(--tl-surface-hover)] transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {item.kind !== 'playlist' && (
                            <button
                              type="button"
                              data-library-add-to-playlist
                              onClick={() => openPlaylistModal(item)}
                              title={t.addToPlaylist}
                              aria-label={t.addToPlaylist}
                              className="p-1.5 rounded-lg text-[var(--tl-text-muted)] hover:text-[var(--tl-accent-text)] hover:bg-[var(--tl-accent-soft)] transition-colors"
                            >
                              <ListPlus className="w-4 h-4" />
                            </button>
                          )}

                          {mode === 'history' && (
                            <button
                              type="button"
                              data-library-remove-item
                              onClick={() => void removeHistoryItem(item.key)}
                              title={t.removeFromHistory}
                              aria-label={t.removeFromHistory}
                              className="p-1.5 rounded-lg text-[var(--tl-text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}

                          {mode === 'liked' && (
                            <button
                              type="button"
                              data-library-remove-item
                              onClick={() => void setLikedItem(item, false)}
                              title={t.unlike}
                              aria-label={t.unlike}
                              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                            >
                              <Heart className="w-4 h-4 fill-rose-500" />
                            </button>
                          )}

                          {mode === 'favorites' && (
                            <button
                              type="button"
                              data-library-remove-item
                              onClick={() => void setFavoriteItem(item, false)}
                              title={t.unfavorite}
                              aria-label={t.unfavorite}
                              className="p-1.5 rounded-lg text-[var(--tl-accent-text)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                              <Bookmark className="w-4 h-4 fill-current" />
                            </button>
                          )}

                          {mode === 'playlists' && selectedPlaylist && (
                            <button
                              type="button"
                              data-library-remove-item
                              onClick={() => void setPlaylistItem(selectedPlaylist.id, item, false)}
                              title={t.removeFromPlaylist}
                              aria-label={t.removeFromPlaylist}
                              className="p-1.5 rounded-lg text-[var(--tl-text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      <PhotoLightboxModal
        lightbox={lightbox}
        onClose={() => setLightbox((prev) => ({ ...prev, isOpen: false, isLoadingAlbum: false }))}
        onNext={() =>
          setLightbox((prev) => ({
            ...prev,
            currentIndex: prev.images.length ? (prev.currentIndex + 1) % prev.images.length : 0,
          }))
        }
        onPrev={() =>
          setLightbox((prev) => ({
            ...prev,
            currentIndex: prev.images.length
              ? (prev.currentIndex - 1 + prev.images.length) % prev.images.length
              : 0,
          }))
        }
      />
    </div>
  );
};
