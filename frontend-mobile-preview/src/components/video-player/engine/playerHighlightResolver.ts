import type { UniversalVideoSource } from './videoPlayerCore';
import { normalizePlayerHighlights, type PlayerHighlight } from './playerHighlights';

// One background request at a time; video startup never waits for this queue.
const RETRY_AFTER_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90 * 1000;
const MEMORY_CACHE_ENTRIES = 128; // Bound metadata retained across long browsing sessions.
const cache = new Map<string, { highlights: PlayerHighlight[]; retryAfter: number }>();
const pending = new Map<string, Promise<PlayerHighlight[]>>();
let tail: Promise<unknown> = Promise.resolve();

export function resolvePlayerHighlights(source: UniversalVideoSource, duration: number, signal: AbortSignal): Promise<PlayerHighlight[]> {
  // Only explicit library identity is eligible for the library analysis endpoint.
  // Other surfaces send an exact original URL to the source-owned endpoint.
  const videoId = source.highlightVideoId;
  const libraryIdentity = typeof videoId === 'string' && Boolean(videoId);
  const sourceUrl = source.originalUrl || source.sourceUrl;
  const remoteIdentity = typeof sourceUrl === 'string' && /^https:\/\//i.test(sourceUrl);
  if ((!libraryIdentity && !remoteIdentity) || signal.aborted) return Promise.resolve([]);
  // Typed namespaces keep foreign IDs out of the library resolver. The remote
  // endpoint admits only exact source-owned watch routes through its adapters.
  const key = libraryIdentity ? `library:${videoId}` : `source:${sourceUrl}`;
  const cached = cache.get(key);
  if (cached && (cached.highlights.length || cached.retryAfter > Date.now())) return Promise.resolve(cached.highlights);
  const existing = pending.get(key);
  if (existing) return existing;
  const work = tail.catch(() => {}).then(async () => {
    if (signal.aborted) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(libraryIdentity ? '/api/player-highlights/resolve' : '/api/player-highlights/resolve-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(libraryIdentity ? { video_id: videoId } : { source_url: sourceUrl }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Highlight request failed');
      const result = normalizePlayerHighlights(await response.json(), duration);
      cache.set(key, { highlights: result, retryAfter: Date.now() + RETRY_AFTER_MS });
      if (cache.size > MEMORY_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      return result;
    } catch {
      cache.set(key, { highlights: [], retryAfter: Date.now() + RETRY_AFTER_MS });
      if (cache.size > MEMORY_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      return [];
    } finally { clearTimeout(timeout); }
  });
  tail = work;
  pending.set(key, work);
  void work.finally(() => pending.delete(key));
  return work;
}
