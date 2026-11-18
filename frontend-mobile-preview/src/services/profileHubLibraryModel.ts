import type {
  TimelineCreator,
  TimelinePlaylist,
  TimelinePost,
  TimelineVideoQuality,
} from '../components/profile-hub/timeline/timelineModel';

export type LibraryMediaKind = 'video' | 'album' | 'playlist' | 'gif';
export type FavoritesMediaFilter = 'all' | LibraryMediaKind;

export const ALLOWED_FAVORITE_MEDIA_KINDS: readonly LibraryMediaKind[] = [
  'video',
  'album',
  'playlist',
  'gif',
];

export interface LibraryMediaItem {
  key: string;
  id: string;
  kind: LibraryMediaKind;
  title: string;
  sourceUrl?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  masterHlsUrl?: string;
  previewVideoUrl?: string;
  youtubeId?: string;
  qualities?: TimelineVideoQuality[];
  duration?: string;
  resolution?: string;
  creatorId?: string;
  creatorName?: string;
  creatorHandle?: string;
  creatorAvatar?: string;
  creatorUrl?: string;
  platform?: string;
  category?: string;
  publishedAt?: number | null;
  publishedDateText?: string;
  tags?: string[];
  photos?: string[];
  imageCount?: number;
  playlistCount?: number;
  addedAt: number;
  watchedAt?: number;
  watchCount?: number;
  likedAt?: number;
  legacySource?: boolean;
}

export type RawLibraryMediaInput = Partial<LibraryMediaItem> | (Partial<LibraryMediaItem> & Record<string, unknown>);

export interface LibraryPlaylist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  createdAt: number;
  updatedAt: number;
  items: LibraryMediaItem[];
}

export const MAX_WATCH_HISTORY_ITEMS = 500;

function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const padLen = (64 - ((withOne + 8) % 64)) % 64;
  const totalLen = withOne + padLen + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);

  const rol = (n: number, bits: number) => (n << bits) | (n >>> (32 - bits));

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getInt32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f = 0;
      let k = 0;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rol(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function cleanMediaString(value: unknown, limit = 4096): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function normalizeLibraryMediaUrl(value: unknown): string {
  const raw = cleanMediaString(value, 4096);
  if (!raw) return '';
  if (raw.startsWith('demo:')) return raw;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return '';
    }
    const sortedParams = Array.from(parsed.searchParams.entries())
      .filter(([, val]) => val !== '')
      .sort(([aKey, aVal], [bKey, bVal]) =>
        aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey)
      );
    const search = sortedParams.length > 0 ? `?${new URLSearchParams(sortedParams).toString()}` : '';
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${search}`;
  } catch {
    return '';
  }
}

export function canonicalLibraryMediaKey(item: {
  key?: unknown;
  id?: unknown;
  sourceUrl?: unknown;
  originalUrl?: unknown;
  url?: unknown;
  pageUrl?: unknown;
}): string {
  if (!item || typeof item !== 'object') return '';
  const rawUrl = cleanMediaString(
    item.sourceUrl || item.originalUrl || item.url || item.pageUrl,
    4096
  );
  if (rawUrl) {
    const vkeyMatch = rawUrl.match(/viewkey=([a-zA-Z0-9_-]+)/);
    if (vkeyMatch?.[1]) return `ph-${vkeyMatch[1]}`;
    const norm = normalizeLibraryMediaUrl(rawUrl);
    if (norm) return `url-${sha1Hex(norm).slice(0, 20)}`;
  }
  const rawId = cleanMediaString(item.id || item.key, 128);
  if (rawId) {
    const safe = rawId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (safe) return `id-${safe.slice(0, 80)}`;
  }
  return '';
}

export function coerceFavoriteMediaKind(rawKind: unknown): LibraryMediaKind | null {
  const kind = cleanMediaString(rawKind, 32).toLowerCase();
  if (kind === 'photo_grid' || kind === 'photos') return 'album';
  if ((ALLOWED_FAVORITE_MEDIA_KINDS as readonly string[]).includes(kind)) {
    return kind as LibraryMediaKind;
  }
  return null;
}

export function coerceLibraryMediaKind(rawKind: unknown): LibraryMediaKind {
  return coerceFavoriteMediaKind(rawKind) ?? 'video';
}

export function filterLibraryFavoritesByKind(
  items: Array<Partial<LibraryMediaItem> & { kind?: unknown }>,
  filterKind: FavoritesMediaFilter = 'all'
): LibraryMediaItem[] {
  return items.filter((item): item is LibraryMediaItem => {
    const kind = coerceFavoriteMediaKind(item?.kind);
    if (!kind) return false;
    return filterKind === 'all' ? true : kind === filterKind;
  });
}

export function mergeLibraryMediaItem(
  rawInput: RawLibraryMediaInput,
  existing?: LibraryMediaItem | null,
  fallbackNow = Date.now()
): LibraryMediaItem | null {
  const incoming = rawInput as Partial<LibraryMediaItem> & Record<string, unknown>;
  const key = canonicalLibraryMediaKey(incoming);
  if (!key) return null;
  const pick = (...fields: unknown[]): string => {
    for (const candidate of fields) {
      const cleaned = cleanMediaString(candidate, 4096);
      if (cleaned) return cleaned;
    }
    return '';
  };
  const kind = coerceLibraryMediaKind(incoming.kind ?? incoming.type ?? existing?.kind);
  const rawTags = Array.isArray(incoming.tags) ? incoming.tags : existing?.tags || [];
  const tags = Array.from(
    new Set(rawTags.map((t) => cleanMediaString(t, 64)).filter(Boolean))
  ).slice(0, 30);
  const rawPhotos = Array.isArray(incoming.photos) ? incoming.photos : existing?.photos || [];
  const photos = rawPhotos
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .slice(0, 200);
  const rawQualities = Array.isArray(incoming.qualities)
    ? incoming.qualities
    : existing?.qualities || [];

  const pickCreatorName = (...fields: unknown[]): string => {
    for (const candidate of fields) {
      const cleaned = cleanMediaString(candidate, 256);
      if (cleaned && !/^(unknown creator|criador desconhecido|unknown)$/i.test(cleaned)) {
        return cleaned;
      }
    }
    return '';
  };

  return {
    key,
    id: pick(incoming.id, existing?.id, key),
    kind,
    title: pick(incoming.title, existing?.title),
    sourceUrl: pick(incoming.sourceUrl, incoming.originalUrl, incoming.albumUrl, incoming.url, existing?.sourceUrl) || undefined,
    thumbnailUrl: pick(incoming.thumbnailUrl, incoming.thumbnail, incoming.coverUrl, existing?.thumbnailUrl) || undefined,
    videoUrl: pick(incoming.videoUrl, incoming.streamUrl, existing?.videoUrl) || undefined,
    masterHlsUrl: pick(incoming.masterHlsUrl, existing?.masterHlsUrl) || undefined,
    previewVideoUrl: pick(incoming.previewVideoUrl, existing?.previewVideoUrl) || undefined,
    youtubeId: pick(incoming.youtubeId, existing?.youtubeId) || undefined,
    qualities: rawQualities.length > 0 ? (rawQualities as TimelineVideoQuality[]) : undefined,
    duration: pick(incoming.duration, existing?.duration) || undefined,
    resolution: pick(incoming.resolution, existing?.resolution) || undefined,
    creatorId: pick(incoming.creatorId, existing?.creatorId) || undefined,
    creatorName: pickCreatorName(incoming.creatorName, incoming.artistName, incoming.performer, existing?.creatorName) || undefined,
    creatorHandle: pick(incoming.creatorHandle, existing?.creatorHandle) || undefined,
    creatorAvatar: pick(incoming.creatorAvatar, incoming.avatarUrl, existing?.creatorAvatar) || undefined,
    creatorUrl: pick(incoming.creatorUrl, incoming.authorUrl, incoming.profileUrl, existing?.creatorUrl) || undefined,
    platform: pick(incoming.platform, existing?.platform) || undefined,
    category: pick(incoming.category, existing?.category) || undefined,
    publishedAt: typeof incoming.publishedAt === 'number' ? incoming.publishedAt : existing?.publishedAt ?? null,
    publishedDateText: pick(incoming.publishedDateText, existing?.publishedDateText) || undefined,
    tags: tags.length > 0 ? tags : undefined,
    photos: photos.length > 0 ? photos : undefined,
    imageCount: typeof incoming.imageCount === 'number' ? incoming.imageCount : existing?.imageCount,
    playlistCount: typeof incoming.playlistCount === 'number' ? incoming.playlistCount : existing?.playlistCount,
    addedAt: typeof existing?.addedAt === 'number'
      ? existing.addedAt
      : typeof incoming.addedAt === 'number'
        ? incoming.addedAt
        : fallbackNow,
    watchedAt: typeof incoming.watchedAt === 'number' ? incoming.watchedAt : existing?.watchedAt,
    watchCount: typeof incoming.watchCount === 'number' ? incoming.watchCount : existing?.watchCount,
    likedAt: typeof incoming.likedAt === 'number' ? incoming.likedAt : existing?.likedAt,
    legacySource: Boolean(incoming.legacySource ?? existing?.legacySource),
  };
}

export function normalizeTimelinePostToLibraryItem(
  post: TimelinePost,
  creator?: Partial<TimelineCreator> | null,
  fallbackNow = Date.now()
): LibraryMediaItem | null {
  const kind = coerceLibraryMediaKind(post.type);
  const parsedPublished =
    post.publicationDateRaw && !Number.isNaN(Date.parse(post.publicationDateRaw))
      ? Date.parse(post.publicationDateRaw)
      : null;
  return mergeLibraryMediaItem(
    {
      id: post.id,
      kind,
      title: post.title || post.caption || '',
      sourceUrl: post.originalUrl || post.albumUrl || post.playlistUrl || post.sourcePage || post.videoUrl,
      thumbnailUrl: post.thumbnail || post.photos?.[0],
      videoUrl: post.videoUrl,
      masterHlsUrl: post.masterHlsUrl,
      previewVideoUrl: post.previewVideoUrl,
      youtubeId: post.youtubeId,
      qualities: post.qualities,
      duration: post.duration,
      resolution: post.resolution,
      creatorId: post.creatorId || creator?.id,
      creatorName: creator?.name || post.creatorName,
      creatorHandle: creator?.handle || post.creatorHandle,
      creatorAvatar: creator?.avatar || post.creatorAvatar,
      creatorUrl: creator?.profileUrl,
      platform: creator?.site || post.source,
      publishedAt: parsedPublished,
      publishedDateText: post.date || post.publicationDateRaw,
      photos: post.photos,
      imageCount: post.photoCount,
      playlistCount: post.videoCount,
      addedAt: fallbackNow,
    },
    null,
    fallbackNow
  );
}

export function normalizeCreatorPlaylistToLibraryItem(
  playlist: TimelinePlaylist,
  creator?: Partial<TimelineCreator> | null,
  fallbackNow = Date.now()
): LibraryMediaItem | null {
  return mergeLibraryMediaItem(
    {
      id: playlist.id,
      kind: 'playlist',
      title: playlist.title,
      sourceUrl: playlist.url,
      thumbnailUrl: playlist.thumbnailUrl,
      creatorId: creator?.id,
      creatorName: creator?.name,
      creatorHandle: creator?.handle,
      creatorAvatar: creator?.avatar,
      creatorUrl: creator?.profileUrl,
      platform: creator?.site,
      playlistCount: playlist.videoCount,
      addedAt: fallbackNow,
    },
    null,
    fallbackNow
  );
}

export function libraryItemToTimelinePost(item: LibraryMediaItem): TimelinePost {
  const timelineType: TimelinePost['type'] =
    item.kind === 'album'
      ? 'photo_grid'
      : item.kind === 'gif'
        ? 'gif'
        : item.kind === 'playlist'
          ? 'playlist'
          : 'video';
  const creatorHandle = item.creatorHandle || (item.creatorName ? `@${item.creatorName.replace(/^@+/, '')}` : '');
  const isoDate =
    typeof item.publishedAt === 'number' && Number.isFinite(item.publishedAt)
      ? new Date(item.publishedAt).toISOString().slice(0, 10)
      : undefined;
  return {
    id: item.id,
    creatorId: item.creatorId || item.creatorUrl || item.creatorName || 'library',
    creatorName: item.creatorName || item.creatorHandle || '',
    creatorHandle,
    creatorAvatar: item.creatorAvatar || '',
    source: item.platform || undefined,
    type: timelineType,
    title: item.title,
    thumbnail: item.thumbnailUrl,
    videoUrl: item.videoUrl,
    masterHlsUrl: item.masterHlsUrl,
    previewVideoUrl: item.previewVideoUrl,
    youtubeId: item.youtubeId,
    qualities: item.qualities,
    originalUrl: item.sourceUrl,
    albumUrl: item.kind === 'album' ? item.sourceUrl : undefined,
    playlistUrl: item.kind === 'playlist' ? item.sourceUrl : undefined,
    duration: item.duration,
    resolution: item.resolution,
    photos: item.photos,
    photoCount: item.imageCount,
    videoCount: item.playlistCount,
    comments: [],
    likes: null,
    date: item.publishedDateText || '',
    publicationDateRaw: isoDate,
    publicationDatePrecision: isoDate ? 'day' : undefined,
  };
}

export function recordWatchedInList(
  history: LibraryMediaItem[],
  rawItem: RawLibraryMediaInput,
  nowMs = Date.now(),
  enrichOnly = false
): LibraryMediaItem[] {
  const key = canonicalLibraryMediaKey(rawItem as Record<string, unknown>);
  if (!key) return history;
  const existing = history.find((entry) => entry.key === key) || null;
  if (enrichOnly && !existing) return history;
  const normalized = mergeLibraryMediaItem(rawItem, existing, nowMs);
  if (!normalized) return history;
  if (enrichOnly && existing) {
    normalized.watchedAt = existing.watchedAt ?? nowMs;
    normalized.watchCount = Math.max(1, existing.watchCount ?? 1);
    return history.map((entry) => (entry.key === key ? normalized : entry));
  }
  normalized.watchedAt = nowMs;
  normalized.watchCount = (existing?.watchCount ?? 0) + 1;
  return [normalized, ...history.filter((entry) => entry.key !== key)].slice(0, MAX_WATCH_HISTORY_ITEMS);
}

export function setMediaItemInList(
  list: LibraryMediaItem[],
  rawItem: RawLibraryMediaInput,
  present: boolean,
  nowMs = Date.now(),
  extra?: Partial<LibraryMediaItem>
): LibraryMediaItem[] {
  const key = canonicalLibraryMediaKey(rawItem as Record<string, unknown>);
  if (!key) return list;
  const remaining = list.filter((entry) => entry.key !== key);
  if (!present) return remaining;
  const existing = list.find((entry) => entry.key === key) || null;
  const merged = mergeLibraryMediaItem({ ...(rawItem as Record<string, unknown>), ...extra }, existing, nowMs);
  return merged ? [merged, ...remaining] : remaining;
}

export function createPlaylistLocally(
  playlists: LibraryPlaylist[],
  input: { id: string; name: string; description?: string },
  nowMs = Date.now()
): { playlist: LibraryPlaylist; playlists: LibraryPlaylist[] } {
  const name = cleanMediaString(input.name, 120);
  const playlist: LibraryPlaylist = {
    id: cleanMediaString(input.id, 64) || `pl-${nowMs}`,
    name,
    description: cleanMediaString(input.description || '', 400),
    coverUrl: '',
    createdAt: nowMs,
    updatedAt: nowMs,
    items: [],
  };
  return {
    playlist,
    playlists: [playlist, ...playlists.filter((p) => p.id !== playlist.id)],
  };
}

export function renamePlaylistLocally(
  playlists: LibraryPlaylist[],
  playlistId: string,
  name: string,
  description?: string,
  nowMs = Date.now()
): LibraryPlaylist[] {
  const cleanName = cleanMediaString(name, 120);
  return playlists.map((pl) =>
    pl.id === playlistId
      ? {
          ...pl,
          name: cleanName || pl.name,
          description: description !== undefined ? cleanMediaString(description, 400) : pl.description,
          updatedAt: nowMs,
        }
      : pl
  );
}

export function deletePlaylistLocally(playlists: LibraryPlaylist[], playlistId: string): LibraryPlaylist[] {
  return playlists.filter((pl) => pl.id !== playlistId);
}

export function setPlaylistItemLocally(
  playlists: LibraryPlaylist[],
  playlistId: string,
  rawItem: RawLibraryMediaInput,
  present: boolean,
  nowMs = Date.now()
): LibraryPlaylist[] {
  return playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    const nextItems = setMediaItemInList(pl.items, rawItem, present, nowMs);
    const firstCover = nextItems.find((item) => item.thumbnailUrl)?.thumbnailUrl || '';
    return {
      ...pl,
      items: nextItems,
      coverUrl: firstCover,
      updatedAt: nowMs,
    };
  });
}

export function isItemInPlaylist(playlist: LibraryPlaylist, itemOrPost: Parameters<typeof canonicalLibraryMediaKey>[0]): boolean {
  const key = canonicalLibraryMediaKey(itemOrPost);
  return Boolean(key && playlist.items.some((entry) => entry.key === key));
}
