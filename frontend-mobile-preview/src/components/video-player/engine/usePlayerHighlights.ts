import { useEffect, useMemo, useState } from 'react';
import type { UniversalVideoSource } from './videoPlayerCore';
import { normalizePlayerHighlights, type PlayerHighlight } from './playerHighlights';

/** Metadata is independent of the playback engine: it must never reload a source. */
export function usePlayerHighlights(
  source: UniversalVideoSource | null | undefined,
  options: { enabled: boolean; duration: number },
): PlayerHighlight[] {
  const identity = source ? JSON.stringify([source.sourceType || '', source.originalUrl || source.sourceUrl || '', source.id]) : '';
  const embedded = normalizePlayerHighlights(source, options.duration);
  const signature = JSON.stringify(embedded);
  const stableEmbedded = useMemo(() => embedded, [signature]);
  const [resolved, setResolved] = useState<{ identity: string; highlights: PlayerHighlight[] } | null>(null);
  // Lazy-import the scheduler only after the video is ready. Playback never awaits it.
  useEffect(() => {
    if (!source || !identity || !options.enabled || stableEmbedded.length) return;
    let active = true;
    const controller = new AbortController();
    void import('./playerHighlightResolver').then(({ resolvePlayerHighlights }) =>
      resolvePlayerHighlights(source, options.duration, controller.signal)
    ).then(highlights => {
      if (active && highlights.length) setResolved({ identity, highlights });
    }).catch(() => { /* Silent background enhancement; never interrupts playback. */ });
    return () => { active = false; controller.abort(); };
    // Source identity, not signed stream renewals or timeupdate renders, owns this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, options.enabled, options.duration, stableEmbedded]);
  return stableEmbedded.length ? stableEmbedded
    : resolved?.identity === identity ? normalizePlayerHighlights({ highlights: resolved.highlights }, options.duration) : [];
}
