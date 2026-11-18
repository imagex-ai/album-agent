import { create } from 'zustand';
import type { ViewId } from '../types';
import type { TimelineWatchSession } from '../components/profile-hub/timeline/TimelineWatchView';
import {
  TimelineCreator,
  TimelinePost,
  TimelineComment,
  TimelineLightboxState,
  TimelinePhotoItem,
  TimelinePlaylist,
  TimelineVideoQuality,
  TimelineSourceIdentityHint,
  hasKnownExactPublicationDate,
  mapScanResponseToTimelinePosts,
  mergeRefreshedTimelinePosts,
  mergeTimelineCreatorStats,
  resolveCreatorHandle,
  resolveTimelinePlatform,
  sanitizeCreatorHandle,
  sortTimelinePostsByPublication,
  timelinePublicationTime,
  extractPlaylistsFromScan,
  upgradePhotoUrlFast,
} from '../components/profile-hub/timeline/timelineModel';
import { discoverRecentProfileRoot, fetchAlbumPhotos } from '../services/profileHubApi';
import { useAppStore } from './useAppStore';
import { readTimelineCatalog, writeTimelineCatalog, catalogSnapshot } from '../services/timelineCatalogCache';
import {useProfileDirectoryLibraryStore} from './useProfileDirectoryLibraryStore';
import {useProfileHubLibraryStore} from './useProfileHubLibraryStore';
import {
  canonicalLibraryMediaKey,
  normalizeTimelinePostToLibraryItem,
} from '../services/profileHubLibraryModel';
import {projectSavedTimelineCreators} from '../services/timelineSavedCreators';
import {engagementSourceUrl} from '../services/profileHubEngagement';

const albumPhotosMemoryCache = new Map<string, TimelinePhotoItem[]>();
// Each opening owns its completion, including reopening the same album.
let lightboxRequestVersion = 0;
let lightboxAlbumController: AbortController | undefined;
let timelineBootstrapRequest: Promise<void> | undefined;
let timelineIdentityHints: TimelineSourceIdentityHint[] = [];
const creatorCatalogControllers = new Map<string, AbortController>();
let timelineHasBootstrapped = false;
let timelineFavoritesSubscribed = false;
let timelineLibrarySubscribed = false;

export interface CreatorWatchReturnTarget {
  viewId: ViewId;
  watchSession: TimelineWatchSession | null;
  playlistId: string | null;
  preferDesktopPreview?: boolean;
}

interface ProfileTimelineState {
  creators: TimelineCreator[];
  creatorProfiles: Record<string,TimelineCreator>;
  posts: TimelinePost[];
  isLoading: boolean;
  error: string | null;

  activeFilter: 'recentes' | 'para_voce';
  searchQuery: string;
  selectedCreatorId: string | null;
  activeProfileTab: string;

  activeAutoplayPostId: string | null;
  isDiscoveringCreator: Record<string, boolean>;
  discoveredCreatorIds: Record<string, boolean>;
  creatorRefreshErrors: Record<string, boolean>;
  creatorRefreshedAt: Record<string, number>;

  activeCommentsPostId: string | null;
  lightbox: TimelineLightboxState;

  likedPostIds: Record<string, boolean>;
  savedPostIds: Record<string, boolean>;
  favoritedPostIds: Record<string, boolean>;
  followedCreatorIds: Record<string, boolean>;
  userComments: Record<string, TimelineComment[]>;
  isGlobalMuted: boolean;

  // Actions
  loadTimelineData: () => Promise<void>;
  setActiveFilter: (filter: 'recentes' | 'para_voce') => void;
  setSearchQuery: (query: string) => void;
  setSelectedCreatorId: (creatorId: string | null) => void;
  setActiveProfileTab: (tab: string) => void;
  setActiveAutoplayPostId: (postId: string | null) => void;
  discoverCreatorCatalog: (creatorId: string, signal?: AbortSignal, streamFull?: boolean) => Promise<void>;
  refreshTimeline: (signal?: AbortSignal) => Promise<void>;
  refreshMissingCreators: (creatorIds: string[], signal?: AbortSignal) => Promise<void>;
  suspendRequests: () => void;
  toggleLike: (postId: string, postSnapshot?: TimelinePost, creatorSnapshot?: Partial<TimelineCreator> | null) => void;
  toggleSave: (postId: string) => void;
  toggleFavorite: (postId: string, postSnapshot?: TimelinePost, creatorSnapshot?: Partial<TimelineCreator> | null) => void;
  pendingCreatorProfileUrl: string | null;
  pendingCreatorSeed: { name?: string; avatar?: string | null } | null;
  pendingCreatorReturn: CreatorWatchReturnTarget | null;
  pendingLibraryWatchRestore: CreatorWatchReturnTarget | null;
  setPendingCreatorProfileUrl: (
    url: string | null,
    seed?: { name?: string; avatar?: string | null } | null,
    returnTarget?: CreatorWatchReturnTarget | null
  ) => void;
  setPendingLibraryWatchRestore: (target: CreatorWatchReturnTarget | null) => void;
  clearPendingLibraryWatchRestore: () => void;
  toggleFollowCreator: (creator: string | TimelineCreator) => boolean;
  openComments: (postId: string) => void;
  closeComments: () => void;
  addComment: (postId: string, text: string) => void;
  openLightbox: (
    images: string[],
    index?: number,
    title?: string,
    albumUrl?: string,
    items?: TimelinePhotoItem[],
    expectedPhotoCount?: number
  ) => void;
  updateLightboxItemResolution: (
    index: number,
    resolved: {
      url: string;
      width?: number;
      height?: number;
      fileSizeBytes?: number;
      format?: string;
    }
  ) => void;
  updatePostStream: (
    postId: string,
    updated: {
      videoUrl?: string;
      masterHlsUrl?: string;
      qualities?: TimelineVideoQuality[];
    }
  ) => void;
  closeLightbox: () => void;
  nextLightboxImage: () => void;
  prevLightboxImage: () => void;
  toggleGlobalMute: () => void;
}

const STORAGE_KEY = 'imagex_timeline_interactions_v1';

function loadPersistedInteractions() {
  if (typeof window === 'undefined') {
    return { liked: {}, saved: {}, favorited: {}, followed: {}, userComments: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { liked: {}, saved: {}, favorited: {}, followed: {}, userComments: {} };
    return JSON.parse(raw);
  } catch {
    return { liked: {}, saved: {}, favorited: {}, followed: {}, userComments: {} };
  }
}

function persistInteractions(state: {
  liked: Record<string, boolean>;
  saved: Record<string, boolean>;
  favorited: Record<string, boolean>;
  followed: Record<string, boolean>;
  userComments: Record<string, TimelineComment[]>;
}) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

const initialInteractions = loadPersistedInteractions();

function reconcileSavedCreators() {
  const state=useProfileTimelineStore.getState();
  const known={...state.creatorProfiles};
  for(const creator of state.creators) known[creator.id]=creator;
  const creators=projectSavedTimelineCreators(useProfileDirectoryLibraryStore.getState().favorites,Object.values(known));
  for(const creator of creators) known[creator.id]=creator;
  for(const creator of state.creators) {
    if(!creators.some(current=>current.id===creator.id) && state.selectedCreatorId!==creator.id) creatorCatalogControllers.get(creator.id)?.abort();
  }
  useProfileTimelineStore.setState({creators,creatorProfiles:known});
}

function subscribeToSavedCreators() {
  if(timelineFavoritesSubscribed) return;
  timelineFavoritesSubscribed=true;
  useProfileDirectoryLibraryStore.subscribe((state,previous)=>{
    if(state.favorites!==previous.favorites) reconcileSavedCreators();
  });
}

function reconcileLibraryInteractions(previousLikedKeys?: Set<string>, previousFavKeys?: Set<string>) {
  const lib = useProfileHubLibraryStore.getState();
  const state = useProfileTimelineStore.getState();
  const likedKeys = new Set(lib.liked.map((entry) => entry.key));
  const likedIds = new Set(lib.liked.map((entry) => entry.id));
  const favKeys = new Set(lib.favorites.map((entry) => entry.key));
  const favIds = new Set(lib.favorites.map((entry) => entry.id));

  const nextLiked = lib.hydrated ? ({} as Record<string, boolean>) : { ...state.likedPostIds };
  const nextFav = lib.hydrated ? ({} as Record<string, boolean>) : { ...state.favoritedPostIds };

  if (lib.hydrated) {
    for (const id of likedIds) nextLiked[id] = true;
    for (const id of favIds) nextFav[id] = true;
  }

  for (const post of state.posts) {
    const key = canonicalLibraryMediaKey(post);
    const matchesLike = Boolean(likedIds.has(post.id) || (key && likedKeys.has(key)));
    if (matchesLike) {
      nextLiked[post.id] = true;
    } else if (lib.hydrated || (previousLikedKeys && key && previousLikedKeys.has(key))) {
      delete nextLiked[post.id];
    }

    const matchesFav = Boolean(favIds.has(post.id) || (key && favKeys.has(key)));
    if (matchesFav) {
      nextFav[post.id] = true;
    } else if (lib.hydrated || (previousFavKeys && key && previousFavKeys.has(key))) {
      delete nextFav[post.id];
    }
  }

  const prevLikedKeys = Object.keys(state.likedPostIds).filter((k) => state.likedPostIds[k]);
  const curLikedKeys = Object.keys(nextLiked).filter((k) => nextLiked[k]);
  const likedChanged =
    prevLikedKeys.length !== curLikedKeys.length ||
    curLikedKeys.some((k) => !state.likedPostIds[k]);

  const prevFavKeys = Object.keys(state.favoritedPostIds).filter((k) => state.favoritedPostIds[k]);
  const curFavKeys = Object.keys(nextFav).filter((k) => nextFav[k]);
  const favChanged =
    prevFavKeys.length !== curFavKeys.length ||
    curFavKeys.some((k) => !state.favoritedPostIds[k]);

  if (likedChanged || favChanged) {
    persistInteractions({
      liked: nextLiked,
      saved: state.savedPostIds,
      favorited: nextFav,
      followed: state.followedCreatorIds,
      userComments: state.userComments,
    });
    useProfileTimelineStore.setState({
      likedPostIds: nextLiked,
      favoritedPostIds: nextFav,
    });
  }
}

function subscribeToLibraryStore() {
  if (timelineLibrarySubscribed) return;
  timelineLibrarySubscribed = true;
  useProfileHubLibraryStore.subscribe((state, previous) => {
    if (
      state.liked !== previous.liked ||
      state.favorites !== previous.favorites ||
      state.hydrated !== previous.hydrated
    ) {
      reconcileLibraryInteractions(
        new Set(previous.liked.map((entry) => entry.key)),
        new Set(previous.favorites.map((entry) => entry.key))
      );
    }
  });
  useProfileTimelineStore.subscribe((state, previous) => {
    if (state.posts !== previous.posts) {
      reconcileLibraryInteractions();
    }
  });
}

export const useProfileTimelineStore = create<ProfileTimelineState>((set, get) => ({
  creators: [],
  creatorProfiles: {},
  posts: [],
  isLoading: false,
  error: null,

  activeFilter: 'recentes',
  searchQuery: '',
  selectedCreatorId: null,
  activeProfileTab: 'timeline',

  activeAutoplayPostId: null,
  isDiscoveringCreator: {},
  discoveredCreatorIds: {},
  creatorRefreshErrors: {},
  creatorRefreshedAt: {},

  activeCommentsPostId: null,
  lightbox: {
    isOpen: false,
    images: [],
    items: [],
    currentIndex: 0,
    title: '',
    albumUrl: undefined,
    isLoadingAlbum: false,
  },

  likedPostIds: initialInteractions.liked || {},
  savedPostIds: initialInteractions.saved || {},
  favoritedPostIds: initialInteractions.favorited || {},
  followedCreatorIds: initialInteractions.followed || {},
  userComments: initialInteractions.userComments || {},
  isGlobalMuted: true,
  pendingCreatorProfileUrl: null,
  pendingCreatorSeed: null,
  pendingCreatorReturn: null,
  pendingLibraryWatchRestore: null,
  setPendingCreatorProfileUrl: (url, seed = null, returnTarget = null) =>
    set({
      pendingCreatorProfileUrl: url,
      pendingCreatorSeed: url ? seed : null,
      pendingCreatorReturn: url ? returnTarget : null,
    }),
  setPendingLibraryWatchRestore: (target) => set({ pendingLibraryWatchRestore: target }),
  clearPendingLibraryWatchRestore: () => set({ pendingLibraryWatchRestore: null }),

  loadTimelineData: () => {
    if (timelineBootstrapRequest) return timelineBootstrapRequest;
    const request = (async () => {
    set({ isLoading: true, error: null });
    const isEn = useAppStore.getState().settings?.language === 'en-US';

    try {
      if(!timelineHasBootstrapped) {
        const cached = await readTimelineCatalog();
        if(cached) {
          timelineIdentityHints=cached.identityHints;
          const cleanCachedCreators = cached.creators.map((creator) => {
            const cleanHandle = resolveCreatorHandle({
              handle: creator.handle,
              name: creator.name,
              profileUrl: creator.profileUrl,
            });
            return cleanHandle && cleanHandle !== creator.handle ? { ...creator, handle: cleanHandle } : creator;
          });
          const cachedCreatorById = new Map(cleanCachedCreators.map((creator) => [creator.id, creator]));
          const cleanCachedPosts = cached.posts.map((post) => {
            if (sanitizeCreatorHandle(post.creatorHandle)) return post;
            const owner = cachedCreatorById.get(post.creatorId);
            const cleanHandle = resolveCreatorHandle({
              handle: owner?.handle || post.creatorHandle,
              name: owner?.name || post.creatorName,
              profileUrl: owner?.profileUrl,
            });
            return cleanHandle !== post.creatorHandle ? { ...post, creatorHandle: cleanHandle } : post;
          });
          set(state=>({
            creatorProfiles:{...Object.fromEntries(cleanCachedCreators.map(creator=>[creator.id,creator])),...state.creatorProfiles},
            posts:sortTimelinePostsByPublication(cleanCachedPosts),
            creatorRefreshedAt:cached.creatorRefreshedAt
          }));
        }
        timelineHasBootstrapped=true;
      }
      subscribeToSavedCreators();
      subscribeToLibraryStore();
      reconcileSavedCreators();
      await Promise.all([
        useProfileDirectoryLibraryStore.getState().initSync(),
        useProfileHubLibraryStore.getState().hydrateLibrary(),
      ]);
      reconcileSavedCreators();
      reconcileLibraryInteractions();
      const library=useProfileDirectoryLibraryStore.getState();
      set({isLoading:false,error:!library.favoritesHydrated && !get().creators.length
        ? (isEn ? 'Could not load saved creators. Try again.' : 'Não foi possível carregar os criadores salvos. Tente novamente.') : null});
    } catch (err: any) {
      set({
        error: err.message || (isEn ? 'Unknown error' : 'Erro desconhecido'),
        isLoading: false,
      });
    }
    })();
    timelineBootstrapRequest = request;
    void request.finally(() => {
      if (timelineBootstrapRequest === request) timelineBootstrapRequest = undefined;
    });
    return request;
  },

  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedCreatorId: (creatorId) => {
    set({
      selectedCreatorId: creatorId,
      activeProfileTab: 'timeline',
      activeAutoplayPostId: null,
    });
    if (creatorId) {
      void get().discoverCreatorCatalog(creatorId, undefined, true);
    }
  },

  setActiveProfileTab: (tab) => set({ activeProfileTab: tab }),

  setActiveAutoplayPostId: (postId) => set({ activeAutoplayPostId: postId }),

  discoverCreatorCatalog: async (creatorId: string, parentSignal?: AbortSignal, streamFull = false) => {
    const state = get();
    if (parentSignal?.aborted || state.isDiscoveringCreator[creatorId]) {
      return;
    }
    const creator = state.creators.find((c) => c.id === creatorId) || state.creatorProfiles[creatorId];
    if (!creator || !creator.profileUrl || !creator.profileUrl.startsWith('http')) {
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort();
    parentSignal?.addEventListener('abort', abort, {once:true});
    creatorCatalogControllers.set(creatorId, controller);

    set((s) => ({
      isDiscoveringCreator: { ...s.isDiscoveringCreator, [creatorId]: true },
      creatorRefreshErrors: { ...s.creatorRefreshErrors, [creatorId]: false },
    }));

    const applyScanResult = (scanData: any) => {
      if (!scanData || signal?.aborted) return;
      set((s) => {
        const targetCreator = s.creators.find((c) => c.id === creatorId) || s.creatorProfiles[creatorId];
        if (!targetCreator || targetCreator.profileUrl !== creator.profileUrl) return s;

        const hero = scanData?.profile_data;
        const nextName = (typeof hero?.name === 'string' && hero.name.trim())
          || (typeof scanData?.name === 'string' && scanData.name.trim())
          || targetCreator.name;
        const nextAvatar = (typeof hero?.avatarUrl === 'string' && hero.avatarUrl.trim())
          || (typeof scanData?.cover_url === 'string' && scanData.cover_url.trim())
          || targetCreator.avatar;
        const nextHandle = resolveCreatorHandle({
          handle: hero?.handle || targetCreator.handle,
          name: nextName,
          profileUrl: targetCreator.profileUrl,
        });
        const nextVerified = hero?.verified !== undefined ? Boolean(hero.verified) : targetCreator.verified;
        const nextBio = (typeof hero?.tagline === 'string' && hero.tagline.trim())
          || (typeof scanData?.description === 'string' && scanData.description.trim())
          || targetCreator.bio;
        const nextSite = resolveTimelinePlatform(
          targetCreator.profileUrl,
          (typeof hero?.site === 'string' ? hero.site : undefined) || targetCreator.site
        ) || targetCreator.site;
        const nextStats = mergeTimelineCreatorStats(targetCreator.stats, hero?.stats, hero?.bio_details);

        const refreshedCreator: TimelineCreator = {
          ...targetCreator,
          name: nextName,
          avatar: nextAvatar,
          handle: nextHandle || targetCreator.handle,
          site: nextSite,
          verified: nextVerified,
          stats: nextStats,
          bio: nextBio,
        };

        const mergedCreatorPosts = mapScanResponseToTimelinePosts(
          refreshedCreator,
          scanData,
          s.posts,
          timelineIdentityHints
        );

        const scannedPlaylists = extractPlaylistsFromScan(refreshedCreator, scanData);
        const updatedPlaylists: TimelinePlaylist[] =
          scannedPlaylists.length > 0 ? scannedPlaylists : (targetCreator.playlists || []);

        const updatedCreators = s.creators.map((c) =>
          c.id === creatorId
            ? {
                ...c,
                name: refreshedCreator.name,
                avatar: refreshedCreator.avatar,
                handle: refreshedCreator.handle,
                site: refreshedCreator.site,
                verified: refreshedCreator.verified,
                bio: refreshedCreator.bio,
                playlists: updatedPlaylists,
                // Loaded tabs count their own items. Partial discovery cannot
                // replace source-reported totals or turn an unknown into zero.
                stats: mergeTimelineCreatorStats(c.stats, hero?.stats, hero?.bio_details),
              }
            : c
        );

        const currentPostsWithCleanHandle = s.posts.map((post) => {
          if (post.creatorId !== creatorId) return post;
          const postNeedsHandleRepair = !sanitizeCreatorHandle(post.creatorHandle) || (refreshedCreator.handle && post.creatorHandle !== refreshedCreator.handle);
          const postNeedsMetaRepair = (refreshedCreator.name && post.creatorName !== refreshedCreator.name)
            || (refreshedCreator.avatar && post.creatorAvatar !== refreshedCreator.avatar);
          if (!postNeedsHandleRepair && !postNeedsMetaRepair) return post;
          return {
            ...post,
            creatorName: refreshedCreator.name || post.creatorName,
            creatorHandle: refreshedCreator.handle || post.creatorHandle,
            creatorAvatar: refreshedCreator.avatar || post.creatorAvatar,
          };
        });

        return {
          creators: updatedCreators,
          creatorProfiles:{...s.creatorProfiles,[creatorId]:{...refreshedCreator,playlists:updatedPlaylists}},
          // Only insert newly discovered identities. Keep all concurrent posts,
          // player references and local interaction IDs intact.
          posts: mergeRefreshedTimelinePosts(currentPostsWithCleanHandle, mergedCreatorPosts),
        };
      });
    };

    try {
      const knownDates = get().posts.filter(post => post.creatorId === creatorId && hasKnownExactPublicationDate(post))
        .map(post => post.originalUrl!);
      const knownMedia = [...new Set([...get().posts,...timelineIdentityHints].filter(post => post.creatorId === creatorId && post.type !== 'video')
        .flatMap(post => [post.originalUrl,post.albumUrl]).filter((url): url is string => Boolean(url)))];
      const finalScan = await discoverRecentProfileRoot(
        creator.profileUrl,
        signal,
        creator.name,
        knownDates,
        knownMedia,
        streamFull ? (snapshot) => applyScanResult(snapshot) : undefined,
      );
      applyScanResult(finalScan);
      if (signal?.aborted) {
        set(s => ({isDiscoveringCreator:{...s.isDiscoveringCreator,[creatorId]:false}}));
        return;
      }
      set((s) => {
        if (!(s.creators.find(c=>c.id===creatorId) || s.creatorProfiles[creatorId]) || (s.creators.find(c=>c.id===creatorId) || s.creatorProfiles[creatorId]).profileUrl!==creator.profileUrl) {
          return {isDiscoveringCreator:{...s.isDiscoveringCreator,[creatorId]:false}};
        }
        return {
        creatorRefreshErrors: { ...s.creatorRefreshErrors, [creatorId]: Boolean(finalScan.discovery_errors?.length) },
        creatorRefreshedAt: (s.creators.find(c=>c.id===creatorId) || s.creatorProfiles[creatorId])?.profileUrl === creator.profileUrl
          && !finalScan.discovery_errors?.length
          ? { ...s.creatorRefreshedAt, [creatorId]: Date.now() } : s.creatorRefreshedAt,
        isDiscoveringCreator: { ...s.isDiscoveringCreator, [creatorId]: false },
        discoveredCreatorIds: { ...s.discoveredCreatorIds, [creatorId]: true },
      };
      });
      if (!signal?.aborted && (get().creators.find(c=>c.id===creatorId) || get().creatorProfiles[creatorId])?.profileUrl===creator.profileUrl) {
        const current = get();
        void writeTimelineCatalog(catalogSnapshot({...current,creators:Object.values(current.creatorProfiles)},timelineIdentityHints,current.creatorRefreshedAt));
      }
    } catch {
      set((s) => ({
        creatorRefreshErrors: { ...s.creatorRefreshErrors, [creatorId]: !signal?.aborted },
        isDiscoveringCreator: { ...s.isDiscoveringCreator, [creatorId]: false },
      }));
    } finally {
      parentSignal?.removeEventListener('abort', abort);
      if (creatorCatalogControllers.get(creatorId) === controller) creatorCatalogControllers.delete(creatorId);
    }
  },

  suspendRequests: () => {
    for (const controller of creatorCatalogControllers.values()) controller.abort();
    lightboxAlbumController?.abort();
    lightboxAlbumController = undefined;
    lightboxRequestVersion++;
    set(state => state.lightbox.isLoadingAlbum ? {lightbox:{...state.lightbox,isLoadingAlbum:false}} : state);
  },

  refreshMissingCreators: async (creatorIds: string[], signal?: AbortSignal) => {
    if (signal?.aborted || creatorIds.length === 0) return;
    await get().loadTimelineData();
    const targetSet = new Set(creatorIds);
    const creators = get().creators.filter(creator => targetSet.has(creator.id)).map(creator => ({ id: creator.id, url: creator.profileUrl }));
    for (const creator of creators) {
      if (signal?.aborted) return;
      if (get().creators.some(current => current.id === creator.id && current.profileUrl === creator.url)) {
        await get().discoverCreatorCatalog(creator.id, signal);
      }
    }
  },

  refreshTimeline: async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    await get().loadTimelineData();
    // Serial source discovery bounds network pressure without imposing a
    // business limit on the number of creators in a user's feed.
    const creators = get().creators.map(creator => ({ id: creator.id, url: creator.profileUrl }));
    for (const creator of creators) {
      if (signal?.aborted) return;
      if (get().creators.some(current => current.id === creator.id && current.profileUrl === creator.url)) {
        await get().discoverCreatorCatalog(creator.id, signal);
      }
    }
  },

  toggleLike: (postId, postSnapshot, creatorSnapshot) => {
    const state = get();
    const nextValue = !state.likedPostIds[postId];
    const nextLiked = { ...state.likedPostIds, [postId]: nextValue };
    if (!nextValue) delete nextLiked[postId];
    persistInteractions({
      liked: nextLiked,
      saved: state.savedPostIds,
      favorited: state.favoritedPostIds,
      followed: state.followedCreatorIds,
      userComments: state.userComments,
    });
    set({ likedPostIds: nextLiked });

    const matchedPost = postSnapshot || state.posts.find((p) => p.id === postId);
    const matchedCreator =
      creatorSnapshot ||
      (matchedPost
        ? state.creatorProfiles[matchedPost.creatorId] ||
          state.creators.find((c) => c.id === matchedPost.creatorId)
        : undefined);
    const libItem = matchedPost
      ? normalizeTimelinePostToLibraryItem(matchedPost, matchedCreator)
      : { id: postId, kind: 'video' as const, title: '' };
    if (libItem) {
      void useProfileHubLibraryStore.getState().setLikedItem(libItem, nextValue);
    }
  },

  toggleSave: (postId) => {
    set((state) => {
      const nextSaved = { ...state.savedPostIds, [postId]: !state.savedPostIds[postId] };
      persistInteractions({
        liked: state.likedPostIds,
        saved: nextSaved,
        favorited: state.favoritedPostIds,
        followed: state.followedCreatorIds,
        userComments: state.userComments,
      });
      return { savedPostIds: nextSaved };
    });
  },

  toggleFavorite: (postId, postSnapshot, creatorSnapshot) => {
    const state = get();
    const nextValue = !state.favoritedPostIds[postId];
    const nextFav = { ...state.favoritedPostIds, [postId]: nextValue };
    if (!nextValue) delete nextFav[postId];
    persistInteractions({
      liked: state.likedPostIds,
      saved: state.savedPostIds,
      favorited: nextFav,
      followed: state.followedCreatorIds,
      userComments: state.userComments,
    });
    set({ favoritedPostIds: nextFav });

    const matchedPost = postSnapshot || state.posts.find((p) => p.id === postId);
    const matchedCreator =
      creatorSnapshot ||
      (matchedPost
        ? state.creatorProfiles[matchedPost.creatorId] ||
          state.creators.find((c) => c.id === matchedPost.creatorId)
        : undefined);
    const libItem = matchedPost
      ? normalizeTimelinePostToLibraryItem(matchedPost, matchedCreator)
      : { id: postId, kind: 'video' as const, title: '' };
    if (libItem) {
      void useProfileHubLibraryStore.getState().setFavoriteItem(libItem, nextValue);
    }
  },

  toggleFollowCreator: (input) => {
    const creator=typeof input==='string' ? get().creators.find(item=>item.id===input) || get().creatorProfiles[input] : input;
    if(!creator || !engagementSourceUrl(creator.profileUrl)) return false;
    subscribeToSavedCreators();
    set(state=>({creatorProfiles:{...state.creatorProfiles,[creator.id]:creator}}));
    const accepted=useProfileDirectoryLibraryStore.getState().toggleFavorite({kind:'profile',url:creator.profileUrl,name:creator.name || null,imageUrl:creator.avatar || null});
    if(accepted && timelineHasBootstrapped) {
      const current=get();
      void writeTimelineCatalog(catalogSnapshot({...current,creators:Object.values(current.creatorProfiles)},timelineIdentityHints,current.creatorRefreshedAt));
    }
    return accepted;
  },

  openComments: (postId) => set({ activeCommentsPostId: postId }),

  closeComments: () => set({ activeCommentsPostId: null }),

  addComment: (postId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const isEn = useAppStore.getState().settings?.language === 'en-US';

    const newComment: TimelineComment = {
      author: isEn ? 'You' : 'Você',
      handle: isEn ? '@user' : '@usuario',
      avatar: '',
      time: isEn ? 'just now' : 'agora',
      likes: '0',
      text: trimmed,
      isAuthor: true,
    };

    set((state) => {
      const postComments = state.userComments[postId] || [];
      const nextComments = {
        ...state.userComments,
        [postId]: [newComment, ...postComments],
      };
      persistInteractions({
        liked: state.likedPostIds,
        saved: state.savedPostIds,
        favorited: state.favoritedPostIds,
        followed: state.followedCreatorIds,
        userComments: nextComments,
      });
      return { userComments: nextComments };
    });
  },

  openLightbox: (images, index = 0, title = '', albumUrl, items, expectedPhotoCount) => {
    lightboxAlbumController?.abort();
    lightboxAlbumController = undefined;
    const requestVersion = ++lightboxRequestVersion;
    const ownsLightbox = () => requestVersion === lightboxRequestVersion;
    const cachedItems = albumUrl ? albumPhotosMemoryCache.get(albumUrl) : undefined;
    let baseItems = items;
    let baseImages = images;

    if (cachedItems && cachedItems.length > (items?.length || 0)) {
      baseItems = cachedItems;
      baseImages = cachedItems.map((it) => it.url);
    }

    const cleanImages = (baseImages || []).map((u) => upgradePhotoUrlFast(u)).filter(Boolean);
    const initialItems: TimelinePhotoItem[] =
      baseItems && baseItems.length === cleanImages.length
        ? baseItems.map((it, idx) => ({ ...it, url: cleanImages[idx] || it.url }))
        : cleanImages.map((u) => ({
            url: u,
            thumbnailUrl: u,
            sourcePage: albumUrl,
          }));

    const matchingPost = get().posts.find(
      (p) => (albumUrl && (p.albumUrl === albumUrl || p.originalUrl === albumUrl)) || (!albumUrl && title && p.title === title)
    );
    let creatorAlbumCount = 0;
    for (const c of get().creators) {
      const a = (c as any).albums?.find(
        (alb: any) =>
          (albumUrl && (alb.url === albumUrl || alb.source_url === albumUrl || alb.albumUrl === albumUrl)) ||
          (!albumUrl && title && alb.title === title)
      );
      if (a && typeof a.photoCount === 'number') {
        creatorAlbumCount = a.photoCount;
        break;
      }
    }
    const expectedCount = expectedPhotoCount || matchingPost?.photoCount || creatorAlbumCount || 0;
    const hasCachedFullAlbum = Boolean(
      cachedItems && cachedItems.length >= Math.max(expectedCount, 5)
    );

    const hasEnoughLocalPhotos =
      cleanImages.length > 4 &&
      (expectedCount <= 0 || cleanImages.length >= expectedCount) &&
      !(cleanImages.length >= 2 && cleanImages[0] === cleanImages[1]);

    if (hasEnoughLocalPhotos && albumUrl && !albumPhotosMemoryCache.has(albumUrl)) {
      albumPhotosMemoryCache.set(albumUrl, initialItems);
    }

    const needsRemoteAlbumFetch = Boolean(
      albumUrl &&
        albumUrl.startsWith('http') &&
        !hasCachedFullAlbum &&
        !hasEnoughLocalPhotos &&
        (!cachedItems ||
          cleanImages.length <= 4 ||
          (expectedCount > 0 && cleanImages.length < expectedCount) ||
          (cleanImages.length >= 2 && cleanImages[0] === cleanImages[1]))
    );

    set({
      lightbox: {
        isOpen: true,
        images: cleanImages,
        items: initialItems,
        currentIndex: Math.max(0, Math.min(index, Math.max(0, cleanImages.length - 1))),
        title,
        albumUrl,
        isLoadingAlbum: needsRemoteAlbumFetch,
      },
    });

    if (needsRemoteAlbumFetch && albumUrl) {
      const controller = new AbortController();
      lightboxAlbumController = controller;
      void fetchAlbumPhotos(albumUrl, controller.signal, 1)
        .then((res) => {
          if (controller.signal.aborted) return;
          if (!res.photos || res.photos.length === 0) {
            if (!ownsLightbox()) return;
            set((s) => ({
              lightbox: { ...s.lightbox, isLoadingAlbum: false },
            }));
            return;
          }

          const fetchedItems: TimelinePhotoItem[] = res.photos.map((p) => {
            const rawUrl = p.originalUrl || p.thumbnailUrl;
            const upUrl = upgradePhotoUrlFast(rawUrl);
            return {
              id: p.id,
              url: upUrl,
              thumbnailUrl: p.thumbnailUrl || rawUrl,
              pageUrl: p.pageUrl,
              sourcePage: p.sourcePage || albumUrl,
              width: p.width,
              height: p.height,
              fileSizeBytes: p.fileSizeBytes,
              format: p.format,
              isResolvedOriginal: p.isResolvedOriginal,
              isAnimated: p.type === 'gif' || (p as any).isAnimated,
            };
          });
          const fetchedUrls = fetchedItems.map((it) => it.url);

          // A loaded page is not proof of a complete album.
          if (res.metadata.paginationComplete === true) albumPhotosMemoryCache.set(albumUrl, fetchedItems);

          set((s) => {
            const updatedPosts = s.posts.map((post) =>
              post.albumUrl === albumUrl || post.originalUrl === albumUrl
                ? {
                    ...post,
                    photos: fetchedUrls,
                    photoItems: fetchedItems,
                    photoCount: res.metadata.photoCount ?? post.photoCount,
                  }
                : post
            );

            const updatedCreators = s.creators.map((c) => {
              const cAlbums = (c as any).albums;
              if (!cAlbums || !Array.isArray(cAlbums)) return c;
              const hasMatching = cAlbums.some(
                (alb: any) =>
                  alb.url === albumUrl ||
                  alb.source_url === albumUrl ||
                  alb.albumUrl === albumUrl
              );
              if (!hasMatching) return c;
              return {
                ...c,
                albums: cAlbums.map((alb: any) =>
                  alb.url === albumUrl ||
                  alb.source_url === albumUrl ||
                  alb.albumUrl === albumUrl
                    ? {
                        ...alb,
                        photos: fetchedUrls,
                        photoItems: fetchedItems,
                        photoCount: res.metadata.photoCount ?? alb.photoCount,
                      }
                    : alb
                ),
              };
            });

            if (!ownsLightbox() || !s.lightbox.isOpen || s.lightbox.albumUrl !== albumUrl) {
              return {
                posts: updatedPosts,
                creators: updatedCreators,
              };
            }

            return {
              posts: updatedPosts,
              creators: updatedCreators,
              lightbox: {
                ...s.lightbox,
                images: fetchedUrls,
                items: fetchedItems,
                currentIndex: Math.min(s.lightbox.currentIndex, Math.max(0, fetchedUrls.length - 1)),
                isLoadingAlbum: false,
              },
            };
          });
        })
        .catch(() => {
          if (!ownsLightbox()) return;
          set((s) => ({
            lightbox: { ...s.lightbox, isLoadingAlbum: false },
          }));
        })
        .finally(() => {
          if (lightboxAlbumController === controller) lightboxAlbumController = undefined;
        });
    }
  },

  updateLightboxItemResolution: (index, resolved) => {
    set((state) => {
      if (!state.lightbox.isOpen || index < 0 || index >= state.lightbox.images.length) {
        return state;
      }
      const nextImages = [...state.lightbox.images];
      nextImages[index] = resolved.url;

      const nextItems = state.lightbox.items ? [...state.lightbox.items] : [];
      if (nextItems[index]) {
        nextItems[index] = {
          ...nextItems[index],
          url: resolved.url,
          width: resolved.width || nextItems[index].width,
          height: resolved.height || nextItems[index].height,
          fileSizeBytes: resolved.fileSizeBytes || nextItems[index].fileSizeBytes,
          format: resolved.format || nextItems[index].format,
          isResolvedOriginal: true,
        };
      }

      return {
        lightbox: {
          ...state.lightbox,
          images: nextImages,
          items: nextItems,
        },
      };
    });
  },

  closeLightbox: () => {
    lightboxAlbumController?.abort();
    lightboxAlbumController = undefined;
    lightboxRequestVersion++;
    set((state) => ({
      lightbox: { ...state.lightbox, isOpen: false, isLoadingAlbum: false },
    }));
  },

  nextLightboxImage: () => {
    set((state) => {
      const { images, currentIndex } = state.lightbox;
      if (images.length === 0) return state;
      const nextIdx = (currentIndex + 1) % images.length;
      return { lightbox: { ...state.lightbox, currentIndex: nextIdx } };
    });
  },

  prevLightboxImage: () => {
    set((state) => {
      const { images, currentIndex } = state.lightbox;
      if (images.length === 0) return state;
      const prevIdx = (currentIndex - 1 + images.length) % images.length;
      return { lightbox: { ...state.lightbox, currentIndex: prevIdx } };
    });
  },

  updatePostStream: (postId, updated) => {
    // An unsuccessful renewal must not erase usable cached stream fields.
    const defined = Object.fromEntries(Object.entries(updated).filter(([, value]) => value !== undefined));
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === postId ? { ...p, ...defined } : p
      ),
    }));
  },

  toggleGlobalMute: () => set((state) => ({ isGlobalMuted: !state.isGlobalMuted })),
}));
