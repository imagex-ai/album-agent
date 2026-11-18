/** Explicit shortcut edits use an outbox, so retries send the desired state,
 * never a toggle. A successful server read replaces stale browser snapshots. */
export function createDurableShortcutSync<T>(options: {
  journalKey: string;
  endpoint: string;
  identity: (item: T) => string;
  items: () => T[];
  apply: (items: T[]) => void;
  decode: (value: unknown) => T[];
  bootstrap?: (value: unknown) => boolean;
  body: (item: T, removed: boolean) => unknown;
  availability: (available: boolean) => void;
}) {
  type Edit = { item: T; removed: boolean };
  let pending: Record<string, Edit> = {};
  let initialized = false;
  let generation = 0;
  let running: Promise<void> | null = null;
  try {
    const saved = JSON.parse(localStorage.getItem(options.journalKey) || 'null');
    if (saved && saved.version === 1 && saved.pending && typeof saved.pending === 'object' && !Array.isArray(saved.pending)) {
      pending = saved.pending;
      initialized = saved.initialized === true;
    }
  } catch { /* Server hydration remains available without browser storage. */ }
  const persist = () => {
    try { localStorage.setItem(options.journalKey, JSON.stringify({ version: 1, initialized, pending })); }
    catch { /* The live operation can still be committed to the server. */ }
  };
  const synchronize = (): Promise<void> => {
    if (running) return running;
    if (typeof window === 'undefined') return Promise.resolve();
    running = (async () => {
      try {
        if (!initialized) {
          const response = await fetch(options.endpoint);
          if (!response.ok) throw new Error('Shortcut initialization failed');
          const initial = await response.json();
          options.decode(initial); // Validate before recording initialization.
          // Only bootstrap browser directories when the server has never had a
          // collection. An intentionally empty server collection stays empty.
          if (options.bootstrap?.(initial)) {
            for (const item of options.items()) {
              const id = options.identity(item);
              if (!pending[id]) pending[id] = { item, removed: false };
            }
          }
          initialized = true; persist();
        }
        for (;;) {
          for (const [id, edit] of Object.entries(pending)) {
            const response = await fetch(options.endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body(edit.item, edit.removed)) });
            if (!response.ok) throw new Error('Shortcut write failed');
            if (pending[id] === edit) { delete pending[id]; persist(); }
          }
          if (Object.keys(pending).length) continue;
          const checkpoint = generation;
          const response = await fetch(options.endpoint);
          if (!response.ok) throw new Error('Shortcut read failed');
          const remote = options.decode(await response.json());
          if (checkpoint !== generation) continue;
          options.apply(remote);
          options.availability(true);
          break;
        }
      } catch { options.availability(false); }
    })().finally(() => { running = null; });
    return running;
  };
  return {
    synchronize,
    enqueue(item: T, removed: boolean) {
      pending[options.identity(item)] = { item, removed };
      generation++; persist();
      void synchronize();
    },
  };
}
