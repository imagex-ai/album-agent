import type { Language } from '../types';
import { timelinePublicationTime, type TimelinePost } from '../components/profile-hub/timeline/timelineModel';
import { formatProfileDate } from './profileHubPresentation';

/** Presentation only: preserve the source date and its declared precision. */
export function formatTimelineDate(post: TimelinePost, language: Language, now = new Date()): string {
  const timestamp = timelinePublicationTime(post);
  if (timestamp === null || !Number.isFinite(now.getTime()) || timestamp > now.getTime()) return '—';
  const raw = post.date.trim();
  const sourceRelative = raw.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  const sourceUnit = sourceRelative?.[2].toLowerCase() as 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' | undefined;
  const dayPrecision = post.publicationDatePrecision === 'day' || /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const minimumUnit = sourceUnit && ['week', 'month', 'year'].includes(sourceUnit)
    ? sourceUnit : dayPrecision ? 'day' : sourceUnit ?? 'second';
  // A date-only source is a calendar day, never an invented local midnight instant.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date(timestamp).toISOString();
  return formatProfileDate(value, language, now, {
    numeric: 'always', minimumUnit,
    minimumCount: sourceRelative ? Number(sourceRelative[1]) : undefined,
    unknownLabel: '—',
  });
}
