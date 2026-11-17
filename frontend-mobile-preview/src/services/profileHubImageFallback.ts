import type { SyntheticEvent } from 'react';

export interface ImageProxyFallbackOptions {
  rawUrl?: string | null;
  referer?: string | null;
  fallbackSrc?: string | null;
  hideOnExhausted?: boolean;
}

export function buildProxyImageUrl(rawUrl: string, referer?: string | null): string {
  const params = new URLSearchParams({ url: rawUrl });
  if (referer && /^https?:\/\//i.test(referer)) {
    params.set('referer', referer);
  }
  return `/api/proxy-image?${params.toString()}`;
}

export function handleProxiedImageError(
  event: SyntheticEvent<HTMLImageElement>,
  { rawUrl, referer, fallbackSrc, hideOnExhausted = false }: ImageProxyFallbackOptions,
): void {
  const imgEl = event.currentTarget;
  const candidate = (rawUrl || '').trim();
  const proxyAttemptKey = candidate ? `${candidate}|${referer || ''}` : '';

  if (
    proxyAttemptKey &&
    /^https?:\/\//i.test(candidate) &&
    imgEl.dataset.proxiedFor !== proxyAttemptKey
  ) {
    imgEl.dataset.proxiedFor = proxyAttemptKey;
    imgEl.src = buildProxyImageUrl(candidate, referer || candidate);
    return;
  }

  if (fallbackSrc && imgEl.dataset.fallbackUsed !== fallbackSrc) {
    imgEl.dataset.fallbackUsed = fallbackSrc;
    imgEl.src = fallbackSrc;
    return;
  }

  if (hideOnExhausted) {
    imgEl.style.display = 'none';
  }
}
