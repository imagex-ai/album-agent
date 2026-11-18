import React from 'react';

export interface MorphingPlayPauseIconProps {
  isPlaying: boolean;
  size?: number;
  className?: string;
}

/**
 * Single-SVG 4-point path morphing Play <-> Pause icon (YouTube / Aceternity style).
 * Both states share identical M-L-L-L-Z topology so Chromium/WebView2 interpolates `d` smoothly.
 */
export const MorphingPlayPauseIcon: React.FC<MorphingPlayPauseIconProps> = ({
  isPlaying,
  size = 24,
  className = '',
}) => {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      data-playing={isPlaying ? 'true' : 'false'}
      className={`uvp-morph-svg ${className}`}
      style={{ width: size, height: size }}
    >
      <path
        className="uvp-morph-path uvp-morph-path--left"
        d={isPlaying ? 'M 6 5 L 10 5 L 10 19 L 6 19 Z' : 'M 7 5 L 13 8.5 L 13 15.5 L 7 19 Z'}
      />
      <path
        className="uvp-morph-path uvp-morph-path--right"
        d={isPlaying ? 'M 14 5 L 18 5 L 18 19 L 14 19 Z' : 'M 13 8.5 L 19 12 L 19 12 L 13 15.5 Z'}
      />
    </svg>
  );
};
