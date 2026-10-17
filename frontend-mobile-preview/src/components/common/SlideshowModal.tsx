import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Maximize,
  Minimize,
  Gauge,
  Check,
  Layers,
  SunMedium,
  Blend,
  Film,
  Lock,
  Unlock,
  Heart,
  FolderHeart,
  Sparkles,
  Shuffle,
  SlidersHorizontal,
  ArrowDownAZ,
  ArrowUpAZ,
  UserCheck,
  Folder,
  Clock,
  Scaling,
  Smartphone,
  Monitor,
  ExternalLink,
  RotateCcw,
  Flame,
  Image as ImageIcon,
  Clapperboard
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { AlbumImage, SliderSequenceMode, SliderMediaFilter, SliderOrientationFilter } from '../../types';
import { translations } from '../../i18n/translations';
import { isDesktopApp, toggleAppFullscreen, exitAllFullscreen } from '../../services/desktopService';
import {
  extractDominantColors,
  extractSpatialDualColors,
  blendHexColors,
  colorPaletteCache,
  hexToRgb,
  rgbToHex,
} from '../../services/colorExtractor';

import { useImagePreloader, isImagePreloaded } from '../../hooks/useImagePreloader';
import { getSlideshowAnimationClass, getSpeedClass, getDistanceClass } from '../../services/motionConfig';

export type SlideshowBackdropMode = 'mirror' | 'single' | 'dual' | 'cinema';

interface EnrichedSlideImage extends AlbumImage {
  _albumId: string;
  _albumTitle: string;
  _albumFolder: string;
  _albumCreatedAt: number;
  _albumRecencyRank: number;
  _artist: string;
  _isGif: boolean;
  _pixels: number;
  _bytes: number;
  _isAlbumFavorite: boolean;
}

function parseFileSizeToBytes(sizeStr?: string, fallbackPixels: number = 1000000): number {
  if (!sizeStr) return fallbackPixels;
  const match = sizeStr.trim().match(/^([\d.]+)\s*(KB|MB|GB|B)?/i);
  if (!match) return fallbackPixels;
  const val = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  if (unit === 'GB') return val * 1024 * 1024 * 1024;
  if (unit === 'MB') return val * 1024 * 1024;
  if (unit === 'KB') return val * 1024;
  return val;
}

function detectArtistFromAlbum(title: string, tags?: string[], sourceUrl?: string): string {
  if (tags && tags.length > 0 && tags[0].trim().length > 1) {
    return tags[0].trim();
  }
  if (title) {
    const splitDash = title.split(/\s*[-–|•:]\s*/);
    if (splitDash.length > 1 && splitDash[0].trim().length >= 2 && splitDash[0].trim().length <= 32) {
      return splitDash[0].trim();
    }
  }
  if (sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
      const parts = host.split('.');
      if (parts.length >= 2) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
    } catch {
      // ignore invalid URL
    }
  }
  return title ? title.slice(0, 24).trim() : 'Geral';
}

export const SlideshowModal: React.FC = () => {
  const {
    slideshowOpen,
    slideshowInitialIndex,
    slideshowMode,
    globalSliderConfig,
    setGlobalSliderConfig,
    setSlideshowOpen,
    albums,
    activeAlbumId,
    navigateToView,
    toggleFavoriteAlbum,
    toggleFavoriteImage,
    settings,
    albumFolders,
  } = useAppStore();
  const t = translations[settings.language];

  const [currentIndex, setCurrentIndex] = useState(slideshowInitialIndex || 0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedSeconds, setSpeedSeconds] = useState<number>(3);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isImmersive, setIsImmersive] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const isLockedRef = useRef(isLocked);
  const [unlockButtonVisible, setUnlockButtonVisible] = useState(true);
  const unlockTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showBackdropMenu, setShowBackdropMenu] = useState(false);
  const [showDopaminePanel, setShowDopaminePanel] = useState(false);
  const [heartBurst, setHeartBurst] = useState(false);
  const [slideProgress, setSlideProgress] = useState(0);

  const [backdropMode, setBackdropMode] = useState<SlideshowBackdropMode>(() => {
    return (localStorage.getItem('slideshow_backdrop_mode') as SlideshowBackdropMode) || 'mirror';
  });

  useEffect(() => {
    if (slideshowOpen) {
      setCurrentIndex(slideshowInitialIndex || 0);
      setSpeedSeconds(globalSliderConfig.speedSeconds || 3);
    }
  }, [slideshowOpen, slideshowInitialIndex]);

  useEffect(() => {
    isLockedRef.current = isLocked;
    if (isLocked) {
      resetUnlockTimer();
    } else {
      if (unlockTimerRef.current) {
        clearTimeout(unlockTimerRef.current);
      }
      setUnlockButtonVisible(false);
    }
  }, [isLocked]);

  const resetUnlockTimer = () => {
    setUnlockButtonVisible(true);
    if (unlockTimerRef.current) {
      clearTimeout(unlockTimerRef.current);
    }
    unlockTimerRef.current = setTimeout(() => {
      setUnlockButtonVisible(false);
    }, 2500);
  };

  // Dynamic Inactivity Auto-Hide Engine (Desktop & iOS)
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastMousePosRef = useRef({ x: -1, y: -1 });
  const lastArrowNavTimeRef = useRef(0);
  const isFullscreenRef = useRef(isFullscreen);
  const isImmersiveRef = useRef(isImmersive);
  const showDopaminePanelRef = useRef(showDopaminePanel);

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    isImmersiveRef.current = isImmersive;
  }, [isImmersive]);

  useEffect(() => {
    showDopaminePanelRef.current = showDopaminePanel;
  }, [showDopaminePanel]);

  const HIDE_TIMEOUT_MS = 2800;

  const resetHideTimer = () => {
    if (isLocked) return;
    setControlsVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      if (showDopaminePanelRef.current) return;
      setControlsVisible(false);
      setShowSpeedMenu(false);
      setShowBackdropMenu(false);
    }, HIDE_TIMEOUT_MS);
  };

  // Restore desktop window state when closing slideshow
  useEffect(() => {
    return () => {
      exitAllFullscreen();
    };
  }, []);

  useEffect(() => {
    if (!slideshowOpen) return;

    resetHideTimer();

    const handlePointerActivity = (e: MouseEvent | PointerEvent) => {
      if (Date.now() - lastArrowNavTimeRef.current < 500) return;
      if (e.clientX === lastMousePosRef.current.x && e.clientY === lastMousePosRef.current.y) return;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      if (isLockedRef.current) {
        resetUnlockTimer();
      } else {
        resetHideTimer();
      }
    };

    const handleTouchActivity = () => {
      if (isLockedRef.current) {
        resetUnlockTimer();
      } else {
        resetHideTimer();
      }
    };

    const handleKeyActivity = (e: KeyboardEvent) => {
      const isArrowKey = e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if ((isFullscreenRef.current || isImmersiveRef.current) && isArrowKey) {
        lastArrowNavTimeRef.current = Date.now();
        return;
      }
      resetHideTimer();
    };

    window.addEventListener('mousemove', handlePointerActivity, { passive: true });
    window.addEventListener('pointermove', handlePointerActivity, { passive: true });
    window.addEventListener('mousedown', handlePointerActivity);
    window.addEventListener('wheel', handlePointerActivity, { passive: true });
    window.addEventListener('touchstart', handleTouchActivity, { passive: true });
    window.addEventListener('touchmove', handleTouchActivity, { passive: true });
    window.addEventListener('keydown', handleKeyActivity);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      if (unlockTimerRef.current) {
        clearTimeout(unlockTimerRef.current);
      }
      window.removeEventListener('mousemove', handlePointerActivity);
      window.removeEventListener('pointermove', handlePointerActivity);
      window.removeEventListener('mousedown', handlePointerActivity);
      window.removeEventListener('wheel', handlePointerActivity);
      window.removeEventListener('touchstart', handleTouchActivity);
      window.removeEventListener('touchmove', handleTouchActivity);
      window.removeEventListener('keydown', handleKeyActivity);
    };
  }, [slideshowOpen]);

  const activeAlbumObj = useMemo(
    () => albums.find(a => a.id === activeAlbumId) || albums[0],
    [albums, activeAlbumId]
  );

  // Build full pool of enriched images across either current album or entire app
  const rawPool = useMemo<EnrichedSlideImage[]>(() => {
    const sourceAlbums =
      globalSliderConfig.scope === 'all_app'
        ? albums
        : activeAlbumObj
        ? [activeAlbumObj]
        : albums;

    const albumsWithTs = sourceAlbums.map((album, albumIdx) => {
      const parsedDate = Date.parse(album.createdAt || '');
      const createdTs = Number.isNaN(parsedDate) ? Date.now() - albumIdx * 60000 : parsedDate;
      return { album, createdTs };
    });

    const sortedByDate = [...albumsWithTs].sort((a, b) => b.createdTs - a.createdTs);
    const rankMap = new Map<string, number>();
    sortedByDate.forEach((entry, rankIdx) => {
      rankMap.set(entry.album.id, rankIdx);
    });

    const list: EnrichedSlideImage[] = [];
    albumsWithTs.forEach(({ album, createdTs }) => {
      const artist = detectArtistFromAlbum(album.title, album.tags, album.sourceUrl);
      const folder = album.folder || '';
      const recencyRank = rankMap.get(album.id) ?? 0;

      (album.images || []).forEach((img, imgIdx) => {
        if (img.mediaType === 'video' || Boolean(img.videoUrl)) {
          return;
        }
        const urlLower = `${img.originalUrl || ''} ${img.rawOriginalUrl || ''} ${img.title || ''} ${img.format || ''}`.toLowerCase();
        const isGif =
          img.mediaType === 'gif' ||
          Boolean(img.isAnimated) ||
          img.format?.toUpperCase() === 'GIF' ||
          urlLower.includes('.gif');
        const w = img.width || 1200;
        const h = img.height || 1200;
        const pixels = w * h;
        const bytes = img.fileSizeBytes || parseFileSizeToBytes((img as any).fileSize, pixels);

        list.push({
          ...img,
          _albumId: album.id,
          _albumTitle: album.title || 'Álbum',
          _albumFolder: folder,
          _albumCreatedAt: createdTs + (album.images.length - imgIdx),
          _albumRecencyRank: recencyRank,
          _artist: artist,
          _isGif: isGif,
          _pixels: pixels,
          _bytes: bytes,
          _isAlbumFavorite: Boolean(album.isFavorite),
        });
      });
    });
    return list;
  }, [albums, activeAlbumObj, globalSliderConfig.scope]);

  // Extract available artists & folders for filter pills
  const availableArtists = useMemo(() => {
    const counts = new Map<string, number>();
    rawPool.forEach(img => {
      counts.set(img._artist, (counts.get(img._artist) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [rawPool]);

  const availableFolders = useMemo(() => {
    const counts = new Map<string, number>();
    albumFolders.forEach(f => counts.set(typeof f === 'string' ? f : f.name, 0));
    rawPool.forEach(img => {
      if (img._albumFolder) {
        counts.set(img._albumFolder, (counts.get(img._albumFolder) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .filter(([name]) => Boolean(name))
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [rawPool, albumFolders]);

  // Apply Dopamine Filters & Sequence Organization
  const images = useMemo<EnrichedSlideImage[]>(() => {
    let filtered = [...rawPool];

    // 1. Media type filter (All / Photos / GIFs)
    if (globalSliderConfig.mediaFilter === 'photos') {
      filtered = filtered.filter(img => !img._isGif);
    } else if (globalSliderConfig.mediaFilter === 'gifs') {
      filtered = filtered.filter(img => img._isGif);
    }

    // 2. Orientation filter (All / Vertical / Horizontal)
    if (globalSliderConfig.orientationFilter === 'vertical') {
      filtered = filtered.filter(img => (img.height || 1000) > (img.width || 1000));
    } else if (globalSliderConfig.orientationFilter === 'horizontal') {
      filtered = filtered.filter(img => (img.width || 1200) >= (img.height || 1000));
    }

    // 3. Favorites filter
    if (globalSliderConfig.onlyFavorites) {
      filtered = filtered.filter(img => Boolean(img.isFavorite) || img._isAlbumFavorite);
    }

    // 4. Specific Artist filter (stays active even when shuffling or sorting)
    if (globalSliderConfig.selectedArtist) {
      filtered = filtered.filter(img => img._artist.toLowerCase() === globalSliderConfig.selectedArtist.toLowerCase());
    }

    // 5. Specific Folder filter (stays active even when shuffling or sorting)
    if (globalSliderConfig.selectedFolder) {
      filtered = filtered.filter(img => img._albumFolder.toLowerCase() === globalSliderConfig.selectedFolder.toLowerCase());
    }

    // 6. Recent Albums / Images filter (negative values = latest N albums, positive values = last N days)
    if (globalSliderConfig.recentDaysLimit) {
      const limit = globalSliderConfig.recentDaysLimit;
      if (limit < 0) {
        const maxAlbumCount = Math.abs(limit);
        filtered = filtered.filter(img => img._albumRecencyRank < maxAlbumCount);
      } else if (limit > 0) {
        const cutoffMs = Date.now() - limit * 86400000;
        filtered = filtered.filter(img => img._albumCreatedAt >= cutoffMs);
      }
    }

    // 7. Minimum Resolution filter (stays active even when shuffling or sorting)
    if (globalSliderConfig.minResolution === '4k') {
      filtered = filtered.filter(img => (img.width || 0) >= 2500 || (img.height || 0) >= 2500 || img._pixels >= 3600000);
    } else if (globalSliderConfig.minResolution === 'hd') {
      filtered = filtered.filter(img => (img.width || 0) >= 1200 || (img.height || 0) >= 1200 || img._pixels >= 1200000);
    }

    // 8. Sequence Ordering
    const mode = globalSliderConfig.sequenceMode;
    if (mode === 'random') {
      // Deterministic seeded Fisher-Yates shuffle for instant dopamine re-shuffling
      let seed = (globalSliderConfig.shuffleSeed || 1) + filtered.length * 31;
      const nextRand = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
      for (let i = filtered.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        const temp = filtered[i];
        filtered[i] = filtered[j];
        filtered[j] = temp;
      }
    } else if (mode === 'alphabetical') {
      const dir = globalSliderConfig.alphabeticalOrder === 'desc' ? -1 : 1;
      filtered.sort((a, b) => {
        const nameA = `${a.title || ''} ${a._albumTitle || ''}`.trim().toLowerCase();
        const nameB = `${b.title || ''} ${b._albumTitle || ''}`.trim().toLowerCase();
        return nameA.localeCompare(nameB) * dir;
      });
    } else if (mode === 'artist') {
      filtered.sort((a, b) => {
        const cmp = a._artist.localeCompare(b._artist);
        if (cmp !== 0) return cmp;
        return (a.title || '').localeCompare(b.title || '');
      });
    } else if (mode === 'folder') {
      filtered.sort((a, b) => {
        const cmp = (a._albumFolder || 'ZZZ').localeCompare(b._albumFolder || 'ZZZ');
        if (cmp !== 0) return cmp;
        return b._albumCreatedAt - a._albumCreatedAt;
      });
    } else if (mode === 'recent') {
      filtered.sort((a, b) => b._albumCreatedAt - a._albumCreatedAt);
    } else if (mode === 'size') {
      filtered.sort((a, b) => {
        if (b._pixels !== a._pixels) return b._pixels - a._pixels;
        return b._bytes - a._bytes;
      });
    }

    return filtered;
  }, [rawPool, globalSliderConfig]);

  // Keep currentIndex within bounds when filters change
  useEffect(() => {
    if (images.length > 0 && currentIndex >= images.length) {
      setCurrentIndex(0);
    }
  }, [images.length, currentIndex]);

  const safeIndex = images.length > 0 ? Math.min(currentIndex, images.length - 1) : 0;
  const currentImage = images[safeIndex];
  const currentAlbum = useMemo(
    () => albums.find(a => a.id === currentImage?._albumId) || activeAlbumObj,
    [albums, currentImage?._albumId, activeAlbumObj]
  );

  const [slideHighResLoaded, setSlideHighResLoaded] = useState(() => {
    return isImagePreloaded(currentImage?.originalUrl || '');
  });

  const fullSlideUrl = currentImage?.originalUrl || currentImage?.rawOriginalUrl;
  const isSlidePreloaded = Boolean(fullSlideUrl && isImagePreloaded(fullSlideUrl));
  const isSlideHdReady = slideHighResLoaded || isSlidePreloaded;

  // Preload preditivo em background dos próximos slides
  useImagePreloader({
    images,
    currentIndex: safeIndex,
    enabled: slideshowOpen && images.length > 0,
    windowSize: 3,
    mode: 'original',
    debounceMs: 120,
    waitForCurrentLoaded: true,
    isCurrentLoaded: isSlideHdReady,
  });

  useEffect(() => {
    if (currentImage?.originalUrl && isImagePreloaded(currentImage.originalUrl)) {
      setSlideHighResLoaded(true);
    } else {
      setSlideHighResLoaded(false);
    }
  }, [currentImage?.id]);

  // Efeito de transição e velocidade configurados pelo usuário (Motion Engine)
  const slideshowAnimSetting = settings.slideshowAnimation || 'switch';
  const slideshowAnimClass = getSlideshowAnimationClass(slideshowAnimSetting, settings.disableAllAnimations);
  const speedClass = getSpeedClass(settings.animationSpeed || 'normal');
  const distanceClass = getDistanceClass(settings.animationDistance || 'normal');

  const isImageFav = Boolean(currentImage?.isFavorite);
  const isAlbumFav = Boolean(currentAlbum?.isFavorite);

  const getInitialColors = (img?: EnrichedSlideImage) => {
    const pal = img?.colorPalette;
    if (pal && pal.length >= 8) {
      return {
        dom: pal[0],
        sec: pal[1] || pal[0],
        center: blendHexColors(pal.slice(0, 4)),
        lateral: blendHexColors(pal.slice(4, 8)),
      };
    } else if (pal && pal.length >= 2) {
      return {
        dom: pal[0],
        sec: pal[1],
        center: pal[0],
        lateral: pal[1],
      };
    } else if (pal && pal.length === 1) {
      return {
        dom: pal[0],
        sec: pal[0],
        center: pal[0],
        lateral: pal[0],
      };
    }
    return {
      dom: '#3b82f6',
      sec: '#10b981',
      center: '#3b82f6',
      lateral: '#10b981',
    };
  };

  const initialColors = getInitialColors(currentImage);
  const [dominantColor, setDominantColor] = useState<string>(initialColors.dom);
  const [secondaryColor, setSecondaryColor] = useState<string>(initialColors.sec);
  const [centerColor, setCenterColor] = useState<string>(initialColors.center);
  const [lateralColor, setLateralColor] = useState<string>(initialColors.lateral);
  const [imageAspect, setImageAspect] = useState<number>(1.33);

  const slideImgRef = useRef<HTMLImageElement>(null);
  const [renderedSize, setRenderedSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const updateImageDimensions = () => {
    if (slideImgRef.current) {
      const rect = slideImgRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setRenderedSize({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateImageDimensions);
    return () => window.removeEventListener('resize', updateImageDimensions);
  }, []);

  useEffect(() => {
    const timer1 = setTimeout(updateImageDimensions, 60);
    const timer2 = setTimeout(updateImageDimensions, 520);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [safeIndex, isImmersive, isFullscreen, imageAspect, controlsVisible, isLocked]);

  // Dynamically synchronize authentic dominant & spatial dual colors
  useEffect(() => {
    if (!currentImage) return;
    if (currentImage.width && currentImage.height) {
      setImageAspect(currentImage.width / currentImage.height);
    }
    const url = currentImage.previewUrl || currentImage.originalUrl || currentImage.thumbnailUrl;
    const pal = (currentImage.colorPalette && currentImage.colorPalette.length > 0)
      ? currentImage.colorPalette
      : (url ? colorPaletteCache.get(url) : undefined);

    if (pal && pal.length > 0) {
      const dom = pal[0];
      const sec = pal[1] || pal[0];
      setDominantColor(dom);
      setSecondaryColor(sec);
      if (pal.length >= 8) {
        setCenterColor(blendHexColors(pal.slice(0, 4)));
        setLateralColor(blendHexColors(pal.slice(4, 8)));
      } else {
        setCenterColor(dom);
        setLateralColor(sec);
      }
    } else if (url) {
      extractDominantColors(url).then(colors => {
        if (colors && colors.length > 0) {
          const dom = colors[0];
          const sec = colors[1] || colors[0];
          setDominantColor(dom);
          setSecondaryColor(sec);
          if (colors.length >= 8) {
            setCenterColor(blendHexColors(colors.slice(0, 4)));
            setLateralColor(blendHexColors(colors.slice(4, 8)));
          } else {
            setCenterColor(dom);
            setLateralColor(sec);
          }
        }
      });
    }

    if (url && (!pal || pal.length < 8)) {
      extractSpatialDualColors(url).then(dual => {
        if (dual && dual.center && dual.lateral) {
          if (dual.center !== '#3b82f6' || dual.lateral !== '#10b981') {
            setCenterColor(dual.center);
            setLateralColor(dual.lateral);
          }
        }
      });
    }
  }, [safeIndex, currentImage?.id, currentImage?.colorPalette]);

  // Automated slideshow playback interval + smooth progress bar
  useEffect(() => {
    if (!slideshowOpen || !isPlaying || images.length <= 1) {
      setSlideProgress(0);
      return;
    }

    const durationMs = speedSeconds * 1000;
    const startTime = performance.now();
    let rafId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(100, (elapsed / durationMs) * 100);
      setSlideProgress(pct);
      if (elapsed >= durationMs) {
        setCurrentIndex(prev => (prev + 1) % images.length);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [slideshowOpen, isPlaying, speedSeconds, images.length, safeIndex]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(isFs);
      if (!isFs) {
        setIsImmersive(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const triggerHeartBurst = () => {
    if (!currentImage) return;
    toggleFavoriteImage(currentImage._albumId, currentImage.id);
    setHeartBurst(true);
    setTimeout(() => setHeartBurst(false), 750);
  };

  const triggerReshuffle = () => {
    setGlobalSliderConfig({
      sequenceMode: 'random',
      shuffleSeed: Date.now(),
    });
    setCurrentIndex(0);
    resetHideTimer();
  };

  // Full desktop keyboard navigation (Escape, Space, ArrowLeft, ArrowRight, F, R, D, H)
  useEffect(() => {
    if (!slideshowOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isArrowKey = e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if ((isFullscreenRef.current || isImmersiveRef.current) && isArrowKey) {
        lastArrowNavTimeRef.current = Date.now();
      } else {
        resetHideTimer();
      }

      if (e.key === 'Escape') {
        if (showDopaminePanel) {
          setShowDopaminePanel(false);
          return;
        }
        if (isLocked) {
          setIsLocked(false);
          resetHideTimer();
          return;
        }
        exitAllFullscreen(setIsFullscreen);
        setSlideshowOpen(false);
      } else if (e.key.toLowerCase() === 'l') {
        setIsLocked(prev => {
          if (prev) resetHideTimer();
          return !prev;
        });
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setShowDopaminePanel(prev => !prev);
      } else if (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 's') {
        e.preventDefault();
        triggerReshuffle();
      } else if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        triggerHeartBurst();
      } else if (e.key === 'ArrowRight' && images.length > 0) {
        lastArrowNavTimeRef.current = Date.now();
        setCurrentIndex(i => (i + 1) % images.length);
      } else if (e.key === 'ArrowLeft' && images.length > 0) {
        lastArrowNavTimeRef.current = Date.now();
        setCurrentIndex(i => (i > 0 ? i - 1 : images.length - 1));
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(p => !p);
      } else if (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setFitMode(m => (m === 'contain' ? 'cover' : 'contain'));
      } else if (e.key.toLowerCase() === 'f' || e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slideshowOpen, images.length, isFullscreen, isImmersive, isLocked, showDopaminePanel, currentImage]);

  if (!slideshowOpen || rawPool.length === 0) return null;

  const toggleFullscreen = () => {
    resetHideTimer();
    const nextState = !isFullscreen;
    toggleAppFullscreen(isFullscreen, setIsFullscreen);
    if (nextState) {
      setControlsVisible(false);
    }
  };

  const speedOptions = [0.8, 1.5, 3, 5, 10];

  const normalizeHex = (hex: string, fallback: string) => {
    let c = (hex || fallback).trim();
    if (!c.startsWith('#')) c = `#${c}`;
    if (c.length === 4) {
      c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    } else if (c.length === 9) {
      c = c.slice(0, 7);
    }
    return c.length === 7 ? c : fallback;
  };

  const normalizedColor = normalizeHex(dominantColor, '#3b82f6');
  const normalizedSecColor = normalizeHex(secondaryColor, '#10b981');
  const normalizedCenterColor = normalizeHex(centerColor, normalizedColor);
  const normalizedLateralColor = normalizeHex(lateralColor, normalizedSecColor);

  const isPt = settings?.language === 'pt-BR';
  const isEn = settings?.language === 'en-US';
  const backdropOptions = [
    {
      key: 'mirror' as SlideshowBackdropMode,
      icon: Layers,
      iconColor: 'text-cyan-400',
      label: isPt ? 'Ambilight Orgânico' : 'Organic Ambilight',
      desc: isPt ? 'Espelho com blur suave (Apple & YouTube)' : 'Soft blurred mirror effect',
    },
    {
      key: 'single' as SlideshowBackdropMode,
      icon: SunMedium,
      iconColor: 'text-amber-400',
      label: isPt ? 'Luz Dominante Viva' : 'Vibrant Aura',
      desc: isPt ? 'Projeção radial dinâmica na cor dominante' : 'Primary color with dynamic radial glow',
    },
    {
      key: 'dual' as SlideshowBackdropMode,
      icon: Blend,
      iconColor: 'text-purple-400',
      label: isPt ? 'Gradiente Dual' : 'Dual Gradient',
      desc: isPt ? 'Média do miolo no centro + Média das laterais' : 'Core center average + Outer edges',
    },
    {
      key: 'cinema' as SlideshowBackdropMode,
      icon: Film,
      iconColor: 'text-slate-400',
      label: isPt ? 'Cinema Escuro' : 'Dark Cinema',
      desc: isPt ? 'Luz ambiente sutil clássica e fundo escuro' : 'Subtle classic dark ambient glow',
    },
  ];

  const currentBackdropOpt = backdropOptions.find(o => o.key === backdropMode) || backdropOptions[0];
  const CurrentModeIcon = currentBackdropOpt.icon;

  const computeBlendedDarkColor = (hex1: string, hex2: string, darkenFactor: number = 0.40): string => {
    const c1 = hexToRgb(hex1);
    const c2 = hexToRgb(hex2);
    const avgR = (c1.r + c2.r) / 2;
    const avgG = (c1.g + c2.g) / 2;
    const avgB = (c1.b + c2.b) / 2;
    const darkR = Math.max(12, Math.min(255, Math.round(avgR * darkenFactor)));
    const darkG = Math.max(12, Math.min(255, Math.round(avgG * darkenFactor)));
    const darkB = Math.max(12, Math.min(255, Math.round(avgB * darkenFactor)));
    return rgbToHex(darkR, darkG, darkB);
  };

  const darkenHex = (hex: string, darkenFactor: number = 0.35): string => {
    const c = hexToRgb(hex);
    const darkR = Math.max(10, Math.min(255, Math.round(c.r * darkenFactor)));
    const darkG = Math.max(10, Math.min(255, Math.round(c.g * darkenFactor)));
    const darkB = Math.max(10, Math.min(255, Math.round(c.b * darkenFactor)));
    return rgbToHex(darkR, darkG, darkB);
  };

  const auraWidth = renderedSize.width > 0
    ? Math.max(Math.round(renderedSize.width * 1.85), renderedSize.width + 260)
    : Math.round(typeof window !== 'undefined' ? window.innerWidth * (imageAspect < 0.88 ? 0.65 : 0.95) : 850);

  const auraHeight = renderedSize.height > 0
    ? Math.max(Math.round(renderedSize.height * 1.70), renderedSize.height + 240)
    : Math.round(typeof window !== 'undefined' ? window.innerHeight * (imageAspect < 0.88 ? 0.95 : 0.75) : 850);

  const thirdBlendedDark = computeBlendedDarkColor(normalizedCenterColor, normalizedLateralColor, 0.40);

  const dualGradientStyle = [
    `radial-gradient(ellipse ${auraWidth}px ${auraHeight}px at 50% 50%, ${normalizedCenterColor}ff 0%, ${normalizedCenterColor}e6 36%, ${normalizedCenterColor}bf 56%, ${normalizedLateralColor}88 78%, ${thirdBlendedDark}55 92%, transparent 100%)`,
    `radial-gradient(ellipse at 50% 50%, ${thirdBlendedDark}99 0%, ${thirdBlendedDark}66 45%, ${thirdBlendedDark}38 75%, ${thirdBlendedDark}18 100%)`
  ].join(', ');

  const darkSingle = darkenHex(normalizedColor, 0.35);
  const singleGradientStyle = [
    `radial-gradient(ellipse ${auraWidth}px ${auraHeight}px at 50% 50%, ${normalizedColor}e6 0%, ${normalizedColor}a0 45%, ${darkSingle}60 80%, transparent 100%)`,
    `radial-gradient(ellipse at 50% 50%, ${darkSingle}80 0%, ${darkSingle}50 50%, ${darkSingle}25 80%, ${darkSingle}12 100%)`
  ].join(', ');

  const cinemaGradientStyle = `radial-gradient(ellipse ${Math.round(auraWidth * 0.85)}px ${Math.round(auraHeight * 0.85)}px at 50% 50%, ${normalizedColor}55 0%, ${normalizedColor}1a 60%, transparent 100%)`;

  const sequenceModeOptions: { key: SliderSequenceMode; label: string; icon: React.FC<any> }[] = [
    { key: 'random', label: t.globalSlider.seqRandom, icon: Shuffle },
    { key: 'alphabetical', label: t.globalSlider.seqAlphabetical, icon: globalSliderConfig.alphabeticalOrder === 'desc' ? ArrowUpAZ : ArrowDownAZ },
    { key: 'artist', label: t.globalSlider.seqArtist, icon: UserCheck },
    { key: 'folder', label: t.globalSlider.seqFolder, icon: Folder },
    { key: 'recent', label: t.globalSlider.seqRecent, icon: Clock },
    { key: 'size', label: t.globalSlider.seqSize, icon: Scaling },
  ];

  const handleResetFilters = () => {
    setGlobalSliderConfig({
      mediaFilter: 'all',
      orientationFilter: 'all',
      sequenceMode: 'random',
      selectedArtist: '',
      selectedFolder: '',
      recentDaysLimit: 0,
      minResolution: 'all',
      onlyFavorites: false,
      shuffleSeed: Date.now(),
    });
    setCurrentIndex(0);
  };

  return (
    <div
      onClick={() => {
        if (isLocked) return;
        if (showBackdropMenu) {
          setShowBackdropMenu(false);
          resetHideTimer();
          return;
        }
        if (showSpeedMenu) {
          setShowSpeedMenu(false);
          resetHideTimer();
          return;
        }
        if (showDopaminePanel) {
          setShowDopaminePanel(false);
          resetHideTimer();
          return;
        }
        if (!controlsVisible) {
          resetHideTimer();
        } else {
          setControlsVisible(false);
        }
      }}
      className={`fixed inset-0 w-full h-full bg-black flex flex-col items-center justify-center select-none animate-backdrop-fade overflow-hidden transition-all duration-300 ease-out ${
        isFullscreen ? 'z-[9999] m-0 p-0 border-0' : 'z-50'
      } ${
        !controlsVisible && !showDopaminePanel ? 'fullscreen-cursor-hidden cursor-none' : 'cursor-default'
      }`}
    >
      {/* Top Dopamine Progress Bar */}
      {isPlaying && images.length > 1 && (
        <div className="absolute top-0 inset-x-0 h-1 bg-white/10 z-40 pointer-events-none overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-500 via-fuchsia-500 to-cyan-400 transition-none"
            style={{ width: `${slideProgress}%` }}
          />
        </div>
      )}

      {/* 4 Backdrop Lighting Modes */}
      {currentImage && backdropMode === 'mirror' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden scale-125 transition-all duration-700 ease-out opacity-75">
          <img
            key={`mirror-${currentImage.id}`}
            src={currentImage.previewUrl || currentImage.originalUrl || currentImage.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover filter blur-[75px] saturate-150 transform transition-all duration-700 ease-out"
          />
          <div className="absolute inset-0 bg-black/25" />
        </div>
      )}

      {currentImage && backdropMode === 'single' && (
        <div
          className="absolute inset-0 pointer-events-none transition-all duration-700 ease-out scale-110"
          style={{ background: singleGradientStyle }}
        />
      )}

      {currentImage && backdropMode === 'dual' && (
        <div
          className="absolute inset-0 pointer-events-none transition-all duration-700 ease-out scale-110"
          style={{ background: dualGradientStyle }}
        />
      )}

      {currentImage && backdropMode === 'cinema' && (
        <div
          className="absolute inset-0 pointer-events-none transition-all duration-700 ease-out scale-110"
          style={{ background: cinemaGradientStyle }}
        />
      )}

      {/* Center Double-Tap Heart Burst Animation */}
      {heartBurst && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="animate-bounce bg-rose-500/30 backdrop-blur-md p-6 rounded-full border border-rose-400/60 shadow-2xl">
            <Heart size={68} className="fill-rose-500 text-rose-400 drop-shadow-[0_0_25px_rgba(244,63,94,0.9)]" />
          </div>
        </div>
      )}

      {/* Floating Unlock Button when locked */}
      {isLocked && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-4 left-4 z-40 transition-all duration-500 ease-out ${
            unlockButtonVisible
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-4 pointer-events-none'
          }`}
        >
          <button
            onClick={() => {
              setIsLocked(false);
              resetHideTimer();
            }}
            className="px-3.5 py-2 rounded-full bg-black/80 hover:bg-black/95 text-amber-300 hover:text-amber-200 border border-amber-500/50 backdrop-blur-md transition-all shadow-2xl active:scale-95 flex items-center gap-2 text-xs font-semibold cursor-pointer"
            title={isPt ? "Clique para destravar os controles do slider (ou pressione 'L' / 'Esc')" : "Click to unlock slider controls (or press 'L' / 'Esc')"}
          >
            <Unlock size={14} className="animate-pulse" />
            <span>{isPt ? 'Controles Travados • Destravar' : 'Controls Locked • Unlock'}</span>
          </button>
        </div>
      )}

      {/* Top Floating Bar */}
      <div
        onClick={e => e.stopPropagation()}
        className={`absolute top-4 inset-x-4 sm:inset-x-6 flex flex-wrap items-center justify-between gap-2 z-30 pt-safe transition-all duration-500 ease-out ${
          (controlsVisible || showDopaminePanel) && !isLocked
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-12 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Scope Switcher Pill (Global App vs Current Album) */}
          <button
            onClick={() => {
              const nextScope = globalSliderConfig.scope === 'all_app' ? 'current_album' : 'all_app';
              setGlobalSliderConfig({ scope: nextScope });
              setCurrentIndex(0);
              resetHideTimer();
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 backdrop-blur-md border transition-all cursor-pointer shadow-2xl ${
              globalSliderConfig.scope === 'all_app'
                ? 'bg-gradient-to-r from-brand-600/90 to-fuchsia-600/90 text-white border-brand-400/50 shadow-glow-brand'
                : 'bg-black/65 text-slate-200 hover:text-white border-white/15'
            }`}
            title={isPt ? 'Alternar entre Todas as Imagens do App e Álbum Atual' : 'Switch between All App Images and Current Album'}
          >
            <Sparkles size={13} className={globalSliderConfig.scope === 'all_app' ? 'text-amber-300' : 'text-brand-400'} />
            <span className="hidden sm:inline">
              {globalSliderConfig.scope === 'all_app' ? t.globalSlider.scopeAllApp : t.globalSlider.scopeCurrentAlbum}
            </span>
          </button>

          {/* Current Slide Info & Source Album Pill */}
          <div className="text-white text-xs font-semibold bg-black/65 px-3.5 py-1.5 rounded-full backdrop-blur-md border border-white/10 flex items-center gap-2 max-w-[240px] sm:max-w-md truncate shadow-2xl">
            <span className="truncate">{currentImage?._albumTitle || currentAlbum?.title || ''}</span>
            {currentImage?._isGif && (
              <span className="px-1.5 py-0.5 rounded bg-fuchsia-500/30 border border-fuchsia-400/50 text-fuchsia-200 text-[10px] font-extrabold uppercase shrink-0">
                GIF
              </span>
            )}
            <span className="text-brand-400 font-mono font-bold shrink-0">
              ({images.length > 0 ? safeIndex + 1 : 0}/{images.length})
            </span>
          </div>

          {/* Open Source Album button when browsing in Global All-App mode */}
          {globalSliderConfig.scope === 'all_app' && currentImage && (
            <button
              onClick={() => {
                setSlideshowOpen(false);
                navigateToView('album-detail', currentImage._albumId);
              }}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/65 hover:bg-brand-600/80 text-slate-200 hover:text-white text-xs font-semibold border border-white/10 transition-all cursor-pointer shadow-xl"
              title={t.globalSlider.openAlbum}
            >
              <ExternalLink size={12} />
              <span>{t.globalSlider.openAlbum}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Quick Shuffle Now Button */}
          <button
            onClick={triggerReshuffle}
            className={`px-3 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xl ${
              globalSliderConfig.sequenceMode === 'random'
                ? 'bg-amber-500/25 text-amber-300 border border-amber-400/50 hover:bg-amber-500/35'
                : 'bg-black/65 text-slate-200 hover:bg-black/90 border border-white/10'
            }`}
            title={`${t.globalSlider.reshuffle} (R)`}
          >
            <Shuffle size={14} />
            <span className="hidden lg:inline">{t.globalSlider.reshuffle}</span>
          </button>

          {/* Dopamine Filter & Sequence Control Drawer Button */}
          <button
            onClick={() => {
              setShowDopaminePanel(prev => !prev);
              setShowSpeedMenu(false);
              setShowBackdropMenu(false);
            }}
            className={`px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xl ${
              showDopaminePanel
                ? 'bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white ring-2 ring-brand-400/60 shadow-glow-brand'
                : 'bg-black/70 text-white hover:bg-black/90 border border-white/15'
            }`}
            title={isPt ? 'Configurar Sequência, Artista, Pasta, GIFs e Orientação (D)' : 'Configure Sequence, Artist, Folder, GIFs & Orientation (D)'}
          >
            <SlidersHorizontal size={14} className="text-brand-300" />
            <span className="hidden sm:inline">{isPt ? 'Sequência & Filtros' : 'Sequence & Filters'}</span>
          </button>

          {/* Fit / Fill Toggle Button */}
          <button
            onClick={() => setFitMode(m => m === 'contain' ? 'cover' : 'contain')}
            className={`p-2.5 rounded-full transition-all border-0 active:scale-95 shadow-2xl cursor-pointer ${
              fitMode === 'cover'
                ? 'bg-brand-600 text-white border-brand-400 shadow-glow-brand ring-2 ring-brand-400/50'
                : 'bg-black/60 text-white hover:bg-black/90 border-white/10'
            }`}
            title={fitMode === 'cover' ? (isPt ? 'Ajustar à Tela (P)' : 'Fit to Screen (P)') : (isPt ? 'Preencher Tela Inteira (P)' : 'Fill Screen (P)')}
          >
            {fitMode === 'cover' ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>

          {/* Fullscreen / Immersive Button */}
          <button
            onClick={toggleFullscreen}
            className={`p-2.5 rounded-full transition-all border-0 active:scale-95 shadow-2xl cursor-pointer ${
              isImmersive || isFullscreen
                ? 'bg-brand-600 text-white border-brand-400 shadow-glow-brand'
                : 'bg-black/60 text-white hover:bg-black/90 border-white/10'
            }`}
            title={isImmersive || isFullscreen ? 'Sair do Modo Imersivo' : 'Tela Cheia / Modo Imersivo'}
          >
            {isImmersive || isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          {/* Close Button */}
          <button
            onClick={() => {
              if (document.fullscreenElement) {
                document.exitFullscreen?.().catch(() => {});
              }
              setSlideshowOpen(false);
            }}
            className="p-2.5 rounded-full bg-black/60 text-white hover:bg-black/90 transition-all border-0 active:scale-95 shadow-2xl cursor-pointer"
            title={isPt ? "Fechar Apresentação" : "Close Slideshow"}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Dopamine Command Center Drawer (Sequence, Media, Orientation, Artist, Folder, Size, Recent) */}
      {showDopaminePanel && !isLocked && (
        <div
          onClick={e => e.stopPropagation()}
          className="absolute top-16 sm:top-20 right-4 sm:right-6 z-40 w-[calc(100vw-2rem)] sm:w-[440px] max-h-[calc(100vh-8.5rem)] overflow-y-auto bg-slate-950/90 backdrop-blur-2xl border border-white/15 rounded-3xl p-4 sm:p-5 shadow-2xl text-white space-y-4 animate-scale-up"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-fuchsia-600 flex items-center justify-center shadow-glow-brand">
                <Flame size={16} className="text-white" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold tracking-tight">{t.globalSlider.title}</h3>
                <p className="text-[11px] text-slate-400">
                  {images.length} {t.globalSlider.matchingCount} • {rawPool.length} total
                </p>
              </div>
            </div>
            <button
              onClick={handleResetFilters}
              className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
            >
              <RotateCcw size={12} />
              <span>{t.globalSlider.resetFilters}</span>
            </button>
          </div>

          {/* 1. Scope: Entire App vs Current Album */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {t.globalSlider.scopeLabel}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setGlobalSliderConfig({ scope: 'all_app' });
                  setCurrentIndex(0);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                  globalSliderConfig.scope === 'all_app'
                    ? 'bg-brand-600 text-white border-brand-400 shadow-glow-brand'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }`}
              >
                <Sparkles size={13} />
                <span>{t.globalSlider.scopeAllApp}</span>
              </button>
              <button
                onClick={() => {
                  setGlobalSliderConfig({ scope: 'current_album' });
                  setCurrentIndex(0);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                  globalSliderConfig.scope === 'current_album'
                    ? 'bg-brand-600 text-white border-brand-400 shadow-glow-brand'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }`}
              >
                <Layers size={13} />
                <span>{t.globalSlider.scopeCurrentAlbum}</span>
              </button>
            </div>
          </div>

          {/* 2. Media Type: Photos + GIFs, Only Photos, Only GIFs */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {t.globalSlider.mediaLabel}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { key: 'all', label: t.globalSlider.mediaAll, icon: Sparkles },
                { key: 'photos', label: t.globalSlider.mediaPhotos, icon: ImageIcon },
                { key: 'gifs', label: t.globalSlider.mediaGifs, icon: Clapperboard },
              ] as { key: SliderMediaFilter; label: string; icon: React.FC<any> }[]).map(opt => {
                const Icon = opt.icon;
                const active = globalSliderConfig.mediaFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setGlobalSliderConfig({ mediaFilter: opt.key });
                      setCurrentIndex(0);
                    }}
                    className={`px-2.5 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                      active
                        ? 'bg-fuchsia-600 text-white border-fuchsia-400 shadow-lg'
                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <Icon size={12} />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Sequence Organization Mode (6 Modes) */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {t.globalSlider.sequenceLabel}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {sequenceModeOptions.map(opt => {
                const Icon = opt.icon;
                const active = globalSliderConfig.sequenceMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      if (opt.key === 'alphabetical' && active) {
                        setGlobalSliderConfig({
                          alphabeticalOrder: globalSliderConfig.alphabeticalOrder === 'asc' ? 'desc' : 'asc',
                        });
                      } else if (opt.key === 'random') {
                        setGlobalSliderConfig({
                          sequenceMode: 'random',
                          shuffleSeed: Date.now(),
                        });
                      } else {
                        setGlobalSliderConfig({ sequenceMode: opt.key });
                      }
                      setCurrentIndex(0);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all cursor-pointer text-left ${
                      active
                        ? 'bg-brand-600 text-white border-brand-400 shadow-glow-brand'
                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contextual Sub-Filter: Specific Artist Selector */}
          {(globalSliderConfig.sequenceMode === 'artist' || Boolean(globalSliderConfig.selectedArtist)) && (
            <div className="space-y-1.5 bg-white/5 p-3 rounded-2xl border border-white/10">
              <label className="text-[11px] font-bold text-brand-300 flex items-center gap-1.5">
                <UserCheck size={13} />
                <span>{t.globalSlider.artistPlaceholder}</span>
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                <button
                  onClick={() => {
                    setGlobalSliderConfig({ selectedArtist: '' });
                    setCurrentIndex(0);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    !globalSliderConfig.selectedArtist
                      ? 'bg-brand-500 text-white'
                      : 'bg-white/10 text-slate-300 hover:bg-white/20'
                  }`}
                >
                  {t.globalSlider.allArtists} ({rawPool.length})
                </button>
                {availableArtists.map(a => (
                  <button
                    key={a.name}
                    onClick={() => {
                      setGlobalSliderConfig({ selectedArtist: a.name });
                      setCurrentIndex(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      globalSliderConfig.selectedArtist === a.name
                        ? 'bg-brand-500 text-white'
                        : 'bg-white/10 text-slate-300 hover:bg-white/20'
                    }`}
                  >
                    {a.name} ({a.count})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contextual Sub-Filter: Specific Folder Selector */}
          {(globalSliderConfig.sequenceMode === 'folder' || Boolean(globalSliderConfig.selectedFolder)) && (
            <div className="space-y-1.5 bg-white/5 p-3 rounded-2xl border border-white/10">
              <label className="text-[11px] font-bold text-brand-300 flex items-center gap-1.5">
                <Folder size={13} />
                <span>{t.globalSlider.folderPlaceholder}</span>
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                <button
                  onClick={() => {
                    setGlobalSliderConfig({ selectedFolder: '' });
                    setCurrentIndex(0);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    !globalSliderConfig.selectedFolder
                      ? 'bg-brand-500 text-white'
                      : 'bg-white/10 text-slate-300 hover:bg-white/20'
                  }`}
                >
                  {t.globalSlider.allFolders}
                </button>
                {availableFolders.map(f => (
                  <button
                    key={f.name}
                    onClick={() => {
                      setGlobalSliderConfig({ selectedFolder: f.name });
                      setCurrentIndex(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      globalSliderConfig.selectedFolder === f.name
                        ? 'bg-brand-500 text-white'
                        : 'bg-white/10 text-slate-300 hover:bg-white/20'
                    }`}
                  >
                    {f.name} ({f.count})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contextual Sub-Filter: Only Recent Albums / Images */}
          {(globalSliderConfig.sequenceMode === 'recent' || Boolean(globalSliderConfig.recentDaysLimit)) && (
            <div className="space-y-1.5 bg-white/5 p-3 rounded-2xl border border-white/10">
              <label className="text-[11px] font-bold text-brand-300 flex items-center gap-1.5">
                <Clock size={13} />
                <span>{t.globalSlider.seqRecent}</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { val: 0, label: isPt ? 'Todas (Recentes 1º)' : 'All (Newest 1st)' },
                  { val: -3, label: isPt ? 'Últimos 3 Álbuns' : 'Latest 3 Albums' },
                  { val: -5, label: isPt ? 'Últimos 5 Álbuns' : 'Latest 5 Albums' },
                  { val: 7, label: isPt ? 'Últimos 7 Dias' : 'Last 7 Days' },
                  { val: 30, label: isPt ? 'Últimos 30 Dias' : 'Last 30 Days' },
                ] as const).map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => {
                      setGlobalSliderConfig({ recentDaysLimit: opt.val });
                      setCurrentIndex(0);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      (globalSliderConfig.recentDaysLimit || 0) === opt.val
                        ? 'bg-brand-500 text-white'
                        : 'bg-white/10 text-slate-300 hover:bg-white/20'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contextual Sub-Filter: Image Size / Resolution */}
          {(globalSliderConfig.sequenceMode === 'size' || globalSliderConfig.minResolution !== 'all') && (
            <div className="space-y-1.5 bg-white/5 p-3 rounded-2xl border border-white/10">
              <label className="text-[11px] font-bold text-brand-300 flex items-center gap-1.5">
                <Scaling size={13} />
                <span>{t.globalSlider.seqSize}</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { key: 'all', label: t.globalSlider.resAll },
                  { key: 'hd', label: t.globalSlider.resHd },
                  { key: '4k', label: t.globalSlider.res4k },
                ] as const).map(r => (
                  <button
                    key={r.key}
                    onClick={() => {
                      setGlobalSliderConfig({ minResolution: r.key });
                      setCurrentIndex(0);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      globalSliderConfig.minResolution === r.key
                        ? 'bg-brand-500 text-white'
                        : 'bg-white/10 text-slate-300 hover:bg-white/20'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. Orientation Filter (All / Vertical / Horizontal) */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {t.globalSlider.orientationLabel}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { key: 'all', label: t.globalSlider.orientAll, icon: Layers },
                { key: 'vertical', label: t.globalSlider.orientVertical, icon: Smartphone },
                { key: 'horizontal', label: t.globalSlider.orientHorizontal, icon: Monitor },
              ] as { key: SliderOrientationFilter; label: string; icon: React.FC<any> }[]).map(opt => {
                const Icon = opt.icon;
                const active = globalSliderConfig.orientationFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setGlobalSliderConfig({ orientationFilter: opt.key });
                      setCurrentIndex(0);
                    }}
                    className={`px-2.5 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                      active
                        ? 'bg-cyan-600 text-white border-cyan-400 shadow-lg'
                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <Icon size={12} />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. Dopamine Boost Toggles (Only Favorites & Ken Burns Motion) */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => {
                setGlobalSliderConfig({ onlyFavorites: !globalSliderConfig.onlyFavorites });
                setCurrentIndex(0);
              }}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                globalSliderConfig.onlyFavorites
                  ? 'bg-rose-600 text-white border-rose-400'
                  : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
              }`}
            >
              <Heart size={13} className={globalSliderConfig.onlyFavorites ? 'fill-white' : ''} />
              <span>{t.globalSlider.onlyFavorites}</span>
            </button>

            <button
              onClick={() => {
                setGlobalSliderConfig({ kenBurnsEffect: !globalSliderConfig.kenBurnsEffect });
              }}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                globalSliderConfig.kenBurnsEffect
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
              }`}
            >
              <Sparkles size={13} />
              <span>{t.globalSlider.kenBurns}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Slide or Empty Filter State */}
      {images.length === 0 ? (
        <div
          onClick={e => e.stopPropagation()}
          className="relative z-20 flex flex-col items-center justify-center text-center p-8 max-w-md bg-slate-900/80 backdrop-blur-2xl rounded-3xl border border-white/15 shadow-2xl space-y-4"
        >
          <SlidersHorizontal size={40} className="text-brand-400" />
          <p className="text-white font-bold text-base">{t.globalSlider.noMatchingImages}</p>
          <button
            onClick={handleResetFilters}
            className="px-5 py-2.5 rounded-full bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-2 shadow-glow-brand transition-all cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>{t.globalSlider.resetFilters}</span>
          </button>
        </div>
      ) : (
        <div
          onDoubleClick={triggerHeartBurst}
          className={`relative w-full h-full min-h-0 min-w-0 flex items-center justify-center z-10 overflow-hidden transition-all duration-500 ease-out ${
            isFullscreen ? 'p-0' : 'p-2 sm:p-6'
          } ${!controlsVisible ? 'cursor-none' : 'cursor-pointer'}`}
        >
          {/* Camada 1: Miniatura Instantânea (0ms LQIP) */}
          {currentImage.thumbnailUrl &&
            currentImage.originalUrl &&
            currentImage.thumbnailUrl !== currentImage.originalUrl &&
            !isSlideHdReady && (
              <img
                key={`slide-thumb-${currentImage.id}-${slideshowAnimClass}`}
                src={currentImage.thumbnailUrl}
                alt=""
                className={`pointer-events-none border-0 absolute z-10 ${slideshowAnimClass} ${speedClass} ${distanceClass} ${
                  isFullscreen
                    ? (fitMode === 'cover' ? 'w-full h-full object-cover rounded-none' : 'w-full h-full object-contain rounded-none')
                    : (!controlsVisible || isImmersive || isLocked
                        ? (fitMode === 'cover' ? 'w-full h-full object-cover rounded-2xl' : 'max-h-[96vh] max-w-[96vw] object-contain rounded-2xl')
                        : (fitMode === 'cover' ? 'w-full h-full object-cover rounded-2xl' : 'max-h-[80vh] max-w-[90vw] object-contain rounded-2xl'))
                }`}
              />
            )}

          {/* Camada 2: Imagem Principal em Alta Resolução */}
          <img
            ref={slideImgRef}
            key={`slide-hd-${currentImage.id}-${slideshowAnimClass}`}
            src={currentImage.originalUrl}
            alt={currentImage.title}
            decoding="async"
            {...({ fetchPriority: 'high' } as any)}
            onLoad={(e) => {
              setSlideHighResLoaded(true);
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setImageAspect(img.naturalWidth / img.naturalHeight);
              }
              const rect = img.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                setRenderedSize({
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                });
              }
            }}
            style={{
              filter: isFullscreen ? 'none' : `drop-shadow(0 0 35px ${backdropMode === 'dual' ? normalizedCenterColor + '35' : normalizedColor + '30'})`,
              willChange: 'max-height, max-width, transform, opacity',
              transform: globalSliderConfig.kenBurnsEffect && isPlaying ? `scale(${1 + (slideProgress / 100) * 0.08})` : undefined,
              transition: globalSliderConfig.kenBurnsEffect ? 'transform 120ms linear' : undefined,
            }}
            className={`${slideshowAnimClass} ${speedClass} ${distanceClass} ${
              isSlideHdReady ? '' : 'transition-opacity duration-150'
            } pointer-events-none border-0 relative z-10 ${
              !isSlideHdReady && currentImage.thumbnailUrl && currentImage.thumbnailUrl !== currentImage.originalUrl
                ? 'opacity-0'
                : 'opacity-100'
            } ${
              isFullscreen
                ? (fitMode === 'cover'
                    ? 'w-full h-full object-cover rounded-none shadow-none'
                    : 'w-full h-full object-contain rounded-none shadow-none')
                : (!controlsVisible || isImmersive || isLocked
                    ? (fitMode === 'cover' ? 'w-full h-full object-cover rounded-2xl shadow-2xl' : 'max-h-[96vh] max-w-[96vw] object-contain rounded-2xl shadow-2xl')
                    : (fitMode === 'cover' ? 'w-full h-full object-cover rounded-2xl shadow-2xl' : 'max-h-[80vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl'))
            }`}
          />
        </div>
      )}

      {/* Bottom Floating Control Pill */}
      <div
        onClick={e => e.stopPropagation()}
        className={`absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 max-w-[calc(100vw-1.5rem)] xl:max-w-fit flex items-center justify-center gap-1.5 xl:gap-3 bg-black/80 backdrop-blur-2xl px-3 xl:px-5 py-2 xl:py-2.5 rounded-full border-0 z-20 shadow-2xl pb-safe transition-all duration-500 ease-out ${
          controlsVisible && !isLocked
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-16 pointer-events-none'
        }`}
      >
        <button
          onClick={() => {
            if (images.length > 0) {
              setCurrentIndex(i => (i > 0 ? i - 1 : images.length - 1));
            }
            resetHideTimer();
          }}
          className="text-slate-300 hover:text-white p-1 sm:p-1.5 transition-transform active:scale-90 shrink-0 cursor-pointer"
          title={isEn ? "Previous" : "Anterior"}
        >
          <ChevronLeft size={18} className="sm:w-5 sm:h-5" />
        </button>

        <button
          onClick={() => {
            setIsPlaying(!isPlaying);
            resetHideTimer();
          }}
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center shadow-glow-brand transition-all active:scale-95 shrink-0 cursor-pointer"
          title={isPlaying ? 'Pausar' : 'Reproduzir'}
        >
          {isPlaying ? <Pause size={15} className="sm:w-[18px] sm:h-[18px]" /> : <Play size={15} className="ml-0.5 sm:w-[18px] sm:h-[18px]" />}
        </button>

        <button
          onClick={() => {
            if (images.length > 0) {
              setCurrentIndex(i => (i + 1) % images.length);
            }
            resetHideTimer();
          }}
          className="text-slate-300 hover:text-white p-1 sm:p-1.5 transition-transform active:scale-90 shrink-0 cursor-pointer"
          title={isPt ? "Próxima" : "Next"}
        >
          <ChevronRight size={18} className="sm:w-5 sm:h-5" />
        </button>

        <div className="h-4 sm:h-5 w-px bg-white/20 mx-0.5 sm:mx-1 shrink-0"></div>

        {/* Speed Selector (Including Turbo 0.8s & 1.5s) */}
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowSpeedMenu(prev => !prev);
              setShowBackdropMenu(false);
              resetHideTimer();
            }}
            className="flex items-center gap-1 text-slate-200 text-[11px] sm:text-xs font-mono px-2 sm:px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-colors shrink-0 cursor-pointer"
            title={isPt ? "Ajustar Velocidade do Slideshow" : "Adjust Slideshow Speed"}
          >
            <Gauge size={13} className="text-brand-400" />
            <span className="font-bold">{speedSeconds}s</span>
          </button>

          {showSpeedMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-12 sm:bottom-14 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-2xl border border-white/20 rounded-2xl p-1.5 shadow-2xl flex items-center gap-1 z-50 animate-scale-up"
            >
              {speedOptions.map(s => (
                <button
                  key={s}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSpeedSeconds(s);
                    setGlobalSliderConfig({ speedSeconds: s });
                    setShowSpeedMenu(false);
                    resetHideTimer();
                  }}
                  className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                    speedSeconds === s
                      ? 'bg-brand-600 text-white shadow-glow-brand'
                      : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-4 sm:h-5 w-px bg-white/20 mx-0.5 sm:mx-1 shrink-0"></div>

        {/* Favoritar Imagem Atual */}
        <button
          onClick={() => {
            if (currentImage) {
              toggleFavoriteImage(currentImage._albumId, currentImage.id);
            }
            resetHideTimer();
          }}
          className={`flex items-center gap-1.5 text-xs p-1.5 sm:px-3 sm:py-1.5 rounded-full border transition-all cursor-pointer shrink-0 ${
            isImageFav
              ? 'bg-rose-600/90 border-rose-400 text-white shadow-glow-brand'
              : 'bg-white/10 hover:bg-rose-500/20 border-white/10 hover:border-rose-400/50 text-slate-200 hover:text-rose-300'
          }`}
          title={isImageFav ? (isPt ? 'Remover imagem dos Favoritos' : 'Remove image from Favorites') : (isPt ? 'Favoritar Imagem Atual (H)' : 'Favorite Current Image (H)')}
        >
          <Heart size={13} className={isImageFav ? 'fill-white text-white' : 'text-slate-300'} />
          <span className="font-semibold hidden xl:inline">{isImageFav ? 'Favoritada' : 'Favoritar'}</span>
        </button>

        {/* Favoritar Álbum */}
        <button
          onClick={() => {
            if (currentAlbum) {
              toggleFavoriteAlbum(currentAlbum.id);
            }
            resetHideTimer();
          }}
          className={`flex items-center gap-1.5 text-xs p-1.5 sm:px-3 sm:py-1.5 rounded-full border transition-all cursor-pointer shrink-0 ${
            isAlbumFav
              ? 'bg-rose-500/30 border-rose-500/50 text-rose-300 shadow-glow-brand'
              : 'bg-white/10 hover:bg-violet-600/20 border-white/10 hover:border-violet-400/50 text-slate-200 hover:text-violet-300'
          }`}
          title={isAlbumFav ? (isPt ? 'Remover álbum dos Favoritos' : 'Remove from Favorites') : (isPt ? 'Favoritar este Álbum' : 'Favorite this Album')}
        >
          <FolderHeart size={13} className={isAlbumFav ? 'fill-rose-400 text-rose-400' : 'text-slate-300'} />
          <span className="font-semibold hidden xl:inline">{isAlbumFav ? (isPt ? 'Álbum Favorito' : 'Favorite Album') : (isPt ? 'Favoritar Álbum' : 'Favorite Album')}</span>
        </button>

        <div className="h-4 sm:h-5 w-px bg-white/20 mx-0.5 sm:mx-1 shrink-0"></div>

        {/* Lock Controls Button */}
        <button
          onClick={() => {
            setIsLocked(true);
            setControlsVisible(false);
            setShowSpeedMenu(false);
            setShowBackdropMenu(false);
            setShowDopaminePanel(false);
          }}
          className="flex items-center gap-1.5 text-slate-200 text-xs p-1.5 sm:px-3 sm:py-1.5 rounded-full bg-white/10 hover:bg-amber-500/20 border border-white/10 hover:border-amber-500/40 hover:text-amber-300 transition-all cursor-pointer shrink-0"
          title={isEn ? "Lock Controls (Pure Immersive Mode • Press 'L' to toggle)" : "Travar Controles (Modo Imersivo Puro • Pressione 'L' para alternar)"}
        >
          <Lock size={13} className="text-amber-400" />
          <span className="font-semibold hidden xl:inline">Travar</span>
        </button>

        {/* Backdrop Lighting Mode Selector */}
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowBackdropMenu(prev => !prev);
              setShowSpeedMenu(false);
              resetHideTimer();
            }}
            className="flex items-center gap-1.5 sm:gap-2 text-slate-200 text-xs p-1.5 sm:px-3 sm:py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-colors shrink-0 cursor-pointer"
            title={isPt ? "Modo de Iluminação de Fundo" : "Ambient Lighting Mode"}
          >
            <CurrentModeIcon size={14} className={currentBackdropOpt.iconColor} />
            <span className="font-semibold hidden xl:inline">{currentBackdropOpt.label}</span>
          </button>

          {showBackdropMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-12 sm:bottom-14 right-0 bg-black/90 backdrop-blur-2xl border border-white/20 rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1 z-50 min-w-[220px] sm:min-w-[240px] max-w-[calc(100vw-2rem)] animate-scale-up"
            >
              {backdropOptions.map(opt => {
                const Icon = opt.icon;
                const isSelected = backdropMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      setBackdropMode(opt.key);
                      setShowBackdropMenu(false);
                      localStorage.setItem('slideshow_backdrop_mode', opt.key);
                      resetHideTimer();
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all text-left flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-brand-600 text-white shadow-glow-brand'
                        : 'text-slate-300 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon size={16} className={isSelected ? 'text-white' : opt.iconColor} />
                      <div className="flex flex-col">
                        <span className="font-bold">{opt.label}</span>
                        <span className="text-[10px] opacity-75 font-normal">{opt.desc}</span>
                      </div>
                    </div>
                    {isSelected && <Check size={14} className="text-white shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
