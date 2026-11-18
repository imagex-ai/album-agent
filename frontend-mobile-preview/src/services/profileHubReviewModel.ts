import type { ProfileHubSession } from '../store/useProfileHubStore';
import type { AlbumItem, MediaItemCard, PlaylistItem } from '../components/profile-hub/profileHubTypes';
import { validGalleryDestination, validVideoDestination } from './destinationValidation';

export type ReviewKind = 'video' | 'playlist' | 'album' | 'photo' | 'gif';
export type ReviewEntry = { key: string; profileKey: string } & (
  | { kind: 'video' | 'photo' | 'gif'; item: MediaItemCard }
  | { kind: 'album'; item: AlbumItem }
  | { kind: 'playlist'; item: PlaylistItem }
);
export const reviewEntryKey = (profileKey: string, kind: ReviewKind, id: string) => JSON.stringify([profileKey, kind, id]);

/** Suppress a child only when this session proves its selected collection membership. */
export function coveringReviewCollection(session: ProfileHubSession, kind: ReviewKind, item: MediaItemCard | AlbumItem | PlaylistItem): string | null {
  if (kind === 'video') {
    const video = item as MediaItemCard;
    const playlist = Object.values(session.selectedPlaylists).find(list => video.collectionId === list.id
      || session.playlistVideosMap[list.id]?.some(member => member.id === video.id));
    return playlist ? playlist.title || playlist.id : null;
  }
  if (kind === 'photo' || kind === 'gif') {
    const photo = item as MediaItemCard;
    return photo.collectionId && session.selectedAlbums[photo.collectionId]
      ? session.selectedAlbums[photo.collectionId].title || session.selectedAlbums[photo.collectionId].id : null;
  }
  return null;
}

export function isReviewEntrySelected(session: ProfileHubSession, entry: ReviewEntry): boolean {
  switch (entry.kind) {
    case 'video': return Boolean(session.selectedVideos[entry.item.id]);
    case 'playlist': return Boolean(session.selectedPlaylists[entry.item.id]);
    case 'album': return Boolean(session.selectedAlbums[entry.item.id]);
    default: return Boolean(session.selectedAlbumPhotos[entry.item.id]);
  }
}

export function changeReviewSelection(session: ProfileHubSession, entry: ReviewEntry, selected: boolean): ProfileHubSession {
  const field = entry.kind === 'video' ? 'selectedVideos' : entry.kind === 'playlist' ? 'selectedPlaylists'
    : entry.kind === 'album' ? 'selectedAlbums' : 'selectedAlbumPhotos';
  // Entry kind is the discriminator for the field. Never use the currently active profile.
  const values = { ...session[field] } as Record<string, ReviewEntry['item']>;
  if (selected) values[entry.item.id] = values[entry.item.id] ?? entry.item;
  else delete values[entry.item.id];
  return { ...session, [field]: values } as ProfileHubSession;
}

export function collectReviewEntries(profiles: Record<string, ProfileHubSession>, previous: Record<string, ReviewEntry> = {}): Record<string, ReviewEntry> {
  const entries = Object.fromEntries(Object.entries(previous).filter(([, entry]) => profiles[entry.profileKey] && !profiles[entry.profileKey].demoMode));
  for (const [profileKey, session] of Object.entries(profiles)) {
    if (session.demoMode) continue;
    const add = (kind: ReviewKind, item: ReviewEntry['item']) => {
      const key = reviewEntryKey(profileKey, kind, item.id);
      entries[key] = { key, profileKey, kind, item } as ReviewEntry;
    };
    Object.values(session.selectedVideos).forEach(item => add('video', item));
    Object.values(session.selectedPlaylists).forEach(item => add('playlist', item));
    Object.values(session.selectedAlbums).forEach(item => add('album', item));
    Object.values(session.selectedAlbumPhotos).forEach(item => add(item.type === 'gif' ? 'gif' : 'photo', item));
  }
  return entries;
}

export function getReviewGroups(profiles: Record<string, ProfileHubSession>, entries: Record<string, ReviewEntry>) {
  return Object.entries(profiles).filter(([, session]) => !session.demoMode).map(([profileKey, session]) => {
    const rows = Object.values(entries).filter(entry => entry.profileKey === profileKey).map(entry => ({
      ...entry, selected: isReviewEntrySelected(session, entry), coveredBy: coveringReviewCollection(session, entry.kind, entry.item),
    }));
    const selected = rows.filter(row => row.selected && row.coveredBy === null);
    const videos = rows.filter(row => row.kind === 'video' || row.kind === 'playlist');
    const gallery = rows.filter(row => row.kind !== 'video' && row.kind !== 'playlist');
    return { profileKey, session, rows, selected, videos, gallery };
  }).filter(group => group.rows.length > 0);
}

export function reviewDestinationIssues(session: ProfileHubSession, kinds: ReviewKind[]) {
  const video = kinds.some(kind => kind === 'video' || kind === 'playlist');
  const gallery = kinds.some(kind => kind === 'album' || kind === 'photo' || kind === 'gif');
  return { videoFolder: video && !validVideoDestination(session.destinations.videoFolder),
    galleryFolder: gallery && !validGalleryDestination(session.destinations.galleryFolder),
    videoMode: video && !session.destinations.videoMode };
}
