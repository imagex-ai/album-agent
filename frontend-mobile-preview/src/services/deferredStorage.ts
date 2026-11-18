const pending = new Map<string, string | (() => string)>();
const results = new Map<string, (success: boolean) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const flush = () => {
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const [key, value] of pending) {
    try {
      localStorage.setItem(key, typeof value === 'function' ? value() : value);
      results.get(key)?.(true);
    } catch { results.get(key)?.(false); /* Keep the live session usable if storage is full. */ }
  }
  pending.clear();
  results.clear();
};

/** Coalesce serialization as well as storage writes; flush before leaving. */
export function deferStorageWrite(key: string, value: () => string, onResult?: (success: boolean) => void) {
  pending.set(key, value);
  if (onResult) results.set(key, onResult);
  if (!timer) timer = setTimeout(flush, 400);
}
export function cancelStorageWrite(key: string) { pending.delete(key); results.delete(key); }
/** Commit one explicit action's recovery marker before sending its request. */
export function flushStorageWrite(key: string) {
  if (!pending.has(key)) return;
  try {
    const value = pending.get(key)!;
    localStorage.setItem(key, typeof value === 'function' ? value() : value);
    results.get(key)?.(true);
  } catch { results.get(key)?.(false); }
  pending.delete(key); results.delete(key);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
}
