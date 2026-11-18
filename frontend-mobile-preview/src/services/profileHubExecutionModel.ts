import { getGlobalProfileSelection, type ProfileHubSession } from '../store/useProfileHubStore';
import { validGalleryDestination, validVideoDestination } from './destinationValidation';
import type { ConfirmExecutionRequest, ExecutionBatch, ExecutionMedia, ExecutionProfile, ExecutionState } from './profileHubExecutionApi';

export function executionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function executionHttps(value: string | undefined): string {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || /[\x00-\x20\\]/.test(value!)) throw new Error();
    return value!;
  } catch { throw new Error('selected_original_missing'); }
}
export function buildExecutionRequest(profiles: Record<string, ProfileHubSession>, id: string): ConfirmExecutionRequest {
  const selection = getGlobalProfileSelection(profiles, false);
  if (!selection.count) throw new Error('empty_selection');
  const result: ExecutionProfile[] = selection.groups.map(group => {
    const session = profiles[group.profileKey];
    const items: ExecutionMedia[] = [];
    for (const video of group.videos) items.push({ id: video.id, kind: 'video', url: executionHttps(video.originalUrl), title: video.title, duration: video.duration });
    for (const list of group.playlists) items.push({ id: list.id, kind: 'playlist', url: executionHttps(list.url), title: list.title });
    for (const album of group.albums) items.push({ id: album.id, kind: 'album', url: executionHttps(album.url), title: album.title });
    for (const photo of group.photos) {
      const collection = session.albums.find(album => album.id === photo.collectionId);
      items.push({ id: photo.id, kind: photo.type === 'gif' ? 'gif' : 'photo', url: executionHttps(photo.originalUrl), title: photo.title,
        ...(collection?.url ? { collection_url: executionHttps(collection.url) } : {}) });
    }
    const video = items.some(item => item.kind === 'video' || item.kind === 'playlist');
    const gallery = items.some(item => !['video', 'playlist'].includes(item.kind));
    if (video && (!validVideoDestination(group.destinations.videoFolder) || !group.destinations.videoMode)) throw new Error('video_destination_required');
    if (gallery && !validGalleryDestination(group.destinations.galleryFolder)) throw new Error('gallery_destination_required');
    return { profile_key: group.profileKey, profile_url: executionHttps(group.sourceProfileUrl), profile_name: group.profile.name,
      video_folder: video ? group.destinations.videoFolder : null, gallery_folder: gallery ? group.destinations.galleryFolder : null,
      video_mode: video ? group.destinations.videoMode : null, items };
  });
  return { request_id: id, confirmed: true, profiles: result };
}
export const failedExecutionState = (state: ExecutionState) => state === 'failed' || state === 'interrupted';
export function retryTargets(batch: ExecutionBatch, rootId?: string): string[] {
  const roots = rootId ? batch.operations.filter(operation => operation.id === rootId) : batch.operations;
  const units = new Map(batch.units.map(unit => [unit.id, unit]));
  return [...new Set(roots.flatMap(root => !root.resolved && failedExecutionState(root.status) ? [root.id]
    : root.unit_ids.filter(id => units.has(id) && failedExecutionState(units.get(id)!.status))))];
}
