import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Flame,
  Play,
  Volume2,
  VolumeX,
  Heart,
  Shuffle,
  Sparkles,
  ExternalLink,
  Maximize,
  Minimize,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  Video,
  Smartphone,
  Monitor,
  Layers,
  Folder,
  SlidersHorizontal,
  FastForward,
  X,
  RotateCcw,
  Zap
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import { VideoHighlight } from '../../types';

type ShortsMediaFilter = 'all' | 'videos' | 'photos' | 'gifs';
type ShortsSequenceMode = 'random' | 'recent' | 'favorites' | 'alphabetical';
type ShortsOrientationFilter = 'all' | 'vertical' | 'horizontal';

interface ShortsItem {
  id: string;
  kind: 'video' | 'photo' | 'gif';
  title: string;
  subtitle: string;
  folder: string;
  mediaUrl: string;
  posterUrl: string;
  isFavorite: boolean;
  width: number;
  height: number;
  createdAtTs: number;
  durationLabel?: string;
  resolutionLabel?: string;
  sourceAlbumId?: string;
  sourceVideoId?: string;
  sourceImageId?: string;
  accentColor: string;
  startTime?: number;
  endTime?: number;
  introEnd?: number;
  highlightScore?: number;
  isSmartHighlight?: boolean;
  highlights?: VideoHighlight[];
}

function formatTime(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function resolveSafeImageUrl(raw?: string): string {
  if (!raw) return '';
  if (raw.startsWith('/api/') || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return `/api/proxy-image?url=${encodeURIComponent(raw)}`;
  }
  return raw;
}

function formatCompactCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function formatCleanCaption(rawTitle: string): string {
  if (!rawTitle) return '';
  return rawTitle
    .replace(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mkv|mov)$/i, '')
    .replace(/\b\d{3,5}\s*[x×]\s*\d{3,5}\b/gi, '')
    .replace(/\s*[-–—]\s*[-–—]\s*/g, ' – ')
    .replace(/\s{2,}/g, ' ')
    .trim() || rawTitle;
}

function getEffectiveHighlightStart(item?: ShortsItem, hlIdx?: number): number {
  if (!item || hlIdx === -1) return 0; // Explicitly chosen: Início do vídeo (0:00)
  const effectiveIdx = hlIdx !== undefined ? hlIdx : 0;
  if (item.highlights && item.highlights[effectiveIdx]) {
    return item.highlights[effectiveIdx].start || 0;
  }
  if (item.startTime && item.startTime > 0) {
    return item.startTime;
  }
  return 0;
}

export const ShortsView: React.FC = () => {
  const {
    videos,
    albums,
    albumFolders,
    videoFolders,
    toggleVideoFavorite,
    toggleFavoriteImage,
    navigateToView,
    navigateToSavedItem,
    setSlideshowOpen,
    openTabs,
    settings,
  } = useAppStore();
  const t = translations[settings.language];

  const handleExitShorts = useCallback(() => {
    const prev = openTabs.find(t => t.viewId !== 'shorts');
    if (prev) {
      navigateToView(prev.viewId, prev.albumId);
    } else {
      navigateToView('videos');
    }
  }, [openTabs, navigateToView]);

  const [mediaFilter, setMediaFilter] = useState<ShortsMediaFilter>('all');
  const [sequenceMode, setSequenceMode] = useState<ShortsSequenceMode>('random');
  const [orientationFilter, setOrientationFilter] = useState<ShortsOrientationFilter>('all');
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [shuffleSeed, setShuffleSeed] = useState<number>(() => Date.now());
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>('cover');
  const [showFiltersBar, setShowFiltersBar] = useState<boolean>(false);
  const [expandedCaptionId, setExpandedCaptionId] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<number>(0);

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [heartBurstId, setHeartBurstId] = useState<string | null>(null);
  const [highlightIndexMap, setHighlightIndexMap] = useState<Record<string, number>>({});
  const [highlightDuration, setHighlightDuration] = useState<number>(30);
  const [isAnalyzingActive, setIsAnalyzingActive] = useState<boolean>(false);

  const handleCycleHighlight = useCallback((item: ShortsItem) => {
    const list = (item.highlights && item.highlights.length > 0)
      ? item.highlights
      : (item.startTime && item.startTime > 0)
      ? [{ rank: 1, label: 'Clímax #1 (Ouro)', start: item.startTime, end: item.endTime || item.startTime + 30, score: item.highlightScore || 85, duration: 30 }]
      : [];

    if (list.length === 0) return;

    // Current index in list (or -1 for beginning 0:00)
    const currentIdx = highlightIndexMap[item.id] !== undefined ? highlightIndexMap[item.id] : 0;
    
    // Cycle: 0 -> 1 -> ... -> (list.length - 1) -> -1 (start 0:00) -> 0
    let nextIdx = 0;
    if (currentIdx >= 0) {
      if (currentIdx + 1 < list.length) {
        nextIdx = currentIdx + 1;
      } else {
        nextIdx = -1; // Go to start 0:00
      }
    } else {
      nextIdx = 0; // Back to Gold #1
    }

    setHighlightIndexMap((prev) => ({
      ...prev,
      [item.id]: nextIdx,
    }));

    const vid = activeVideoRef.current;
    if (vid) {
      if (nextIdx >= 0 && list[nextIdx]) {
        vid.currentTime = list[nextIdx].start;
      } else {
        vid.currentTime = 0;
      }
      if (!isPausedRef.current) {
        vid.play().catch(() => {});
      }
    }
  }, [highlightIndexMap]);

  const containerHeightInit = () => {
    if (typeof window !== 'undefined' && window.innerHeight > 0) {
      return Math.max(200, window.innerHeight);
    }
    return 0;
  };
  const [containerHeight, setContainerHeight] = useState<number>(containerHeightInit);

  // Global Escape key listener to exit Shorts view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExitShorts();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExitShorts]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const previousVideoRef = useRef<HTMLVideoElement | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartBurstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const lastTapRef = useRef<{ time: number; id: string }>({ time: 0, id: '' });
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isTouchInteractionRef = useRef<boolean>(false);
  const activeIndexRef = useRef<number>(0);
  activeIndexRef.current = activeIndex;
  const isPausedRef = useRef<boolean>(false);
  isPausedRef.current = isPaused;
  const containerHeightRef = useRef<number>(containerHeight);
  containerHeightRef.current = containerHeight;

  // Clear all pending interaction, scroll, and animation timers on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (programmaticTimeoutRef.current) clearTimeout(programmaticTimeoutRef.current);
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      if (heartBurstTimeoutRef.current) clearTimeout(heartBurstTimeoutRef.current);
    };
  }, []);

  // Build unified pool of Videos + Photos + GIFs
  const allItems = useMemo<ShortsItem[]>(() => {
    const items: ShortsItem[] = [];

    // 1. Add completed / playable videos
    videos.forEach((v, idx) => {
      const streamUrl = v.streamUrl || v.cloudUrl || v.url || '';
      if (!streamUrl) return;

      const w = v.width || 1920;
      const h = v.height || 1080;

      const parsedTs = Date.parse(v.createdAt || '');
      const createdAtTs = Number.isNaN(parsedTs) ? Date.now() - idx * 60000 : parsedTs;

      const introEnd = v.introEnd || 0;
      const highlightStart = v.highlightStart || 0;
      const highlightEnd = v.highlightEnd || (v.durationSeconds || 0);
      const effectiveStart = highlightStart > 0 ? highlightStart : (introEnd > 0 ? introEnd : 0);

      items.push({
        id: `vid-${v.id}`,
        kind: 'video',
        title: v.title || v.filename || 'Vídeo',
        subtitle: v.folder || 'Biblioteca de Vídeos',
        folder: v.folder || '',
        mediaUrl: streamUrl,
        posterUrl: resolveSafeImageUrl(v.thumbnailUrl),
        isFavorite: Boolean(v.isFavorite),
        width: w,
        height: h,
        createdAtTs,
        durationLabel: v.durationSeconds ? `${Math.round(v.durationSeconds)}s` : undefined,
        resolutionLabel: v.width && v.height ? `${v.width}×${v.height}` : v.format?.toUpperCase(),
        sourceVideoId: v.id,
        accentColor: '#ec4899',
        startTime: effectiveStart,
        endTime: highlightEnd,
        introEnd: introEnd,
        highlightScore: v.highlightScore,
        isSmartHighlight: effectiveStart > 0,
        highlights: (v.highlights && v.highlights.length > 0)
          ? v.highlights
          : (highlightStart > 0 ? [{
              rank: 1,
              label: 'Clímax #1 (Ouro)',
              start: highlightStart,
              end: highlightEnd,
              score: v.highlightScore || 85,
              duration: highlightEnd - highlightStart
            }] : []),
      });
    });

    // 2. Add album photos, GIFs, and embedded album videos
    albums.forEach((album, aIdx) => {
      const parsedTs = Date.parse(album.createdAt || '');
      const baseTs = Number.isNaN(parsedTs) ? Date.now() - aIdx * 120000 : parsedTs;

      (album.images || []).forEach((img, imgIdx) => {
        const isAlbumVideo = img.mediaType === 'video' || Boolean(img.videoUrl);
        const url = isAlbumVideo
          ? (img.videoUrl || img.originalUrl || img.previewUrl || '')
          : (img.originalUrl || img.previewUrl || img.thumbnailUrl || '');
        if (!url) return;
        const lower = `${url} ${img.rawOriginalUrl || ''} ${img.format || ''} ${img.title || ''}`.toLowerCase();
        const isGif =
          !isAlbumVideo &&
          (img.mediaType === 'gif' ||
            Boolean(img.isAnimated) ||
            img.format?.toUpperCase() === 'GIF' ||
            lower.includes('.gif'));

        const w = img.width || 1080;
        const h = img.height || 1350;

        if (isAlbumVideo) {
          const cachedHl = (album as any).metadata?.smart_highlight;
          const hls = (cachedHl?.highlights && cachedHl.highlights.length > 0) ? cachedHl.highlights : (img as any).highlights || [];
          const start = cachedHl?.highlight_start || (img as any).startTime || 0;
          const end = cachedHl?.highlight_end || (img as any).endTime || img.durationSeconds || 0;

          items.push({
            id: `img-${album.id}-${img.id || imgIdx}`,
            kind: 'video',
            title: img.title || album.title || 'Vídeo',
            subtitle: album.title || 'Galeria',
            folder: album.folder || '',
            mediaUrl: url,
            posterUrl: resolveSafeImageUrl(img.thumbnailUrl || img.previewUrl || ''),
            isFavorite: Boolean(img.isFavorite) || Boolean(album.isFavorite),
            width: w,
            height: h,
            createdAtTs: baseTs - imgIdx * 1000,
            durationLabel: img.durationSeconds ? `${Math.round(img.durationSeconds)}s` : undefined,
            resolutionLabel: img.width && img.height ? `${img.width}×${img.height}` : img.format,
            sourceAlbumId: album.id,
            sourceImageId: img.id,
            sourceVideoId: album.id,
            accentColor: img.colorPalette?.[0] || '#ec4899',
            startTime: start,
            endTime: end,
            isSmartHighlight: start > 0,
            highlights: hls,
          });
          return;
        }

        items.push({
          id: `img-${album.id}-${img.id}`,
          kind: isGif ? 'gif' : 'photo',
          title: img.title || album.title || 'Imagem',
          subtitle: album.title || 'Galeria',
          folder: album.folder || '',
          mediaUrl: resolveSafeImageUrl(url),
          posterUrl: resolveSafeImageUrl(img.thumbnailUrl || img.previewUrl || url),
          isFavorite: Boolean(img.isFavorite) || Boolean(album.isFavorite),
          width: w,
          height: h,
          createdAtTs: baseTs - imgIdx * 1000,
          durationLabel: img.durationSeconds ? `${Math.round(img.durationSeconds)}s` : undefined,
          resolutionLabel: img.width && img.height ? `${img.width}×${img.height}` : img.format,
          sourceAlbumId: album.id,
          sourceImageId: img.id,
          accentColor: img.colorPalette?.[0] || '#6366f1',
        });
      });
    });

    return items;
  }, [videos, albums]);

  const availableFolders = useMemo(() => {
    const set = new Set<string>();
    albumFolders.forEach(f => f?.name && set.add(f.name));
    videoFolders.forEach(f => f?.name && set.add(f.name));
    allItems.forEach(item => item.folder && set.add(item.folder));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [albumFolders, videoFolders, allItems]);

  // Apply filters & sequence ordering
  const feedItems = useMemo<ShortsItem[]>(() => {
    let list = [...allItems];

    if (mediaFilter === 'videos') {
      list = list.filter(i => i.kind === 'video');
    } else if (mediaFilter === 'photos') {
      list = list.filter(i => i.kind === 'photo' || i.kind === 'gif');
    } else if (mediaFilter === 'gifs') {
      list = list.filter(i => i.kind === 'gif');
    }

    if (orientationFilter === 'vertical') {
      list = list.filter(i => i.height > i.width);
    } else if (orientationFilter === 'horizontal') {
      list = list.filter(i => i.width >= i.height);
    }

    if (selectedFolder) {
      list = list.filter(i => i.folder.toLowerCase() === selectedFolder.toLowerCase());
    }

    if (sequenceMode === 'favorites') {
      const favs = list.filter(i => i.isFavorite);
      if (favs.length > 0) {
        list = favs;
      }
    } else if (sequenceMode === 'recent') {
      list.sort((a, b) => b.createdAtTs - a.createdAtTs);
    } else if (sequenceMode === 'alphabetical') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sequenceMode === 'random') {
      let seed = (shuffleSeed || 1) + list.length * 17;
      const nextRand = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
      }
    }

    return list;
  }, [allItems, mediaFilter, orientationFilter, selectedFolder, sequenceMode, shuffleSeed]);

  // Guard activeIndex within feed boundary and align scroll if catalog shrinks
  useEffect(() => {
    if (feedItems.length > 0 && activeIndex >= feedItems.length) {
      setActiveIndex(feedItems.length - 1);
      const h = containerHeightRef.current || containerRef.current?.clientHeight || 0;
      if (containerRef.current && h > 0) {
        containerRef.current.scrollTo({ top: (feedItems.length - 1) * h, behavior: 'auto' });
      }
    }
  }, [feedItems.length, activeIndex]);

  // Observe container height and keep scroll position synchronized on orientation change or dynamic toolbar resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleHeightChange = (rawH: number) => {
      if (rawH > 0) {
        const newH = Math.round(rawH);
        if (newH !== containerHeightRef.current) {
          containerHeightRef.current = newH;
          setContainerHeight(newH);
          requestAnimationFrame(() => {
            if (containerRef.current && !touchStartPosRef.current) {
              isProgrammaticScrollRef.current = true;
              containerRef.current.scrollTop = activeIndexRef.current * newH;
              if (programmaticTimeoutRef.current) {
                clearTimeout(programmaticTimeoutRef.current);
              }
              programmaticTimeoutRef.current = setTimeout(() => {
                isProgrammaticScrollRef.current = false;
                programmaticTimeoutRef.current = null;
              }, 100);
            }
          });
        }
      }
    };

    if (container.clientHeight > 0) {
      handleHeightChange(container.clientHeight);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height || container.clientHeight;
        if (h > 0) {
          handleHeightChange(h);
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Virtual windowing (R1): only mount activeIndex - 1, activeIndex, activeIndex + 1 (max 3 items in DOM)
  const { mountedItems, startIndex, endIndex } = useMemo(() => {
    if (feedItems.length === 0) {
      return { mountedItems: [], startIndex: 0, endIndex: -1 };
    }
    const safeActive = Math.max(0, Math.min(feedItems.length - 1, activeIndex));
    const start = Math.max(0, safeActive - 1);
    const end = Math.min(feedItems.length - 1, safeActive + 1);
    const items: { item: ShortsItem; idx: number }[] = [];
    for (let i = start; i <= end; i++) {
      items.push({ item: feedItems[i], idx: i });
    }
    return { mountedItems: items, startIndex: start, endIndex: end };
  }, [feedItems, activeIndex]);

  const scrollToIndex = useCallback((idx: number) => {
    if (feedItems.length === 0) return;
    const bounded = ((idx % feedItems.length) + feedItems.length) % feedItems.length;
    const container = containerRef.current;
    if (!container) return;

    isProgrammaticScrollRef.current = true;
    if (programmaticTimeoutRef.current) {
      clearTimeout(programmaticTimeoutRef.current);
    }
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    if (bounded === activeIndexRef.current) {
      const vid = activeVideoRef.current;
      if (vid) {
        vid.currentTime = 0;
        vid.play().catch(() => {});
      }
    }

    setActiveIndex(bounded);
    setIsPaused(false);

    const isAdjacent = Math.abs(bounded - activeIndexRef.current) === 1;
    const h = containerHeightRef.current || container.clientHeight;
    if (h > 0) {
      container.scrollTo({
        top: bounded * h,
        behavior: isAdjacent ? 'smooth' : 'auto',
      });
    }

    programmaticTimeoutRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      programmaticTimeoutRef.current = null;
    }, isAdjacent ? 450 : 50);
  }, [feedItems.length]);

  // Reset to top when filter changes
  useEffect(() => {
    setActiveIndex(0);
    setIsPaused(false);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [mediaFilter, orientationFilter, selectedFolder, sequenceMode, shuffleSeed]);

  // Explicit hardware decoder teardown helper
  const teardownVideoElement = useCallback((vid: HTMLVideoElement | null) => {
    if (!vid) return;
    try {
      vid.pause();
    } catch (_) {}
  }, []);

  // Safe universal autoplay executor with seamless browser policy recovery
  const playVideoSafely = useCallback((vid: HTMLVideoElement | null) => {
    if (!vid || isPausedRef.current) return;
    vid.muted = isMuted;
    const p = vid.play();
    if (p !== undefined) {
      p.catch((err) => {
        // If unmuted playback is blocked by browser autoplay policy (NotAllowedError/SecurityError)
        // gracefully fall back to muted autoplay immediately so the feed keeps playing uninterrupted!
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
          vid.muted = true;
          setIsMuted(true);
          vid.play().catch(() => {});
        }
        // Note: AbortError is normal during rapid scrolling or seeking; NEVER set isPaused = true!
      });
    }
  }, [isMuted]);

  // Sync active video playback exclusively on the activeIndex element (R2)
  useEffect(() => {
    const currentItem = feedItems[activeIndex];
    if (!currentItem || currentItem.kind !== 'video') {
      if (activeVideoRef.current) {
        teardownVideoElement(activeVideoRef.current);
        activeVideoRef.current = null;
        previousVideoRef.current = null;
      }
      return;
    }

    const vid = activeVideoRef.current;
    if (!vid) return;

    const target = getEffectiveHighlightStart(currentItem, highlightIndexMap[currentItem.id]);
    if (target > 0 && Math.abs(vid.currentTime - target) > 0.5) {
      try {
        vid.currentTime = target;
      } catch (_) {}
    }

    if (isPaused) {
      vid.pause();
    } else {
      // Seek-Before-Play: Only start playing if target is 0:00 OR if the video has already reached target!
      if (target === 0 || Math.abs(vid.currentTime - target) <= 1.0) {
        playVideoSafely(vid);
      }
    }
  }, [activeIndex, isPaused, feedItems, highlightIndexMap, playVideoSafely, teardownVideoElement]);

  // On-demand background smart highlight detection with debounce to prevent flood on rapid swiping
  useEffect(() => {
    const item = feedItems[activeIndex];
    if (!item || item.kind !== 'video' || !item.sourceVideoId) return;
    if (item.startTime !== undefined && item.startTime > 0 && item.highlights && item.highlights.length > 0) {
      setIsAnalyzingActive(false);
      return;
    }

    let isMounted = true;
    setIsAnalyzingActive(true);
    const timer = setTimeout(() => {
      fetch(`/api/videos/${encodeURIComponent(item.sourceVideoId || '')}/smart-highlight?desired_window=${highlightDuration}`)
        .then(res => res.json())
        .then(data => {
          if (!isMounted) return;
          setIsAnalyzingActive(false);
          if (!data?.smart_highlight) return;
          const sh = data.smart_highlight;
          const start = sh.highlight_start > 0 ? sh.highlight_start : (sh.intro_end > 0 ? sh.intro_end : 0);
          if (start > 0) {
            item.startTime = start;
            item.endTime = sh.highlight_end || item.endTime;
            item.introEnd = sh.intro_end;
            item.highlightScore = sh.highlight_score;
            item.isSmartHighlight = true;
            if (Array.isArray(sh.highlights)) {
              item.highlights = sh.highlights;
            }
            setHighlightIndexMap(prev => ({
              ...prev,
              [item.id]: prev[item.id] !== undefined ? prev[item.id] : 0
            }));
            const vid = activeVideoRef.current;
            const currentIdx = highlightIndexMap[item.id] !== undefined ? highlightIndexMap[item.id] : 0;
            if (vid && currentIdx !== -1) {
              try {
                vid.currentTime = start;
              } catch (_) {}
              if (!isPausedRef.current) {
                playVideoSafely(vid);
              }
            }
          } else {
            const vid = activeVideoRef.current;
            if (vid && !isPausedRef.current) {
              playVideoSafely(vid);
            }
          }
        })
        .catch(() => {
          if (isMounted) {
            setIsAnalyzingActive(false);
            const vid = activeVideoRef.current;
            if (vid && !isPausedRef.current) {
              playVideoSafely(vid);
            }
          }
        });
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [activeIndex, feedItems, highlightIndexMap, highlightDuration, playVideoSafely]);

  // Explicit hardware decoder teardown on component unmount
  useEffect(() => {
    return () => {
      if (activeVideoRef.current) {
        teardownVideoElement(activeVideoRef.current);
      }
    };
  }, [teardownVideoElement]);

  // Stable video ref callback: avoids React inline ref null/re-attach cycle on state updates
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el) {
      if (previousVideoRef.current && previousVideoRef.current !== el) {
        teardownVideoElement(previousVideoRef.current);
      }
      previousVideoRef.current = el;
      activeVideoRef.current = el;
    }
  }, [teardownVideoElement]);

  // Convergence helper to ensure scroll snapping lands precisely on slide boundary
  const snapConvergence = useCallback((targetIndex: number, h: number) => {
    const container = containerRef.current;
    if (!container || h <= 0) return;
    if (touchStartPosRef.current) return;
    const targetTop = targetIndex * h;
    if (Math.abs(container.scrollTop - targetTop) > 2) {
      isProgrammaticScrollRef.current = true;
      container.scrollTo({
        top: targetTop,
        behavior: 'smooth',
      });
      if (programmaticTimeoutRef.current) {
        clearTimeout(programmaticTimeoutRef.current);
      }
      programmaticTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        programmaticTimeoutRef.current = null;
      }, 200);
    }
  }, []);

  // Debounced scroll listener (R4: avoids micro-stutters during momentum scrolling)
  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const h = containerHeightRef.current || container.clientHeight;
      if (h <= 0) return;

      const newIndex = Math.round(container.scrollTop / h);
      const clamped = Math.max(0, Math.min(feedItems.length - 1, newIndex));

      setActiveIndex(prev => {
        if (prev !== clamped) {
          setIsPaused(false);
          return clamped;
        }
        return prev;
      });

      snapConvergence(clamped, h);
    }, 60);
  }, [feedItems.length, snapConvergence]);

  // Native scrollend event listener for immediate response when momentum stops
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScrollEnd = () => {
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false;
        if (programmaticTimeoutRef.current) {
          clearTimeout(programmaticTimeoutRef.current);
          programmaticTimeoutRef.current = null;
        }
        return;
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      const h = containerHeightRef.current || container.clientHeight;
      if (h <= 0) return;
      const newIndex = Math.round(container.scrollTop / h);
      const clamped = Math.max(0, Math.min(feedItems.length - 1, newIndex));
      setActiveIndex(prev => {
        if (prev !== clamped) {
          setIsPaused(false);
          return clamped;
        }
        return prev;
      });
      snapConvergence(clamped, h);
    };

    container.addEventListener('scrollend', handleScrollEnd);
    return () => {
      container.removeEventListener('scrollend', handleScrollEnd);
    };
  }, [feedItems.length, snapConvergence]);

  // Auto-advance timer for photo/GIF items when autoAdvance is enabled
  useEffect(() => {
    if (!autoAdvance || isPaused || feedItems.length <= 1) return;
    const current = feedItems[activeIndex];
    if (!current || current.kind === 'video') return;

    const timer = setTimeout(() => {
      scrollToIndex(activeIndex + 1);
    }, 4200);

    return () => clearTimeout(timer);
  }, [autoAdvance, isPaused, activeIndex, feedItems, scrollToIndex]);

  // Keyboard navigation (ArrowUp, ArrowDown, Space, M, R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        scrollToIndex(activeIndex + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        scrollToIndex(activeIndex - 1);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsPaused(p => !p);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setIsMuted(m => !m);
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setSequenceMode('random');
        setShuffleSeed(Date.now());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, scrollToIndex]);

  const handleToggleFavorite = useCallback((item: ShortsItem) => {
    if (item.sourceVideoId) {
      toggleVideoFavorite(item.sourceVideoId);
    } else if (item.sourceAlbumId && item.sourceImageId) {
      toggleFavoriteImage(item.sourceAlbumId, item.sourceImageId);
    }
    setHeartBurstId(item.id);
    if (heartBurstTimeoutRef.current) {
      clearTimeout(heartBurstTimeoutRef.current);
    }
    heartBurstTimeoutRef.current = setTimeout(() => {
      setHeartBurstId(prev => (prev === item.id ? null : prev));
      heartBurstTimeoutRef.current = null;
    }, 750);
  }, [toggleVideoFavorite, toggleFavoriteImage]);

  // Disambiguate single-tap vs double-tap and reject scroll displacement
  const handleTouchStart = (e: React.TouchEvent) => {
    isTouchInteractionRef.current = true;
    isProgrammaticScrollRef.current = false;
    if (e.touches.length === 1) {
      touchStartPosRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    } else {
      touchStartPosRef.current = null;
    }
  };

  const handleTouchCancel = useCallback(() => {
    touchStartPosRef.current = null;
    isTouchInteractionRef.current = false;
  }, []);

  const handleSlideTap = useCallback((item: ShortsItem) => {
    const now = Date.now();
    if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 320) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = { time: 0, id: '' };
      handleToggleFavorite(item);
    } else {
      lastTapRef.current = { time: now, id: item.id };
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      singleTapTimerRef.current = setTimeout(() => {
        setIsPaused(p => !p);
        singleTapTimerRef.current = null;
      }, 280);
    }
  }, [handleToggleFavorite]);

  const handleTouchEnd = useCallback((e: React.TouchEvent, item: ShortsItem) => {
    if (!touchStartPosRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartPosRef.current.x;
    const dy = touch.clientY - touchStartPosRef.current.y;
    touchStartPosRef.current = null;

    // Movement > 12px indicates scroll/swipe gesture, not a stationary tap
    if (Math.hypot(dx, dy) > 12) {
      isTouchInteractionRef.current = false;
      return;
    }

    handleSlideTap(item);
  }, [handleSlideTap]);

  const handleSlideClick = useCallback((item: ShortsItem) => {
    if (isTouchInteractionRef.current) {
      isTouchInteractionRef.current = false;
      return;
    }
    handleSlideTap(item);
  }, [handleSlideTap]);

  const handleOpenSource = (item: ShortsItem) => {
    if (item.sourceVideoId) {
      navigateToSavedItem('videos', item.folder || '', item.sourceVideoId);
    } else if (item.sourceAlbumId) {
      navigateToView('album-detail', item.sourceAlbumId);
    } else {
      navigateToView('videos');
    }
  };

  // Reset per-slide transient UI state when activeIndex changes
  useEffect(() => {
    setVideoProgress(0);
    setExpandedCaptionId(null);
    setIsPaused(false);
  }, [activeIndex]);

  const hasActiveCustomFilters =
    orientationFilter !== 'all' || selectedFolder !== '' || sequenceMode !== 'random';

  return (
    <div className="relative w-full h-full bg-black overflow-hidden flex flex-col select-none">
      {/* Ultra-Clean Social Media Top Overlay Bar (TikTok / Reels Style) */}
      <div className="absolute top-0 inset-x-0 z-30 pt-2.5 pb-6 px-3 sm:px-5 bg-gradient-to-b from-black/80 via-black/35 to-transparent pointer-events-none">
        <div className="max-w-[540px] mx-auto flex items-center justify-between gap-2 pointer-events-auto flex-nowrap">
          {/* Left: Exit/Back Button + Clean Category Tabs with Glowing Active Underline */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-nowrap overflow-hidden">
            <button
              type="button"
              onClick={handleExitShorts}
              className="w-8 h-8 rounded-full bg-black/45 hover:bg-black/75 backdrop-blur-md border border-white/20 text-white/90 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-90 shadow-lg shrink-0"
              title={settings.language === 'pt-BR' ? 'Sair dos Shorts / Voltar (Esc)' : 'Exit Shorts / Back (Esc)'}
              aria-label={settings.language === 'pt-BR' ? 'Sair dos Shorts' : 'Exit Shorts'}
            >
              <ChevronLeft size={18} className="mr-0.5" />
            </button>

            <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 overflow-x-auto no-scrollbar py-0.5 flex-nowrap">
              {([
                { key: 'all', label: t.shorts.tabAll },
                { key: 'videos', label: t.shorts.tabVideos },
                { key: 'photos', label: t.shorts.tabPhotos },
                { key: 'gifs', label: t.shorts.tabGifs },
              ] as { key: ShortsMediaFilter; label: string }[]).map(opt => {
                const active = mediaFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setMediaFilter(opt.key)}
                    className={`relative pb-1.5 text-[13px] sm:text-sm tracking-tight transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                      active
                        ? 'text-white font-extrabold drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]'
                        : 'text-white/60 hover:text-white/90 font-semibold drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {active && (
                      <span className="absolute bottom-0 inset-x-1 h-[2.5px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Subtle Counter + Minimalist Glass Action Icons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {feedItems.length > 0 && (
              <span
                className="px-2 py-1 rounded-full bg-black/35 backdrop-blur-md border border-white/10 text-white/80 font-mono text-[10px] font-semibold tracking-tight"
                title={`${activeIndex + 1} / ${feedItems.length}`}
              >
                {activeIndex + 1}/{formatCompactCount(feedItems.length)}
              </span>
            )}

            <button
              onClick={() => {
                setSequenceMode('random');
                setShuffleSeed(Date.now());
              }}
              className="w-8 h-8 rounded-full bg-black/35 hover:bg-black/60 backdrop-blur-md border border-white/15 text-white/90 flex items-center justify-center transition-all cursor-pointer active:scale-90 shadow-lg"
              title={`${t.shorts.shuffleNow} (R)`}
              aria-label={t.shorts.shuffleNow}
            >
              <Shuffle size={14} />
            </button>

            <button
              onClick={() => setSlideshowOpen(true, 0, 'global')}
              className="w-8 h-8 rounded-full bg-black/35 hover:bg-black/60 backdrop-blur-md border border-white/15 text-fuchsia-300 hover:text-fuchsia-200 flex items-center justify-center transition-all cursor-pointer active:scale-90 shadow-lg"
              title={t.globalSlider.launchGlobalBtn}
              aria-label={t.globalSlider.launchGlobalBtn}
            >
              <Sparkles size={14} />
            </button>

            <button
              onClick={() => setShowFiltersBar(s => !s)}
              className={`relative w-8 h-8 rounded-full backdrop-blur-md border flex items-center justify-center transition-all cursor-pointer active:scale-90 shadow-lg ${
                showFiltersBar || hasActiveCustomFilters
                  ? 'bg-white/25 text-white border-white/40'
                  : 'bg-black/35 hover:bg-black/60 text-white/90 border-white/15'
              }`}
              title={t.shorts.preferencesTitle}
              aria-label={t.shorts.preferencesTitle}
            >
              <SlidersHorizontal size={14} />
              {hasActiveCustomFilters && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-black" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Sheet Filter & Preferences Drawer (Closed by Default) */}
      {showFiltersBar && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center"
          onClick={() => setShowFiltersBar(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-[540px] bg-slate-950/95 backdrop-blur-2xl border-t border-x border-white/15 rounded-t-3xl p-4 sm:p-5 shadow-2xl space-y-4 max-h-[82dvh] overflow-y-auto"
          >
            {/* Drag Handle */}
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto -mt-1 mb-1" />

            {/* Sheet Header */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-rose-500 via-fuchsia-500 to-indigo-600 flex items-center justify-center shadow">
                  <SlidersHorizontal size={14} className="text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-white tracking-tight">
                    {t.shorts.preferencesTitle}
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    {feedItems.length} {settings.language === 'en-US' ? 'items in feed' : 'mídias no feed'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {hasActiveCustomFilters && (
                  <button
                    onClick={() => {
                      setOrientationFilter('all');
                      setSelectedFolder('');
                      setSequenceMode('random');
                      setShuffleSeed(Date.now());
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>{t.shorts.resetFilters}</span>
                  </button>
                )}
                <button
                  onClick={() => setShowFiltersBar(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 1. Feed Sequence / Order */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t.shorts.sequenceLabel}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {([
                  { key: 'random', label: t.shorts.seqRandom },
                  { key: 'recent', label: t.shorts.seqRecent },
                  { key: 'favorites', label: t.shorts.seqFavorites },
                  { key: 'alphabetical', label: t.shorts.seqAlphabetical },
                ] as { key: ShortsSequenceMode; label: string }[]).map(opt => {
                  const active = sequenceMode === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => {
                        setSequenceMode(opt.key);
                        if (opt.key === 'random') setShuffleSeed(Date.now());
                      }}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        active
                          ? 'bg-fuchsia-600/90 text-white border-fuchsia-400 shadow-lg shadow-fuchsia-600/25'
                          : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Orientation / Aspect Ratio */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t.shorts.orientationLabel}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { key: 'all', label: t.shorts.orientAll, icon: Layers },
                  { key: 'vertical', label: t.shorts.orientVertical, icon: Smartphone },
                  { key: 'horizontal', label: t.shorts.orientHorizontal, icon: Monitor },
                ] as { key: ShortsOrientationFilter; label: string; icon: React.FC<any> }[]).map(opt => {
                  const Icon = opt.icon;
                  const active = orientationFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setOrientationFilter(opt.key)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        active
                          ? 'bg-cyan-600/90 text-white border-cyan-400 shadow-lg shadow-cyan-600/25'
                          : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Icon size={13} className="shrink-0" />
                      <span className="truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Folder Filter */}
            {availableFolders.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {t.shorts.folderLabel}
                </label>
                <div className="flex items-center gap-2 bg-white/5 px-3 py-2.5 rounded-xl border border-white/10">
                  <Folder size={15} className="text-brand-400 shrink-0" />
                  <select
                    value={selectedFolder}
                    onChange={e => setSelectedFolder(e.target.value)}
                    className="w-full bg-transparent text-white text-xs font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="" className="bg-slate-900 text-white">
                      {t.shorts.allFolders}
                    </option>
                    {availableFolders.map(folder => (
                      <option key={folder} value={folder} className="bg-slate-900 text-white">
                        {folder}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* 4. Playback & Display Toggles */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t.shorts.playbackLabel}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setAutoAdvance(a => !a)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    autoAdvance
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                      : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <FastForward size={14} />
                  <span>{t.shorts.autoAdvance}</span>
                </button>

                <button
                  onClick={() => setFitMode(m => (m === 'cover' ? 'contain' : 'cover'))}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    fitMode === 'cover'
                      ? 'bg-brand-500/20 text-brand-300 border-brand-400/40'
                      : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {fitMode === 'cover' ? <Maximize size={14} /> : <Minimize size={14} />}
                  <span>{fitMode === 'cover' ? t.shorts.fitCover : t.shorts.fitContain}</span>
                </button>
              </div>
            </div>

            {/* 5. Highlight Climax Duration */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Duração do Clímax</span>
                <span className="text-amber-400 font-mono text-[10px]">{highlightDuration}s</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[15, 30, 60].map(dur => (
                  <button
                    key={dur}
                    onClick={() => setHighlightDuration(dur)}
                    className={`py-2 px-2.5 rounded-xl text-xs font-bold border flex items-center justify-center gap-1 transition-all cursor-pointer ${
                      highlightDuration === dur
                        ? 'bg-amber-500/25 text-amber-300 border-amber-400 shadow-lg shadow-amber-500/20'
                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Zap size={11} className={highlightDuration === dur ? 'fill-amber-400 text-amber-400' : 'text-slate-400'} />
                    <span>{dur}s</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Vertical Snap-Scroll Feed */}
      {feedItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
            <Flame size={32} className="text-rose-500" />
          </div>
          <h2 className="text-lg font-extrabold text-white mb-1">{t.shorts.emptyTitle}</h2>
          <p className="text-xs text-slate-400 max-w-md mb-5">{t.shorts.emptyDesc}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setMediaFilter('all');
                setOrientationFilter('all');
                setSelectedFolder('');
                setSequenceMode('random');
              }}
              className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition-all cursor-pointer"
            >
              {t.shorts.resetFilters}
            </button>
            <button
              onClick={() => navigateToView('gallery')}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-all cursor-pointer"
            >
              {t.shorts.openSourceAlbum}
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchCancel={handleTouchCancel}
          onWheel={() => {
            isProgrammaticScrollRef.current = false;
          }}
          className="flex-1 w-full h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar touch-pan-y overscroll-contain"
          style={{
            scrollSnapType: 'y mandatory',
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain',
          }}
        >
          {/* Top Virtual Spacer (R1) */}
          {startIndex > 0 && (
            <div
              style={{
                height: containerHeight > 0 ? `${startIndex * containerHeight}px` : `${startIndex * 100}%`,
                width: '100%',
                flexShrink: 0,
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            />
          )}

          {/* Mounted Windowed Slides (R1, R2, R3) */}
          {mountedItems.map(({ item, idx }) => {
            const isActive = idx === activeIndex;
            const cleanCaption = formatCleanCaption(item.title);
            const isCaptionExpanded = expandedCaptionId === item.id;
            const creatorLabel = item.folder || item.subtitle || 'Galeria';

            return (
              <div
                key={item.id}
                data-short-index={idx}
                onTouchStart={handleTouchStart}
                onTouchEnd={(e) => handleTouchEnd(e, item)}
                onTouchCancel={handleTouchCancel}
                onClick={() => handleSlideClick(item)}
                className="relative w-full snap-start snap-always shrink-0 flex items-center justify-center overflow-hidden bg-black"
                style={{
                  height: containerHeight > 0 ? `${containerHeight}px` : '100%',
                  scrollSnapAlign: 'start',
                  scrollSnapStop: 'always',
                }}
              >
                {/* Dynamic Hardware-Accelerated Ambient Backdrop (R3: replaces blur(60px) filter) */}
                <div
                  className="absolute inset-0 pointer-events-none overflow-hidden"
                  style={{ willChange: 'transform' }}
                >
                  <div
                    className="w-full h-full opacity-35 transition-colors duration-700"
                    style={{
                      background: `radial-gradient(circle at 50% 45%, ${item.accentColor || '#6366f1'} 0%, rgba(10, 10, 20, 0.95) 70%, #000000 100%)`,
                      willChange: 'transform',
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />
                </div>

                {/* Center Media Container (R2: exactly 1 active <video> in DOM) */}
                <div className="relative w-full h-full max-w-[540px] mx-auto flex items-center justify-center overflow-hidden sm:my-1.5 sm:rounded-3xl sm:border sm:border-white/10 shadow-2xl bg-black">
                  {item.kind === 'video' ? (
                    <div className="relative w-full h-full flex items-center justify-center">
                      {/* Persistent Poster Image (ensures thumbnail is ALWAYS visible, zero black screens) */}
                      {item.posterUrl ? (
                        <img
                          src={item.posterUrl}
                          alt={item.title}
                          className={`absolute inset-0 w-full h-full ${
                            fitMode === 'cover' ? 'object-cover' : 'object-contain'
                          }`}
                          loading="eager"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-black text-slate-500">
                          <Video size={48} className="opacity-40" />
                        </div>
                      )}

                      {/* Active Video Stream */}
                      {isActive && (
                        <video
                          key={item.id}
                          ref={setVideoRef}
                          src={(() => {
                            const target = getEffectiveHighlightStart(item, highlightIndexMap[item.id]);
                            return target > 0 ? `${item.mediaUrl}#t=${target}` : item.mediaUrl;
                          })()}
                          playsInline
                          {...({ 'webkit-playsinline': 'true', 'x5-playsinline': 'true' } as any)}
                          preload="auto"
                          loop={!autoAdvance}
                          muted={isMuted}
                          onLoadedMetadata={(e) => {
                            const v = e.currentTarget;
                            const target = getEffectiveHighlightStart(item, highlightIndexMap[item.id]);
                            if (target > 0) {
                              if (Math.abs(v.currentTime - target) > 0.5) {
                                try {
                                  v.currentTime = target;
                                } catch (_) {}
                              }
                            } else {
                              playVideoSafely(v);
                            }
                          }}
                          onCanPlay={(e) => {
                            const v = e.currentTarget;
                            const target = getEffectiveHighlightStart(item, highlightIndexMap[item.id]);
                            if (target === 0 || Math.abs(v.currentTime - target) <= 1.0) {
                              playVideoSafely(v);
                            }
                          }}
                          onSeeked={(e) => {
                            const v = e.currentTarget;
                            const target = getEffectiveHighlightStart(item, highlightIndexMap[item.id]);
                            if (target === 0 || v.currentTime >= target - 0.5) {
                              playVideoSafely(v);
                            }
                          }}
                          onTimeUpdate={(e) => {
                            const v = e.currentTarget;
                            if (v.duration > 0) {
                              setVideoProgress((v.currentTime / v.duration) * 100);
                            }
                          }}
                          onEnded={() => {
                            if (autoAdvance) {
                              scrollToIndex(idx + 1);
                            }
                          }}
                          className={`relative z-10 w-full h-full ${
                            fitMode === 'cover' ? 'object-cover' : 'object-contain'
                          }`}
                        />
                      )}
                    </div>
                  ) : (
                    <img
                      src={item.mediaUrl}
                      alt={item.title}
                      className={`w-full h-full transition-transform duration-[4000ms] ease-out ${
                        fitMode === 'cover' ? 'object-cover' : 'object-contain'
                      } ${isActive && !isPaused ? 'scale-105' : 'scale-100'}`}
                      loading="eager"
                    />
                  )}

                  {/* Subtle Center Pause Indicator (TikTok / Reels Style — Only When Paused) */}
                  {isActive && isPaused && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none z-20">
                      <div className="w-16 h-16 rounded-full bg-black/45 backdrop-blur-md border border-white/20 flex items-center justify-center text-white/95 shadow-2xl">
                        <Play size={30} className="ml-1 fill-white/90" />
                      </div>
                    </div>
                  )}

                  {/* Double-Tap Heart Burst */}
                  {heartBurstId === item.id && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                      <div className="animate-bounce bg-rose-500/25 backdrop-blur-md p-6 rounded-full border border-rose-400/50 shadow-2xl">
                        <Heart size={64} className="fill-rose-500 text-rose-500" />
                      </div>
                    </div>
                  )}

                  {/* Bottom-Left Social Media Caption & Creator Overlay */}
                  <div
                    onClick={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    onTouchEnd={e => e.stopPropagation()}
                    onTouchCancel={e => e.stopPropagation()}
                    className="absolute bottom-0 inset-x-0 pt-16 pb-4 sm:pb-5 px-3.5 sm:px-5 pr-16 sm:pr-20 bg-gradient-to-t from-black/90 via-black/45 to-transparent flex items-end justify-between z-20 pointer-events-none"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1 pointer-events-auto">
                      {/* Creator / Folder Handle Pill + Subtle Format Chip */}
                      <div className="flex items-center gap-1.5 flex-nowrap max-w-full overflow-hidden">
                        <button
                          onClick={() => handleOpenSource(item)}
                          className="max-w-[105px] sm:max-w-[200px] px-2 sm:px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/15 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer truncate shrink"
                          title={item.kind === 'video' ? t.shorts.openSourceVideo : t.shorts.openSourceAlbum}
                        >
                          <Folder size={11} className="text-rose-400 shrink-0" />
                          <span className="truncate">@{creatorLabel}</span>
                        </button>

                        <span className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/75 text-[10px] font-semibold tracking-wide shrink-0">
                          {item.kind === 'video' ? 'VIDEO' : item.kind === 'gif' ? 'GIF' : 'PHOTO'}
                          {item.durationLabel
                            ? ` • ${item.durationLabel}`
                            : item.resolutionLabel
                            ? ` • ${item.resolutionLabel}`
                            : ''}
                        </span>

                        {/* Smart Highlight Climax & Intro Skip Pill */}
                        {isAnalyzingActive && item.id === feedItems[activeIndex]?.id ? (
                          <div className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 backdrop-blur-md text-[10px] font-semibold tracking-wide flex items-center gap-1 animate-pulse shadow-sm shrink-0">
                            <Zap size={10} className="fill-amber-400 text-amber-400 animate-spin shrink-0" />
                            <span className="hidden sm:inline">⚡ Buscando Clímax...</span>
                            <span className="sm:hidden font-mono text-[9.5px]">⚡ Clímax...</span>
                          </div>
                        ) : item.kind === 'video' && ((item.highlights && item.highlights.length > 0) || (item.startTime && item.startTime > 0)) ? (() => {
                          const hls = item.highlights && item.highlights.length > 0 ? item.highlights : [
                            { rank: 1, label: 'Clímax #1 (Ouro)', start: item.startTime || 0, end: item.endTime || (item.startTime || 0) + 30, score: item.highlightScore || 85, duration: 30 }
                          ];
                          const activeHlIdx = highlightIndexMap[item.id] !== undefined ? highlightIndexMap[item.id] : 0;
                          
                          let badgeText = '';
                          let mobileBadgeText = '';
                          let badgeStyle = '';
                          let badgeIcon = <Zap size={10} className="fill-amber-400 text-amber-400 shrink-0" />;
                          
                          if (activeHlIdx === -1) {
                            badgeText = '▶️ Início (0:00)';
                            mobileBadgeText = '▶️ 0:00';
                            badgeStyle = 'bg-slate-700/60 hover:bg-slate-700/80 text-slate-200 border-white/15';
                            badgeIcon = <RotateCcw size={10} className="text-slate-300 shrink-0" />;
                          } else {
                            const curHl = hls[activeHlIdx] || hls[0];
                            const r = curHl.rank;
                            const isGold = r === 'gold' || r === 1 || activeHlIdx === 0;
                            const isSilver = r === 'silver' || r === 2 || activeHlIdx === 1;

                            if (isGold) {
                              badgeText = `🥇 ${curHl.label || 'Clímax Principal'} (${formatTime(curHl.start)})`;
                              mobileBadgeText = `🥇 ${formatTime(curHl.start)}`;
                              badgeStyle = 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40 shadow-glow-amber';
                              badgeIcon = <Zap size={10} className="fill-amber-400 text-amber-400 animate-pulse shrink-0" />;
                            } else if (isSilver) {
                              badgeText = `🥈 ${curHl.label || 'Destaque Secundário'} (${formatTime(curHl.start)})`;
                              mobileBadgeText = `🥈 ${formatTime(curHl.start)}`;
                              badgeStyle = 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border-orange-500/40';
                              badgeIcon = <Flame size={10} className="fill-orange-400 text-orange-400 shrink-0" />;
                            } else {
                              badgeText = `🥉 ${curHl.label || 'Gancho Dinâmico'} (${formatTime(curHl.start)})`;
                              mobileBadgeText = `🥉 ${formatTime(curHl.start)}`;
                              badgeStyle = 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border-cyan-500/40';
                              badgeIcon = <Sparkles size={10} className="fill-cyan-400 text-cyan-400 shrink-0" />;
                            }
                          }

                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCycleHighlight(item);
                              }}
                              className={`px-1.5 sm:px-2 py-0.5 rounded-full backdrop-blur-md text-[10px] font-semibold tracking-wide flex items-center gap-1 shadow-sm transition-all cursor-pointer border shrink-0 ${badgeStyle}`}
                              title={hls.length > 1 ? `Alternar entre ${hls.length} destaques e o início do vídeo` : "Alternar entre o clímax e o início (0:00)"}
                            >
                              {badgeIcon}
                              <span className="hidden sm:inline">{badgeText}</span>
                              <span className="sm:hidden font-mono text-[9.5px]">{mobileBadgeText}</span>
                            </button>
                          );
                        })() : null}
                      </div>

                      {/* Clean Expandable Caption */}
                      <div
                        onClick={() => setExpandedCaptionId(isCaptionExpanded ? null : item.id)}
                        className="cursor-pointer group"
                      >
                        <h3
                          className={`text-white/95 font-medium text-[13px] sm:text-sm leading-snug drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] ${
                            isCaptionExpanded ? 'line-clamp-4' : 'line-clamp-1'
                          }`}
                        >
                          {cleanCaption}
                        </h3>
                        {item.subtitle && item.subtitle !== creatorLabel && (
                          <p className="text-white/65 text-[11px] truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] mt-0.5">
                            {item.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Vertical Action Rail (Instagram Reels / TikTok Style) */}
                  <div
                    onClick={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    onTouchEnd={e => e.stopPropagation()}
                    onTouchCancel={e => e.stopPropagation()}
                    className="absolute right-2.5 sm:right-3.5 bottom-4 sm:bottom-5 z-30 flex flex-col items-center gap-3"
                  >
                    {/* 1. Like / Favorite */}
                    <button
                      onClick={() => handleToggleFavorite(item)}
                      className="flex flex-col items-center gap-0.5 group cursor-pointer active:scale-90 transition-transform"
                      title={t.shorts.doubleTapHint}
                    >
                      <div
                        className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center backdrop-blur-md border transition-all shadow-lg ${
                          item.isFavorite
                            ? 'bg-rose-500/25 border-rose-400/50 text-rose-500'
                            : 'bg-black/30 hover:bg-black/50 text-white border-white/15'
                        }`}
                      >
                        <Heart
                          size={21}
                          className={
                            item.isFavorite
                              ? 'fill-rose-500 text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.7)]'
                              : 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]'
                          }
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                        {item.isFavorite ? t.shorts.savedLabel : t.shorts.likeLabel}
                      </span>
                    </button>

                    {/* 2. Sound Mute/Unmute (for videos) OR Auto-Advance Toggle (for photos/GIFs) */}
                    {item.kind === 'video' ? (
                      <button
                        onClick={() => setIsMuted(m => !m)}
                        className="flex flex-col items-center gap-0.5 group cursor-pointer active:scale-90 transition-transform"
                        title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                      >
                        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/30 hover:bg-black/50 text-white border border-white/15 backdrop-blur-md flex items-center justify-center transition-all shadow-lg">
                          {isMuted ? (
                            <VolumeX size={19} className="text-rose-400" />
                          ) : (
                            <Volume2 size={19} />
                          )}
                        </div>
                        <span className="text-[10px] font-semibold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                          {isMuted ? t.shorts.soundOff : t.shorts.soundOn}
                        </span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setAutoAdvance(a => !a)}
                        className="flex flex-col items-center gap-0.5 group cursor-pointer active:scale-90 transition-transform"
                        title={t.shorts.autoAdvance}
                      >
                        <div
                          className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full border backdrop-blur-md flex items-center justify-center transition-all shadow-lg ${
                            autoAdvance
                              ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/40'
                              : 'bg-black/30 hover:bg-black/50 text-white/80 border-white/15'
                          }`}
                        >
                          <FastForward size={18} />
                        </div>
                        <span className="text-[10px] font-semibold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                          Auto
                        </span>
                      </button>
                    )}

                    {/* 3. Fit / Cover Toggle */}
                    <button
                      onClick={() => setFitMode(m => (m === 'cover' ? 'contain' : 'cover'))}
                      className="flex flex-col items-center gap-0.5 group cursor-pointer active:scale-90 transition-transform"
                      title={fitMode === 'cover' ? t.shorts.fitContain : t.shorts.fitCover}
                    >
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/30 hover:bg-black/50 text-white border border-white/15 backdrop-blur-md flex items-center justify-center transition-all shadow-lg">
                        {fitMode === 'cover' ? <Minimize size={18} /> : <Maximize size={18} />}
                      </div>
                      <span className="text-[10px] font-semibold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                        {fitMode === 'cover' ? t.shorts.fitContain : t.shorts.fitCover}
                      </span>
                    </button>

                    {/* 4. Open Source Album / Video Library (Sleek Glass Disc/Square) */}
                    <button
                      onClick={() => handleOpenSource(item)}
                      className="flex flex-col items-center gap-0.5 group cursor-pointer active:scale-90 transition-transform"
                      title={item.kind === 'video' ? t.shorts.openSourceVideo : t.shorts.openSourceAlbum}
                    >
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-white/15 hover:bg-white/25 text-white border border-white/25 backdrop-blur-md flex items-center justify-center transition-all shadow-xl overflow-hidden">
                        <ExternalLink size={17} />
                      </div>
                      <span className="text-[10px] font-semibold text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                        {t.shorts.albumLabel}
                      </span>
                    </button>

                    {/* 5. Desktop-Only Prev / Next Snap Buttons (Hidden on Mobile Touch) */}
                    <div className="hidden md:flex flex-col gap-1.5 pt-1">
                      <button
                        onClick={() => scrollToIndex(idx - 1)}
                        className="w-8 h-8 rounded-full bg-black/40 hover:bg-white/20 text-white border border-white/15 backdrop-blur-md flex items-center justify-center transition-all cursor-pointer"
                        title="Previous (↑)"
                      >
                        <ChevronUp size={15} />
                      </button>
                      <button
                        onClick={() => scrollToIndex(idx + 1)}
                        className="w-8 h-8 rounded-full bg-black/40 hover:bg-white/20 text-white border border-white/15 backdrop-blur-md flex items-center justify-center transition-all cursor-pointer"
                        title="Next (↓)"
                      >
                        <ChevronDown size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Ultra-Thin Social Progress Bar at Bottom Edge (2px) */}
                  {isActive && (
                    <div className="absolute bottom-0 inset-x-0 h-[2px] bg-white/15 z-30 pointer-events-none overflow-hidden">
                      {item.kind === 'video' ? (
                        <div
                          className="h-full bg-white/90 transition-[width] duration-150 ease-linear"
                          style={{ width: `${Math.min(100, Math.max(0, videoProgress))}%` }}
                        />
                      ) : autoAdvance && !isPaused ? (
                        <div
                          key={`prog-${item.id}-${activeIndex}`}
                          className="h-full bg-white/80 origin-left"
                          style={{
                            width: '100%',
                            animation: 'shortsProgressFill 4.2s linear forwards',
                          }}
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Bottom Virtual Spacer (R1) */}
          {feedItems.length - 1 - endIndex > 0 && (
            <div
              style={{
                height: containerHeight > 0
                  ? `${(feedItems.length - 1 - endIndex) * containerHeight}px`
                  : `${(feedItems.length - 1 - endIndex) * 100}%`,
                width: '100%',
                flexShrink: 0,
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            />
          )}
        </div>
      )}

      {/* Keyframe for smooth photo/GIF auto-advance bottom progress bar */}
      <style>{`
        @keyframes shortsProgressFill {
          0% { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
};
