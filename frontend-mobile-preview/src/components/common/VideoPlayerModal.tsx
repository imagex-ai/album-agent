import React, { useState, useEffect, useRef, useMemo } from 'react';
import Hls from 'hls.js';
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Download,
  Star,
  RotateCcw,
  RotateCw,
  Sliders,
  PictureInPicture2,
  Folder,
  Calendar,
  HardDrive,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Zap
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { formatFileSize } from '../../utils/formatters';
import { translations } from '../../i18n/translations';
import { IconBadge } from './IconBadge';
import {
  getVideoPlayerAnimationClass,
  getSpeedClass,
  getDistanceClass
} from '../../services/motionConfig';
import { isDesktopApp, toggleAppFullscreen, exitAllFullscreen } from '../../services/desktopService';

export const VideoPlayerModal: React.FC = () => {
  const {
    activePlayingVideo,
    setActivePlayingVideo,
    toggleVideoFavorite,
    deleteVideo,
    activeAlbumId,
    refreshAlbumStreams,
    addNotification,
    settings
  } = useAppStore();
  const isEn = settings?.language === 'en-US';

  const t = translations[settings.language]?.videoPlayer || translations['en-US'].videoPlayer;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [showControls, setShowControls] = useState<boolean>(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [useProxy, setUseProxy] = useState<boolean>(false);
  const [isRenewingStream, setIsRenewingStream] = useState<boolean>(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activePlayingVideo) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        exitAllFullscreen(setIsFullscreen);
        setActivePlayingVideo(null);
      } else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSeekRelative(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSeekRelative(5);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleVolumeChange(Math.min(1, volume + 0.1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleVolumeChange(Math.max(0, volume - 0.1));
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMute();
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setFitMode(m => (m === 'contain' ? 'cover' : 'contain'));
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'F11') {
        e.preventDefault();
        handleToggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePlayingVideo, isPlaying, volume, isMuted, isFullscreen]);

  useEffect(() => {
    setUseProxy(false);
  }, [activePlayingVideo?.id]);

  const effectiveStreamUrl = useMemo(() => {
    if (!activePlayingVideo) return '';
    let raw = activePlayingVideo.streamUrl || '';
    const wasAlreadyProxied = raw.includes('/api/proxy-video-stream');
    let extractedReferer = activePlayingVideo.sourceUrl;

    let unwrapCount = 0;
    while (raw.includes('/api/proxy-video-stream') && raw.includes('url=') && unwrapCount < 5) {
      unwrapCount++;
      const mRef = raw.match(/[?&]referer=([^&]+)/);
      if (mRef && !extractedReferer) extractedReferer = decodeURIComponent(mRef[1]);
      const m = raw.match(/[?&]url=([^&]+)/);
      if (m) raw = decodeURIComponent(m[1]);
      else break;
    }
    if (raw.startsWith('/api/')) return raw;

    const isRestrictedCdn = wasAlreadyProxied || raw.startsWith('http');
    if (useProxy || isRestrictedCdn) {
      let defaultRef = '';
      try {
        defaultRef = new URL(raw).origin;
      } catch {
        defaultRef = '';
      }
      const ref = extractedReferer || defaultRef;
      const refParam = ref ? `&referer=${encodeURIComponent(ref)}` : '';
      return `/api/proxy-video-stream?url=${encodeURIComponent(raw)}${refParam}`;
    }
    return raw;
  }, [activePlayingVideo, useProxy]);

  const effectiveDownloadUrl = useMemo(() => {
    if (!activePlayingVideo) return '';
    let raw = activePlayingVideo.downloadUrl || activePlayingVideo.streamUrl || '';
    if (raw.includes('/api/proxy-video-stream') && raw.includes('download=true')) return raw;
    let extractedReferer = activePlayingVideo.sourceUrl;

    let unwrapCount = 0;
    while (raw.includes('/api/proxy-video-stream') && raw.includes('url=') && unwrapCount < 5) {
      unwrapCount++;
      const mRef = raw.match(/[?&]referer=([^&]+)/);
      if (mRef && !extractedReferer) extractedReferer = decodeURIComponent(mRef[1]);
      const m = raw.match(/[?&]url=([^&]+)/);
      if (m) raw = decodeURIComponent(m[1]);
      else break;
    }

    const isRestrictedCdn = raw.startsWith('http');
    if (isRestrictedCdn) {
      let targetStream = raw;
      let defaultRef = '';
      try {
        defaultRef = new URL(activePlayingVideo.sourceUrl || targetStream).origin;
      } catch {
        defaultRef = '';
      }
      const ref = extractedReferer || defaultRef;
      const refParam = ref ? `&referer=${encodeURIComponent(ref)}` : '';
      const fname = activePlayingVideo.filename || `${activePlayingVideo.title || 'video'}.mp4`;
      return `/api/proxy-video-stream?url=${encodeURIComponent(targetStream)}${refParam}&download=true&filename=${encodeURIComponent(fname)}`;
    }
    return activePlayingVideo.downloadUrl || activePlayingVideo.streamUrl;
  }, [activePlayingVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !effectiveStreamUrl) return;

    setVideoError(null);
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setShowControls(true);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = effectiveStreamUrl.includes('.m3u8') || effectiveStreamUrl.includes('/hls/');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        }
      });
      hls.loadSource(effectiveStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Autoplay was prevented by browser policy (user gesture required):", err);
            setIsPlaying(false);
          });
        }
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          console.error("Fatal Hls.js error:", data);
          setIsLoading(false);
          setVideoError(t.hlsError || "Could not load HLS stream. Try playing via secure proxy.");
        }
      });
      hlsRef.current = hls;
    } else {
      video.src = effectiveStreamUrl;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("Autoplay was prevented by browser policy (user gesture required):", err);
          setIsPlaying(false);
          setIsLoading(false);
        });
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [effectiveStreamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleWebkitBegin = () => setIsFullscreen(true);
    const handleWebkitEnd = () => setIsFullscreen(false);

    video.addEventListener('webkitbeginfullscreen', handleWebkitBegin);
    video.addEventListener('webkitendfullscreen', handleWebkitEnd);

    const handleFullscreenChange = () => {
      const isFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(isFs);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      video.removeEventListener('webkitbeginfullscreen', handleWebkitBegin);
      video.removeEventListener('webkitendfullscreen', handleWebkitEnd);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      exitAllFullscreen();
    };
  }, [activePlayingVideo]);

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(err => {
        console.warn("Playback error:", err);
      });
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };


  const handleSeekRelative = (seconds: number) => {
    if (!videoRef.current) return;
    const target = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const handleSeekScrubber = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = target;
      setCurrentTime(target);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    if (!videoRef.current) return;
    videoRef.current.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleSpeedChange = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
      setShowSpeedMenu(false);
    }
  };

  const handleToggleFullscreen = async () => {
    await toggleAppFullscreen(isFullscreen, setIsFullscreen);
  };

  const handleTogglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
  };

  const HIDE_TIMEOUT_MS = 2500;

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying && !videoRef.current?.paused) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isPlaying && !videoRef.current?.paused) setShowControls(false);
      }, HIDE_TIMEOUT_MS);
    }
  };

  useEffect(() => {
    if (!isFullscreen) return;
    const handleActivity = () => handleMouseMove();
    window.addEventListener('mousemove', handleActivity, { passive: true });
    window.addEventListener('pointermove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });
    window.addEventListener('wheel', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('pointermove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('wheel', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
    };
  }, [isFullscreen, isPlaying]);

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) {
      const remMins = mins % 60;
      return `${hrs}:${remMins < 10 ? '0' : ''}${remMins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const highlights = useMemo(() => {
    if (!activePlayingVideo) return [];
    if (activePlayingVideo.highlights && activePlayingVideo.highlights.length > 0) {
      return activePlayingVideo.highlights;
    }
    if (typeof activePlayingVideo.highlightStart === 'number' && activePlayingVideo.highlightStart > 0) {
      return [{
        rank: 1,
        label: 'Clímax #1',
        start: activePlayingVideo.highlightStart,
        end: activePlayingVideo.highlightEnd || (activePlayingVideo.highlightStart + 30),
        score: activePlayingVideo.highlightScore || 85,
        duration: (activePlayingVideo.highlightEnd || (activePlayingVideo.highlightStart + 30)) - activePlayingVideo.highlightStart
      }];
    }
    return [];
  }, [activePlayingVideo]);

  const primaryHighlightStart = useMemo(() => {
    if (highlights.length > 0) return highlights[0].start;
    if (typeof activePlayingVideo?.highlightStart === 'number') return activePlayingVideo.highlightStart;
    return null;
  }, [highlights, activePlayingVideo]);

  const handleJumpToHighlight = (startSec?: number) => {
    const target = typeof startSec === 'number' ? startSec : primaryHighlightStart;
    if (target !== null && target !== undefined && videoRef.current) {
      videoRef.current.currentTime = target;
      setCurrentTime(target);
      if (!isPlaying) {
        videoRef.current.play().catch(console.error);
        setIsPlaying(true);
      }
    }
  };

  const handleRenewStream = async () => {
    if (!activePlayingVideo || isRenewingStream) return;
    setIsRenewingStream(true);
    try {
      let renewed = false;
      const allAlbums = useAppStore.getState().albums;
      const albumId = activeAlbumId || allAlbums.find(a =>
        a.images?.some(i => i.id === activePlayingVideo.id || i.videoUrl === activePlayingVideo.streamUrl || i.title === activePlayingVideo.title) ||
        (activePlayingVideo.sourceUrl && a.sourceUrl === activePlayingVideo.sourceUrl)
      )?.id;

      if (albumId) {
        renewed = await refreshAlbumStreams(albumId);
        if (renewed) {
          const freshAlbum = useAppStore.getState().albums.find(a => a.id === albumId);
          const freshImg = freshAlbum?.images?.find(i =>
            i.id === activePlayingVideo.id ||
            (activePlayingVideo.title && i.title?.toLowerCase() === activePlayingVideo.title.toLowerCase()) ||
            (i.candidateId && (activePlayingVideo as any).candidateId === i.candidateId)
          ) || (freshAlbum?.images?.length === 1 ? freshAlbum.images[0] : undefined);
          if (freshImg) {
            let targetRaw = freshImg.rawOriginalUrl || freshImg.originalUrl || freshImg.videoUrl || '';
            let unwrapCount = 0;
            while (targetRaw.includes('/api/proxy-video-stream') && targetRaw.includes('url=') && unwrapCount < 5) {
              unwrapCount++;
              const m = targetRaw.match(/[?&]url=([^&]+)/);
              if (m) {
                targetRaw = decodeURIComponent(m[1]);
              } else {
                break;
              }
            }
            let vRef = (freshImg as any).sourcePage || freshAlbum?.sourceUrl;
            if (!vRef && activePlayingVideo.streamUrl) {
              const mRef = activePlayingVideo.streamUrl.match(/[?&]referer=([^&]+)/);
              if (mRef) vRef = decodeURIComponent(mRef[1]);
            }
            let defaultRef = '';
            try {
              defaultRef = new URL(vRef || targetRaw).origin;
            } catch {
              defaultRef = '';
            }
            const finalRef = vRef || defaultRef;
            const refParam = finalRef ? `&referer=${encodeURIComponent(finalRef)}` : '';
            const newStreamUrl = `/api/proxy-video-stream?url=${encodeURIComponent(targetRaw)}${refParam}`;

            setActivePlayingVideo({
              ...activePlayingVideo,
              streamUrl: newStreamUrl,
              fileSizeBytes: freshImg.fileSizeBytes || activePlayingVideo.fileSizeBytes
            });
            setVideoError(null);
            setIsLoading(true);
          }
          addNotification({
            title: 'Stream Renovado',
            message: t.streamRenewSuccess || "Video playback link renewed successfully.",
            type: 'success'
          });
        }
      }
      if (!renewed) {
        setUseProxy(true);
        if (videoRef.current) {
          videoRef.current.load();
        }
      }
      setVideoError(null);
      setIsLoading(true);
    } catch (err) {
      console.warn("Error renewing stream in modal:", err);
      addNotification({
        title: t.streamRenewErrorTitle || "Renewal Error",
        message: t.streamRenewErrorMsg || "Could not renew stream.",
        type: 'error'
      });
    } finally {
      setIsRenewingStream(false);
    }
  };

  if (!activePlayingVideo) return null;

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center ${
        isFullscreen ? 'p-0' : 'p-2 sm:p-4 md:p-6'
      } select-none animate-fade-in`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isFullscreen) setActivePlayingVideo(null);
      }}
    >
      {/* Permanent Emergency Exit Button (only in windowed mode) */}
      {!isFullscreen && (
        <button
          type="button"
          onClick={() => setActivePlayingVideo(null)}
          className="fixed top-3 right-3 sm:top-5 sm:right-5 z-[9999] p-2.5 sm:p-3 rounded-full bg-black/80 hover:bg-rose-600 text-white border border-white/20 backdrop-blur-md shadow-2xl transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center"
          title={t.close || "Close Video (Esc)"}
          aria-label={t.closeAria || "Close Video Player"}
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      )}

      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => isPlaying && setShowControls(false)}
        className={`relative bg-black overflow-hidden flex flex-col justify-between ${getVideoPlayerAnimationClass(settings.videoPlayerAnimation || 'zoom', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')} transition-all duration-300 ease-out ${
          isFullscreen
            ? 'fixed inset-0 z-[9999] w-full h-full max-w-none max-h-none rounded-none aspect-auto border-0 shadow-none'
            : 'w-full max-w-5xl h-[85vh] sm:h-[80vh] rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-700 ring-1 ring-white/10'
        } ${isFullscreen && !showControls ? 'fullscreen-cursor-hidden cursor-none' : 'cursor-default'}`}
      >
        {/* Top Header Bar */}
        <div
          className={`absolute top-0 left-0 right-0 z-30 p-3 sm:p-4 bg-gradient-to-b from-black/90 via-black/50 to-transparent flex items-center justify-between transition-all duration-500 ease-out ${
            (showControls || !isPlaying || !!videoError) ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-12 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 shrink-0">
              <Folder size={14} />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate max-w-[200px] sm:max-w-md">
                {activePlayingVideo.title}
              </h3>
              <p className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                <span>{(t.folderLabel || 'Pasta: {folder}').replace('{folder}', activePlayingVideo.folder || '')}</span>
                <span>•</span>
                <span>{formatFileSize(activePlayingVideo.fileSizeBytes)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Direct Open in New Tab Button */}
            <a
              href={effectiveStreamUrl || activePlayingVideo.streamUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1.5 rounded-xl bg-cyan-950/80 hover:bg-cyan-800/80 text-cyan-300 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 transition-colors"
              title={t.openNewTab || "Open Video in New Tab (Native Player)"}
            >
              <ExternalLink size={14} />
              <span className="hidden sm:inline">{isEn ? "New Tab" : "Nova Aba"}</span>
            </a>

            {/* Favorite Button */}
            <button
              onClick={() => toggleVideoFavorite(activePlayingVideo.id)}
              className={`p-2 rounded-xl border transition-all ${
                activePlayingVideo.isFavorite
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-glow-amber'
                  : 'bg-black/50 hover:bg-white/10 text-slate-300 border-white/10'
              }`}
              title={activePlayingVideo.isFavorite ? (t.removeFavorite || "Remove from Favorites") : (t.addFavorite || "Favorite Video")}
            >
              <Star size={16} className={activePlayingVideo.isFavorite ? 'fill-amber-400' : ''} />
            </button>

            {/* Direct Download Button */}
            <a
              href={effectiveDownloadUrl || activePlayingVideo.downloadUrl}
              download={activePlayingVideo.filename}
              className="p-2 rounded-xl bg-black/50 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors"
              title={t.download || "Download Video to Computer"}
            >
              <Download size={16} />
            </a>

            {/* Delete Button */}
            <button
              onClick={() => setIsConfirmingDelete(true)}
              className="p-2 rounded-xl bg-black/50 hover:bg-rose-900/70 text-slate-300 hover:text-rose-300 border border-white/10 transition-colors"
              title={t.delete || "Delete Video from Disk"}
            >
              <Trash2 size={16} />
            </button>

            {/* Close Button */}
            <button
              onClick={() => setActivePlayingVideo(null)}
              className="p-2 rounded-xl bg-black/50 hover:bg-white/20 text-slate-300 hover:text-white border border-white/10 transition-colors"
              title={t.close || "Close (Esc)"}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Video Surface */}
        <div
          className="flex-1 w-full h-full min-h-[300px] relative flex items-center justify-center cursor-pointer bg-black"
          onClick={handleTogglePlay}
        >
          <video
            ref={videoRef}
            key={effectiveStreamUrl}
            playsInline
            {...({ 'webkit-playsinline': 'true', 'x5-playsinline': 'true' } as any)}
            preload="auto"
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePlay();
            }}
            onPlay={() => {
              setIsPlaying(true);
              setIsLoading(false);
            }}
            onPause={() => setIsPlaying(false)}
            onWaiting={() => setIsLoading(true)}
            onPlaying={() => setIsLoading(false)}
            onTimeUpdate={() => {
              if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
            }}
            onLoadedMetadata={() => {
              setIsLoading(false);
              setVideoError(null);
              if (videoRef.current) {
                setDuration(videoRef.current.duration);
                setIsPlaying(!videoRef.current.paused);
              }
            }}
            onCanPlay={() => {
              setIsLoading(false);
            }}
            onError={(e) => {
              console.error('Video player error event:', e);
              setIsLoading(false);
              setVideoError(t.cannotPlayVideo || "Could not play this video directly in the web player.");
              setShowControls(true);
            }}
            onEnded={() => setIsPlaying(false)}
            className={`w-full h-full border-0 shadow-none transition-all duration-300 ease-out ${
              isFullscreen
                ? (fitMode === 'cover' ? 'max-h-none object-cover rounded-none' : 'max-h-none object-contain rounded-none')
                : 'max-h-[80vh] object-contain rounded-2xl'
            } ${isFullscreen && !showControls ? 'cursor-none' : 'cursor-pointer'}`}
          >
            {t.browserUnsupported || (isEn ? 'Your browser does not support playing this video.' : 'Seu navegador não suporta reprodução deste vídeo.')}
          </video>

          {/* Loading Spinner */}
          {isLoading && !videoError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none gap-2.5 z-10">
              <Loader2 size={36} className="text-brand-400 animate-spin" />
              <span className="text-xs text-slate-300 font-medium">{t.loadingVideo || "Loading video..."}</span>
            </div>
          )}

          {/* Central Play Overlay Button */}
          {!isPlaying && !videoError && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/20 transition-colors cursor-pointer z-10"
              onClick={(e) => {
                e.stopPropagation();
                handleTogglePlay();
              }}
            >
              <div className="p-4 sm:p-5 rounded-full bg-brand-600/90 text-white shadow-glow-brand scale-110 sm:scale-125 transition-transform hover:scale-125 active:scale-95 shadow-2xl">
                <Play size={28} className="translate-x-0.5" />
              </div>
            </div>
          )}

          {/* Error Fallback Banner */}
          {videoError && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-slate-950/95 text-center cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/30 mb-3 shadow-glow-amber">
                <AlertTriangle size={36} />
              </div>
              <h4 className="text-base sm:text-lg font-bold text-white mb-1.5">
                {t.cannotPlayVideo || "Could not play this video"}
              </h4>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
                {videoError} {isEn ? 'The file may be encoded in an advanced format or awaiting network sync.' : 'O arquivo pode estar codificado em formato avançado ou aguardando sincronização de rede.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleRenewStream}
                  disabled={isRenewingStream}
                  className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
                  title={t.renewStream || 'Renovar link expirado via yt-dlp'}
                >
                  <RefreshCw size={16} className={isRenewingStream ? 'animate-spin' : ''} />
                  <span>{isRenewingStream ? (t.renewingStream || 'Renovando...') : (t.renewBtn || 'Renovar Stream')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVideoError(null);
                    setIsLoading(true);
                    setUseProxy(true);
                    if (videoRef.current) {
                      videoRef.current.load();
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 border border-white/10 transition-all cursor-pointer"
                >
                  <RotateCcw size={16} />
                  <span>Recarregar</span>
                </button>
                <a
                  href={effectiveStreamUrl || activePlayingVideo.streamUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 shadow-lg transition-all"
                >
                  <ExternalLink size={16} />
                  {t.openInNewTab || "Open in New Tab"}
                </a>
                <a
                  href={effectiveDownloadUrl || activePlayingVideo.downloadUrl}
                  download={activePlayingVideo.filename}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 border border-white/10 transition-all"
                >
                  <Download size={16} />
                  {t.downloadVideo || "Download File"}
                </a>
                <button
                  type="button"
                  onClick={() => setActivePlayingVideo(null)}
                  className="px-4 py-2.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer"
                >
                  <X size={16} />
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Custom Controls Bar */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-30 p-3 sm:p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col gap-2 transition-opacity duration-300 ${
            (showControls || !isPlaying) && !videoError ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Scrubber Progress Bar */}
          <div className="flex items-center gap-2 group/scrub relative">
            <div className="relative w-full flex items-center">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeekScrubber}
                className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-brand-500 hover:h-2.5 transition-all z-10"
              />
              {/* Highlight Notches / Markers */}
              {duration > 0 && highlights.map((hl, idx) => {
                const leftPercent = Math.min(100, Math.max(0, (hl.start / duration) * 100));
                const widthPercent = Math.min(100 - leftPercent, Math.max(0.6, ((hl.end - hl.start) / duration) * 100));
                const colorClass = idx === 0 
                  ? 'bg-amber-400 border-amber-300 shadow-glow-amber' 
                  : idx === 1 
                  ? 'bg-orange-400 border-orange-300' 
                  : 'bg-cyan-400 border-cyan-300';
                return (
                  <div
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleJumpToHighlight(hl.start);
                    }}
                    style={{ left: `${leftPercent}%`, width: `${Math.max(1.2, widthPercent)}%` }}
                    className={`absolute h-2.5 top-1/2 -translate-y-1/2 rounded-full pointer-events-auto cursor-pointer border opacity-80 hover:opacity-100 hover:scale-y-125 transition-all z-20 ${colorClass}`}
                    title={`${hl.label || `Destaque #${idx + 1}`} (${formatTime(hl.start)})`}
                  />
                );
              })}
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between text-white text-xs">
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Play/Pause */}
              <button
                onClick={handleTogglePlay}
                className="p-1.5 sm:p-2 rounded-xl hover:bg-white/10 text-white transition-colors"
                title={isPlaying ? (t.pauseSpace || "Pause (Space)") : (t.playSpace || "Play (Space)")}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>

              {/* Skip Back 5s */}
              <button
                onClick={() => handleSeekRelative(-5)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                title={t.rewind5s || 'Voltar 5s (Seta Esquerda)'}
              >
                <RotateCcw size={15} />
              </button>

              {/* Skip Forward 5s */}
              <button
                onClick={() => handleSeekRelative(5)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                title={t.forward5s || "Forward 5s (Right Arrow)"}
              >
                <RotateCw size={15} />
              </button>

              {/* Jump to Highlight / Climax Button */}
              {primaryHighlightStart !== null && (
                <button
                  type="button"
                  onClick={() => handleJumpToHighlight()}
                  className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold flex items-center gap-1 transition-all shadow-sm active:scale-95 cursor-pointer ml-0.5"
                  title={isEn ? `Jump to Best Moment (${formatTime(primaryHighlightStart)})` : `Pular para o Melhor Momento (${formatTime(primaryHighlightStart)})`}
                >
                  <Zap size={13} className="fill-amber-400 text-amber-400 animate-pulse shrink-0" />
                  <span className="hidden sm:inline">Clímax</span>
                  <span className="text-[10px] text-amber-400/80 font-mono">({formatTime(primaryHighlightStart)})</span>
                </button>
              )}

              {/* Volume & Mute */}
              <div className="flex items-center gap-1.5 group/volume">
                <button
                  onClick={handleToggleMute}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                  title={isMuted ? (t.unmute || 'Desmutar (M)') : (t.mute || 'Mutar (M)')}
                >
                  {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-14 sm:w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-brand-400 opacity-80 group-hover/volume:opacity-100 transition-opacity"
                  title={t.volume || 'Volume'}
                />
              </div>

              {/* Time Display */}
              <span className="font-mono text-[11px] text-slate-300 ml-1">
                {formatTime(currentTime)} <span className="text-slate-500">/</span> {formatTime(duration)}
              </span>
            </div>

            {/* Right Tools: Speed, PiP, Fullscreen */}
            <div className="flex items-center gap-1.5 sm:gap-2 relative">
              {/* Playback Speed Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-mono font-bold text-slate-200 transition-colors"
                  title={t.playbackSpeed || "Playback Speed"}
                >
                  {playbackRate}x
                </button>
                {showSpeedMenu && (
                  <div className="absolute bottom-8 right-0 bg-slate-900 border border-border rounded-xl shadow-2xl p-1 flex flex-col gap-0.5 z-40 min-w-[70px]">
                    {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => handleSpeedChange(rate)}
                        className={`px-2.5 py-1 text-left text-[11px] font-mono rounded-lg transition-colors ${
                          playbackRate === rate ? 'bg-brand-600 text-white font-bold' : 'text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Picture in Picture */}
              <button
                onClick={handleTogglePiP}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors hidden sm:block"
                title={t.pip || 'Picture-in-Picture'}
              >
                <PictureInPicture2 size={16} />
              </button>

              {/* Fit / Fill Toggle */}
              <button
                onClick={() => setFitMode(m => m === 'contain' ? 'cover' : 'contain')}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  fitMode === 'cover'
                    ? 'bg-brand-500/30 text-brand-300 ring-1 ring-brand-400/50'
                    : 'hover:bg-white/10 text-slate-300 hover:text-white'
                }`}
                title={fitMode === 'cover' ? "Fit Video to Screen (P)" : "Fill Video on Screen (P)"}
              >
                {fitMode === 'cover' ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>

              {/* Fullscreen */}
              <button
                onClick={handleToggleFullscreen}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title={isFullscreen ? (t.exitFullscreen || "Exit Fullscreen (F)") : (t.fullscreen || "Fullscreen (F)")}
              >
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Delete Confirmation In-Modal Dialog */}
        {isConfirmingDelete && (
          <div
            className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-scale-up">
              <IconBadge variant="rose" size="lg" icon={<Trash2 size={24} />} className="mx-auto" />
              <div>
                <h4 className="font-bold text-base text-white">{t.confirmDeleteTitle || "Delete Video?"}</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {(t.confirmDeleteDesc || (isEn ? 'Do you want to move video "{title}" to trash?' : 'Deseja mover o vídeo "{title}" para a lixeira?')).replace('{title}', activePlayingVideo.title || '')}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {translations[settings.language]?.videos?.cancel || 'Cancelar'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await deleteVideo(activePlayingVideo.id);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.delete || (isEn ? 'Delete Video' : 'Excluir Vídeo')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
