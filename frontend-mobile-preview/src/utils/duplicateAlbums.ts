import { Album } from '../types';
import { getDuplicateSourceKey } from './duplicateSource';

export interface DuplicateAlbumGroup {
  id: string;
  reason: 'sameSource' | 'sameItems' | 'similarItems';
  albums: Album[];
}

/** Suggestions based on metadata; URLs do not prove identical file content. */
export function buildDuplicateAlbumGroups(albums: Album[]): DuplicateAlbumGroup[] {
  const sources = new Map<string, Album[]>();
  const contents = new Map<string, Album[]>();
  const distinctSources = new Map<string, Set<string>>();
  const add = (map: Map<string, Album[]>, key: string, album: Album) => map.set(key, [...(map.get(key) || []), album]);
  for (const album of albums) {
    const source = album.sourceUrl || album.sourcePage || '';
    if (/^https?:\/\//i.test(source)) {
      const key = getDuplicateSourceKey(source);
      if (key) add(sources, key, album);
    }
    const images = album.images || [];
    if (!images.length || album.imageCount !== images.length) continue;
    const keys = images.map(image => getDuplicateSourceKey(image.rawOriginalUrl || image.originalUrl || ''));
    if (keys.some(key => !key)) continue;
    add(contents, JSON.stringify(keys.sort()), album);
    distinctSources.set(album.id, new Set(keys as string[]));
  }
  const results: DuplicateAlbumGroup[] = [];
  const exactMemberships = new Set<string>();
  contents.forEach((items, key) => {
    if (items.length < 2) return;
    results.push({ id: `items:${key}`, reason: 'sameItems', albums: items });
    exactMemberships.add(JSON.stringify(items.map(item => item.id).sort()));
  });
  sources.forEach((items, key) => {
    if (items.length < 2 || exactMemberships.has(JSON.stringify(items.map(item => item.id).sort()))) return;
    results.push({ id: `source:${key}`, reason: 'sameSource', albums: items });
  });

  // A pair must share at least three distinct addresses and 80% of each album.
  // Common addresses repeated in many albums provide weak evidence and are excluded.
  const occurrences = new Map<string, string[]>();
  distinctSources.forEach((keys, id) => keys.forEach(key => occurrences.set(key, [...(occurrences.get(key) || []), id])));
  const useful = new Map<string, Set<string>>();
  distinctSources.forEach((keys, id) => useful.set(id, new Set([...keys].filter(key => (occurrences.get(key)?.length || 0) <= 10))));
  const pairCounts = new Map<string, number>();
  occurrences.forEach(ids => {
    if (ids.length > 10) return;
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
      const key = JSON.stringify([ids[i], ids[j]].sort());
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  });
  const albumById = new Map(albums.map(album => [album.id, album]));
  pairCounts.forEach((count, key) => {
    const ids: string[] = JSON.parse(key);
    const first = albumById.get(ids[0]);
    const second = albumById.get(ids[1]);
    if (!first || !second || count < 3 || count / (useful.get(ids[0])?.size || Infinity) < 0.8 || count / (useful.get(ids[1])?.size || Infinity) < 0.8) return;
    if (results.some(group => group.albums.some(album => album.id === ids[0]) && group.albums.some(album => album.id === ids[1]))) return;
    results.push({ id: `similar:${key}`, reason: 'similarItems', albums: [first, second] });
  });
  return results;
}
