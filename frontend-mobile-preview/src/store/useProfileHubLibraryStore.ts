import { create } from 'zustand';
import {
  LibraryMediaItem,
  LibraryPlaylist,
  RawLibraryMediaInput,
  canonicalLibraryMediaKey,
  createPlaylistLocally,
  deletePlaylistLocally,
  filterLibraryFavoritesByKind,
  recordWatchedInList,
  renamePlaylistLocally,
  setMediaItemInList,
  setPlaylistItemLocally,
} from '../services/profileHubLibraryModel';

const STORAGE_KEY = 'imagex_profile_hub_library_v1';

interface PersistedLibrarySnapshot {
  history: LibraryMediaItem[];
  liked: LibraryMediaItem[];
  favorites: LibraryMediaItem[];
  playlists: LibraryPlaylist[];
}

function readLocalSnapshot(): PersistedLibrarySnapshot {
  if (typeof window === 'undefined') {
    return { history: [], liked: [], favorites: [], playlists: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { history: [], liked: [], favorites: [], playlists: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedLibrarySnapshot>;
    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      liked: Array.isArray(parsed.liked) ? parsed.liked : [],
      favorites: Array.isArray(parsed.favorites)
        ? filterLibraryFavoritesByKind(parsed.favorites, 'all')
        : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
    };
  } catch {
    return { history: [], liked: [], favorites: [], playlists: [] };
  }
}

function writeLocalSnapshot(snapshot: PersistedLibrarySnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota failures must not break live library interactions.
  }
}

function persistStateSnapshot(state: PersistedLibrarySnapshot): void {
  writeLocalSnapshot({
    history: state.history,
    liked: state.liked,
    favorites: state.favorites,
    playlists: state.playlists,
  });
}

let inFlightHydration: Promise<void> | null = null;

export interface ProfileHubLibraryState extends PersistedLibrarySnapshot {
  hydrated: boolean;
  serverAvailable: boolean;
  isLoading: boolean;
  playlistModalItem: LibraryMediaItem | null;

  hydrateLibrary: (force?: boolean) => Promise<void>;
  openPlaylistModal: (item: LibraryMediaItem | null) => void;
  closePlaylistModal: () => void;

  recordHistory: (rawItem: RawLibraryMediaInput, options?: { enrichOnly?: boolean }) => Promise<void>;
  removeHistoryItem: (itemKey: string) => Promise<void>;
  clearHistory: () => Promise<void>;

  setLikedItem: (rawItem: RawLibraryMediaInput, liked: boolean) => Promise<void>;
  setFavoriteItem: (rawItem: RawLibraryMediaInput, favorited: boolean) => Promise<void>;

  createPlaylist: (name: string, description?: string, initialItem?: LibraryMediaItem | null) => Promise<LibraryPlaylist | null>;
  renamePlaylist: (playlistId: string, name: string, description?: string) => Promise<boolean>;
  deletePlaylist: (playlistId: string) => Promise<boolean>;
  setPlaylistItem: (
    playlistId: string,
    rawItem: RawLibraryMediaInput,
    present: boolean
  ) => Promise<boolean>;
}

const initial = readLocalSnapshot();

export const useProfileHubLibraryStore = create<ProfileHubLibraryState>((set, get) => ({
  history: initial.history,
  liked: initial.liked,
  favorites: initial.favorites,
  playlists: initial.playlists,
  hydrated: false,
  serverAvailable: false,
  isLoading: false,
  playlistModalItem: null,

  openPlaylistModal: (item) => set({ playlistModalItem: item }),
  closePlaylistModal: () => set({ playlistModalItem: null }),

  hydrateLibrary: async (force = false) => {
    if (get().hydrated && !force) return;
    if (inFlightHydration && !force) return inFlightHydration;
    if (typeof fetch === 'undefined') return;

    const task = (async () => {
      set({ isLoading: true });
      try {
        const res = await fetch('/api/profile-hub/library/state');
        if (!res.ok) {
          set({ serverAvailable: false });
          return;
        }
        const data = (await res.json()) as Partial<PersistedLibrarySnapshot>;
        const next: PersistedLibrarySnapshot = {
          history: Array.isArray(data.history) ? data.history : [],
          liked: Array.isArray(data.liked) ? data.liked : [],
          favorites: Array.isArray(data.favorites)
            ? filterLibraryFavoritesByKind(data.favorites, 'all')
            : [],
          playlists: Array.isArray(data.playlists) ? data.playlists : [],
        };
        persistStateSnapshot(next);
        set({
          ...next,
          hydrated: true,
          serverAvailable: true,
        });
      } catch {
        set({ serverAvailable: false });
      } finally {
        set({ isLoading: false });
      }
    })().finally(() => {
      if (inFlightHydration === task) inFlightHydration = null;
    });

    inFlightHydration = task;
    return task;
  },

  recordHistory: async (rawItem, options) => {
    const key = canonicalLibraryMediaKey(rawItem as Record<string, unknown>);
    if (!key) return;
    const enrichOnly = Boolean(options?.enrichOnly);
    const optimisticHistory = recordWatchedInList(get().history, rawItem, Date.now(), enrichOnly);
    set({ history: optimisticHistory });
    persistStateSnapshot({ ...get(), history: optimisticHistory });

    if (typeof fetch === 'undefined') return;
    try {
      const res = await fetch('/api/profile-hub/library/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: rawItem, enrichOnly }),
      });
      if (res.ok) {
        const data = (await res.json()) as { history?: LibraryMediaItem[] };
        if (Array.isArray(data.history)) {
          set({ history: data.history, serverAvailable: true });
          persistStateSnapshot({ ...get(), history: data.history });
        }
      }
    } catch {
      // Keep local history cache when backend is temporarily unreachable.
    }
  },

  removeHistoryItem: async (itemKey) => {
    const nextHistory = get().history.filter((entry) => entry.key !== itemKey && entry.id !== itemKey);
    set({ history: nextHistory });
    persistStateSnapshot({ ...get(), history: nextHistory });

    if (typeof fetch === 'undefined') return;
    try {
      const res = await fetch(`/api/profile-hub/library/history/${encodeURIComponent(itemKey)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = (await res.json()) as { history?: LibraryMediaItem[] };
        if (Array.isArray(data.history)) {
          set({ history: data.history, serverAvailable: true });
          persistStateSnapshot({ ...get(), history: data.history });
        }
      }
    } catch {
      // Ignore transient network errors; local update already applied.
    }
  },

  clearHistory: async () => {
    set({ history: [] });
    persistStateSnapshot({ ...get(), history: [] });

    if (typeof fetch === 'undefined') return;
    try {
      const res = await fetch('/api/profile-hub/library/history', { method: 'DELETE' });
      if (res.ok) {
        set({ history: [], serverAvailable: true });
        persistStateSnapshot({ ...get(), history: [] });
      }
    } catch {
      // Ignore transient network errors.
    }
  },

  setLikedItem: async (rawItem, liked) => {
    const key = canonicalLibraryMediaKey(rawItem as Record<string, unknown>);
    if (!key) return;
    const nextLiked = setMediaItemInList(get().liked, rawItem, liked, Date.now(), {
      likedAt: Date.now(),
    });
    set({ liked: nextLiked });
    persistStateSnapshot({ ...get(), liked: nextLiked });

    if (typeof fetch === 'undefined') return;
    try {
      const res = await fetch('/api/profile-hub/library/liked', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: rawItem, liked }),
      });
      if (res.ok) {
        const data = (await res.json()) as { items?: LibraryMediaItem[] };
        if (Array.isArray(data.items)) {
          set({ liked: data.items, serverAvailable: true });
          persistStateSnapshot({ ...get(), liked: data.items });
        }
      }
    } catch {
      // Ignore transient network failures.
    }
  },

  setFavoriteItem: async (rawItem, favorited) => {
    const key = canonicalLibraryMediaKey(rawItem as Record<string, unknown>);
    if (!key) return;
    const sanitized = setMediaItemInList(get().favorites, rawItem, favorited, Date.now());
    const nextFavorites = filterLibraryFavoritesByKind(sanitized, 'all');
    set({ favorites: nextFavorites });
    persistStateSnapshot({ ...get(), favorites: nextFavorites });

    if (typeof fetch === 'undefined') return;
    try {
      const res = await fetch('/api/profile-hub/library/favorites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: rawItem, favorited }),
      });
      if (res.ok) {
        const data = (await res.json()) as { items?: LibraryMediaItem[] };
        if (Array.isArray(data.items)) {
          const safeItems = filterLibraryFavoritesByKind(data.items, 'all');
          set({ favorites: safeItems, serverAvailable: true });
          persistStateSnapshot({ ...get(), favorites: safeItems });
        }
      }
    } catch {
      // Ignore transient network failures.
    }
  },

  createPlaylist: async (name, description = '', initialItem = null) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const tempId = `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const localResult = createPlaylistLocally(get().playlists, {
      id: tempId,
      name: trimmed,
      description,
    });
    let nextPlaylists = localResult.playlists;
    let created = localResult.playlist;
    if (initialItem) {
      nextPlaylists = setPlaylistItemLocally(nextPlaylists, created.id, initialItem, true, Date.now());
      created = nextPlaylists.find((pl) => pl.id === created.id) || created;
    }
    set({ playlists: nextPlaylists });
    persistStateSnapshot({ ...get(), playlists: nextPlaylists });

    if (typeof fetch === 'undefined') return created;
    try {
      const res = await fetch('/api/profile-hub/library/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tempId, name: trimmed, description }),
      });
      if (!res.ok) return created;
      const data = (await res.json()) as { playlist?: LibraryPlaylist; playlists?: LibraryPlaylist[] };
      const serverPlaylist = data.playlist || created;
      if (Array.isArray(data.playlists)) {
        set({ playlists: data.playlists, serverAvailable: true });
        persistStateSnapshot({ ...get(), playlists: data.playlists });
      }
      if (initialItem && serverPlaylist.id) {
        await get().setPlaylistItem(serverPlaylist.id, initialItem, true);
        return get().playlists.find((pl) => pl.id === serverPlaylist.id) || serverPlaylist;
      }
      return serverPlaylist;
    } catch {
      return created;
    }
  },

  renamePlaylist: async (playlistId, name, description) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const nextPlaylists = renamePlaylistLocally(get().playlists, playlistId, trimmed, description, Date.now());
    set({ playlists: nextPlaylists });
    persistStateSnapshot({ ...get(), playlists: nextPlaylists });

    if (typeof fetch === 'undefined') return true;
    try {
      const res = await fetch(`/api/profile-hub/library/playlists/${encodeURIComponent(playlistId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description }),
      });
      if (res.ok) {
        const data = (await res.json()) as { playlists?: LibraryPlaylist[] };
        if (Array.isArray(data.playlists)) {
          set({ playlists: data.playlists, serverAvailable: true });
          persistStateSnapshot({ ...get(), playlists: data.playlists });
        }
      }
      return true;
    } catch {
      return true;
    }
  },

  deletePlaylist: async (playlistId) => {
    const nextPlaylists = deletePlaylistLocally(get().playlists, playlistId);
    set({ playlists: nextPlaylists });
    persistStateSnapshot({ ...get(), playlists: nextPlaylists });

    if (typeof fetch === 'undefined') return true;
    try {
      const res = await fetch(`/api/profile-hub/library/playlists/${encodeURIComponent(playlistId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = (await res.json()) as { playlists?: LibraryPlaylist[] };
        if (Array.isArray(data.playlists)) {
          set({ playlists: data.playlists, serverAvailable: true });
          persistStateSnapshot({ ...get(), playlists: data.playlists });
        }
      }
      return true;
    } catch {
      return true;
    }
  },

  setPlaylistItem: async (playlistId, rawItem, present) => {
    const nextPlaylists = setPlaylistItemLocally(get().playlists, playlistId, rawItem, present, Date.now());
    set({ playlists: nextPlaylists });
    persistStateSnapshot({ ...get(), playlists: nextPlaylists });

    if (typeof fetch === 'undefined') return true;
    try {
      const res = await fetch(
        `/api/profile-hub/library/playlists/${encodeURIComponent(playlistId)}/items`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: rawItem, present }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { playlists?: LibraryPlaylist[] };
        if (Array.isArray(data.playlists)) {
          set({ playlists: data.playlists, serverAvailable: true });
          persistStateSnapshot({ ...get(), playlists: data.playlists });
        }
      }
      return true;
    } catch {
      return true;
    }
  },
}));
