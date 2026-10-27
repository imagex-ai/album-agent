export interface DuplicateVideoScanResult {
  scanId: string;
  groups: { id: string; videoIds: string[]; reason?: 'exact' | 'similar' }[];
  skipped: number;
}

const abortError = () => new DOMException('Scan cancelled', 'AbortError');

export async function scanVideos(
  onProgress: (progress: { loaded: number; total: number }) => void,
  signal: AbortSignal,
  mode: 'exact' | 'similar' = 'exact'
): Promise<DuplicateVideoScanResult> {
  if (signal.aborted) throw abortError();
  // Start without a signal so an interrupted response cannot orphan an unknown job.
  const response = await fetch(`/api/duplicates/video-scans?mode=${mode}`, { method: 'POST' });
  if (!response.ok) throw new Error('Unable to start scan');
  const { scanId } = await response.json();
  if (typeof scanId !== 'string' || !scanId) throw new Error('Invalid scan response');
  const endpoint = `/api/duplicates/video-scans/${encodeURIComponent(scanId)}`;
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const poll = await fetch(endpoint, { signal, cache: 'no-store' });
      if (!poll.ok) throw new Error('Unable to read scan');
      const result = await poll.json();
      onProgress({ loaded: result.loaded || 0, total: result.total || 0 });
      if (result.status === 'completed') return { scanId, groups: result.groups, skipped: result.skipped || 0 };
      if (result.status === 'failed') throw new Error('Scan failed');
      if (result.status === 'cancelled') throw abortError();
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(abortError()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 500);
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
      });
    }
  } catch (error) {
    void fetch(endpoint, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

export async function trashScannedVideo(scanId: string, videoId: string): Promise<boolean> {
  const response = await fetch(`/api/duplicates/video-scans/${encodeURIComponent(scanId)}/trash/${encodeURIComponent(videoId)}`, { method: 'POST' });
  if (!response.ok) return false;
  const data = await response.json();
  return data.success === true;
}

export async function scanLocalAlbums(
  onProgress: (progress: { loaded: number; total: number }) => void,
  signal: AbortSignal
): Promise<{ scanId: string; groups: { id: string; albumIds: string[] }[]; skipped: number }> {
  if (signal.aborted) throw abortError();
  const response = await fetch('/api/duplicates/album-scans', { method: 'POST' });
  if (!response.ok) throw new Error('Unable to start album scan');
  const { scanId } = await response.json();
  if (typeof scanId !== 'string' || !scanId) throw new Error('Invalid scan response');
  const endpoint = `/api/duplicates/album-scans/${encodeURIComponent(scanId)}`;
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const poll = await fetch(endpoint, { signal, cache: 'no-store' });
      if (!poll.ok) throw new Error('Unable to read scan');
      const result = await poll.json();
      onProgress({ loaded: result.loaded || 0, total: result.total || 0 });
      if (result.status === 'completed') return { scanId, groups: result.groups, skipped: result.skipped || 0 };
      if (result.status === 'failed') throw new Error('Scan failed');
      if (result.status === 'cancelled') throw abortError();
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(abortError()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 500);
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
      });
    }
  } catch (error) {
    void fetch(endpoint, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}
