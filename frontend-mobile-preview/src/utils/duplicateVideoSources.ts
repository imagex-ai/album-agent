import { VideoItem } from '../types';
import { getDuplicateSourceKey } from './duplicateSource';

type SourceReason = 'sameMedia' | 'sameId' | 'sameSource';

/** These signals identify related addresses or IDs, not confirmed file contents. */
export function buildVideoSourceGroups(videos: VideoItem[]): { id: string; videoIds: string[]; reason: SourceReason }[] {
  const groups = new Map<string, { reason: SourceReason; videoIds: string[] }>();
  const add = (reason: SourceReason, value: string, id: string) => {
    const key = JSON.stringify([reason, value]);
    const group = groups.get(key) || { reason, videoIds: [] };
    if (!group.videoIds.includes(id)) group.videoIds.push(id);
    groups.set(key, group);
  };
  for (const video of videos) {
    const source = video.sourceUrl || video.url || '';
    if (/^https?:\/\//i.test(source)) {
      const key = getDuplicateSourceKey(source);
      if (key) add('sameSource', key, video.id);
      if (video.sourceId) {
        try {
          const host = new URL(source).hostname.toLowerCase().replace(/^www\./, '');
          if (host) add('sameId', JSON.stringify([host, video.sourceId]), video.id);
        } catch { /* invalid source cannot establish a site identity */ }
      }
    }
    let stream = video.streamUrl || '';
    if (stream.startsWith('/api/proxy-video-stream?')) {
      try { stream = new URL(stream, 'https://imagex.local').searchParams.get('url') || ''; } catch { stream = ''; }
    }
    for (const address of new Set([stream, video.cloudUrl || ''])) {
      if (!/^https?:\/\//i.test(address)) continue;
      const key = getDuplicateSourceKey(address);
      if (key) add('sameMedia', key, video.id);
    }
  }
  const priority: Record<SourceReason, number> = { sameMedia: 0, sameId: 1, sameSource: 2 };
  const results = Array.from(groups, ([id, group]) => ({ id, ...group }))
    .filter(group => group.videoIds.length > 1)
    .sort((a, b) => priority[a.reason] - priority[b.reason]);
  const seen = new Set<string>();
  return results.filter(group => {
    const members = JSON.stringify([...group.videoIds].sort());
    if (seen.has(members)) return false;
    seen.add(members);
    return true;
  });
}
