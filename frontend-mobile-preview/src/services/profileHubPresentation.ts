import { translations } from '../i18n/translations';
import { useAppStore } from '../store/useAppStore';
import type { Language } from '../types';

// Bound traversal of nested source JSON, including malformed/cyclic cached values.
const MAX_PROFILE_BIO_DEPTH = 8;
const PROFILE_BIO_TEXT_KEYS = ['name', 'text', 'value', 'label'] as const;
// Calendar grouping approximations used by the existing relative-date presentation.
const DAYS_PER_WEEK = 7;
const DAYS_PER_DISPLAY_MONTH = 30;
const DAYS_PER_DISPLAY_YEAR = 365;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

/** Extract source-provided display text without exposing IDs/URLs or object dumps. */
export function formatProfileBioValue(value: unknown, depth = 0): string | null {
  if (depth > MAX_PROFILE_BIO_DEPTH) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value)) {
    const parts = value.map(item => formatProfileBioValue(item, depth + 1)).filter((text): text is string => text !== null);
    return parts.join(', ') || null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of PROFILE_BIO_TEXT_KEYS) {
      const text = formatProfileBioValue(record[key], depth + 1);
      if (text !== null) return text;
    }
  }
  return null;
}

/** Validate at render time too: older servers and existing sessions may contain raw JSON. */
export function profileBioEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, raw]) => {
    const text = formatProfileBioValue(raw);
    return key.trim() && text !== null ? [[key, text] as [string, string]] : [];
  });
}

/** Source timestamps only: absence and future/invalid values never imply recency. */
export function formatProfileDate(value: string | null | undefined, language: Language, now = new Date(), options: {
  numeric?: Intl.RelativeTimeFormatNumeric;
  minimumUnit?: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
  minimumCount?: number;
  unknownLabel?: string;
} = {}): string {
  const numeric = options.numeric ?? 'auto';
  const unknown = options.unknownLabel ?? translations[language].profileHub.unknownDate;
  if (!value?.trim()) return unknown;
  const relativeSource = value.trim().match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relativeSource) return new Intl.RelativeTimeFormat(language, { numeric })
    .format(-Number(relativeSource[1]), relativeSource[2].toLowerCase() as Intl.RelativeTimeFormatUnit);
  // The explicitly selected comparison profile also has localized relative dates.
  const demoRelative = value.trim().match(/^(?:Atualizad[ao]\s+)?h[áa]\s+(\d+)\s+(dias?|semanas?|meses|mês|anos?)$/i);
  if (demoRelative) {
    const unit = demoRelative[2].toLowerCase();
    return new Intl.RelativeTimeFormat(language, { numeric }).format(-Number(demoRelative[1]),
      unit.startsWith('dia') ? 'day' : unit.startsWith('semana') ? 'week' : unit.startsWith('an') ? 'year' : 'month');
  }
  const calendar = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = calendar
    ? new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]))
    : new Date(value);
  if (calendar && (date.getFullYear() !== Number(calendar[1]) ||
      date.getMonth() !== Number(calendar[2]) - 1 || date.getDate() !== Number(calendar[3]))) return unknown;
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime()) return unknown;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.floor((day(now) - day(date)) / MILLISECONDS_PER_DAY);
  const relative = new Intl.RelativeTimeFormat(language, { numeric });
  // Timestamp precision is opt-in; existing calendar-date consumers keep their labels.
  const seconds = Math.floor((now.getTime() - date.getTime()) / MILLISECONDS_PER_SECOND);
  const minimumUnit = options.minimumUnit ?? 'day';
  if (!calendar && ['second', 'minute', 'hour'].includes(minimumUnit)) {
    if (minimumUnit === 'second' && seconds < SECONDS_PER_MINUTE) return relative.format(-seconds, 'second');
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    if (minimumUnit !== 'hour' && minutes < MINUTES_PER_HOUR) return relative.format(-minutes, 'minute');
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    if (hours < HOURS_PER_DAY) return relative.format(-hours, 'hour');
  }
  // Coarse source labels remain coarse, including calendar arithmetic near month ends.
  const sourceFloor = (count: number, unit: string) => unit === minimumUnit
    ? Math.max(count, options.minimumCount ?? 0) : count;
  if (days < DAYS_PER_WEEK && !['week', 'month', 'year'].includes(minimumUnit)) return relative.format(-sourceFloor(days, 'day'), 'day');
  if (days < DAYS_PER_DISPLAY_MONTH && !['month', 'year'].includes(minimumUnit)) return relative.format(-sourceFloor(Math.floor(days / DAYS_PER_WEEK), 'week'), 'week');
  if (days < DAYS_PER_DISPLAY_YEAR && minimumUnit !== 'year') return relative.format(-sourceFloor(Math.floor(days / DAYS_PER_DISPLAY_MONTH), 'month'), 'month');
  return relative.format(-sourceFloor(Math.floor(days / DAYS_PER_DISPLAY_YEAR), 'year'), 'year');
}

export function useProfileHubPresentation() {
  const language = useAppStore(state => state.settings.language);
  const copy = translations[language].profileHub;
  return {
    copy,
    formatMetadata: (value: string | undefined, status: 'fetched' | 'error' | undefined, missing: string) =>
      value || (status === 'error' ? copy.metadataError : status === 'fetched' ? missing : copy.metadataPending),
    formatDate: (value?: string | null, status?: 'fetched' | 'error') => {
      if (status === 'error' && !value) return copy.metadataError;
      if (!value && status !== 'fetched') return copy.metadataPending;
      return formatProfileDate(value, language);
    },
    sourceLabel: (value: string) => ({
      Country: copy.ui82, Age: copy.ui83, Height: copy.ui84, Measurements: copy.ui85,
      Subscribers: copy.ui86, Ethnicity: copy.ui87, Hair: copy.ui88, Eye: copy.ui89,
    } as Record<string, string>)[value] || value,
    formatCount: (value: number | null | undefined, noun: string) => value == null
      ? copy.unknownCount : `${new Intl.NumberFormat(language).format(value)} ${noun}`,
  };
}
