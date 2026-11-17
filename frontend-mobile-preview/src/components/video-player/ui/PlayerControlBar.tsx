/**
 * PlayerControlBar.tsx
 *
 * Adaptive Studio toolbar & Scrubber integration for Universal Video Player.
 * Two-zone layout adapting via container queries without clock-wrapping or button collisions.
 * 100% i18n compliant (translations[lang].player).
 */

import React from 'react';
import { PlayerScrubber } from './PlayerScrubber';
import { MorphingPlayPauseIcon } from './MorphingPlayPauseIcon';
import { formatPlayerClock, type UniversalPlayerDensity } from '../engine/videoPlayerCore';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../types';

export interface PlayerControlBarProps {
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  bufferedPercent?: number;
  isFullscreen?: boolean;
  isTheater?: boolean;
  density?: UniversalPlayerDensity;
  language?: Language;
  onTogglePlay?: () => void;
  onSeek?: (time: number) => void;
  onSkipBy?: (deltaSeconds: number) => void;
  onToggleMute?: () => void;
  onVolumeChange?: (volume: number) => void;
  onToggleFullscreen?: () => void;
  onToggleTheater?: () => void;
  onTogglePip?: () => void;
  onOpenSettings?: () => void;
  onRequestWatch?: () => void;
  settingsButtonRef?: React.Ref<HTMLButtonElement> | React.RefObject<HTMLButtonElement | null>;
  onScrubbingChange?: (isScrubbing: boolean) => void;
  renderTrackMarkers?: React.ReactNode | ((params: { duration: number }) => React.ReactNode);
  renderRightControlsSlot?: React.ReactNode;
  className?: string;
}

export const PlayerControlBar: React.FC<PlayerControlBarProps> = ({
  isPlaying,
  isMuted,
  volume,
  currentTime,
  duration,
  bufferedPercent = 0,
  isFullscreen = false,
  isTheater = false,
  density = 'cinema',
  language = 'pt-BR',
  onTogglePlay,
  onSeek,
  onSkipBy,
  onToggleMute,
  onVolumeChange,
  onToggleFullscreen,
  onToggleTheater,
  onTogglePip,
  onOpenSettings,
  onRequestWatch,
  settingsButtonRef,
  onScrubbingChange,
  renderTrackMarkers,
  renderRightControlsSlot,
  className = '',
}) => {
  const t = translations[language]?.player || translations['pt-BR'].player;

  return (
    <div
      data-uvp-control-bar="true"
      data-player-control="true"
      className={`uvp-bottom-bar ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Scrubber Bar */}
      <PlayerScrubber
        currentTime={currentTime}
        duration={duration}
        bufferedPercent={bufferedPercent}
        onSeek={onSeek}
        onScrubbingChange={onScrubbingChange}
        renderTrackMarkers={renderTrackMarkers}
        language={language}
      />

      {/* Two-Zone Control Toolbar */}
      <div className="uvp-controls-row">
        {/* Left Controls: Play/Pause, Rewind, Forward, Volume, Clock */}
        <div className="uvp-controls-left">
          {/* Play / Pause */}
          <button
            type="button"
            className="uvp-btn"
            aria-label={isPlaying ? t.pause : t.play}
            title={isPlaying ? t.pause : t.play}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay?.();
            }}
          >
            <MorphingPlayPauseIcon isPlaying={isPlaying} size={20} />
          </button>

          {/* Rewind 10s (desktop/wide only) */}
          {onSkipBy && (
            <button
              type="button"
              className="uvp-btn uvp-btn--nudge-left uvp-desktop-only"
              aria-label={t.seekBack10}
              title={t.seekBack10}
              onClick={(e) => {
                e.stopPropagation();
                onSkipBy(-10);
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Forward 10s (desktop/wide only) */}
          {onSkipBy && (
            <button
              type="button"
              className="uvp-btn uvp-btn--nudge-right uvp-desktop-only"
              aria-label={t.seekForward10}
              title={t.seekForward10}
              onClick={(e) => {
                e.stopPropagation();
                onSkipBy(10);
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Volume Control with Hover Drawer */}
          {onToggleMute && (
            <div className="uvp-volume-group uvp-desktop-only">
              <button
                type="button"
                className="uvp-btn uvp-btn--tilt"
                aria-label={isMuted || volume === 0 ? t.unmute : t.mute}
                title={isMuted || volume === 0 ? t.unmute : t.mute}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMute();
                }}
              >
                {isMuted || volume === 0 ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 9v6h4l5 5V4L11 9H7zm11.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>
              {onVolumeChange && (
                <div className="uvp-volume-slider-wrap">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    aria-label={t.volume}
                    className="uvp-volume-input"
                    onChange={(e) => {
                      e.stopPropagation();
                      onVolumeChange(parseFloat(e.target.value));
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
            </div>
          )}

          {/* Non-Wrapping Tabular-Nums Clock */}
          <div className="uvp-clock whitespace-nowrap tabular-nums">
            <span>{formatPlayerClock(currentTime)}</span>
            <span className="opacity-60">/</span>
            <span>{formatPlayerClock(duration)}</span>
          </div>
        </div>

        {/* Right Controls: Slots, Theater, PiP, Settings, Fullscreen */}
        <div className="uvp-controls-right">
          {/* Optional caller-provided controls */}
          {renderRightControlsSlot}

          {/* Theater Mode Toggle (Cinema density only) */}
          {density === 'cinema' && onToggleTheater && (
            <button
              type="button"
              className="uvp-btn uvp-btn--theater uvp-desktop-only"
              aria-label={isTheater ? t.exitTheaterMode : t.theaterMode}
              title={isTheater ? t.exitTheaterMode : t.theaterMode}
              onClick={(e) => {
                e.stopPropagation();
                onToggleTheater();
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 9h20M2 15h20" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {/* Picture-in-Picture / Mini-player button (omitted inside density="mini" since FloatingMiniPlayer header provides PiP/Expand) */}
          {density !== 'mini' && onTogglePip && (
            <button
              type="button"
              className="uvp-btn uvp-btn--pip"
              aria-label={t.miniPlayer}
              title={t.miniPlayer}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePip();
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <rect x="12" y="10" width="8" height="8" rx="1" fill="currentColor" opacity="0.3" />
              </svg>
            </button>
          )}

          {/* Expand / Watch Request Trigger */}
          {onRequestWatch && (
            <button
              type="button"
              className="uvp-btn"
              aria-label={t.expandPlayer}
              title={t.expandPlayer}
              onClick={(e) => {
                e.stopPropagation();
                onRequestWatch();
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Settings Menu Trigger */}
          {onOpenSettings && (
            <button
              ref={settingsButtonRef as any}
              type="button"
              className="uvp-btn uvp-btn--spin"
              aria-label={t.settingsTitle}
              title={t.settingsTitle}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings();
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
            </button>
          )}

          {/* Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              type="button"
              className="uvp-btn uvp-btn--expand"
              aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}
              title={isFullscreen ? t.exitFullscreen : t.fullscreen}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFullscreen();
              }}
            >
              {isFullscreen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerControlBar;
