/** Coordinates the visual exit without letting an old close dismiss a new video. */
export function createVideoModalCloseCoordinator<T extends object>(options: {
  getCurrent: () => T | null;
  clearCurrent: () => void;
  pause: () => void;
  exitFullscreen: () => void;
  onSettled?: () => void;
}) {
  let generation = 0;
  let pending = false;
  let animations: Animation[] = [];
  let panel: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishPending: (() => void) | null = null;

  const cancel = () => {
    generation += 1;
    pending = false;
    finishPending = null;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const animation of animations) animation.cancel();
    animations = [];
    panel?.removeAttribute('inert');
    panel = null;
    options.onSettled?.();
  };

  const close = (current: T, backdrop: HTMLElement | null, content: HTMLElement | null, duration: number, disabled: boolean) => {
    if (pending || options.getCurrent() !== current) return;
    pending = true;
    const request = ++generation;
    options.pause();
    options.exitFullscreen();
    panel = content;
    panel?.setAttribute('inert', '');
    const finish = () => {
      if (request !== generation) return;
      const stillCurrent = options.getCurrent() === current;
      cancel();
      if (stillCurrent) options.clearCurrent();
    };
    finishPending = finish;
    if (disabled || duration <= 0 || !backdrop || !content || typeof backdrop.animate !== 'function' || typeof content.animate !== 'function') {
      finish();
      return;
    }
    try {
      animations.push(backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'both' }));
      void animations[0].finished.catch(() => {});
      animations.push(content.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.98)' }], { duration, easing: 'ease-out', fill: 'both' }));
      void animations[1].finished.catch(() => {});
      timer = setTimeout(finish, 2000);
      void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    } catch {
      finish();
    }
  };

  return { close, cancel, finishNow: () => finishPending?.() };
}
