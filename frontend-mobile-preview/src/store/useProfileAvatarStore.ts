import { useEffect } from 'react';
import { create } from 'zustand';
import {
  AvatarResolutionItem,
  AvatarResolutionStatus,
  fetchResolvedAvatars,
  safeAvatarSourceUrl,
} from '../services/profileAvatarService';
import { profileShortcutIdentity } from './useProfileDirectoryLibraryStore';

export const AVATAR_FOUND_TTL_MS = 60 * 60 * 1000;
export const AVATAR_EMPTY_TTL_MS = 15 * 60 * 1000;
export const AVATAR_ERROR_TTL_MS = 60 * 1000;
export const AVATAR_BATCH_DEBOUNCE_MS = 40;
export const AVATAR_BATCH_CHUNK_SIZE = 20;
const MAX_CACHED_AVATAR_ENTRIES = 600;
const PERSIST_STORAGE_KEY = 'imagex_profile_avatar_cache_v1';

export interface AvatarStoreEntry {
  status: AvatarResolutionStatus | 'pending';
  avatarUrl: string | null;
  confirmedEmpty: boolean;
  provider?: string;
  updatedAt: number;
  expiresAt: number;
}

export interface ProfileAvatarStoreState {
  entries: Record<string, AvatarStoreEntry>;
  seedAvatar: (profileUrl: string | null | undefined, avatarUrl: string | null | undefined) => void;
  seedAvatars: (pairs: Array<{ url?: string | null; avatar?: string | null }>) => void;
  getAvatarEntry: (profileUrl: string | null | undefined) => AvatarStoreEntry | null;
  requestAvatar: (profileUrl: string | null | undefined, options?: { force?: boolean }) => Promise<AvatarStoreEntry | null>;
  requestAvatars: (profileUrls: Array<string | null | undefined>, options?: { force?: boolean }) => Promise<void>;
  clear: () => void;
}

export function avatarIdentityKey(url: string | null | undefined): string | null {
  const safe = safeAvatarSourceUrl(url);
  if (!safe) return null;
  try {
    const parsed = new URL(safe);
    const host = parsed.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `https://${host}${path}${parsed.search}`;
  } catch {
    return profileShortcutIdentity(safe) || safe;
  }
}

function loadPersistedAvatars(): Record<string, AvatarStoreEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PERSIST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const now = Date.now();
    const restored: Record<string, AvatarStoreEntry> = {};
    for (const [identity, val] of Object.entries(parsed)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const item = val as Record<string, unknown>;
      const expiresAt = typeof item.expiresAt === 'number' ? item.expiresAt : 0;
      if (expiresAt <= now) continue;
      const status = item.status === 'found' || item.status === 'not_found' ? item.status : null;
      if (!status) continue;
      const avatarUrl = status === 'found' ? safeAvatarSourceUrl(item.avatarUrl) : null;
      if (status === 'found' && !avatarUrl) continue;
      restored[identity] = {
        status,
        avatarUrl,
        confirmedEmpty: status === 'not_found' && Boolean(item.confirmedEmpty),
        provider: typeof item.provider === 'string' ? item.provider : undefined,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
        expiresAt,
      };
    }
    return restored;
  } catch {
    return {};
  }
}

function savePersistedAvatars(entries: Record<string, AvatarStoreEntry>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const now = Date.now();
    const valid = Object.entries(entries)
      .filter(([, entry]) => (entry.status === 'found' || entry.status === 'not_found') && entry.expiresAt > now)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_CACHED_AVATAR_ENTRIES);
    localStorage.setItem(PERSIST_STORAGE_KEY, JSON.stringify(Object.fromEntries(valid)));
  } catch {
    // Ignore quota/sandboxed storage errors gracefully.
  }
}

function pruneEntries(next: Record<string, AvatarStoreEntry>): Record<string, AvatarStoreEntry> {
  const keys = Object.keys(next);
  if (keys.length <= MAX_CACHED_AVATAR_ENTRIES) return next;
  const sorted = Object.entries(next).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(sorted.slice(0, MAX_CACHED_AVATAR_ENTRIES));
}

interface QueuedAvatarRequest {
  identity: string;
  url: string;
  force: boolean;
  waiters: Array<(entry: AvatarStoreEntry | null) => void>;
}

const pendingQueue = new Map<string, QueuedAvatarRequest>();
const inflightByIdentity = new Map<string, Promise<AvatarStoreEntry | null>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function entryFromResolution(item: AvatarResolutionItem | undefined, now: number): AvatarStoreEntry {
  if (item && item.status === 'found' && item.avatar_url) {
    return {
      status: 'found',
      avatarUrl: item.avatar_url,
      confirmedEmpty: false,
      provider: item.provider,
      updatedAt: now,
      expiresAt: now + AVATAR_FOUND_TTL_MS,
    };
  }
  if (item && item.status === 'not_found' && item.confirmed_empty) {
    return {
      status: 'not_found',
      avatarUrl: null,
      confirmedEmpty: true,
      provider: item.provider,
      updatedAt: now,
      expiresAt: now + AVATAR_EMPTY_TTL_MS,
    };
  }
  return {
    status: item?.status === 'invalid' ? 'invalid' : 'error',
    avatarUrl: null,
    confirmedEmpty: false,
    provider: item?.provider,
    updatedAt: now,
    expiresAt: now + AVATAR_ERROR_TTL_MS,
  };
}

async function processBatchChunk(chunk: QueuedAvatarRequest[], forceAny: boolean): Promise<void> {
  const requestUrls = chunk.map((q) => q.url);
  let resolvedMap: Record<string, AvatarResolutionItem> = {};
  try {
    resolvedMap = await fetchResolvedAvatars(requestUrls, { force: forceAny });
  } catch {
    resolvedMap = {};
  }

  const now = Date.now();
  const updates: Record<string, AvatarStoreEntry> = {};

  for (const item of chunk) {
    const serverEntry = resolvedMap[item.url];
    const nextEntry = entryFromResolution(serverEntry, now);
    // Preserve any fresher confirmed photo unless force was explicitly requested and succeeded
    const existing = useProfileAvatarStore.getState().entries[item.identity];
    if (
      !item.force &&
      existing?.status === 'found' &&
      existing.avatarUrl &&
      existing.expiresAt > now &&
      nextEntry.status !== 'found'
    ) {
      updates[item.identity] = existing;
    } else {
      updates[item.identity] = nextEntry;
    }
  }

  useProfileAvatarStore.setState((state) => {
    const merged = pruneEntries({ ...state.entries, ...updates });
    savePersistedAvatars(merged);
    return { entries: merged };
  });

  for (const item of chunk) {
    const finalEntry = useProfileAvatarStore.getState().entries[item.identity] ?? updates[item.identity] ?? null;
    for (const resolve of item.waiters) {
      resolve(finalEntry);
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (pendingQueue.size === 0) return;

    const batchItems = Array.from(pendingQueue.values());
    pendingQueue.clear();

    for (let i = 0; i < batchItems.length; i += AVATAR_BATCH_CHUNK_SIZE) {
      const chunk = batchItems.slice(i, i + AVATAR_BATCH_CHUNK_SIZE);
      const forceAny = chunk.some((c) => c.force);
      void processBatchChunk(chunk, forceAny);
    }
  }, AVATAR_BATCH_DEBOUNCE_MS);
}

export const useProfileAvatarStore = create<ProfileAvatarStoreState>((set, get) => ({
  entries: loadPersistedAvatars(),

  seedAvatar(profileUrl, avatarUrl) {
    const identity = avatarIdentityKey(profileUrl);
    const safeAvatar = safeAvatarSourceUrl(avatarUrl);
    if (!identity || !safeAvatar) return;

    const now = Date.now();
    const existing = get().entries[identity];
    if (existing?.status === 'found' && existing.avatarUrl === safeAvatar && existing.expiresAt > now + 60_000) {
      return;
    }

    set((state) => {
      const merged = pruneEntries({
        ...state.entries,
        [identity]: {
          status: 'found',
          avatarUrl: safeAvatar,
          confirmedEmpty: false,
          updatedAt: now,
          expiresAt: now + AVATAR_FOUND_TTL_MS,
        },
      });
      savePersistedAvatars(merged);
      return { entries: merged };
    });
  },

  seedAvatars(pairs) {
    const now = Date.now();
    const updates: Record<string, AvatarStoreEntry> = {};
    const current = get().entries;

    for (const pair of pairs) {
      const identity = avatarIdentityKey(pair.url);
      const safeAvatar = safeAvatarSourceUrl(pair.avatar);
      if (!identity || !safeAvatar) continue;
      const existing = current[identity];
      if (existing?.status === 'found' && existing.avatarUrl === safeAvatar && existing.expiresAt > now + 60_000) {
        continue;
      }
      updates[identity] = {
        status: 'found',
        avatarUrl: safeAvatar,
        confirmedEmpty: false,
        updatedAt: now,
        expiresAt: now + AVATAR_FOUND_TTL_MS,
      };
    }

    if (Object.keys(updates).length === 0) return;
    set((state) => {
      const merged = pruneEntries({ ...state.entries, ...updates });
      savePersistedAvatars(merged);
      return { entries: merged };
    });
  },

  getAvatarEntry(profileUrl) {
    const identity = avatarIdentityKey(profileUrl);
    if (!identity) return null;
    const entry = get().entries[identity];
    if (!entry) return null;
    if (entry.status !== 'pending' && Date.now() >= entry.expiresAt) return null;
    return entry;
  },

  requestAvatar(profileUrl, options) {
    const safeUrl = safeAvatarSourceUrl(profileUrl);
    const identity = safeUrl ? avatarIdentityKey(safeUrl) : null;
    if (!safeUrl || !identity) return Promise.resolve(null);

    const force = Boolean(options?.force);
    const now = Date.now();
    const existing = get().entries[identity];
    if (!force && existing && existing.status !== 'pending' && now < existing.expiresAt) {
      return Promise.resolve(existing);
    }

    const inflight = !force ? inflightByIdentity.get(identity) : undefined;
    if (inflight) return inflight;

    const promise = new Promise<AvatarStoreEntry | null>((resolve) => {
      const queued = pendingQueue.get(identity);
      if (queued) {
        if (force) queued.force = true;
        queued.waiters.push(resolve);
      } else {
        pendingQueue.set(identity, {
          identity,
          url: safeUrl,
          force,
          waiters: [resolve],
        });
      }
      scheduleFlush();
    }).finally(() => {
      if (inflightByIdentity.get(identity) === promise) {
        inflightByIdentity.delete(identity);
      }
    });

    inflightByIdentity.set(identity, promise);
    return promise;
  },

  async requestAvatars(profileUrls, options) {
    await Promise.all(profileUrls.map((u) => get().requestAvatar(u, options)));
  },

  clear() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingQueue.clear();
    inflightByIdentity.clear();
    set({ entries: {} });
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(PERSIST_STORAGE_KEY);
      } catch {
        // Ignore storage error
      }
    }
  },
}));

export function useResolvedAvatar(
  profileUrl: string | null | undefined,
  inlineAvatar: string | null | undefined,
  options?: { hydrate?: boolean }
): {
  src: string | null;
  status: AvatarResolutionStatus | 'pending' | 'idle';
  confirmedEmpty: boolean;
} {
  const safeInline = safeAvatarSourceUrl(inlineAvatar);
  const identity = avatarIdentityKey(profileUrl);
  const entry = useProfileAvatarStore((state) => (identity ? state.entries[identity] ?? null : null));
  const seedAvatar = useProfileAvatarStore((state) => state.seedAvatar);
  const requestAvatar = useProfileAvatarStore((state) => state.requestAvatar);
  const shouldHydrate = Boolean(options?.hydrate);

  useEffect(() => {
    if (profileUrl && safeInline) {
      seedAvatar(profileUrl, safeInline);
    }
  }, [profileUrl, safeInline, seedAvatar]);

  useEffect(() => {
    if (!shouldHydrate || safeInline || !profileUrl) return;
    const now = Date.now();
    if (entry && entry.status !== 'pending' && now < entry.expiresAt) return;
    void requestAvatar(profileUrl);
  }, [shouldHydrate, safeInline, profileUrl, entry, requestAvatar]);

  if (safeInline) {
    return { src: safeInline, status: 'found', confirmedEmpty: false };
  }
  const now = Date.now();
  if (entry && entry.status === 'found' && entry.avatarUrl && now < entry.expiresAt) {
    return { src: entry.avatarUrl, status: 'found', confirmedEmpty: false };
  }
  if (entry && entry.status === 'not_found' && now < entry.expiresAt) {
    return { src: null, status: 'not_found', confirmedEmpty: true };
  }
  return { src: null, status: entry?.status ?? 'idle', confirmedEmpty: false };
}
