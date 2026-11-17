import React, { useEffect, useRef, useState } from 'react';
import { safeAvatarSourceUrl } from '../../../services/profileAvatarService';
import { handleProxiedImageError } from '../../../services/profileHubImageFallback';
import { avatarIdentityKey, useProfileAvatarStore, useResolvedAvatar } from '../../../store/useProfileAvatarStore';
import { getInitialsAvatar } from '../timeline/TimelineStoriesBar';

export interface SourceAvatarProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  name: string | null | undefined;
  src?: string | null;
  profileUrl?: string | null;
  referer?: string | null;
  hydrate?: boolean;
  lazyHydrate?: boolean;
  fallbackSrc?: string;
  disableMotion?: boolean;
}

export const SourceAvatar: React.FC<SourceAvatarProps> = ({
  name,
  src,
  profileUrl,
  referer,
  hydrate = false,
  lazyHydrate = false,
  fallbackSrc,
  disableMotion = false,
  className = '',
  alt = '',
  loading = 'lazy',
  decoding = 'async',
  onError,
  ...rest
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [inView, setInView] = useState(hydrate);
  const requestAvatar = useProfileAvatarStore((state) => state.requestAvatar);
  const safeInline = safeAvatarSourceUrl(src);
  const safeProfile = safeAvatarSourceUrl(profileUrl);

  useEffect(() => {
    if (hydrate) {
      setInView(true);
      return;
    }
    if (!lazyHydrate || safeInline || !safeProfile) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const el = imgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hydrate, lazyHydrate, safeInline, safeProfile]);

  useEffect(() => {
    if (!inView || !lazyHydrate || hydrate || safeInline || !safeProfile) return;
    void requestAvatar(safeProfile);
  }, [inView, lazyHydrate, hydrate, safeInline, safeProfile, requestAvatar]);

  const resolved = useResolvedAvatar(safeProfile, safeInline, { hydrate: Boolean(hydrate || (lazyHydrate && inView)) });
  const initialsAvatar = fallbackSrc || getInitialsAvatar(name || '');
  const activeRemoteSrc = resolved.src;
  const effectiveSrc = activeRemoteSrc || initialsAvatar;
  const identity = avatarIdentityKey(safeProfile) || '';

  return (
    <img
      {...rest}
      ref={imgRef}
      key={`${identity}:${activeRemoteSrc || 'initials'}`}
      src={effectiveSrc}
      alt={alt}
      loading={loading}
      decoding={decoding}
      referrerPolicy="no-referrer"
      data-avatar-status={resolved.status}
      className={`${className}${disableMotion ? '' : ' transition-opacity duration-200'}`}
      onError={(event) => {
        handleProxiedImageError(event, {
          rawUrl: activeRemoteSrc,
          referer: referer || safeProfile || activeRemoteSrc,
          fallbackSrc: initialsAvatar,
        });
        onError?.(event);
      }}
    />
  );
};
