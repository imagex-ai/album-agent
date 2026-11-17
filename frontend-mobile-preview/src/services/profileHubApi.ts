import { translations } from '../i18n/translations';
import { useAppStore } from '../store/useAppStore';
import { backendApi } from './realApi';
import type { MultiAlbumPreviewImage, ScannedVideoItem } from '../types';
import { validateAlbumSubset } from './profileHubModel';
import type { 
  ProfileHeroData, 
  HighlightItem, 
  PlaylistItem, 
  AlbumItem, 
  MediaItemCard 
} from '../components/profile-hub/profileHubTypes';

export interface ProfileCandidate {
  key: string;
  source_url: string;
  title: string;
  cover_url: string | null;
  provenance: { page_url: string; evidence: string; ownership: 'unverified' | 'verified' };
}

export interface ProfileScanResponse {
  source_checked_at?: string;
  recent_capabilities?: Record<string, 'source_latest' | 'source_listing' | 'unverified'>;
  profile_key: string;
  source_url: string;
  name: string | null;
  cover_url: string | null;
  description: string | null;
  profile_data?: ProfileHeroData;
  canonical_highlights?: HighlightItem[];
  canonical_playlists?: PlaylistItem[];
  canonical_albums?: AlbumItem[];
  canonical_videos?: MediaItemCard[];
  canonical_gifs?: MediaItemCard[];
  playlist_videos_map?: Record<string, MediaItemCard[]>;
  discovery_errors?: Array<'videos' | 'playlists' | 'albums' | 'gifs'>;
  discovery_pending?: boolean;
  highlights: { status: 'partial'; items: Array<
    { kind: 'playlist' | 'album'; collection_key: string; evidence: string } |
    { kind: 'video' | 'photo' | 'gif'; media_key: string; source_url: string; title: string; cover_url: string | null; evidence: string }
  >; loaded_count: number };
  playlists: { status: 'partial'; items: ProfileCandidate[]; loaded_count: number };
  albums: { status: 'partial'; items: ProfileCandidate[]; loaded_count: number };
  videos?: { status: 'partial'; items: any[]; loaded_count: number };
  gifs?: { status: 'partial'; items: any[]; loaded_count: number };
}

export type ProfileRoot = ProfileScanResponse;

export interface MetadataTarget { url: string; kind: 'video' | 'playlist' | 'album' }
export type MetadataResult = MetadataTarget & Partial<MediaItemCard & PlaylistItem & AlbumItem>;

export async function loadProfileMetadata(
  targets: MetadataTarget[], onBatch: (items: MetadataResult[]) => void, signal: AbortSignal,
  preferredKind?: () => MetadataTarget['kind'] | undefined,
): Promise<void> {
  const unique = [...new Map(targets.filter(item => item.url).map(item => [item.url, item])).values()];
  const kinds: MetadataTarget['kind'][] = ['album', 'playlist', 'video'];
  const queues = Object.fromEntries(kinds.map(kind => [kind, unique.filter(item => item.kind === kind)])) as Record<MetadataTarget['kind'], MetadataTarget[]>;
  while (kinds.some(kind => queues[kind].length) && !signal.aborted) {
    const batch: MetadataTarget[] = [];
    const preferred = preferredKind?.();
    if (preferred) batch.push(...queues[preferred].splice(0, 6));
    const order = preferred ? [...kinds.filter(kind => kind !== preferred), preferred] : kinds;
    while (batch.length < 8 && kinds.some(kind => queues[kind].length)) {
      for (const kind of order) {
        if (batch.length < 8 && queues[kind].length) batch.push(queues[kind].shift()!);
      }
    }
    const received = new Set<string>();
    try {
      const response = await fetch('/api/profile-hub/metadata-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }), signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body?.getReader) {
        const result = await response.json();
        if (!signal.aborted) onBatch(result.items ?? []);
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let pending: MetadataResult[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          clearTimeout(timer); timer = undefined;
          const items = pending; pending = [];
          if (items.length && !signal.aborted) onBatch(items);
        };
        const abort = () => {
          clearTimeout(timer); timer = undefined; pending = [];
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          while (!signal.aborted) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split('\n');
            buffer = done ? '' : lines.pop() || '';
            for (const line of lines) {
              if (!line.trim()) continue;
              const item = JSON.parse(line) as MetadataResult;
              received.add(item.url);
              pending.push(item);
              // A slow item must not hold ready metadata. Coalesce fast arrivals
              // for at most one frame instead of rebuilding catalogs per line.
              if (pending.length >= 8) flush();
              else timer ??= setTimeout(flush, 16);
            }
            if (done) break;
          }
        } finally {
          signal.removeEventListener('abort', abort);
          flush();
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
    } catch {
      if (!signal.aborted) onBatch(batch.filter(item => !received.has(item.url)).map(item => ({ ...item, metadataStatus: 'error' })));
      return;
    }
  }
}

async function readNdjsonProfileStream(
  response: Response,
  signal: AbortSignal | undefined,
  onProfile: (profile: ProfileRoot) => void,
): Promise<ProfileScanResponse> {
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ProfileRoot | undefined;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (event.type === 'error') throw new Error(event.detail || 'Profile discovery failed');
        if (event.type === 'profile') onProfile(event.profile);
        if (event.type === 'complete') result = event.profile;
      }
      if (done || result) break;
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!result) throw new Error('Profile discovery ended before completion');
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Timeline refresh must never fall back to the deep/full-catalog scanner.
export async function discoverRecentProfileRoot(
  url: string,
  signal?: AbortSignal,
  expectedProfileName?: string,
  knownVideoUrls: string[] = [],
  knownMediaUrls: string[] = [],
  onProfile?: (profile: ProfileRoot) => void,
): Promise<ProfileScanResponse> {
  const options: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      expected_name: expectedProfileName,
      known_video_urls: knownVideoUrls,
      known_media_urls: knownMediaUrls,
    }),
    signal,
  };
  let response = await fetch(onProfile ? '/api/profile-hub/recent-stream' : '/api/profile-hub/recent', options);
  if (onProfile && [404, 405].includes(response.status)) {
    response = await fetch('/api/profile-hub/recent', options);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!onProfile || !response.headers?.get('content-type')?.includes('application/x-ndjson')) {
    return response.json();
  }
  return readNdjsonProfileStream(response, signal, onProfile);
}

export async function discoverProfileRoot(
  url: string, signal?: AbortSignal, onProfile?: (profile: ProfileRoot) => void,
): Promise<ProfileScanResponse> {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  };
  let response = await fetch(onProfile ? '/api/profile-hub/scan-stream' : '/api/profile-hub/scan', options);
  // Compatibility with a backend that has not been restarted yet.
  if (onProfile && [404, 405].includes(response.status)) response = await fetch('/api/profile-hub/scan', options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  }
  if (!onProfile || !response.headers?.get('content-type')?.includes('application/x-ndjson') || !response.body) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ProfileRoot | undefined;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (event.type === 'error') throw new Error(event.detail || 'Profile discovery failed');
        if (event.type === 'profile') onProfile(event.profile);
        if (event.type === 'complete') result = event.profile;
      }
      if (done || result) break;
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!result) throw new Error('Profile discovery ended before completion');
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface AlbumPhotosResult {
  photos: MediaItemCard[];
  metadata: Partial<AlbumItem>;
}

export async function fetchAlbumPhotos(url: string, signal?: AbortSignal, page: number = 1): Promise<AlbumPhotosResult> {
  const response = await fetch('/api/profile-hub/album-photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, page }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `${translations[useAppStore.getState().settings.language].profileHub.albumLoadError} (HTTP ${response.status})`);
  }
  const data = await response.json();
  return {
    photos: (data.photos || []) as MediaItemCard[],
    metadata: {
      metadataStatus: data.metadataStatus,
      author: data.author ?? undefined, authorUrl: data.authorUrl ?? undefined,
      views: data.views ?? undefined, updatedAt: data.updatedAt || '',
      updatedAtRaw: data.updatedAtRaw ?? undefined,
      photoCount: data.reportedCount ?? null, paginationComplete: data.paginationComplete === true,
    },
  };
}

export interface PhotoResolvePayload {
  photoId?: string;
  pageUrl?: string;
  thumbnailUrl: string;
  sourcePage?: string;
}

export interface PhotoResolveResult {
  success: boolean;
  photo_id?: string;
  original_url: string;
  width: number;
  height: number;
  file_size: number;
  format: string;
  is_resolved: boolean;
  elapsed_seconds: number;
}

const photoResolveCache = new Map<string, PhotoResolveResult>();

export async function resolvePhotoOriginal(
  payload: PhotoResolvePayload,
  signal?: AbortSignal,
  priority?: 'high' | 'low'
): Promise<PhotoResolveResult> {
  const cacheKey = `${payload.pageUrl || ''}::${payload.thumbnailUrl}`;
  if (photoResolveCache.has(cacheKey)) {
    return photoResolveCache.get(cacheKey)!;
  }

  try {
    const response = await fetch('/api/profile-hub/resolve-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photo_id: payload.photoId,
        page_url: payload.pageUrl,
        thumbnail_url: payload.thumbnailUrl,
        source_page: payload.sourcePage,
      }),
      signal,
      ...(priority ? { priority } : {}),
    });

    if (!response.ok) {
      return {
        success: false,
        photo_id: payload.photoId,
        original_url: payload.thumbnailUrl,
        width: 0,
        height: 0,
        file_size: 0,
        format: 'jpg',
        is_resolved: false,
        elapsed_seconds: 0,
      };
    }

    const data: PhotoResolveResult = await response.json();
    if (data.success && data.is_resolved) {
      photoResolveCache.set(cacheKey, data);
    }
    return data;
  } catch (_) {
    return {
      success: false,
      photo_id: payload.photoId,
      original_url: payload.thumbnailUrl,
      width: 0,
      height: 0,
      file_size: 0,
      format: 'jpg',
      is_resolved: false,
      elapsed_seconds: 0,
    };
  }
}

export interface PlaylistVideosResult {
  videos: MediaItemCard[];
  author?: string;
  authorUrl?: string;
  views?: string;
  metadataStatus?: 'fetched' | 'error';
  lastAddedDate?: string;
  playlistUrl?: string;
  updatedAt?: string;
  updatedAtRaw?: string;
  reportedCount?: number | null;
  paginationComplete?: boolean;
}

export async function fetchPlaylistVideos(url: string, signal?: AbortSignal): Promise<PlaylistVideosResult> {
  const response = await fetch('/api/profile-hub/playlist-videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `${translations[useAppStore.getState().settings.language].profileHub.playlistLoadError} (HTTP ${response.status})`);
  }
  const data = await response.json();
  return {
    videos: (data.videos || []) as MediaItemCard[],
    author: data.author,
    authorUrl: data.authorUrl,
    views: data.views,
    metadataStatus: data.metadataStatus,
    lastAddedDate: data.lastAddedDate,
    playlistUrl: data.playlist_url || url,
    updatedAt: data.updatedAt || '',
    updatedAtRaw: data.updatedAtRaw ?? undefined,
    reportedCount: data.reportedCount ?? null,
    paginationComplete: data.paginationComplete === true,
  };
}

export async function batchSaveProfileHub(payload: {
  albums: any[];
  videos: any[];
  folder: string;
}): Promise<{ success: boolean; message: string; saved_videos: number; saved_albums: number }> {
  const response = await fetch('/api/profile-hub/batch-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `${translations[useAppStore.getState().settings.language].profileHub.savingError} (HTTP ${response.status})`);
  }
  return response.json();
}

export async function discoverProfileVideos(
  url: string,
  onVideos: (videos: ScannedVideoItem[]) => void,
  signal?: AbortSignal,
): Promise<ScannedVideoItem[]> {
  const results = new Map<string, ScannedVideoItem>();
  let streamError = '';
  const add = (videos: ScannedVideoItem[]) => {
    if (signal?.aborted) return;
    videos.filter(video => video.is_primary !== false && video.section !== 'recommended')
      .forEach(video => { if (video.url) results.set(video.url, video); });
    onVideos([...results.values()]);
  };
  const response = await backendApi.scanPageForVideosStream(url, 5000, undefined,
    page => add(page.new_videos), undefined, message => { streamError = message; }, signal);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (streamError) throw new Error(streamError);
  if (!response.success) throw new Error(response.error || 'Video discovery failed');
  add(response.videos);
  return [...results.values()];
}

export async function previewProfileAlbum(candidate: ProfileCandidate, signal?: AbortSignal): Promise<MultiAlbumPreviewImage[]> {
  const result = await backendApi.previewMultiAlbum({ title: candidate.title, url: candidate.source_url }, signal);
  if (!result.success) throw new Error(result.error || 'Album preview failed');
  return result.images;
}

export async function discoverProfileAlbums(
  url: string,
  onAlbum: (album: ProfileCandidate) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/multi-album/discover-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ url, max_related: 0, max_pages: 50 }),
  });
  if (!response.ok || !response.body) throw new Error(`Album discovery failed (HTTP ${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        let event: any;
        try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (event.type === 'done') completed = true;
        if (event.type === 'error') throw new Error(event.message || event.error || 'Album discovery failed');
        if (event.type !== 'album' || !event.album?.url || !event.album?.title) continue;
        let found: URL;
        try { found = new URL(event.album.url); } catch { continue; }
        if (!['http:', 'https:'].includes(found.protocol) || found.hostname !== new URL(url).hostname) continue;
        found.hash = '';
        onAlbum({
          key: found.href,
          source_url: found.href,
          title: String(event.album.title),
          cover_url: event.album.thumbnail_url || null,
          provenance: { page_url: url, evidence: 'discovery candidate', ownership: 'unverified' }
        });
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!completed) throw new Error('Album discovery ended before completion');
}

export async function queueProfileAlbums(
  albums: Array<{ candidate: ProfileCandidate; selectedUrls: string[]; preview: MultiAlbumPreviewImage[] }>,
  folder: string,
): Promise<{ queued: number }> {
  if (!albums.length) throw new Error('No albums selected');
  const seen = new Set<string>();
  const payload = albums.map(({ candidate, selectedUrls, preview }) => {
    const urls = validateAlbumSubset(selectedUrls, preview.map(image => image.original_url));
    for (const url of urls) {
      if (seen.has(url)) throw new Error('The same image is selected in multiple albums');
      seen.add(url);
    }
    return { title: candidate.title, url: candidate.source_url, thumbnail_url: candidate.cover_url, selected_image_urls: urls };
  });
  const response = await fetch('/api/multi-album/batch-save-to-library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albums: payload, folder, strict_profile_selection: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`);
  return { queued: Number(data.queued) || 0 };
}

export async function downloadProfileSelection(
  albums: Array<{ candidate: ProfileCandidate; selectedUrls: string[]; preview: MultiAlbumPreviewImage[] }>,
  videos: Array<ScannedVideoItem & { collections: Array<{ title: string; source_url: string }> }>,
): Promise<void> {
  if (!albums.length && !videos.length) throw new Error('No media selected');
  const payload = albums.map(({ candidate, selectedUrls, preview }) => ({
    title: candidate.title,
    url: candidate.source_url,
    thumbnail_url: candidate.cover_url,
    selected_image_urls: selectedUrls && selectedUrls.length > 0 && preview && preview.length > 0
      ? validateAlbumSubset(selectedUrls, preview.map(image => image.original_url))
      : undefined,
  }));
  const response = await fetch('/api/profile-hub/export-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albums: payload, videos }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`);
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = 'profile-media.zip';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
}
