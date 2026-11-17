import { engagementSourceUrl } from './profileHubEngagement';

export interface ProfileHubRelatedVideo {
  id: string;
  source_url: string;
  title: string | null;
  thumbnail_url: string | null;
  duration: string | null;
  author_name: string | null;
  author_url: string | null;
}
export interface ProfileHubRelatedResponse {
  status: 'ready' | 'unsupported';
  source_url: string;
  videos: ProfileHubRelatedVideo[];
  complete: boolean;
}
export function parseProfileHubRelated(value: unknown): ProfileHubRelatedResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid related response');
  const data = value as Record<string, unknown>;
  const source = engagementSourceUrl(data.source_url);
  if (!source || !['ready', 'unsupported'].includes(String(data.status)) || !Array.isArray(data.videos) || typeof data.complete !== 'boolean') throw new Error('Invalid related response');
  const seen = new Set<string>();
  const ids = new Set<string>();
  const optionalText = (v: unknown): string | null => {
    if (v === null) return null;
    if (typeof v !== 'string') throw new Error('Invalid related text');
    return v;
  };
  const optionalUrl = (v: unknown): string | null => {
    if (v === null) return null;
    const url = engagementSourceUrl(v);
    if (!url) throw new Error('Invalid related URL');
    return url;
  };
  const videos: ProfileHubRelatedVideo[] = [];
  for (const raw of data.videos) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid related video');
    const item = raw as Record<string, unknown>;
    const url = engagementSourceUrl(item.source_url);
    if (!url || typeof item.id !== 'string' || !item.id.trim()) throw new Error('Invalid related identity');
    const video = {id: item.id, source_url: url, title: optionalText(item.title), thumbnail_url: optionalUrl(item.thumbnail_url), duration: optionalText(item.duration), author_name: optionalText(item.author_name), author_url: optionalUrl(item.author_url)};
    if (url === source || seen.has(url) || ids.has(video.id)) continue;
    seen.add(url); ids.add(video.id); videos.push(video);
  }
  if (data.status === 'unsupported' && videos.length) throw new Error('Unsupported related response contains videos');
  return {status: data.status as ProfileHubRelatedResponse['status'], source_url: source, videos, complete: data.complete};
}
export async function fetchProfileHubRelated(source: string, signal: AbortSignal): Promise<ProfileHubRelatedResponse> {
  const url = engagementSourceUrl(source);
  if (!url) throw new Error('Invalid related source');
  const response = await fetch(`/api/profile-hub/related?${new URLSearchParams({url})}`, {signal});
  if (!response.ok) throw new Error(`Related request failed (HTTP ${response.status})`);
  const data = parseProfileHubRelated(await response.json());
  if (data.source_url !== url) throw new Error('Related source mismatch');
  return data;
}
