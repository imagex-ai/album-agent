/** Directory DTOs shared by all adapters; source-specific recognition stays on the server. */
export interface DirectoryProfile {
  key: string; source_url: string; name: string | null; image_url: string | null;
  description: string | null; rank: number | null; video_count: number | null;
  photo_count: number | null; album_count: number | null; provenance_page_url: string;
  gender?: 'female' | 'male' | 'trans' | null;
}
export interface DirectoryPage {
  contract_version: 1; adapter_id: string; directory_key: string; query_key: string;
  source_url: string; page_url: string; items: DirectoryProfile[]; loaded_count: number;
  page_complete: boolean; directory_complete: boolean; warnings: string[];
  pagination: { current_page: number; links: { url: string; page: number }[];
    previous_url: string | null; next_url: string | null; has_more: boolean | null; reported_total: number | null };
  capabilities: { all_url?: string | null; query_url?: string | null; active_letter?: string | null; active_category?: string | null;
    alphabet_links: Record<string, string>; category_links: Record<string, string>;
    remote_filters: { name: string; kind: 'choice' | 'number'; multiple: boolean;
      choices: { value: string; label: string }[]; minimum: number | null; maximum: number | null }[];
    name_search_scope: 'loaded_profiles'; source_order: 'rank' | 'source'; local_sort_fields: string[] };
}

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/profile-directory/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.detail?.code || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function resolveProfileHubInput(url: string, signal: AbortSignal) {
  const result = await post<{ kind: 'directory' | 'profile' | 'existing_profile_scan'; url: string; adapter_id: string | null }>('resolve', { url }, signal);
  if (!['directory', 'profile', 'existing_profile_scan'].includes(result.kind) || typeof result.url !== 'string') {
    throw new Error('invalid_profile_hub_resolution');
  }
  return result;
}

export async function discoverProfileDirectory(url: string, signal: AbortSignal, pageUrl?: string) {
  const page = await post<DirectoryPage>('discover', { url, ...(pageUrl ? { page_url: pageUrl } : {}) }, signal);
  if (page.contract_version !== 1 || typeof page.query_key !== 'string' || !Array.isArray(page.items)
      || typeof page.page_url !== 'string' || !page.pagination || !page.capabilities
      || page.items.some(item => typeof item.key !== 'string' || typeof item.source_url !== 'string')) {
    throw new Error('invalid_directory_response');
  }
  return page;
}

export interface ProfileMeta {
  image_url: string | null;
  description: string | null;
  video_count: number | null;
  photo_count: number | null;
  gender?: 'female' | 'male' | 'trans' | null;
}

export async function fetchBatchProfileMeta(urls: string[], signal?: AbortSignal): Promise<Record<string, ProfileMeta>> {
  if (!urls.length) return {};
  try {
    const res = await post<{ profiles: Record<string, ProfileMeta> }>('batch-meta', { urls }, signal ?? new AbortController().signal);
    return res.profiles ?? {};
  } catch {
    return {};
  }
}
