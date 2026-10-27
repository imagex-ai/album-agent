import type { Album, ImageItem } from '../types';
import { getDuplicateSourceKey } from './duplicateSource';
import { isVideoMedia, unwrapMediaSource } from './mediaClassification';

export type CleanupReason = 'vector' | 'icon' | 'logo' | 'interface' | 'repeatedSmall';

export interface CleanupEntry {
  image: ImageItem;
  albumId: string;
  albumTitle: string;
}

export interface CleanupGroup {
  sourceKey: string;
  sourceLabel: string;
  reason: CleanupReason;
  entries: CleanupEntry[];
  albumCount: number;
  thumbnailMismatchCount: number;
}

export const getCleanupEntryKey = (entry: CleanupEntry): string => {
  const image = entry.image;
  const reference = image.backendImageRef;
  const durable = reference?.id ? ['id', reference.id]
    : reference?.candidate_id || image.candidateId ? ['candidate', reference?.candidate_id || image.candidateId]
    : ['position', reference?.index ?? image.id];
  return JSON.stringify([
    entry.albumId, durable,
    getDuplicateSourceKey(reference?.original_url || image.rawOriginalUrl || image.originalUrl || ''),
    getDuplicateSourceKey(reference?.thumbnail_url || image.rawThumbnailUrl || image.thumbnailUrl || '')
  ]);
};

/** Ignore reference churn, but detect edits that would make a scan result stale. */
export const getCleanupAlbumFingerprint = (album: Album): string => JSON.stringify([
  album.title, album.updatedAt, album.folder, album.sourceUrl, album.isFavorite,
  album.imageCount, album.totalSizeBytes, album.coverImage, [...(album.tags || [])].sort(),
  (album.images || []).map(image => [
    getCleanupEntryKey({ albumId: album.id, albumTitle: album.title, image }), image.id,
    image.title, image.width, image.height, image.fileSizeBytes, image.format,
    image.mediaType, image.isAnimated, image.animationChecked, image.isFavorite
  ])
]);

export const mergeCleanupScanAlbums = (
  starting: ReadonlyMap<string, string>, current: Album[], loaded: Album[]
): Album[] => {
  const currentById = new Map(current.map(album => [album.id, album]));
  const loadedIds = new Set(loaded.map(album => album.id));
  const merged: Album[] = [];
  for (const scanned of loaded) {
    const latest = currentById.get(scanned.id);
    if (starting.has(scanned.id) && !latest) continue; // Locally deleted while scanning.
    const changed = latest && (!starting.has(latest.id) || starting.get(latest.id) !== getCleanupAlbumFingerprint(latest));
    merged.push(changed ? latest : scanned);
  }
  current.forEach(latest => {
    if (!loadedIds.has(latest.id) && (!starting.has(latest.id) || starting.get(latest.id) !== getCleanupAlbumFingerprint(latest))) merged.push(latest);
  });
  return merged;
};

/** Metadata-only suggestions. A candidate is never permission to delete its occurrences. */
export const buildCleanupGroups = (albums: Album[], reviewedReasons?: ReadonlyMap<string, CleanupReason>): CleanupGroup[] => {
  const bySource = new Map<string, CleanupEntry[]>();
  const seenInSource = new Set<string>();

  for (const album of albums) {
    for (const image of album.images || []) {
      if (isVideoMedia(image)) continue;
      const rawUrl = image.rawOriginalUrl || image.originalUrl || '';
      const sourceKey = getDuplicateSourceKey(rawUrl);
      if (!sourceKey) continue;

      const dedupeKey = album.id + '\0' + (image.backendImageRef?.id || image.candidateId || image.id || rawUrl);
      const combined = sourceKey + '\0' + dedupeKey;
      if (seenInSource.has(combined)) continue;
      seenInSource.add(combined);

      let entries = bySource.get(sourceKey);
      if (!entries) {
        entries = [];
        bySource.set(sourceKey, entries);
      }
      entries.push({ image, albumId: album.id, albumTitle: album.title });
    }
  }

  const result: CleanupGroup[] = [];
  const keywordQuickCheck = /(?:svg|ico|favicon|icons?|logos?|sprite|loading|spinner|spacer|placeholder|header)/i;

  for (const [sourceKey, entries] of bySource) {
    const rawUrl = entries[0].image.rawOriginalUrl || entries[0].image.originalUrl || '';
    const hasReviewedReason = Boolean(reviewedReasons?.has(sourceKey));
    const isCandidateKeyword = keywordQuickCheck.test(rawUrl);
    if (!isCandidateKeyword && !hasReviewedReason && entries.length < 5) continue;

    const source = unwrapMediaSource(rawUrl);
    let pathname = '';
    try {
      pathname = decodeURIComponent(new URL(source, 'https://imagex.local').pathname).toLowerCase();
    } catch { continue; }
    const filename = pathname.split('/').pop() || '';
    const albumCount = new Set(entries.map(entry => entry.albumId)).size;
    let reason: CleanupReason | undefined;
    if (/^data:image\/svg\+xml[;,]/i.test(source) || /\.svg$/i.test(pathname)) reason = 'vector';
    else if (/\.ico$/i.test(pathname) || /(?:^|[\/_. -])(?:favicon|icons?)(?:[\/_. -]|$)/i.test(pathname)) reason = 'icon';
    else if (/(?:^|[\/_. -])logos?(?:[\/_. -]|$)/i.test(pathname)) reason = 'logo';
    else if (/(?:^|[\/_. -])(?:sprite|loading|spinner|spacer|placeholder|header)(?:[\/_. -]|$)/i.test(pathname)) reason = 'interface';
    else if (albumCount >= 5 && entries.every(({ image }) => (
      image.width > 0 && image.width <= 512 && image.height > 0 && image.height <= 512
      && image.fileSizeBytes > 0 && image.fileSizeBytes <= 64 * 1024
    ))) reason = 'repeatedSmall';
    reason = reason || reviewedReasons?.get(sourceKey);
    if (!reason) continue;
    result.push({
      sourceKey,
      sourceLabel: /^data:/i.test(source) ? 'SVG' : filename || pathname,
      reason,
      entries,
      albumCount,
      thumbnailMismatchCount: entries.filter(({ image }) => {
        const thumbnail = getDuplicateSourceKey(image.rawThumbnailUrl || image.thumbnailUrl || '');
        return Boolean(thumbnail && thumbnail !== sourceKey);
      }).length
    });
  }
  return result.sort((a, b) => b.entries.length - a.entries.length || a.sourceKey.localeCompare(b.sourceKey));
};
