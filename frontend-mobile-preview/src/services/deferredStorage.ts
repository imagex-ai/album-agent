const pending = new Map<string, string | (() => string)>();
let timer: ReturnType<typeof setTimeout> | undefined;
const flush = () => {
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const [key, value] of pending) {
    try { localStorage.setItem(key, typeof value === 'function' ? value() : value); } catch { /* Keep the live session usable if storage is full. */ }
  }
  pending.clear();
};

/** Coalesce serialization as well as storage writes; flush before leaving. */
export function deferStorageWrite(key: string, value: () => string) {
  pending.set(key, value);
  if (!timer) timer = setTimeout(flush, 400);
}
export function cancelStorageWrite(key: string) { pending.delete(key); }
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
}
