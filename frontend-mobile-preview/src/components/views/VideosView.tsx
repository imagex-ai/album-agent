import React, { useState, useRef, useMemo } from 'react';
import {
  Film,
  Folder,
  FolderPlus,
  Star,
  Upload,
  Search,
  MoreVertical,
  Play,
  Download,
  Trash2,
  Edit2,
  FolderInput,
  Clock,
  ArrowUpDown,
  FileVideo,
  Plus,
  Link2,
  CheckSquare,
  Square,
  Check,
  X,
  Zap,
  HardDrive,
  RefreshCw,
  FolderOpen,
  ExternalLink,
  Globe,
  Maximize2,
  Copy,
  FolderHeart,
  Flame,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  AlertTriangle,
  AlertCircle
} from 'lucide-react';
import { useAppStore, getCanonicalMediaFingerprint } from '../../store/useAppStore';
import { backendApi } from '../../services/realApi';
import { VideoItem, Album } from '../../types';
import { formatFileSize } from '../../utils/formatters';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';
import { ModalPortal } from '../common/ModalPortal';

const getVideoResolutionLabel = (video?: Partial<VideoItem>, title?: string, filename?: string) => {
  const h = video?.height || 0;
  const w = video?.width || 0;
  const fps = video?.fps || 0;
  const t = ((title || video?.title || '') + ' ' + (filename || video?.filename || '')).toLowerCase();
  const is60 = fps >= 50 || /\b60fps\b|1080p60|720p60|\b60\s*fps\b/i.test(t);

  // 1. 4K UHD (3840x2160 / 2160p / 4K)
  if (h >= 2160 || w >= 3840 || /(2160p|4k|uhd)/i.test(t)) {
    return { label: is60 ? '4K 60fps' : '4K UHD', badgeClass: 'bg-amber-500/25 text-amber-300 border-amber-500/50 shadow-sm' };
  }
  // 2. 2K QHD (2560x1440 / 1440p / 2K)
  if (h >= 1440 || w >= 2560 || /(1440p|2k|qhd)/i.test(t)) {
    return { label: is60 ? '2K 60fps' : '2K QHD', badgeClass: 'bg-indigo-500/25 text-indigo-300 border-indigo-500/50 shadow-sm' };
  }
  // 3. 1080p FHD (1920x1080 / 1080p)
  if (h >= 1080 || w >= 1920 || /(1080p|1080|fhd)/i.test(t)) {
    return { label: is60 ? '1080p60' : '1080p FHD', badgeClass: 'bg-violet-900/90 text-violet-200 border-violet-400/50 shadow-sm' };
  }
  // 4. 720p HD (1280x720 / 720p)
  if (h >= 720 || w >= 1280 || /(720p|720)/i.test(t) || (/\bhd\b/i.test(t) && !t.includes('1080') && !t.includes('2160') && !t.includes('4k'))) {
    return { label: is60 ? '720p60' : '720p HD', badgeClass: 'bg-blue-900/80 text-blue-200 border-blue-400/40' };
  }
  // 5. 480p SD
  if (h >= 480 || /(480p|480)/i.test(t)) {
    return { label: '480p SD', badgeClass: 'bg-slate-800 text-slate-300 border-slate-600/40' };
  }
  // 6. 360p
  if (h >= 360 || /(360p|360)/i.test(t)) {
    return { label: '360p', badgeClass: 'bg-slate-800 text-slate-300 border-slate-600/40' };
  }
  // 7. 240p
  if (h >= 240 || /(240p|240)/i.test(t)) {
    return { label: '240p', badgeClass: 'bg-slate-800 text-slate-300 border-slate-600/40' };
  }

  return null;
};

export const VideosView: React.FC = () => {
  const {
    videos,
    videoFolders,
    activeVideoFolder,
    setActiveVideoFolder,
    videoSearchQuery,
    setVideoSearchQuery,
    videoFilterFavoritesOnly,
    setVideoFilterFavoritesOnly,
    setActivePlayingVideo,
    setActiveFolderModal,
    uploadVideo,
    addVideoByUrl,
    deleteVideo,
    renameVideo,
    deleteVideoFolder,
    toggleVideoFavorite,
    selectedVideoIds,
    toggleSelectVideo,
    selectAllVideos,
    clearSelectedVideos,
    batchDeleteVideos,
    uploadProgress,
    importLocalPath,
    openVideosFolder,
    syncVideos,
    isRenewingVideoStreams,
    renewVideoStreams,
    saveExtractedVideoToGallery,
    navigateToView,
    highlightedItemId,
    albums,
    setActiveAlbumFolder,
    addNotification,
    settings
  } = useAppStore();
  const isEn = settings?.language === 'en-US';

  const t = translations[settings.language]?.videos || translations['en-US'].videos;

  // Scroll to highlighted item if coming from redirect badge
  React.useEffect(() => {
    if (highlightedItemId) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-video-id="${highlightedItemId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [highlightedItemId]);

  // Group duplicates with resolution awareness (720p vs 1080p are NOT duplicates)
  const duplicateVideoMap = React.useMemo(() => {
    const counts = new Map<string, number>();
    videos.forEach(v => {
      const key = getCanonicalMediaFingerprint(v.title, v.sourceUrl || v.url, v.height);
      if (key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    return counts;
  }, [videos]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const foldersScrollRef = useRef<HTMLDivElement | null>(null);
  const [wrapFolders, setWrapFolders] = useState<boolean>(false);

  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [activeMenuVideoId, setActiveMenuVideoId] = useState<string | null>(null);
  const [activeFolderMenuName, setActiveFolderMenuName] = useState<string | null>(null);
  const [isUrlModalOpen, setIsUrlModalOpen] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [urlTitleInput, setUrlTitleInput] = useState<string>('');
  const [isDownloadingUrl, setIsDownloadingUrl] = useState<boolean>(false);

  // In-App Modal States (100% reliable on iOS Safari / PWA without window.confirm)
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [videoToDelete, setVideoToDelete] = useState<VideoItem | null>(null);
  const [isConfirmingBatchDelete, setIsConfirmingBatchDelete] = useState<boolean>(false);
  const [videoToRename, setVideoToRename] = useState<{ video: VideoItem; newTitle: string } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [selectedFolderNames, setSelectedFolderNames] = useState<string[]>([]);
  const [isFolderSelectionMode, setIsFolderSelectionMode] = useState<boolean>(false);
  const [isConfirmingBatchFolderDelete, setIsConfirmingBatchFolderDelete] = useState<boolean>(false);

  // Local PC Fast Import & Windows Explorer States
  const [isLocalImportModalOpen, setIsLocalImportModalOpen] = useState<boolean>(false);
  const [localPathInput, setLocalPathInput] = useState<string>('');
  const [localImportMode, setLocalImportMode] = useState<'copy' | 'move'>('copy');
  const [localImportFolder, setLocalImportFolder] = useState<string>('Geral');
  const [isImportingLocal, setIsImportingLocal] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [thumbRefreshKey, setThumbRefreshKey] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [playingVideoIds, setPlayingVideoIds] = useState<string[]>([]);
  const [videoOriginFilter, setVideoOriginFilter] = useState<'all' | 'pc' | 'web' | 'hf' | 'broken'>('all');
  const [deletedNoticeVideo, setDeletedNoticeVideo] = useState<VideoItem | null>(null);

  const toggleInlinePlay = (id: string) => {
    setPlayingVideoIds(prev =>
      prev.includes(id) ? prev.filter(vId => vId !== id) : [...prev, id]
    );
  };

  const closeInlinePlay = (id: string) => {
    setPlayingVideoIds(prev => prev.filter(vId => vId !== id));
  };

  const normalizeFolderKey = (s: string) =>
    (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  const findMatchingOriginAlbum = (video: VideoItem, albumsList: Album[]): Album | null => {
    if (!video) return null;
    const vSource = (video.sourceUrl || video.url || '').trim().toLowerCase();
    const vFilename = (video.filename || '').trim().toLowerCase();
    const vStream = (video.streamUrl || video.cloudUrl || '').trim();

    return albumsList.find(album => {
      // 1. Vínculo por Source URL idêntica e não-vazia
      const aSource = (album.sourceUrl || (album as any).source_page || (album as any).source_url || '').trim().toLowerCase();
      if (vSource && aSource && vSource === aSource) return true;

      // 2. Vínculo por mídia interna do álbum com mesmo arquivo ou stream
      if (album.images && album.images.length > 0) {
        const hasMatchingMedia = album.images.some((img: any) => {
          const imgVideoUrl = (img.videoUrl || (img as any).videoStreamUrl || (img as any).stream_url || img.originalUrl || '').trim();
          if (vStream && imgVideoUrl && imgVideoUrl === vStream) return true;
          if (vSource && img.originalUrl && img.originalUrl.toLowerCase() === vSource) return true;
          if (vFilename && img.originalUrl && img.originalUrl.toLowerCase().includes(vFilename)) return true;
          return false;
        });
        if (hasMatchingMedia) return true;
      }

      // 3. Vínculo por título exato não-genérico
      const vTitle = (video.title || '').trim().toLowerCase();
      const aTitle = (album.title || '').trim().toLowerCase();
      if (vTitle.length > 10 && aTitle.length > 10 && vTitle === aTitle) return true;

      return false;
    }) || null;
  };

  const isVideoWebOrigin = (v: VideoItem): boolean => {
    if (v.sourceOrigin === 'web') return true;
    if (v.sourceOrigin === 'pc' && v.storageLocation === 'local') return false;
    // Fallback detection for older items or direct streams
    const hasWebUrl = Boolean(v.sourceUrl && (v.sourceUrl.startsWith('http://') || v.sourceUrl.startsWith('https://')));
    const hasSourceId = Boolean(v.sourceId);
    const effFolder = (v.folder || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const isExtractedFolder = effFolder.startsWith('extra');
    const isStreamOnly = v.storageLocation === 'stream_url' || Boolean(v.cloudUrl);
    return hasWebUrl || hasSourceId || isExtractedFolder || isStreamOnly;
  };

  const isVideoHuggingFace = (v: VideoItem): boolean => {
    if (v.storageLocation === 'huggingface') return true;
    const cUrl = (v.cloudUrl || '').toLowerCase();
    if (cUrl.includes('huggingface.co') || cUrl.includes('hf.co')) return true;
    const sUrl = (v.streamUrl || '').toLowerCase();
    if (sUrl.includes('huggingface.co') || sUrl.includes('hf.co')) return true;
    const srcUrl = (v.sourceUrl || '').toLowerCase();
    if (srcUrl.includes('huggingface.co') || srcUrl.includes('hf.co')) return true;
    return false;
  };

  // Filter videos
  let filtered = videos.filter((v) => {
    if (videoFilterFavoritesOnly && !v.isFavorite) return false;
    if (activeVideoFolder) {
      const activeNorm = normalizeFolderKey(activeVideoFolder);
      const vNorm = normalizeFolderKey(v.folder || 'Geral');
      if (activeNorm !== vNorm) return false;
    }

    // Filter by Origin (PC local vs Web vs Hugging Face vs Broken/Deleted)
    if (videoOriginFilter !== 'all') {
      if (videoOriginFilter === 'hf') {
        if (!isVideoHuggingFace(v)) return false;
      } else if (videoOriginFilter === 'broken') {
        if (v.streamStatus !== 'deleted_on_source' && v.streamStatus !== 'expired') return false;
      } else if (videoOriginFilter === 'pc') {
        const isWeb = isVideoWebOrigin(v);
        const isHf = isVideoHuggingFace(v);
        if (isWeb || (isHf && v.storageLocation !== 'local')) return false;
      } else if (videoOriginFilter === 'web') {
        const isWeb = isVideoWebOrigin(v);
        if (!isWeb) return false;
      }
    }

    if (videoSearchQuery.trim()) {
      const q = videoSearchQuery.toLowerCase();
      return v.title.toLowerCase().includes(q) || v.filename.toLowerCase().includes(q);
    }
    return true;
  });

  // Sort videos
  filtered.sort((a, b) => {
    if (sortBy === 'name') return a.title.localeCompare(b.title);
    if (sortBy === 'size') return b.fileSizeBytes - a.fileSizeBytes;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const totalBytes = videos.reduce((acc, v) => acc + v.fileSizeBytes, 0);

  const streamVideosInList = useMemo(() => {
    return filtered.filter(v => v.storageLocation === 'stream_url' || v.sourceOrigin === 'web' || Boolean(v.cloudUrl));
  }, [filtered]);

  const selectedStreamVideos = useMemo(() => {
    return videos.filter(v => selectedVideoIds.includes(v.id) && (v.storageLocation === 'stream_url' || v.sourceOrigin === 'web' || Boolean(v.cloudUrl)));
  }, [videos, selectedVideoIds]);

  const selectedLocalPendingHfVideos = useMemo(() => {
    return videos.filter(v => selectedVideoIds.includes(v.id) && !isVideoHuggingFace(v) && !isVideoWebOrigin(v));
  }, [videos, selectedVideoIds]);

  const brokenVideosCount = useMemo(() => {
    return videos.filter(v => v.streamStatus === 'deleted_on_source' || v.streamStatus === 'expired').length;
  }, [videos]);

  const handleRenewFolderStreams = async (targetIds?: string[]) => {
    const ids = targetIds && targetIds.length > 0 ? targetIds : streamVideosInList.map((v: any) => v.id);
    if (!ids.length || isRenewingVideoStreams) return;
    await renewVideoStreams(ids, activeVideoFolder || undefined);
  };

  const handleRenewSingleStream = async (videoId: string) => {
    if (isRenewingVideoStreams) return;
    await renewVideoStreams([videoId]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await uploadVideo(files[i], activeVideoFolder || 'Geral', i + 1, files.length);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await uploadVideo(files[i], activeVideoFolder || 'Geral', i + 1, files.length);
    }
  };

  const handleImportLocalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPathInput.trim() || isImportingLocal) return;
    setIsImportingLocal(true);
    try {
      const ok = await importLocalPath(
        localPathInput.trim(),
        localImportFolder || activeVideoFolder || 'Geral',
        localImportMode
      );
      if (ok) {
        setLocalPathInput('');
        setIsLocalImportModalOpen(false);
      }
    } finally {
      setIsImportingLocal(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncVideos(true);
      setThumbRefreshKey(Date.now());
      addNotification({
        title: isEn ? 'Sync & Thumbnail Generation' : 'Sincronização & Miniaturas',
        message: isEn
          ? 'Scanning disk and generating smart action thumbnails for missing videos in background...'
          : 'Sincronizando vídeos e gerando miniaturas inteligentes de ação em segundo plano...',
        type: 'info'
      });
      // Programar atualizações automáticas da interface para exibir as novas capas à medida que forem salvas
      setTimeout(() => setThumbRefreshKey(Date.now()), 4000);
      setTimeout(() => setThumbRefreshKey(Date.now()), 10000);
      setTimeout(() => setThumbRefreshKey(Date.now()), 18000);
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  };

  const handleOpenFolder = async () => {
    await openVideosFolder(activeVideoFolder || 'Geral');
  };

  const [urlStreamOnlyInput, setUrlStreamOnlyInput] = useState<boolean>(true);
  const [urlFolderInput, setUrlFolderInput] = useState<string>('Geral');

  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || isDownloadingUrl) return;
    setIsDownloadingUrl(true);
    try {
      await addVideoByUrl(
        urlInput.trim(),
        urlFolderInput || activeVideoFolder || 'Geral',
        urlTitleInput.trim() || undefined,
        urlStreamOnlyInput
      );
      setUrlInput('');
      setUrlTitleInput('');
      setUrlStreamOnlyInput(true);
      setIsUrlModalOpen(false);
    } finally {
      setIsDownloadingUrl(false);
    }
  };

  const handleRenamePrompt = (v: VideoItem) => {
    setVideoToRename({ video: v, newTitle: v.title });
    setActiveMenuVideoId(null);
  };

  const handleDeleteConfirm = (v: VideoItem) => {
    setVideoToDelete(v);
    setActiveMenuVideoId(null);
  };

  const handleDeleteFolderConfirm = (folderName: string) => {
    setFolderToDelete(folderName);
    setActiveFolderMenuName(null);
  };

  return (
    <div
      className={`p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full select-none relative transition-all ${
        isDragging ? 'ring-4 ring-brand-500/50 rounded-3xl' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => {
        setActiveMenuVideoId(null);
        setActiveFolderMenuName(null);
      }}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Header Banner */}
      <div className="p-4 sm:p-6 rounded-3xl glass-panel-elevated border border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <IconBadge variant="neon" size="md">
              <Film size={18} />
            </IconBadge>
            <h1 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight">
              {t.title}
            </h1>
          </div>
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
            <span>{t.savedCount.replace('{count}', String(videos.length))}</span>
            <span>•</span>
            <span className="text-cyan-400 font-mono font-semibold">{t.onDisk.replace('{size}', formatFileSize(totalBytes))}</span>
            <span>•</span>
            <span>{t.localStorage} <code className="bg-surface px-1.5 py-0.5 rounded text-brand-300">data/videos/</code></span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Sincronizar Arquivos do Disco */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="p-2 sm:px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
            title={t.syncTitle}
          >
            <IconBadge variant="cyan" size="xs">
              <RefreshCw size={11} className={`text-slate-950 ${isSyncing ? 'animate-spin' : ''}`} />
            </IconBadge>
            <span className="hidden sm:inline">{t.sync}</span>
          </button>

          {/* Renovar Streams da Pasta / Lista */}
          {streamVideosInList.length > 0 && (
            <button
              onClick={() => handleRenewFolderStreams()}
              disabled={isRenewingVideoStreams}
              className="px-3 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
              title={
                activeVideoFolder
                  ? (t.renewStreamsFolderTitle || (isEn
                      ? `Renew video stream links for all ${streamVideosInList.length} stream videos in folder "{folder}"`
                      : `Renovar links de stream dos ${streamVideosInList.length} vídeos da pasta "{folder}"`))
                      .replace('{folder}', activeVideoFolder)
                      .replace('{count}', String(streamVideosInList.length))
                  : (t.renewStreamsTitle || (isEn
                      ? `Renew video stream links for all ${streamVideosInList.length} stream videos in the list`
                      : `Renovar links de stream dos ${streamVideosInList.length} vídeos da lista`))
                      .replace('{count}', String(streamVideosInList.length))
              }
            >
              <RefreshCw size={13} className={isRenewingVideoStreams ? 'animate-spin text-violet-400' : 'text-violet-400'} />
              <span>
                {isRenewingVideoStreams
                  ? (isEn ? 'Renewing...' : 'Renovando...')
                  : (t.renewStreams || (isEn ? 'Renew Streams' : 'Renovar Streams'))}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-violet-950/60 text-violet-300 border border-violet-500/30">
                {streamVideosInList.length}
              </span>
            </button>
          )}

          {/* Abrir Pasta no Windows Explorer */}
          <button
            onClick={handleOpenFolder}
            className="px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title={t.openPcTitle}
          >
            <IconBadge variant="sapphire" size="xs">
              <FolderOpen size={11} className="text-white" />
            </IconBadge>
            <span className="hidden sm:inline">{t.openPc}</span>
          </button>

          {/* Importação Instantânea do PC */}
          <button
            onClick={() => setIsLocalImportModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
            title={t.importPcTitle}
          >
            <IconBadge variant="emerald" size="xs">
              <Zap size={11} className="text-slate-950 fill-current" />
            </IconBadge>
            <span>{t.importPc}</span>
          </button>

          {/* Selecionar */}
          <button
            onClick={() => {
              if (isSelectionMode) {
                setIsSelectionMode(false);
                clearSelectedVideos();
              } else {
                setIsSelectionMode(true);
              }
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border ${
              isSelectionMode || selectedVideoIds.length > 0
                ? 'bg-violet-600 text-white border-violet-500 shadow-glow-brand'
                : 'bg-surface-elevated hover:bg-surface-hover border-border text-slate-200'
            }`}
          >
            <IconBadge variant="neon" size="xs">
              <CheckSquare size={11} className="text-white" />
            </IconBadge>
            <span>{isSelectionMode || selectedVideoIds.length > 0 ? t.done : t.select}</span>
          </button>

          {/* Nova Pasta */}
          <button
            onClick={() => setActiveFolderModal({ type: 'create' })}
            className="px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <IconBadge variant="sapphire" size="xs">
              <FolderPlus size={11} className="text-white" />
            </IconBadge>
            <span className="hidden md:inline">{t.newFolder}</span>
          </button>

          {/* Link URL */}
          <button
            onClick={() => setIsUrlModalOpen(true)}
            className="px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <IconBadge variant="cyan" size="xs">
              <Link2 size={11} className="text-slate-950" />
            </IconBadge>
            <span className="hidden md:inline">{t.addUrl}</span>
          </button>

          {/* Shorts & Reels */}
          <button
            onClick={() => navigateToView('shorts')}
            className="px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
          >
            <Flame size={13} className="text-rose-400" />
            <span>Shorts</span>
          </button>

          {/* Extrair de Página Web */}
          <button
            onClick={() => navigateToView('web-video-scraper')}
            className="px-3.5 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
          >
            <IconBadge variant="neon" size="xs">
              <Globe size={11} className="text-white" />
            </IconBadge>
            <span className="font-bold">{t.extractFromWeb}</span>
          </button>

          {/* Enviar Vídeo do Navegador */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-glow-brand"
          >
            <IconBadge variant="emerald" size="xs">
              <Upload size={11} className="text-slate-950" />
            </IconBadge>
            <span>{t.uploadVideo}</span>
          </button>
        </div>
      </div>

      {/* Floating Sticky Batch Action Dock when Videos are Selected */}
      {selectedVideoIds.length > 0 && (
        <div className="sticky top-2 z-30 p-3 sm:p-4 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-violet-500/50 shadow-2xl flex flex-wrap items-center justify-between gap-3 animate-scale-up">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-violet-600 text-white font-bold text-xs shadow-glow-brand shrink-0">
              {selectedVideoIds.length}
            </span>
            <div>
              <p className="text-xs font-bold text-white">
                {selectedVideoIds.length === 1 ? t.selectedVideoSingle : t.selectedVideosCount.replace('{count}', String(selectedVideoIds.length))}
              </p>
              <p className="text-[10px] text-slate-400">
                {t.onDisk.replace('{size}', formatFileSize(videos.filter(v => selectedVideoIds.includes(v.id)).reduce((acc, v) => acc + v.fileSizeBytes, 0)))}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                if (selectedVideoIds.length === filtered.length) {
                  clearSelectedVideos();
                } else {
                  selectAllVideos(filtered.map(v => v.id));
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 hover:text-white text-xs font-semibold border border-border transition-colors flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>{selectedVideoIds.length === filtered.length ? t.deselectAll : t.selectAll}</span>
            </button>

            <button
              onClick={() => setActiveFolderModal({ type: 'move', videoIds: selectedVideoIds })}
              className="px-3 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 text-xs font-bold border border-cyan-500/40 transition-colors flex items-center gap-1.5"
            >
              <FolderInput size={14} />
              <span>{t.batchMove} ({selectedVideoIds.length})</span>
            </button>

            {selectedStreamVideos.length > 0 && (
              <button
                type="button"
                onClick={() => handleRenewFolderStreams(selectedStreamVideos.map((v: any) => v.id))}
                disabled={isRenewingVideoStreams}
                className="px-3 py-1.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-xs font-bold border border-violet-500/40 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                title={t.renewSelectedTitle || (isEn ? "Renew stream links for selected videos" : "Renovar links de stream dos vídeos selecionados")}
              >
                <RefreshCw size={13} className={isRenewingVideoStreams ? 'animate-spin text-violet-400' : 'text-violet-400'} />
                <span>
                  {isRenewingVideoStreams
                    ? (isEn ? 'Renewing...' : 'Renovando...')
                    : (t.renewStreams || (isEn ? 'Renew Streams' : 'Renovar Streams'))} ({selectedStreamVideos.length})
                </span>
              </button>
            )}

            {selectedLocalPendingHfVideos.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    addNotification({
                      type: 'info',
                      title: 'Hugging Face Backup',
                      message: (t.backupBatchStarted || (isEn
                        ? 'Starting backup of {count} videos to Hugging Face...'
                        : 'Iniciando backup de {count} vídeos para o Hugging Face...'))
                        .replace('{count}', String(selectedLocalPendingHfVideos.length))
                    });
                    for (const v of selectedLocalPendingHfVideos) {
                      await backendApi.uploadVideoToHf(v.id);
                    }
                    addNotification({
                      type: 'success',
                      title: 'Hugging Face Backup',
                      message: t.backupBatchQueued || (isEn
                        ? 'Videos queued for upload in background to Hugging Face!'
                        : 'Vídeos enfileirados para upload em segundo plano no Hugging Face!')
                    });
                  } catch (e: any) {
                    addNotification({
                      type: 'error',
                      title: 'Hugging Face Backup',
                      message: e?.message || (isEn ? 'Failed to upload videos.' : 'Falha ao enviar vídeos.')
                    });
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 text-xs font-bold border border-purple-500/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                title={t.syncAllToHfTooltip || (isEn ? "Backup selected local videos to Hugging Face" : "Fazer backup dos vídeos locais selecionados para o Hugging Face")}
              >
                <Globe size={13} className="text-purple-400" />
                <span>{t.syncAllToHf || (isEn ? "Backup to HF" : "Backup para HF")} ({selectedLocalPendingHfVideos.length})</span>
              </button>
            )}

            <button
              onClick={() => setIsConfirmingBatchDelete(true)}
              className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-bold border border-rose-500/40 transition-colors flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              <span>{t.batchDelete} ({selectedVideoIds.length})</span>
            </button>

            <button
              onClick={() => {
                clearSelectedVideos();
                setIsSelectionMode(false);
              }}
              className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
              title={t.cancelSelection}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Folders & Navigation Tabs */}
      <div className="relative flex items-center gap-1.5">
        {!wrapFolders && videoFolders.length > 4 && (
          <button
            type="button"
            onClick={() => foldersScrollRef.current?.scrollBy({ left: -280, behavior: 'smooth' })}
            className="shrink-0 p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-white transition-colors shadow-sm cursor-pointer"
            title={isEn ? 'Scroll folders left' : 'Rolar pastas para a esquerda'}
          >
            <ChevronLeft size={15} />
          </button>
        )}

        <div
          ref={foldersScrollRef}
          onWheel={(e) => {
            if (!wrapFolders && foldersScrollRef.current && e.deltaY !== 0) {
              const el = foldersScrollRef.current;
              if (el.scrollWidth > el.clientWidth) {
                e.preventDefault();
                el.scrollLeft += e.deltaY;
              }
            }
          }}
          className={`flex-1 flex items-center gap-2 py-2 ${
            wrapFolders
              ? 'flex-wrap'
              : 'overflow-x-auto overflow-y-visible custom-scrollbar scroll-smooth'
          }`}
        >
        {/* All Videos Tab */}
        <button
          onClick={() => {
            setVideoFilterFavoritesOnly(false);
            setActiveVideoFolder(null);
          }}
          className={`px-3.5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 border ${
            !activeVideoFolder && !videoFilterFavoritesOnly
              ? 'bg-brand-600 text-white border-brand-500 shadow-glow-brand'
              : 'bg-surface/60 hover:bg-surface-hover text-slate-300 border-border'
          }`}
        >
          <Film size={14} />
          <span>{t.tabAll}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black/30">
            {videos.length}
          </span>
        </button>

        {/* Favorites Tab */}
        <button
          onClick={() => {
            setVideoFilterFavoritesOnly(true);
            setActiveVideoFolder(null);
          }}
          className={`px-3.5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 border ${
            videoFilterFavoritesOnly
              ? 'bg-amber-500 text-black border-amber-400 shadow-glow-amber'
              : 'bg-surface/60 hover:bg-surface-hover text-slate-300 border-border'
          }`}
        >
          <Star size={14} className={videoFilterFavoritesOnly ? 'fill-black' : 'text-amber-400'} />
          <span>{t.tabFavs}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black/30">
            {videos.filter(v => v.isFavorite).length}
          </span>
        </button>

        {/* Custom Folder Pills */}
        {videoFolders.map(folder => {
          const isActive = activeVideoFolder === folder.name && !videoFilterFavoritesOnly;
          const isFolderSelected = selectedFolderNames.includes(folder.name);
          const isCustom = folder.name !== 'Geral';

          return (
            <div key={folder.id} className="relative flex items-center">
              {/* Checkbox quando em modo de seleção ou quando selecionado */}
              {isCustom && (isFolderSelectionMode || selectedFolderNames.length > 0) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFolderNames(prev =>
                      prev.includes(folder.name)
                        ? prev.filter(n => n !== folder.name)
                        : [...prev, folder.name]
                    );
                  }}
                  className={`mr-1 p-1 rounded-lg border transition-all ${
                    isFolderSelected
                      ? 'bg-violet-600 text-white border-violet-400'
                      : 'bg-surface hover:bg-surface-elevated text-slate-400 border-border'
                  }`}
                  title={isFolderSelected ? (t.deselectFolder || "Deselect folder") : (t.selectFolder || "Select folder")}
                >
                  {isFolderSelected ? <Check size={12} strokeWidth={3} /> : <Square size={12} />}
                </button>
              )}

              <button
                onClick={() => {
                  if (isFolderSelectionMode || selectedFolderNames.length > 0) {
                    if (isCustom) {
                      setSelectedFolderNames(prev =>
                        prev.includes(folder.name)
                          ? prev.filter(n => n !== folder.name)
                          : [...prev, folder.name]
                      );
                    }
                  } else {
                    setVideoFilterFavoritesOnly(false);
                    setActiveVideoFolder(folder.name);
                  }
                }}
                className={`px-3.5 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border ${
                  isFolderSelected
                    ? 'border-violet-500 ring-2 ring-violet-500/50 bg-violet-950/40 text-white'
                    : isActive
                    ? 'bg-accent-purple text-white border-accent-purple/80 shadow-glow-accent'
                    : 'bg-surface/60 hover:bg-surface-hover text-slate-300 border-border'
                }`}
              >
                <Folder size={14} className={isActive ? 'text-white' : 'text-accent-purple'} />
                <span>{folder.name}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black/30">
                  {folder.videoCount}
                </span>
              </button>

              {/* Folder Actions Menu Trigger */}
              {isCustom && !isFolderSelectionMode && selectedFolderNames.length === 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveFolderMenuName(folder.name);
                  }}
                  className={`ml-1 p-1.5 rounded-xl border transition-colors ${
                    activeFolderMenuName === folder.name
                      ? 'bg-brand-600 text-white border-brand-500'
                      : 'hover:bg-white/10 text-slate-400 hover:text-white border-transparent'
                  }`}
                  title={t.actions || "Folder Actions"}
                >
                  <MoreVertical size={13} />
                </button>
              )}
            </div>
          );
        })}

        {/* Botão para Ativar Seleção Múltipla de Pastas */}
        {videoFolders.filter(f => f.name !== 'Geral').length > 1 && (
          <button
            type="button"
            onClick={() => {
              if (isFolderSelectionMode || selectedFolderNames.length > 0) {
                setIsFolderSelectionMode(false);
                setSelectedFolderNames([]);
              } else {
                setIsFolderSelectionMode(true);
              }
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap flex items-center gap-1.5 ${
              isFolderSelectionMode || selectedFolderNames.length > 0
                ? 'bg-violet-600 text-white border-violet-500'
                : 'bg-surface/40 hover:bg-surface text-slate-400 hover:text-slate-200 border-border'
            }`}
          >
            <CheckSquare size={13} />
            <span>{isFolderSelectionMode || selectedFolderNames.length > 0 ? t.doneFolders : t.manageFolders}</span>
          </button>
        )}

        {/* Botão de Exclusão em Lote de Pastas Selecionadas */}
        {selectedFolderNames.length > 0 && (
          <button
            type="button"
            onClick={() => setIsConfirmingBatchFolderDelete(true)}
            className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 animate-scale-up"
          >
            <Trash2 size={13} />
            <span>{t.deleteSelectedFolders.replace('{count}', String(selectedFolderNames.length))}</span>
          </button>
        )}
        </div>

        {videoFolders.length > 4 && (
          <div className="flex items-center gap-1 shrink-0">
            {!wrapFolders && (
              <button
                type="button"
                onClick={() => foldersScrollRef.current?.scrollBy({ left: 280, behavior: 'smooth' })}
                className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-white transition-colors shadow-sm cursor-pointer"
                title={isEn ? 'Scroll folders right' : 'Rolar pastas para a direita'}
              >
                <ChevronRight size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setWrapFolders(prev => !prev)}
              className={`px-2.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                wrapFolders
                  ? 'bg-violet-600 text-white border-violet-500'
                  : 'bg-surface-elevated hover:bg-surface-hover border-border text-slate-300 hover:text-white'
              }`}
              title={isEn ? (wrapFolders ? 'Single row scroll' : 'Show all folders wrapped') : (wrapFolders ? 'Mostrar em linha única' : 'Expandir todas as pastas')}
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:inline">{wrapFolders ? (isEn ? 'Compact' : 'Compactar') : (isEn ? 'All' : 'Ver Todas')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 glass-panel p-3 rounded-2xl border border-border">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={videoSearchQuery}
            onChange={e => setVideoSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full bg-surface-elevated/70 pl-9 pr-4 py-2 rounded-xl text-xs text-slate-200 placeholder-slate-500 border border-border focus:border-brand-500 outline-none transition-all"
          />
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <ArrowUpDown size={13} />
            <span>{t.sortByLabel}</span>
          </span>
          <div className="flex items-center bg-surface-elevated rounded-xl border border-border p-0.5">
            <button
              onClick={() => setSortBy('date')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                sortBy === 'date' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.sortRecent}
            </button>
            <button
              onClick={() => setSortBy('name')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                sortBy === 'name' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.sortName}
            </button>
            <button
              onClick={() => setSortBy('size')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                sortBy === 'size' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.sortSize}
            </button>
          </div>
        </div>
      </div>

      {/* Origin Filter Bar: Todos vs Do Meu PC vs Da Web vs Hugging Face */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center p-1 rounded-xl bg-surface-elevated border border-border text-xs">
          <button
            type="button"
            onClick={() => setVideoOriginFilter('all')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
              videoOriginFilter === 'all'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.originAll} ({videos.length})
          </button>
          <button
            type="button"
            onClick={() => setVideoOriginFilter('pc')}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              videoOriginFilter === 'pc'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={t.importedFromPcTooltip || "Videos imported from your computer"}
          >
            <HardDrive size={13} />
            <span>{t.originPc} ({videos.filter(v => !isVideoWebOrigin(v)).length})</span>
          </button>
          <button
            type="button"
            onClick={() => setVideoOriginFilter('web')}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              videoOriginFilter === 'web'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={t.webScrapedTooltip || "Videos extracted from Web / Scraper or Streaming"}
          >
            <ExternalLink size={13} />
            <span>{t.originWeb} ({videos.filter(v => isVideoWebOrigin(v)).length})</span>
          </button>
          <button
            type="button"
            onClick={() => setVideoOriginFilter('hf')}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              videoOriginFilter === 'hf'
                ? 'bg-purple-600 text-white shadow-sm ring-1 ring-purple-400/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={t.originHfTooltip || (isEn ? "Videos stored in Hugging Face Hub dataset" : "Vídeos armazenados no dataset do Hugging Face Hub")}
          >
            <Globe size={13} className={videoOriginFilter === 'hf' ? 'text-white' : 'text-purple-400'} />
            <span>{t.originHf || (isEn ? "Hugging Face" : "Nuvem Hugging Face")} ({videos.filter(v => isVideoHuggingFace(v)).length})</span>
          </button>
          {brokenVideosCount > 0 && (
            <button
              type="button"
              onClick={() => setVideoOriginFilter('broken')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                videoOriginFilter === 'broken'
                  ? 'bg-rose-600 text-white shadow-sm ring-1 ring-rose-400/40'
                  : 'text-rose-400 hover:text-rose-300'
              }`}
              title={isEn ? "Videos deleted on source or with expired streams" : "Vídeos excluídos na origem ou com streams expirados"}
            >
              <AlertTriangle size={13} className={videoOriginFilter === 'broken' ? 'text-white' : 'text-rose-400'} />
              <span>{isEn ? "Broken / Deleted" : "Com Problemas"} ({brokenVideosCount})</span>
            </button>
          )}
        </div>

        {videoOriginFilter !== 'all' && (
          <button
            type="button"
            onClick={() => setVideoOriginFilter('all')}
            className="text-xs text-brand-400 hover:text-brand-300 font-medium px-2 py-1"
          >
            {t.clearOriginFilter || (isEn ? "Clear Origin Filter" : "Limpar Filtro de Origem")}
          </button>
        )}
      </div>

      {/* Videos Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center glass-panel rounded-3xl border border-border flex flex-col items-center justify-center space-y-3">
          <div className="p-4 rounded-full bg-surface-elevated text-slate-500 border border-border">
            {videoOriginFilter === 'hf' ? (
              <Globe size={36} className="text-purple-400" />
            ) : (
              <FileVideo size={36} />
            )}
          </div>
          <h3 className="text-base font-bold text-slate-200">
            {videoOriginFilter === 'hf'
              ? (t.noHfVideosFound || (isEn ? "No videos on Hugging Face" : "Nenhum vídeo no Hugging Face"))
              : (t.noVideosFound || "No videos found")}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm">
            {videoFilterFavoritesOnly
              ? (t.noFavVideosDesc || (isEn ? 'You have not favorited any videos yet. Click the star on any video to add it here.' : 'Você ainda não favoritou nenhum vídeo. Clique na estrela de qualquer vídeo para adicioná-lo aqui.'))
              : videoOriginFilter === 'hf'
                ? (t.noHfVideosDesc || (isEn ? 'No videos have been uploaded to your Hugging Face dataset yet. You can backup local videos using the video options menu or sync your cloud dataset in Settings.' : 'Nenhum vídeo foi enviado para o repositório do Hugging Face ainda. Você pode fazer backup de vídeos locais pelo menu de opções do vídeo ou sincronizar seu repositório nas Configurações.'))
                : (t.noVideosDesc || (isEn ? 'Import videos from your computer or add via direct URL to start your gallery.' : 'Importe vídeos do seu computador ou adicione por URL direta para começar sua galeria.'))}
          </p>
          {videoOriginFilter === 'hf' ? (
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => setVideoOriginFilter('all')}
                className="px-4 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-200 text-xs font-bold transition-all"
              >
                <span>{t.viewAllVideosBtn || (isEn ? "View All Videos" : "Ver Todos os Vídeos")}</span>
              </button>
              <button
                type="button"
                onClick={() => navigateToView('settings')}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
              >
                <Globe size={13} />
                <span>{t.hfSettingsBtn || (isEn ? "Hugging Face Settings" : "Configurações do Hugging Face")}</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-glow-brand"
            >
              <Upload size={14} />
              <span>{t.importFirstVideo || "Import First Video"}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {filtered.map(video => {
            const isSelected = selectedVideoIds.includes(video.id);
            const dupKey = getCanonicalMediaFingerprint(video.title, video.sourceUrl || video.url, video.height);
            const isDuplicateVideo = Boolean(dupKey && (duplicateVideoMap.get(dupKey) || 0) > 1);

            return (
              <div
                key={video.id}
                data-video-id={video.id}
                onClick={() => {
                  if (isSelectionMode || selectedVideoIds.length > 0) {
                    toggleSelectVideo(video.id);
                  }
                }}
                className={`group glass-panel rounded-3xl border overflow-hidden transition-all duration-300 flex flex-col justify-between ${
                  highlightedItemId === video.id
                    ? 'ring-4 ring-brand-500 shadow-glow-brand animate-pulse'
                    : ''
                } ${
                  isSelected
                    ? 'border-violet-500 ring-2 ring-violet-500/50 bg-violet-950/20 shadow-glow-brand'
                    : video.streamStatus === 'deleted_on_source'
                    ? 'border-rose-500/60 bg-rose-950/15 hover:border-rose-400'
                    : video.streamStatus === 'expired'
                    ? 'border-amber-500/50 bg-amber-950/15 hover:border-amber-400'
                    : 'border-border hover:border-brand-500/50 hover:shadow-card-elevated'
                }`}
              >
                {/* Video Surface: Inline Player when active, or Thumbnail */}
                {playingVideoIds.includes(video.id) ? (
                  <div
                    className="relative aspect-video bg-black flex items-center justify-center overflow-hidden"
                    onClick={e => e.stopPropagation()}
                  >
                    {(() => {
                      let rawStream = video.streamUrl || '';
                      let unwrapCount = 0;
                      while (rawStream.includes('/api/proxy-video-stream') && rawStream.includes('url=') && unwrapCount < 5) {
                        unwrapCount++;
                        const m = rawStream.match(/[?&]url=([^&]+)/);
                        if (m) rawStream = decodeURIComponent(m[1]);
                        else break;
                      }
                      let defaultRef = '';
                      try {
                        defaultRef = new URL(video.sourceUrl || rawStream).origin;
                      } catch {
                        defaultRef = '';
                      }
                      const effectiveStream = (!rawStream.startsWith('/api/') && rawStream.startsWith('http'))
                        ? `/api/proxy-video-stream?url=${encodeURIComponent(rawStream)}&referer=${encodeURIComponent(video.sourceUrl || defaultRef)}`
                        : rawStream;
                      return (
                        <video
                          src={effectiveStream}
                          controls
                          autoPlay
                          playsInline
                          {...({ 'webkit-playsinline': 'true', 'x5-playsinline': 'true' } as any)}
                          preload="auto"
                          poster={video.thumbnailUrl ? `${video.thumbnailUrl}${video.thumbnailUrl.includes('?') ? '&' : '?'}_k=${thumbRefreshKey}&v=${encodeURIComponent(video.createdAt || 'now')}` : undefined}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            console.warn('VideosView inline error:', e);
                          }}
                        >
                          {t.browserNoVideo || (isEn ? 'Your browser does not support this video.' : 'Seu navegador não suporta este vídeo.')}
                        </video>
                      );
                    })()}
                    {/* Expand Button to Open Modal */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeInlinePlay(video.id);
                        setActivePlayingVideo(video);
                      }}
                      className="absolute top-2 right-10 z-30 p-1.5 rounded-full bg-black/80 text-white hover:bg-white hover:text-black border border-white/30 transition-all shadow-lg"
                      title={t.expandVideo || "Expand Video"}
                    >
                      <Maximize2 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => closeInlinePlay(video.id)}
                      className="absolute top-2 right-2 z-30 p-1.5 rounded-full bg-black/80 text-white hover:bg-white hover:text-black border border-white/30 transition-all shadow-lg"
                      title={t.closePlayer || "Close Player"}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div
                    className="relative aspect-video bg-slate-950 flex items-center justify-center cursor-pointer overflow-hidden group/thumb"
                    onClick={(e) => {
                      if (isSelectionMode || selectedVideoIds.length > 0) {
                        e.stopPropagation();
                        toggleSelectVideo(video.id);
                      } else if (video.streamStatus === 'deleted_on_source') {
                        e.stopPropagation();
                        setDeletedNoticeVideo(video);
                      } else {
                        toggleInlinePlay(video.id);
                      }
                    }}
                  >
                    {/* High-speed Cached Smart Thumbnail Image with Fallback */}
                    <img
                      key={`${video.id}-${thumbRefreshKey}`}
                      src={video.thumbnailUrl ? `${video.thumbnailUrl}${video.thumbnailUrl.includes('?') ? '&' : '?'}_k=${thumbRefreshKey}&v=${encodeURIComponent(video.createdAt || 'now')}` : ''}
                      alt={video.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-500"
                      onLoad={(e) => {
                        e.currentTarget.style.display = 'block';
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'none';
                      }}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                    <div className="hidden w-full h-full absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-3 text-center">
                      <Film size={28} className="text-slate-600 mb-1" />
                      <span className="text-[10px] font-medium text-slate-400 line-clamp-1 max-w-[85%]">{video.title}</span>
                    </div>

                    {/* Central Play Overlay (only when not in selection mode) */}
                    {selectedVideoIds.length === 0 && !isSelectionMode && (
                      <div className="absolute inset-0 bg-black/40 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center">
                        {video.streamStatus === 'deleted_on_source' ? (
                          <div className="p-3 sm:p-3.5 rounded-full bg-rose-600/90 text-white shadow-lg group-hover/thumb:scale-110 transition-transform" title={isEn ? "Video deleted on source website" : "Vídeo excluído no site de origem"}>
                            <AlertTriangle size={20} />
                          </div>
                        ) : (
                          <div className="p-3 sm:p-3.5 rounded-full bg-brand-600/90 text-white shadow-glow-brand group-hover/thumb:scale-110 transition-transform">
                            <Play size={20} className="translate-x-0.5" />
                          </div>
                        )}
                      </div>
                    )}


                  {/* Top-Left Selection Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectVideo(video.id);
                    }}
                    className={`absolute top-2.5 left-2.5 z-20 w-7 h-7 rounded-xl flex items-center justify-center transition-all backdrop-blur-md ${
                      isSelected
                        ? 'bg-violet-600 text-white shadow-glow-brand ring-2 ring-white/50 scale-105'
                        : isSelectionMode || selectedVideoIds.length > 0
                        ? 'bg-black/70 text-white/60 border border-white/40 hover:border-white'
                        : 'opacity-0 group-hover:opacity-100 bg-black/60 text-white/50 border border-white/20 hover:border-white'
                    }`}
                    title={isSelected ? (t.deselectVideo || "Deselect video") : (t.selectVideo || "Select video")}
                  >
                    {isSelected ? <Check size={16} strokeWidth={3} /> : <Square size={13} />}
                  </button>

                  {/* Top Left Folder Tag (Clickable to filter by folder) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveVideoFolder(video.folder);
                    }}
                    className={`absolute top-2.5 px-2 py-0.5 rounded-lg bg-black/70 hover:bg-violet-950/90 hover:border-violet-500/60 cursor-pointer backdrop-blur-md border border-white/10 font-mono text-[9px] font-bold text-accent-purple hover:text-white flex items-center gap-1 transition-all z-20 shadow-sm ${
                      isSelected || isSelectionMode || selectedVideoIds.length > 0 ? 'left-11' : 'left-2.5 group-hover:left-11'
                    }`}
                    title={isEn ? `Filter Gallery by folder "${video.folder}"` : `Filtrar Galeria por pasta "${video.folder}"`}
                  >
                    <Folder size={10} />
                    <span>{video.folder}</span>
                  </button>

                  {/* Duplicate badge if detected */}
                  {isDuplicateVideo && (
                    <span
                      className="absolute top-2.5 right-11 px-2 py-0.5 rounded-lg bg-amber-500/90 text-slate-950 font-bold text-[9px] shadow-sm flex items-center gap-1 backdrop-blur-md"
                      title={isEn ? "Video with same resolution detected as duplicate in gallery" : "Vídeo com mesma resolução detectado como duplicado na galeria"}
                    >
                      <Copy size={10} />
                      <span>{t.duplicateBadge || (isEn ? "Duplicate" : "Duplicado")}</span>
                    </span>
                  )}

                  {/* Top Right Favorite Star */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVideoFavorite(video.id);
                    }}
                    className={`absolute top-2.5 right-2.5 p-1.5 rounded-xl border backdrop-blur-md transition-all ${
                      video.isFavorite
                        ? 'bg-amber-500/30 text-amber-400 border-amber-400/50 shadow-glow-amber'
                        : 'bg-black/60 hover:bg-black/80 text-slate-400 hover:text-white border-white/10'
                    }`}
                    title={video.isFavorite ? (t.removeFavorite || (isEn ? 'Remove from favorites' : 'Remover dos favoritos')) : (t.addFavorite || (isEn ? 'Favorite video' : 'Favoritar vídeo'))}
                  >
                    <Star size={13} className={video.isFavorite ? 'fill-amber-400' : ''} />
                  </button>

                  {/* Bottom Badges: Format, Resolution, Real Size & Storage Origin */}
                  <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[10px] font-mono font-bold text-white">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-emerald-400">
                        {video.format}
                      </span>
                      {(() => {
                        const qInfo = getVideoResolutionLabel(video, video.title, video.filename);
                        if (!qInfo) return null;
                        return (
                          <span className={`px-1.5 py-0.5 rounded border flex items-center gap-1 ${qInfo.badgeClass}`}>
                            {qInfo.label}
                          </span>
                        );
                      })()}
                      {video.streamStatus === 'deleted_on_source' && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-950/90 border border-rose-500/80 text-rose-300 font-bold flex items-center gap-1 shadow-sm" title={isEn ? "Video deleted on source website (DMCA / Copyright removal)" : "Vídeo excluído no site de origem (Removido por DMCA / Direitos)"}>
                          <AlertTriangle size={10} className="text-rose-400" />
                          <span>{isEn ? "Deleted Source" : "Fonte Excluída"}</span>
                        </span>
                      )}
                      {video.streamStatus === 'expired' && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-500/80 text-amber-300 font-bold flex items-center gap-1 shadow-sm" title={isEn ? "Stream URL expired. Try renewing stream." : "Link de stream expirado. Tente renovar stream."}>
                          <AlertCircle size={10} className="text-amber-400" />
                          <span>{isEn ? "Expired Stream" : "Stream Expirado"}</span>
                        </span>
                      )}
                      {isVideoHuggingFace(video) && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-500/40 text-purple-300 flex items-center gap-1" title={t.hfBadgeTooltip || (isEn ? "Stored in Hugging Face Hub cloud" : "Armazenado na Nuvem Gratuita do Hugging Face")}>
                          <Globe size={10} />
                          <span>{t.hfBadgeLabel || (isEn ? "HF Cloud" : "Nuvem HF")}</span>
                        </span>
                      )}
                      {isVideoWebOrigin(video) ? (
                        video.storageLocation === 'stream_url' ? (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 flex items-center gap-1" title={isEn ? "Direct web stream (Zero disk consumed)" : "Stream direto da web (Zero disco consumido)"}>
                            <Link2 size={10} />
                            <span>Web Stream</span>
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-500/40 text-sky-300 flex items-center gap-1" title={isEn ? "Downloaded from Web / Scraper" : "Baixado da Web / Scraper"}>
                            <Globe size={10} />
                            <span>Web / Scraper</span>
                          </span>
                        )
                      ) : (
                        (video.storageLocation === 'local' || !isVideoHuggingFace(video)) && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 flex items-center gap-1" title={isEn ? "Imported from your PC (Upload / Local PC)" : "Importado do seu Computador (Upload / PC Local)"}>
                            <HardDrive size={10} />
                            <span>{t.localPcBadge || (isEn ? "Local PC" : "PC Local")}</span>
                          </span>
                        )
                      )}
                    </div>
                    <span className="px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-slate-300 whitespace-nowrap ml-1">
                      {video.storageLocation === 'stream_url' ? 'Web Stream' : (video.fileSizeBytes > 0 ? formatFileSize(video.fileSizeBytes) : (isEn ? 'Size N/A' : 'Tam. N/D'))}
                    </span>
                  </div>
                </div>
              )}

                {/* Card Footer & Context Menu */}
                <div className="p-3.5 flex items-start justify-between gap-2 relative">
                  <div className="min-w-0 flex-1">
                    <h4
                      onClick={(e) => {
                        if (isSelectionMode || selectedVideoIds.length > 0) {
                          e.stopPropagation();
                          toggleSelectVideo(video.id);
                        } else if (video.streamStatus === 'deleted_on_source') {
                          e.stopPropagation();
                          setDeletedNoticeVideo(video);
                        } else {
                          toggleInlinePlay(video.id);
                        }
                      }}
                      className="font-bold text-xs sm:text-sm text-slate-100 truncate hover:text-brand-300 transition-colors cursor-pointer"
                      title={video.title}
                    >
                      {video.title}
                    </h4>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                      {video.createdAt}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Expand / Maximize Modal Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeInlinePlay(video.id);
                        setActivePlayingVideo(video);
                      }}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-brand-300 transition-colors"
                      title={t.expandVideo || "Expand Video"}
                    >
                      <Maximize2 size={15} />
                    </button>

                    {/* Direct Native New Tab Stream Link */}
                    <a
                      href={video.streamUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-cyan-300 transition-colors"
                      title={t.openNewTab || (isEn ? "Open Video in New Tab (Native Player)" : "Abrir Vídeo em Nova Aba (Player Nativo)")}
                    >
                      <ExternalLink size={15} />
                    </a>

                    {/* 3-dots Menu Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuVideoId(activeMenuVideoId === video.id ? null : video.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
                      title={t.folderActions || (isEn ? "Video options" : "Opções do vídeo")}
                    >
                      <MoreVertical size={15} />
                    </button>
                  </div>

                {/* Dropdown Menu */}
                {activeMenuVideoId === video.id && (
                  <div
                    className="absolute bottom-12 right-3 z-40 bg-slate-900 border border-border rounded-2xl shadow-2xl p-1.5 w-48 flex flex-col gap-0.5 animate-fade-in"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setActivePlayingVideo(video);
                        setActiveMenuVideoId(null);
                      }}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-slate-200 flex items-center gap-2"
                    >
                      <Play size={13} className="text-violet-400" />
                      <span>{isEn ? "Full Player" : "Player Completo"}</span>
                    </button>

                    <button
                      onClick={() => {
                        toggleInlinePlay(video.id);
                        setActiveMenuVideoId(null);
                      }}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-slate-200 flex items-center gap-2"
                    >
                      <Play size={13} className="text-emerald-400" />
                      <span>{isEn ? "Play on Card" : "Reproduzir no Card"}</span>
                    </button>

                    <a
                      href={video.streamUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setActiveMenuVideoId(null)}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-slate-200 flex items-center gap-2"
                    >
                      <ExternalLink size={13} className="text-cyan-400" />
                      <span>{isEn ? "Open in New Tab" : "Abrir em Nova Aba"}</span>
                    </a>

                    {(() => {
                      const matchedAlbum = findMatchingOriginAlbum(video, albums);
                      if (!matchedAlbum) return null;
                      return (
                        <button
                          onClick={() => {
                            setActiveMenuVideoId(null);
                            navigateToView('album-detail', matchedAlbum.id);
                          }}
                          className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-slate-200 flex items-center gap-2"
                          title={isEn ? `Go to matching Album: ${matchedAlbum.title}` : `Ir para o Álbum correspondente: ${matchedAlbum.title}`}
                        >
                          <FolderHeart size={13} className="text-pink-400" />
                          <span>{isEn ? "Go to Source Album" : "Ir para Álbum de Origem"}</span>
                        </button>
                      );
                    })()}

                    <button
                      onClick={() => {
                        setActiveFolderModal({ type: 'move', videoId: video.id });
                        setActiveMenuVideoId(null);
                      }}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-slate-200 flex items-center gap-2"
                    >
                      <FolderInput size={13} className="text-cyan-400" />
                      <span>{isEn ? "Move to Folder..." : "Mover para Pasta..."}</span>
                    </button>

                    <button
                      onClick={() => handleRenamePrompt(video)}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-slate-200 flex items-center gap-2"
                    >
                      <Edit2 size={13} className="text-amber-400" />
                      <span>{t.rename || (isEn ? "Rename" : "Renomear")}</span>
                    </button>

                    {(video.storageLocation === 'stream_url' || video.sourceOrigin === 'web' || Boolean(video.cloudUrl)) && (
                      <button
                        type="button"
                        onClick={async () => {
                          setActiveMenuVideoId(null);
                          await handleRenewSingleStream(video.id);
                        }}
                        className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-violet-300 flex items-center gap-2 cursor-pointer"
                        title={t.renewStreamTooltip || (isEn ? "Renew stream link if expired" : "Renovar link do stream se estiver expirado")}
                      >
                        <RefreshCw size={13} className="text-violet-400" />
                        <span>{t.renewBtn || (isEn ? "Renew Stream" : "Renovar Stream")}</span>
                      </button>
                    )}

                    {video.storageLocation === 'stream_url' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMenuVideoId(null);
                          const targetSource = video.sourceUrl || video.url || video.streamUrl;
                          if (targetSource) {
                            saveExtractedVideoToGallery(targetSource, video.title, video.folder, video.sourceUrl, undefined, false);
                          }
                        }}
                        className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-violet-300 flex items-center gap-2 cursor-pointer"
                        title={t.saveLocalDataTitle}
                      >
                        <HardDrive size={13} className="text-violet-400" />
                        <span>{t.saveLocalData}</span>
                      </button>
                    )}

                    {(() => {
                      let rawDl = video.downloadUrl || video.streamUrl || '';
                      let unwrapCount = 0;
                      while (rawDl.includes('/api/proxy-video-stream') && rawDl.includes('url=') && unwrapCount < 5) {
                        unwrapCount++;
                        const m = rawDl.match(/[?&]url=([^&]+)/);
                        if (m) rawDl = decodeURIComponent(m[1]);
                        else break;
                      }
                      let defaultDlRef = '';
                      try {
                        defaultDlRef = new URL(video.sourceUrl || rawDl).origin;
                      } catch {
                        defaultDlRef = '';
                      }
                      const effectiveDl = (!(video.downloadUrl || '').startsWith('/api/proxy-video-stream') && rawDl.startsWith('http'))
                        ? `/api/proxy-video-stream?url=${encodeURIComponent(rawDl)}&referer=${encodeURIComponent(video.sourceUrl || defaultDlRef)}&download=true&filename=${encodeURIComponent(video.filename)}`
                        : video.downloadUrl;
                      return (
                        <button
                          type="button"
                          onClick={async () => {
                            setActiveMenuVideoId(null);
                            try {
                              addNotification({
                                type: 'info',
                                title: 'Iniciando Download',
                                message: isEn ? `Saving "${video.title || video.filename}" directly to Downloads folder...` : `Salvando "${video.title || video.filename}" diretamente na pasta Downloads...`,
                              });
                              const res = await backendApi.downloadToDisk(effectiveDl || video.streamUrl || '', video.filename, true);
                              if (res && res.success) {
                                addNotification({
                                  type: 'success',
                                  title: isEn ? 'Download Completed' : 'Download Concluído',
                                  message: isEn ? `File saved to Downloads: "${res.filename || video.filename}".` : `Arquivo salvo em Downloads: "${res.filename || video.filename}".`,
                                });
                              }
                            } catch (e) {
                              addNotification({
                                type: 'error',
                                title: isEn ? 'Download Failed' : 'Falha no Download',
                                message: isEn ? 'Could not save video to disk.' : 'Não foi possível salvar o vídeo no disco.',
                              });
                            }
                          }}
                          className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-slate-200 flex items-center gap-2 cursor-pointer"
                        >
                          <Download size={13} className="text-brand-400" />
                          <span>{isEn ? 'Download File' : 'Baixar Arquivo'}</span>
                        </button>
                      );
                    })()}

                    {!isVideoHuggingFace(video) && !isVideoWebOrigin(video) && (
                      <button
                        type="button"
                        onClick={async () => {
                          setActiveMenuVideoId(null);
                          try {
                            addNotification({
                              type: 'info',
                              title: 'Hugging Face Backup',
                              message: (t.backupSingleStarted || (isEn
                                ? 'Starting backup of "{title}" to Hugging Face...'
                                : 'Iniciando backup de "{title}" para o Hugging Face...'))
                                .replace('{title}', video.title || video.filename)
                            });
                            const res = await backendApi.uploadVideoToHf(video.id);
                            if (res && res.success) {
                              addNotification({
                                type: 'success',
                                title: 'Hugging Face Backup',
                                message: res.message || (t.backupBatchQueued || (isEn ? 'Upload started in background.' : 'Upload iniciado em segundo plano.'))
                              });
                            } else {
                              addNotification({
                                type: 'error',
                                title: 'Hugging Face Backup',
                                message: res?.message || (isEn ? 'Failed to upload to Hugging Face.' : 'Falha ao enviar para o Hugging Face.')
                              });
                            }
                          } catch (err: any) {
                            addNotification({
                              type: 'error',
                              title: 'Hugging Face Backup',
                              message: err?.message || (isEn ? 'Failed to upload to Hugging Face.' : 'Falha ao enviar para o Hugging Face.')
                            });
                          }
                        }}
                        className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-purple-300 flex items-center gap-2 cursor-pointer"
                        title={t.backupToHf || (isEn ? "Backup to Hugging Face" : "Fazer Backup no Hugging Face")}
                      >
                        <Globe size={13} className="text-purple-400" />
                        <span>{t.backupToHf || (isEn ? "Backup to Hugging Face" : "Fazer Backup no Hugging Face")}</span>
                      </button>
                    )}

                    {video.cloudUrl && (
                      <a
                        href={video.cloudUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setActiveMenuVideoId(null)}
                        className="w-full px-3 py-1.5 rounded-xl hover:bg-white/10 text-left text-xs text-purple-300 flex items-center gap-2 cursor-pointer"
                        title={t.openInHf || (isEn ? "Open in Hugging Face Hub" : "Abrir no Hugging Face")}
                      >
                        <ExternalLink size={13} className="text-purple-400" />
                        <span>{t.openInHf || (isEn ? "Open in Hugging Face" : "Abrir no Hugging Face")}</span>
                      </a>
                    )}

                    <div className="h-px bg-border my-0.5" />

                    <button
                      onClick={() => handleDeleteConfirm(video)}
                      className="w-full px-3 py-1.5 rounded-xl hover:bg-rose-900/30 text-left text-xs text-rose-300 flex items-center gap-2"
                    >
                      <Trash2 size={13} className="text-rose-400" />
                      <span>{isEn ? 'Delete from Disk' : 'Excluir do Disco'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Add Video by Direct URL Modal */}
      {isUrlModalOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isDownloadingUrl) setIsUrlModalOpen(false);
            }}
          >
            <div className="bg-slate-900 border border-border rounded-3xl w-full max-w-md p-5 sm:p-6 shadow-2xl relative">
              <h3 className="font-bold text-base text-slate-100 mb-1 flex items-center gap-2">
                <Link2 size={18} className="text-cyan-400" />
                <span>{isEn ? "Import Video via URL Link" : "Importar Vídeo por Link URL"}</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {isEn ? "The video will be downloaded directly to the selected folder on your disk." : "O vídeo será baixado diretamente para a pasta selecionada no seu disco."}
              </p>

              <form onSubmit={handleAddUrl} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isEn ? "Direct Video URL (MP4, WebM):" : "URL Direta do Vídeo (MP4, WebM):"}
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://exemplo.com/video.mp4"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    className="w-full bg-surface px-3.5 py-2.5 rounded-xl border border-border focus:border-brand-500 outline-none text-xs text-slate-100"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isEn ? "Title (Optional):" : "Título (Opcional):"}
                  </label>
                  <input
                    type="text"
                    placeholder="Meu Clipe Especial"
                    value={urlTitleInput}
                    onChange={e => setUrlTitleInput(e.target.value)}
                    className="w-full bg-surface px-3.5 py-2.5 rounded-xl border border-border focus:border-brand-500 outline-none text-xs text-slate-100"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    {isEn ? 'Destination Folder:' : 'Pasta de Destino:'}
                  </label>
                  <select
                    value={urlFolderInput}
                    onChange={e => setUrlFolderInput(e.target.value)}
                    className="w-full bg-surface px-3.5 py-2.5 rounded-xl border border-border focus:border-brand-500 outline-none text-xs text-slate-100"
                  >
                    {videoFolders.map(f => (
                      <option key={f.id} value={f.name}>
                        {f.name} ({f.videoCount})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Opção de Modo de Armazenamento */}
                <div className="p-3 rounded-2xl bg-surface-elevated/40 border border-border space-y-2">
                  <label className="text-xs font-bold text-slate-200 block">
                    {t.storageDestLabel}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setUrlStreamOnlyInput(true)}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        urlStreamOnlyInput
                          ? 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300 font-bold'
                          : 'bg-surface border-border text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5"><Link2 size={13} /><span>{t.storageStreamTitle}</span></div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">{t.storageStreamDesc}</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setUrlStreamOnlyInput(false)}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                        !urlStreamOnlyInput
                          ? 'bg-violet-600/20 border-violet-500/60 text-violet-300 font-bold'
                          : 'bg-surface border-border text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5"><HardDrive size={13} /><span>{t.storageLocalTitle}</span></div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">{t.storageLocalDesc}</div>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={isDownloadingUrl}
                    onClick={() => setIsUrlModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-slate-300 text-xs font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isDownloadingUrl || !urlInput.trim()}
                    className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-glow-brand"
                  >
                    {isDownloadingUrl ? (isEn ? 'Downloading...' : 'Baixando...') : (isEn ? 'Download & Save' : 'Baixar e Salvar')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Single Video Delete Confirmation Modal */}
      {videoToDelete && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setVideoToDelete(null)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="mx-auto flex justify-center">
                <IconBadge variant="rose" size="lg">
                  <Trash2 size={24} />
                </IconBadge>
              </div>
              <div>
                <h4 className="font-bold text-base text-white">{t.confirmDeleteTitle}</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {t.confirmDeleteDesc.replace('{title}', videoToDelete.title)}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setVideoToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await deleteVideo(videoToDelete.id);
                    setVideoToDelete(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.delete}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Deleted on Source Platform Notice & Action Modal */}
      {deletedNoticeVideo && (
        <ModalPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deleted-video-dialog-title"
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setDeletedNoticeVideo(null)}
          >
            <div
              className="bg-slate-900 border border-rose-500/50 rounded-3xl p-6 max-w-md w-full text-center space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="mx-auto flex justify-center">
                <IconBadge variant="rose" size="lg">
                  <AlertTriangle size={24} className="text-rose-400" />
                </IconBadge>
              </div>
              <div>
                <h4 id="deleted-video-dialog-title" className="font-bold text-base text-white">
                  {isEn ? "Video Removed on Source Platform" : "Vídeo Removido no Site de Origem"}
                </h4>
                <p className="text-xs text-rose-300/90 font-medium mt-1 truncate max-w-xs mx-auto" title={deletedNoticeVideo.title}>
                  {deletedNoticeVideo.title}
                </p>
                <div className="mt-3 p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-[11px] text-slate-300 text-left space-y-2">
                  <p>
                    {isEn
                      ? "The original hosting platform took down or deleted this video file (typically due to DMCA copyright requests or removal by the original uploader)."
                      : "A plataforma original onde o vídeo estava hospedado removeu este arquivo (normalmente por reivindicação de direitos autorais/DMCA ou exclusão pelo autor original)."}
                  </p>
                  <p className="text-slate-400">
                    {isEn
                      ? "Since the source file no longer exists on the web, it cannot be streamed or downloaded anymore. You can safely send it to Trash."
                      : "Como o arquivo original não existe mais na web, não é possível reproduzi-lo nem baixá-lo. Você pode movê-lo com segurança para a Lixeira."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setDeletedNoticeVideo(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel || (isEn ? "Close" : "Fechar")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const videoToTrash = deletedNoticeVideo;
                    setDeletedNoticeVideo(null);
                    await deleteVideo(videoToTrash.id);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center gap-1.5"
                >
                  <Trash2 size={14} />
                  <span>{isEn ? "Move to Trash" : "Mover para Lixeira"}</span>
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Batch Delete Confirmation Modal */}
      {isConfirmingBatchDelete && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setIsConfirmingBatchDelete(false)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="mx-auto flex justify-center">
                <IconBadge variant="rose" size="lg">
                  <Trash2 size={24} />
                </IconBadge>
              </div>
              <div>
                <h4 className="font-bold text-base text-white">{t.confirmBatchDeleteTitle.replace('{count}', String(selectedVideoIds.length))}</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {t.confirmBatchDeleteDesc.replace('{count}', String(selectedVideoIds.length))}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingBatchDelete(false)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await batchDeleteVideos(selectedVideoIds);
                    setIsConfirmingBatchDelete(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.batchDelete}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Video Rename Modal */}
      {videoToRename && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setVideoToRename(null)}
          >
            <div
              className="bg-slate-900 border border-border rounded-3xl p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <Edit2 size={18} />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white">{t.rename}</h4>
                  <p className="text-xs text-slate-400">
                    {t.renameDesc || (isEn ? "Change display title of file" : "Altere o título de exibição do arquivo")}
                  </p>
                </div>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (videoToRename.newTitle.trim()) {
                    await renameVideo(videoToRename.video.id, videoToRename.newTitle.trim());
                    setVideoToRename(null);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    {t.newTitle || (isEn ? "New Title:" : "Novo Título:")}
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={videoToRename.newTitle}
                    onChange={e => setVideoToRename({ ...videoToRename, newTitle: e.target.value })}
                    placeholder={t.videoTitlePlaceholder || (isEn ? "Video name..." : "Nome do vídeo...")}
                    className="w-full bg-surface border border-border rounded-2xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500 font-medium"
                  />
                </div>

                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setVideoToRename(null)}
                    className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={!videoToRename.newTitle.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-bold shadow-glow-brand transition-all"
                  >
                    {t.confirm}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Folder Action Sheet / Menu (100% imune a overflow em iPhone e PC) */}
      {activeFolderMenuName && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setActiveFolderMenuName(null)}
          >
            <div
              className="bg-slate-900 border border-brand-500/40 rounded-3xl p-5 max-w-xs w-full space-y-3 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2.5 pb-1 border-b border-white/10">
                <div className="p-2 rounded-xl bg-brand-500/20 text-brand-400">
                  <Folder size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-sm text-white truncate">{activeFolderMenuName}</h4>
                  <p className="text-[10px] text-slate-400">
                    {t.folderOptions || (isEn ? "Folder Options" : "Opções da Pasta")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveFolderMenuName(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-1 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const target = activeFolderMenuName;
                    setActiveFolderMenuName(null);
                    setActiveFolderModal({ type: 'rename', folderName: target });
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl hover:bg-white/10 text-left text-xs font-semibold text-slate-200 flex items-center gap-2.5 transition-colors"
                >
                  <Edit2 size={16} className="text-amber-400" />
                  <span>{t.renameFolder}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const target = activeFolderMenuName;
                    setActiveFolderMenuName(null);
                    handleDeleteFolderConfirm(target);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl hover:bg-rose-900/30 text-left text-xs font-semibold text-rose-300 flex items-center gap-2.5 transition-colors"
                >
                  <Trash2 size={16} className="text-rose-400" />
                  <span>{t.deleteFolder}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setActiveFolderMenuName(null)}
                className="w-full py-2 rounded-xl bg-surface hover:bg-surface-elevated text-slate-400 hover:text-white text-xs font-semibold transition-colors mt-2"
              >
                Fechar
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Folder Delete Confirmation Modal */}
      {folderToDelete && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setFolderToDelete(null)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="mx-auto flex justify-center">
                <IconBadge variant="rose" size="lg">
                  <Trash2 size={24} />
                </IconBadge>
              </div>
              <div>
                <h4 className="font-bold text-base text-white">{t.confirmDeleteFolderTitle}</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {t.confirmDeleteFolderDesc.replace('{folder}', folderToDelete)}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setFolderToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await deleteVideoFolder(folderToDelete);
                    setFolderToDelete(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.deleteFolder}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Batch Folder Delete Confirmation Modal */}
      {isConfirmingBatchFolderDelete && selectedFolderNames.length > 0 && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setIsConfirmingBatchFolderDelete(false)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="mx-auto flex justify-center">
                <IconBadge variant="rose" size="lg">
                  <Trash2 size={24} />
                </IconBadge>
              </div>
              <div>
                <h4 className="font-bold text-base text-white">
                  {t.deleteSelectedFolders.replace('{count}', String(selectedFolderNames.length))}?
                </h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {(t.confirmBatchDeleteFolders || 'Deseja excluir as seguintes pastas: {folders}? Todos os vídeos serão transferidos com segurança para Geral.').replace('{folders}', selectedFolderNames.join(', '))}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingBatchFolderDelete(false)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    for (const fName of selectedFolderNames) {
                      await deleteVideoFolder(fName);
                    }
                    setSelectedFolderNames([]);
                    setIsFolderSelectionMode(false);
                    setIsConfirmingBatchFolderDelete(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.deleteFolder}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Real-time Streaming Upload Progress Card */}
      {uploadProgress && uploadProgress.isUploading && (
        <ModalPortal>
          <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 p-4 rounded-3xl bg-slate-900/95 border border-brand-500/50 shadow-2xl backdrop-blur-xl animate-fade-in flex flex-col gap-2.5 select-none">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-brand-500/20 text-brand-400">
                  <RefreshCw size={16} className="animate-spin" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-white truncate" title={uploadProgress.filename}>
                    {uploadProgress.filename}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {uploadProgress.totalFiles > 1 ? `Arquivo ${uploadProgress.currentFileIndex} de ${uploadProgress.totalFiles} • ` : ''}
                    {formatFileSize(uploadProgress.loaded)} de {formatFileSize(uploadProgress.total)}
                  </p>
                </div>
              </div>
              <span className="font-mono font-bold text-sm text-brand-400 shrink-0">
                {uploadProgress.percent}%
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-brand-500 via-indigo-500 to-cyan-400 h-2 rounded-full transition-all duration-150"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>

            {/* Speed & ETA */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span className="flex items-center gap-1 text-emerald-400">
                <Zap size={11} />
                <span>{((uploadProgress.speed || 0) / (1024 * 1024)).toFixed(1)} MB/s</span>
              </span>
              <span>
                {uploadProgress.speed > 0
                  ? `~${Math.max(1, Math.ceil((uploadProgress.total - uploadProgress.loaded) / uploadProgress.speed))}s restantes`
                  : 'Calculando...'}
              </span>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Import Local Path / Directory Modal */}
      {isLocalImportModalOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isImportingLocal) setIsLocalImportModalOpen(false);
            }}
          >
            <div className="bg-slate-900 border border-border rounded-3xl w-full max-w-md p-5 sm:p-6 shadow-2xl relative">
              <h3 className="font-bold text-base text-slate-100 mb-1 flex items-center gap-2">
                <Zap size={18} className="text-emerald-400" />
                <span>{t.importPc || (isEn ? 'Instant Import from PC' : 'Importação Instantânea do PC')}</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {isEn ? (
                  <>Paste the path to a video file (e.g. <code className="bg-surface px-1 text-slate-300">C:\Users\...\video.mp4</code>) or an entire folder. It will be imported in milliseconds without network transfer delay.</>
                ) : (
                  <>Cole o caminho de um arquivo de vídeo (ex: <code className="bg-surface px-1 text-slate-300">C:\Users\...\video.mp4</code>) ou de uma pasta inteira. O arquivo será importado em milissegundos sem demora de rede.</>
                )}
              </p>

              <form onSubmit={handleImportLocalSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {isEn ? 'Computer Path (File or Folder):' : 'Caminho no Computador (Arquivo ou Pasta):'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={isEn ? "Ex: C:\\Users\\user\\Videos\\myvideo.mp4 or D:\\Movies" : "Ex: C:\\Users\\jardi\\Videos\\meuvideo.mp4 ou D:\\Filmes"}
                    value={localPathInput}
                    onChange={(e) => setLocalPathInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-border text-slate-100 text-xs focus:border-emerald-500 focus:outline-none"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      {isEn ? 'Destination Folder:' : 'Pasta de Destino:'}
                    </label>
                    <select
                      value={localImportFolder}
                      onChange={(e) => setLocalImportFolder(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-slate-100 text-xs focus:border-emerald-500 focus:outline-none"
                    >
                      {videoFolders.map(f => (
                        <option key={f.name} value={f.name}>{f.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      {isEn ? 'Operation Mode:' : 'Modo de Operação:'}
                    </label>
                    <select
                      value={localImportMode}
                      onChange={(e) => setLocalImportMode(e.target.value as 'copy' | 'move')}
                      className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-slate-100 text-xs focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="copy">{isEn ? "Copy (Keep original)" : "Copiar (Mantém original)"}</option>
                      <option value="move">{isEn ? "Move (Zero copy / 0s)" : "Mover (Zero cópia / 0s)"}</option>
                    </select>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-start gap-2">
                  <HardDrive size={14} className="shrink-0 mt-0.5" />
                  <span>
                    <strong>{isEn ? "Ultra Fast:" : "Super Rápido:"}</strong> {isEn ? "Importing directly from disk bypasses browser uploads, saving 100% of network transfer time." : "Ao importar direto do disco, o sistema não precisa transferir os dados pelo navegador, economizando 100% do tempo de envio."}
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={isImportingLocal}
                    onClick={() => setIsLocalImportModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-slate-300 text-xs font-semibold transition-colors"
                  >
                    {t.cancel || (isEn ? "Cancel" : "Cancelar")}
                  </button>
                  <button
                    type="submit"
                    disabled={isImportingLocal || !localPathInput.trim()}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-glow-emerald flex items-center gap-1.5"
                  >
                    {isImportingLocal ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>{isEn ? "Processing..." : "Processando..."}</span>
                      </>
                    ) : (
                      <>
                        <Zap size={14} />
                        <span>{isEn ? "Import Immediately" : "Importar Imediatamente"}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-brand-950/80 backdrop-blur-md border-4 border-dashed border-brand-400 flex flex-col items-center justify-center p-6 animate-fade-in pointer-events-none">
            <div className="p-6 rounded-3xl bg-slate-900 border border-brand-500/50 shadow-2xl flex flex-col items-center text-center max-w-sm">
              <Upload size={48} className="text-brand-400 animate-bounce mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">{isEn ? "Drop your videos here" : "Solte seus vídeos aqui"}</h3>
              <p className="text-xs text-slate-400">
                Os arquivos serão importados com streaming acelerado para a pasta{' '}
                <strong className="text-brand-300">{activeVideoFolder || 'Geral'}</strong>
              </p>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
