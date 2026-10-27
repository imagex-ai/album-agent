import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  Info,
  Sparkles,
  Sliders,
  Star,
  MapPin,
  FileText,
  Copy,
  Check,
  ExternalLink,
  Play,
  Maximize2,
  Minimize2,
  BookmarkCheck,
  Loader2,
  Palette
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatFileSize } from '../../utils/formatters';
import { translations } from '../../i18n/translations';
import { extractDominantColors } from '../../services/colorExtractor';
import { getMediaCategory, getMediaExtension, isVideoMedia } from '../../utils/mediaClassification';

export const LightboxModal: React.FC = () => {
  const {
    lightboxImage,
    lightboxAlbum,
    closeLightbox,
    openLightbox,
    setSlideshowOpen,
    setAlbumCover,
    settings
  } = useAppStore();
  const t = translations[settings.language].lightbox;

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCoverUpdating, setIsCoverUpdating] = useState(false);
  const [imagePalette, setImagePalette] = useState<string[]>(lightboxImage?.colorPalette || []);
  const [glacierBg, setGlacierBg] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('imagex_lightbox_glacier');
      return saved !== null ? saved === 'true' : true;
    } catch (_) {
      return true;
    }
  });

  useEffect(() => {
    if (!lightboxImage) return;
    if (lightboxImage.colorPalette && lightboxImage.colorPalette.length > 0) {
      setImagePalette(lightboxImage.colorPalette);
    } else {
      const url = lightboxImage.previewUrl || lightboxImage.originalUrl || lightboxImage.thumbnailUrl;
      if (url) {
        extractDominantColors(url).then(colors => {
          if (colors && colors.length > 0) {
            setImagePalette(colors);
          }
        });
      }
    }
  }, [lightboxImage?.id, lightboxImage?.colorPalette]);

  // Top Toolbar Drag & Wheel Controls
  const topToolbarRef = useRef<HTMLDivElement>(null);
  const [isTopToolbarDragging, setIsTopToolbarDragging] = useState(false);
  const topToolbarDragState = useRef({ isDown: false, startX: 0, scrollLeft: 0, hasMoved: false });

  const handleTopToolbarWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (topToolbarRef.current) {
      topToolbarRef.current.scrollLeft += (e.deltaY || e.deltaX);
    }
  };

  const handleTopToolbarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!topToolbarRef.current) return;
    topToolbarDragState.current = {
      isDown: true,
      startX: e.pageX,
      scrollLeft: topToolbarRef.current.scrollLeft,
      hasMoved: false
    };
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!topToolbarDragState.current.isDown || !topToolbarRef.current) return;
      const dx = e.pageX - topToolbarDragState.current.startX;
      if (Math.abs(dx) > 4) {
        topToolbarDragState.current.hasMoved = true;
        setIsTopToolbarDragging(true);
        topToolbarRef.current.scrollLeft = topToolbarDragState.current.scrollLeft - dx * 1.5;
      }
    };

    const handleGlobalMouseUp = () => {
      if (topToolbarDragState.current.isDown) {
        topToolbarDragState.current.isDown = false;
        setTimeout(() => setIsTopToolbarDragging(false), 50);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // Filmstrip Carousel Interactive Controls
  const filmstripRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLButtonElement>(null);
  const [isFilmstripDragging, setIsFilmstripDragging] = useState(false);
  const [filmstripStartX, setFilmstripStartX] = useState(0);
  const [filmstripScrollLeft, setFilmstripScrollLeft] = useState(0);


  // Auto-scroll filmstrip to keep active thumbnail smoothly centered
  useEffect(() => {
    if (activeThumbRef.current) {
      activeThumbRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest'
      });
    }
  }, [lightboxImage?.id]);

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      const el = document.documentElement as any;
      const req = el?.requestFullscreen || el?.webkitRequestFullscreen;
      if (req) {
        req.call(el).catch(() => {});
      }
      setIsFullscreen(true);
    } else {
      const ex = document.exitFullscreen || (document as any).webkitExitFullscreen;
      if (ex && (document.fullscreenElement || (document as any).webkitFullscreenElement)) {
        ex.call(document).catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  // Keep fullscreen state in sync with browser / native changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (!isFs && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen]);

  const handleStartSlideshow = () => {
    if (!lightboxAlbum) return;
    closeLightbox();
    useAppStore.setState({ activeAlbumId: lightboxAlbum.id });
    setSlideshowOpen(true);
  };

  // Reset zoom & pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [lightboxImage]);

  // Exit native fullscreen on unmount if active
  useEffect(() => {
    return () => {
      const ex = document.exitFullscreen || (document as any).webkitExitFullscreen;
      if (ex && (document.fullscreenElement || (document as any).webkitFullscreenElement)) {
        try { ex.call(document); } catch (_) {}
      }
    };
  }, []);

  // Keyboard controls with full support for shortcuts
  useEffect(() => {
    if (!lightboxImage || !lightboxAlbum) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent shortcut interference when typing inside text inputs
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (isFullscreen) {
            toggleFullscreen();
          } else {
            closeLightbox();
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isFullscreen) {
          toggleFullscreen();
        } else {
          closeLightbox();
        }
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
 else if (e.key.toLowerCase() === 'z') {
        setZoom(z => (z === 1 ? 2.5 : 1));
        setPan({ x: 0, y: 0 });
      } else if (e.key.toLowerCase() === 'd') {
        handleDownload();
      } else if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
      } else if (e.key.toLowerCase() === 'g') {
        setGlacierBg(prev => {
          const next = !prev;
          try {
            localStorage.setItem('imagex_lightbox_glacier', String(next));
          } catch (_) {}
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, lightboxAlbum, isFullscreen]);

  if (!lightboxImage || !lightboxAlbum) return null;

  const albumImages = lightboxAlbum.images || [];
  const currentIndex = albumImages.findIndex(i => i.id === lightboxImage.id);

  const isVideoItem = isVideoMedia(lightboxImage);

  const videoSrc = lightboxImage.videoUrl || (lightboxImage as any).videoStreamUrl || lightboxImage.originalUrl;

  const isGifItem = getMediaCategory(lightboxImage) === 'gif';

  const ambientBgUrl = isVideoItem
    ? (lightboxImage.thumbnailUrl || lightboxImage.rawThumbnailUrl)
    : (lightboxImage.previewUrl || lightboxImage.originalUrl || lightboxImage.rawOriginalUrl || lightboxImage.thumbnailUrl);

  const handleNext = () => {
    if (albumImages.length === 0) return;
    if (currentIndex >= 0 && currentIndex < albumImages.length - 1) {
      openLightbox(albumImages[currentIndex + 1], lightboxAlbum);
    } else {
      openLightbox(albumImages[0], lightboxAlbum);
    }
  };

  const handlePrev = () => {
    if (albumImages.length === 0) return;
    if (currentIndex > 0) {
      openLightbox(albumImages[currentIndex - 1], lightboxAlbum);
    } else {
      openLightbox(albumImages[albumImages.length - 1], lightboxAlbum);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const scrollFilmstrip = (direction: 'left' | 'right') => {
    if (filmstripRef.current) {
      const scrollAmount = direction === 'left' ? -260 : 260;
      filmstripRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleFilmstripWheel = (e: React.WheelEvent) => {
    if (filmstripRef.current) {
      filmstripRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleFilmstripMouseDown = (e: React.MouseEvent) => {
    if (!filmstripRef.current) return;
    setIsFilmstripDragging(true);
    setFilmstripStartX(e.pageX - filmstripRef.current.offsetLeft);
    setFilmstripScrollLeft(filmstripRef.current.scrollLeft);
  };

  const handleFilmstripMouseMove = (e: React.MouseEvent) => {
    if (!isFilmstripDragging || !filmstripRef.current) return;
    e.preventDefault();
    const x = e.pageX - filmstripRef.current.offsetLeft;
    const walk = (x - filmstripStartX) * 1.5;
    filmstripRef.current.scrollLeft = filmstripScrollLeft - walk;
  };

  const handleFilmstripMouseUp = () => {
    setIsFilmstripDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      setZoom(z => Math.min(8, z + 0.25));
    } else {
      setZoom(z => Math.max(1, z - 0.25));
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    if (diff > 45) {
      handleNext();
    } else if (diff < -45) {
      handlePrev();
    }
    setTouchStartX(null);
  };

  const handleCopyHex = (hex: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(hex).catch(() => {});
    }
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1500);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    const fileExt = getMediaExtension(lightboxImage);
    link.href = isVideoItem ? videoSrc : (lightboxImage.originalUrl || lightboxImage.rawOriginalUrl || lightboxImage.thumbnailUrl);
    link.download = `${lightboxImage.title || (isVideoItem ? 'video' : isGifItem ? 'animacao' : 'original-image')}.${fileExt}`;
    link.target = '_blank';
    link.click();
  };

  return (
    <div className={`fixed inset-0 h-[100dvh] max-h-[100dvh] select-none animate-fade-in flex flex-col bg-black overflow-hidden ${
      isFullscreen ? 'z-[999] w-screen h-screen max-w-screen max-h-screen' : 'z-50'
    }`}>
      {/* Ambient Glacier Frosted Glass Background Layer */}
      {glacierBg && ambientBgUrl && (
        <div className="absolute inset-0 pointer-events-none select-none overflow-hidden z-0">
          <img
            key={`glacier-ambient-${lightboxImage.id || ambientBgUrl}`}
            src={ambientBgUrl}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover scale-125 filter blur-[75px] sm:blur-[95px] saturate-[1.6] opacity-45 transform transition-opacity duration-700 ease-out pointer-events-none select-none"
          />
          {/* Dark Contrast / Vignette Gradient Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/80 pointer-events-none" />
          <div className="absolute inset-0 bg-black/25 pointer-events-none" />
        </div>
      )}

      {/* Floating Exit Fullscreen Button */}
      {isFullscreen && (
        <button
          onClick={toggleFullscreen}
          className="fixed top-4 right-4 z-[1000] p-2.5 rounded-full bg-black/70 hover:bg-black/95 text-white/80 hover:text-white border border-white/20 backdrop-blur-md transition-all shadow-2xl active:scale-95"
          title={t.exitFullscreen}
        >
          <Minimize2 size={20} />
        </button>
      )}


      {/* Top Floating Toolbar with iOS Safe Area */}
      {!isFullscreen && (
        <div className="pt-safe px-3 sm:px-4 py-2 border-b border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 z-20 bg-black/60 backdrop-blur-md">
          {/* Left Info Cluster */}
          <div className="flex items-center justify-between sm:justify-start gap-3 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={closeLightbox}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all active:scale-95 shrink-0"
                title={t.close}
              >
                <X size={18} />
              </button>
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-extrabold text-white truncate max-w-[200px] sm:max-w-md">
                  {lightboxImage.title}
                </h3>
                <p className="text-[10px] sm:text-[11px] text-slate-400 font-mono truncate">
                  {currentIndex + 1} de {(lightboxAlbum.images || []).length} • {lightboxImage.width && lightboxImage.height ? `${lightboxImage.width}×${lightboxImage.height}` : 'Dim. N/D'} ({lightboxImage.aspectRatio || 'auto'}) • {formatFileSize(lightboxImage.fileSizeBytes)} • <span className={isGifItem ? "text-amber-400 font-bold" : isVideoItem ? "text-violet-400 font-bold" : "text-emerald-400 font-bold"}>{isGifItem ? t.badgeGif : isVideoItem ? t.badgeVideo : t.badgeOriginal}</span>
                </p>
              </div>
            </div>

            {/* Mobile Quick Info Toggle */}
            <button
              onClick={() => setShowInfoDrawer(!showInfoDrawer)}
              className={`sm:hidden p-2 rounded-xl border transition-all shrink-0 ${
                showInfoDrawer ? 'bg-brand-500 border-brand-400 text-white shadow-glow-brand' : 'bg-white/10 border-white/10 text-slate-300'
              }`}
              title={t.techSpecs}
            >
              <Info size={16} />
            </button>
          </div>

          {/* Center & Right Action Tools in Spotify/Instagram Style Touch-Scroll Bar */}
          <div
            ref={topToolbarRef}
            onWheel={handleTopToolbarWheel}
            onMouseDown={handleTopToolbarMouseDown}
            className={`flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar touch-scroll py-0.5 select-none ${
              isTopToolbarDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >

            {/* Zoom In/Out Controls */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-xl bg-white/10 shrink-0">
              <button
                onClick={() => setZoom(z => Math.max(1, z - 0.5))}
                className="p-1 text-slate-300 hover:text-white transition-colors"
                title={t.zoomOut}
              >
                <ZoomOut size={14} />
              </button>
              <span className="text-xs font-mono text-slate-200 w-11 text-center font-bold">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(z => Math.min(8, z + 0.5))}
                className="p-1 text-slate-300 hover:text-white transition-colors"
                title={t.zoomIn}
              >
                <ZoomIn size={14} />
              </button>
            </div>

            {/* Slideshow Mode Button */}
            <button
              onClick={handleStartSlideshow}
              className="px-3 py-1.5 rounded-xl bg-brand-500/20 border border-brand-500/40 text-brand-300 hover:bg-brand-500/30 text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 shadow-sm"
              title={t.slideshow}
            >
              <Play size={13} className="fill-current shrink-0" />
              <span>{t.slideshow}</span>
            </button>

            {/* Glacier Ambient Lighting Mode Toggle */}
            <button
              onClick={() => {
                const next = !glacierBg;
                setGlacierBg(next);
                try {
                  localStorage.setItem('imagex_lightbox_glacier', String(next));
                } catch (_) {}
              }}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 shadow-sm ${
                glacierBg
                  ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400/40'
                  : 'bg-white/10 border-white/10 text-slate-400 hover:text-white hover:bg-white/15'
              }`}
              title={glacierBg ? (t.glacierBgActive || 'Fundo Glasier Ativado (G)') : (t.glacierBgDisabled || 'Ativar Fundo Glasier (G)')}
            >
              <Sparkles size={13} className={glacierBg ? 'text-cyan-300 animate-pulse' : 'text-slate-400'} />
              <span className="hidden sm:inline">{t.glacierBg || 'Fundo Glasier'}</span>
            </button>

            {/* Fullscreen Toggle Button */}
            <button
              onClick={toggleFullscreen}
              className={`p-2 rounded-xl border transition-all shrink-0 ${
                isFullscreen
                  ? 'bg-brand-500 border-brand-400 text-white shadow-glow-brand'
                  : 'bg-white/10 border-white/10 text-slate-300 hover:text-white'
              }`}
              title={isFullscreen ? t.exitFullscreen : t.fullscreen}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>



            {/* Definir como Capa do Álbum */}
            {(() => {
              const imgTargetUrl = lightboxImage.rawOriginalUrl || lightboxImage.originalUrl || lightboxImage.rawThumbnailUrl || lightboxImage.thumbnailUrl;
              const isCurrentCover = !!(
                (lightboxAlbum.rawCoverImage && (lightboxImage.rawOriginalUrl === lightboxAlbum.rawCoverImage || lightboxImage.originalUrl === lightboxAlbum.rawCoverImage || lightboxImage.rawThumbnailUrl === lightboxAlbum.rawCoverImage || lightboxImage.thumbnailUrl === lightboxAlbum.rawCoverImage)) ||
                (lightboxAlbum.coverImage && (lightboxImage.originalUrl === lightboxAlbum.coverImage || lightboxImage.thumbnailUrl === lightboxAlbum.coverImage || lightboxImage.rawOriginalUrl === lightboxAlbum.coverImage))
              );

              return (
                <button
                  onClick={async () => {
                    if (imgTargetUrl) {
                      setIsCoverUpdating(true);
                      await setAlbumCover(lightboxAlbum.id, imgTargetUrl);
                      setTimeout(() => setIsCoverUpdating(false), 1000);
                    }
                  }}
                  disabled={isCoverUpdating}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 shadow-sm ${
                    isCurrentCover
                      ? 'bg-amber-500 border-amber-400 text-white shadow-glow-brand'
                      : 'bg-white/10 border-white/10 text-slate-300 hover:text-white hover:bg-amber-600/30 hover:border-amber-500/50'
                  }`}
                  title={isCurrentCover ? (t.currentCover || 'Capa Atual') : t.setCover}
                >
                  {isCoverUpdating ? (
                    <Loader2 size={13} className="animate-spin text-amber-300" />
                  ) : (
                    <BookmarkCheck size={14} className={isCurrentCover ? 'text-white' : 'text-amber-300'} />
                  )}
                  <span className="hidden sm:inline">{isCurrentCover ? (t.currentCover || 'Capa Atual') : t.setCover}</span>
                </button>
              );
            })()}

            {/* Download Original Button */}
            <button
              onClick={handleDownload}
              className="px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-glow-brand whitespace-nowrap shrink-0"
              title={t.downloadOriginal}
            >
              <Download size={14} className="shrink-0" />
              <span>{t.downloadOriginal}</span>
            </button>

            {/* Desktop Info Toggle */}
            <button
              onClick={() => setShowInfoDrawer(!showInfoDrawer)}
              className={`hidden sm:flex p-2 rounded-xl border transition-all shrink-0 ${
                showInfoDrawer ? 'bg-white/20 border-white/40 text-white' : 'bg-white/10 border-white/10 text-slate-400 hover:text-white'
              }`}
              title={t.techSpecs}
            >
              <Info size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Main Viewport Area */}
      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden relative w-full z-10">
        {/* Canvas Center Area */}
        <div
          className="flex-1 min-h-0 min-w-0 w-full h-full relative flex items-center justify-center overflow-hidden p-2 sm:p-4 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {isVideoItem ? (
            /* Full Native Video Player Surface */
            <div
              className={`${
                isFullscreen
                  ? 'w-screen h-screen max-h-screen max-w-screen rounded-none'
                  : 'max-h-full max-w-full rounded-2xl'
              } w-full h-full min-h-0 min-w-0 flex flex-col items-center justify-center relative overflow-hidden bg-black shadow-2xl`}
              onClick={(e) => e.stopPropagation()}
            >
              <video
                key={lightboxImage.id || videoSrc}
                src={videoSrc}
                controls
                autoPlay
                playsInline
                preload="auto"
                className={`${
                  isFullscreen
                    ? 'max-h-screen max-w-screen w-screen h-screen rounded-none'
                    : 'max-h-full max-w-full w-auto h-auto rounded-2xl'
                } object-contain`}
              >
                Seu navegador não suporta reprodução deste vídeo.
              </video>
              <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-xl bg-black/80 backdrop-blur-md text-[10px] font-mono font-bold border shadow-lg pointer-events-none flex items-center gap-1.5 z-20 ${isGifItem ? 'text-amber-300 border-amber-500/40' : 'text-violet-300 border-violet-500/40'}`}>
                <Play size={12} className={isGifItem ? 'fill-amber-400 text-amber-400' : 'fill-violet-400'} />
                <span>{isGifItem ? t.badgeGif : t.badgeVideo} ({lightboxImage.width && lightboxImage.height ? `${lightboxImage.width}×${lightboxImage.height}` : 'HD'})</span>
              </div>
            </div>
          ) : (
            <div
              className="relative w-full h-full min-h-0 min-w-0 flex items-center justify-center transition-transform duration-75"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <img
                src={lightboxImage.originalUrl || lightboxImage.rawOriginalUrl || lightboxImage.thumbnailUrl}
                alt={lightboxImage.title}
                className={`${
                  isFullscreen
                    ? 'max-h-screen max-w-screen w-screen h-screen rounded-none'
                    : 'max-h-full max-w-full w-auto h-auto rounded-xl sm:rounded-2xl'
                } object-contain shadow-2xl pointer-events-none select-none`}
              />
              {isGifItem && (
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-xl bg-black/85 backdrop-blur-md text-[11px] font-mono text-amber-300 font-bold border border-amber-500/40 shadow-lg pointer-events-none flex items-center gap-2 z-20">
                  <Play size={12} className="fill-amber-400 text-amber-400" />
                  <span>GIF ANIMADO ({lightboxImage.width && lightboxImage.height ? `${lightboxImage.width}×${lightboxImage.height}` : 'HD'} • {formatFileSize(lightboxImage.fileSizeBytes)})</span>
                </div>
              )}
            </div>

          )}

          {/* Navigation Arrows */}
          <button
            onClick={handlePrev}
            className="absolute left-3 sm:left-4 p-2.5 sm:p-3 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/10 transition-all hover:scale-110 active:scale-95 shadow-xl"
            title="Anterior (Seta Esquerda)"
          >
            <ChevronLeft size={22} />
          </button>

          <button
            onClick={handleNext}
            className="absolute right-3 sm:right-4 p-2.5 sm:p-3 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/10 transition-all hover:scale-110 active:scale-95 shadow-xl"
            title="Próxima (Seta Direita)"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        {/* Right EXIF & Metadata Inspector Drawer */}
        {!isFullscreen && showInfoDrawer && (
          <aside className="absolute md:relative inset-y-0 right-0 z-30 w-full sm:w-80 border-l border-white/10 bg-surface-elevated/95 backdrop-blur-2xl p-4 overflow-y-auto space-y-5 text-xs text-slate-300 shadow-2xl touch-scroll">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Info size={14} className="text-brand-400" />
                {t.techSpecs}
              </h4>
              <button
                onClick={() => setShowInfoDrawer(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            {/* Clickable Source Link Card (New Feature!) */}
            {lightboxAlbum.sourceUrl && (
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ExternalLink size={14} className="text-brand-400" />
                  {t.albumSource || 'Origem do Álbum'}
                </h4>
                <a
                  href={lightboxAlbum.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-2xl bg-brand-600/10 border border-brand-500/30 hover:bg-brand-600/20 text-brand-300 hover:text-brand-200 transition-all group shadow-sm"
                  title={t.openSourceWeb || 'Abrir página web de origem em nova aba'}
                >
                  <div className="min-w-0 pr-2">
                    <span className="font-bold text-xs block truncate text-slate-100 group-hover:text-brand-300">
                      {lightboxAlbum.sourceDomain}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block truncate">
                      {lightboxAlbum.sourceUrl}
                    </span>
                  </div>
                  <ExternalLink size={14} className="shrink-0 text-brand-400 group-hover:translate-x-0.5 transition-transform" />
                </a>
              </div>
            )}

            {/* Technical Resolution Specs */}
            <div className="grid grid-cols-2 gap-2 bg-surface/60 p-3 rounded-2xl border border-white/5 font-mono text-[11px]">
              <div>
                <span className="text-slate-500 block">{t.resolution}</span>
                <span className="text-emerald-400 font-bold">{lightboxImage.width} × {lightboxImage.height}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Megapixels</span>
                <span className="text-slate-200 font-bold">{lightboxImage.megapixels} MP</span>
              </div>
              <div>
                <span className="text-slate-500 block">Proporção</span>
                <span className="text-slate-200">{lightboxImage.aspectRatio}</span>
              </div>
              <div>
                <span className="text-slate-500 block">{t.filesize}</span>
                <span className="text-slate-200 font-mono">{formatFileSize(lightboxImage.fileSizeBytes, 'Não informado')}</span>
              </div>
            </div>

            {/* Quality & Aesthetic Scores */}
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Star size={14} className="text-amber-400" />
                {t.aiQualityScore || 'Avaliação de Qualidade IA'}
              </h4>
              <div className="space-y-2 bg-surface/60 p-3 rounded-2xl border border-white/5">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-400">{t.aestheticScore || 'Score Estético:'}</span>
                  <span className="font-bold text-amber-400 font-mono">{lightboxImage.aestheticScore} / 10</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-400">{t.sharpness || 'Nitidez / Sharpness:'}</span>
                  <span className="font-bold text-emerald-400 font-mono">{lightboxImage.sharpnessScore}%</span>
                </div>
              </div>
            </div>

            {/* Dominant Color Palette - 8 Samplings (4 Internas / 4 Externas) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Palette size={13} className="text-brand-400" />
                  {t.dominantColors}
                  <span className="text-[10px] text-slate-400 font-normal lowercase font-mono">
                    (8 samplings)
                  </span>
                </h4>
                {copiedHex && (
                  <span className="text-[10px] text-emerald-400 font-medium animate-fade-in flex items-center gap-1">
                    <Check size={11} /> {t.copied || 'Copiado'}: {copiedHex}
                  </span>
                )}
              </div>

              {/* Sub-group 1: Internas / Centro (1 a 4) */}
              <div className="mb-2.5">
                <div className="text-[10px] font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span>{t.samplingInnerTitle || 'Centro / Internas (1 a 4)'}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {imagePalette.slice(0, 4).map((hex, idx) => {
                    const regionKey = `region${idx + 1}` as keyof typeof t;
                    const regionLabel = (t as any)[regionKey] || `${idx + 1}. Região`;
                    return (
                      <button
                        key={`${hex}-${idx}`}
                        type="button"
                        onClick={() => handleCopyHex(hex)}
                        className="h-9 rounded-xl border border-white/10 relative group transition-transform hover:scale-105 active:scale-95 shadow-sm overflow-hidden cursor-pointer"
                        style={{ backgroundColor: hex }}
                        title={`${regionLabel}: ${hex} (${t.copyHex || 'Copiar Hex'})`}
                      >
                        <span className="absolute top-1 left-1.5 text-[9px] font-bold font-mono px-1 py-0.2 rounded bg-black/60 text-white/90">
                          {idx + 1}
                        </span>
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 text-[9px] font-mono text-white rounded-xl transition-opacity">
                          {copiedHex === hex ? <Check size={12} className="text-emerald-400" /> : <Copy size={11} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sub-group 2: Externas / Periferia (5 a 8) */}
              <div>
                <div className="text-[10px] font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span>{t.samplingOuterTitle || 'Periferia / Externas (5 a 8)'}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {imagePalette.slice(4, 8).map((hex, idx) => {
                    const actualIdx = idx + 4;
                    const regionKey = `region${actualIdx + 1}` as keyof typeof t;
                    const regionLabel = (t as any)[regionKey] || `${actualIdx + 1}. Região`;
                    return (
                      <button
                        key={`${hex}-${actualIdx}`}
                        type="button"
                        onClick={() => handleCopyHex(hex)}
                        className="h-9 rounded-xl border border-white/10 relative group transition-transform hover:scale-105 active:scale-95 shadow-sm overflow-hidden cursor-pointer"
                        style={{ backgroundColor: hex }}
                        title={`${regionLabel}: ${hex} (${t.copyHex || 'Copiar Hex'})`}
                      >
                        <span className="absolute top-1 left-1.5 text-[9px] font-bold font-mono px-1 py-0.2 rounded bg-black/60 text-white/90">
                          {actualIdx + 1}
                        </span>
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 text-[9px] font-mono text-white rounded-xl transition-opacity">
                          {copiedHex === hex ? <Check size={12} className="text-emerald-400" /> : <Copy size={11} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Geolocation GPS */}
            {lightboxImage.gps && (
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MapPin size={14} className="text-rose-400" />
                  Localização GPS
                </h4>
                <div className="bg-surface/60 p-3 rounded-2xl border border-white/5 text-[11px]">
                  <div className="font-semibold text-slate-100">{lightboxImage.gps.locationName}</div>
                  <div className="text-slate-400 font-mono text-[10px] mt-0.5">
                    {lightboxImage.gps.latitude.toFixed(4)}, {lightboxImage.gps.longitude.toFixed(4)}
                  </div>
                </div>
              </div>
            )}

            {/* In-Image OCR Text */}
            {lightboxImage.inImageText && (
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <FileText size={14} className="text-brand-400" />
                  Texto Detectado (OCR)
                </h4>
                <div className="bg-surface/60 p-3 rounded-2xl border border-white/5 text-[11px] font-mono text-slate-300">
                  "{lightboxImage.inImageText}"
                </div>
              </div>
            )}


          </aside>
        )}
      </div>

      {/* Bottom Filmstrip Carousel with Side Navigation Arrows */}
      {!isFullscreen && (
        <div className="h-16 sm:h-20 border-t border-white/10 px-2 sm:px-4 flex items-center gap-1.5 sm:gap-2 bg-black/80 backdrop-blur-xl z-20 pb-safe relative select-none">
          {/* Scroll Left Button */}
          <button
            onClick={() => scrollFilmstrip('left')}
            className="h-10 w-7 sm:w-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all shrink-0 active:scale-95 z-10"
            title="Rolar miniaturas para esquerda"
          >
            <ChevronLeft size={18} />
          </button>

          {/* Scrollable Track */}
          <div
            ref={filmstripRef}
            onWheel={handleFilmstripWheel}
            onMouseDown={handleFilmstripMouseDown}
            onMouseMove={handleFilmstripMouseMove}
            onMouseUp={handleFilmstripMouseUp}
            onMouseLeave={handleFilmstripMouseUp}
            className={`flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar touch-scroll py-2 ${
              isFilmstripDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            {(lightboxAlbum.images || []).map((img, idx) => {
              const isActive = img.id === lightboxImage.id;
              return (
                <button
                  key={img.id}
                  ref={isActive ? activeThumbRef : null}
                  onClick={() => openLightbox(img, lightboxAlbum)}
                  className={`relative flex-shrink-0 h-11 w-11 sm:h-14 sm:w-14 rounded-xl overflow-hidden border transition-all duration-200 ${
                    isActive
                      ? 'border-brand-400 scale-105 shadow-glow-brand ring-2 ring-brand-500/50 opacity-100 z-10'
                      : 'border-white/10 opacity-50 hover:opacity-90 hover:border-white/30'
                  }`}
                  title={`Foto #${idx + 1} - ${img.title || 'Sem título'}`}
                >
                  <img
                    src={img.thumbnailUrl}
                    alt={img.title}
                    className="w-full h-full object-cover pointer-events-none"
                    onError={(e) => {
                      if (img.rawThumbnailUrl && e.currentTarget.src !== img.rawThumbnailUrl) {
                        e.currentTarget.src = img.rawThumbnailUrl;
                      }
                    }}
                  />
                  <span className="absolute bottom-0.5 right-1 text-[8px] font-mono font-bold text-white/90 bg-black/70 px-1 rounded">
                    {idx + 1}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Scroll Right Button */}
          <button
            onClick={() => scrollFilmstrip('right')}
            className="h-10 w-7 sm:w-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all shrink-0 active:scale-95 z-10"
            title="Rolar miniaturas para direita"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
};
