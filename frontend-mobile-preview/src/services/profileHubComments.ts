import type { TimelineComment, TimelinePost } from '../components/profile-hub/timeline/timelineModel';

export interface SourceCommentReactions {
  kind: 'like_dislike' | 'like' | 'heart' | 'score' | null;
  like_count: number | null;
  dislike_count: number | null;
  heart_count: number | null;
  vote_score: number | null;
  creator_hearted: boolean | null;
}

export interface SourceTimelineComment extends TimelineComment {
  id?: string;
  parent?: string;
  author_url?: string | null;
  reactions?: SourceCommentReactions;
  replies?: SourceTimelineComment[];
}

export interface ProfileHubCommentsResponse {
  status: 'ready' | 'unsupported' | 'disabled';
  source_url: string;
  comments: SourceTimelineComment[];
  reported_total: number | null;
  complete: boolean;
}

function webUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function timelineCommentsSourceUrl(post: Pick<TimelinePost, 'originalUrl' | 'youtubeId'>): string | null {
  return webUrl(post.originalUrl || (post.youtubeId ? `https://www.youtube.com/watch?v=${encodeURIComponent(post.youtubeId)}` : ''));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid comments response');
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('Invalid comment field');
  return value;
}

// Bound recursive JSON validation to avoid exhausting the stack on malformed payloads.
const MAX_COMMENT_NESTING_DEPTH = 32;
function parseReactions(value: unknown): SourceCommentReactions {
  const item = record(value);
  const kind = item.kind as SourceCommentReactions['kind'];
  if (![null, 'like_dislike', 'like', 'heart', 'score'].includes(kind)) throw new Error('Invalid source reaction kind');
  const count = (value: unknown, signed = false): number | null => {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!signed && value < 0)) throw new Error('Invalid source reaction count');
    return value;
  };
  const like_count = count(item.like_count), dislike_count = count(item.dislike_count);
  const heart_count = count(item.heart_count), vote_score = count(item.vote_score, true);
  if ((item.creator_hearted !== null && typeof item.creator_hearted !== 'boolean') ||
      (kind !== 'like' && kind !== 'like_dislike' && like_count !== null) ||
      (kind !== 'like_dislike' && dislike_count !== null) ||
      (kind !== 'heart' && heart_count !== null) || (kind !== 'score' && vote_score !== null)) throw new Error('Conflicting source reaction metadata');
  return {kind, like_count, dislike_count, heart_count, vote_score, creator_hearted: item.creator_hearted as boolean | null};
}
function parseComment(value: unknown, depth = 0): SourceTimelineComment {
  if (depth > MAX_COMMENT_NESTING_DEPTH) throw new Error('Comment nesting exceeds validation limit');
  const item = record(value);
  if (item.replies != null && !Array.isArray(item.replies)) throw new Error('Invalid comment replies');
  let likes = item.likes;
  if (typeof likes === 'number' && Number.isFinite(likes) && likes >= 0) likes = String(likes);
  const avatar = text(item.avatar);
  // The API supplies origin avatars; missing avatars use the app's local fallback.
  if (avatar && !webUrl(avatar)) throw new Error('Invalid comment avatar');
  const authorUrl = item.author_url == null ? null : webUrl(item.author_url);
  if (item.author_url != null && !authorUrl) throw new Error('Invalid comment author URL');
  if (item.hidden !== undefined && item.hidden !== null && typeof item.hidden !== 'boolean') {
    throw new Error('Invalid comment hidden flag');
  }
  return {
    author: text(item.author), handle: text(item.handle), avatar,
    time: text(item.time), likes: text(likes), text: text(item.text),
    ...(item.id != null ? {id: text(item.id)} : {}),
    ...(item.parent != null ? {parent: text(item.parent)} : {}),
    ...(item.author_url !== undefined ? {author_url: authorUrl} : {}),
    ...(item.reactions !== undefined ? {reactions: parseReactions(item.reactions)} : {}),
    ...(item.hidden === true ? {hidden: true} : {}),
    replies: Array.isArray(item.replies) ? item.replies.map(reply => parseComment(reply, depth + 1)) : [],
  };
}

export function parseProfileHubCommentsResponse(value: unknown): ProfileHubCommentsResponse {
  const payload = record(value);
  const status = payload.status;
  const sourceUrl = webUrl(payload.source_url);
  if (typeof status !== 'string' || !['ready', 'unsupported', 'disabled'].includes(status) || !sourceUrl ||
      !Array.isArray(payload.comments) || typeof payload.complete !== 'boolean' ||
      !(payload.reported_total === null || (typeof payload.reported_total === 'number' &&
        Number.isSafeInteger(payload.reported_total) && payload.reported_total >= 0))) {
    throw new Error('Invalid comments response');
  }
  const comments = payload.comments.map(comment => parseComment(comment));
  if (status !== 'ready' && comments.length) throw new Error('Unavailable comments cannot contain results');
  if (status === 'ready' && !comments.length && !payload.complete) throw new Error('Unconfirmed empty comments');
  return {status: status as ProfileHubCommentsResponse['status'], source_url: sourceUrl,
    comments, reported_total: payload.reported_total as number | null, complete: payload.complete};
}

export async function fetchProfileHubComments(url: string, signal: AbortSignal): Promise<ProfileHubCommentsResponse> {
  if (!webUrl(url)) throw new Error('Invalid comments source');
  const response = await fetch(`/api/profile-hub/comments?${new URLSearchParams({url})}`, {signal});
  if (!response.ok) throw new Error(`Comments request failed (${response.status})`);
  return parseProfileHubCommentsResponse(await response.json());
}
