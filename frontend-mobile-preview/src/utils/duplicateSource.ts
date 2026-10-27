/** Use the complete media source identity; matching dimensions alone cannot prove duplication. */
export const getDuplicateSourceKey = (source: string): string | null => {
  let current = source;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current) return null;
    try {
      const relative = current.startsWith('/') && !current.startsWith('//');
      const parsed = new URL(current, 'https://imagex.local');
      if (parsed.pathname === '/api/proxy-image') {
        const original = parsed.searchParams.get('url');
        if (!original || original === current) return null;
        current = original;
        continue;
      }
      if (!relative && !current.startsWith('//') && !/^(https?:|local:|data:)/i.test(current)) return null;
      parsed.hash = '';
      return relative ? `relative:${parsed.pathname}${parsed.search}` : parsed.href;
    } catch {
      return null;
    }
  }
  return null;
};
