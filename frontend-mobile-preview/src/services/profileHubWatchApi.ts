import { engagementSourceUrl } from './profileHubEngagement';
import { parseProfileHubCommentsResponse, SourceTimelineComment } from './profileHubComments';

export interface WatchComment extends SourceTimelineComment { id: string; parent: string; reply_count: number | null; reply_context_available?: boolean; }
export interface WatchCommentsPage {
  status: 'ready' | 'unsupported' | 'disabled'; source_url: string;
  entries: WatchComment[]; reported_total: number | null; complete: boolean; next_cursor: string | null;
}
export type WatchArtistRole = 'performer' | 'creator' | 'channel' | null;
export interface WatchVideoArtist {
  name: string;
  url: string;
  avatar_url: string | null;
  role: WatchArtistRole;
  verified: boolean;
}
export interface WatchVideoDetails {
  status: 'ready' | 'unsupported'; source_url: string;
  title: string | null; description: string | null; author_name: string | null; author_url: string | null;
  author_avatar_url: string | null; audience_count_text: string | null; audience_kind: 'subscribers' | 'followers' | null;
  artists: WatchVideoArtist[];
  reaction_kind: 'like_dislike' | 'heart' | 'like' | null;
  like_count: number | null; dislike_count: number | null; comment_count: number | null;
}
export class WatchCommentsCursorExpired extends Error {
  constructor() {super('Source comment context expired');this.name='WatchCommentsCursorExpired';}
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid watch response');
  return value as Record<string, unknown>;
}
function count(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid watch count');
  return value;
}
function optionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Invalid watch text');
  return value;
}
function parseWatchArtists(raw: unknown): WatchVideoArtist[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Invalid watch artists');
  const artists: WatchVideoArtist[] = [];
  for (const item of raw) {
    const entry = record(item);
    const name = typeof entry.name === 'string' ? entry.name.replace(/\s+/g, ' ').trim() : '';
    const url = engagementSourceUrl(entry.url);
    if (!name || !url) throw new Error('Invalid watch artist entry');
    const avatar_url = entry.avatar_url == null ? null : engagementSourceUrl(entry.avatar_url);
    if (entry.avatar_url != null && !avatar_url) throw new Error('Invalid watch artist avatar URL');
    const role = (entry.role ?? null) as WatchArtistRole;
    if (![null, 'performer', 'creator', 'channel'].includes(role)) throw new Error('Invalid watch artist role');
    if (entry.verified !== undefined && typeof entry.verified !== 'boolean') throw new Error('Invalid watch artist verified flag');
    artists.push({name, url, avatar_url, role, verified: Boolean(entry.verified)});
  }
  return artists;
}
async function request(path: string, url: string, signal: AbortSignal, extra: Record<string, string> = {}) {
  const normalized = engagementSourceUrl(url);
  if (!normalized) throw new Error('Invalid watch source');
  const response = await fetch(`${path}?${new URLSearchParams({url: normalized, ...extra})}`, {signal});
  if (!response.ok) {
    if (path.endsWith('/comments-page') && response.status === 410) throw new WatchCommentsCursorExpired();
    throw new Error(`Watch request failed (HTTP ${response.status})`);
  }
  const data = record(await response.json());
  if (engagementSourceUrl(data.source_url) !== normalized) throw new Error('Watch source mismatch');
  return data;
}
export async function fetchWatchVideoDetails(url: string, signal: AbortSignal): Promise<WatchVideoDetails> {
  const data = await request('/api/profile-hub/video-details', url, signal);
  if (!['ready', 'unsupported'].includes(String(data.status)) || ![null, 'like_dislike', 'heart', 'like'].includes(data.reaction_kind as null)) throw new Error('Invalid video details');
  const author_url = data.author_url === null ? null : engagementSourceUrl(data.author_url);
  if (data.author_url !== null && !author_url) throw new Error('Invalid author URL');
  // Added metadata stays optional at the wire boundary for older running servers.
  const author_avatar_url = data.author_avatar_url == null ? null : engagementSourceUrl(data.author_avatar_url);
  if (data.author_avatar_url != null && !author_avatar_url) throw new Error('Invalid creator avatar URL');
  const audience_count_text = optionalText(data.audience_count_text ?? null);
  const audience_kind = data.audience_kind ?? null;
  if (![null, 'subscribers', 'followers'].includes(audience_kind as null) || Boolean(audience_count_text) !== Boolean(audience_kind)) throw new Error('Invalid source audience label');
  const artists = parseWatchArtists(data.artists);
  return {status: data.status as WatchVideoDetails['status'], source_url: String(data.source_url),
    title: optionalText(data.title), description: optionalText(data.description), author_name: optionalText(data.author_name), author_url,
    author_avatar_url, audience_count_text, audience_kind: audience_kind as WatchVideoDetails['audience_kind'], artists,
    reaction_kind: data.reaction_kind as WatchVideoDetails['reaction_kind'], like_count: count(data.like_count), dislike_count: count(data.dislike_count), comment_count: count(data.comment_count)};
}
export async function fetchWatchCommentsPage(url: string, signal: AbortSignal, cursor?: string, parentId?: string): Promise<WatchCommentsPage> {
  const extra: Record<string,string> = {};
  if (cursor) extra.cursor = cursor;
  if (parentId) extra.parent_id = parentId;
  const data = await request('/api/profile-hub/comments-page', url, signal, extra);
  if (!Array.isArray(data.entries) || typeof data.complete !== 'boolean' || (data.next_cursor !== null && (typeof data.next_cursor !== 'string' || !data.next_cursor.length))) throw new Error('Invalid comment page');
  // Legacy /comments rejects unconfirmed emptiness. Cursor pages may legitimately
  // contain only a continuation/header, so validate the fields through the shared
  // boundary and preserve the real completion flag separately.
  const parsed = parseProfileHubCommentsResponse({...data, comments: data.entries,
    complete:data.complete || (data.entries.length === 0 && data.next_cursor !== null)});
  const entries = parsed.comments.map((entry, i) => {
    const raw = record((data.entries as unknown[])[i]);
    if (!entry.id || !entry.parent || entry.replies?.length) throw new Error('Invalid comment identity');
    if (raw.reply_context_available !== undefined && typeof raw.reply_context_available !== 'boolean') throw new Error('Invalid reply context capability');
    return {...entry, id: entry.id, parent: entry.parent, reply_count: count(raw.reply_count ?? null), reply_context_available:raw.reply_context_available as boolean | undefined};
  });
  if (data.complete && data.next_cursor !== null) throw new Error('Complete page has cursor');
  return {...parsed, entries, complete:data.complete, next_cursor: data.next_cursor as string | null};
}
