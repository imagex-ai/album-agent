import {
  TimelineCreator,
  TimelinePost,
  sanitizeCreatorHandle,
  timelinePublicationTime,
} from '../components/profile-hub/timeline/timelineModel';
import {
  LibraryMediaItem,
  LibraryPlaylist,
  canonicalLibraryMediaKey,
  coerceLibraryMediaKind,
} from './profileHubLibraryModel';

export interface ForYouSignalInput {
  creators?: TimelineCreator[];
  history?: LibraryMediaItem[];
  liked?: LibraryMediaItem[];
  favorites?: LibraryMediaItem[];
  playlists?: LibraryPlaylist[];
  likedPostIds?: Record<string, boolean>;
  favoritedPostIds?: Record<string, boolean>;
  savedPostIds?: Record<string, boolean>;
}

interface CreatorWeightProfile {
  byId: Map<string, number>;
  byHandle: Map<string, number>;
  byName: Map<string, number>;
  byUrl: Map<string, number>;
}

interface UserTasteProfile {
  hasSignals: boolean;
  keywords: Map<string, number>;
  creators: CreatorWeightProfile;
  platforms: Map<string, number>;
  kinds: Map<string, number>;
  watchedRecencyByKey: Map<string, number>;
  watchedRecencyById: Map<string, number>;
  positiveKeys: Set<string>;
  positivePostIds: Set<string>;
}

const SIGNAL_WEIGHT_PLAYLIST_BASE = 4.0;
const SIGNAL_WEIGHT_PLAYLIST_EXTRA = 0.5;
const SIGNAL_WEIGHT_PLAYLIST_CAP = 5.5;
const SIGNAL_WEIGHT_LIKED = 3.5;
const SIGNAL_WEIGHT_FAVORITE = 3.0;
const SIGNAL_WEIGHT_SAVED_POST = 2.4;
const SIGNAL_WEIGHT_HISTORY_BASE = 1.5;
const SIGNAL_WEIGHT_SAVED_CREATOR = 0.8;

const FRESHNESS_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const UNSEEN_DISCOVERY_BONUS = 1.6;
const WATCHED_NOVELTY_PENALTY = 8.5;

const IMMEDIATE_REPEAT_PENALTY = 3.2;
const WINDOW_REPEAT_PENALTY = 1.4;
const CREATOR_WINDOW_SIZE = 4;
const MAX_CONSECUTIVE_SAME_CREATOR = 2;

const STOPWORDS = new Set([
  // English articles, conjunctions, prepositions, filler words
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those', 'into', 'onto',
  'about', 'after', 'before', 'over', 'under', 'your', 'you', 'our', 'their', 'his', 'her',
  'she', 'him', 'its', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'not', 'but',
  'out', 'off', 'all', 'any', 'can', 'will', 'just', 'more', 'most', 'very', 'how', 'why',
  'who', 'what', 'when', 'where', 'part', 'best', 'new', 'hot', 'top', 'full', 'official',
  'watch', 'video', 'videos', 'clip', 'clips', 'hd', 'uhd', '4k', '1080p', '720p', '60fps',
  // Portuguese stopwords & common fillers
  'para', 'com', 'sem', 'que', 'uma', 'uns', 'umas', 'das', 'dos', 'nos', 'nas', 'pelos',
  'pelas', 'pelo', 'pela', 'por', 'como', 'mais', 'menos', 'muito', 'muita', 'muitos',
  'muitas', 'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas', 'isso',
  'isto', 'aquilo', 'sobre', 'entre', 'apos', 'antes', 'depois', 'onde', 'quando', 'quem',
  'qual', 'quais', 'melhor', 'melhores', 'novo', 'nova', 'novos', 'novas', 'hoje', 'agora',
  'aqui', 'ali', 'voce', 'voces', 'meu', 'minha', 'seu', 'sua', 'seus', 'suas', 'assistir',
  'ver', 'parte', 'completo', 'completa',
  // Domain noise
  'http', 'https', 'www', 'com', 'net', 'org', 'pornhub', 'eporner', 'xhamster', 'youtube',
]);

function normalizeText(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isUnknownCreatorLabel(name: string): boolean {
  return (
    !name ||
    name === 'unknown' ||
    name === 'unknown creator' ||
    name === 'criador desconhecido'
  );
}

export function extractTopicTokens(...texts: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    const normalized = normalizeText(text);
    const parts = normalized.split(/[^a-z0-9]+/);
    for (const part of parts) {
      if (part.length < 3) continue;
      if (/^\d+$/.test(part)) continue;
      if (STOPWORDS.has(part)) continue;
      if (!seen.has(part)) {
        seen.add(part);
        tokens.push(part);
      }
    }
  }
  return tokens;
}

function normalizeUrlKey(raw?: string | null): string {
  if (!raw) return '';
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

function bumpMap(map: Map<string, number>, key: string, delta: number): void {
  if (!key || !Number.isFinite(delta) || delta <= 0) return;
  map.set(key, (map.get(key) || 0) + delta);
}

function addCreatorAffinity(
  profile: CreatorWeightProfile,
  weight: number,
  info: {
    id?: string | null;
    handle?: string | null;
    name?: string | null;
    url?: string | null;
  }
): void {
  const cleanId = (info.id || '').trim().toLowerCase();
  if (cleanId && cleanId !== 'library') bumpMap(profile.byId, cleanId, weight);

  const cleanHandle = sanitizeCreatorHandle(info.handle).toLowerCase();
  if (cleanHandle) bumpMap(profile.byHandle, cleanHandle, weight);

  const cleanName = normalizeText(info.name).trim();
  if (!isUnknownCreatorLabel(cleanName)) bumpMap(profile.byName, cleanName, weight);

  const cleanUrl = normalizeUrlKey(info.url);
  if (cleanUrl) bumpMap(profile.byUrl, cleanUrl, weight);
}

function buildPostCanonicalKey(post: TimelinePost): string {
  return canonicalLibraryMediaKey({
    id: post.id,
    sourceUrl: post.originalUrl || post.albumUrl || post.playlistUrl || post.sourcePage || post.videoUrl,
    originalUrl: post.originalUrl,
    pageUrl: post.sourcePage,
  });
}

function computeHistoryRecency(timestampMs: number | undefined, nowMs: number, halfLifeMs: number): number {
  if (!timestampMs || !Number.isFinite(timestampMs)) return 0.6;
  const ageMs = Math.max(0, nowMs - timestampMs);
  return Math.max(0.15, Math.exp((-ageMs / halfLifeMs) * Math.LN2));
}

function contributeFeatures(
  profile: UserTasteProfile,
  weight: number,
  entry: {
    title?: string;
    caption?: string;
    tags?: string[];
    creatorId?: string;
    creatorHandle?: string;
    creatorName?: string;
    creatorUrl?: string;
    platform?: string;
    kind?: string;
  }
): void {
  if (!Number.isFinite(weight) || weight <= 0) return;
  profile.hasSignals = true;

  const tokens = extractTopicTokens(entry.title, entry.caption, ...(entry.tags || []));
  if (tokens.length > 0) {
    const perTokenWeight = weight / Math.sqrt(tokens.length);
    for (const token of tokens) {
      bumpMap(profile.keywords, token, perTokenWeight);
    }
  }

  addCreatorAffinity(profile.creators, weight, {
    id: entry.creatorId,
    handle: entry.creatorHandle,
    name: entry.creatorName,
    url: entry.creatorUrl,
  });

  const cleanPlatform = (entry.platform || '').trim().toLowerCase();
  if (cleanPlatform) {
    bumpMap(profile.platforms, cleanPlatform, weight * 0.45);
  }

  if (entry.kind) {
    bumpMap(profile.kinds, coerceLibraryMediaKind(entry.kind), weight * 0.35);
  }
}

function buildUserTasteProfile(
  posts: TimelinePost[],
  signals: ForYouSignalInput,
  nowMs: number
): UserTasteProfile {
  const profile: UserTasteProfile = {
    hasSignals: false,
    keywords: new Map(),
    creators: {
      byId: new Map(),
      byHandle: new Map(),
      byName: new Map(),
      byUrl: new Map(),
    },
    platforms: new Map(),
    kinds: new Map(),
    watchedRecencyByKey: new Map(),
    watchedRecencyById: new Map(),
    positiveKeys: new Set(),
    positivePostIds: new Set(),
  };

  const playlistOccurrenceCount = new Map<string, { item: LibraryMediaItem; count: number }>();
  for (const playlist of signals.playlists || []) {
    for (const item of playlist.items || []) {
      const key = item.key || canonicalLibraryMediaKey(item);
      if (!key) continue;
      const existing = playlistOccurrenceCount.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        playlistOccurrenceCount.set(key, { item, count: 1 });
      }
    }
  }
  for (const [key, entry] of playlistOccurrenceCount.entries()) {
    profile.positiveKeys.add(key);
    profile.positivePostIds.add(entry.item.id);
    const weight = Math.min(
      SIGNAL_WEIGHT_PLAYLIST_CAP,
      SIGNAL_WEIGHT_PLAYLIST_BASE + Math.max(0, entry.count - 1) * SIGNAL_WEIGHT_PLAYLIST_EXTRA
    );
    contributeFeatures(profile, weight, entry.item);
  }

  const seenLikedKeys = new Set<string>();
  for (const item of signals.liked || []) {
    const key = item.key || canonicalLibraryMediaKey(item);
    if (!key || seenLikedKeys.has(key)) continue;
    seenLikedKeys.add(key);
    profile.positiveKeys.add(key);
    profile.positivePostIds.add(item.id);
    contributeFeatures(profile, SIGNAL_WEIGHT_LIKED, item);
  }

  const seenFavKeys = new Set<string>();
  for (const item of signals.favorites || []) {
    const key = item.key || canonicalLibraryMediaKey(item);
    if (!key || seenFavKeys.has(key)) continue;
    seenFavKeys.add(key);
    profile.positiveKeys.add(key);
    profile.positivePostIds.add(item.id);
    contributeFeatures(profile, SIGNAL_WEIGHT_FAVORITE, item);
  }

  for (const item of signals.history || []) {
    const key = item.key || canonicalLibraryMediaKey(item);
    const recency = computeHistoryRecency(item.watchedAt || item.addedAt, nowMs, HISTORY_RECENCY_HALF_LIFE_MS);
    if (key) {
      profile.watchedRecencyByKey.set(
        key,
        Math.max(profile.watchedRecencyByKey.get(key) || 0, recency)
      );
    }
    if (item.id) {
      profile.watchedRecencyById.set(
        item.id,
        Math.max(profile.watchedRecencyById.get(item.id) || 0, recency)
      );
    }
    const replayFactor = Math.min(2.0, 1 + 0.35 * Math.log1p(Math.max(0, (item.watchCount || 1) - 1)));
    contributeFeatures(profile, SIGNAL_WEIGHT_HISTORY_BASE * recency * replayFactor, item);
  }

  // Merge in-session feed/watch toggles that may not be present in library arrays yet.
  const postById = new Map<string, TimelinePost>();
  for (const post of posts) postById.set(post.id, post);

  const contributePostToggle = (
    flagMap: Record<string, boolean> | undefined,
    dedupeSet: Set<string>,
    weight: number
  ) => {
    if (!flagMap) return;
    for (const [postId, enabled] of Object.entries(flagMap)) {
      if (!enabled) continue;
      const post = postById.get(postId);
      if (!post) continue;
      const key = buildPostCanonicalKey(post);
      if ((key && dedupeSet.has(key)) || profile.positivePostIds.has(post.id)) {
        if (dedupeSet !== profile.positiveKeys && key && dedupeSet.has(key)) continue;
      }
      if (key && dedupeSet.has(key)) continue;
      if (key) dedupeSet.add(key);
      if (key) profile.positiveKeys.add(key);
      profile.positivePostIds.add(post.id);
      contributeFeatures(profile, weight, {
        title: post.title,
        caption: post.caption,
        creatorId: post.creatorId,
        creatorHandle: post.creatorHandle,
        creatorName: post.creatorName,
        platform: post.source,
        kind: post.type,
      });
    }
  };

  contributePostToggle(signals.likedPostIds, seenLikedKeys, SIGNAL_WEIGHT_LIKED);
  contributePostToggle(signals.favoritedPostIds, seenFavKeys, SIGNAL_WEIGHT_FAVORITE);

  const seenSavedKeys = new Set<string>();
  contributePostToggle(signals.savedPostIds, seenSavedKeys, SIGNAL_WEIGHT_SAVED_POST);

  for (const creator of signals.creators || []) {
    if (!creator) continue;
    addCreatorAffinity(profile.creators, SIGNAL_WEIGHT_SAVED_CREATOR, {
      id: creator.id,
      handle: creator.handle,
      name: creator.name,
      url: creator.profileUrl,
    });
  }

  return profile;
}

function readCandidateCreatorScore(
  post: TimelinePost,
  creators: CreatorWeightProfile,
  creatorLookup: Map<string, TimelineCreator>
): number {
  const candidates: number[] = [];
  const cleanId = (post.creatorId || '').trim().toLowerCase();
  if (cleanId) candidates.push(creators.byId.get(cleanId) || 0);

  const cleanHandle = sanitizeCreatorHandle(post.creatorHandle).toLowerCase();
  if (cleanHandle) candidates.push(creators.byHandle.get(cleanHandle) || 0);

  const cleanName = normalizeText(post.creatorName).trim();
  if (!isUnknownCreatorLabel(cleanName)) candidates.push(creators.byName.get(cleanName) || 0);

  const creator = creatorLookup.get(post.creatorId);
  const cleanUrl = normalizeUrlKey(creator?.profileUrl);
  if (cleanUrl) candidates.push(creators.byUrl.get(cleanUrl) || 0);

  return Math.max(0, ...candidates);
}

interface ScoredCandidate {
  post: TimelinePost;
  index: number;
  score: number;
  creatorKey: string;
  publishedMs: number | null;
}

function resolveCandidateCreatorKey(post: TimelinePost): string {
  const cleanId = (post.creatorId || '').trim().toLowerCase();
  if (cleanId) return cleanId;
  const cleanHandle = sanitizeCreatorHandle(post.creatorHandle).toLowerCase();
  if (cleanHandle) return `handle:${cleanHandle}`;
  const cleanName = normalizeText(post.creatorName).trim();
  if (!isUnknownCreatorLabel(cleanName)) return `name:${cleanName}`;
  return `post:${post.id}`;
}

function scoreCandidatePost(
  post: TimelinePost,
  profile: UserTasteProfile,
  creatorLookup: Map<string, TimelineCreator>,
  nowMs: number
): { score: number; publishedMs: number | null } {
  const tokens = extractTopicTokens(post.title, post.caption);
  let rawKeywordScore = 0;
  for (const token of tokens) {
    rawKeywordScore += profile.keywords.get(token) || 0;
  }
  const normalizedKeyword = tokens.length > 0 ? rawKeywordScore / Math.sqrt(tokens.length + 2) : 0;
  const topicScore = 6.0 * Math.log1p(normalizedKeyword * 1.4);

  const rawCreatorScore = readCandidateCreatorScore(post, profile.creators, creatorLookup);
  const creatorScore = 3.2 * Math.log1p(rawCreatorScore * 1.2);

  const platformKey = (post.source || creatorLookup.get(post.creatorId)?.site || '').trim().toLowerCase();
  const rawPlatform = platformKey ? profile.platforms.get(platformKey) || 0 : 0;
  const platformScore = Math.min(1.5, 0.45 * Math.log1p(rawPlatform));

  const kindKey = coerceLibraryMediaKind(post.type);
  const rawKind = profile.kinds.get(kindKey) || 0;
  const kindScore = Math.min(1.2, 0.35 * Math.log1p(rawKind));

  const publishedMs = timelinePublicationTime(post);
  let freshnessScore = 1.4;
  if (publishedMs !== null && Number.isFinite(publishedMs)) {
    const ageMs = Math.max(0, nowMs - publishedMs);
    freshnessScore = 4.2 * Math.exp((-ageMs / FRESHNESS_HALF_LIFE_MS) * Math.LN2);
  }

  const likesVal = typeof post.likes === 'number' && Number.isFinite(post.likes) && post.likes > 0 ? post.likes : 0;
  const commentsVal = Array.isArray(post.comments) ? post.comments.length : 0;
  const engagementScore = Math.min(2.4, 0.22 * Math.log1p(likesVal + commentsVal * 2));

  const postKey = buildPostCanonicalKey(post);
  const watchedWeight = Math.max(
    postKey ? profile.watchedRecencyByKey.get(postKey) || 0 : 0,
    profile.watchedRecencyById.get(post.id) || 0
  );

  let noveltyAdjustment = 0;
  if (watchedWeight > 0) {
    noveltyAdjustment = -WATCHED_NOVELTY_PENALTY * watchedWeight;
  } else if (profile.hasSignals) {
    noveltyAdjustment = UNSEEN_DISCOVERY_BONUS;
  }

  // Soft boost when an unwatched item also belongs to a creator whose work user explicitly liked/saved recently,
  // while keeping topic/creator affinity dominant over pure publication date.
  const total =
    topicScore +
    creatorScore +
    platformScore +
    kindScore +
    freshnessScore +
    engagementScore +
    noveltyAdjustment;

  return { score: total, publishedMs };
}

function computeCreatorDiversityPenalty(chosen: ScoredCandidate[], creatorKey: string, hasAlternateCreator: boolean): number {
  const len = chosen.length;
  if (len === 0) return 0;

  let consecutiveTail = 0;
  for (let i = len - 1; i >= 0; i--) {
    if (chosen[i].creatorKey === creatorKey) {
      consecutiveTail += 1;
    } else {
      break;
    }
  }
  if (consecutiveTail >= MAX_CONSECUTIVE_SAME_CREATOR && hasAlternateCreator) {
    return 1_000_000;
  }

  let penalty = 0;
  if (chosen[len - 1].creatorKey === creatorKey) {
    penalty += IMMEDIATE_REPEAT_PENALTY;
  }

  const windowStart = Math.max(0, len - CREATOR_WINDOW_SIZE);
  let windowCount = 0;
  for (let i = windowStart; i < len; i++) {
    if (chosen[i].creatorKey === creatorKey) windowCount += 1;
  }
  penalty += windowCount * WINDOW_REPEAT_PENALTY;
  return penalty;
}

/**
 * Ranks Profile Hub feed posts for the personalized "For you" ("Para você") tab.
 * Combines explicit user signals (playlists, likes, favorites), watch history recency/replays,
 * novelty demotion for already-watched videos, freshness decay, and creator diversity interleaving.
 */
export function rankForYouPosts(
  posts: TimelinePost[],
  signals: ForYouSignalInput = {},
  nowMs = Date.now()
): TimelinePost[] {
  if (posts.length <= 1) return [...posts];

  const creatorLookup = new Map<string, TimelineCreator>();
  for (const creator of signals.creators || []) {
    if (creator?.id) creatorLookup.set(creator.id, creator);
  }

  const profile = buildUserTasteProfile(posts, signals, nowMs);
  const remaining: ScoredCandidate[] = posts.map((post, index) => {
    const { score, publishedMs } = scoreCandidatePost(post, profile, creatorLookup, nowMs);
    return {
      post,
      index,
      score,
      creatorKey: resolveCandidateCreatorKey(post),
      publishedMs,
    };
  });

  // Sort once deterministically so tie-breaking favors fresher then original order.
  remaining.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.publishedMs ?? -1) !== (a.publishedMs ?? -1)) return (b.publishedMs ?? -1) - (a.publishedMs ?? -1);
    return a.index - b.index;
  });

  const chosen: ScoredCandidate[] = [];
  while (remaining.length > 0) {
    const lastCreatorKey = chosen.length > 0 ? chosen[chosen.length - 1].creatorKey : null;
    const hasAlternateCreator =
      lastCreatorKey !== null && remaining.some((candidate) => candidate.creatorKey !== lastCreatorKey);

    let bestIdx = 0;
    let bestEffectiveScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const penalty = computeCreatorDiversityPenalty(chosen, candidate.creatorKey, hasAlternateCreator);
      const effectiveScore = candidate.score - penalty;
      if (effectiveScore > bestEffectiveScore) {
        bestEffectiveScore = effectiveScore;
        bestIdx = i;
      }
    }

    const [picked] = remaining.splice(bestIdx, 1);
    chosen.push(picked);
  }

  return chosen.map((item) => item.post);
}
