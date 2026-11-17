export type ExecutionState = 'queued' | 'resolving' | 'running' | 'succeeded' | 'failed' | 'interrupted';
export interface ExecutionMedia { id: string; kind: 'video' | 'playlist' | 'album' | 'photo' | 'gif'; url: string; title: string; thumbnail_url?: string; collection_url?: string; duration?: string }
export interface ExecutionProfile { profile_key: string; profile_url: string; profile_name: string; video_folder: string | null; gallery_folder: string | null; video_mode: 'web_stream' | 'download' | null; items: ExecutionMedia[] }
export interface ConfirmExecutionRequest { request_id: string; confirmed: true; profiles: ExecutionProfile[] }
export interface ExecutionErrorDetails { reported_count: number; found_count: number; page_count: number }
export interface ExecutionOperation { id: string; profile_key: string; profile_url: string; profile_name: string; kind: ExecutionMedia['kind']; destination: string; mode: string; items: ExecutionMedia[]; status: ExecutionState; resolved: boolean; unit_ids: string[]; error: string | null; error_details?: ExecutionErrorDetails | null }
export interface ExecutionUnit { id: string; profile_key: string; profile_url: string; profile_name: string; kind: 'video' | 'gallery'; destination: string; mode: string; source_url: string; title: string; status: ExecutionState; attempts: number; job_id: string | null; error: string | null; result: { artifact_id: string; saved_count: number; mode: string; destination: string } | null; progress: { current?: number; total?: number; percent?: number; status?: string; downloaded_bytes?: number; total_bytes?: number } }
export interface ExecutionBatch { id: string; created_at: number; active: boolean; operations: ExecutionOperation[]; units: ExecutionUnit[]; retry_ids: string[] }
export class ProfileExecutionApiError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
  get uncertain() { return this.status === 0 || this.status >= 500 || this.status === 408 || this.code === 'request_id_conflict'; }
}
function batchShape(data: any): boolean {
  const states = ['queued', 'resolving', 'running', 'succeeded', 'failed', 'interrupted'];
  if (!data || typeof data.id !== 'string' || !Array.isArray(data.operations) || !Array.isArray(data.units) || typeof data.active !== 'boolean') return false;
  const members = new Set(data.units.map((unit: any) => unit?.id));
  return data.operations.every((op: any) => op && typeof op.id === 'string' && typeof op.profile_name === 'string' && typeof op.destination === 'string'
    && ['video', 'playlist', 'album', 'photo', 'gif'].includes(op.kind) && states.includes(op.status) && Array.isArray(op.items) && op.items.length > 0
    && op.items.every((item: any) => item && typeof item.id === 'string' && typeof item.title === 'string')
    && (op.error_details == null || ['reported_count', 'found_count', 'page_count'].every(key => Number.isSafeInteger(op.error_details[key]) && op.error_details[key] >= 0))
    && Array.isArray(op.unit_ids) && op.unit_ids.every((id: any) => typeof id === 'string' && members.has(id)))
    && data.units.every((unit: any) => unit && typeof unit.id === 'string' && typeof unit.title === 'string' && typeof unit.source_url === 'string'
      && states.includes(unit.status) && unit.progress && typeof unit.progress === 'object');
}
async function request(path: string, body?: unknown, signal?: AbortSignal, expectedId?: string): Promise<ExecutionBatch> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 30000);
  try {
    const response = await fetch(`/api/profile-hub/executions${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ProfileExecutionApiError(typeof data?.detail === 'string' ? data.detail : 'invalid_execution_request', response.status);
    if (!batchShape(data) || (expectedId && data.id !== expectedId)) throw new ProfileExecutionApiError('invalid_execution_response');
    return { ...data, retry_ids: Array.isArray(data.retry_ids) ? data.retry_ids : [] };
  } catch (error) {
    if (error instanceof ProfileExecutionApiError) throw error;
    throw new ProfileExecutionApiError('execution_connection_failed');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const confirmProfileExecution = (body: ConfirmExecutionRequest) => request('', body, undefined, body.request_id);
export const fetchProfileExecution = (id: string, signal?: AbortSignal) => request(`/${encodeURIComponent(id)}`, undefined, signal, id);
export const retryProfileExecution = (id: string, body: { retry_id: string; operation_ids?: string[] }) => request(`/${encodeURIComponent(id)}/retry`, body, undefined, id);
