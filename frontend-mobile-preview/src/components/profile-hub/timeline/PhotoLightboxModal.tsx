import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  TimelineLightboxState,
  buildTimelineStreamUrl,
  isTimelineGifStreamUrl,
  upgradePhotoUrlFast,
} from './timelineModel';
import { resolvePhotoOriginal } from '../../../services/profileHubApi';
import { useProfileTimelineStore } from '../../../store/useProfileTimelineStore';
import { useAppStore } from '../../../store/useAppStore';
import { AppDialog } from '../../common/AppDialog';
import { PHOTO_SWIPE, getPhotoSwipeDirection, getPhotoSwipeIntent, PhotoSwipeIntent } from './photoSwipeGesture';
import { getOpenAnimationClass, getSwitchAnimationClass, getSpeedClass } from '../../../services/motionConfig';
import { UniversalVideoPlayer } from '../../video-player/ui/UniversalVideoPlayer';

interface PhotoSwipeSession {
  identifier: number;
  x: number;
  y: number;
  startedAt: number;
  width: number;
  context: string;
  intent: PhotoSwipeIntent;
}

interface PhotoLightboxModalProps {
  lightbox: TimelineLightboxState;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  lightbox,
  onClose,
  onNext,
  onPrev,
}) => {
  const isEn = useAppStore((state) => state.settings?.language === 'en-US');
  const disabledMotion = useAppStore((state) => state.settings.disableAllAnimations);
  const openAnimation = useAppStore((state) => state.settings.lightboxOpenAnimation);
  const switchAnimation = useAppStore((state) => state.settings.imageSwitchAnimation);
  const animationSpeed = useAppStore((state) => state.settings.animationSpeed);
  const updateLightboxItemResolution = useProfileTimelineStore(
    (state) => state.updateLightboxItemResolution
  );
  const [isResolvingHd, setIsResolvingHd] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightbox.isOpen) return;
      if (e.target instanceof HTMLVideoElement || lightbox.images.length <= 1) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightbox.isOpen, lightbox.images.length, onNext, onPrev]);

  const currentIndex = lightbox.currentIndex;
  const currentImage = lightbox.images[currentIndex] || '';
  const currentItem = lightbox.items?.[currentIndex];
  const cleanLower = currentImage.split('?')[0].toLowerCase();
  const isVideoClip = isTimelineGifStreamUrl(currentImage) || cleanLower.endsWith('.mp4') || cleanLower.endsWith('.webm');
  const photoRef = useRef<HTMLImageElement>(null);
  const previousMotion = useRef<{ album: string; key: string; opening: boolean } | null>(null);
  const motionAlbum = lightbox.albumUrl || '';
  // Resolution updates replace the URL, but do not navigate to another photo.
  const motionKey = JSON.stringify([motionAlbum, currentIndex, currentItem?.id, currentItem?.pageUrl]);
  const hasPhoto = Boolean(currentImage) && !isVideoClip;

  useLayoutEffect(() => {
    if (!lightbox.isOpen) {
      previousMotion.current = null;
      return;
    }
    const photo = photoRef.current;
    if (!hasPhoto || !photo) return;
    const previous = previousMotion.current;
    const opening = !previous || previous.album !== motionAlbum
      || (previous.key === motionKey && previous.opening);
    previousMotion.current = { album: motionAlbum, key: motionKey, opening };
    const animationClass = opening
      ? getOpenAnimationClass(openAnimation, disabledMotion)
      : getSwitchAnimationClass(switchAnimation, disabledMotion);
    const speedClass = getSpeedClass(animationSpeed);
    photo.classList.add(animationClass, speedClass);
    // Removing the class cancels the CSS animation on navigation/close/unmount.
    return () => photo.classList.remove(animationClass, speedClass);
  }, [lightbox.isOpen, hasPhoto, motionAlbum, motionKey, openAnimation, switchAnimation, animationSpeed, disabledMotion]);

  const gestureContext = JSON.stringify([
    lightbox.isOpen, lightbox.albumUrl, lightbox.title, currentIndex, currentImage,
    currentItem?.id, currentItem?.sourcePage, currentItem?.pageUrl, lightbox.images.length,
  ]);
  const latestGestureContext = useRef(gestureContext);
  latestGestureContext.current = gestureContext;
  const swipe = useRef<PhotoSwipeSession | null>(null);
  const suppressClickUntil = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const resetSwipe = () => {
    swipe.current = null;
    setSwipeOffset(0);
    setIsSwiping(false);
  };

  useEffect(() => {
    resetSwipe();
    if (!lightbox.isOpen) return;
    // Observe a second finger even when it lands outside the image. Leave the
    // event passive so native browser pinch/zoom owns the multi-touch gesture.
    const cancelMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) resetSwipe();
    };
    window.addEventListener('touchstart', cancelMultiTouch, { passive: true });
    return () => {
      swipe.current = null;
      window.removeEventListener('touchstart', cancelMultiTouch);
    };
  }, [gestureContext, lightbox.isOpen]);

  const startSwipe = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || !currentImage || isVideoClip || lightbox.images.length < 2
      || (window.visualViewport && window.visualViewport.scale !== 1)) {
      resetSwipe();
      return;
    }
    const touch = event.touches[0];
    swipe.current = {
      identifier: touch.identifier, x: touch.clientX, y: touch.clientY,
      startedAt: event.timeStamp, width: event.currentTarget.clientWidth,
      context: gestureContext, intent: 'pending',
    };
  };

  const moveSwipe = (event: React.TouchEvent<HTMLDivElement>) => {
    const session = swipe.current;
    if (!session) return;
    if (event.touches.length !== 1 || session.context !== latestGestureContext.current) {
      resetSwipe();
      return;
    }
    const touch = event.touches[0];
    if (touch.identifier !== session.identifier) { resetSwipe(); return; }
    const dx = touch.clientX - session.x;
    const dy = touch.clientY - session.y;
    // Rejection is sticky: a vertical/diagonal start never becomes navigation.
    if (session.intent === 'pending') session.intent = getPhotoSwipeIntent(dx, dy);
    if (session.intent !== 'horizontal') return;
    suppressClickUntil.current = performance.now() + PHOTO_SWIPE.syntheticClickWindow;
    setIsSwiping(true);
    setSwipeOffset(Math.sign(dx) * Math.min(Math.abs(dx) * PHOTO_SWIPE.feedbackRatio, PHOTO_SWIPE.maximumFeedback));
  };

  const endSwipe = (event: React.TouchEvent<HTMLDivElement>) => {
    const session = swipe.current;
    resetSwipe();
    if (!session || event.touches.length || session.context !== latestGestureContext.current || session.intent === 'rejected') return;
    const touch = Array.from(event.changedTouches).find(item => item.identifier === session.identifier);
    if (!touch) return;
    const direction = getPhotoSwipeDirection(touch.clientX - session.x, touch.clientY - session.y, event.timeStamp - session.startedAt, session.width);
    if (!direction) return;
    suppressClickUntil.current = performance.now() + PHOTO_SWIPE.syntheticClickWindow;
    if (direction > 0) onNext();
    else onPrev();
  };

  // Dynamically resolve full-resolution original image via /api/profile-hub/resolve-photo
  useEffect(() => {
    if (!lightbox.isOpen || !currentImage) {
      setIsResolvingHd(false);
      return;
    }

    const cleanLower = currentImage.split('?')[0].toLowerCase();
    const isAnimClip =
      isVideoClip ||
      cleanLower.endsWith('.gif') ||
      currentItem?.isAnimated;

    if (isAnimClip || currentItem?.isResolvedOriginal) {
      setIsResolvingHd(false);
      return;
    }

    const controller = new AbortController();
    const pageUrl = currentItem?.pageUrl || '';
    const sourcePage = currentItem?.sourcePage || lightbox.albumUrl || '';
    const thumbUrl = currentItem?.thumbnailUrl || currentImage;

    setIsResolvingHd(true);
    resolvePhotoOriginal(
      {
        photoId: currentItem?.id,
        pageUrl,
        thumbnailUrl: thumbUrl,
        sourcePage,
      },
      controller.signal,
      'high'
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        const active = useProfileTimelineStore.getState().lightbox;
        if (!active.isOpen || active.currentIndex !== currentIndex || active.images[currentIndex] !== currentImage || active.albumUrl !== lightbox.albumUrl) return;
        setIsResolvingHd(false);
        if (res.success && res.original_url) {
          const finalUrl = upgradePhotoUrlFast(res.original_url);
          updateLightboxItemResolution(currentIndex, {
            url: finalUrl,
            width: res.width || undefined,
            height: res.height || undefined,
            fileSizeBytes: res.file_size || undefined,
            format: res.format || undefined,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIsResolvingHd(false);
        }
      });

    // Prefetch adjacent images at low priority
    if (lightbox.images.length > 1) {
      const nextIdx = (currentIndex + 1) % lightbox.images.length;
      const prevIdx = (currentIndex - 1 + lightbox.images.length) % lightbox.images.length;
      for (const adjIdx of [nextIdx, prevIdx]) {
        const adjItem = lightbox.items?.[adjIdx];
        const adjUrl = lightbox.images[adjIdx];
        if (adjUrl && !adjItem?.isResolvedOriginal) {
          void resolvePhotoOriginal(
            {
              photoId: adjItem?.id,
              pageUrl: adjItem?.pageUrl,
              thumbnailUrl: adjItem?.thumbnailUrl || adjUrl,
              sourcePage: adjItem?.sourcePage || lightbox.albumUrl,
            },
            undefined,
            'low'
          );
        }
      }
    }

    return () => controller.abort();
  }, [
    lightbox.isOpen,
    currentIndex,
    currentImage,
    currentItem?.id,
    currentItem?.pageUrl,
    currentItem?.sourcePage,
    currentItem?.thumbnailUrl,
    currentItem?.isResolvedOriginal,
    currentItem?.isAnimated,
    lightbox.albumUrl,
    lightbox.images.length,
    lightbox.items,
    updateLightboxItemResolution,
  ]);

  if (!lightbox.isOpen) return null;

  const refererUrl = currentItem?.sourcePage || currentItem?.pageUrl || lightbox.albumUrl || '';

  return (
    <AppDialog
      titleId="timeline-photo-lightbox-title"
      onClose={onClose}
      className="fixed inset-0 m-0 h-[100dvh] w-screen max-h-none max-w-none border-0 bg-transparent p-0 text-white"
    >
    <div
      data-modal="photo-lightbox"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md transition-opacity duration-300"
      onClick={onClose}
      onTouchStartCapture={(event) => {
        // A fresh deliberate tap may close/use controls immediately after a swipe.
        if (event.touches.length === 1) suppressClickUntil.current = 0;
      }}
      onPointerDownCapture={(event) => {
        if (event.pointerType === 'mouse') suppressClickUntil.current = 0;
      }}
      onClickCapture={(event) => {
        if (event.detail !== 0 && performance.now() < suppressClickUntil.current) {
          suppressClickUntil.current = 0;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <h2 id="timeline-photo-lightbox-title" className="sr-only">{lightbox.title || (isEn ? 'Photo Lightbox' : 'Visualizador de Fotos')}</h2>
      {/* Botão Fechar */}
      <button
        autoFocus
        onClick={event => { event.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-black/60 hover:bg-white/20 text-white transition-colors border border-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-hover)]"
        title={isEn ? 'Close' : 'Fechar'}
      >
        <X className="w-5 h-5" />
      </button>

      {/* Indicador de Posição e Resolução Original */}
      <div className="absolute top-4 left-4 z-10 px-3 py-1 rounded-full bg-black/60 border border-white/10 text-white font-mono text-xs flex items-center gap-2">
        <span data-lightbox-counter className="font-semibold">
          {lightbox.images.length ? lightbox.currentIndex + 1 : 0} / {lightbox.images.length}
        </span>
        {currentItem?.width && currentItem?.height ? (
          <>
            <span className="text-gray-500">•</span>
            <span className="text-[10px] text-[var(--tl-accent-text)] font-mono" data-lightbox-resolution>
              {currentItem.width}×{currentItem.height}
            </span>
          </>
        ) : null}
        {(lightbox.isLoadingAlbum || isResolvingHd) && (
          <Loader2 className="w-3.5 h-3.5 text-[var(--tl-accent-text)] animate-spin" />
        )}
      </div>

      {/* Navegação Anterior */}
      {lightbox.images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2.5 rounded-full bg-black/60 hover:bg-white/20 text-white transition-all border border-white/10 hover:scale-110 active:scale-95"
          title={isEn ? 'Previous photo' : 'Foto anterior'}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Imagem ou GIF/WebM Central */}
      <div
        className="relative max-w-4xl max-h-[85vh] p-2 flex items-center justify-center motion-reduce:!transition-none"
        style={{
          touchAction: !isVideoClip && lightbox.images.length > 1 ? 'pan-y pinch-zoom' : undefined,
          transform: swipeOffset && swipe.current?.context === gestureContext ? `translateX(${swipeOffset}px)` : undefined,
          transition: isSwiping || disabledMotion ? 'none' : `transform ${PHOTO_SWIPE.settleDuration}ms ease-out`,
        }}
        onTouchStart={startSwipe}
        onTouchMove={moveSwipe}
        onTouchEnd={endSwipe}
        onTouchCancel={resetSwipe}
        onClick={(e) => e.stopPropagation()}
      >
        {!currentImage ? (
          <div role="status" className="flex flex-col items-center gap-3 p-4 text-center text-gray-300">
            {lightbox.isLoadingAlbum && <Loader2 className="w-8 h-8 text-[var(--tl-accent-text)] animate-spin motion-reduce:animate-none" />}
            <p className="text-sm">{lightbox.isLoadingAlbum
              ? (isEn ? 'Loading album photos...' : 'Carregando fotos do álbum...')
              : (isEn ? 'No photos are available for this album.' : 'Nenhuma foto está disponível para este álbum.')}</p>
          </div>
        ) : isVideoClip ? (
          <UniversalVideoPlayer
            key={currentImage}
            density="compact"
            autoPlayOnActive
            initialMuted
            source={{
              id: currentImage,
              title: lightbox.title,
              streamUrl: buildTimelineStreamUrl(currentImage, refererUrl),
              sourceUrl: refererUrl || currentImage,
            }}
            className="max-w-full max-h-[80vh] w-full aspect-video object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200 border-0"
          />
        ) : (
          <img
            ref={photoRef}
            key={`${motionKey}:${currentImage}`}
            src={currentImage}
            alt={lightbox.title || `${isEn ? 'Photo' : 'Foto'} ${lightbox.currentIndex + 1}`}
            referrerPolicy="no-referrer"
            {...{ fetchpriority: 'high' }}
            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl motion-reduce:!animate-none"
            onError={(e) => {
              const imgEl = e.currentTarget as HTMLImageElement;
              const fallbackThumb = currentItem?.thumbnailUrl || '';
              if (
                !imgEl.dataset.fallbackThumb &&
                fallbackThumb &&
                imgEl.src !== fallbackThumb
              ) {
                imgEl.dataset.fallbackThumb = '1';
                imgEl.src = fallbackThumb;
              } else if (!imgEl.dataset.proxied && currentImage.startsWith('http')) {
                imgEl.dataset.proxied = '1';
                imgEl.src = `/api/proxy-image?url=${encodeURIComponent(
                  fallbackThumb || currentImage
                )}&referer=${encodeURIComponent(refererUrl || currentImage)}`;
              }
            }}
          />
        )}
      </div>

      {/* Navegação Próximo */}
      {lightbox.images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2.5 rounded-full bg-black/60 hover:bg-white/20 text-white transition-all border border-white/10 hover:scale-110 active:scale-95"
          title={isEn ? 'Next photo' : 'Próxima foto'}
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Título Inferior */}
      {lightbox.title && (
        <div className="absolute bottom-4 inset-x-0 mx-auto max-w-xl text-center px-4">
          <p className="text-xs text-gray-300 bg-black/70 px-4 py-2 rounded-full border border-white/10 backdrop-blur-md line-clamp-1 inline-block">
            {lightbox.title}
          </p>
        </div>
      )}
    </div>
    </AppDialog>
  );
};
