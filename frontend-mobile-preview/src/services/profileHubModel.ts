/** Profile Hub data contracts. Discovery does not imply ownership or persistence. */
export type DiscoveryStatus = 'idle' | 'loading' | 'partial' | 'complete' | 'error';
export type ProfileMediaKind = 'video' | 'photo' | 'gif';

export interface ProfileSection<T> {
  status: DiscoveryStatus;
  items: T[];
  loadedCount: number;
  reportedCount?: number;
  hasMore?: boolean;
  cursor?: string;
  error?: string;
  absenceConfirmed?: boolean;
}

export interface ProfileMedia {
  key: string;
  kind: ProfileMediaKind;
  sourceUrl: string;
  title?: string;
  thumbnailUrl?: string;
  collectionKeys: string[];
  provenance: { pageUrl: string; evidence?: string; isPrimary?: boolean };
}

export interface ProfileCollection {
  key: string;
  kind: 'playlist' | 'album';
  sourceUrl: string;
  title: string;
  coverUrl?: string;
  media: ProfileSection<ProfileMedia>;
}

export type ProfileHighlight =
  | { kind: 'video' | 'photo' | 'gif'; mediaKey: string; evidence: string }
  | { kind: 'playlist' | 'album'; collectionKey: string; evidence: string };

export interface ProfileMediaManifest {
  profileKey: string;
  sourceUrl: string;
  name?: string;
  avatarUrl?: string;
  coverUrl?: string;
  description?: string;
  highlights: ProfileSection<ProfileHighlight>;
  playlists: ProfileSection<ProfileCollection>;
  albums: ProfileSection<ProfileCollection>;
  videos: ProfileSection<ProfileMedia>;
  gifs: ProfileSection<ProfileMedia>;
}

export type CollectionSelection =
  | { mode: 'all'; collectionKey: string; resolution: 'partial' | 'ready' | 'error'; mediaKeys: string[] }
  | { mode: 'subset'; collectionKey: string; mediaKeys: string[] };

export interface ProfileSelection {
  profileKey: string;
  individualMediaKeys: string[];
  collections: CollectionSelection[];
}

export type ProfileSelections = Record<string, ProfileSelection>;

/** Keep each profile's explicit choices independent of discovery updates. */
export function toggleProfileMedia(
  selections: ProfileSelections, profileKey: string, mediaKey: string
): ProfileSelections {
  if (!profileKey.trim() || !mediaKey.trim()) throw new Error('A profile and media identity are required');
  const current = selections[profileKey] ?? { profileKey, individualMediaKeys: [], collections: [] };
  const selected = current.individualMediaKeys.includes(mediaKey);
  return {
    ...selections,
    [profileKey]: {
      ...current,
      individualMediaKeys: selected
        ? current.individualMediaKeys.filter(key => key !== mediaKey)
        : [...current.individualMediaKeys, mediaKey],
    },
  };
}

/** Returns a unique explicit scope; unresolved collections must never be submitted. */
export function resolveSelection(selection: ProfileSelection): string[] {
  const result = new Set(selection.individualMediaKeys.filter(Boolean));
  for (const collection of selection.collections) {
    if (collection.mode === 'all' && collection.resolution !== 'ready') {
      throw new Error('Collection selection has not been fully resolved');
    }
    if (collection.mediaKeys.length === 0 || collection.mediaKeys.some(key => !key.trim())) {
      throw new Error('A collection selection must contain explicit media identities');
    }
    collection.mediaKeys.forEach(key => result.add(key));
  }
  if (!result.size) throw new Error('No media selected');
  return [...result];
}

/** Validate the exact subset before calling an endpoint that treats [] as all. */
export function validateAlbumSubset(selectedUrls: string[], availableUrls: string[]): string[] {
  const selected = [...new Set(selectedUrls.map(url => url.trim()).filter(Boolean))];
  const available = new Set(availableUrls.map(url => url.trim()).filter(Boolean));
  if (!selected.length || selected.length !== new Set(selectedUrls.map(url => url.trim())).size ||
      selected.some(url => !available.has(url))) {
    throw new Error('Album selection is empty or does not match the current preview');
  }
  return selected;
}
