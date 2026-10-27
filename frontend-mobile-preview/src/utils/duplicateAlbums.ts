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
  const add = (map: Map<string, Album[]>, key: string, album: Album) => {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(album);
  };

  for (const album of albums) {
    const source = album.sourceUrl || album.sourcePage || '';
    if (/^https?:\/\//i.test(source)) {
      const key = getDuplicateSourceKey(source);
      if (key) add(sources, key, album);
    }
    const images = album.images || [];
    if (!images.length || album.imageCount !== images.length) continue;
    const keys: string[] = [];
    let hasInvalid = false;
    for (const image of images) {
      const k = getDuplicateSourceKey(image.rawOriginalUrl || image.originalUrl || '');
      if (!k) {
        hasInvalid = true;
        break;
      }
      keys.push(k);
    }
    if (hasInvalid) continue;
    keys.sort();
    add(contents, keys.join('\0'), album);
    distinctSources.set(album.id, new Set(keys));
  }

  const results: DuplicateAlbumGroup[] = [];
  const exactMemberships = new Set<string>();
  const existingPairSet = new Set<string>();

  contents.forEach((items, key) => {
    if (items.length < 2) return;
    results.push({ id: `items:${key}`, reason: 'sameItems', albums: items });
    const ids = items.map(item => item.id).sort();
    exactMemberships.add(ids.join('\0'));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        existingPairSet.add(ids[i] + '|' + ids[j]);
      }
    }
  });

  sources.forEach((items, key) => {
    if (items.length < 2) return;
    const ids = items.map(item => item.id).sort();
    if (exactMemberships.has(ids.join('\0'))) return;
    results.push({ id: `source:${key}`, reason: 'sameSource', albums: items });
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        existingPairSet.add(ids[i] + '|' + ids[j]);
      }
    }
  });

  // A pair must share at least three distinct addresses and 80% of each album.
  // Common addresses repeated in many albums provide weak evidence and are excluded.
  const occurrences = new Map<string, string[]>();
  distinctSources.forEach((keys, id) => {
    for (const key of keys) {
      let list = occurrences.get(key);
      if (!list) {
        list = [];
        occurrences.set(key, list);
      }
      list.push(id);
    }
  });

  const useful = new Map<string, Set<string>>();
  distinctSources.forEach((keys, id) => {
    const usefulSet = new Set<string>();
    for (const key of keys) {
      if ((occurrences.get(key)?.length || 0) <= 10) usefulSet.add(key);
    }
    useful.set(id, usefulSet);
  });

  const pairCounts = new Map<string, number>();
  occurrences.forEach(ids => {
    if (ids.length > 10) return;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const idA = ids[i];
        const idB = ids[j];
        const key = idA < idB ? idA + '|' + idB : idB + '|' + idA;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  });

  const albumById = new Map(albums.map(album => [album.id, album]));
  pairCounts.forEach((count, key) => {
    const pipeIdx = key.indexOf('|');
    const id0 = key.substring(0, pipeIdx);
    const id1 = key.substring(pipeIdx + 1);
    const first = albumById.get(id0);
    const second = albumById.get(id1);
    if (!first || !second || count < 3 || count / (useful.get(id0)?.size || Infinity) < 0.8 || count / (useful.get(id1)?.size || Infinity) < 0.8) return;
    if (existingPairSet.has(key)) return;
    results.push({ id: `similar:${key}`, reason: 'similarItems', albums: [first, second] });
    existingPairSet.add(key);
  });

  return results;
}
