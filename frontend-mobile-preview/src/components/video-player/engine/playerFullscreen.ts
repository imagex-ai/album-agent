/** Fullscreen belongs to the existing media element; never remount it to expand. */
type SafariVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

export function createPlayerFullscreen(
  stage: HTMLElement,
  video: SafariVideo | null,
  onChange: (active: boolean) => void,
) {
  const doc = stage.ownerDocument;
  let mode: 'inline' | 'native' | 'video' | 'viewport' = 'inline';
  let disposed = false;
  let generation = 0;
  let pending = false;
  const update = (next: typeof mode) => {
    mode = next;
    if (!disposed) onChange(next !== 'inline');
  };
  const clearViewport = () => {
    if (stage.hasAttribute('popover')) {
      try { stage.hidePopover(); } catch { /* Already hidden by the browser. */ }
      stage.removeAttribute('popover');
    }
    delete stage.dataset.fullscreenFallback;
  };
  const exit = async () => {
    ++generation;
    pending = false;
    if (mode === 'viewport') { clearViewport(); update('inline'); return; }
    try {
      if (doc.fullscreenElement === stage) await doc.exitFullscreen();
      else if (video?.webkitDisplayingFullscreen || mode === 'video') video?.webkitExitFullscreen?.();
      else update('inline');
    } catch { /* Keep state until the browser actually exits native fullscreen. */ }
  };
  const nativeChange = () => {
    if (doc.fullscreenElement === stage) update('native');
    else if (mode === 'native') update('inline');
  };
  const videoBegin = () => update('video');
  const videoEnd = () => update('inline');
  doc.addEventListener('fullscreenchange', nativeChange);
  video?.addEventListener('webkitbeginfullscreen', videoBegin);
  video?.addEventListener('webkitendfullscreen', videoEnd);

  const toggle = async () => {
    if (disposed) return;
    if (mode !== 'inline' || pending) { await exit(); return; }
    const request = ++generation;
    pending = true;
    const stale = () => disposed || request !== generation;
    try {
      if (stage.requestFullscreen && doc.fullscreenEnabled !== false) {
        try {
          await stage.requestFullscreen();
          if (stale()) {
            if (doc.fullscreenElement === stage) await doc.exitFullscreen();
            return;
          }
          if (doc.fullscreenElement === stage) { update('native'); return; }
        } catch { /* Safari and embedded browsers may reject element fullscreen. */ }
      }
      if (stale()) return;
      if (video?.webkitEnterFullscreen) {
        try {
          video.webkitEnterFullscreen();
          update('video');
          return;
        } catch { /* Metadata unavailable or native fullscreen disallowed. */ }
      }
      if (stale()) return;
      // A manual popover lifts the SAME stage above transformed/overflow-hidden
      // parents (including the persistent-player host), without moving the video.
      stage.dataset.fullscreenFallback = 'true';
      if (typeof stage.showPopover === 'function') {
        stage.setAttribute('popover', 'manual');
        try { stage.showPopover(); } catch { stage.removeAttribute('popover'); }
      }
      update('viewport');
    } finally {
      if (request === generation) pending = false;
    }
  };
  return {
    toggle,
    exit,
    dispose() {
      disposed = true;
      void exit();
      clearViewport();
      doc.removeEventListener('fullscreenchange', nativeChange);
      video?.removeEventListener('webkitbeginfullscreen', videoBegin);
      video?.removeEventListener('webkitendfullscreen', videoEnd);
    },
  };
}
