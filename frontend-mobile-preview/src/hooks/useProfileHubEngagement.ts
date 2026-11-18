import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { engagementSourceUrl, fetchProfileHubEngagement } from '../services/profileHubEngagement';
import type { ProfileHubEngagement } from '../services/profileHubEngagement';

export interface ProfileHubEngagementState {
  status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
  data: ProfileHubEngagement | null;
  retry: () => void;
}

/** Visibility is independent of autoplay: metadata must never control player state. */
export function useProfileHubEngagementState(source: string | null, target: RefObject<HTMLElement>): ProfileHubEngagementState {
  const url = engagementSourceUrl(source);
  const [result, setResult] = useState<{url: string | null; status: ProfileHubEngagementState['status']; data: ProfileHubEngagement | null}>(
    {url: null, status: 'idle', data: null}
  );
  const generation = useRef(0);
  const retryRef = useRef<{url: string; request: () => void} | null>(null);
  const retry = useCallback(() => {
    if (retryRef.current?.url === url) retryRef.current.request();
  }, [url]);
  useEffect(() => {
    const element = target.current;
    const effectGeneration = ++generation.current;
    let controller: AbortController | null = null;
    let visible = false;
    setResult(previous => ({url, status: 'idle', data: previous.url === url ? previous.data : null}));
    retryRef.current = null;
    if (!url || !element || typeof IntersectionObserver === 'undefined') return;
    const request = () => {
      if (!visible || generation.current !== effectGeneration || (controller && !controller.signal.aborted)) return;
      const current = new AbortController();
      controller = current;
      setResult(previous => ({url, status: 'loading', data: previous.url === url ? previous.data : null}));
      void fetchProfileHubEngagement(url, current.signal).then(value => {
        if (!current.signal.aborted && visible && generation.current === effectGeneration) {
          setResult({url, status: value.status, data: value});
        }
      }).catch(() => {
        if (!current.signal.aborted && visible && generation.current === effectGeneration) {
          setResult(previous => ({url, status: 'error', data: previous.url === url ? previous.data : null}));
        }
      }).finally(() => {
        if (controller === current) controller = null;
      });
    };
    retryRef.current = {url, request};
    const observer = new IntersectionObserver(entries => {
      if (generation.current !== effectGeneration) return;
      const nextVisible = entries.some(entry => entry.target === element && entry.isIntersecting && entry.intersectionRatio > 0);
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) {
        controller?.abort();
        controller = null;
        setResult(previous => previous.url === url && previous.status === 'loading'
          ? {...previous, status: previous.data?.status ?? 'idle'} : previous);
        return;
      }
      request();
    });
    observer.observe(element);
    return () => {
      generation.current++;
      visible = false;
      retryRef.current = null;
      controller?.abort();
      observer.disconnect();
    };
  }, [url, target]);
  // URL changes must not render an old value even before effect cleanup runs.
  return result.url === url ? {status: result.status, data: result.data, retry} : {status: 'idle', data: null, retry};
}

/** Compatibility contract for existing consumers that only need the confirmed DTO. */
export function useProfileHubEngagement(source: string | null, target: RefObject<HTMLElement>): ProfileHubEngagement | null {
  return useProfileHubEngagementState(source, target).data;
}
