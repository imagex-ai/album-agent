// Only opaque tokens cross the browser boundary; entry data belongs to this session.
export const TIMELINE_WATCH_HISTORY_KEY = 'imagexTimelineWatch';
export interface TimelineWatchHistoryPort {
  stateKey?: string;
  // A registry sharing native history with other entry kinds must retain known parents.
  retainKnownEntries?: boolean;
  location(): string;
  state(): unknown;
  push(state: Record<string, unknown>, url: string): void;
  back(): void;
  token(): string;
}
export function createTimelineWatchHistory<T>(port: TimelineWatchHistoryPort) {
  const stateKey = port.stateKey ?? TIMELINE_WATCH_HISTORY_KEY;
  let entries: {token: string; value: T}[] = [];
  let index = -1;
  let location = '';
  const stateToken = () => {
    const state = port.state();
    return state && typeof state === 'object' ? (state as Record<string, unknown>)[stateKey] : undefined;
  };
  return {
    current: () => entries[index] || null,
    entries: () => entries.slice(),
    save(value: T) { if (index >= 0) entries[index] = {...entries[index], value}; },
    open(value: T) {
      const nextLocation = location || port.location();
      const branch = port.retainKnownEntries ? entries : entries.slice(0, index + 1);
      const entry = {token: port.token(), value};
      const state = port.state();
      port.push({...(state && typeof state === 'object' ? state : {}), [stateKey]: entry.token}, port.location());
      // Commit only after the native write succeeds (e.g. SecurityError/quota).
      entries = [...branch, entry]; index = entries.length - 1; location = nextLocation;
      return entry;
    },
    restore() {
      const sameLocation = location === port.location();
      const token = stateToken();
      index = sameLocation ? entries.findIndex(entry => entry.token === token) : -1;
      return {entry: entries[index] || null, sameLocation};
    },
    back() {
      if (index < 0 || port.location() !== location || stateToken() !== entries[index].token) return false;
      port.back(); return true;
    },
    clear() { entries = []; index = -1; location = ''; },
  };
}
