/** Presentation of real metadata only; detection/ranking stays on the server. */
export interface PlayerHighlight {
  start: number;
  end?: number;
  rank?: string | number;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};
const seconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function normalizePlayerHighlights(value: unknown, duration?: number): PlayerHighlight[] {
  const data = record(value);
  const nested = record(data.smart_highlight);
  const metadata = record(record(data.metadata).smart_highlight);
  const owner = Array.isArray(data.highlights) && data.highlights.length ? data
    : Array.isArray(nested.highlights) ? nested
    : Array.isArray(metadata.highlights) ? metadata : data;
  const list: unknown[] = Array.isArray(owner.highlights) ? owner.highlights : [];
  const validDuration = seconds(duration) && duration > 0;
  const result: PlayerHighlight[] = [];
  for (const item of list) {
    const entry = record(item);
    if (!seconds(entry.start) || (validDuration && entry.start >= duration!)) continue;
    if (entry.end != null && (!seconds(entry.end) || entry.end <= entry.start)) continue;
    if (result.some(existing => existing.start === entry.start)) continue;
    result.push({ start: entry.start, ...(seconds(entry.end) ? { end: validDuration ? Math.min(entry.end, duration!) : entry.end } : {}),
      ...(typeof entry.rank === 'string' || typeof entry.rank === 'number' ? { rank: entry.rank } : {}) });
  }
  if (result.length) return result;
  const start = owner.highlightStart ?? owner.highlight_start;
  const end = owner.highlightEnd ?? owner.highlight_end;
  // Old mappers represented unknown start/end as 0. Require a genuine interval.
  if (seconds(start) && seconds(end) && end > start && (!validDuration || start < duration!)) {
    return [{ start, end: validDuration ? Math.min(end, duration!) : end, rank: 'gold' }];
  }
  return [];
}

export function selectPrimaryHighlight(highlights: readonly PlayerHighlight[]): PlayerHighlight | undefined {
  return highlights.find(item => item.rank === 'gold' || item.rank === 1 || item.rank === '1') || highlights[0];
}
