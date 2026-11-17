export type AvatarResolutionStatus = 'found' | 'not_found' | 'error' | 'invalid';

export interface AvatarResolutionItem {
  url: string;
  canonical_url: string | null;
  provider: string;
  status: AvatarResolutionStatus;
  avatar_url: string | null;
  confirmed_empty: boolean;
  cached: boolean;
  error_code: string | null;
}

const PRIVATE_IPV4_RE = /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

export function safeAvatarSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return null;
    }
    if (PRIVATE_IPV4_RE.test(host)) return null;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function parseBatchAvatarResponse(payload: unknown): Record<string, AvatarResolutionItem> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid avatar resolution payload');
  }
  const resultsRaw = (payload as Record<string, unknown>).results;
  if (!resultsRaw || typeof resultsRaw !== 'object' || Array.isArray(resultsRaw)) {
    throw new Error('Invalid avatar resolution results');
  }

  const parsed: Record<string, AvatarResolutionItem> = {};
  for (const [key, itemRaw] of Object.entries(resultsRaw as Record<string, unknown>)) {
    if (!itemRaw || typeof itemRaw !== 'object' || Array.isArray(itemRaw)) continue;
    const rec = itemRaw as Record<string, unknown>;
    const status = String(rec.status || 'error') as AvatarResolutionStatus;
    if (!['found', 'not_found', 'error', 'invalid'].includes(status)) continue;

    const avatarUrl = status === 'found' ? safeAvatarSourceUrl(rec.avatar_url) : null;
    parsed[key] = {
      url: typeof rec.url === 'string' ? rec.url : key,
      canonical_url: safeAvatarSourceUrl(rec.canonical_url),
      provider: typeof rec.provider === 'string' ? rec.provider : 'generic',
      status: status === 'found' && !avatarUrl ? 'error' : status,
      avatar_url: avatarUrl,
      confirmed_empty: status === 'not_found' && Boolean(rec.confirmed_empty),
      cached: Boolean(rec.cached),
      error_code: typeof rec.error_code === 'string' ? rec.error_code : null,
    };
  }
  return parsed;
}

export async function fetchResolvedAvatars(
  urls: string[],
  options?: { force?: boolean; signal?: AbortSignal }
): Promise<Record<string, AvatarResolutionItem>> {
  const sanitized = urls
    .map((u) => safeAvatarSourceUrl(u))
    .filter((u): u is string => Boolean(u));
  if (sanitized.length === 0) return {};

  const response = await fetch('/api/profile-hub/avatars/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: sanitized.slice(0, 24),
      force: Boolean(options?.force),
    }),
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(`Avatar batch resolve failed (HTTP ${response.status})`);
  }
  return parseBatchAvatarResponse(await response.json());
}
