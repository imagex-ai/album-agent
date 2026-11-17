import { create } from 'zustand';
import { deferStorageWrite, flushStorageWrite } from '../services/deferredStorage';
import { createDurableShortcutSync } from '../services/durableShortcutSync';
import type { HubRoute } from './useProfileHubStore';

export interface ProfileShortcut {
  key: string;
  kind: 'profile' | 'directory';
  url: string;
  name: string | null;
  imageUrl: string | null;
  visitedAt: number;
}
const HISTORY_KEY = 'imagex_profile_history_v1';
const FAVORITES_KEY = 'imagex_profile_favorites_v1';
export const MAX_PROFILE_HISTORY = 200;
export const MAX_PROFILE_FAVORITES = 500;
function safeUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  if (value.startsWith('demo:')) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
export function profileShortcutIdentity(value: unknown) {
  const safe = safeUrl(value);
  if (!safe || safe.startsWith('demo:')) return safe;
  const url = new URL(safe);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}
export const shortcutKey = (kind: ProfileShortcut['kind'], url: string) => `${kind}|${(kind === 'profile' ? profileShortcutIdentity(url) : safeUrl(url)) ?? ''}`;
function read(key: string, limit: number): { items: ProfileShortcut[]; ok: boolean } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { items: [], ok: true };
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return { items: [], ok: false };
    const items: ProfileShortcut[] = [];
    for (const candidate of value.slice(0, limit)) {
      const url = safeUrl(candidate?.url);
      if (!url || !['profile', 'directory'].includes(candidate.kind) || !Number.isFinite(candidate.visitedAt)) continue;
      const item: ProfileShortcut = { key: shortcutKey(candidate.kind, url), kind: candidate.kind, url,
        name: typeof candidate.name === 'string' ? candidate.name.slice(0, 300) : null,
        imageUrl: safeUrl(candidate.imageUrl), visitedAt: candidate.visitedAt };
      if (!items.some(previous => previous.key === item.key)) items.push(item);
    }
    return { items, ok: true };
  } catch { return { items: [], ok: false }; }
}

interface LibraryState {
  history: ProfileShortcut[];
  favorites: ProfileShortcut[];
  contexts: Record<string, HubRoute>;
  storageAvailable: boolean;
  // Distinguish an authoritative server read from a browser-only fallback.
  favoritesHydrated: boolean;
  favoritesSyncStatus: 'idle' | 'pending' | 'ready' | 'unavailable';
  visit: (item: Omit<ProfileShortcut, 'key' | 'visitedAt'>, route?: HubRoute) => void;
  toggleFavorite: (item: Omit<ProfileShortcut, 'key' | 'visitedAt'>) => boolean;
  removeHistory: (key: string) => void;
  clearHistory: () => void;
  initSync: () => Promise<void>;
}
export const useProfileDirectoryLibraryStore = create<LibraryState>((set, get) => {
  const history = read(HISTORY_KEY, MAX_PROFILE_HISTORY);
  const favorites = read(FAVORITES_KEY, MAX_PROFILE_FAVORITES);
  const unavailableKeys = new Set([...(history.ok ? [] : [HISTORY_KEY]), ...(favorites.ok ? [] : [FAVORITES_KEY])]);
  let serverAvailable = true;
  const persist = (key: string, items: ProfileShortcut[]) => deferStorageWrite(key, () => JSON.stringify(items),
    success => {
      if (success) unavailableKeys.delete(key); else unavailableKeys.add(key);
      set({ storageAvailable: unavailableKeys.size === 0 && serverAvailable });
    });
  const durable = createDurableShortcutSync<ProfileShortcut>({
    journalKey: 'imagex_profile_favorites_sync_v1', endpoint: '/api/profile-hub/favorites',
    identity: item => shortcutKey('profile', item.url), items: () => get().favorites,
    availability: available => { serverAvailable = available; set({ storageAvailable: unavailableKeys.size === 0 && available, favoritesSyncStatus:available ? 'ready' : 'unavailable' }); },
    body: (item, removed) => ({ url: item.url, name: item.name, avatar_url: item.imageUrl, favorited: !removed }),
    decode: value => {
      const entries = (value as { favorites?: unknown })?.favorites;
      if (!Array.isArray(entries)) throw new Error('Invalid favorite response');
      return entries.flatMap(item => {
        const url = profileShortcutIdentity(item?.url);
        return url ? [{ key: shortcutKey('profile', url), kind: 'profile' as const, url,
          name: typeof item.name === 'string' ? item.name : null, imageUrl: safeUrl(item.avatar_url || item.avatarUrl),
          visitedAt: Number.isFinite(item.added_at) ? item.added_at * 1000 : Date.now() }] : [];
      });
    },
    apply: entries => { set({ favorites: entries, favoritesHydrated: true }); persist(FAVORITES_KEY, entries); flushStorageWrite(FAVORITES_KEY); },
  });
  return {
    history: history.items, favorites: favorites.items, contexts: {}, storageAvailable: history.ok && favorites.ok, favoritesHydrated: false, favoritesSyncStatus:'idle',
    visit: (input, route) => {
      const url = safeUrl(input.url);
      if (!url) return;
      const key = shortcutKey(input.kind, url);
      const item = { ...input, name: input.name?.slice(0, 300) ?? null, imageUrl: safeUrl(input.imageUrl), url, key, visitedAt: Date.now() };
      const next = [item, ...get().history.filter(previous => previous.key !== key)].slice(0, MAX_PROFILE_HISTORY);
      const contexts = { ...get().contexts, ...(route ? { [key]: route } : {}) };
      set({ history: next, contexts: Object.fromEntries(next.filter(entry => contexts[entry.key]).map(entry => [entry.key, contexts[entry.key]])) });
      persist(HISTORY_KEY, next);
    },
    toggleFavorite: input => {
      const url = profileShortcutIdentity(input.url);
      if (!url || input.kind !== 'profile') return false;
      const key = shortcutKey(input.kind, url);
      const previous = get().favorites;
      const exists = previous.some(item => shortcutKey('profile', item.url) === key);
      if (!exists && previous.length >= MAX_PROFILE_FAVORITES) return false;
      const next = exists ? previous.filter(item => shortcutKey('profile', item.url) !== key) : [{ ...input, name: input.name?.slice(0, 300) ?? null, imageUrl: safeUrl(input.imageUrl), url, key, visitedAt: Date.now() }, ...previous];
      set({ favorites: next, favoritesSyncStatus:'pending' }); persist(FAVORITES_KEY, next);
      flushStorageWrite(FAVORITES_KEY);
      durable.enqueue({ ...input, url, key, visitedAt: Date.now() }, exists);
      return true;
    },
    removeHistory: key => {
      const next = get().history.filter(item => item.key !== key);
      const contexts = { ...get().contexts }; delete contexts[key];
      set({ history: next, contexts }); persist(HISTORY_KEY, next);
    },
    clearHistory: () => { set({ history: [], contexts: {} }); persist(HISTORY_KEY, []); },
    initSync: () => { set({favoritesSyncStatus:'pending'}); return durable.synchronize(); },
  };
});
