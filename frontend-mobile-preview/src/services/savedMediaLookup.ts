import type { Album, VideoItem } from '../types';

type Fingerprint = (title?: string, url?: string, height?: number) => string;
export interface SavedMediaQuery { url?: string; title?: string; height?: number; }
export interface SavedMediaStatus {
  isSaved: boolean;
  isExactDuplicate: boolean;
  hasAlternativeResolution: boolean;
  savedFolder: string;
  folder: string;
  targetId: string;
  targetView: 'videos' | 'gallery';
  qualityLabel?: string;
}

const unsaved: SavedMediaStatus = { isSaved: false, isExactDuplicate: false, hasAlternativeResolution: false, savedFolder: '', folder: '', targetId: '', targetView: 'videos' };
const normalizeTitle = (title?: string) => (title || '').toLowerCase().replace(/[_\-\.\s]+/g, ' ');
const sourceKey = (source?: string) => {
  const url = source || '';
  return url.match(/viewkey=([a-zA-Z0-9]+)/i)?.[1]
  || url.match(/video-([a-zA-Z0-9]{6,})/i)?.[1]
  || url.match(/\/videos\/(-?\d+\/\d+\/[a-zA-Z0-9_]+)/i)?.[1]
    || url.split('?')[0].toLowerCase();
};

/** Indexes are immutable snapshots. First-match ordering and fuzzy title
 * semantics match the existing library, including alternate resolutions. */
export function createSavedMediaLookup(videos: VideoItem[], albums: Album[], fingerprint: Fingerprint) {
  const videoSources = new Map<string, number>();
  const videoFingerprints = new Map<string, number>();
  const albumSources = new Map<string, number>();
  const albumFingerprints = new Map<string, number>();
  const albumTitles = new Map<string, number>();
  const videoTitles = videos.map(video => normalizeTitle(video.title));
  const first = (map: Map<string, number>, key: string, index: number) => { if (key && !map.has(key)) map.set(key, index); };
  videos.forEach((video, index) => {
    first(videoSources, sourceKey(video.sourceUrl || video.url), index);
    first(videoFingerprints, fingerprint(video.title, video.sourceUrl || video.url, video.height), index);
  });
  albums.forEach((album, index) => {
    first(albumSources, sourceKey(album.sourceUrl), index);
    first(albumFingerprints, fingerprint(album.title, album.sourceUrl), index);
    first(albumTitles, normalizeTitle(album.title), index);
  });
  const cache = new Map<string, SavedMediaStatus>();
  return (query: SavedMediaQuery): SavedMediaStatus => {
    const cacheKey = JSON.stringify([query.url || '', query.title || '', query.height || 0]);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const key = sourceKey(query.url);
    const fp = fingerprint(query.title, query.url, query.height);
    const title = normalizeTitle((query.title || '').trim());
    let index = Math.min(videoSources.get(key) ?? Infinity, videoFingerprints.get(fp) ?? Infinity);
    // Substring matches still take precedence when they occur earlier in the
    // original list. Only cheap, pre-normalized strings are examined here.
    if (title.length > 8) {
      for (let i = 0; i < Math.min(index, videos.length); i++) {
        if (videoTitles[i] && (title.includes(videoTitles[i]) || videoTitles[i].includes(title))) { index = i; break; }
      }
    }
    let result = unsaved;
    if (index !== Infinity) {
      const video = videos[index];
      const height = video.height || ((video as VideoItem & { resolution?: string }).resolution
        ? parseInt(String((video as VideoItem & { resolution?: string }).resolution).split('x')[1] || String((video as VideoItem & { resolution?: string }).resolution)) : 0);
      const alternative = Boolean(query.height && height && Math.abs(query.height - height) > 50);
      const folder = video.folder || 'Extraídos';
      result = { isSaved: true, isExactDuplicate: !alternative, hasAlternativeResolution: alternative, savedFolder: folder, folder, targetId: video.id, targetView: 'videos',
        ...(alternative ? { qualityLabel: height >= 1080 ? '1080p HD' : height >= 720 ? '720p HD' : `${height}p` } : {}) };
    } else {
      index = Math.min(albumSources.get(key) ?? Infinity, albumFingerprints.get(fp) ?? Infinity, title.length > 8 ? albumTitles.get(title) ?? Infinity : Infinity);
      if (index !== Infinity) {
        const album = albums[index];
        const folder = album.folder || 'Geral';
        result = { isSaved: true, isExactDuplicate: true, hasAlternativeResolution: false, savedFolder: folder, folder, targetId: album.id, targetView: 'gallery' };
      }
    }
    if (cache.size >= 4096) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, result);
    return result;
  };
}
