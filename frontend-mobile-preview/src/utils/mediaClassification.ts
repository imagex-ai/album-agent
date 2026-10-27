import type { Album, ImageItem } from '../types';

type MediaItem = Partial<ImageItem> & { is_video?: boolean };
export type MediaCategory = 'photo' | 'gif' | 'video';
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'm3u8', 'avi']);
const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'apng', 'gif', 'webp', 'avif']);

/** Inspect the source, rather than the proxy endpoint or the URL's query text. */
export const unwrapMediaSource = (source?: string): string => {
  let current = source || '';
  for (let depth = 0; depth < 5 && current; depth += 1) {
    try {
      const parsed = new URL(current, 'https://imagex.local');
      if (!['/api/proxy-image', '/api/proxy-video-stream'].includes(parsed.pathname)) return current;
      const original = parsed.searchParams.get('url');
      if (!original || original === current) return current;
      current = original;
    } catch {
      return current;
    }
  }
  return current;
};

export const inferMediaFormat = (source?: string): string | undefined => {
  const original = unwrapMediaSource(source);
  const inline = original.match(/^data:(?:image|video)\/([a-z0-9.+-]+)[;,]/i);
  if (inline) return inline[1].toLowerCase();
  try {
    return new URL(original, 'https://imagex.local').pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  } catch {
    return undefined;
  }
};

const sourceFormat = (item: MediaItem): string | undefined => {
  for (const source of [item.rawOriginalUrl, item.videoStreamUrl, item.videoUrl, item.originalUrl]) {
    const format = inferMediaFormat(source);
    if (format && (VIDEO_FORMATS.has(format) || IMAGE_FORMATS.has(format))) return format;
  }
  return undefined;
};

const isVideoStreamSource = (source?: string): boolean => {
  let current = source || '';
  for (let depth = 0; depth < 5 && current; depth += 1) {
    try {
      const parsed = new URL(current, 'https://imagex.local');
      if (/^\/api\/(?:trash\/)?videos\/[^/]+\/stream\/?$/.test(parsed.pathname)) return true;
      if (parsed.pathname === '/api/proxy-video-stream' && parsed.searchParams.get('url')) return true;
      if (parsed.pathname !== '/api/proxy-image') return false;
      const original = parsed.searchParams.get('url');
      if (!original || original === current) return false;
      current = original;
    } catch {
      return false;
    }
  }
  return false;
};

export const isVideoMedia = (item: MediaItem): boolean => {
  const format = (item.format || '').toLowerCase();
  // Verified image bytes outrank a misleading URL suffix or stale legacy label.
  if (item.animationChecked && IMAGE_FORMATS.has(format) && !item.videoUrl && !item.videoStreamUrl) return false;
  return item.mediaType === 'video' || !!item.videoUrl || !!item.videoStreamUrl || !!item.is_video
    || VIDEO_FORMATS.has(sourceFormat(item) || '') || VIDEO_FORMATS.has(format)
    || [item.rawOriginalUrl, item.originalUrl].some(isVideoStreamSource);
};

/** Animation is a category; an animated MP4 still needs video playback. */
export const getMediaCategory = (item: MediaItem): MediaCategory => {
  if (item.isAnimated === true) return 'gif';
  if (item.animationChecked !== true && (
    item.mediaType === 'gif' || item.format === 'gif' || sourceFormat(item) === 'gif'
  )) return 'gif';
  return isVideoMedia(item) ? 'video' : 'photo';
};

/** File extension for downloads, independent of the animation category. */
export const getMediaExtension = (item: MediaItem): string => {
  const declared = (item.format || '').toLowerCase();
  const inferred = sourceFormat(item);
  // Legacy stream records used the old JPEG fallback despite carrying video bytes.
  if (!item.animationChecked && !inferred && IMAGE_FORMATS.has(declared)
    && [item.rawOriginalUrl, item.originalUrl, item.videoStreamUrl, item.videoUrl].some(isVideoStreamSource)) return 'mp4';
  const format = item.animationChecked && (VIDEO_FORMATS.has(declared) || IMAGE_FORMATS.has(declared))
    ? declared : inferred || declared;
  if (format === 'jpeg') return 'jpg';
  if (VIDEO_FORMATS.has(format) || IMAGE_FORMATS.has(format)) return format;
  return isVideoMedia(item) ? 'mp4' : 'jpg';
};

export const normalizeAlbumMediaTags = (tags: string[] = [], isGifAlbum: boolean = false): string[] => {
  const retained = tags.filter(tag => !['gif', 'animado'].includes(tag.toLowerCase()));
  return Array.from(new Set([...retained, ...(isGifAlbum ? ['gif', 'animado'] : [])]));
};

type MediaSummary = { hasGifs: boolean; gifCount: number; hasVideos: boolean; videoCount: number; photoCount: number; mediaType: MediaCategory };
// Media arrays are replaced by store mutations. Weak keys release old libraries
// and let album metadata/favorite changes reuse the classification work.
const albumMediaSummaries = new WeakMap<ImageItem[], MediaSummary>();
const albumVideoTransport = new WeakMap<ImageItem[], boolean>();

export const cacheAlbumVideoTransport = (images: ImageItem[], hasVideo: boolean) => { albumVideoTransport.set(images, hasVideo); };
export const hasAlbumVideoTransport = (album: Partial<Album>): boolean => {
  if (!Array.isArray(album.images)) return getAlbumMediaSummary(album).hasVideos;
  const cached = albumVideoTransport.get(album.images);
  if (cached !== undefined) return cached;
  const value = album.images.some(isVideoMedia);
  albumVideoTransport.set(album.images, value);
  return value;
};

export const getAlbumMediaSummary = (album: Partial<Album>): MediaSummary => {
  if (Array.isArray(album.images)) {
    const cached = albumMediaSummaries.get(album.images);
    if (cached) return cached;
  }
  let gifCount = 0, videoCount = 0, photoCount = 0;
  if (Array.isArray(album.images) && album.images.length > 0) {
    for (const image of album.images) {
      const category = getMediaCategory(image);
      if (category === 'gif') gifCount += 1;
      else if (category === 'video') videoCount += 1;
      else photoCount += 1;
    }
    const totalReported = album.imageCount ?? album.images.length;
    if (totalReported > album.images.length) {
      // Truncated preview array: do not allow a lone preview GIF or video to classify the entire gallery
      const knownGifCount = album.gifCount ?? (album.mediaType === 'gif' ? totalReported : (album.hasGifs ? Math.max(gifCount, 1) : gifCount));
      const knownVideoCount = album.mediaType === 'video' ? Math.max(videoCount, 1) : videoCount;
      if (album.mediaType === 'photo') {
        photoCount = Math.max(photoCount, 1, totalReported - knownGifCount - knownVideoCount);
        gifCount = knownGifCount;
      } else if (album.mediaType === 'gif') {
        photoCount = 0;
        gifCount = Math.max(gifCount, knownGifCount, totalReported);
      } else if (album.mediaType === 'video') {
        videoCount = Math.max(videoCount, knownVideoCount);
      } else {
        if (totalReported > knownGifCount) {
          photoCount = Math.max(photoCount, totalReported - knownGifCount - knownVideoCount);
        }
      }
    }
  } else {
    // Only genuinely unloaded summaries may rely on their explicit aggregate fields.
    const totalReported = album.imageCount || 0;
    gifCount = album.gifCount || (album.mediaType === 'gif' ? totalReported : (album.hasGifs ? 1 : 0));
    videoCount = album.mediaType === 'video' ? Math.max(1, totalReported - gifCount) : 0;
    photoCount = album.mediaType === 'gif' ? 0 : Math.max(0, totalReported - gifCount - videoCount);
  }
  const hasGifs = gifCount > 0;
  const hasVideos = videoCount > 0;
  // A photo album containing ordinary images must NOT be classified as an Animated GIF album.
  // It is only a GIF album if it has gifs and NO ordinary photos.
  const mediaType: MediaCategory =
    photoCount > 0 ? (videoCount > photoCount ? 'video' : 'photo') :
    hasVideos ? (videoCount >= gifCount ? 'video' : 'gif') :
    hasGifs ? 'gif' : 'photo';
  const summary = { hasGifs, gifCount, hasVideos, videoCount, photoCount, mediaType };
  if (Array.isArray(album.images)) albumMediaSummaries.set(album.images, summary);
  return summary;
};

export const matchesAlbumMediaFilter = (album: Partial<Album>, filter: 'all' | MediaCategory): boolean => {
  if (filter === 'all') return true;
  const summary = getAlbumMediaSummary(album);
  if (filter === 'photo') return summary.photoCount > 0 || (!summary.hasGifs && !summary.hasVideos);
  if (filter === 'video') return summary.hasVideos && summary.videoCount >= summary.photoCount;
  if (filter === 'gif') return summary.gifCount > 0 && summary.photoCount === 0;
  return true;
};
