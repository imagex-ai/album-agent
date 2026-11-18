import { backendApi } from '../services/realApi';
import { create } from 'zustand';
import type { Dispatch, SetStateAction } from 'react';
import type { MetadataResult, ProfileRoot } from '../services/profileHubApi';
import type { DirectoryViewState } from './useProfileDirectoryStore';
import type { ActiveSidePanel, AlbumItem, HighlightItem, MediaItemCard, PlaylistItem, ProfileCategoryTab, ProfileHeroData } from '../components/profile-hub/profileHubTypes';
import { changeReviewSelection, collectReviewEntries, coveringReviewCollection, type ReviewEntry } from '../services/profileHubReviewModel';

export interface ProfileHubSession {
  sourceUrl: string;
  root?: ProfileRoot;
  demoMode: boolean;
  profile: ProfileHeroData;
  highlights: HighlightItem[];
  playlists: PlaylistItem[];
  albums: AlbumItem[];
  videos: MediaItemCard[];
  gifs: MediaItemCard[];
  playlistVideosMap: Record<string, MediaItemCard[]>;
  albumPhotosMap: Record<string, MediaItemCard[]>;
  collectionLoadedAt: Record<string, number>;
  activeCategoryTab: ProfileCategoryTab;
  activeSidePanel: ActiveSidePanel;
  videoSearchTerm: string;
  videoQualityFilter: 'all' | '4K' | '1080p' | '720p';
  playlistSearchTerm: string;
  albumSearchTerm: string;
  selectedVideos: Record<string, MediaItemCard>;
  selectedAlbumPhotos: Record<string, MediaItemCard>;
  selectedAlbums: Record<string, AlbumItem>;
  selectedPlaylists: Record<string, PlaylistItem>;
  destinations: { videoFolder: string | null; galleryFolder: string | null; videoMode: 'web_stream' | 'download' | null };
}

export function createProfileHubSession(sourceUrl: string, profile: ProfileHeroData, root?: ProfileRoot): ProfileHubSession {
  const initialGifs = root?.canonical_gifs ?? [];
  const initialSearchGifs = (root as any)?.canonical_search_gifs ?? [];
  const gifAlbum = (root?.canonical_albums ?? []).find(a => a.id === 'alb-gifs' || (a.category === 'GIFs' && a.id !== 'alb-gifs-search'));
  const searchGifAlbum = (root?.canonical_albums ?? []).find(a => a.id === 'alb-gifs-search');

  const albumPhotosMap: Record<string, MediaItemCard[]> = {};
  const collectionLoadedAt: Record<string, number> = {};

  if (gifAlbum && initialGifs.length) {
    albumPhotosMap[gifAlbum.id] = initialGifs.map(g => ({ ...g, collectionId: gifAlbum.id, collectionTitle: gifAlbum.title }));
    collectionLoadedAt[`album:${gifAlbum.id}`] = Date.now();
  }
  if (searchGifAlbum && initialSearchGifs.length) {
    albumPhotosMap[searchGifAlbum.id] = initialSearchGifs.map((g: any) => ({ ...g, collectionId: searchGifAlbum.id, collectionTitle: searchGifAlbum.title }));
    collectionLoadedAt[`album:${searchGifAlbum.id}`] = Date.now();
  }
  return {
    sourceUrl, profile, root, demoMode: false,
    highlights: root?.canonical_highlights ?? [], playlists: root?.canonical_playlists ?? [],
    albums: root?.canonical_albums ?? [], videos: root?.canonical_videos ?? [], gifs: initialGifs,
    playlistVideosMap: root?.playlist_videos_map ?? {}, albumPhotosMap, collectionLoadedAt,
    activeCategoryTab: 'destaques', activeSidePanel: null,
    videoSearchTerm: '', videoQualityFilter: 'all', playlistSearchTerm: '', albumSearchTerm: '',
    selectedVideos: {}, selectedAlbumPhotos: {}, selectedAlbums: {}, selectedPlaylists: {},
    destinations: { videoFolder: profile?.destinationFolder || null, galleryFolder: profile?.destinationFolder || null, videoMode: null },
  };
}

export type HubRoute =
  | { mode: 'profile'; profileKey: string; panel: ActiveSidePanel }
  | { mode: 'directory'; queryKey: string; pageUrl: string; viewState?: DirectoryViewState }
  | { mode: 'review' };

export interface ProfileTabItem {
  key: string;
  name: string;
  avatarUrl?: string;
  sourceUrl: string;
}

interface ProfileHubStore {
  pendingProfileOpenUrl: string | null;
  requestProfileOpen: (url: string) => void;
  takeProfileOpen: () => string | null;
  activeProfileKey: string | null;
  profiles: Record<string, ProfileHubSession>;
  aliases: Record<string, string>;
  openProfileTabs: ProfileTabItem[];
  route: HubRoute | null;
  routeToken: string | null;
  navigationUnavailable: boolean;
  reviewEntries: Record<string, ReviewEntry>;
  reviewDisplayLimits: Record<string, number>;
  selectionClearVersion: number;
  openProfileTab: (tab: ProfileTabItem) => void;
  closeProfileTab: (key: string) => void;
  selectReviewEntry: (entryKey: string, selected: boolean) => void;
  removeReviewEntry: (entryKey: string) => void;
  restoreReviewEntry: (entry: ReviewEntry, selected: boolean) => void;
  selectReviewGroup: (profileKey: string) => void;
  showMoreReviewItems: (groupKey: string) => void;
  installProfile: (key: string, session: ProfileHubSession, aliases?: string[]) => void;
  applyProfileRoot: (key: string, root: ProfileRoot, profile: ProfileHeroData) => void;
  applyMetadataBatch: (key: string, items: MetadataResult[]) => void;
  activateProfile: (key: string) => boolean;
  updateField: <K extends keyof ProfileHubSession>(key: string, field: K, value: SetStateAction<ProfileHubSession[K]>) => void;
  setRoute: (route: HubRoute, token: string) => void;
  clearSelections: (profileKey?: string) => void;
  setNavigationUnavailable: (value: boolean) => void;
  favoriteVideos: MediaItemCard[];
  favoriteVideoIds: string[];
  fetchFavoriteVideos: (performer?: string) => Promise<void>;
  toggleProfileVideoFavorite: (video: MediaItemCard | any) => Promise<boolean>;
}

export const useProfileHubStore = create<ProfileHubStore>((set, get) => ({
  // Explicit in-memory entry intent. Never restored from a URL hash/storage.
  pendingProfileOpenUrl: null,
  requestProfileOpen: url => set({ pendingProfileOpenUrl: url }),
  takeProfileOpen: () => {
    const url = get().pendingProfileOpenUrl;
    if (url) set({ pendingProfileOpenUrl: null });
    return url;
  },
  activeProfileKey: null, profiles: {}, aliases: {}, openProfileTabs: [], route: null, routeToken: null, navigationUnavailable: false,
  reviewEntries: {}, reviewDisplayLimits: {}, selectionClearVersion: 0,
  favoriteVideos: [],
  favoriteVideoIds: [],
  fetchFavoriteVideos: async (performer?: string) => {
    try {
      const data = await backendApi.getProfileVideoFavorites(performer);
      set({
        favoriteVideos: data.favorites || [],
        favoriteVideoIds: data.favorite_ids || [],
      });
    } catch {}
  },
  toggleProfileVideoFavorite: async (video: MediaItemCard | any) => {
    try {
      const res = await backendApi.toggleProfileVideoFavorite(video);
      const isFav = !!res.favorited;
      const vId = video.id || (res.video && res.video.id);
      set(state => {
        let updatedIds = [...state.favoriteVideoIds];
        let updatedList = [...state.favoriteVideos];
        if (isFav) {
          if (vId && !updatedIds.includes(vId)) updatedIds.unshift(vId);
          if (res.video && !updatedList.some(v => v.id === res.video.id)) {
            updatedList.unshift(res.video);
          }
        } else {
          if (vId) updatedIds = updatedIds.filter(id => id !== vId);
          if (vId) updatedList = updatedList.filter(v => v.id !== vId);
        }
        return { favoriteVideoIds: updatedIds, favoriteVideos: updatedList };
      });
      return isFav;
    } catch {
      return false;
    }
  },
  openProfileTab: tab => set(state => {
    const existingIndex = state.openProfileTabs.findIndex(t => t.key === tab.key);
    if (existingIndex >= 0) {
      const updated = [...state.openProfileTabs];
      updated[existingIndex] = { ...updated[existingIndex], ...tab };
      return { openProfileTabs: updated };
    }
    return { openProfileTabs: [...state.openProfileTabs, tab] };
  }),
  closeProfileTab: key => set(state => ({
    openProfileTabs: state.openProfileTabs.filter(t => t.key !== key),
  })),
  selectReviewEntry: (entryKey, selected) => set(state => {
    const entry = state.reviewEntries[entryKey];
    const session = entry && state.profiles[entry.profileKey];
    if (!entry || !session || session.demoMode) return state;
    return { profiles: { ...state.profiles, [entry.profileKey]: changeReviewSelection(session, entry, selected) } };
  }),
  removeReviewEntry: entryKey => set(state => {
    const entry = state.reviewEntries[entryKey];
    const session = entry && state.profiles[entry.profileKey];
    if (!entry || !session || session.demoMode) return state;
    const reviewEntries = { ...state.reviewEntries }; delete reviewEntries[entryKey];
    return { reviewEntries, profiles: { ...state.profiles, [entry.profileKey]: changeReviewSelection(session, entry, false) } };
  }),
  restoreReviewEntry: (entry, selected) => set(state => {
    const session = state.profiles[entry.profileKey];
    if (!session || session.demoMode) return state;
    return { reviewEntries: { ...state.reviewEntries, [entry.key]: entry },
      profiles: { ...state.profiles, [entry.profileKey]: changeReviewSelection(session, entry, selected) } };
  }),
  selectReviewGroup: profileKey => set(state => {
    let session = state.profiles[profileKey];
    if (!session || session.demoMode) return state;
    for (const entry of Object.values(state.reviewEntries)) if (entry.profileKey === profileKey) session = changeReviewSelection(session, entry, true);
    return { profiles: { ...state.profiles, [profileKey]: session } };
  }),
  showMoreReviewItems: groupKey => set(state => ({ reviewDisplayLimits: { ...state.reviewDisplayLimits, [groupKey]: (state.reviewDisplayLimits[groupKey] ?? 12) + 12 } })),
  setNavigationUnavailable: navigationUnavailable => set({ navigationUnavailable }),
  installProfile: (key, session, aliases = []) => set(state => {
    const name = session.profile?.name;
    const tabItem: ProfileTabItem = {
      key,
      name: name || key,
      avatarUrl: session.profile?.avatarUrl,
      sourceUrl: session.sourceUrl || '',
    };
    const hasTab = state.openProfileTabs.some(t => t.key === key);
    const openProfileTabs = hasTab
      ? state.openProfileTabs.map(t => t.key === key ? { ...t, ...tabItem } : t)
      : [...state.openProfileTabs, tabItem];

    return {
      activeProfileKey: key,
      profiles: { ...state.profiles, [key]: state.profiles[key] ?? session },
      aliases: { ...state.aliases, ...Object.fromEntries([key, session.sourceUrl, ...aliases].filter(Boolean).map(alias => [alias, key])) },
      openProfileTabs,
    };
  }),
  applyProfileRoot: (key, root, profile) => set(state => {
    const session = state.profiles[key];
    if (!session || session.root === root) return state;
    const merge = <T extends { id: string }>(previous: T[], incoming: T[] = []) => {
      const byId = new Map(previous.map(item => [item.id, item]));
      return incoming.map(item => {
        const prev = byId.get(item.id);
        if (!prev) return item;
        const merged: any = { ...prev, ...item };
        const prevRecord = prev as Record<string, unknown>;
        const itemRecord = item as Record<string, unknown>;
        if (prevRecord.metadataStatus === 'fetched' && itemRecord.metadataStatus !== 'fetched') {
          merged.metadataStatus = prevRecord.metadataStatus;
          if (prevRecord.updatedAt && !itemRecord.updatedAt) merged.updatedAt = prevRecord.updatedAt;
          if (prevRecord.updatedAtRaw && !itemRecord.updatedAtRaw) merged.updatedAtRaw = prevRecord.updatedAtRaw;
          if (prevRecord.lastAddedDate && !itemRecord.lastAddedDate) merged.lastAddedDate = prevRecord.lastAddedDate;
          if (prevRecord.views && !itemRecord.views) merged.views = prevRecord.views;
          if (prevRecord.author && !itemRecord.author) merged.author = prevRecord.author;
          if (prevRecord.authorUrl && !itemRecord.authorUrl) merged.authorUrl = prevRecord.authorUrl;
        }
        return merged as T;
      });
    };
    const openProfileTabs = state.openProfileTabs.map(t =>
      t.key === key ? { ...t, name: profile.name || t.name, avatarUrl: profile.avatarUrl || t.avatarUrl } : t
    );
    const mergedAlbums = merge(session.albums, root.canonical_albums);
    const mergedGifs = merge(session.gifs, root.canonical_gifs);
    const initialSearchGifs = (root as any)?.canonical_search_gifs ?? [];
    const gifAlbum = mergedAlbums.find(a => a.id === 'alb-gifs' || (a.category === 'GIFs' && a.id !== 'alb-gifs-search'));
    const searchGifAlbum = mergedAlbums.find(a => a.id === 'alb-gifs-search');

    let nextAlbumPhotosMap = session.albumPhotosMap;
    let nextCollectionLoadedAt = session.collectionLoadedAt;

    if (gifAlbum && mergedGifs.length) {
      nextAlbumPhotosMap = { ...nextAlbumPhotosMap, [gifAlbum.id]: mergedGifs.map(g => ({ ...g, collectionId: gifAlbum.id, collectionTitle: gifAlbum.title })) };
      nextCollectionLoadedAt = { ...nextCollectionLoadedAt, [`album:${gifAlbum.id}`]: Date.now() };
    }
    if (searchGifAlbum && initialSearchGifs.length) {
      nextAlbumPhotosMap = { ...nextAlbumPhotosMap, [searchGifAlbum.id]: initialSearchGifs.map((g: any) => ({ ...g, collectionId: searchGifAlbum.id, collectionTitle: searchGifAlbum.title })) };
      nextCollectionLoadedAt = { ...nextCollectionLoadedAt, [`album:${searchGifAlbum.id}`]: Date.now() };
    }
    return {
      openProfileTabs,
      profiles: { ...state.profiles, [key]: { ...session, root,
      profile: { ...profile, destinationFolder: session.profile.destinationFolder, following: session.profile.following },
      highlights: root.canonical_highlights ?? [],
      videos: merge(session.videos, root.canonical_videos),
      playlists: merge(session.playlists, root.canonical_playlists),
      albums: mergedAlbums,
      gifs: mergedGifs,
      albumPhotosMap: nextAlbumPhotosMap,
      collectionLoadedAt: nextCollectionLoadedAt,
      // Loaded collections, selections, filters and destinations belong to the
      // session, not to a later discovery snapshot.
    } } };
  }),
  applyMetadataBatch: (key, items) => set(state => {
    const session = state.profiles[key];
    if (!session || !items.length) return state;
    const metadata = {
      video: new Map<string, Record<string, unknown>>(),
      album: new Map<string, Record<string, unknown>>(),
      playlist: new Map<string, Record<string, unknown>>(),
    };
    for (const { url, kind, ...values } of items) {
      const patch: Record<string, unknown> = { ...values };
      if (values.reportedCount != null && kind !== 'video') patch[kind === 'album' ? 'photoCount' : 'videoCount'] = values.reportedCount;
      metadata[kind].set(url, patch);
    }
    const update = <T extends object>(item: T, url: string | undefined, patches: Map<string, Record<string, unknown>>): T => {
      const patch = url ? patches.get(url) : undefined;
      if (!patch) return item;
      return Object.entries(patch).some(([field, value]) => !Object.is(Reflect.get(item, field), value)) ? { ...item, ...patch } : item;
    };
    const map = <T,>(values: T[], transform: (item: T) => T): T[] => {
      let changed: T[] | undefined;
      for (let index = 0; index < values.length; index++) {
        const next = transform(values[index]);
        if (next !== values[index]) { changed ??= values.slice(); changed[index] = next; }
      }
      return changed ?? values;
    };
    const record = <T,>(values: Record<string, T>, transform: (item: T) => T): Record<string, T> => {
      let changed: Record<string, T> | undefined;
      for (const [id, item] of Object.entries(values)) {
        const next = transform(item);
        if (next !== item) { changed ??= { ...values }; changed[id] = next; }
      }
      return changed ?? values;
    };
    const video = (item: MediaItemCard) => update(item, item.originalUrl, metadata.video);
    const album = (item: AlbumItem) => update(item, item.url, metadata.album);
    const playlist = (item: PlaylistItem) => update(item, item.url, metadata.playlist);
    const next = { ...session };
    if (metadata.video.size) {
      next.videos = map(session.videos, video);
      next.selectedVideos = record(session.selectedVideos, video);
      next.playlistVideosMap = record(session.playlistVideosMap, values => map(values, video));
    }
    if (metadata.album.size) {
      next.albums = map(session.albums, album);
      next.selectedAlbums = record(session.selectedAlbums, album);
    }
    if (metadata.playlist.size) {
      next.playlists = map(session.playlists, playlist);
      next.selectedPlaylists = record(session.selectedPlaylists, playlist);
    }
    const panel = session.activeSidePanel;
    if (panel?.type === 'playlist' && metadata.playlist.size) {
      const item = playlist(panel.item);
      if (item !== panel.item) next.activeSidePanel = { ...panel, item };
    } else if (panel?.type === 'album' && metadata.album.size) {
      const item = album(panel.item);
      if (item !== panel.item) next.activeSidePanel = { ...panel, item };
    }
    if (Object.keys(next).every(field => Reflect.get(next, field) === Reflect.get(session, field))) return state;
    // One notification per batch, with unchanged collections retaining identity.
    return { profiles: { ...state.profiles, [key]: next } };
  }),
  activateProfile: key => {
    const resolved = get().aliases[key] ?? key;
    if (!get().profiles[resolved]) return false;
    set({ activeProfileKey: resolved });
    return true;
  },
  updateField: (key, field, value) => set(state => {
    const session = state.profiles[key];
    if (!session) return state;
    const next = typeof value === 'function'
      ? (value as (previous: typeof session[typeof field]) => typeof session[typeof field])(session[field]) : value;
    if (Object.is(next, session[field])) return state;
    return { profiles: { ...state.profiles, [key]: { ...session, [field]: next } } };
  }),
  setRoute: (route, routeToken) => set(state => {
    if (state.routeToken === routeToken) return state;
    if (route.mode === 'review') return { route, routeToken, navigationUnavailable: false, reviewEntries: collectReviewEntries(state.profiles, state.reviewEntries) };
    if (route.mode === 'profile') {
      const session = state.profiles[route.profileKey];
      if (!session) return state;
      return { route, routeToken, navigationUnavailable: false, activeProfileKey: route.profileKey,
        profiles: { ...state.profiles, [route.profileKey]: { ...session, activeSidePanel: route.panel } } };
    }
    return { route, routeToken, navigationUnavailable: false };
  }),
  clearSelections: profileKey => set(state => ({
    selectionClearVersion: state.selectionClearVersion + 1,
    profiles: Object.fromEntries(Object.entries(state.profiles).map(([key, session]) => [key,
      !profileKey || key === profileKey ? { ...session, selectedVideos: {}, selectedAlbumPhotos: {}, selectedAlbums: {}, selectedPlaylists: {} } : session])),
  })),
}));

/** Setters capture the originating profile, so async completions cannot write into another profile. */
export function useProfileHubField<K extends keyof ProfileHubSession>(profileKey: string, field: K): [ProfileHubSession[K], Dispatch<SetStateAction<ProfileHubSession[K]>>] {
  const value = useProfileHubStore(state => state.profiles[profileKey][field]);
  return [value, profileHubFieldSetter(profileKey, field)];
}

export function profileHubFieldSetter<K extends keyof ProfileHubSession>(profileKey: string, field: K): Dispatch<SetStateAction<ProfileHubSession[K]>> {
  return next => useProfileHubStore.getState().updateField(profileKey, field, next);
}

export function getGlobalProfileSelection(profiles: Record<string, ProfileHubSession>, includeDemo = true) {
  const realSessions = Object.entries(profiles).filter(([, session]) => !session.demoMode);
  const sessions = realSessions.length || !includeDemo ? realSessions : Object.entries(profiles);
  const groups = sessions.map(([profileKey, session]) => {
    const videos = Object.values(session.selectedVideos).filter(video => coveringReviewCollection(session, 'video', video) === null);
    const albums = Object.values(session.selectedAlbums);
    const photos = Object.values(session.selectedAlbumPhotos).filter(photo => !photo.collectionId || !session.selectedAlbums[photo.collectionId]);
    const playlists = Object.values(session.selectedPlaylists);
    return { profileKey, sourceProfileUrl: session.sourceUrl, profile: session.profile, videos, albums, photos, playlists,
      destinations: session.destinations, count: videos.length + albums.length + photos.length + playlists.length };
  }).filter(group => group.count > 0);
  return { groups, count: groups.reduce((total, group) => total + group.count, 0),
    thumbnails: groups.flatMap(group => [...group.videos, ...group.albums, ...group.photos, ...group.playlists].map(item => item.thumbnailUrl)).slice(0, 3) };
}
