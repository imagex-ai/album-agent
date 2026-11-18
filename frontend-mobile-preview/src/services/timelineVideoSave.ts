export interface TimelineVideoSaveInput {
  profile_url: string;
  profile_name: string;
  video_url: string;
  video_id: string;
  title: string;
  thumbnail_url?: string;
}

export interface TimelineVideoSaveResult {
  id: string;
  folder: string;
  already_saved: boolean;
}

// Match the server's conservative URL identity without changing case-sensitive paths.
export function timelineVideoIdentity(value?: string): string | null {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return `https://${host}${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
  } catch { return null; }
}

const pending = new Map<string, Promise<TimelineVideoSaveResult>>();
type SavedVideoStatus = { id: string; folder: string } | null;
const statusQueue = new Map<string, Array<(status: SavedVideoStatus | undefined) => void>>();
let statusScheduled = false;
const STATUS_BATCH_SIZE = 500; // Matches the server's bounded request size.
const STATUS_TIMEOUT_MS = 15_000;
const SAVE_TIMEOUT_MS = 60_000;

async function flushStatuses() {
  statusScheduled = false;
  const entries = Array.from(statusQueue.entries());
  statusQueue.clear();
  for (let offset = 0; offset < entries.length; offset += STATUS_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + STATUS_BATCH_SIZE);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    try {
      const response = await fetch('/api/profile-hub/timeline/saved-video-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: batch.map(([url]) => url) }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.items) || data.items.length !== batch.length) throw new Error('invalid_status');
      batch.forEach(([, listeners], index) => {
        const item = data.items[index];
        const status = item === null ? null : item && typeof item.id === 'string' && typeof item.folder === 'string' ? item : undefined;
        listeners.forEach(resolve => resolve(status));
      });
    } catch {
      batch.forEach(([, listeners]) => listeners.forEach(resolve => resolve(undefined)));
    } finally { clearTimeout(timeout); }
  }
}

export function readTimelineSavedVideo(url: string): Promise<SavedVideoStatus | undefined> {
  return new Promise(resolve => {
    const listeners = statusQueue.get(url) || [];
    listeners.push(resolve);
    statusQueue.set(url, listeners);
    if (!statusScheduled) {
      statusScheduled = true;
      setTimeout(() => { void flushStatuses(); }, 0);
    }
  });
}

export function saveTimelineVideo(input: TimelineVideoSaveInput): Promise<TimelineVideoSaveResult> {
  const key = timelineVideoIdentity(input.video_url);
  if (!key) return Promise.reject(new Error('invalid_media_url'));
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
    try {
      const response = await fetch('/api/profile-hub/timeline/save-video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'save_failed');
      if (!result || typeof result.id !== 'string' || typeof result.folder !== 'string' || typeof result.already_saved !== 'boolean') {
        throw new Error('invalid_save_response');
      }
      return result as TimelineVideoSaveResult;
    } finally { clearTimeout(timeout); }
  })();
  pending.set(key, request);
  void request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
  return request;
}
