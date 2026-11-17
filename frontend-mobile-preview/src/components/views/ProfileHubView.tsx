import { QuickProfileFavorites } from '../profile-hub/QuickProfileFavorites';
import { SavedDirectories } from '../profile-hub/SavedDirectories';
import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React, { useState, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { 
  Search,
  Star, Link as LinkIcon, ChevronDown, ArrowLeft, 
  Loader2, 
  Globe, 
  Sparkles, 
  X,
  AlertCircle,
  Play,
  Check,
  Film,
  Images,
  ListMusic,
  Heart,
  Clock3,
  Smartphone,
  Home, Compass
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { 
  ProfileCategoryTab, 
  ActiveSidePanel, 
  MediaItemCard, 
  PlaylistItem, 
  AlbumItem, 
  HighlightItem,
  ProfileHeroData 
} from '../profile-hub/profileHubTypes';
import { ProfileHeader } from '../profile-hub/ProfileHeader';
import { ProfileTabBar } from '../profile-hub/ProfileTabBar';
import { HighlightsSection } from '../profile-hub/HighlightsSection';
import { PlaylistsSection } from '../profile-hub/PlaylistsSection';
import { AlbumsSection } from '../profile-hub/AlbumsSection';
import { CollectionDetailPanel } from '../profile-hub/CollectionDetailPanel';
import { ReviewSelectionPanel } from '../profile-hub/ReviewSelectionPanel';
import { AllPlaylistsPanel } from '../profile-hub/AllPlaylistsPanel';
import { AllAlbumsPanel } from '../profile-hub/AllAlbumsPanel';
import { FloatingActionBar } from '../profile-hub/FloatingActionBar';
import { ProfileReviewPage } from '../profile-hub/ProfileReviewPage';
import { ProfileHubSelectionBar } from '../profile-hub/ProfileHubSelectionBar';
import { ProfileTabsBar } from '../profile-hub/ProfileTabsBar';
import { ProfileSourceLabel } from '../profile-hub/ProfileSourceLabel';
import { FolderSelectModal } from '../common/FolderSelectModal';
import { 
  discoverProfileRoot,
  loadProfileMetadata,
  MetadataTarget,
  MetadataResult,
  ProfileRoot,
  fetchAlbumPhotos,
  fetchPlaylistVideos,
  batchSaveProfileHub,
  downloadProfileSelection
} from '../../services/profileHubApi';

import { createProfileHubSession, getGlobalProfileSelection, useProfileHubField, useProfileHubStore, profileHubFieldSetter } from '../../store/useProfileHubStore';
import { useProfileDirectoryStore } from '../../store/useProfileDirectoryStore';
import { discoverProfileDirectory, resolveProfileHubInput } from '../../services/profileDirectoryApi';
import { hubNavigation } from '../../services/profileHubRuntime';
import { ProfileDirectoryPanel } from '../profile-hub/ProfileDirectoryPanel';
import { DirectoryActionsMenu, DirectoryShortcutsDialog } from '../profile-hub/DirectoryControls';
import { profileDirectoryCopy } from '../../services/profileDirectoryCopy';
import { profileHubReviewCopy } from '../../services/profileHubReviewCopy';
import { useProfileHubExecutionStore } from '../../store/useProfileHubExecutionStore';
import { useProfileDirectoryLibraryStore, shortcutKey, type ProfileShortcut } from '../../store/useProfileDirectoryLibraryStore';
import '../profile-hub/profile-directory.css';

const DEMO_PROFILE_KEY = 'demo:canonical';
const COLLECTION_CACHE_TTL_MS = 5 * 60 * 1000;

export const ProfileHubView: React.FC<{ active?: boolean }> = React.memo(({ active = true }: { active?: boolean }) => {
  useEffect(() => active ? useProfileHubExecutionStore.getState().monitor() : undefined, [active]);
  const { 
    setActivePlayingVideo, 
    openLightbox, 
    setSlideshowOpen,
    syncJobs, 
    syncVideos,
    albumFolders, 
    videoFolders, 
    settings 
  } = useAppStore(useShallow(state => ({
    setActivePlayingVideo: state.setActivePlayingVideo, openLightbox: state.openLightbox,
    setSlideshowOpen: state.setSlideshowOpen, syncJobs: state.syncJobs, syncVideos: state.syncVideos,
    albumFolders: state.albumFolders, videoFolders: state.videoFolders, settings: state.settings,
  })));

  const { copy, formatDate, formatCount } = useProfileHubPresentation();
  const en = settings.language === 'en-US';
  const isEn = en;

  const availableFolders = [...new Set([...albumFolders, ...videoFolders].map(folder => folder.name))];
  const emptyProfile: ProfileHeroData = {
    id: '', name: copy.emptyProfile, tagline: copy.emptyProfileHint,
    avatarUrl: '', coverUrl: '', verified: false, following: false,
    stats: { videos: null, playlists: null, albums: null },
    destinationFolder: availableFolders[0] || copy.defaultFolder, availableFolders,
  };
  useState(() => {
    if (!useProfileHubStore.getState().activeProfileKey) useProfileHubStore.getState().installProfile(DEMO_PROFILE_KEY, { ...createProfileHubSession(DEMO_PROFILE_KEY, emptyProfile), demoMode: true });
  });
  const profileKey = useProfileHubStore(state => state.activeProfileKey)!;
  const hubRoute = useProfileHubStore(state => state.route);
  const pendingProfileOpenUrl = useProfileHubStore(state => state.pendingProfileOpenUrl);
  const isHubHome = hubRoute === null;
  const directorySession = useProfileDirectoryStore(state => hubRoute?.mode === 'directory' ? state.directories[hubRoute.queryKey] : undefined);
  const isDirectory = hubRoute?.mode === 'directory' && Boolean(directorySession);
  const isReview = hubRoute?.mode === 'review';
  const directoryCopy = profileDirectoryCopy[settings.language];
  const urlField = useRef<HTMLInputElement>(null);
  const navigationUnavailable = useProfileHubStore(state => state.navigationUnavailable);
  const profiles = useProfileHubStore(state => state.profiles);
  const globalSelection = React.useMemo(() => getGlobalProfileSelection(profiles, !isDirectory && !isReview), [profiles, isDirectory, isReview]);
  const installingProfile = useRef(false);
  const [profile, setProfile] = useProfileHubField(profileKey, 'profile');
  const [highlights, setHighlights] = useProfileHubField(profileKey, 'highlights');
  const [playlists, setPlaylists] = useProfileHubField(profileKey, 'playlists');
  const [albums, setAlbums] = useProfileHubField(profileKey, 'albums');
  const [videos, setVideos] = useProfileHubField(profileKey, 'videos');
  const [gifs, setGifs] = useProfileHubField(profileKey, 'gifs');
  const [playlistVideosMap, setPlaylistVideosMap] = useProfileHubField(profileKey, 'playlistVideosMap');
  const [albumPhotosMap, setAlbumPhotosMap] = useProfileHubField(profileKey, 'albumPhotosMap');
  const [activeCategoryTab, setActiveCategoryTab] = useProfileHubField(profileKey, 'activeCategoryTab');
  const metadataPriority = useRef<MetadataTarget['kind'] | undefined>();
  metadataPriority.current = activeCategoryTab === 'albuns' ? 'album' : activeCategoryTab === 'playlists' ? 'playlist' : activeCategoryTab === 'videos' ? 'video' : undefined;
  const [activeSidePanel] = useProfileHubField(profileKey, 'activeSidePanel');
  const setActiveSidePanel: React.Dispatch<React.SetStateAction<ActiveSidePanel>> = next => {
    const previous = useProfileHubStore.getState().profiles[profileKey].activeSidePanel;
    const panel = typeof next === 'function' ? next(previous) : next;
    hubNavigation.navigate({ mode: 'profile', profileKey, panel }, true);
  };

  // Library Store (History & Favorites Unified with Directory)
  const [dialog, setDialog] = useState<'history' | 'favorites' | null>(null);
  const libraryFavorites = useProfileDirectoryLibraryStore(state => state.favorites.filter(item => item.kind === 'profile'));
  const libraryStorageAvailable = useProfileDirectoryLibraryStore(state => state.storageAvailable);
  const favoriteVideos = useProfileHubStore(state => state.favoriteVideos);
  const favoriteVideoIds = useProfileHubStore(state => state.favoriteVideoIds);
  const fetchFavoriteVideos = useProfileHubStore(state => state.fetchFavoriteVideos);
  const toggleProfileVideoFavorite = useProfileHubStore(state => state.toggleProfileVideoFavorite);
  const [videoFilterFavoritesOnly, setVideoFilterFavoritesOnly] = useState(false);

  useEffect(() => {
    if (profile?.name) {
      void fetchFavoriteVideos(profile.name);
    }
  }, [profile?.name]);

  // Profile Tabs (Multi-Tab Browser System)
  const openProfileTabs = useProfileHubStore(state => state.openProfileTabs);
  const openProfileTab = useProfileHubStore(state => state.openProfileTab);
  const closeProfileTab = useProfileHubStore(state => state.closeProfileTab);

  useEffect(() => {
    if (active) void useProfileDirectoryLibraryStore.getState().initSync();
  }, [active]);
  const [isLoadingCollection, setIsLoadingCollection] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [demoMode, setDemoMode] = useProfileHubField(profileKey, 'demoMode');
  const [collectionError, setCollectionError] = useState('');

  const scanController = useRef<AbortController | null>(null);
  const scanPending = useRef(false);
  const collectionController = useRef<AbortController | null>(null);
  const profileGeneration = useRef(0);
  useEffect(() => () => {
    scanController.current?.abort();
    collectionController.current?.abort();
  }, []);

  const handleBackToAlbums = () => {
    collectionController.current?.abort();
    setIsLoadingCollection(false);
    setCollectionError('');
    setActiveCategoryTab('albuns');
    setActiveSidePanel(null);
  };

  const handleBackToPlaylists = () => {
    collectionController.current?.abort();
    setIsLoadingCollection(false);
    setCollectionError('');
    setActiveCategoryTab('playlists');
    setActiveSidePanel(null);
  };

  const handleCloseSidePanel = () => {
    collectionController.current?.abort();
    setIsLoadingCollection(false);
    setCollectionError('');
    setActiveSidePanel(null);
  };

  useEffect(() => {
    if (!active) {
      ++profileGeneration.current;
      scanController.current?.abort(); collectionController.current?.abort();
      setIsScanning(false); setIsLoadingCollection(false);
      setSaveModalOpen(false); setZipModalOpen(false);
    }
  }, [active]);

  useEffect(() => useProfileHubStore.subscribe((next, previous) => {
    if (next.route?.mode === 'review' && previous.route?.mode !== 'review') {
      ++profileGeneration.current;
      scanController.current?.abort(); collectionController.current?.abort();
      setIsLoadingCollection(false); setIsScanning(false); setSaveModalOpen(false); setZipModalOpen(false);
    }
    if (next.routeToken !== previous.routeToken && !installingProfile.current) {
      const nextPanel = next.route?.mode === 'profile' ? next.route.panel : null;
      const previousPanel = previous.route?.mode === 'profile' ? previous.route.panel : null;
      const nextCollection = nextPanel && 'item' in nextPanel ? `${nextPanel.type}:${nextPanel.item.id}` : null;
      const previousCollection = previousPanel && 'item' in previousPanel ? `${previousPanel.type}:${previousPanel.item.id}` : null;
      if (nextCollection !== previousCollection) {
        collectionController.current?.abort();
        setIsLoadingMore(false); setIsLoadingCollection(false); setCollectionError('');
      }
      if (scanPending.current) {
        scanPending.current = false; ++profileGeneration.current;
        scanController.current?.abort(); setIsScanning(false);
      }
      const directory = next.route?.mode === 'directory' ? useProfileDirectoryStore.getState().directories[next.route.queryKey]?.pages[next.route.pageUrl] : undefined;
      const source = directory?.page_url ?? (next.activeProfileKey ? next.profiles[next.activeProfileKey].sourceUrl : '');
      if (source) setUrlInput(source);
      setScanError('');
      setScanMessage(directory ? copy.directoryLoaded.replace('{count}', String(directory.loaded_count)) : '');
    }
    if (next.activeProfileKey !== previous.activeProfileKey && !installingProfile.current) {
      ++profileGeneration.current;
      scanController.current?.abort(); collectionController.current?.abort();
      setIsLoadingCollection(false); setIsScanning(false); setCollectionError('');
      setSaveModalOpen(false); setZipModalOpen(false);
    }
  }), [copy]);
  useEffect(() => {
    if (active && ['', '#/profile-hub'].includes(window.location.hash.split('?')[0]) && !new URLSearchParams(window.location.hash.split('?')[1] || '').has('context')) {
      const currentRoute = useProfileHubStore.getState().route;
      if (currentRoute) hubNavigation.navigate(currentRoute, true);
    }
  }, [active, profileKey]);

  const activeEnrichmentProfile = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !profileKey || profileKey === DEMO_PROFILE_KEY) return;
    const currentSession = useProfileHubStore.getState().profiles[profileKey];
    if (!currentSession || currentSession.root?.discovery_pending) return;

    const unqueried = [
      ...(currentSession.playlists ?? []).filter(pl => pl.url && !pl.metadataStatus).map(pl => ({ url: pl.url || "", kind: 'playlist' as const })),
      ...(currentSession.albums ?? []).filter(alb => alb.url && alb.id !== 'alb-gifs' && alb.category !== 'GIFs' && !alb.metadataStatus).map(alb => ({ url: alb.url || "", kind: 'album' as const })),
      ...(currentSession.videos ?? []).filter(vid => vid.originalUrl && !vid.metadataStatus).map(vid => ({ url: vid.originalUrl || "", kind: 'video' as const })),
    ];
    if (!unqueried.length || activeEnrichmentProfile.current === profileKey) return;

    activeEnrichmentProfile.current = profileKey;
    const controller = new AbortController();
    const generation = profileGeneration.current;

    void loadProfileMetadata(
      unqueried,
      (batch: MetadataResult[]) => {
        if (controller.signal.aborted || generation !== profileGeneration.current) return;
        useProfileHubStore.getState().applyMetadataBatch(profileKey, batch);
      },
      controller.signal,
      () => metadataPriority.current
    ).finally(() => {
      if (activeEnrichmentProfile.current === profileKey) {
        activeEnrichmentProfile.current = null;
      }
    });

    return () => {
      controller.abort();
      if (activeEnrichmentProfile.current === profileKey) {
        activeEnrichmentProfile.current = null;
      }
    };
  }, [active, profileKey]);

  // Catalog search & filter states
  const [videoSearchTerm, setVideoSearchTerm] = useProfileHubField(profileKey, 'videoSearchTerm');
  const [videoQualityFilter, setVideoQualityFilter] = useProfileHubField(profileKey, 'videoQualityFilter');
  const [playlistSearchTerm, setPlaylistSearchTerm] = useProfileHubField(profileKey, 'playlistSearchTerm');
  const [albumSearchTerm, setAlbumSearchTerm] = useProfileHubField(profileKey, 'albumSearchTerm');

  // Global Selection State
  const [selectedVideos, setSelectedVideos] = useProfileHubField(profileKey, 'selectedVideos');
  const [selectedAlbumPhotos, setSelectedAlbumPhotos] = useProfileHubField(profileKey, 'selectedAlbumPhotos');
  const [selectedAlbums, setSelectedAlbums] = useProfileHubField(profileKey, 'selectedAlbums');
  const [selectedPlaylists, setSelectedPlaylists] = useProfileHubField(profileKey, 'selectedPlaylists');

  // URL Scanner & Live Scraping State
  const [urlInput, setUrlInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [scanError, setScanError] = useState('');

  const currentProfileRawUrl = (demoMode ? DEMO_PROFILE_KEY : profiles[profileKey]?.sourceUrl) || profile.id || urlInput || (demoMode ? 'demo:canonical' : '');
  const isCurrentProfileFavorite = React.useMemo(() => {
    if (!currentProfileRawUrl) return false;
    const clean = currentProfileRawUrl.trim().replace(/\/+$/, '');
    return libraryFavorites.some(f => f.url.trim().replace(/\/+$/, '') === clean || f.key === shortcutKey('profile', clean));
  }, [libraryFavorites, currentProfileRawUrl]);

  const handleToggleProfileFavorite = () => {
    if (!currentProfileRawUrl) return;
    const success = useProfileDirectoryLibraryStore.getState().toggleFavorite({
      kind: 'profile',
      url: currentProfileRawUrl,
      name: profile.name || copy.unnamedProfile,
      imageUrl: profile.avatarUrl || profile.coverUrl,
    });
    if (!success) {
      useAppStore.getState().addNotification({
        title: directoryCopy.title,
        message: directoryCopy.favoriteLimit,
        type: 'error',
      });
    }
  };

  // Record profile visit in unified history
  useEffect(() => {
    if (!profile.name || !currentProfileRawUrl || demoMode) return;
    useProfileDirectoryLibraryStore.getState().visit({
      kind: 'profile',
      url: currentProfileRawUrl,
      name: profile.name,
      imageUrl: profile.avatarUrl || profile.coverUrl,
    }, { mode: 'profile', profileKey, panel: activeSidePanel });
  }, [profile.name, currentProfileRawUrl, profileKey, demoMode]);

  // Auto-register active profile in openProfileTabs
  useEffect(() => {
    if (!profileKey || isDirectory || isReview || isHubHome) return;
    const session = profiles[profileKey];
    if (!session) return;
    const name = session.profile?.name || profile.name;
    if (!name || name === copy.emptyProfile) return;
    openProfileTab({
      key: profileKey,
      name,
      avatarUrl: session.profile?.avatarUrl || profile.avatarUrl,
      sourceUrl: session.sourceUrl || '',
    });
  }, [profileKey, profile.name, profile.avatarUrl, isDirectory, isReview, isHubHome, profiles, copy.emptyProfile, openProfileTab]);

  // Modals & Save Actions
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [zipModalOpen, setZipModalOpen] = useState(false);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Computed Selection Stats
  const selectedVideoList = Object.values(selectedVideos);
  const selectedAlbumList = Object.values(selectedAlbums);
  const selectedPhotoList = Object.values(selectedAlbumPhotos);
  
  const totalSelectedCount = selectedVideoList.length + selectedAlbumList.length + selectedPhotoList.length;
  const canExecuteActiveSelection = globalSelection.groups.length === 1 && globalSelection.groups[0].profileKey === profileKey
    && globalSelection.groups[0].playlists.length === 0 && globalSelection.groups[0].photos.length === 0;
  const canSaveActiveSelection = canExecuteActiveSelection && globalSelection.groups[0].albums.length === 0;

  const requestSave = () => {
    if (!demoMode) { requestReview(); return; }
    if (!canSaveActiveSelection) {
      if (demoMode) setScanError(profileHubReviewCopy[settings.language].legacySaveHint); else requestReview();
      return;
    }
    setSaveModalOpen(true);
  };
  const requestZip = () => {
    if (isProcessingAction) return;
    if (!canExecuteActiveSelection) { setScanError(copy.multipleProfilesReviewRequired); return; }
    setScanError(''); setScanMessage('');
    setZipModalOpen(true);
  };
  const requestReview = () => {
    if (!demoMode || isDirectory || globalSelection.groups.some(group => !profiles[group.profileKey].demoMode)) {
      hubNavigation.navigate({ mode: 'review' }); return;
    }
    const origin = globalSelection.groups[0]?.profileKey ?? profileKey;
    hubNavigation.navigate({ mode: 'profile', profileKey: origin, panel: { type: 'review-selection' } });
  };

  const selectedItemIds = new Set([
    ...selectedVideoList.map(v => v.id),
    ...selectedPhotoList.map(p => p.id),
  ]);

  const buildSummaryText = () => {
    const parts: string[] = [];
    for (const [kind, singular, plural] of [
      ['videos', copy.video, copy.videos], ['albums', copy.album, copy.albums],
      ['photos', copy.photo, copy.photos], ['playlists', copy.playlists, copy.playlists],
    ] as const) {
      const count = globalSelection.groups.reduce((sum, group) => sum + group[kind].length, 0);
      if (count) parts.push(formatCount(count, count === 1 ? singular : plural));
    }
    return parts.join(' • ') || copy.ui49;
  };

  // Toggle Selection Handlers
  const handleToggleMediaItem = (item: MediaItemCard) => {
    if (item.type === 'video') {
      setSelectedVideos(prev => {
        const next = { ...prev };
        if (next[item.id]) delete next[item.id];
        else next[item.id] = item;
        return next;
      });
    } else {
      setSelectedAlbumPhotos(prev => {
        const next = { ...prev };
        if (next[item.id]) delete next[item.id];
        else next[item.id] = item;
        return next;
      });
    }
  };

  const handleSelectAllInCollection = (items: MediaItemCard[]) => {
    const isVideoCollection = items[0]?.type === 'video';
    if (isVideoCollection) {
      setSelectedVideos(prev => {
        const next = { ...prev };
        items.forEach(item => { next[item.id] = item; });
        return next;
      });
    } else {
      setSelectedAlbumPhotos(prev => {
        const next = { ...prev };
        items.forEach(item => { next[item.id] = item; });
        return next;
      });
    }
  };

  const handleClearAllInCollection = (items: MediaItemCard[]) => {
    const isVideoCollection = items[0]?.type === 'video';
    if (isVideoCollection) {
      setSelectedVideos(prev => {
        const next = { ...prev };
        items.forEach(item => { delete next[item.id]; });
        return next;
      });
    } else {
      setSelectedAlbumPhotos(prev => {
        const next = { ...prev };
        items.forEach(item => { delete next[item.id]; });
        return next;
      });
    }
  };

  const handleToggleSelectAlbum = (album: AlbumItem) => {
    setSelectedAlbums(prev => {
      const next = { ...prev };
      if (next[album.id]) delete next[album.id];
      else next[album.id] = album;
      return next;
    });
  };

  const handleToggleSelectPlaylist = (playlist: PlaylistItem) => {
    setSelectedPlaylists(prev => {
      const next = { ...prev };
      if (next[playlist.id]) delete next[playlist.id];
      else next[playlist.id] = playlist;
      return next;
    });
  };

  const handleClearAllSelection = () => {
    setSelectedVideos({});
    setSelectedAlbumPhotos({});
    setSelectedAlbums({});
    setSelectedPlaylists({});
  };

  const handleSelectAllProfileMedia = () => {
    const vMap: Record<string, MediaItemCard> = {};
    videos.forEach(v => { vMap[v.id] = v; });
    setSelectedVideos(vMap);
    const aMap: Record<string, AlbumItem> = {};
    albums.forEach(a => { aMap[a.id] = a; });
    setSelectedAlbums(aMap);
  };

  const handleDestinationFolderChange = (folder: string) => {
    setProfile(p => ({ ...p, destinationFolder: folder }));
    useProfileHubStore.getState().updateField(profileKey, 'destinations', current => ({
      ...current,
      videoFolder: folder,
      galleryFolder: folder,
    }));
  };

  const handleRefreshProfile = () => {
    const currentSession = profiles[profileKey];
    const targetUrl = currentSession?.sourceUrl || urlInput;
    if (targetUrl) {
      const state = useProfileHubStore.getState();
      const nextAliases = { ...state.aliases };
      delete nextAliases[targetUrl.trim()];
      useProfileHubStore.setState({ aliases: nextAliases });
      void openHubUrl(targetUrl);
    }
  };

  // Media Viewing Handlers
  const handlePlayVideo = (video: MediaItemCard) => {
    const isFav = favoriteVideoIds.includes(video.id) || !!video.isFavorite;
    const safeStream = video.streamUrl || (video.originalUrl ? `/api/proxy-video-stream?url=${encodeURIComponent(video.originalUrl)}&referer=https://www.pornhub.com/` : "");
    setActivePlayingVideo({
      id: video.id,
      title: video.title,
      filename: `${video.title || copy.unnamedMedia}.mp4`,
      folder: profile.destinationFolder,
      fileSizeBytes: video.fileSizeBytes ?? 0,
      format: 'mp4',
      isFavorite: isFav,
      createdAt: video.uploadedAt || video.timeAgo || '',
      relPath: '',
      streamUrl: safeStream,
      downloadUrl: '',
      thumbnailUrl: video.thumbnailUrl,
      sourceUrl: video.originalUrl || '',
      url: video.originalUrl || '',
      duration: video.duration,
      resolution: video.resolution,
      views: video.views,
      uploader: video.uploader,
      performer: profile.name,
    });
  };

  const handleOpenPhotoLightbox = (photo: MediaItemCard, collectionItems: MediaItemCard[] = []) => {
    const items = collectionItems.length > 0 ? collectionItems : [photo];
    const activeItem = activeSidePanel && 'item' in activeSidePanel ? activeSidePanel.item : null;
    const albumObj = {
      id: photo.collectionId || activeItem?.id || 'profile-hub-album',
      title: photo.collectionTitle || activeItem?.title || profile.name,
      sourceUrl: (activeItem as any)?.url || '',
      sourceDomain: 'profile-hub',
      createdAt: '',
      updatedAt: '',
      imageCount: items.length,
      resolvedOriginalCount: items.length,
      totalSizeBytes: items.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0),
      coverImage: photo.thumbnailUrl,
      images: items.map(p => {
        const isPh = Boolean((p.sourcePage && p.sourcePage.includes('pornhub.com')) || (p.originalUrl && p.originalUrl.includes('phncdn.com')));
        const safeMedia = p.streamUrl || (
          isPh && p.originalUrl
            ? (p.format === 'mp4' || p.originalUrl.includes('.mp4')
                ? `/api/proxy-video-stream?url=${encodeURIComponent(p.originalUrl)}&referer=https://www.pornhub.com/`
                : `/api/proxy-image?url=${encodeURIComponent(p.originalUrl)}&referer=https://www.pornhub.com/`)
            : (p.originalUrl || p.thumbnailUrl)
        );
        const isVid = p.format === 'mp4' || safeMedia.includes('proxy-video-stream') || p.type === 'video';
        return {
          id: p.id,
          originalUrl: safeMedia,
          rawOriginalUrl: p.originalUrl || safeMedia,
          videoUrl: isVid ? safeMedia : undefined,
          videoStreamUrl: isVid ? safeMedia : undefined,
          thumbnailUrl: p.thumbnailUrl,
          previewUrl: p.thumbnailUrl,
          pageUrl: p.pageUrl || (p as any).targetUrl || '',
          sourcePage: p.sourcePage || (activeItem as any)?.url || '',
          title: p.title,
          width: p.width ?? 0,
          height: p.height ?? 0,
          fileSizeBytes: p.fileSizeBytes ?? 0,
          aspectRatio: p.width && p.height ? `${p.width}:${p.height}` : '',
          megapixels: p.width && p.height ? p.width * p.height / 1000000 : 0,
          format: (p.format || '') as any,
          isResolvedOriginal: Boolean(p.isResolvedOriginal && p.originalUrl && p.originalUrl !== p.thumbnailUrl),
          status: (p.isResolvedOriginal && p.originalUrl && p.originalUrl !== p.thumbnailUrl ? 'resolved' : 'unresolved') as any,
          aestheticScore: 0,
          sharpnessScore: 0,
          colorPalette: [],
          tags: [],
          mediaType: (p.type === 'gif' ? 'gif' : isVid ? 'video' : 'image') as any,
          isAnimated: p.type === 'gif',
          animationChecked: true,
        };
      }),
      tags: [],
      extractionMode: 'classic' as any,
      aiModel: '',
      durationSeconds: 0,
    };
    const imgItem = albumObj.images.find(img => img.id === photo.id) || albumObj.images[0];
    openLightbox(imgItem, albumObj);
  };

  const handleOpenAlbumSlideshow = (albumItems: MediaItemCard[]) => {
    if (!albumItems.length) return;
    const activeItem = activeSidePanel && 'item' in activeSidePanel ? activeSidePanel.item : null;
    const transientAlbum = {
      id: activeItem?.id || 'profile-hub-album',
      title: activeItem?.title || profile.name,
      sourceUrl: (activeItem as any)?.url || '',
      sourceDomain: 'profile-hub',
      createdAt: '',
      updatedAt: '',
      imageCount: albumItems.length,
      resolvedOriginalCount: albumItems.length,
      totalSizeBytes: albumItems.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0),
      coverImage: albumItems[0]?.thumbnailUrl || '',
      images: albumItems.map(p => ({
        id: p.id,
        originalUrl: p.originalUrl || p.thumbnailUrl,
        rawOriginalUrl: p.originalUrl || p.thumbnailUrl,
        thumbnailUrl: p.thumbnailUrl,
        previewUrl: p.thumbnailUrl,
        pageUrl: p.pageUrl || (p as any).targetUrl || '',
        sourcePage: p.sourcePage || (activeItem as any)?.url || '',
        title: p.title,
        width: p.width ?? 0,
        height: p.height ?? 0,
        fileSizeBytes: p.fileSizeBytes ?? 0,
        aspectRatio: p.width && p.height ? `${p.width}:${p.height}` : '',
        megapixels: p.width && p.height ? p.width * p.height / 1000000 : 0,
        format: (p.format || '') as any,
        isResolvedOriginal: Boolean(p.isResolvedOriginal && p.originalUrl && p.originalUrl !== p.thumbnailUrl),
        status: (p.isResolvedOriginal && p.originalUrl && p.originalUrl !== p.thumbnailUrl ? 'resolved' : 'unresolved') as any,
        aestheticScore: 0,
        sharpnessScore: 0,
        colorPalette: [],
        tags: [],
        mediaType: 'image' as any,
        isAnimated: false,
        animationChecked: true,
      })),
      tags: [],
      extractionMode: 'classic' as any,
      aiModel: '',
      durationSeconds: 0,
    };
    setSlideshowOpen(true, 0, 'album', transientAlbum);
  };

  const enrichMetadata = (targets: MetadataTarget[], generation: number, signal: AbortSignal, targetProfileKey = profileKey) => {
    void loadProfileMetadata(targets, (batch: MetadataResult[]) => {
      if (signal.aborted || generation !== profileGeneration.current) return;
      useProfileHubStore.getState().applyMetadataBatch(targetProfileKey, batch);
    }, signal, () => metadataPriority.current);
  };

  // Each request belongs to one profile generation and one collection.
  const handleOpenAlbum = async (album: AlbumItem, targetProfileKey = profileKey) => {
    const setAlbumPhotosMap = profileHubFieldSetter(targetProfileKey, 'albumPhotosMap');
    const setAlbums = profileHubFieldSetter(targetProfileKey, 'albums');
    const setActiveSidePanel = profileHubFieldSetter(targetProfileKey, 'activeSidePanel');
    const session = useProfileHubStore.getState().profiles[targetProfileKey];
    album = session.albums.find(item => item.id === album.id) ?? album;
    hubNavigation.navigate({ mode: 'profile', profileKey: targetProfileKey, panel: { type: 'album', item: album } }, true);
    collectionController.current?.abort();
    const controller = new AbortController();
    collectionController.current = controller;
    const generation = profileGeneration.current;
    setActiveSidePanel({ type: 'album', item: album });
    setIsLoadingMore(false);
    setCollectionError('');
    if (session.albumPhotosMap[album.id] !== undefined && album.paginationComplete === true
      && Date.now() - (session.collectionLoadedAt[`album:${album.id}`] ?? 0) < COLLECTION_CACHE_TTL_MS) {
      setIsLoadingCollection(false);
      return;
    }
    const hasInitialPhotos = Boolean(session.albumPhotosMap[album.id]?.length);
    setIsLoadingCollection(!hasInitialPhotos && Boolean(album.url));
    if (!album.url) return;
    try {
      const result = await fetchAlbumPhotos(album.url, controller.signal, 1);
      if (controller.signal.aborted || generation !== profileGeneration.current) return;
      const newPhotos = result.photos.map(photo => ({ ...photo, collectionId: album.id, collectionTitle: album.title }));
      
      const latestSession = useProfileHubStore.getState().profiles[targetProfileKey];
      const existing = latestSession.albumPhotosMap[album.id] || [];
      const existingIds = new Set(existing.map(p => p.id));
      const existingUrls = new Set(existing.map(p => p.originalUrl || (p as any).url));
      const uniqueNew = newPhotos.filter(p => !existingIds.has(p.id) && !existingUrls.has(p.originalUrl || (p as any).url));
      const mergedPhotos = existing.length > 0 ? [...existing, ...uniqueNew] : newPhotos;
      
      setAlbumPhotosMap(prev => ({ ...prev, [album.id]: mergedPhotos }));
      profileHubFieldSetter(targetProfileKey, 'collectionLoadedAt')(prev => ({ ...prev,
        [`album:${album.id}`]: result.metadata.paginationComplete === true ? Date.now() : 0 }));
      const enriched = { ...(latestSession.albums.find(item => item.id === album.id) ?? album),
        ...result.metadata, batchPage: 1, loadedCount: mergedPhotos.length };
      setAlbums(prev => prev.map(item => item.id === album.id ? enriched : item));
      setActiveSidePanel(prev => prev?.type === 'album' && prev.item.id === album.id ? { type: 'album', item: enriched } : prev);
    } catch (err) {
      if (!controller.signal.aborted) setCollectionError(err instanceof Error ? err.message : copy.photoLoadError);
    } finally {
      if (!controller.signal.aborted) setIsLoadingCollection(false);
    }
  };

  const handleLoadMoreAlbumItems = async () => {
    if (!activeSidePanel || activeSidePanel.type !== 'album' || isLoadingMore) return;
    const targetProfileKey = profileKey;
    const session = useProfileHubStore.getState().profiles[targetProfileKey];
    const album = session.albums.find(item => item.id === activeSidePanel.item.id) ?? activeSidePanel.item;
    if (album.paginationComplete || !album.url) return;
    collectionController.current?.abort();
    const controller = new AbortController();
    collectionController.current = controller;
    const generation = profileGeneration.current;
    const ownsRequest = () => {
      const current = useProfileHubStore.getState();
      const panel = current.profiles[targetProfileKey]?.activeSidePanel;
      return !controller.signal.aborted && collectionController.current === controller
        && generation === profileGeneration.current && current.activeProfileKey === targetProfileKey
        && panel?.type === 'album' && panel.item.id === album.id;
    };
    const setAlbumPhotosMap = profileHubFieldSetter(targetProfileKey, 'albumPhotosMap');
    const setAlbums = profileHubFieldSetter(targetProfileKey, 'albums');
    const setActiveSidePanel = profileHubFieldSetter(targetProfileKey, 'activeSidePanel');
    setCollectionError('');
    setIsLoadingMore(true);
    try {
      const currentBatchPage = album.batchPage ?? 1;
      const nextPage = currentBatchPage + 1;
      const result = await fetchAlbumPhotos(album.url, controller.signal, nextPage);
      if (!ownsRequest()) return;
      const newPhotos = result.photos.map(p => ({ ...p, collectionId: album.id, collectionTitle: album.title }));
      // Re-read after the await: another operation may have added/edited items.
      const latestSession = useProfileHubStore.getState().profiles[targetProfileKey];
      const currentPhotos = latestSession.albumPhotosMap[album.id] || [];
      const existingIds = new Set(currentPhotos.map(p => p.id));
      const existingUrls = new Set(currentPhotos.map(p => p.originalUrl || (p as any).url));
      const uniqueNew = newPhotos.filter(p => {
        const url = p.originalUrl || (p as any).url;
        if ((p.id && existingIds.has(p.id)) || (url && existingUrls.has(url))) return false;
        if (p.id) existingIds.add(p.id);
        if (url) existingUrls.add(url);
        return true;
      });
      
      const mergedPhotos = [...currentPhotos, ...uniqueNew];
      if (uniqueNew.length === 0 && result.metadata.paginationComplete !== true) {
        setCollectionError(copy.photoLoadError);
        return;
      }
      setAlbumPhotosMap(prev => ({ ...prev, [album.id]: mergedPhotos }));
      
      const enriched: AlbumItem = {
        ...(latestSession.albums.find(item => item.id === album.id) ?? album),
        ...result.metadata,
        batchPage: nextPage,
        loadedCount: mergedPhotos.length,
        paginationComplete: result.metadata.paginationComplete === true,
      };
      setAlbums(prev => prev.map(item => item.id === album.id ? enriched : item));
      setActiveSidePanel(prev => prev?.type === 'album' && prev.item.id === album.id ? { type: 'album', item: enriched } : prev);
    } catch (err) {
      if (ownsRequest()) setCollectionError(err instanceof Error ? err.message : copy.photoLoadError);
    } finally {
      if (collectionController.current === controller) setIsLoadingMore(false);
    }
  };

  const handleOpenPlaylist = async (playlist: PlaylistItem, targetProfileKey = profileKey) => {
    const setPlaylistVideosMap = profileHubFieldSetter(targetProfileKey, 'playlistVideosMap');
    const setPlaylists = profileHubFieldSetter(targetProfileKey, 'playlists');
    const setActiveSidePanel = profileHubFieldSetter(targetProfileKey, 'activeSidePanel');
    const session = useProfileHubStore.getState().profiles[targetProfileKey];
    playlist = session.playlists.find(item => item.id === playlist.id) ?? playlist;
    hubNavigation.navigate({ mode: 'profile', profileKey: targetProfileKey, panel: { type: 'playlist', item: playlist } }, true);
    collectionController.current?.abort();
    const controller = new AbortController();
    collectionController.current = controller;
    const generation = profileGeneration.current;
    setActiveSidePanel({ type: 'playlist', item: playlist });
    setIsLoadingMore(false);
    setCollectionError('');
    if (session.playlistVideosMap[playlist.id] !== undefined && playlist.paginationComplete === true
      && Date.now() - (session.collectionLoadedAt[`playlist:${playlist.id}`] ?? 0) < COLLECTION_CACHE_TTL_MS) {
      setIsLoadingCollection(false);
      return;
    }
    setIsLoadingCollection(Boolean(playlist.url));
    if (!playlist.url) return;
    try {
      const result = await fetchPlaylistVideos(playlist.url, controller.signal);
      if (controller.signal.aborted || generation !== profileGeneration.current) return;
      const { videos: loadedVideos, playlistUrl, reportedCount, ...metadata } = result;
      const enriched = { ...playlist, ...metadata, videoCount: reportedCount ?? playlist.videoCount,
        loadedCount: loadedVideos.length, url: playlistUrl || playlist.url };
      setPlaylistVideosMap(prev => ({ ...prev, [playlist.id]: loadedVideos }));
      profileHubFieldSetter(targetProfileKey, 'collectionLoadedAt')(prev => ({ ...prev,
        [`playlist:${playlist.id}`]: result.paginationComplete === true ? Date.now() : 0 }));
      enrichMetadata(loadedVideos.map(item => ({ url: item.originalUrl || '', kind: 'video' })), generation, controller.signal, targetProfileKey);
      setPlaylists(prev => prev.map(item => item.id === playlist.id ? enriched : item));
      setActiveSidePanel(prev => prev?.type === 'playlist' && prev.item.id === playlist.id ? { type: 'playlist', item: enriched } : prev);
    } catch (err) {
      if (!controller.signal.aborted) setCollectionError(err instanceof Error ? err.message : copy.videoLoadError);
    } finally {
      if (!controller.signal.aborted) setIsLoadingCollection(false);
    }
  };

  const openHubUrl = async (sourceUrl: string) => {
    if (!sourceUrl.trim()) return;
    setUrlInput(sourceUrl);
    scanController.current?.abort();
    collectionController.current?.abort();
    const controller = new AbortController();
    scanController.current = controller;
    const generation = ++profileGeneration.current;
    setIsScanning(true);
    scanPending.current = true;
    setScanError('');
    setCollectionError('');
    setIsLoadingCollection(false);
    setScanMessage(copy.scanLoading);
    try {
      let openedKey: string | undefined;
      // A known URL needs no resolver round trip. Incomplete scans are resumed
      // below rather than treating a cancelled first page as a full catalog.
      const localState = useProfileHubStore.getState();
      const localKey = localState.aliases[sourceUrl.trim()];
      if (localKey && localState.profiles[localKey]) {
        scanPending.current = false;
        installingProfile.current = true;
        try { hubNavigation.navigate({ mode: 'profile', profileKey: localKey, panel: localState.profiles[localKey].activeSidePanel }); }
        finally { installingProfile.current = false; }
        openedKey = localKey;
        setIsScanning(false);
        if (!localState.profiles[localKey].root?.discovery_pending && !localState.profiles[localKey].root?.discovery_errors?.length) {
          setScanMessage('');
          const cachedSession = localState.profiles[localKey];
          const unqueried = [
            ...(cachedSession.playlists ?? []).filter(pl => pl.url && !pl.metadataStatus).map(pl => ({ url: pl.url || "", kind: 'playlist' as const })),
            ...(cachedSession.albums ?? []).filter(alb => alb.url && alb.id !== 'alb-gifs' && alb.category !== 'GIFs' && !alb.metadataStatus).map(alb => ({ url: alb.url || "", kind: 'album' as const })),
            ...(cachedSession.videos ?? []).filter(vid => vid.originalUrl && !vid.metadataStatus).map(vid => ({ url: vid.originalUrl || "", kind: 'video' as const })),
          ];
          if (unqueried.length) enrichMetadata(unqueried, generation, controller.signal, localKey);
          return;
        }
      }
      const input = await resolveProfileHubInput(sourceUrl.trim(), controller.signal);
      if (controller.signal.aborted || generation !== profileGeneration.current) return;
      if (input.kind === 'directory') {
        const cached = Object.entries(useProfileDirectoryStore.getState().directories).find(([, session]) => session.pages[input.url]);
        const page = cached?.[1].pages[input.url] ?? await discoverProfileDirectory(input.url, controller.signal);
        if (controller.signal.aborted || generation !== profileGeneration.current) return;
        hubNavigation.checkpoint();
        useProfileDirectoryStore.getState().commitPage(page);
        scanPending.current = false;
        hubNavigation.navigate({ mode: 'directory', queryKey: page.query_key, pageUrl: page.page_url }, false, false);
        setScanMessage(copy.directoryLoaded.replace('{count}', String(page.loaded_count)));
        return;
      }
      const cachedKey = useProfileHubStore.getState().aliases[input.url];
      if (cachedKey && !useProfileHubStore.getState().profiles[cachedKey].root?.discovery_pending
        && !useProfileHubStore.getState().profiles[cachedKey].root?.discovery_errors?.length) {
        scanPending.current = false;
        installingProfile.current = true;
        try { hubNavigation.navigate({ mode: 'profile', profileKey: cachedKey, panel: useProfileHubStore.getState().profiles[cachedKey].activeSidePanel }); }
        finally { installingProfile.current = false; }
        setScanMessage('');
        const cachedSession = useProfileHubStore.getState().profiles[cachedKey];
        const unqueried = [
          ...(cachedSession.playlists ?? []).filter(pl => pl.url && !pl.metadataStatus).map(pl => ({ url: pl.url || "", kind: 'playlist' as const })),
          ...(cachedSession.albums ?? []).filter(alb => alb.url && alb.id !== 'alb-gifs' && alb.category !== 'GIFs' && !alb.metadataStatus).map(alb => ({ url: alb.url || "", kind: 'album' as const })),
          ...(cachedSession.videos ?? []).filter(vid => vid.originalUrl && !vid.metadataStatus).map(vid => ({ url: vid.originalUrl || "", kind: 'video' as const })),
        ];
        if (unqueried.length) enrichMetadata(unqueried, generation, controller.signal, cachedKey);
        return;
      }
      const acceptProfile = (snapshot: ProfileRoot) => {
        if (controller.signal.aborted || generation !== profileGeneration.current) return;
        const nextProfile = snapshot.profile_data ? { ...snapshot.profile_data, availableFolders } : {
          ...emptyProfile, id: snapshot.profile_key, name: snapshot.name || copy.unnamedProfile,
          tagline: snapshot.description || '', avatarUrl: snapshot.cover_url || '', coverUrl: snapshot.cover_url || '',
          stats: snapshot.discovery_pending ? { videos: null, playlists: null, albums: null }
            : { videos: snapshot.videos?.loaded_count ?? null, playlists: snapshot.playlists?.loaded_count ?? null, albums: snapshot.albums?.loaded_count ?? null },
        };
        const state = useProfileHubStore.getState();
        if (openedKey === snapshot.profile_key) {
          state.applyProfileRoot(snapshot.profile_key, snapshot, nextProfile);
          return;
        }
        // Keep the previous profile until real first-page data is available.
        collectionController.current?.abort();
        setIsLoadingCollection(false); setCollectionError('');
        installingProfile.current = true;
        scanPending.current = false;
        try {
          state.installProfile(snapshot.profile_key, createProfileHubSession(snapshot.source_url || input.url, nextProfile, snapshot), [input.url, sourceUrl.trim()]);
          useProfileHubStore.getState().applyProfileRoot(snapshot.profile_key, snapshot, nextProfile);
          hubNavigation.navigate({ mode: 'profile', profileKey: snapshot.profile_key, panel: state.profiles[snapshot.profile_key]?.activeSidePanel ?? null });
          openedKey = snapshot.profile_key;
        } finally { installingProfile.current = false; }
        // Further discovery runs in the background; the profile is usable now.
        setIsScanning(false);
      };
      const res = await discoverProfileRoot(input.url, controller.signal, acceptProfile);
      if (controller.signal.aborted || generation !== profileGeneration.current) return;
      acceptProfile(res);
      if (res.discovery_errors?.length) {
        setScanError(copy.discoveryIncomplete.replace('{sections}', res.discovery_errors.map(section => copy[section]).join(', ')));
      }
      enrichMetadata([
        ...(res.canonical_playlists ?? []).map(item => ({ url: item.url || '', kind: 'playlist' as const })),
        ...(res.canonical_albums ?? []).filter(item => item.id !== 'alb-gifs' && item.category !== 'GIFs').map(item => ({ url: item.url || '', kind: 'album' as const })),
        ...(res.canonical_videos ?? []).map(item => ({ url: item.originalUrl || '', kind: 'video' as const })),
      ], generation, controller.signal, res.profile_key);
      setScanMessage(`${copy.scanComplete} ${formatCount(res.canonical_videos?.length ?? 0, copy.videos)}, ${formatCount(res.canonical_playlists?.length ?? 0, copy.playlists)}, ${formatCount(res.canonical_albums?.length ?? 0, copy.albums)}.`);
    } catch (err) {
      if (!controller.signal.aborted) setScanError(err instanceof Error ? err.message : copy.scanError);
    } finally {
      if (!controller.signal.aborted) { scanPending.current = false; setIsScanning(false); }
    }
  };

  const openHubUrlRef = useRef(openHubUrl);
  openHubUrlRef.current = openHubUrl;
  const hubEntryActiveRef = useRef(false);
  const profileEntrySequenceRef = useRef(0);
  useEffect(() => {
    hubEntryActiveRef.current = active;
    return () => { hubEntryActiveRef.current = false; };
  }, [active]);
  useEffect(() => {
    if (!active || !pendingProfileOpenUrl) return;
    // Consume synchronously so replayed effects cannot start the same intent twice.
    const sourceUrl = useProfileHubStore.getState().takeProfileOpen();
    if (!sourceUrl) return;
    const sequence = ++profileEntrySequenceRef.current;
    // Wait for StrictMode's cleanup/setup replay before starting the existing scanner.
    queueMicrotask(() => {
      if (hubEntryActiveRef.current && sequence === profileEntrySequenceRef.current
        && !useProfileHubStore.getState().pendingProfileOpenUrl) {
        void openHubUrlRef.current(sourceUrl);
      }
    });
  }, [active, pendingProfileOpenUrl]);

  const handleScanUrl = (event: React.FormEvent) => { event.preventDefault(); void openHubUrl(urlInput); };
  const openShortcut = (item: ProfileShortcut) => {
    if (item.url === DEMO_PROFILE_KEY) return;

    const remembered = useProfileDirectoryLibraryStore.getState().contexts[item.key];
    if (remembered?.mode === 'directory') {
      const saved = useProfileDirectoryStore.getState().directories[remembered.queryKey];
      if (saved?.pages[remembered.pageUrl]) {
        const { search, sort, view, displayPage, focusedProfileKey, appendMode } = saved;
        hubNavigation.navigate({ ...remembered, viewState: { search, sort, view, displayPage, focusedProfileKey, appendMode } });
        return;
      }
    }
    if (remembered?.mode === 'profile' && useProfileHubStore.getState().profiles[remembered.profileKey]) {
      hubNavigation.navigate(remembered);
      const session = useProfileHubStore.getState().profiles[remembered.profileKey];
      void openHubUrl(session.sourceUrl || item.url);
      return;
    }
    void openHubUrl(item.url);
  };

  const handleGoToDirectory = () => {
    // Navigate directly to the directory view (Explore Profiles) preserving state
    const directories = useProfileDirectoryStore.getState().directories;
    const dirEntries = Object.entries(directories);
    if (dirEntries.length > 0) {
      const [queryKey, session] = dirEntries[dirEntries.length - 1];
      hubNavigation.navigate({
        mode: 'directory',
        queryKey,
        pageUrl: session.pageUrl,
        viewState: {
          search: session.search,
          sort: session.sort,
          view: session.view,
          displayPage: session.displayPage,
          focusedProfileKey: session.focusedProfileKey,
          appendMode: session.appendMode,
        },
      });
      return;
    }
    // Clean return to Profile Hub Home when no directory session exists (zero hardcoded URLs)
    cancelScan();
    hubNavigation.checkpoint();
    setUrlInput('');
    useProfileHubStore.setState({ route: null, routeToken: null, navigationUnavailable: false });
    window.history.pushState(null, '', '#/profile-hub');
  };

  const handleSelectProfileTab = (targetKey: string) => {
    const session = profiles[targetKey];
    if (!session) return;
    hubNavigation.navigate({
      mode: 'profile',
      profileKey: targetKey,
      panel: session.activeSidePanel,
    }, true);
  };

  const handleCloseProfileTab = (targetKey: string) => {
    const remainingTabs = openProfileTabs.filter(t => t.key !== targetKey);
    closeProfileTab(targetKey);
    if (!isDirectory && profileKey === targetKey) {
      if (remainingTabs.length > 0) {
        const nextTab = remainingTabs[remainingTabs.length - 1];
        handleSelectProfileTab(nextTab.key);
      } else {
        handleGoToDirectory();
      }
    }
  };
  const pasteUrl = async () => {
    try { setUrlInput(await navigator.clipboard.readText()); urlField.current?.focus(); }
    catch { useAppStore.getState().addNotification({ title: directoryCopy.title, message: directoryCopy.pasteFailed, type: 'info' }); urlField.current?.focus(); }
  };
  const cancelScan = () => { scanPending.current = false; ++profileGeneration.current; scanController.current?.abort(); collectionController.current?.abort(); setIsScanning(false); setIsLoadingCollection(false); setScanMessage(''); };


  // Save to Gallery Execution
  const handleConfirmSave = async (folder: string) => {
    if (!canSaveActiveSelection) return;
    setSaveModalOpen(false);
    setIsProcessingAction(true);
    try {
      setScanMessage(copy.saving.replace("{count}", String(totalSelectedCount)).replace("{folder}", folder));
      const res = await batchSaveProfileHub({
        albums: selectedAlbumList.map(a => ({
          id: a.id,
          title: a.title,
          url: a.url || '',
          thumbnailUrl: a.thumbnailUrl,
          selected_image_urls: selectedPhotoList
            .filter(p => p.collectionId === a.id)
            .map(p => p.originalUrl || p.thumbnailUrl),
        })),
        videos: selectedVideoList.map(v => ({
          id: v.id,
          title: v.title,
          url: v.originalUrl || '',
          thumbnailUrl: v.thumbnailUrl,
          duration: v.duration,
          resolution: v.resolution,
        })),
        folder,
      });
      await syncJobs();
      await syncVideos();
      setScanMessage(copy.saved.replace("{folder}", folder));
      handleClearAllSelection();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : copy.ui63);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // ZIP Download Execution
  const handleConfirmDownloadZip = async () => {
    if (!canExecuteActiveSelection || isProcessingAction) return;
    setZipModalOpen(false);
    setIsProcessingAction(true);
    try {
      setScanMessage(copy.ui61);
      const albumsPayload = selectedAlbumList.map(a => ({
        candidate: {
          key: a.url || a.id,
          source_url: a.url || '',
          title: a.title,
          cover_url: a.thumbnailUrl,
          provenance: { page_url: a.url || '', evidence: 'selection', ownership: 'verified' as const },
        },
        selectedUrls: selectedPhotoList.filter(p => p.collectionId === a.id).map(p => p.originalUrl || p.thumbnailUrl),
        preview: (albumPhotosMap[a.id] || []).map(p => ({
          id: p.id,
          thumbnail_url: p.thumbnailUrl,
          original_url: p.originalUrl || p.thumbnailUrl,
          title: p.title,
        })),
      }));

      const videosPayload = selectedVideoList.map(v => ({
        id: v.id,
        title: v.title,
        url: v.originalUrl || '',
        stream_url: v.streamUrl || v.originalUrl || '',
        collections: [{ title: v.collectionTitle || 'Profile Hub', source_url: v.originalUrl || '' }],
      }));

      await downloadProfileSelection(albumsPayload as any, videosPayload as any);
      setScanMessage(copy.ui62);
    } catch (err) {
      setScanMessage('');
      setScanError(err instanceof Error ? err.message : copy.ui64);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Filtered Videos based on search & quality
  const filteredVideos = React.useMemo(() => {
    return videos.filter(vid => {
      if (videoFilterFavoritesOnly && !favoriteVideoIds.includes(vid.id)) return false;
      const matchSearch = vid.title.toLowerCase().includes(videoSearchTerm.toLowerCase());
      if (!matchSearch) return false;
      if (videoQualityFilter === 'all') return true;
      if (videoQualityFilter === '4K') return vid.resolution?.toLowerCase().includes('4k') || vid.resolution?.includes('2160');
      if (videoQualityFilter === '1080p') return vid.resolution?.toLowerCase().includes('1080');
      if (videoQualityFilter === '720p') return vid.resolution?.toLowerCase().includes('720');
      return true;
    });
  }, [videos, videoSearchTerm, videoQualityFilter, videoFilterFavoritesOnly, favoriteVideoIds]);

  // Current Collection Items for Side Panel
  const currentSidePanelItems: MediaItemCard[] = React.useMemo(() => {
    if (!activeSidePanel) return [];
    if (activeSidePanel.type === 'playlist') {
      return playlistVideosMap[activeSidePanel.item.id] ?? [];
    }
    if (activeSidePanel.type === 'album') {
      return albumPhotosMap[activeSidePanel.item.id] ?? [];
    }
    if (activeSidePanel.type === 'gif-collection') {
      return gifs;
    }
    return [];
  }, [activeSidePanel, playlistVideosMap, albumPhotosMap, videos, gifs, demoMode]);

  const activeDirectoryUrl = directorySession?.pages[directorySession.pageUrl]?.source_url;
  const activeDirectoryHost = activeDirectoryUrl ? new URL(activeDirectoryUrl).hostname : null;
  const entryForm = (<div className="pd-entry"><form className="pd-entry-bar" noValidate onSubmit={handleScanUrl} aria-busy={isScanning}>
    <LinkIcon size={19} className="pd-url-icon" />
    <div className="pd-url-field"><label htmlFor="profile-hub-url">{isDirectory ? directoryCopy.url : copy.profileUrl}{activeDirectoryHost && <span className="pd-active-source">{directoryCopy.activeSource.replace('{source}', activeDirectoryHost)}</span>}</label><input ref={urlField} id="profile-hub-url" type="url" value={urlInput} onChange={event => setUrlInput(event.target.value)} placeholder={copy.urlPlaceholder} aria-invalid={Boolean(scanError)} aria-describedby={scanError ? 'pd-url-error' : undefined} /></div>
    <div className="pd-url-actions"><div className="pd-paste"><button type="button" onClick={() => void pasteUrl()}>{directoryCopy.paste}</button><DirectoryActionsMenu label={directoryCopy.urlActions} icon={<ChevronDown size={12} />}><button type="button" onClick={() => void pasteUrl()}>{directoryCopy.paste}</button><button type="button" onClick={() => { setUrlInput(''); urlField.current?.focus(); }}>{directoryCopy.clearUrl}</button></DirectoryActionsMenu></div>
      <button type="submit" className="pd-button pd-primary" disabled={isScanning}>{isScanning ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}{isDirectory ? directoryCopy.explore : copy.ui80}</button>
      {isScanning && <button type="button" className="pd-button" onClick={cancelScan}>{directoryCopy.cancel}</button>}
    </div></form>{scanError && <p id="pd-url-error" role="alert" className="pd-warning">{scanError}</p>}</div>);

  const tabsBar = !isReview ? (
    <ProfileTabsBar
      openTabs={openProfileTabs}
      active={active}
      activeTabKey={isDirectory ? 'directory' : profileKey}
      directoryLabel={directoryCopy.title}
      closeTabLabel={directoryCopy.closeTab}
      newTabLabel={directoryCopy.newProfileTab}
      onSelectDirectory={handleGoToDirectory}
      onSelectProfile={handleSelectProfileTab}
      onCloseTab={handleCloseProfileTab}
      onNewTabClick={() => {
        urlField.current?.focus();
        urlField.current?.select();
      }}
    />
  ) : null;

  return (
    <div className={isReview ? '' : `pd-page profile-hub-surface relative ${isHubHome ? 'pd-hub-home' : !isDirectory ? 'pd-hub-profile' : ''}`}>
      {/* Persistent Profile Hub Navigation Bar */}
      {!isDirectory && !isReview && (
        <header className="pd-topbar max-w-[1900px] mx-auto">
          <nav aria-label={directoryCopy.navigation} className="pd-breadcrumb">
            {hubNavigation.canGoBack() && (
              <button
                type="button"
                className="pd-icon-button"
                onClick={() => hubNavigation.back()}
                aria-label={directoryCopy.back}
              >
                <ArrowLeft size={15} />
              </button>
            )}
            <button
              type="button"
              className="pd-icon-button"
              onClick={() => useAppStore.getState().navigateToView('home')}
              aria-label={settings.language === 'pt-BR' ? 'Início' : 'Home'}
            >
              <Home size={15} />
            </button>
            <button
              type="button"
              className="pd-breadcrumb-root"
              onClick={() => {
                cancelScan();
                hubNavigation.checkpoint();
                setUrlInput('');
                useProfileHubStore.setState({ route: null, routeToken: null, navigationUnavailable: false });
                window.history.pushState(null, '', '#/profile-hub');
              }}
            >
              Profile Hub
            </button>
            {!isHubHome && <><span className="pd-slash">/</span>
            <button
              type="button"
              className="pd-breadcrumb-root hover:text-white transition-colors"
              onClick={handleGoToDirectory}
              title={directoryCopy.explore}
            >
              {directoryCopy.title}
            </button>
            <span className="pd-slash">/</span>
            <strong aria-current="page" className="truncate max-w-[180px] sm:max-w-[320px]">
              {profile.name || directoryCopy.profile}
            </strong></>}
          </nav>

          <div className="pd-top-actions"><SavedDirectories onOpenUrl={url => void openHubUrl(url)} active={active} />
            <button
              type="button"
              className="pd-button"
              onClick={() => setDialog('history')}
            >
              <Clock3 size={14} />
              <span>{directoryCopy.history}</span>
            </button>
            <button
              type="button"
              className="pd-button pd-favorites-button"
              onClick={() => setDialog('favorites')}
            >
              <Heart size={15} className={libraryFavorites.length > 0 ? "fill-pink-500 text-pink-400" : "text-pink-400"} />
              <span>{directoryCopy.favorites}</span>
              {libraryFavorites.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-pink-500/20 text-pink-300 text-[10px] font-bold">
                  {libraryFavorites.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="pd-button"
              onClick={() => useAppStore.getState().navigateToView('timeline-preview')}
              title={directoryCopy.timelinePreview}
              aria-label={directoryCopy.timelinePreview}
            >
              <Smartphone size={14} />
              <span>{directoryCopy.timeline}</span>
            </button>
            
          </div>
        </header>
      )}

      {isHubHome && <section className="pd-hero" aria-labelledby="hub-home-heading"><div><p className="pd-eyebrow"><Sparkles size={13} />{directoryCopy.navigation}</p><h1 id="hub-home-heading">{directoryCopy.heading}</h1><p>{directoryCopy.intro}<br />{directoryCopy.intro2}</p></div><div className="pd-hero-emblem" aria-hidden="true"><Compass size={51} strokeWidth={1.7} /></div></section>}

      {!isDirectory && !isReview && !libraryStorageAvailable && <p className="pd-warning" role="status">{directoryCopy.storageError}</p>}
      {isReview ? <ProfileReviewPage active={active} onDownloadZip={requestZip} zipAvailable={canExecuteActiveSelection} zipBusy={isProcessingAction} actionError={scanError} actionMessage={scanMessage} /> : isDirectory && hubRoute?.mode === 'directory'
        ? <ProfileDirectoryPanel key={hubRoute.queryKey} queryKey={hubRoute.queryKey} entryForm={entryForm} tabsBar={tabsBar} onOpenUrl={url => void openHubUrl(url)} onOpenShortcut={openShortcut} onDirectoryNavigation={cancelScan} active={active} />
        : entryForm}

      {/* Profile Multi-Tabs Bar - Diretamente logo acima dos Favoritos */}
      {!isDirectory && !isHubHome && tabsBar}

      {/* Quick Access Chips for Favorite Creators (Unified with Directory Favorites) */}
      {!isDirectory && !isReview && libraryFavorites.length > 0 && (
        <QuickProfileFavorites favorites={libraryFavorites} currentUrl={currentProfileRawUrl}
          language={settings.language} active={active} onOpen={openShortcut} />
      )}

      {/* Directory & Profile Hub Unified Dialog (History / Favorites Modal) */}
      {dialog && (
        <DirectoryShortcutsDialog
          mode={dialog}
          copy={directoryCopy}
          language={settings.language}
          onClose={() => setDialog(null)}
          onOpen={openShortcut}
        />
      )}

      {navigationUnavailable && <p role="alert" className="text-sm text-rose-300 mb-4">{copy.navigationUnavailable}</p>}
      {/* Notifications / Alerts */}
      {!isDirectory && !isReview && scanMessage && (
        <div role="status" className="pd-hub-message max-w-[1900px] mx-auto mb-4 p-3 rounded-xl bg-purple-950/60 border border-purple-500/40 text-purple-200 text-xs sm:text-sm flex items-center justify-between animate-in fade-in">
          <span>{scanMessage}</span>
          <button type="button" aria-label={directoryCopy.close} onClick={() => setScanMessage('')}><X size={15} /></button>
        </div>
      )}
      {!isDirectory && !isReview && scanError && (
        <div className="max-w-[1900px] mx-auto mb-4 p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs sm:text-sm flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} />
            <span>{scanError}</span>
          </div>
          <button type="button" onClick={() => setScanError('')}><X size={15} /></button>
        </div>
      )}

      {/* Main Split-Screen Architecture (Matching 01_Canonico_Desktop) */}
      <div hidden={isDirectory || isReview || isHubHome} className={`max-w-[1900px] mx-auto ${isDirectory || isReview || isHubHome ? 'hidden' : 'flex'} flex-col xl:flex-row items-start gap-6 pb-36`}>
        {/* Left Column: Profile Hub Overview */}
        <div className={`w-full ${activeSidePanel ? 'xl:w-1/2 2xl:w-[55%]' : 'xl:w-full'} transition-all duration-300 min-w-0 ${
          activeSidePanel ? 'hidden xl:block' : 'block'
        }`}>
          {/* Profile Hero Header */}
          <ProfileHeader
            key={profile.id}
            profile={{ ...profile, availableFolders: demoMode ? profile.availableFolders : availableFolders }}
            sourceUrl={profiles[profileKey]?.sourceUrl || urlInput}
            isFavorite={isCurrentProfileFavorite}
            onToggleFavorite={handleToggleProfileFavorite}
            onDestinationFolderChange={handleDestinationFolderChange}
            onRefresh={handleRefreshProfile}
            onSelectAllMedia={handleSelectAllProfileMedia}
            onClearSelection={handleClearAllSelection}
            hasSelection={totalSelectedCount > 0}
            demoMode={demoMode}
          />

          {/* Segmented Category Pill Tabs */}
          <ProfileTabBar
            activeTab={activeCategoryTab}
            onTabChange={setActiveCategoryTab}
          />

          {/* Tab 1: Destaques (Default Home View) */}
          {activeCategoryTab === 'destaques' && (
            <>
              <HighlightsSection
                highlights={highlights}
                onSelectHighlight={(item) => {
                  if (item.type === 'playlist') {
                    const targetPlaylist = playlists.find(pl => pl.title.includes(item.title)) || playlists[0];
                    if (targetPlaylist) void handleOpenPlaylist(targetPlaylist);
                  } else if (item.type === 'album') {
                    const targetAlbum = albums[0];
                    if (targetAlbum) void handleOpenAlbum(targetAlbum);
                  } else {
                    handlePlayVideo(videos[0]);
                  }
                }}
                onSeeAll={() => setActiveCategoryTab('playlists')}
              />

              <PlaylistsSection
                playlists={playlists}
                activePlaylistId={activeSidePanel?.type === 'playlist' ? activeSidePanel.item.id : undefined}
                onSelectPlaylist={handleOpenPlaylist}
                onSeeAll={() => setActiveCategoryTab('playlists')}
              />

              <AlbumsSection
                albums={albums}
                activeAlbumId={activeSidePanel?.type === 'album' ? activeSidePanel.item.id : undefined}
                onSelectAlbum={handleOpenAlbum}
                onSeeAll={() => setActiveCategoryTab('albuns')}
              />
            </>
          )}

          {/* Tab 2: Playlists (Full Grid of Real Playlists) */}
          {activeCategoryTab === 'playlists' && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {copy.ui32}
                  </h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-600/30 text-purple-300 font-semibold">
                    {playlists.length}
                  </span>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={playlistSearchTerm}
                    onChange={(e) => setPlaylistSearchTerm(e.target.value)}
                    placeholder={copy.ui77}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#171526] border border-white/10 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {/* Special Dynamic Playlist: ⭐ Vídeos Favoritos */}
                {favoriteVideos.length > 0 && (
                  <div
                    onClick={() => {
                      const favPlaylist: PlaylistItem = {
                        id: `fav-playlist-${profile.id}`,
                        title: isEn ? "⭐ Favorite Videos" : "⭐ Vídeos Favoritos",
                        videoCount: favoriteVideos.length,
                        updatedAt: 'Recent',
                        thumbnailUrl: favoriteVideos[0]?.thumbnailUrl || profile.avatarUrl,
                        description: isEn ? `Collection of favorited videos for ${profile.name}` : `Coleção de vídeos favoritados de ${profile.name}`,
                      };
                      setPlaylistVideosMap(prev => ({
                        ...prev,
                        [favPlaylist.id]: favoriteVideos,
                      }));
                      setActiveSidePanel({ type: 'playlist', item: favPlaylist });
                    }}
                    className={`group relative rounded-xl sm:rounded-2xl overflow-hidden bg-gradient-to-br from-amber-950/40 via-[#181528] to-[#12101F] border border-amber-500/40 hover:border-amber-400 hover:shadow-glow-amber cursor-pointer transition-all flex flex-col ${
                      activeSidePanel?.type === 'playlist' && activeSidePanel.item.id === `fav-playlist-${profile.id}`
                        ? 'ring-2 ring-amber-400 shadow-xl'
                        : ''
                    }`}
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                      <img loading="lazy" decoding="async" src={favoriteVideos[0]?.thumbnailUrl || profile.avatarUrl}
                        alt={isEn ? "Favorite Videos" : "Vídeos Favoritos"}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-amber-500/90 text-[10px] font-bold text-black uppercase tracking-wider flex items-center gap-1 shadow-md">
                        <Star size={11} className="fill-black" />
                        <span>{isEn ? "FAVORITES" : "FAVORITOS"}</span>
                      </div>
                      <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-sm text-[11px] font-bold text-amber-300 flex items-center gap-1">
                        <Film size={12} className="text-amber-400" />
                        {favoriteVideos.length} {favoriteVideos.length === 1 ? 'vídeo' : 'vídeos'}
                      </span>
                    </div>

                    <div className="p-3">
                      <h4 className="text-xs sm:text-sm font-bold text-white truncate leading-tight group-hover:text-amber-300 transition-colors flex items-center gap-1.5">
                        <Star size={14} className="fill-amber-400 text-amber-400 shrink-0" />
                        <span>{isEn ? "Favorite Videos" : "Vídeos Favoritos"}</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {favoriteVideos.length} {favoriteVideos.length === 1 ? 'vídeo salvo' : 'vídeos salvos'} • {profile.name}
                      </p>
                    </div>
                  </div>
                )}
                {playlists
                  .filter(pl => pl.title.toLowerCase().includes(playlistSearchTerm.toLowerCase()))
                  .map(pl => {
                    const isCurrent = activeSidePanel?.type === 'playlist' && activeSidePanel.item.id === pl.id;
                    return (
                      <div
                        key={pl.id}
                        onClick={() => handleOpenPlaylist(pl)}
                        className={`group relative rounded-xl sm:rounded-2xl overflow-hidden bg-[#161423] border cursor-pointer transition-all flex flex-col ${
                          isCurrent
                            ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-lg'
                            : 'border-white/10 hover:border-white/20 hover:bg-[#1D1A2E]'
                        }`}
                      >
                        <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                          <img loading="lazy" decoding="async" src={pl.thumbnailUrl}
                            alt={pl.title || copy.unnamedMedia}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                          
                          <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-sm text-[11px] font-bold text-white flex items-center gap-1">
                            <Film size={12} className="text-purple-400" />
                            {formatCount(pl.videoCount, copy.videos)}
                          </span>
                        </div>

                        <div className="p-3">
                          <h4 className="text-xs sm:text-sm font-bold text-white truncate leading-tight group-hover:text-purple-300 transition-colors">
                            {pl.title || copy.unnamedMedia}
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {formatDate(pl.updatedAtRaw || pl.lastAddedDate || pl.updatedAt, pl.metadataStatus)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Tab 3: Álbuns (Full Grid of All 57 Galleries) */}
          {activeCategoryTab === 'albuns' && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    {copy.ui34}
                  </h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-600/30 text-purple-300 font-semibold">
                    {albums.length}
                  </span>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={albumSearchTerm}
                    onChange={(e) => setAlbumSearchTerm(e.target.value)}
                    placeholder={copy.ui78}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#171526] border border-white/10 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
                {albums
                  .filter(a => a.title.toLowerCase().includes(albumSearchTerm.toLowerCase()))
                  .map(alb => {
                    const isCurrent = activeSidePanel?.type === 'album' && activeSidePanel.item.id === alb.id;
                    return (
                      <div
                        key={alb.id}
                        onClick={() => handleOpenAlbum(alb)}
                        className={`group relative rounded-xl sm:rounded-2xl overflow-hidden bg-[#161423] border cursor-pointer transition-all flex flex-col ${
                          isCurrent
                            ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-lg'
                            : 'border-white/10 hover:border-white/20 hover:bg-[#1D1A2E]'
                        }`}
                      >
                        <div className="relative aspect-square w-full overflow-hidden bg-slate-900">
                          <img loading="lazy" decoding="async" src={alb.thumbnailUrl}
                            alt={alb.title || copy.unnamedMedia}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                          
                          <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-sm text-[11px] font-bold text-white flex items-center gap-1">
                            <Images size={12} className="text-purple-400" />
                            {formatCount(alb.photoCount, copy.photos)}
                          </span>
                        </div>

                        <div className="p-3">
                          <h4 className="text-xs sm:text-sm font-bold text-white truncate leading-tight group-hover:text-purple-300 transition-colors">
                            {alb.title || copy.unnamedMedia}
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {formatDate(alb.updatedAtRaw ?? alb.updatedAt, alb.metadataStatus)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Tab 4: Vídeos (Full Video Grid View with Search & Quality Filters) */}
          {activeCategoryTab === 'videos' && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    <span>{copy.ui35}</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-600/30 text-purple-300 font-semibold">
                      {filteredVideos.length} {filteredVideos.length !== videos.length ? `de ${videos.length}` : ''}
                    </span>
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAllInCollection(filteredVideos)}
                    className="px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 text-xs font-semibold transition-all shrink-0"
                  >
                    {copy.ui16}
                  </button>
                  <div className="relative w-full sm:w-60">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={videoSearchTerm}
                      onChange={(e) => setVideoSearchTerm(e.target.value)}
                      placeholder={copy.ui79}
                      className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#171526] border border-white/10 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Quality Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  aria-pressed={videoFilterFavoritesOnly}
                  onClick={() => setVideoFilterFavoritesOnly(!videoFilterFavoritesOnly)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                    videoFilterFavoritesOnly
                      ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300 shadow-glow-amber'
                      : 'bg-[#181627] text-slate-400 hover:text-white border border-white/5'
                  }`}
                  title={videoFilterFavoritesOnly ? "Mostrar todos os vídeos" : "Filtrar vídeos favoritados"}
                >
                  <Star size={12} className={videoFilterFavoritesOnly ? "fill-amber-400 text-amber-400" : "text-slate-400"} />
                  <span>{isEn ? "Favorites" : "Favoritos"}</span>
                  {favoriteVideos.length > 0 && (
                    <span className="text-[10px] font-mono px-1 rounded bg-black/40 text-amber-300/90 font-bold">
                      {favoriteVideos.length}
                    </span>
                  )}
                </button>
                {(['all', '4K', '1080p', '720p'] as const).map(quality => (
                  <button
                    key={quality}
                    type="button"
                    onClick={() => setVideoQualityFilter(quality)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                      videoQualityFilter === quality
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-[#181627] text-slate-400 hover:text-white border border-white/5'
                    }`}
                  >
                    {quality === 'all' ? copy.ui36 : quality === '4K' ? '4K Ultra HD' : quality}
                  </button>
                ))}
              </div>

              {/* Videos Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredVideos.map(vid => {
                  const isSelected = selectedVideos[vid.id] !== undefined;
                  const isFav = favoriteVideoIds.includes(vid.id);
                  return (
                    <div
                      key={vid.id}
                      onClick={() => handlePlayVideo(vid)}
                      className={`group relative rounded-xl overflow-hidden bg-[#161423] border cursor-pointer transition-all flex flex-col ${
                        isSelected
                          ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-lg'
                          : 'border-white/10 hover:border-white/20 hover:bg-[#1D1A2E]'
                      }`}
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                        <img loading="lazy" decoding="async" src={vid.thumbnailUrl}
                          alt={vid.title || copy.unnamedMedia}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                        
                        {/* Play button hover overlay */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                          <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white shadow-xl">
                            <Play size={18} fill="white" className="ml-0.5" />
                          </div>
                        </div>

                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleMediaItem(vid);
                          }}
                          className={`absolute top-2 right-2 w-5 h-5 rounded-[5px] flex items-center justify-center transition-all z-10 ${
                            isSelected
                              ? 'bg-[#7C3AED] border border-[#7C3AED] text-white shadow-md'
                              : 'bg-black/50 border border-white/50 backdrop-blur-sm text-transparent hover:border-white'
                          }`}
                        >
                          <Check size={13} strokeWidth={3} className={isSelected ? 'opacity-100' : 'opacity-0'} />
                        </button>

                        {/* Quick Favorite Star Button */}
                        <button
                          type="button"
                          aria-pressed={isFav}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleProfileVideoFavorite({
                              ...vid,
                              artistName: profile.name,
                              folder: profile.destinationFolder,
                            });
                          }}
                          className={`absolute top-2 left-2 p-1.5 rounded-lg border backdrop-blur-md transition-all z-10 cursor-pointer ${
                            isFav
                              ? 'bg-black/75 border-amber-500/50 text-amber-400 shadow-glow-amber opacity-100'
                              : 'bg-black/50 border-white/20 text-white/70 hover:text-white hover:bg-black/80 opacity-0 group-hover:opacity-100'
                          }`}
                          title={isFav ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
                        >
                          <Star size={13} className={isFav ? "fill-amber-400 text-amber-400" : ""} />
                        </button>

                        {/* Duration badge */}
                        {vid.duration && (
                          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/80 backdrop-blur-sm text-[10px] font-bold text-white">
                            {vid.duration}
                          </span>
                        )}

                        {/* Quality badge */}
                        {vid.resolution && (
                          <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-purple-900/80 border border-purple-500/40 text-[10px] font-bold text-purple-200">
                            {vid.resolution}
                          </span>
                        )}
                      </div>

                      <div className="p-3">
                        <h4 className="text-xs sm:text-sm font-bold text-white truncate leading-tight group-hover:text-purple-300 transition-colors">
                          {vid.title || copy.unnamedMedia}
                        </h4>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5 gap-2">
                          <span className="truncate">
                            {vid.subtitle || [vid.duration, vid.resolution, vid.views].filter(Boolean).join(' • ') || formatDate(vid.uploadedAt || vid.timeAgo, vid.metadataStatus)}
                          </span>
                          {vid.views && (!vid.subtitle || !vid.subtitle.includes(vid.views)) && (
                            <span className="shrink-0 text-slate-500 font-mono text-[10px]">{vid.views}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Side Panel (Collection Detail, Full Catalog, or Review Selection) */}
        {activeSidePanel && (
          <div
            key={activeSidePanel.type + ('item' in activeSidePanel ? `:${activeSidePanel.item.id}` : '')}
            className={`w-full xl:w-1/2 2xl:w-[45%] shrink-0 xl:sticky xl:top-4 xl:h-[calc(100vh-140px)] min-h-[560px] ${
              settings?.disableAllAnimations ? '' : 'animate-view-slide'
            }`}
          >
            {/* Playlist Detail */}
            {activeSidePanel.type === 'playlist' && (
              <CollectionDetailPanel
                collection={activeSidePanel.item}
                kind="playlist"
                items={currentSidePanelItems}
                selectedItemIds={selectedItemIds}
                albums={albums}
                selectedAlbumIds={new Set(Object.keys(selectedAlbums))}
                onOpenAlbum={handleOpenAlbum}
                onToggleSelectAlbum={handleToggleSelectAlbum}
                isLoading={isLoadingCollection}
                error={collectionError}
                onToggleSelectItem={handleToggleMediaItem}
                onSelectAllItems={() => handleSelectAllInCollection(currentSidePanelItems)}
                onClearAllItems={() => handleClearAllInCollection(currentSidePanelItems)}
                onBack={handleBackToPlaylists}
                onPlayAll={() => currentSidePanelItems[0] && handlePlayVideo(currentSidePanelItems[0])}
                onSaveCollection={() => {
                  if (demoMode) handleSelectAllInCollection(currentSidePanelItems);
                  else setSelectedPlaylists(previous => ({ ...previous, [activeSidePanel.item.id]: activeSidePanel.item }));
                  requestSave();
                }}
                onItemClick={handlePlayVideo}
              />
            )}

            {/* Album Detail */}
            {activeSidePanel.type === 'album' && (
              <CollectionDetailPanel
                collection={activeSidePanel.item}
                kind="album"
                items={currentSidePanelItems}
                selectedItemIds={selectedItemIds}
                isLoading={isLoadingCollection}
                error={collectionError}
                onToggleSelectItem={handleToggleMediaItem}
                onSelectAllItems={() => handleSelectAllInCollection(currentSidePanelItems)}
                onClearAllItems={() => handleClearAllInCollection(currentSidePanelItems)}
                onBack={handleBackToAlbums}
                onPlayAll={(activeItems) => handleOpenAlbumSlideshow(activeItems && activeItems.length > 0 ? activeItems : currentSidePanelItems)}
                onSaveCollection={() => {
                  if (demoMode) handleToggleSelectAlbum(activeSidePanel.item);
                  else { setSelectedAlbums(previous => ({ ...previous, [activeSidePanel.item.id]: activeSidePanel.item })); requestReview(); }
                }}
                onItemClick={(photo, activeItems) => handleOpenPhotoLightbox(photo, activeItems && activeItems.length > 0 ? activeItems : currentSidePanelItems)}
                onLoadMore={handleLoadMoreAlbumItems}
                isLoadingMore={isLoadingMore}
                hasMore={activeSidePanel.item.paginationComplete === false && (activeSidePanel.item.photoCount == null
                  || (albumPhotosMap[activeSidePanel.item.id]?.length || 0) < activeSidePanel.item.photoCount)}
              />
            )}

            {/* GIF Collection Detail */}
            {activeSidePanel.type === 'gif-collection' && (
              <CollectionDetailPanel
                collection={activeSidePanel.item}
                kind="gif-collection"
                items={currentSidePanelItems}
                selectedItemIds={selectedItemIds}
                isLoading={isLoadingCollection}
                error={collectionError}
                onToggleSelectItem={handleToggleMediaItem}
                onSelectAllItems={() => handleSelectAllInCollection(currentSidePanelItems)}
                onClearAllItems={() => handleClearAllInCollection(currentSidePanelItems)}
                onBack={handleCloseSidePanel}
                onPlayAll={(activeItems) => {
                  const pool = activeItems && activeItems.length > 0 ? activeItems : currentSidePanelItems;
                  if (pool[0]) handleOpenPhotoLightbox(pool[0], pool);
                }}
                onSaveCollection={() => {
                  if (demoMode) handleToggleSelectAlbum(activeSidePanel.item);
                  else {
                    setSelectedAlbumPhotos(previous => ({ ...previous, ...Object.fromEntries(currentSidePanelItems.map(item => [item.id, item])) }));
                    requestReview();
                  }
                }}
                onItemClick={(photo, activeItems) => handleOpenPhotoLightbox(photo, activeItems && activeItems.length > 0 ? activeItems : currentSidePanelItems)}
              />
            )}

            {/* All Playlists Catalog */}
            {activeSidePanel.type === 'all-playlists' && (
              <AllPlaylistsPanel
                profileName={profile.name}
                playlists={playlists}
                selectedPlaylistIds={new Set(Object.keys(selectedPlaylists))}
                onToggleSelectPlaylist={handleToggleSelectPlaylist}
                onSelectAll={() => {
                  const map: Record<string, PlaylistItem> = {};
                  playlists.forEach(pl => { map[pl.id] = pl; });
                  setSelectedPlaylists(map);
                }}
                onClearAll={() => setSelectedPlaylists({})}
                onOpenPlaylist={handleOpenPlaylist}
                onBack={handleBackToPlaylists}
                onBatchDownload={() => setZipModalOpen(true)}
              />
            )}

            {/* All Albums Catalog */}
            {activeSidePanel.type === 'all-albums' && (
              <AllAlbumsPanel
                profileName={profile.name}
                albums={albums}
                selectedAlbumIds={new Set(Object.keys(selectedAlbums))}
                onToggleSelectAlbum={handleToggleSelectAlbum}
                onSelectAll={() => {
                  const map: Record<string, AlbumItem> = {};
                  albums.forEach(alb => { map[alb.id] = alb; });
                  setSelectedAlbums(map);
                }}
                onClearAll={() => setSelectedAlbums({})}
                onOpenAlbum={handleOpenAlbum}
                onBack={handleBackToAlbums}
                onBatchDownload={() => setZipModalOpen(true)}
              />
            )}

            {/* Review Selection View */}
            {activeSidePanel.type === 'review-selection' && (
              <ReviewSelectionPanel
                profileName={profile.name}
                selectedVideos={selectedVideoList}
                selectedAlbums={selectedAlbumList}
                destinationFolder={profile.destinationFolder}
                availableFolders={demoMode ? profile.availableFolders : availableFolders}
                onDestinationFolderChange={handleDestinationFolderChange}
                onRemoveVideo={(id) => {
                  setSelectedVideos(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  });
                }}
                onRemoveAlbum={(id) => {
                  setSelectedAlbums(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  });
                }}
                onSaveToGallery={requestSave}
                onDownloadZip={requestZip}
                onBack={handleCloseSidePanel}
              />
            )}
          </div>
        )}
      </div>

      {/* Floating Action Bar (Bottom Center) */}
      {!isReview && !isHubHome && (demoMode && !isDirectory && globalSelection.groups.every(group => profiles[group.profileKey].demoMode) ? <FloatingActionBar
        selectedCount={globalSelection.count}
        selectedSummary={globalSelection.groups.length > 1 ? copy.multipleProfiles.replace('{count}', String(globalSelection.groups.length)) : buildSummaryText()}
        previewThumbnails={globalSelection.thumbnails}
        actionsDisabled={!canExecuteActiveSelection}
        saveDisabled={!canSaveActiveSelection}
        saveDisabledReason={profileHubReviewCopy[settings.language].legacySaveHint}
        disabledReason={copy.multipleProfilesReviewRequired}
        onOpenReview={requestReview}
        onSaveToGallery={requestSave}
        onDownloadZip={requestZip}
        onClearSelection={() => useProfileHubStore.getState().clearSelections()}
      /> : <ProfileHubSelectionBar active={active} />)}

      {/* Folder Selection Modal */}
      {saveModalOpen && (
        <FolderSelectModal
          isOpen
          onClose={() => setSaveModalOpen(false)}
          onConfirm={handleConfirmSave}
          itemTitle={profile.name}
          mediaType="video"
          existingFolders={videoFolders.map(folder => folder.name)}
          currentFolder={profiles[profileKey]?.destinations.videoFolder || profile.destinationFolder || undefined}
        />
      )}

      {/* ZIP Download Modal Confirmation */}
      {zipModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md p-6 rounded-3xl bg-[#141221] border border-white/15 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
              <Sparkles size={28} />
            </div>
            <h3 className="text-xl font-bold text-white">{copy.ui47}</h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {copy.selectionZipHint.replace("{count}", String(totalSelectedCount)).replace("{summary}", buildSummaryText())}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setZipModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs sm:text-sm transition-all"
              >
                {copy.ui46}
              </button>
              <button
                type="button"
                onClick={handleConfirmDownloadZip}
                disabled={isProcessingAction}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-purple-600/30 transition-all flex items-center justify-center gap-2"
              >
                {isProcessingAction ? <Loader2 size={16} className="animate-spin" /> : null}
                <span>{isProcessingAction ? 'Baixando...' : copy.ui48}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
