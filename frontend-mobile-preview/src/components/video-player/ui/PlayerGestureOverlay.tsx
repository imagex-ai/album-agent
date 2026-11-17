/**
 * PlayerGestureOverlay.tsx
 *
 * Micro-Interaction & Visual Feedback Overlay for Universal Video Player.
 * - GPU-composited 2x >> hold speed pill badge (linear spring pop)
 * - Double-tap +/-10s side ripple and chevron cascade
 * - Fine-scrubbing guidance rail (1.0x / 0.5x / 0.25x)
 * - Centered buffering spinner with HTML wrapper rotation (Rule 6.1)
 * - Mobile center touch HUD (↺ 10s | ▶/⏸ 56px | 10s ↻) on narrow / coarse displays
 */

import React from 'react';
import { MorphingPlayPauseIcon } from './MorphingPlayPauseIcon';
import type { PlayerGestureFeedback } from '../engine/usePlayerGestures';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../types';

export interface PlayerGestureOverlayProps {
  gestureFeedback?: PlayerGestureFeedback | null;
  isHold2xActive?: boolean;
  isBuffering?: boolean;
  isVideoReady?: boolean;
  showCenterMobileHud?: boolean;
  isPlaying?: boolean;
  language?: Language;
  onTogglePlay?: () => void;
  onSeekBack10?: () => void;
  onSeekForward10?: () => void;
  className?: string;
}

export const PlayerGestureOverlay: React.FC<PlayerGestureOverlayProps> = ({
  gestureFeedback,
  isHold2xActive = false,
  isBuffering = false,
  isVideoReady = true,
  showCenterMobileHud = false,
  isPlaying = false,
  language = 'pt-BR',
  onTogglePlay,
  onSeekBack10,
  onSeekForward10,
  className = '',
}) => {
  const t = translations[language]?.player || translations['pt-BR'].player;

  const showHoldPill = isHold2xActive || gestureFeedback?.kind === 'hold2x';
  const showSeekRipple = gestureFeedback?.kind === 'seek';
  const showFineScrub = gestureFeedback?.kind === 'fine_scrub';
  const showSpinner = isBuffering;

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden ${className}`}
    >
      {/* 1. Hold-for-2x Speed Pill */}
      {showHoldPill && (
        <div aria-hidden="true" className="uvp-hold-2x-pill uvp-spring-pop">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 6v12l8.5-6L13 6zm-9 0v12l8.5-6L4 6z" />
          </svg>
          <span>{t.hold2xBadge}</span>
          <span className="font-mono text-xs opacity-80">2x &gt;&gt;</span>
        </div>
      )}

      {/* 2. Double-Tap Seek Combo Ripple */}
      {showSeekRipple && gestureFeedback && (
        <div
          aria-hidden="true"
          className={`uvp-seek-ripple ${
            gestureFeedback.direction === 'back'
              ? 'uvp-seek-ripple-left'
              : 'uvp-seek-ripple-right'
          }`}
        >
          <div className="uvp-seek-badge uvp-spring-pop flex items-center gap-1">
            {gestureFeedback.direction === 'back' ? (
              <>
                <span>&lt;&lt;</span>
                <span>{gestureFeedback.totalDeltaSeconds}s</span>
              </>
            ) : (
              <>
                <span>+{gestureFeedback.totalDeltaSeconds}s</span>
                <span>&gt;&gt;</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* 3. Fine-Scrub Guidance Guide */}
      {showFineScrub && gestureFeedback && (
        <div aria-hidden="true" className="uvp-fine-scrub-guide uvp-spring-pop">
          {gestureFeedback.multiplier === 0.25
            ? t.fineScrubQuarter
            : gestureFeedback.multiplier === 0.5
              ? t.fineScrubHalf
              : t.fineScrub1x}
        </div>
      )}

      {/* 4. Buffering Spinner (Wrapper Rotation for Rule 6.1) */}
      {showSpinner && (
        <div role="status" aria-label={t.buffering} className={showCenterMobileHud ? 'absolute top-3 right-3' : ''}>
          <div aria-hidden="true" className="uvp-spinner-wrapper h-7 w-7 text-white drop-shadow-md">
            <svg
              className="h-full w-full"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                strokeOpacity="0.25"
              />
              <path
                d="M12 3a9 9 0 0 1 9 9"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      )}

      {/* 5. Center Mobile Touch HUD (↺ 10s | ▶/⏸ 56px | 10s ↻) */}
      {showCenterMobileHud && (
        <div className="uvp-center-hud pointer-events-auto items-center gap-6" data-playing={isPlaying ? 'true' : 'false'}>
          {/* Rewind 10s */}
          {onSeekBack10 && (
            <button
              type="button"
              className="uvp-btn uvp-center-action uvp-center-action--skip text-white"
              aria-label={t.seekBack10}
              onClick={(e) => {
                e.stopPropagation();
                onSeekBack10();
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Central Play/Pause (56px) */}
          {onTogglePlay && (
            <button
              type="button"
              className="uvp-btn uvp-center-action uvp-center-action--play"
              aria-label={isPlaying ? t.pause : t.play}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay();
              }}
            >
              <MorphingPlayPauseIcon isPlaying={isPlaying} size={28} />
            </button>
          )}

          {/* Forward 10s */}
          {onSeekForward10 && (
            <button
              type="button"
              className="uvp-btn uvp-center-action uvp-center-action--skip text-white"
              aria-label={t.seekForward10}
              onClick={(e) => {
                e.stopPropagation();
                onSeekForward10();
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PlayerGestureOverlay;
