/** Preserve playback intent while a video is adopted into or out of a PiP document. */
export function createPipVideoTransfer(video: HTMLVideoElement, resume: () => void) {
  let pending: { time: number; muted: boolean; volume: number; rate: number; playing: boolean } | null = null;
  let cancelPending = () => {};

  const move = (parent: Node, before: Node | null = null) => {
    if (!pending) {
      pending = {
        time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        muted: video.muted,
        volume: video.volume,
        rate: video.playbackRate,
        playing: !video.paused && !video.ended,
      };
    }
    cancelPending();
    let active = true;
    const restore = () => {
      if (!active || !pending || video.parentNode !== parent || video.readyState < 1) return;
      const snapshot = pending;
      try {
        video.currentTime = snapshot.time;
        video.muted = snapshot.muted;
        video.volume = snapshot.volume;
        video.playbackRate = snapshot.rate;
      } catch {
        return; // Retain the snapshot until metadata is available.
      }
      pending = null;
      active = false;
      video.removeEventListener('loadedmetadata', restore);
      if (snapshot.playing && video.paused) resume();
      else if (!snapshot.playing && !video.paused) video.pause();
    };
    cancelPending = () => {
      active = false;
      video.removeEventListener('loadedmetadata', restore);
    };
    video.addEventListener('loadedmetadata', restore);
    try {
      if (before && before.parentNode === parent) parent.insertBefore(video, before);
      else parent.appendChild(video);
    } catch (error) {
      cancelPending();
      throw error;
    }
    restore();
  };

  return { move, dispose: () => { cancelPending(); pending = null; } };
}
