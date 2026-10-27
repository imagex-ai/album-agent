import { VideoItem } from '../types';
import { getDuplicateSourceKey } from './duplicateSource';

/** A shared source page is a suggestion, not proof of the same video. */
export function buildVideoSourceGroups(videos: VideoItem[]): { id: string; videoIds: string[]; reason: 'sameSource' }[] {
  const groups = new Map<string, string[]>();
  for (const video of videos) {
    const source = video.sourceUrl || video.url || video.cloudUrl || '';
    if (!/^https?:\/\//i.test(source)) continue;
    const key = getDuplicateSourceKey(source);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), video.id]);
  }
  return Array.from(groups, ([id, videoIds]) => ({ id, videoIds, reason: 'sameSource' as const }))
    .filter(group => group.videoIds.length > 1);
}
