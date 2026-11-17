import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  X,
  Download,
  Star,
  Folder,
  Trash2,
  ExternalLink,
  Loader2,
  Check,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useMiniPlayerStore } from '../../store/useMiniPlayerStore';
import { usePersistentPlayerStore } from '../../store/usePersistentPlayerStore';
import { formatFileSize } from '../../utils/formatters';
import { translations } from '../../i18n/translations';
import { VideoQualityOption } from '../../types';
import { IconBadge } from './IconBadge';
import {
  getVideoPlayerAnimationClass,
  getSpeedClass,
  getSpeedMs,
  getDistanceClass,
} from '../../services/motionConfig';
import { exitAllFullscreen } from '../../services/desktopService';
import { backendApi } from '../../services/realApi';
import {
  UniversalVideoPlayer,
  UniversalVideoPlayerHandle,
} from '../video-player/ui/UniversalVideoPlayer';
import {
  PlaybackHandoffSnapshot,
  StreamQualityCandidate,
  UniversalVideoSource,
} from '../video-player/engine/videoPlayerCore';
import { normalizePlayerHighlights } from '../video-player/engine/playerHighlights';
import { registerPlayerOverlayLayer } from '../video-player/engine/playerOverlayStack';
import { isReducedMotionPreferred } from '../video-player/engine/playerMotion';
import { createVideoModalCloseCoordinator } from './videoModalClose';

export const VideoPlayerModal: React.FC = () => {
  const {
    activePlayingVideo,
    setActivePlayingVideo,
    toggleVideoFavorite,
    deleteVideo,
    activeAlbumId,
    refreshAlbumStreams,
    addNotification,
    settings,
  } = useAppStore();
  const isEn = settings?.language === 'en-US';

  const t = translations[settings.language]?.videoPlayer || translations['en-US'].videoPlayer;
  const playerT = translations[settings.language || 'en-US']?.player || translations['en-US'].player;

  const uvpRef = useRef<UniversalVideoPlayerHandle | null>(null);
  const hostMounted = usePersistentPlayerStore((s) => s.hostMounted);
  const [modalSlotEl, setModalSlotEl] = useState<HTMLDivElement | null>(null);
  const latestSnapshotRef = useRef<PlaybackHandoffSnapshot | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeGuardRef = useRef<(() => void) | null>(null);
  const closeCoordinatorRef = useRef<ReturnType<typeof createVideoModalCloseCoordinator<NonNullable<typeof activePlayingVideo>>> | null>(null);
  if (!closeCoordinatorRef.current) {
    closeCoordinatorRef.current = createVideoModalCloseCoordinator({
      getCurrent: () => useAppStore.getState().activePlayingVideo,
      clearCurrent: () => useAppStore.getState().setActivePlayingVideo(null),
      pause: () => (uvpRef.current || usePersistentPlayerStore.getState().playerHandle)?.pause(),
      exitFullscreen: exitAllFullscreen,
      onSettled: () => {
        closeGuardRef.current?.();
        closeGuardRef.current = null;
      },
    });
  }
  const handleModalClose = useCallback(() => {
    const video = useAppStore.getState().activePlayingVideo;
    if (!video) return;
    if (!closeGuardRef.current) {
      const guardEscape = () => {
        closeGuardRef.current = registerPlayerOverlayLayer({
          id: 'video-player-modal-closing',
          priority: 10,
          onDismiss: guardEscape,
        });
      };
      guardEscape();
    }
    const motion = useAppStore.getState().settings;
    closeCoordinatorRef.current?.close(video, backdropRef.current, panelRef.current,
      getSpeedMs(motion.animationSpeed), Boolean(motion.disableAllAnimations) || motion.videoPlayerAnimation === 'none' || isReducedMotionPreferred());
  }, []);

  useEffect(() => () => closeCoordinatorRef.current?.cancel(), [activePlayingVideo]);
  useEffect(() => {
    if (settings.disableAllAnimations || settings.videoPlayerAnimation === 'none') closeCoordinatorRef.current?.finishNow();
  }, [settings.disableAllAnimations, settings.videoPlayerAnimation]);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { if (query.matches) closeCoordinatorRef.current?.finishNow(); };
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'completed'>('idle');
  const downloadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false);
  const [customStreamUrl, setCustomStreamUrl] = useState<string | null>(null);
  const [availableQualities, setAvailableQualities] = useState<VideoQualityOption[]>([]);
  const [effectiveQuality, setEffectiveQuality] = useState<number | null>(null);
  const [useProxy, setUseProxy] = useState<boolean>(false);

  useEffect(() => {
    return () => {
      if (downloadTimerRef.current) clearTimeout(downloadTimerRef.current);
      exitAllFullscreen();
    };
  }, []);

  useEffect(() => {
    setUseProxy(false);
    setCustomStreamUrl(null);
    setAvailableQualities(activePlayingVideo?.qualities || []);
    setEffectiveQuality(
      activePlayingVideo?.qualities && activePlayingVideo.qualities.length > 0
        ? activePlayingVideo.qualities[0].height
        : null
    );
    setIsConfirmingDelete(false);
    latestSnapshotRef.current = null;
  }, [activePlayingVideo?.id]);

  // Register delete confirmation dialog at priority 15 and modal at priority 10
  // so inner player sheets (priority 20) and shortcuts dialog (priority 30) dismiss first on Escape!
  useEffect(() => {
    if (!activePlayingVideo || !isConfirmingDelete) return;
    return registerPlayerOverlayLayer({
      id: 'video-player-modal-delete-confirm',
      priority: 15,
      onDismiss: () => setIsConfirmingDelete(false),
    });
  }, [activePlayingVideo, isConfirmingDelete]);

  useEffect(() => {
    if (!activePlayingVideo) return;
    return registerPlayerOverlayLayer({
      id: 'video-player-modal-root',
      priority: 10,
      onDismiss: handleModalClose,
    });
  }, [activePlayingVideo, handleModalClose]);

  const effectiveStreamUrl = useMemo(() => {
    if (!activePlayingVideo) return '';
    let raw = customStreamUrl || activePlayingVideo.streamUrl || '';
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
  }, [activePlayingVideo, customStreamUrl, useProxy]);

  const effectiveDownloadUrl = useMemo(() => {
    if (!activePlayingVideo) return '';
    const fname = activePlayingVideo.filename || `${activePlayingVideo.title || 'video'}.mp4`;
    const cleanFname = fname.endsWith('.mp4') ? fname : `${fname}.mp4`;

    const candidate = customStreamUrl || activePlayingVideo.downloadUrl || activePlayingVideo.streamUrl || '';

    if (candidate.includes('/api/proxy-video-stream')) {
      try {
        const urlObj = new URL(candidate, window.location.origin);
        urlObj.searchParams.set('download', 'true');
        if (!urlObj.searchParams.has('filename')) {
          urlObj.searchParams.set('filename', cleanFname);
        }
        return `${urlObj.pathname}${urlObj.search}`;
      } catch {
        const sep = candidate.includes('?') ? '&' : '?';
        return `${candidate}${sep}download=true&filename=${encodeURIComponent(cleanFname)}`;
      }
    }

    if (candidate.startsWith('/api/videos/')) {
      return candidate;
    }

    if (candidate.startsWith('http')) {
      let defaultRef = '';
      try {
        defaultRef = new URL(activePlayingVideo.sourceUrl || candidate).origin;
      } catch {
        defaultRef = '';
      }
      const ref = activePlayingVideo.sourceUrl || defaultRef;
      const refParam = ref ? `&referer=${encodeURIComponent(ref)}` : '';
      return `/api/proxy-video-stream?url=${encodeURIComponent(candidate)}${refParam}&download=true&filename=${encodeURIComponent(cleanFname)}`;
    }

    return activePlayingVideo.downloadUrl || `/api/videos/${activePlayingVideo.id}/download`;
  }, [activePlayingVideo, customStreamUrl]);

  const handleDownloadVideo = async () => {
    if (!activePlayingVideo || downloadState === 'downloading') return;
    if (downloadTimerRef.current) clearTimeout(downloadTimerRef.current);
    setDownloadState('downloading');
    const fname = activePlayingVideo.filename || `${activePlayingVideo.title || 'video'}.mp4`;
    const cleanFname = fname.endsWith('.mp4') ? fname : `${fname}.mp4`;
    const targetUrl = effectiveDownloadUrl || activePlayingVideo.downloadUrl || activePlayingVideo.streamUrl || '';

    addNotification({
      type: 'info',
      title: isEn ? 'Starting Download' : 'Iniciando Download',
      message: isEn
        ? `Saving "${activePlayingVideo.title || cleanFname}" directly to Downloads folder...`
        : `Salvando "${activePlayingVideo.title || cleanFname}" diretamente na pasta Downloads...`,
    });

    try {
      const res = await backendApi.downloadToDisk(targetUrl, cleanFname, true);
      if (res && res.success) {
        setDownloadState('completed');
        addNotification({
          type: 'success',
          title: isEn ? 'Download Finished' : 'Download Concluído',
          message: isEn
            ? `Video saved to Downloads: "${res.filename || cleanFname}".`
            : `Vídeo salvo na pasta Downloads: "${res.filename || cleanFname}".`,
        });
        downloadTimerRef.current = setTimeout(() => {
          setDownloadState('idle');
        }, 2500);
      } else {
        const link = document.createElement('a');
        link.href = targetUrl;
        link.download = cleanFname;
        link.target = '_blank';
        link.click();
        setDownloadState('completed');
        addNotification({
          type: 'info',
          title: isEn ? 'Download Dispatched' : 'Download Disparado',
          message: isEn
            ? `Dispatched "${cleanFname}" to browser download manager.`
            : `Disparado "${cleanFname}" no gerenciador de downloads.`,
        });
        downloadTimerRef.current = setTimeout(() => {
          setDownloadState('idle');
        }, 2500);
      }
    } catch (err: any) {
      setDownloadState('idle');
      addNotification({
        type: 'error',
        title: isEn ? 'Download Failed' : 'Falha no Download',
        message: err?.message || (isEn ? 'Failed to download video.' : 'Falha ao baixar vídeo.'),
      });
    }
  };

  // Sync initial qualities when modal opens (actual remote quality discovery is handled by UniversalVideoPlayer)
  useEffect(() => {
    if (!activePlayingVideo) return;
    if (activePlayingVideo.qualities && activePlayingVideo.qualities.length > 0) {
      setAvailableQualities(activePlayingVideo.qualities);
      setEffectiveQuality(activePlayingVideo.qualities[0].height);
    }
  }, [activePlayingVideo?.id]);

  // Shared player renders ranked markers on the progress bar.
  const highlights = useMemo(() => normalizePlayerHighlights(activePlayingVideo), [activePlayingVideo]);

  // Stream renewal supporting album refresh, /api/videos/renew-streams, and /api/video-stream-qualities
  const handleRenewStream = useCallback(async (): Promise<string | null> => {
    if (!activePlayingVideo) return null;
    try {
      let renewedUrl: string | null = null;
      const allAlbums = useAppStore.getState().albums;
      const albumId =
        activeAlbumId ||
        allAlbums.find(
          (a) =>
            a.images?.some(
              (i) =>
                i.id === activePlayingVideo.id ||
                i.videoUrl === activePlayingVideo.streamUrl ||
                i.title === activePlayingVideo.title
            ) ||
            (activePlayingVideo.sourceUrl && a.sourceUrl === activePlayingVideo.sourceUrl)
        )?.id;

      if (albumId) {
        const renewed = await refreshAlbumStreams(albumId);
        if (renewed) {
          const freshAlbum = useAppStore.getState().albums.find((a) => a.id === albumId);
          const freshImg =
            freshAlbum?.images?.find(
              (i) =>
                i.id === activePlayingVideo.id ||
                (activePlayingVideo.title &&
                  i.title?.toLowerCase() === activePlayingVideo.title.toLowerCase()) ||
                (i.candidateId && (activePlayingVideo as any).candidateId === i.candidateId)
            ) || (freshAlbum?.images?.length === 1 ? freshAlbum.images[0] : undefined);
          if (freshImg) {
            let targetRaw = freshImg.rawOriginalUrl || freshImg.originalUrl || freshImg.videoUrl || '';
            let unwrapCount = 0;
            while (
              targetRaw.includes('/api/proxy-video-stream') &&
              targetRaw.includes('url=') &&
              unwrapCount < 5
            ) {
              unwrapCount++;
              const m = targetRaw.match(/[?&]url=([^&]+)/);
              if (m) targetRaw = decodeURIComponent(m[1]);
              else break;
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
            renewedUrl = `/api/proxy-video-stream?url=${encodeURIComponent(targetRaw)}${refParam}`;

            setActivePlayingVideo({
              ...activePlayingVideo,
              streamUrl: renewedUrl,
              fileSizeBytes: freshImg.fileSizeBytes || activePlayingVideo.fileSizeBytes,
            });
          }
        }
      }

      if (!renewedUrl && activePlayingVideo.id) {
        try {
          const resp = await fetch('/api/videos/renew-streams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_ids: [activePlayingVideo.id] }),
          });
          if (resp.ok) {
            const data = await resp.json();
            const item = data?.renewed?.[activePlayingVideo.id] || data?.videos?.[0];
            if (item?.streamUrl || item?.stream_url) {
              renewedUrl = item.streamUrl || item.stream_url;
              setCustomStreamUrl(renewedUrl);
            }
          }
        } catch {
          // Proceed to standalone quality endpoint fallback
        }
      }

      if (!renewedUrl && activePlayingVideo) {
        const target =
          activePlayingVideo.sourceUrl ||
          activePlayingVideo.url ||
          activePlayingVideo.streamUrl ||
          '';
        const referer = activePlayingVideo.sourceUrl || '';
        try {
          const resp = await fetch(
            `/api/video-stream-qualities?url=${encodeURIComponent(target)}&referer=${encodeURIComponent(referer)}&_t=${Date.now()}`
          );
          if (resp.ok) {
            const data = await resp.json();
            if (data.qualities && data.qualities.length > 0) {
              const top = data.qualities[0];
              if (top.streamUrl) {
                renewedUrl = top.streamUrl;
                setCustomStreamUrl(renewedUrl);
                setEffectiveQuality(top.height);
              }
            }
          }
        } catch (e) {
          console.warn('Could not renew standalone stream:', e);
        }
      }

      if (renewedUrl) {
        addNotification({
          title: playerT?.streamRenewed || translations['pt-BR']?.player?.streamRenewed,
          message:
            playerT?.streamRenewSuccess ||
            t?.streamRenewSuccess ||
            translations['pt-BR']?.player?.streamRenewSuccess,
          type: 'success',
        });
        return renewedUrl;
      }

      setUseProxy(true);
      return effectiveStreamUrl || null;
    } catch (err) {
      console.warn('Error renewing stream in modal:', err);
      addNotification({
        title: t.streamRenewErrorTitle || 'Renewal Error',
        message: t.streamRenewErrorMsg || 'Could not renew stream.',
        type: 'error',
      });
      return null;
    }
  }, [
    activeAlbumId,
    activePlayingVideo,
    addNotification,
    effectiveStreamUrl,
    playerT?.streamRenewSuccess,
    playerT?.streamRenewed,
    refreshAlbumStreams,
    setActivePlayingVideo,
    t?.streamRenewErrorMsg,
    t?.streamRenewErrorTitle,
    t?.streamRenewSuccess,
  ]);

  const mappedQualities = useMemo<StreamQualityCandidate[]>(() => {
    return availableQualities.map((q) => ({
      height: q.height,
      label: q.label,
      streamUrl: q.streamUrl || '',
      bitrate: q.bitrate,
      levelIndex: q.levelIndex,
    }));
  }, [availableQualities]);

  const initialHandoff = useMemo<PlaybackHandoffSnapshot | undefined>(() => {
    if (!activePlayingVideo?.id) return undefined;
    const pendingRecord = useMiniPlayerStore.getState().pendingExpandHandoff;
    if (
      pendingRecord &&
      (pendingRecord.source.id === activePlayingVideo.id ||
        pendingRecord.source.streamUrl === activePlayingVideo.id)
    ) {
      return pendingRecord.handoff;
    }
    const seedQualities = (activePlayingVideo.qualities || []).map((q) => ({
      height: q.height,
      label: q.label,
      streamUrl: q.streamUrl || '',
      bitrate: q.bitrate,
      levelIndex: q.levelIndex,
    }));
    return {
      currentTime:
        typeof (activePlayingVideo as any).currentTime === 'number'
          ? (activePlayingVideo as any).currentTime
          : 0,
      isPlaying:
        typeof (activePlayingVideo as any).isPlaying === 'boolean'
          ? (activePlayingVideo as any).isPlaying
          : true,
      isMuted:
        typeof (activePlayingVideo as any).isMuted === 'boolean'
          ? (activePlayingVideo as any).isMuted
          : false,
      playbackRate:
        typeof (activePlayingVideo as any).playbackRate === 'number'
          ? (activePlayingVideo as any).playbackRate
          : 1,
      qualities: seedQualities.length > 0 ? seedQualities : undefined,
    };
    // Intentionally keyed only on activePlayingVideo.id so async quality discovery never resets currentTime to 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayingVideo?.id]);

  useEffect(() => {
    if (!activePlayingVideo?.id) return;
    if (hostMounted && !modalSlotEl) return;
    const id = activePlayingVideo.id;
    if (modalSlotEl && !settings?.disableAllAnimations && typeof modalSlotEl.animate === 'function') {
      const from = usePersistentPlayerStore.getState().consumePendingFlipRect();
      if (from && from.width > 0 && from.height > 0) {
        const to = modalSlotEl.getBoundingClientRect();
        if (to.width > 0 && to.height > 0) {
          modalSlotEl.animate(
            [
              {
                transformOrigin: 'top left',
                transform: `translate3d(${from.left - to.left}px, ${from.top - to.top}px, 0) scale(${from.width / to.width}, ${from.height / to.height})`,
              },
              {
                transformOrigin: 'top left',
                transform: 'translate3d(0, 0, 0) scale(1, 1)',
              },
            ],
            { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
        }
      }
    }
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => useMiniPlayerStore.getState().consumePendingExpandHandoff(id))
      : window.setTimeout(() => useMiniPlayerStore.getState().consumePendingExpandHandoff(id), 0);
    return () => {
      if (typeof cancelAnimationFrame === 'function' && typeof raf === 'number') {
        cancelAnimationFrame(raf);
      } else {
        clearTimeout(raf);
      }
    };
  }, [activePlayingVideo?.id, hostMounted, modalSlotEl]);

  const playerSource = useMemo<UniversalVideoSource | null>(() => {
    if (!activePlayingVideo) return null;
    return {
      id: activePlayingVideo.id,
      highlightVideoId: activeAlbumId ? undefined : activePlayingVideo.id,
      title: activePlayingVideo.title,
      streamUrl: effectiveStreamUrl,
      sourceUrl: activePlayingVideo.sourceUrl || activePlayingVideo.url,
      posterUrl: activePlayingVideo.thumbnailUrl,
      durationSec:
        typeof activePlayingVideo.durationSeconds === 'number'
          ? activePlayingVideo.durationSeconds
          : undefined,
      qualities: mappedQualities,
      highlights,
      originContext: {
        surface: 'library-modal',
        albumId: activeAlbumId || undefined,
        routeHash: typeof window !== 'undefined' ? window.location.hash : undefined,
      },
    };
  }, [activeAlbumId, activePlayingVideo, effectiveStreamUrl, highlights, mappedQualities]);

  const handleMinimizeToMiniPlayer = useCallback(() => {
    if (!activePlayingVideo || !playerSource) return;
    const activeHandle = uvpRef.current || usePersistentPlayerStore.getState().playerHandle;
    const snap =
      activeHandle?.capturePlaybackSnapshot() ||
      latestSnapshotRef.current || {
        currentTime: 0,
        isPlaying: true,
        isMuted: false,
        qualities: mappedQualities,
      };
    const modalRect = modalSlotEl?.getBoundingClientRect();
    if (modalRect && modalRect.width > 0 && modalRect.height > 0) {
      usePersistentPlayerStore.getState().setPendingFlipRect({
        left: modalRect.left,
        top: modalRect.top,
        width: modalRect.width,
        height: modalRect.height,
        capturedAt: Date.now(),
      });
    }
    useMiniPlayerStore.getState().openMiniPlayer({
      source: playerSource,
      handoff: snap,
    });
    setActivePlayingVideo(null);
  }, [activePlayingVideo, mappedQualities, playerSource, setActivePlayingVideo]);

  const [isModalTheater, setIsModalTheater] = useState(false);

  const handleModalQualitiesFetched = useCallback(({ qualities }: { qualities: StreamQualityCandidate[] }) => {
    if (qualities && qualities.length > 0) {
      setAvailableQualities(
        qualities
          .filter((q) => typeof q.height === 'number' && q.height > 0)
          .map((q) => ({
            height: q.height as number,
            label: q.label || `${q.height}p`,
            streamUrl: q.streamUrl,
            bitrate: q.bitrate,
          }))
      );
      setEffectiveQuality((prev) => prev ?? (typeof qualities[0]?.height === 'number' ? qualities[0].height : null));
    }
  }, []);

  const handleModalPlaybackSnapshot = useCallback((snap: PlaybackHandoffSnapshot) => {
    latestSnapshotRef.current = snap;
  }, []);

  useEffect(() => {
    if (!hostMounted || !activePlayingVideo || !playerSource || !modalSlotEl) {
      usePersistentPlayerStore.getState().setModalSlot(null);
      return;
    }
    usePersistentPlayerStore.getState().setModalSlot({
      element: modalSlotEl,
      source: playerSource,
      initialHandoff,
      autoPlayOnActive: true,
      initialMuted: false,
      isTheater: isModalTheater,
      onToggleTheater: setIsModalTheater,
      onPlaybackSnapshot: handleModalPlaybackSnapshot,
      onQualitiesFetched: handleModalQualitiesFetched,
      onRenewStream: handleRenewStream,
      onMinimizeToMiniPlayer: handleMinimizeToMiniPlayer,
      onClose: handleModalClose,
    });
    return () => {
      usePersistentPlayerStore.getState().setModalSlot(null);
    };
  }, [
    hostMounted,
    activePlayingVideo,
    playerSource,
    modalSlotEl,
    initialHandoff,
    isModalTheater,
    handleModalPlaybackSnapshot,
    handleModalQualitiesFetched,
    handleRenewStream,
    handleMinimizeToMiniPlayer,
    handleModalClose,
  ]);

  if (!activePlayingVideo || !playerSource) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-6 select-none animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleModalClose();
      }}
    >
      <div
        ref={panelRef}
        className={`relative bg-black overflow-hidden flex flex-col justify-between w-full ${
          isModalTheater ? 'max-w-[96vw]' : 'max-w-5xl'
        } max-h-[90vh] sm:max-h-[88vh] rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-700 ring-1 ring-white/10 ${getVideoPlayerAnimationClass(
          settings.videoPlayerAnimation || 'zoom',
          settings.disableAllAnimations
        )} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(
          settings.animationDistance || 'normal'
        )} transition-all duration-300 ease-out`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="relative z-30 px-3 py-2.5 sm:px-4 sm:py-3 bg-slate-950/90 border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 shrink-0">
              <Folder size={14} />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate max-w-[200px] sm:max-w-md">
                {activePlayingVideo.title}
              </h3>
              <p className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                <span>
                  {(t.folderLabel || 'Pasta: {folder}').replace(
                    '{folder}',
                    activePlayingVideo.folder || ''
                  )}
                </span>
                <span>•</span>
                {activePlayingVideo.fileSizeBytes && activePlayingVideo.fileSizeBytes > 0 ? (
                  <span>{formatFileSize(activePlayingVideo.fileSizeBytes)}</span>
                ) : (
                  <span className="text-slate-300">
                    {[
                      activePlayingVideo.duration,
                      effectiveQuality ? `${effectiveQuality}p` : activePlayingVideo.resolution,
                      activePlayingVideo.views,
                      'Web Stream',
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </span>
                )}
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
              title={t.openNewTab || 'Open Video in New Tab (Native Player)'}
            >
              <ExternalLink size={14} />
              <span className="hidden sm:inline">{isEn ? 'New Tab' : 'Nova Aba'}</span>
            </a>

            {/* Favorite Button */}
            <button
              type="button"
              onClick={() => toggleVideoFavorite(activePlayingVideo.id)}
              aria-pressed={Boolean(activePlayingVideo.isFavorite)}
              className={`p-2 rounded-xl border transition-all cursor-pointer ${
                activePlayingVideo.isFavorite
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-glow-amber'
                  : 'bg-black/50 hover:bg-white/10 text-slate-300 border-white/10'
              }`}
              title={
                activePlayingVideo.isFavorite
                  ? t.removeFavorite || 'Remove from Favorites'
                  : t.addFavorite || 'Favorite Video'
              }
            >
              <Star size={16} className={activePlayingVideo.isFavorite ? 'fill-amber-400' : ''} />
            </button>

            {/* Direct Download Button */}
            <button
              type="button"
              onClick={handleDownloadVideo}
              disabled={downloadState === 'downloading'}
              className={`p-2 rounded-xl border transition-all duration-300 ease-out active:scale-95 cursor-pointer ${
                downloadState === 'downloading'
                  ? 'bg-brand-600/30 text-brand-300 border-brand-500/50 ring-2 ring-brand-400/40 animate-pulse cursor-wait'
                  : downloadState === 'completed'
                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 ring-2 ring-emerald-400/40 scale-105 shadow-lg shadow-emerald-500/20'
                  : 'bg-black/50 hover:bg-white/10 text-slate-300 hover:text-white border-white/10 hover:scale-105'
              }`}
              title={
                downloadState === 'downloading'
                  ? isEn
                    ? 'Downloading Video...'
                    : 'Baixando Vídeo...'
                  : downloadState === 'completed'
                  ? isEn
                    ? 'Saved to Downloads!'
                    : 'Salvo em Downloads!'
                  : t.download || (isEn ? 'Download Video to Computer' : 'Baixar Vídeo no Computador')
              }
              aria-busy={downloadState === 'downloading'}
            >
              {downloadState === 'downloading' ? (
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none text-brand-400" />
              ) : downloadState === 'completed' ? (
                <Check size={16} className="animate-bounce motion-reduce:animate-none text-emerald-400" />
              ) : (
                <Download size={16} />
              )}
            </button>

            {/* Delete Button */}
            <button
              type="button"
              onClick={() => setIsConfirmingDelete(true)}
              className="p-2 rounded-xl bg-black/50 hover:bg-rose-900/70 text-slate-300 hover:text-rose-300 border border-white/10 transition-colors cursor-pointer"
              title={t.delete || 'Delete Video from Disk'}
            >
              <Trash2 size={16} />
            </button>

            {/* Single Canonical Close Button */}
            <button
              type="button"
              onClick={handleModalClose}
              className="p-2 rounded-xl bg-black/50 hover:bg-white/20 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
              title={t.close || playerT.closePlayer}
              aria-label={t.closeAria || playerT.closePlayer}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Universal Video Player Stage (density="cinema") */}
        <div className="w-full aspect-video max-h-[calc(88vh-56px)] relative flex items-center justify-center bg-black overflow-hidden">
          {hostMounted ? (
            <div ref={setModalSlotEl} data-persistent-modal-slot="true" className="w-full h-full" />
          ) : (
            <UniversalVideoPlayer
              ref={uvpRef}
              source={playerSource}
              density="cinema"
              aspectRatio="16:9"
              autoPlayOnActive={true}
              initialMuted={false}
              initialHandoff={initialHandoff}
              isTheater={isModalTheater}
              onToggleTheater={setIsModalTheater}
              onPlaybackSnapshot={handleModalPlaybackSnapshot}
              onQualitiesFetched={handleModalQualitiesFetched}
              onRenewStream={handleRenewStream}
              onMinimizeToMiniPlayer={handleMinimizeToMiniPlayer}
              onClose={handleModalClose}
              className="w-full h-full rounded-none border-0"
            />
          )}
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
                <h4 className="font-bold text-base text-white">
                  {t.confirmDeleteTitle || 'Delete Video?'}
                </h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {(
                    t.confirmDeleteDesc ||
                    (isEn
                      ? 'Do you want to move video "{title}" to trash?'
                      : 'Deseja mover o vídeo "{title}" para a lixeira?')
                  ).replace('{title}', activePlayingVideo.title || '')}
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
