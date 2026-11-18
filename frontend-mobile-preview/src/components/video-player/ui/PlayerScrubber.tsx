/**
 * PlayerScrubber.tsx
 *
 * 60fps Zero-ReRender Scrubber component for Universal Video Player.
 * Driven by direct CSS custom property mutations (--uvp-progress, --uvp-buffered, --uvp-hover-x)
 * via requestAnimationFrame without triggering React state updates at 60fps (Rule 5.15).
 * Supports precision vertical fine-scrubbing (1.0x / 0.5x / 0.25x) and highlight notches.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatPlayerClock } from '../engine/videoPlayerCore';
import { computeFineScrubMultiplier } from '../engine/usePlayerGestures';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../types';

export interface PlayerScrubberProps {
  currentTime: number;
  duration: number;
  bufferedPercent?: number;
  onSeek?: (time: number) => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
  renderTrackMarkers?: React.ReactNode | ((params: { duration: number }) => React.ReactNode);
  disabled?: boolean;
  language?: Language;
  className?: string;
}

export const PlayerScrubber: React.FC<PlayerScrubberProps> = ({
  currentTime,
  duration,
  bufferedPercent = 0,
  onSeek,
  onScrubbingChange,
  renderTrackMarkers,
  disabled = false,
  language = 'pt-BR',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartYRef = useRef<number>(0);
  const lastClientXRef = useRef<number>(0);
  const rAFRef = useRef<number | null>(null);

  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [hoverTime, setHoverTime] = useState<number>(0);
  const [fineMultiplier, setFineMultiplier] = useState<1 | 0.5 | 0.25>(1);

  const t = translations[language]?.player || translations['pt-BR'].player;

  // Sync progress & buffered percentages to CSS variables
  const updateCssProperties = useCallback(
    (current: number, dur: number, buffered: number) => {
      if (!containerRef.current) return;
      const progressPct = dur > 0 ? Math.min(100, Math.max(0, (current / dur) * 100)) : 0;
      containerRef.current.style.setProperty('--uvp-progress', `${progressPct}%`);
      containerRef.current.style.setProperty('--uvp-buffered', `${Math.min(100, Math.max(0, buffered))}%`);
    },
    []
  );

  useEffect(() => {
    if (!isDraggingRef.current) {
      updateCssProperties(currentTime, duration, bufferedPercent);
    }
  }, [currentTime, duration, bufferedPercent, updateCssProperties]);

  // Clean up any pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rAFRef.current !== null) {
        cancelAnimationFrame(rAFRef.current);
      }
    };
  }, []);

  const calculateTimeFromX = useCallback(
    (clientX: number): { time: number; x: number } => {
      if (!containerRef.current || duration <= 0) return { time: 0, x: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const fraction = rect.width > 0 ? x / rect.width : 0;
      return { time: fraction * duration, x };
    },
    [duration]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    lastClientXRef.current = e.clientX;
    onScrubbingChange?.(true);

    if (containerRef.current) {
      containerRef.current.setAttribute('data-scrubbing', 'true');
      try {
        containerRef.current.setPointerCapture(e.pointerId);
      } catch {
        // Safe fallback
      }
    }

    const { time, x } = calculateTimeFromX(e.clientX);
    if (containerRef.current) {
      containerRef.current.style.setProperty('--uvp-hover-x', `${x}px`);
    }
    updateCssProperties(time, duration, bufferedPercent);
    onSeek?.(time);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;

    if (isDraggingRef.current) {
      e.preventDefault();
      const upwardDistance = Math.max(0, dragStartYRef.current - e.clientY);
      const mult = computeFineScrubMultiplier(upwardDistance);
      setFineMultiplier(mult);

      if (rAFRef.current !== null) {
        cancelAnimationFrame(rAFRef.current);
      }

      rAFRef.current = requestAnimationFrame(() => {
        const { time, x } = calculateTimeFromX(e.clientX);
        if (containerRef.current) {
          containerRef.current.style.setProperty('--uvp-hover-x', `${x}px`);
        }
        updateCssProperties(time, duration, bufferedPercent);
        onSeek?.(time);
      });
    } else {
      const { time, x } = calculateTimeFromX(e.clientX);
      setHoverTime(time);
      if (containerRef.current) {
        containerRef.current.style.setProperty('--uvp-hover-x', `${x}px`);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    isDraggingRef.current = false;
    onScrubbingChange?.(false);
    setFineMultiplier(1);

    if (containerRef.current) {
      containerRef.current.removeAttribute('data-scrubbing');
      try {
        containerRef.current.releasePointerCapture(e.pointerId);
      } catch {
        // Safe fallback
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    let step = 0;
    if (e.key === 'ArrowLeft') step = -5;
    else if (e.key === 'ArrowRight') step = 5;
    else if (e.key === 'PageDown') step = -10;
    else if (e.key === 'PageUp') step = 10;
    else if (e.key === 'Home') {
      e.preventDefault();
      onSeek?.(0);
      return;
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek?.(duration);
      return;
    }

    if (step !== 0) {
      e.preventDefault();
      e.stopPropagation();
      const targetTime = Math.min(duration, Math.max(0, currentTime + step));
      updateCssProperties(targetTime, duration, bufferedPercent);
      onSeek?.(targetTime);
    }
  };

  const renderedMarkers =
    typeof renderTrackMarkers === 'function'
      ? renderTrackMarkers({ duration })
      : renderTrackMarkers;

  return (
    <div
      ref={containerRef}
      data-uvp-scrubber="true"
      data-player-control="true"
      className={`uvp-scrubber-hit ${className}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={t.scrubberAria || 'Video progress bar'}
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration || 0)}
      aria-valuenow={Math.floor(currentTime || 0)}
      aria-valuetext={formatPlayerClock(currentTime || 0)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onKeyDown={handleKeyDown}
    >
      <div className="uvp-scrubber-track">
        <div className="uvp-scrubber-buffered" />
        <div className="uvp-scrubber-progress" />
        {renderedMarkers}
        <div className="uvp-scrubber-thumb" />
      </div>

      {isHovering && duration > 0 && !isDraggingRef.current && (
        <div className="uvp-hover-bubble">
          {formatPlayerClock(hoverTime)}
        </div>
      )}

      {isDraggingRef.current && fineMultiplier < 1 && (
        <div className="uvp-fine-scrub-guide">
          {fineMultiplier === 0.5 ? t.fineScrubHalf : t.fineScrubQuarter}
        </div>
      )}
    </div>
  );
};

export default PlayerScrubber;
