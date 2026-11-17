import { create } from 'zustand';
import { useProfileHubStore } from './useProfileHubStore';
import { deferStorageWrite, flushStorageWrite } from '../services/deferredStorage';
import { confirmProfileExecution, fetchProfileExecution, retryProfileExecution, ProfileExecutionApiError, type ConfirmExecutionRequest, type ExecutionBatch } from '../services/profileHubExecutionApi';
import { buildExecutionRequest, executionId, retryTargets } from '../services/profileHubExecutionModel';

const MARKER = 'imagex_profile_hub_execution_v1';
const validId = (id: unknown): id is string => typeof id === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);
function readMarker() { try { const value: unknown = JSON.parse(localStorage.getItem(MARKER) || 'null'); return { id: validId(value) ? value : null, ok: true }; } catch { return { id: null, ok: false }; } }
const initial = readMarker();
let version = 0;
let statusController: AbortController | null = null;
function remember(id: string | null) {
  deferStorageWrite(MARKER, () => JSON.stringify(id), ok => useProfileHubExecutionStore.setState({ storageAvailable: ok }));
  flushStorageWrite(MARKER);
}
interface ExecutionStore {
  draft: ConfirmExecutionRequest | null; batch: ExecutionBatch | null; lastId: string | null;
  retryDraft: { retry_id: string; operation_ids: string[] } | null;
  busy: boolean; checking: boolean; uncertain: boolean; error: string; storageAvailable: boolean;
  confirm: () => Promise<void>; refresh: () => Promise<void>; retry: (rootId?: string) => Promise<void>;
  newReview: () => void; monitor: () => () => void;
}
export const useProfileHubExecutionStore = create<ExecutionStore>((set, get) => ({
  draft: null, batch: null, lastId: initial.id, retryDraft: null, busy: false, checking: false, uncertain: false, error: '', storageAvailable: initial.ok,
  confirm: async () => {
    if (get().busy || get().batch || (get().lastId && !get().draft)) return;
    let draft = get().draft;
    try { draft = draft ?? buildExecutionRequest(useProfileHubStore.getState().profiles, executionId()); }
    catch (error) { set({ error: error instanceof Error ? error.message : 'invalid_execution_request' }); return; }
    const token = ++version;
    statusController?.abort();
    set({ draft, lastId: draft.request_id, busy: true, checking: false, error: '' }); remember(draft.request_id);
    try {
      const batch = await confirmProfileExecution(draft);
      if (token === version && batch.id === draft.request_id) set({ batch, uncertain: false });
    } catch (error) {
      if (token !== version) return;
      const uncertain = !(error instanceof ProfileExecutionApiError) || error.uncertain;
      set({ error: error instanceof Error ? error.message : 'execution_connection_failed', uncertain });
      if (!uncertain) { set({ draft: null, lastId: null }); remember(null); }
    } finally { if (token === version) set({ busy: false }); }
  },
  refresh: async () => {
    const id = get().batch?.id ?? get().draft?.request_id ?? get().lastId;
    if (!id || get().checking || get().busy) return;
    const token = version;
    statusController = new AbortController();
    set({ checking: true });
    try {
      const batch = await fetchProfileExecution(id, statusController.signal);
      if (token === version && batch.id === id) {
        const acknowledged = get().retryDraft && batch.retry_ids.includes(get().retryDraft!.retry_id);
        set({ batch, lastId: id, uncertain: false, error: '', ...(acknowledged ? { retryDraft: null } : {}) });
      }
    } catch (error) {
      if (token === version && !statusController?.signal.aborted) set({ error: error instanceof Error ? error.message : 'execution_connection_failed' });
    } finally { if (token === version) set({ checking: false }); }
  },
  retry: async rootId => {
    const batch = get().batch;
    if (!batch || get().busy) return;
    const operation_ids = retryTargets(batch, rootId);
    if (!operation_ids.length && !get().retryDraft) return;
    const body = get().retryDraft ?? { retry_id: executionId(), operation_ids };
    const token = ++version;
    let refreshAfter = false;
    statusController?.abort();
    set({ retryDraft: body, busy: true, checking: false, error: '' });
    try {
      const updated = await retryProfileExecution(batch.id, body);
      if (token === version && updated.id === batch.id) set({ batch: updated, retryDraft: null, error: '' });
    } catch (error) {
      if (token === version) {
        refreshAfter = error instanceof ProfileExecutionApiError && !error.uncertain;
        set({ error: error instanceof Error ? error.message : 'execution_connection_failed', ...(refreshAfter ? { retryDraft: null } : {}) });
      }
    } finally { if (token === version) set({ busy: false }); }
    if (refreshAfter && token === version) await get().refresh();
  },
  newReview: () => {
    if (get().busy || get().uncertain || get().batch?.active) return;
    ++version; statusController?.abort();
    set({ draft: null, batch: null, retryDraft: null, lastId: null, error: '', uncertain: false, checking: false }); remember(null);
  },
  monitor: () => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const tick = async (first = false) => {
      if (stopped) return;
      if (!get().error) failures = 0;
      if (first || (failures < 4 && (get().batch?.active || (get().lastId && !get().batch && !get().error)))) {
        await get().refresh();
        failures = get().error ? failures + 1 : 0;
      }
      if (!stopped) timer = setTimeout(() => void tick(), Math.min(30000, 2000 * 2 ** failures));
    };
    void tick(true);
    return () => { stopped = true; clearTimeout(timer); statusController?.abort(); };
  },
}));
