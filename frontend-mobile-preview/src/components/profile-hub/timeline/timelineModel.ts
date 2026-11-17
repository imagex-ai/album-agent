import { getDuplicateSourceKey } from '../../../utils/duplicateSource';

export type TimelinePlatform = 'eporner' | 'youtube' | 'pornhub' | 'xhamster' | 'generic';

export interface TimelineVideoQuality {
  height: number;
  label: string;
  streamUrl: string;
  bitrate?: number;
  format_id?: string;
  ext?: string;
}

export interface TimelineComment {
  author: string;
  handle?: string;
  avatar: string;
  time: string;
  likes: string;
  text: string;
  isAuthor?: boolean;
  hidden?: boolean;
  replies?: TimelineComment[];
}

export interface TimelineCreatorStats {
  videos?: number;
  posts?: number;
  albums?: number;
  gifs?: number;
  likes?: string;
  subscribers?: string;
  followers?: string;
  views?: string;
  verified?: boolean;
}

export interface TimelinePlaylist {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  videoCount?: number;
  updatedAt?: string;
  videos?: TimelinePost[];
}

export interface TimelineCreator {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  site?: TimelinePlatform | string;
  profileUrl: string;
  verified: boolean;
  stats: TimelineCreatorStats;
  bio?: string;
  playlists?: TimelinePlaylist[];
}

export interface TimelinePhotoItem {
  id?: string;
  url: string;
  thumbnailUrl?: string;
  pageUrl?: string;
  sourcePage?: string;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  format?: string;
  isResolvedOriginal?: boolean;
  isAnimated?: boolean;
}

export interface TimelinePost {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorHandle: string;
  creatorAvatar: string;
  creatorVerified?: boolean;
  type: 'video' | 'photo_grid' | 'album' | 'gif' | 'playlist';
  source?: string;
  sourcePage?: string;
  sourceAssociation?: 'profile_uploads' | 'profile_videos';
  streamResolverUrl?: string;
  youtubeId?: string;
  videoUrl?: string;
  originalUrl?: string;
  albumUrl?: string;
  playlistUrl?: string;
  playlistVideos?: TimelinePost[];
  videoCount?: number;
  masterHlsUrl?: string;
  previewVideoUrl?: string;
  qualities?: TimelineVideoQuality[];
  thumbnail?: string;
  title: string;
  caption?: string;
  duration?: string;
  views?: string;
  resolution?: string;
  photos?: string[];
  photoItems?: TimelinePhotoItem[];
  photoCount?: number;
  comments: TimelineComment[];
  likes: number | null;
  liked?: boolean;
  favorited?: boolean;
  saved?: boolean;
  date: string;
  // When a source-relative label was actually observed. It is not an upload date.
  dateObservedAt?: string;
  publicationDateRaw?: string;
  publicationDatePrecision?: 'day';
}

export interface TimelineDataPayload {
  creators: TimelineCreator[];
  posts: TimelinePost[];
  comments?: Record<string, TimelineComment[]>;
}

/** Legacy saved media contributes identity only, never visible social content. */
export type TimelineSourceIdentityHint = Pick<TimelinePost, 'id' | 'creatorId' | 'type' | 'originalUrl' | 'albumUrl'>;

/** Validate saved JSON at the boundary before components can search/render it. */
export function isTimelineDataPayload(value: unknown): value is TimelineDataPayload {
  const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item);
  const strings = (item: Record<string, unknown>, keys: string[]) =>
    keys.every(key => item[key] === undefined || typeof item[key] === 'string');
  const requiredStrings = (item: Record<string, unknown>, keys: string[]) =>
    keys.every(key => typeof item[key] === 'string');
  const isComment = (comment: unknown, depth = 0): boolean => depth < 6 && record(comment)
    && requiredStrings(comment, ['text'])
    && strings(comment, ['author', 'authorName', 'handle', 'avatar', 'time'])
    && (comment.likes === undefined || typeof comment.likes === 'string' || (typeof comment.likes === 'number' && Number.isFinite(comment.likes)))
    && (comment.isAuthor === undefined || typeof comment.isAuthor === 'boolean')
    && (comment.hidden === undefined || typeof comment.hidden === 'boolean')
    && (comment.replies === undefined || (Array.isArray(comment.replies) && comment.replies.every(reply => isComment(reply, depth + 1))));
  const isQuality = (q: unknown): boolean => record(q)
    && typeof q.height === 'number' && Number.isFinite(q.height)
    && typeof q.label === 'string' && typeof q.streamUrl === 'string'
    && strings(q, ['format_id', 'ext'])
    && (q.bitrate === undefined || (typeof q.bitrate === 'number' && Number.isFinite(q.bitrate)));
  const isPost = (item: unknown, depth = 0): boolean => depth < 4 && record(item)
    && requiredStrings(item, ['id', 'creatorId', 'creatorName', 'creatorHandle', 'creatorAvatar', 'title', 'type'])
    && strings(item, [
      'caption', 'source', 'sourcePage', 'streamResolverUrl', 'youtubeId',
      'videoUrl', 'originalUrl', 'albumUrl', 'playlistUrl', 'masterHlsUrl',
      'previewVideoUrl', 'thumbnail', 'duration', 'views', 'resolution',
      'date', 'dateObservedAt', 'publicationDateRaw',
    ])
    && (item.publicationDatePrecision === undefined || item.publicationDatePrecision === 'day')
    && (item.qualities === undefined || (Array.isArray(item.qualities) && item.qualities.every(isQuality)))
    && (item.playlistVideos === undefined || (Array.isArray(item.playlistVideos) && item.playlistVideos.every(sub => isPost(sub, depth + 1))))
    && (item.comments === undefined || (Array.isArray(item.comments) && item.comments.every(comment => isComment(comment))))
    && (item.photos === undefined || (Array.isArray(item.photos) && item.photos.every(url => typeof url === 'string')))
    && (item.photoItems === undefined || (Array.isArray(item.photoItems) && item.photoItems.every(photo => record(photo)
      && requiredStrings(photo, ['url']) && strings(photo, ['thumbnailUrl', 'pageUrl', 'sourcePage']))));
  const playlists = (items: unknown) => items === undefined || (Array.isArray(items) && items.every(item =>
    record(item) && requiredStrings(item, ['id', 'title', 'url'])
    && strings(item, ['thumbnailUrl', 'updatedAt'])
    && (item.videos === undefined || (Array.isArray(item.videos) && item.videos.every(video => isPost(video))))));
  if (!record(value) || !Array.isArray(value.creators) || !Array.isArray(value.posts)) return false;
  return value.creators.every(item => record(item)
    && requiredStrings(item, ['id', 'name', 'handle', 'avatar', 'profileUrl'])
    && strings(item, ['bio', 'site']) && playlists(item.playlists))
    && value.posts.every(post => isPost(post));
}

export interface TimelineLightboxState {
  isOpen: boolean;
  images: string[];
  items?: TimelinePhotoItem[];
  currentIndex: number;
  title: string;
  albumUrl?: string;
  isLoadingAlbum?: boolean;
}

export interface TimelineAutoplayState {
  isPlaying: boolean;
  isAutoplayPreview: boolean;
  hasUserClickedVideo: boolean;
  showControls: boolean;
  isMuted: boolean;
}

export type TimelineAutoplayEvent =
  | 'hover_enter'
  | 'hover_leave'
  | 'viewport_enter'
  | 'viewport_leave'
  | 'video_click'
  | 'toggle_mute'
  | 'pause_external';

export function createInitialAutoplayState(): TimelineAutoplayState {
  return {
    isPlaying: false,
    isAutoplayPreview: false,
    hasUserClickedVideo: false,
    showControls: false,
    isMuted: true,
  };
}

export function computeAutoplayTransition(
  state: TimelineAutoplayState,
  event: TimelineAutoplayEvent
): TimelineAutoplayState {
  switch (event) {
    case 'hover_enter': {
      if (state.hasUserClickedVideo) {
        return state;
      }
      return {
        ...state,
        isPlaying: true,
        isAutoplayPreview: true,
        showControls: false,
        isMuted: true,
      };
    }
    case 'hover_leave': {
      if (state.hasUserClickedVideo) {
        return state;
      }
      return {
        ...state,
        isPlaying: false,
        isAutoplayPreview: false,
        showControls: false,
      };
    }
    case 'viewport_enter': {
      if (state.hasUserClickedVideo && state.isPlaying) {
        return state;
      }
      return {
        ...state,
        isPlaying: true,
        isAutoplayPreview: !state.hasUserClickedVideo,
        showControls: state.hasUserClickedVideo ? state.showControls : false,
        isMuted: state.hasUserClickedVideo ? state.isMuted : true,
      };
    }
    case 'viewport_leave': {
      return {
        isPlaying: false,
        isAutoplayPreview: false,
        hasUserClickedVideo: false,
        showControls: false,
        isMuted: true,
      };
    }
    case 'video_click': {
      // First click on video (either from idle or while autoplaying on hover/scroll):
      // reveals player controls, ensures video is playing, and keeps muted until user clicks volume
      if (!state.hasUserClickedVideo || !state.showControls) {
        return {
          ...state,
          isPlaying: true,
          isAutoplayPreview: false,
          hasUserClickedVideo: true,
          showControls: true,
        };
      }
      // Subsequent clicks on video when controls are already open: toggle play/pause
      return {
        ...state,
        isPlaying: !state.isPlaying,
        isAutoplayPreview: false,
        hasUserClickedVideo: true,
        showControls: true,
      };
    }
    case 'toggle_mute': {
      return {
        ...state,
        isMuted: !state.isMuted,
      };
    }
    case 'pause_external': {
      return {
        ...state,
        isPlaying: false,
        isAutoplayPreview: false,
      };
    }
    default:
      return state;
  }
}

export function unwrapProxiedVideoUrl(rawUrl?: string): {
  innerUrl: string;
  referer?: string;
  height?: number;
} {
  if (!rawUrl) return { innerUrl: '' };
  let current = rawUrl.trim();
  let foundReferer: string | undefined;
  let foundHeight: number | undefined;
  let depth = 0;

  while (current.includes('/api/proxy-video-stream') && current.includes('url=') && depth < 5) {
    depth += 1;
    try {
      const qIndex = current.indexOf('?');
      if (qIndex === -1) break;
      const params = new URLSearchParams(current.slice(qIndex + 1));
      const nextUrl = params.get('url');
      const ref = params.get('referer');
      const h = params.get('height');
      if (ref && !foundReferer) foundReferer = ref;
      if (h && !foundHeight) {
        const parsedH = parseInt(h, 10);
        if (!Number.isNaN(parsedH) && parsedH > 0) foundHeight = parsedH;
      }
      if (!nextUrl) break;
      current = nextUrl;
    } catch {
      break;
    }
  }

  return {
    innerUrl: current,
    referer: foundReferer,
    height: foundHeight,
  };
}

/** Same-origin source-renewal endpoint, not a persisted CDN media URL. */
export function isTimelineGifStreamUrl(url?: string): boolean {
  return Boolean(url?.startsWith('/api/profile-hub/gif-stream?url='));
}

export function buildTimelineStreamUrl(
  rawUrl?: string,
  referer?: string,
  height?: number,
  youtubeId?: string
): string {
  // This application endpoint renews a GIF from its stable page, then delegates
  // Range/media transport to the existing proxy. Do not proxy the resolver itself.
  if (isTimelineGifStreamUrl(rawUrl)) return rawUrl!;
  const { innerUrl, referer: innerReferer, height: innerHeight } = unwrapProxiedVideoUrl(rawUrl);
  const canonicalYt = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : undefined;
  const targetUrl = innerUrl || canonicalYt || referer || '';
  if (!targetUrl) return '';

  if (targetUrl.startsWith('blob:') || targetUrl.startsWith('data:')) {
    return targetUrl;
  }

  const effectiveReferer = referer || innerReferer || canonicalYt || (targetUrl.startsWith('http') ? targetUrl : undefined);
  const effectiveHeight = height || innerHeight;

  let built = `/api/proxy-video-stream?url=${encodeURIComponent(targetUrl)}`;
  if (effectiveReferer) {
    built += `&referer=${encodeURIComponent(effectiveReferer)}`;
  }
  if (effectiveHeight && effectiveHeight > 0) {
    built += `&height=${effectiveHeight}`;
  }
  return built;
}

export function isHlsStreamUrl(streamUrl?: string, masterHlsUrl?: string): boolean {
  if (masterHlsUrl) return true;
  if (!streamUrl) return false;
  const { innerUrl } = unwrapProxiedVideoUrl(streamUrl);
  const checkTarget = (innerUrl || streamUrl).toLowerCase();
  const pathPart = checkTarget.split('?')[0];
  if (pathPart.endsWith('.ts') || pathPart.endsWith('.mp4') || pathPart.endsWith('.webm')) {
    return false;
  }
  return (
    checkTarget.includes('.m3u8') ||
    checkTarget.includes('/hls/') ||
    checkTarget.includes('/hls_variant/') ||
    checkTarget.includes('/hls_playlist/')
  );
}

export function isWatchPageOnlyUrl(url?: string): boolean {
  if (!url) return true;
  const { innerUrl } = unwrapProxiedVideoUrl(url);
  const clean = (innerUrl || url).toLowerCase();
  return (
    clean.includes('youtube.com/watch') ||
    clean.includes('youtu.be/') ||
    clean.includes('youtube.com/shorts/')
  );
}

export function normalizeTimelineQualities(
  qualities?: TimelineVideoQuality[],
  referer?: string
): TimelineVideoQuality[] {
  if (!Array.isArray(qualities) || qualities.length === 0) return [];
  const byHeight = new Map<number, TimelineVideoQuality>();

  for (const q of qualities) {
    if (!q || typeof q.height !== 'number' || q.height <= 0 || !q.streamUrl) continue;
    // Skip placeholder YouTube watch page URLs masquerading as direct streams
    if (isWatchPageOnlyUrl(q.streamUrl)) continue;

    const label =
      q.label ||
      (q.height >= 2160
        ? '4K 2160p'
        : q.height >= 1440
          ? '2K 1440p'
          : q.height >= 720
            ? `${q.height}p HD`
            : `${q.height}p`);

    const proxied = buildTimelineStreamUrl(q.streamUrl, referer, q.height);
    if (!proxied) continue;

    if (!byHeight.has(q.height)) {
      byHeight.set(q.height, {
        ...q,
        label,
        streamUrl: proxied,
      });
    }
  }

  return Array.from(byHeight.values()).sort((a, b) => b.height - a.height);
}

export function isAnimatedMediaUrl(url?: string): boolean {
  if (!url) return false;
  const { innerUrl } = unwrapProxiedVideoUrl(url);
  const clean = (innerUrl || url).split('?')[0].toLowerCase();
  return clean.endsWith('.gif') || clean.endsWith('.webm') || clean.endsWith('.mp4') || clean.endsWith('.gifv');
}

export function upgradePhotoUrlFast(url?: string): string {
  if (!url) return '';
  let upgraded = url.trim();
  // Eporner gallery thumb suffix: _296x1000.jpg or _880x660.jpg -> .jpg
  if (/static-[^/]+-cdn\.eporner\.com\/gallery\//i.test(upgraded)) {
    upgraded = upgraded.replace(/_\d+x\d+\.(jpe?g|png|webp|gif)(\?.*)?$/i, '.$1$2');
  }
  // PornPics 460 thumbnail -> 1280 high-res original
  if (/cdni\.pornpics\.com\/460\//i.test(upgraded)) {
    upgraded = upgraded.replace(/\/460\//i, '/1280/');
  }
  return upgraded;
}

export function doesPostMatchCreator(post: TimelinePost, creator: TimelineCreator): boolean {
  if (!post || !creator) return false;
  if (post.creatorId === creator.id) return true;
  const cIdNorm = (creator.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pIdNorm = (post.creatorId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cNameNorm = (creator.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pNameNorm = (post.creatorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cHandleNorm = (creator.handle || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pHandleNorm = (post.creatorHandle || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  if (cIdNorm && pIdNorm && cIdNorm === pIdNorm) return true;
  if (cNameNorm && pNameNorm && cNameNorm === pNameNorm) return true;
  if (cHandleNorm && pHandleNorm && cHandleNorm === pHandleNorm) return true;
  if (cIdNorm === 'asmongoldtv' && pIdNorm === 'asmontv') return true;
  return false;
}

export function extractPlaylistsFromScan(
  creator: TimelineCreator,
  scan: {
    canonical_playlists?: Array<any>;
    playlist_videos_map?: Record<string, Array<any>>;
  }
): TimelinePlaylist[] {
  if (!scan || !Array.isArray(scan.canonical_playlists) || scan.canonical_playlists.length === 0) {
    return creator.playlists || [];
  }
  const result: TimelinePlaylist[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  // 1. Preserve existing creator playlists first
  for (const existingPl of creator.playlists || []) {
    result.push(existingPl);
    seenIds.add(existingPl.id);
    if (existingPl.url) seenUrls.add(existingPl.url.toLowerCase());
  }

  // 2. Merge newly scanned playlists without duplicating existing ones
  for (const pl of scan.canonical_playlists) {
    const plUrl = (pl.url || '').toLowerCase();
    if (plUrl && seenUrls.has(plUrl)) {
      continue;
    }
    const id = pl.id || `pl-${creator.id}-${result.length + 1}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    if (plUrl) seenUrls.add(plUrl);

    const title = pl.title || `${creator.name} Playlist`;
    const url = pl.url || '';
    const thumbnailUrl = pl.thumbnailUrl || creator.avatar;
    const count = typeof pl.videoCount === 'number' ? pl.videoCount : undefined;
    const updatedAt = pl.updatedAt || pl.lastAddedDate || '';

    const rawVideos = (scan.playlist_videos_map && scan.playlist_videos_map[id]) || pl.videos || [];
    const mappedVideos: TimelinePost[] = Array.isArray(rawVideos)
      ? rawVideos.map((v: any, vIdx: number) => {
          const vUrl = (v.originalUrl || v.pageUrl || v.url || '').trim();
          let ytId: string | undefined;
          if (vUrl.includes('youtube.com/watch') || vUrl.includes('youtu.be/')) {
            const m = vUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/) || vUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
            if (m) ytId = m[1];
          }
          const stream = buildTimelineStreamUrl(v.streamUrl || vUrl, vUrl, undefined, ytId);
          return {
            id: `pl-vid-${id}-${v.id || vIdx}`,
            creatorId: creator.id,
            creatorName: creator.name,
            creatorHandle: resolveCreatorHandle({
              handle: creator.handle,
              name: creator.name,
              profileUrl: creator.profileUrl,
            }),
            creatorAvatar: creator.avatar,
            creatorVerified: creator.verified,
            type: 'video' as const,
            source: creator.site || 'generic',
            youtubeId: ytId,
            videoUrl: stream,
            originalUrl: vUrl || undefined,
            previewVideoUrl: v.previewVideoUrl || v.previewClip || undefined,
            thumbnail: v.thumbnailUrl || creator.avatar,
            title: v.title || `${title} · ${vIdx + 1}`,
            duration: v.duration || undefined,
            views: v.views || v.subtitle || undefined,
            resolution: v.resolution || undefined,
            comments: [],
            likes: typeof v.likes === 'number' ? v.likes : null,
            date: v.timeAgo || v.uploadedAt || '',
          };
        })
      : [];

    result.push({
      id,
      title,
      url,
      thumbnailUrl,
      videoCount: count,
      updatedAt,
      videos: mappedVideos.length > 0 ? mappedVideos : undefined,
    });
  }

  return result;
}

export function mapScanResponseToTimelinePosts(
  creator: TimelineCreator,
  scan: {
    canonical_videos?: Array<any>;
    canonical_albums?: Array<any>;
    canonical_gifs?: Array<any>;
    canonical_playlists?: Array<any>;
    playlist_videos_map?: Record<string, Array<any>>;
    source_checked_at?: string;
  },
  existingPosts: TimelinePost[] = [],
  identityHints: TimelineSourceIdentityHint[] = []
): TimelinePost[] {
  const creatorExisting = existingPosts.filter((p) => doesPostMatchCreator(p, creator));
  // Keep source order, preserve existing objects/IDs and retain older items
  // absent from a partial page. A repeated title does not identify a video.
  const result: TimelinePost[] = [];
  const seenUrls = new Set<string>();
  const retained = new Set<TimelinePost>();
  const existingByUrl = new Map<string, TimelinePost>();
  const sourceKey = (url: string) => getDuplicateSourceKey(url.trim()) || '';
  const hintedIds = new Map<string,string>();
  for (const hint of identityHints.filter(hint => hint.creatorId === creator.id)) {
    for (const url of [hint.originalUrl,hint.albumUrl]) {
      if (url) hintedIds.set(sourceKey(url),hint.id);
    }
  }
  const hintedId = (url: string, aliases: string[] = []) => [url,...aliases].map(sourceKey).map(key => hintedIds.get(key)).find(Boolean);
  for (const post of creatorExisting) {
    for (const url of [post.originalUrl, post.albumUrl]) {
      const key = url && sourceKey(url);
      if (key && !existingByUrl.has(key)) existingByUrl.set(key, post);
    }
  }
  const resolvedHandle = resolveCreatorHandle({
    handle: creator.handle,
    name: creator.name,
    profileUrl: creator.profileUrl,
  });
  const claimSource = (url: string, date = '', publicationDateRaw?: string, publicationDatePrecision?: 'day', aliases: string[] = [], streamResolverUrl?: string) => {
    const key = sourceKey(url);
    // Without source identity, discovery cannot safely add or deduplicate it.
    if (!key || seenUrls.has(key)) return false;
    seenUrls.add(key);
    // Alias equivalence comes from the source adapter, never generic URL edits.
    const existing = existingByUrl.get(key) || aliases.map(sourceKey).map(alias => existingByUrl.get(alias)).find(Boolean);
    if (existing) {
      const upgradeDay = publicationDatePrecision === 'day' &&
        (existing.publicationDatePrecision !== 'day' || existing.date !== date ||
         !existing.dateObservedAt || !Number.isFinite(Date.parse(existing.dateObservedAt)));
      const isExactIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(date.trim());
      const upgradeExact = isExactIso &&
        (existing.date !== date || !existing.dateObservedAt || !Number.isFinite(Date.parse(existing.dateObservedAt)));
      let updated = (!existing.date || upgradeDay || upgradeExact) && date && scan.source_checked_at
        ? {...existing, date, dateObservedAt:scan.source_checked_at, publicationDateRaw, publicationDatePrecision} : existing;
      if (streamResolverUrl && (!existing.streamResolverUrl || existing.photos?.some(url => url !== streamResolverUrl)
          || existing.photoItems?.some(item => item.url !== streamResolverUrl))) {
        // Repair missing cached transport without interrupting a usable player.
        updated = {...updated,streamResolverUrl,videoUrl:existing.videoUrl || streamResolverUrl,
          photos:[streamResolverUrl],photoItems:existing.photoItems?.map(item => ({...item,url:streamResolverUrl}))};
      }
      const nextName = creator.name || updated.creatorName;
      const nextAvatar = creator.avatar || updated.creatorAvatar;
      const nextHandle = resolvedHandle || sanitizeCreatorHandle(updated.creatorHandle);
      if (
        (nextHandle && updated.creatorHandle !== nextHandle) ||
        (!sanitizeCreatorHandle(updated.creatorHandle) && updated.creatorHandle !== nextHandle) ||
        (nextName && updated.creatorName !== nextName) ||
        (nextAvatar && updated.creatorAvatar !== nextAvatar)
      ) {
        updated = { ...updated, creatorHandle: nextHandle, creatorName: nextName, creatorAvatar: nextAvatar };
      }
      if (!retained.has(existing)) result.push(updated);
      retained.add(existing);
      return false;
    }
    return true;
  };

  const platform = (creator.site || 'generic') as string;

  // 1. Map canonical_videos
  for (const v of scan.canonical_videos || []) {
    const origUrl = (v.originalUrl || v.pageUrl || v.url || '').trim();
    if (!claimSource(origUrl, v.timeAgo || v.uploadedAt || '', v.publicationDateRaw, v.publicationDatePrecision)) continue;

    let ytId: string | undefined;
    if (origUrl.includes('youtube.com/watch') || origUrl.includes('youtu.be/')) {
      const m = origUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/) || origUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
      if (m) ytId = m[1];
    }

    const streamUrl = buildTimelineStreamUrl(v.streamUrl || origUrl, origUrl, undefined, ytId);
    result.push({
      id: hintedId(origUrl) || `disc-vid-${creator.id}-${v.id || encodeURIComponent(origUrl)}`,
      creatorId: creator.id,
      creatorName: creator.name,
      creatorHandle: resolvedHandle,
      creatorAvatar: creator.avatar,
      creatorVerified: creator.verified,
      type: 'video',
      source: platform,
      youtubeId: ytId,
      videoUrl: streamUrl,
      originalUrl: origUrl || undefined,
      previewVideoUrl: v.previewVideoUrl || v.previewClip || undefined,
      thumbnail: v.thumbnailUrl || creator.avatar,
      title: v.title || creator.name,
      duration: v.duration || undefined,
      views: v.views || v.subtitle || undefined,
      resolution: v.resolution || undefined,
      comments: [],
      likes: typeof v.likes === 'number' ? v.likes : null,
      liked: false,
      favorited: false,
      saved: false,
      date: v.timeAgo || v.uploadedAt || '',
      dateObservedAt: scan.source_checked_at,
      publicationDateRaw: v.publicationDateRaw,
      publicationDatePrecision: v.publicationDatePrecision,
    });
  }

  // 2. Map canonical_albums
  for (const a of scan.canonical_albums || []) {
    const albUrl = (a.url || a.source_url || '').trim();
    const aliases = Array.isArray(a.source_aliases) ? a.source_aliases.filter((url: unknown): url is string => typeof url === 'string') : [];
    if (!claimSource(albUrl, a.updatedAt || a.lastAddedDate || '', undefined, undefined,
      aliases)) continue;

    // A grid cover stays small. The lightbox resolves originals on demand;
    // a creator avatar is not an album photograph.
    const cover = a.thumbnailUrl || a.cover_url || '';
    const count = typeof a.photoCount === 'number' && a.photoCount >= 0 ? a.photoCount : typeof a.reportedCount === 'number' && a.reportedCount >= 0 ? a.reportedCount : undefined;

    result.push({
      id: hintedId(albUrl,aliases) || `disc-alb-${creator.id}-${a.id || encodeURIComponent(albUrl)}`,
      creatorId: creator.id,
      creatorName: creator.name,
      creatorHandle: resolvedHandle,
      creatorAvatar: creator.avatar,
      creatorVerified: creator.verified,
      type: 'photo_grid',
      source: platform,
      sourcePage: a.sourcePage,
      sourceAssociation: a.sourceAssociation === 'profile_uploads' || a.sourceAssociation === 'profile_videos' ? a.sourceAssociation : undefined,
      originalUrl: albUrl || undefined,
      albumUrl: albUrl || undefined,
      thumbnail: cover,
      photos: cover ? [cover] : [],
      photoCount: count,
      title: a.title || creator.name,
      views: a.views || undefined,
      comments: [],
      likes: typeof a.likes === 'number' ? a.likes : null,
      liked: false,
      favorited: false,
      saved: false,
      date: a.updatedAt || a.lastAddedDate || '',
      dateObservedAt: scan.source_checked_at,
    });
  }

  // 3. Map canonical_gifs
  for (const g of scan.canonical_gifs || []) {
    const origUrl = (g.originalUrl || g.previewVideoUrl || g.url || '').trim();
    const streamResolverUrl = typeof g.streamResolverUrl === 'string' && isTimelineGifStreamUrl(g.streamResolverUrl) ? g.streamResolverUrl : undefined;
    if (!claimSource((g.url || g.pageUrl || origUrl).trim(), g.timeAgo || '',undefined,undefined,[],streamResolverUrl)) continue;

    const mediaPath = origUrl.split(/[?#]/,1)[0].toLowerCase();
    const isVideoClip = mediaPath.endsWith('.webm') || mediaPath.endsWith('.mp4');
    const pageUrl = (g.url || g.pageUrl || origUrl).trim();

    result.push({
      id: hintedId(pageUrl) || `disc-gif-${creator.id}-${g.id || encodeURIComponent(origUrl)}`,
      creatorId: creator.id,
      creatorName: creator.name,
      creatorHandle: resolvedHandle,
      creatorAvatar: creator.avatar,
      creatorVerified: creator.verified,
      type: 'gif',
      source: platform,
      sourcePage: g.sourcePage,
      sourceAssociation: g.sourceAssociation === 'profile_uploads' || g.sourceAssociation === 'profile_videos' ? g.sourceAssociation : undefined,
      videoUrl: streamResolverUrl || (isVideoClip ? buildTimelineStreamUrl(origUrl, pageUrl) : undefined),
      streamResolverUrl,
      originalUrl: pageUrl || origUrl,
      previewVideoUrl: g.previewVideoUrl || g.previewClip || (isVideoClip ? origUrl : undefined),
      thumbnail: g.thumbnailUrl || '',
      photos: [streamResolverUrl || origUrl || g.thumbnailUrl || creator.avatar],
      photoItems: [
        {
          id: g.id,
          url: streamResolverUrl || origUrl || g.thumbnailUrl || creator.avatar,
          thumbnailUrl: g.thumbnailUrl || undefined,
          pageUrl: pageUrl,
          sourcePage: g.sourcePage || creator.profileUrl,
          format: g.format || (isVideoClip ? 'webm' : 'gif'),
          isAnimated: true,
          isResolvedOriginal: g.isResolvedOriginal === true,
        },
      ],
      photoCount: 1,
      title: g.title || `${creator.name} GIF`,
      resolution: g.resolution || 'GIF',
      comments: [],
      likes: typeof g.likes === 'number' ? g.likes : null,
      liked: false,
      favorited: false,
      saved: false,
      date: g.timeAgo || '',
      dateObservedAt: scan.source_checked_at,
    });
  }

  return [...result, ...creatorExisting.filter(post => !retained.has(post))];
}

/** An ordering estimate from source labels; never exposed as an exact upload date. */
export function timelinePublicationTime(post: TimelinePost): number | null {
  const DAYS_PER_WEEK = 7; // Calendar unit conversion, not a recency window.
  const raw = post.date?.trim();
  if (!raw) return null;
  const relative = raw.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relative) {
    if (!post.dateObservedAt) return null;
    const date = new Date(post.dateObservedAt);
    if (!Number.isFinite(date.getTime())) return null;
    const count = Number(relative[1]);
    if (!Number.isSafeInteger(count)) return null;
    switch (relative[2].toLowerCase()) {
      case 'second': date.setUTCSeconds(date.getUTCSeconds()-count); break;
      case 'minute': date.setUTCMinutes(date.getUTCMinutes()-count); break;
      case 'hour': date.setUTCHours(date.getUTCHours()-count); break;
      case 'day': date.setUTCDate(date.getUTCDate()-count); break;
      case 'week': date.setUTCDate(date.getUTCDate()-count*DAYS_PER_WEEK); break;
      case 'month': date.setUTCMonth(date.getUTCMonth()-count); break;
      case 'year': date.setUTCFullYear(date.getUTCFullYear()-count); break;
    }
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  }
  // Source date-only ISO and timezone-qualified ISO timestamps. Arbitrary labels
  // or browser-specific Date.parse formats cannot establish chronology.
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(raw)) return null;
  const date = new Date(raw);
  const calendar = raw.slice(0,10);
  const calendarDate = new Date(`${calendar}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0,10) !== calendar) return null;
  const observed = post.dateObservedAt ? Date.parse(post.dateObservedAt) : NaN;
  if (Number.isFinite(observed) && date.getTime() > observed) return null;
  return date.getTime();
}

/** Minimum staleness interval before automatic social-style timeline sync reruns. */
export const TIMELINE_AUTO_REFRESH_STALE_MS = 2 * 60 * 1000;
/** Periodic background refresh interval while user views the main Timeline feed. */
export const TIMELINE_BACKGROUND_POLL_MS = 5 * 60 * 1000;

/** Internal chronological tie-breaker from verified raw timestamps; never exposed as a clock label. */
export function publicationTieBreakTime(post: TimelinePost): number | null {
  const raw = post.publicationDateRaw?.trim();
  if (!raw) return null;
  const full = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!full) return null;
  const normalized = /[TZ+-]\d*$/.test(raw) && raw.includes('T')
    ? raw.replace(' ', 'T')
    : `${full[1]}T${full[2]}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortTimelinePostsByPublication(posts: TimelinePost[]): TimelinePost[] {
  const times = new Map(posts.map(post => [post, timelinePublicationTime(post)]));
  const ties = new Map(posts.map(post => [post, publicationTieBreakTime(post)]));
  return [...posts].sort((a,b) => {
    const left = times.get(a), right = times.get(b);
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    if (right !== left) return right - left;
    const leftTie = ties.get(a), rightTie = ties.get(b);
    if (leftTie != null && rightTie != null && rightTie !== leftTie) return rightTie - leftTie;
    return 0;
  });
}

export function hasKnownExactPublicationDate(post: TimelinePost): boolean {
  if (post.type !== 'video' || !post.originalUrl) return false;
  if (!post.dateObservedAt || !Number.isFinite(Date.parse(post.dateObservedAt))) return false;
  if (timelinePublicationTime(post) === null) return false;
  if (post.publicationDatePrecision === 'day') return true;
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/.test((post.date || '').trim());
}

export function findUndiscoveredCreatorIds(
  creators: Array<{ id: string }>,
  creatorRefreshedAt: Record<string, number | undefined>,
  isDiscoveringCreator: Record<string, boolean | undefined>,
  creatorRefreshErrors: Record<string, boolean | undefined>
): string[] {
  return creators
    .filter(c => !creatorRefreshedAt[c.id] && !isDiscoveringCreator[c.id] && !creatorRefreshErrors[c.id])
    .map(c => c.id);
}

export function shouldAutoRefreshTimeline(params: {
  active: boolean;
  inCreatorProfile: boolean;
  inWatchSession: boolean;
  isRefreshing: boolean;
  lastRefreshAt: number | null;
  now: number;
  staleMs?: number;
}): boolean {
  const { active, inCreatorProfile, inWatchSession, isRefreshing, lastRefreshAt, now, staleMs = TIMELINE_AUTO_REFRESH_STALE_MS } = params;
  if (!active || inCreatorProfile || inWatchSession || isRefreshing) return false;
  if (lastRefreshAt === null) return true;
  return now - lastRefreshAt >= staleMs;
}

/** Merge current state, retaining source order even when cards have no dates.
 * Other creators keep their slots; source-ordered posts reuse their objects/IDs.
 * Publication ordering is applied afterward and unknowns never gain fake dates.
 */
export function mergeRefreshedTimelinePosts(current: TimelinePost[], refreshed: TimelinePost[]): TimelinePost[] {
  const existingIds = new Set(current.map(post => post.id));
  const refreshedIds = new Set(refreshed.map(post => post.id));
  let next = 0;
  return sortTimelinePostsByPublication([
    ...refreshed.filter(post => !existingIds.has(post.id)),
    ...current,
  ].map(post => refreshedIds.has(post.id) ? refreshed[next++] : post));
}

const UNNAMED_CREATOR_LABELS = new Set([
  'unknown',
  'unknown creator',
  'criador desconhecido',
  'desconhecido',
  'user',
  'usuario',
  'usuário',
]);

const PROFILE_COLLECTION_SEGMENTS = new Set([
  'videos',
  'video',
  'photos',
  'photo',
  'albums',
  'album',
  'gifs',
  'gif',
  'playlists',
  'playlist',
  'shorts',
  'streams',
  'featured',
  'about',
  'community',
  'posts',
]);

const PROFILE_PREFIX_SEGMENTS = new Set([
  'pornstar',
  'pornstars',
  'model',
  'models',
  'users',
  'user',
  'channels',
  'channel',
  'creator',
  'creators',
  'c',
]);

export function sanitizeCreatorHandle(handle?: string | null): string {
  const raw = (handle || '').trim();
  if (!raw) return '';
  const body = raw.replace(/^@+/, '').trim();
  if (!body) return '';
  const lower = body.toLowerCase();
  if (
    lower.startsWith('profile|') ||
    lower.startsWith('site|') ||
    lower.startsWith('demo:') ||
    lower.includes('://') ||
    lower.startsWith('http:') ||
    lower.startsWith('https:') ||
    /[|/<>\s]/.test(body)
  ) {
    return '';
  }
  return `@${body}`;
}

function slugifyCreatorName(name?: string | null): string {
  const raw = (name || '').trim();
  if (!raw || UNNAMED_CREATOR_LABELS.has(raw.toLowerCase())) return '';
  const normalized = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '');
  if (!normalized || normalized.startsWith('profile')) return '';
  return `@${normalized}`;
}

function deriveHandleFromProfileUrl(profileUrl?: string | null): { handle: string; opaqueChannelId: boolean } {
  const raw = (profileUrl || '').trim();
  if (!raw || raw.startsWith('demo:') || !/^https?:\/\//i.test(raw)) {
    return { handle: '', opaqueChannelId: false };
  }
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname
      .split('/')
      .map((part) => {
        try {
          return decodeURIComponent(part).trim();
        } catch {
          return part.trim();
        }
      })
      .filter(Boolean);
    if (segments.length === 0) return { handle: '', opaqueChannelId: false };

    const atSegment = segments.find((seg) => seg.startsWith('@') && seg.length > 1);
    if (atSegment) {
      return { handle: sanitizeCreatorHandle(atSegment), opaqueChannelId: false };
    }

    const working = [...segments];
    while (working.length > 1 && PROFILE_COLLECTION_SEGMENTS.has(working[working.length - 1].toLowerCase())) {
      working.pop();
    }

    const isOpaqueYouTubeChannel =
      working.length >= 2 &&
      working[0].toLowerCase() === 'channel' &&
      /^UC[A-Za-z0-9_-]{18,}$/.test(working[1]);

    let candidate = '';
    for (let i = 0; i < working.length - 1; i++) {
      if (PROFILE_PREFIX_SEGMENTS.has(working[i].toLowerCase())) {
        candidate = working[i + 1];
        break;
      }
    }
    if (!candidate) {
      candidate = working[working.length - 1];
    }

    if (parsed.hostname.toLowerCase().includes('eporner')) {
      candidate = candidate.replace(/-(?:[0-9]{2,}|(?=[A-Za-z0-9]{4,12}$)(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]+)$/, '');
    }

    return {
      handle: sanitizeCreatorHandle(candidate),
      opaqueChannelId: isOpaqueYouTubeChannel,
    };
  } catch {
    return { handle: '', opaqueChannelId: false };
  }
}

export function resolveCreatorHandle(input: {
  handle?: string | null;
  name?: string | null;
  profileUrl?: string | null;
}): string {
  const cleanHandle = sanitizeCreatorHandle(input.handle);
  if (cleanHandle) return cleanHandle;

  const fromUrl = deriveHandleFromProfileUrl(input.profileUrl);
  const fromName = slugifyCreatorName(input.name);
  if (fromUrl.opaqueChannelId && fromName) return fromName;
  if (fromUrl.handle) return fromUrl.handle;
  return fromName;
}

export interface WatchFollowTargetInput {
  creatorUrl: string | null | undefined;
  creatorName: string | null | undefined;
  creatorAvatar: string | null | undefined;
  audienceCountText?: string | null;
  audienceKind?: 'subscribers' | 'followers' | null;
  normalizedIdentity?: string | null;
  existingCreators?: TimelineCreator[];
}

function normalizeComparableProfileUrl(rawUrl: string | null | undefined): string {
  return String(rawUrl || '').trim().replace(/\/+$/, '').toLowerCase();
}

export function buildWatchFollowTarget(input: WatchFollowTargetInput): TimelineCreator | null {
  const cleanUrl = String(input.creatorUrl || '').trim();
  if (!cleanUrl) return null;

  const targetNorm = normalizeComparableProfileUrl(cleanUrl);
  const existing = (input.existingCreators || []).find(
    (c) => normalizeComparableProfileUrl(c.profileUrl) === targetNorm
  );
  const cleanName = String(input.creatorName || '').trim() || existing?.name || 'Creator';
  const audienceStats = input.audienceCountText
    ? input.audienceKind === 'followers'
      ? { followers: input.audienceCountText }
      : { subscribers: input.audienceCountText }
    : {};

  if (existing) {
    return {
      ...existing,
      name: existing.name || cleanName,
      avatar: existing.avatar || String(input.creatorAvatar || '').trim(),
      handle: existing.handle || resolveCreatorHandle({ name: cleanName, profileUrl: cleanUrl }),
      stats: { ...audienceStats, ...existing.stats },
    };
  }

  return {
    id: String(input.normalizedIdentity || '').trim() || cleanUrl,
    name: cleanName,
    handle: resolveCreatorHandle({ name: cleanName, profileUrl: cleanUrl }),
    avatar: String(input.creatorAvatar || '').trim(),
    profileUrl: cleanUrl,
    verified: false,
    stats: audienceStats,
  };
}

export type PlayErrorAction = 'ignore' | 'autoplay_blocked' | 'fatal';

/**
 * Classifies an HTMLVideoElement.play() rejection so mobile/autoplay policy blocks
 * pause cleanly with controls rather than wiping the stream into a fatal error screen.
 */
export function classifyPlayError(error: unknown): PlayErrorAction {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name || '')
      : error instanceof Error
        ? error.name
        : '';
  if (name === 'AbortError') return 'ignore';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'autoplay_blocked';
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (!name && (msg.includes('notallowed') || msg.includes("didn't interact") || msg.includes('user gesture'))) {
    return 'autoplay_blocked';
  }
  return 'fatal';
}

/**
 * Returns true once when a watch metadata/related request fails with a transient
 * transport or server status (408/429/5xx) and has not yet retried.
 */
export function shouldRetryTransientWatchFetch(error: unknown, alreadyRetried: boolean): boolean {
  if (alreadyRetried) return false;
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name || '')
      : error instanceof Error
        ? error.name
        : '';
  if (name === 'AbortError') return false;
  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (/Invalid (watch|related|comments) source|source mismatch/i.test(msg)) return false;
  const httpMatch = msg.match(/\bHTTP\s+(\d{3})\b/i);
  if (httpMatch) {
    const code = Number(httpMatch[1]);
    return code === 408 || code === 429 || (code >= 500 && code < 600);
  }
  return /failed to fetch|networkerror|load failed|timed out|timeout|econn/i.test(msg);
}

export interface StreamFallbackCandidate {
  streamUrl: string;
  masterHls?: string;
}

/**
 * Selects the next untried playable candidate when the active stream fails on a device
 * (e.g. AV1 unsupported on mobile Chrome, broken CDN node, or failing HLS manifest).
 */
export function pickFallbackStreamCandidate(options: {
  activeStreamUrl?: string;
  qualities: TimelineVideoQuality[];
  masterHlsUrl?: string;
  selectedQuality: number | 'auto';
  failedUrls: Set<string>;
}): StreamFallbackCandidate | null {
  const { activeStreamUrl, qualities, masterHlsUrl, selectedQuality, failedUrls } = options;
  const seen = new Set<string>(failedUrls);
  if (activeStreamUrl) seen.add(activeStreamUrl);

  const ordered: TimelineVideoQuality[] = [];
  const cap720: TimelineVideoQuality[] = [];
  const higher: TimelineVideoQuality[] = [];
  for (const q of qualities) {
    if (!q?.streamUrl || seen.has(q.streamUrl)) continue;
    if (q.height <= 720) cap720.push(q);
    else higher.push(q);
  }
  cap720.sort((a, b) => b.height - a.height);
  higher.sort((a, b) => b.height - a.height);

  if (selectedQuality === 'auto' && masterHlsUrl && !seen.has(masterHlsUrl)) {
    return { streamUrl: masterHlsUrl, masterHls: masterHlsUrl };
  }
  ordered.push(...cap720, ...higher);
  for (const candidate of ordered) {
    if (!seen.has(candidate.streamUrl)) {
      return {
        streamUrl: candidate.streamUrl,
        masterHls: isHlsStreamUrl(candidate.streamUrl) ? candidate.streamUrl : undefined,
      };
    }
  }
  if (masterHlsUrl && !seen.has(masterHlsUrl)) {
    return { streamUrl: masterHlsUrl, masterHls: masterHlsUrl };
  }
  return null;
}

const KNOWN_TIMELINE_PLATFORMS: ReadonlySet<TimelinePlatform> = new Set([
  'eporner',
  'youtube',
  'pornhub',
  'xhamster',
]);

export function resolveTimelinePlatform(
  profileUrl?: string,
  explicitSite?: string
): TimelinePlatform | undefined {
  const normalizedSite = (explicitSite || '').trim().toLowerCase() as TimelinePlatform;
  if (KNOWN_TIMELINE_PLATFORMS.has(normalizedSite)) {
    return normalizedSite;
  }
  if (profileUrl) {
    try {
      const host = new URL(profileUrl).hostname.toLowerCase();
      if (host === 'youtu.be' || /(?:^|\.)youtube\./.test(host)) return 'youtube';
      if (/(?:^|\.)eporner\./.test(host)) return 'eporner';
      if (/(?:^|\.)pornhub\./.test(host)) return 'pornhub';
      if (/(?:^|\.)xhamster\./.test(host)) return 'xhamster';
    } catch {
      // Malformed profile URLs keep fallback resolution below.
    }
  }
  if (normalizedSite === 'generic') return 'generic';
  return undefined;
}

function readStatCount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
  }
  return undefined;
}

function readStatText(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? String(value) : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function lookupBioStat(
  bioDetails: Record<string, string> | null | undefined,
  candidates: readonly string[]
): string | undefined {
  if (!bioDetails || typeof bioDetails !== 'object') return undefined;
  for (const [rawKey, rawValue] of Object.entries(bioDetails)) {
    const key = rawKey.trim().toLowerCase();
    if (candidates.includes(key)) {
      const text = readStatText(rawValue);
      if (text !== undefined) return text;
    }
  }
  return undefined;
}

/**
 * Merges real source-reported hero statistics onto previous creator stats
 * without fabricating missing values or letting unknown nulls erase known totals.
 */
export function mergeTimelineCreatorStats(
  previous?: TimelineCreatorStats | null,
  incoming?: Record<string, unknown> | null,
  bioDetails?: Record<string, string> | null
): TimelineCreatorStats {
  const next: TimelineCreatorStats = previous ? { ...previous } : {};
  const source = incoming && typeof incoming === 'object' ? incoming : null;

  for (const key of ['videos', 'posts', 'albums', 'gifs'] as const) {
    const parsed = source ? readStatCount(source[key]) : undefined;
    if (parsed !== undefined) {
      next[key] = parsed;
    }
  }

  for (const key of ['likes', 'subscribers', 'followers', 'views'] as const) {
    const parsed = source ? readStatText(source[key]) : undefined;
    if (parsed !== undefined) {
      next[key] = parsed;
    }
  }

  if (next.subscribers === undefined) {
    const bioSubscribers = lookupBioStat(bioDetails, ['subscribers', 'subscriber', 'inscritos']);
    if (bioSubscribers !== undefined) next.subscribers = bioSubscribers;
  }
  if (next.followers === undefined) {
    const bioFollowers = lookupBioStat(bioDetails, ['followers', 'follower', 'seguidores']);
    if (bioFollowers !== undefined) next.followers = bioFollowers;
  }
  if (next.views === undefined) {
    const bioViews = lookupBioStat(bioDetails, ['video views', 'views', 'visualizações', 'visualizacoes']);
    if (bioViews !== undefined) next.views = bioViews;
  }
  if (next.likes === undefined) {
    const bioLikes = lookupBioStat(bioDetails, ['likes', 'curtidas']);
    if (bioLikes !== undefined) next.likes = bioLikes;
  }

  return next;
}
