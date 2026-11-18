import { create } from 'zustand';
import { deferStorageWrite, flushStorageWrite } from '../services/deferredStorage';
import { createDurableShortcutSync } from '../services/durableShortcutSync';

export interface SavedDirectory { id: string; name: string; url: string; pinned: boolean }
const KEY = 'imagex_saved_directories_v1';
export function directoryIdentity(value: string): string | null {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null; url.hash = ''; url.searchParams.sort(); return url.href; } catch { return null; }
}
function read(): { items: SavedDirectory[]; available: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return { items: [], available: false };
    const items: SavedDirectory[] = [];
    for (const d of raw) if (d && typeof d.id === 'string' && typeof d.name === 'string' && d.name.trim() && typeof d.url === 'string' && directoryIdentity(d.url) && !items.some(x => x.id === d.id || directoryIdentity(x.url) === directoryIdentity(d.url))) items.push({ id: d.id, name: d.name, url: d.url, pinned: d.pinned === true });
    return { items, available: true };
  } catch { return { items: [], available: false }; }
}
const initial = read();
export const useSavedDirectoriesStore = create<{
  items: SavedDirectory[]; available: boolean;
  save: (item: SavedDirectory) => boolean;
  remove: (id: string) => void;
  initSync: () => Promise<void>;
}>((set, get) => {
  let localAvailable = initial.available;
  let serverAvailable = true;
  const persist = (items: SavedDirectory[]) => { set({ items }); deferStorageWrite(KEY, () => JSON.stringify(items), available => { localAvailable = available; set({ available: available && serverAvailable }); }); flushStorageWrite(KEY); };
  const durable = createDurableShortcutSync<SavedDirectory>({
    journalKey: 'imagex_saved_directories_sync_v1', endpoint: '/api/profile-hub/saved-directories',
    identity: item => item.id, items: () => get().items, apply: persist,
    availability: available => { serverAvailable = available; set({ available: available && localAvailable }); },
    body: (item, removed) => ({ item, removed }),
    bootstrap: value => (value as { initialized?: unknown })?.initialized === false,
    decode: value => {
      const entries = (value as { directories?: unknown })?.directories;
      if (!Array.isArray(entries)) throw new Error('Invalid directory response');
      return entries.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim() && directoryIdentity(item.url));
    },
  });
  return { items: initial.items, available: initial.available,
    save: item => {
      const url = directoryIdentity(item.url);
      if (!url || !item.name.trim() || get().items.some(x => x.id !== item.id && directoryIdentity(x.url) === url)) return false;
      const previous = get().items;
      const entry = { ...item, url, name: item.name.trim() };
      persist(previous.some(x => x.id === item.id) ? previous.map(x => x.id === item.id ? entry : x) : [...previous, entry]); durable.enqueue(entry, false); return true;
    }, remove: id => { const removed = get().items.find(item => item.id === id); persist(get().items.filter(x => x.id !== id)); if (removed) durable.enqueue(removed, true); },
    initSync: durable.synchronize,
  };
});
