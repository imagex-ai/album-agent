const sourceKeyCache = new Map<string, string | null>();
const MAX_CACHE_SIZE = 200000;

/** Use the complete media source identity; matching dimensions alone cannot prove duplication. */
export const getDuplicateSourceKey = (source: string): string | null => {
  if (!source) return null;
  const cached = sourceKeyCache.get(source);
  if (cached !== undefined) return cached;

  let current = source;
  let resolved: string | null = null;

  for (let depth = 0; depth < 5; depth += 1) {
    if (!current) break;
    try {
      const relative = current.startsWith('/') && !current.startsWith('//');
      const parsed = new URL(current, 'https://imagex.local');
      if (parsed.pathname === '/api/proxy-image') {
        const original = parsed.searchParams.get('url');
        if (!original || original === current) break;
        current = original;
        continue;
      }
      if (!relative && !current.startsWith('//') && !/^(https?:|local:|data:)/i.test(current)) break;
      parsed.hash = '';
      resolved = relative ? `relative:${parsed.pathname}${parsed.search}` : parsed.href;
      break;
    } catch {
      break;
    }
  }

  if (sourceKeyCache.size >= MAX_CACHE_SIZE) {
    sourceKeyCache.clear();
  }
  sourceKeyCache.set(source, resolved);
  return resolved;
};
