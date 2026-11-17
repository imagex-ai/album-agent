// Technical gesture thresholds in CSS pixels/ms: reject tap jitter and diagonal
// scrolling; accept a deliberate drag or a short, quick horizontal flick.
export const PHOTO_SWIPE = {
  intentDistance: 12,
  horizontalRatio: 1.5,
  distanceRatio: 0.2,
  minimumDistance: 48,
  maximumDistance: 120,
  flickDistance: 32,
  flickVelocity: 0.5,
  maximumFlickDuration: 300,
  feedbackRatio: 0.35,
  maximumFeedback: 160,
  settleDuration: 180,
  syntheticClickWindow: 700,
} as const;

export type PhotoSwipeIntent = 'pending' | 'horizontal' | 'rejected';

export function getPhotoSwipeIntent(dx: number, dy: number): PhotoSwipeIntent {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < PHOTO_SWIPE.intentDistance) return 'pending';
  return Math.abs(dx) >= Math.abs(dy) * PHOTO_SWIPE.horizontalRatio ? 'horizontal' : 'rejected';
}

export function getPhotoSwipeDirection(dx: number, dy: number, elapsed: number, width: number): -1 | 0 | 1 {
  if (getPhotoSwipeIntent(dx, dy) !== 'horizontal') return 0;
  const distance = Math.abs(dx);
  const threshold = Math.min(PHOTO_SWIPE.maximumDistance, Math.max(PHOTO_SWIPE.minimumDistance, width * PHOTO_SWIPE.distanceRatio));
  const flick = distance >= PHOTO_SWIPE.flickDistance && elapsed > 0
    && elapsed <= PHOTO_SWIPE.maximumFlickDuration && distance / elapsed >= PHOTO_SWIPE.flickVelocity;
  if (distance < threshold && !flick) return 0;
  return dx < 0 ? 1 : -1;
}
