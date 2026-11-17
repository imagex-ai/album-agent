import React, { memo } from 'react';
import type { PlayerHighlight } from '../engine/playerHighlights';

/** Markers are visual cues on the existing seek bar. */
export const PlayerHighlightMarkers = memo(function PlayerHighlightMarkers({
  highlights,
  duration,
}: {
  highlights: readonly PlayerHighlight[];
  duration: number;
}) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return (
    <>
      {highlights.map((highlight, index) => {
        if (!Number.isFinite(highlight.start) || highlight.start < 0 || highlight.start >= duration) return null;
        const end = typeof highlight.end === 'number' && Number.isFinite(highlight.end)
          ? Math.min(duration, Math.max(highlight.start, highlight.end))
          : highlight.start;
        const color = highlight.rank === 'gold' || highlight.rank === 1 || highlight.rank === '1' || (!highlight.rank && index === 0)
          ? 'bg-amber-400'
          : highlight.rank === 'silver' || highlight.rank === 2 || highlight.rank === '2'
            ? 'bg-orange-400'
            : 'bg-cyan-400';
        return (
          <span
            key={`${highlight.rank ?? index}:${highlight.start}`}
            aria-hidden="true"
            data-highlight-notch={index + 1}
            className={`uvp-highlight-marker ${color}`}
            style={{ left: `${highlight.start / duration * 100}%`, width: `${(end - highlight.start) / duration * 100}%` }}
          />
        );
      })}
    </>
  );
});
