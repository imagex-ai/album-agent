export interface ProfileHubEngagement {
  status: 'ready' | 'unsupported';
  source_url: string;
  like_count: number | null;
  comment_count: number | null;
}

export function engagementSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parseProfileHubEngagement(value: unknown): ProfileHubEngagement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid engagement response');
  const payload = value as Record<string, unknown>;
  const sourceUrl = engagementSourceUrl(payload.source_url);
  const count = (item: unknown): item is number | null => item === null ||
    (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0);
  if (!sourceUrl || (payload.status !== 'ready' && payload.status !== 'unsupported') ||
      !count(payload.like_count) || !count(payload.comment_count) ||
      (payload.status === 'unsupported' && (payload.like_count !== null || payload.comment_count !== null))) {
    throw new Error('Invalid engagement response');
  }
  return {status: payload.status as ProfileHubEngagement['status'], source_url: sourceUrl,
    like_count: payload.like_count, comment_count: payload.comment_count};
}

// Technical resource budgets: bounded live metadata work and short, memory-only reuse.
const MAX_ACTIVE_REQUESTS = 4;
const MAX_CACHED_SOURCES = 64;
const CACHE_TTL_MS = 60_000;
type RequestEntry = {
  controller: AbortController;
  promise: Promise<ProfileHubEngagement>;
  resolve: (result: ProfileHubEngagement) => void;
  reject: (error: unknown) => void;
  consumers: number;
  started: boolean;
};
const cache = new Map<string, {value: ProfileHubEngagement; expires: number}>();
const requests = new Map<string, RequestEntry>();
let activeRequests = 0;
const aborted = () => new DOMException('Engagement request aborted', 'AbortError');

function pumpRequests(): void {
  for (const [url, entry] of requests) {
    if (activeRequests >= MAX_ACTIVE_REQUESTS) break;
    if (entry.started || entry.controller.signal.aborted) continue;
    entry.started = true;
    activeRequests++;
    void (async () => {
      try {
        const response = await fetch(`/api/profile-hub/engagement?${new URLSearchParams({url})}`, {signal: entry.controller.signal});
        if (!response.ok) throw new Error(`Engagement request failed (${response.status})`);
        const value = parseProfileHubEngagement(await response.json());
        if (entry.controller.signal.aborted) throw aborted();
        if (value.source_url !== url) throw new Error('Engagement source mismatch');
        cache.delete(url);
        cache.set(url, {value, expires: Date.now() + CACHE_TTL_MS});
        while (cache.size > MAX_CACHED_SOURCES) cache.delete(cache.keys().next().value!);
        entry.resolve(value);
      } catch (error) { entry.reject(error); }
      finally {
        activeRequests--;
        if (requests.get(url) === entry) requests.delete(url);
        pumpRequests();
      }
    })();
  }
}

/** Each consumer cancels independently; the transport stops when nobody needs it. */
export function fetchProfileHubEngagement(source: string, signal: AbortSignal): Promise<ProfileHubEngagement> {
  const url = engagementSourceUrl(source);
  if (signal.aborted) return Promise.reject(aborted());
  if (!url) return Promise.reject(new Error('Invalid engagement source'));
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) {
    cache.delete(url); cache.set(url, cached);
    return Promise.resolve(cached.value);
  }
  cache.delete(url);
  let entry = requests.get(url);
  if (!entry) {
    let resolve!: RequestEntry['resolve'];
    let reject!: RequestEntry['reject'];
    const promise = new Promise<ProfileHubEngagement>((res, rej) => { resolve = res; reject = rej; });
    entry = {controller: new AbortController(), promise, resolve, reject, consumers: 0, started: false};
    requests.set(url, entry);
  }
  const request = entry;
  request.consumers++;
  const result = new Promise<ProfileHubEngagement>((resolve, reject) => {
    let finished = false;
    const finish = (value?: ProfileHubEngagement, error?: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', onAbort);
      request.consumers--;
      if (error) reject(error); else resolve(value!);
    };
    const onAbort = () => {
      finish(undefined, aborted());
      if (request.consumers === 0) {
        if (requests.get(url) === request) requests.delete(url);
        request.controller.abort();
        request.reject(aborted());
      }
    };
    signal.addEventListener('abort', onAbort, {once: true});
    request.promise.then(value => finish(value), error => finish(undefined, error));
  });
  pumpRequests();
  return result;
}
