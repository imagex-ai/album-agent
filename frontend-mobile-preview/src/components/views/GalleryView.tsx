import { useShallow } from 'zustand/react/shallow';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LayoutGrid,
  Cloud,
  Compass,
  FolderHeart,
  Folder,
  FolderPlus,
  MoreVertical,
  Edit2,
  Search,
  Download,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,

  ChevronRight,
  Layers,
  Sparkles,
  Grid,
  List,
  LayoutList as LayoutListIcon,
  CheckSquare,
  Check,
  Square,
  X,
  Image as ImageIcon,
  Video as VideoIcon,
  HardDrive,
  Globe,
  Copy,
  Clapperboard,
  Calendar,
  Clock,
  Heart,
  Flame,
  RefreshCw
} from 'lucide-react';
import { useAppStore, getCanonicalMediaFingerprint } from '../../store/useAppStore';
import { GalleryViewMode, Album } from '../../types';
import { translations } from '../../i18n/translations';
import { matchesPaletteFuzzy, CHROMATIC_PALETTE_COLORS, colorPaletteCache } from '../../services/colorExtractor';
import { formatFileSize } from '../../utils/formatters';
import { getAlbumMediaSummary, hasAlbumVideoTransport, matchesAlbumMediaFilter } from '../../utils/mediaClassification';
import { IconBadge } from '../common/IconBadge';
import { ColorFilterPopover } from '../common/ColorFilterPopover';
import { ModalPortal } from '../common/ModalPortal';
import { StableVirtualTable, VirtualCollection } from '../common/VirtualCollection';

export const GalleryView: React.FC = () => {
  const {
    albums,
    albumFolders,
    syncAlbums,
    syncAlbumFolders,
    activeAlbumFolder,
    setActiveAlbumFolder,
    activeAlbumFolderModal,
    setActiveAlbumFolderModal,
    createAlbumFolder,
    renameAlbumFolder,
    deleteAlbumFolder,
    moveAlbumsToFolder,
    galleryViewMode,
    setGalleryViewMode,
    gallerySearchQuery,
    setGallerySearchQuery,
    galleryColorFilter,
    setGalleryColorFilter,
    galleryTagFilter,
    setGalleryTagFilter,
    gallerySortBy,
    setGallerySortBy,
    gallerySortOrder,
    toggleGallerySortOrder,
    selectedAlbumIds,
    toggleSelectAlbum,
    selectAllAlbums,
    clearSelectedAlbums,
    toggleFavoriteAlbum,
    navigateToView,
    deleteAlbum,
    updateAlbum,
    openExportModal,
    openLightbox,
    setSlideshowOpen,
    setGlobalSliderConfig,
    settings,
    highlightedItemId,
    isRenewingBatchStreams,
    batchRenewProgress,
    refreshBatchAlbumStreams
  } = useAppStore(useShallow(state => ({
    albums: state.albums,
    albumFolders: state.albumFolders,
    syncAlbums: state.syncAlbums,
    syncAlbumFolders: state.syncAlbumFolders,
    activeAlbumFolder: state.activeAlbumFolder,
    setActiveAlbumFolder: state.setActiveAlbumFolder,
    activeAlbumFolderModal: state.activeAlbumFolderModal,
    setActiveAlbumFolderModal: state.setActiveAlbumFolderModal,
    createAlbumFolder: state.createAlbumFolder,
    renameAlbumFolder: state.renameAlbumFolder,
    deleteAlbumFolder: state.deleteAlbumFolder,
    moveAlbumsToFolder: state.moveAlbumsToFolder,
    galleryViewMode: state.galleryViewMode,
    setGalleryViewMode: state.setGalleryViewMode,
    gallerySearchQuery: state.gallerySearchQuery,
    setGallerySearchQuery: state.setGallerySearchQuery,
    galleryColorFilter: state.galleryColorFilter,
    setGalleryColorFilter: state.setGalleryColorFilter,
    galleryTagFilter: state.galleryTagFilter,
    setGalleryTagFilter: state.setGalleryTagFilter,
    gallerySortBy: state.gallerySortBy,
    setGallerySortBy: state.setGallerySortBy,
    gallerySortOrder: state.gallerySortOrder,
    toggleGallerySortOrder: state.toggleGallerySortOrder,
    selectedAlbumIds: state.selectedAlbumIds,
    toggleSelectAlbum: state.toggleSelectAlbum,
    selectAllAlbums: state.selectAllAlbums,
    clearSelectedAlbums: state.clearSelectedAlbums,
    toggleFavoriteAlbum: state.toggleFavoriteAlbum,
    navigateToView: state.navigateToView,
    deleteAlbum: state.deleteAlbum,
    updateAlbum: state.updateAlbum,
    openExportModal: state.openExportModal,
    openLightbox: state.openLightbox,
    setSlideshowOpen: state.setSlideshowOpen,
    setGlobalSliderConfig: state.setGlobalSliderConfig,
    settings: state.settings,
    highlightedItemId: state.highlightedItemId,
    isRenewingBatchStreams: state.isRenewingBatchStreams,
    batchRenewProgress: state.batchRenewProgress,
    refreshBatchAlbumStreams: state.refreshBatchAlbumStreams,
  })));
  const isEn = settings?.language === 'en-US';

  const t: any = translations[settings.language].gallery || {};
  const tGlobalSlider: any = translations[settings.language].globalSlider || {};
  const uploadPhotoAlbum = useAppStore(state => state.uploadPhotoAlbum);

  // Sync albums and folders on mount
  useEffect(() => {
    syncAlbums(false);
    syncAlbumFolders();
  }, [syncAlbums, syncAlbumFolders]);

  // Scroll to highlighted item if coming from redirect badge
  useEffect(() => {
    if (highlightedItemId) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-album-id="${highlightedItemId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [highlightedItemId]);


  const [localDomainFilter, setLocalDomainFilter] = useState<string>('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'photo' | 'video' | 'gif'>('all');
  const [originFilter, setOriginFilter] = useState<'all' | 'local' | 'remote'>('all');

  // Detect duplicate albums
  const duplicateAlbumMap = React.useMemo(() => {
    const counts = new Map<string, number>();
    albums.forEach(a => {
      const key = getCanonicalMediaFingerprint(a.title, a.sourceUrl);
      if (key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    return counts;
  }, [albums]);

  // Manual Photo Album Upload States
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadFolder, setUploadFolder] = useState<string>('Geral');
  const [uploadCustomFolder, setUploadCustomFolder] = useState<string>('');
  const [isUploadingAlbum, setIsUploadingAlbum] = useState(false);
  const [albumToDelete, setAlbumToDelete] = useState<{ id: string; title: string } | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isConfirmingBatchDelete, setIsConfirmingBatchDelete] = useState(false);

  // Album Folders UI States
  const [activeFolderMenuName, setActiveFolderMenuName] = useState<string | null>(null);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [targetMoveFolder, setTargetMoveFolder] = useState('Geral');
  const foldersScrollRef = useRef<HTMLDivElement | null>(null);
  const [wrapFolders, setWrapFolders] = useState<boolean>(false);

  // Ultra-fast memoized filter & sort (Zero re-renders on scroll / 60 FPS guarantee)
  const filtered = useMemo(() => {
    const q = gallerySearchQuery.trim().toLowerCase();
    const result = albums.filter(album => {
      if (q) {
        const matchesTitle = album.title.toLowerCase().includes(q);
        const matchesDomain = album.sourceDomain.toLowerCase().includes(q);
        const matchesTag = album.tags.some(tag => tag.toLowerCase().includes(q));
        if (!matchesTitle && !matchesDomain && !matchesTag) return false;
      }

      if (galleryTagFilter && !album.tags.includes(galleryTagFilter)) return false;
      if (localDomainFilter && album.sourceDomain !== localDomainFilter) return false;

      if (!matchesAlbumMediaFilter(album, mediaTypeFilter)) return false;

      const isLocal = album.sourceOrigin === 'local' ||
        album.sourceDomain === 'Upload Local' ||
        album.sourceUrl.startsWith('local://') ||
        album.id.startsWith('manual-') ||
        album.id.startsWith('local-');

      if (originFilter === 'local' && !isLocal) return false;
      if (originFilter === 'remote' && isLocal) return false;

      if (galleryColorFilter) {
        const pal = album.coverColorPalette || [];
        if (!matchesPaletteFuzzy(pal, galleryColorFilter)) return false;
      }

      if (activeAlbumFolder && (album.folder || 'Geral') !== activeAlbumFolder) return false;

      return true;
    });

    const parseTime = (dateStr?: string) => {
      if (!dateStr) return 0;
      const parsed = new Date(dateStr).getTime();
      if (!isNaN(parsed) && parsed > 0) return parsed;
      const clean = dateStr.replace(' UTC', 'Z').replace(' ', 'T');
      const fallback = new Date(clean).getTime();
      return !isNaN(fallback) ? fallback : 0;
    };

    result.sort((a, b) => {
      let cmp = 0;
      if (gallerySortBy === 'name') {
        cmp = a.title.localeCompare(b.title);
      } else if (gallerySortBy === 'count') {
        cmp = a.imageCount - b.imageCount;
      } else if (gallerySortBy === 'size') {
        cmp = a.totalSizeBytes - b.totalSizeBytes;
      } else if (gallerySortBy === 'favorites') {
        const favA = a.isFavorite ? 1 : 0;
        const favB = b.isFavorite ? 1 : 0;
        cmp = favA - favB;
        if (cmp === 0) {
          const timeA = parseTime(a.createdAt) || parseTime(a.updatedAt);
          const timeB = parseTime(b.createdAt) || parseTime(b.updatedAt);
          cmp = timeA - timeB;
        }
      } else if (gallerySortBy === 'modified') {
        const timeA = parseTime(a.updatedAt) || parseTime(a.createdAt);
        const timeB = parseTime(b.updatedAt) || parseTime(b.createdAt);
        cmp = timeA - timeB;
      } else {
        const timeA = parseTime(a.createdAt) || parseTime(a.updatedAt);
        const timeB = parseTime(b.createdAt) || parseTime(b.updatedAt);
        cmp = timeA - timeB;
      }

      if (cmp === 0) {
        cmp = (a.id || '').localeCompare(b.id || '');
      }

      return gallerySortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [albums, gallerySearchQuery, galleryTagFilter, localDomainFilter, mediaTypeFilter, originFilter, galleryColorFilter, activeAlbumFolder, gallerySortBy, gallerySortOrder]);

  const allTags = useMemo<string[]>(() => {
    return Array.from(new Set(albums.flatMap(a => a.tags))).filter(Boolean).sort();
  }, [albums]);

  const allDomains = useMemo<string[]>(() => {
    return Array.from(new Set(albums.map(a => a.sourceDomain))).filter(Boolean).sort();
  }, [albums]);
  const paletteColors = ['#facc15', '#dc2626', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6'];

  // Stream renewal follows the transport, including MP4 animations categorized as GIFs.
  const isAlbumWithVideos = (album: Album) => {
    return hasAlbumVideoTransport(album);
  };

  // Botão de Renovar Streams: visível quando o filtro de vídeo está ativo ou quando uma pasta com vídeos está selecionada
  const showRenewStreamsBtn = mediaTypeFilter === 'video' || (Boolean(activeAlbumFolder) && filtered.some(isAlbumWithVideos));

  const videoAlbumsInList = useMemo(() => {
    return mediaTypeFilter === 'video' ? filtered : filtered.filter(isAlbumWithVideos);
  }, [filtered, mediaTypeFilter]);

  const handleRenewAllListStreams = async (targetIds?: string[]) => {
    let ids: string[];
    if (targetIds && targetIds.length > 0) {
      ids = targetIds;
    } else {
      ids = videoAlbumsInList.map(a => a.id);
    }
    if (!ids.length || isRenewingBatchStreams) return;
    await refreshBatchAlbumStreams(ids);
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full">

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2.5">
            <IconBadge variant="neon" size="md">
              <FolderHeart size={18} />
            </IconBadge>
            <span>{t.title}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {filtered.length === albums.length
              ? t.originalsOnDisk
                  .replace('{count}', String(albums.length))
                  .replace('{albums}', t.totalAlbums)
                  .replace('{images}', String(albums.reduce((acc, a) => acc + a.imageCount, 0)))
                  .replace('{totalImages}', t.totalImages)
              : t.showingCount
                  .replace('{count}', String(filtered.length))
                  .replace('{total}', String(albums.length))
                  .replace('{albums}', t.totalAlbums)
                  .replace('{items}', String(filtered.reduce((acc, a) => acc + a.imageCount, 0)))
            }
          </p>
        </div>

        {/* Action Buttons: Global Slider, Shorts, Batch, Select Mode or Upload New Album */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Botão Slider Global de Dopamina (Todas as Fotos & GIFs) */}
          <button
            type="button"
            onClick={() => {
              if (activeAlbumFolder) {
                setGlobalSliderConfig({
                  scope: 'all_app',
                  sequenceMode: 'folder',
                  selectedFolder: activeAlbumFolder,
                });
              } else {
                setGlobalSliderConfig({
                  scope: 'all_app',
                });
              }
              setSlideshowOpen(true, 0, 'global');
            }}
            className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-gradient-to-r from-brand-600 to-fuchsia-600 hover:from-brand-500 hover:to-fuchsia-500 text-white shadow-glow-brand transition-all cursor-pointer"
          >
            <Sparkles size={14} className="text-amber-200" />
            <span>{tGlobalSlider.launchButton || 'Slider Global (App Todo)'}</span>
          </button>

          {/* Botão Shorts & Reels */}
          <button
            type="button"
            onClick={() => navigateToView('shorts')}
            className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 transition-all cursor-pointer"
          >
            <Flame size={14} className="text-rose-400" />
            <span>Shorts</span>
          </button>

          {/* Botão Renovar Streams (quando vídeos e pasta selecionados ou modo vídeo ativo) */}
          {showRenewStreamsBtn && videoAlbumsInList.length > 0 && (
            <button
              type="button"
              onClick={() => handleRenewAllListStreams()}
              disabled={isRenewingBatchStreams || videoAlbumsInList.length === 0}
              className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title={
                activeAlbumFolder
                  ? (isEn
                      ? `Renew video stream links for all ${videoAlbumsInList.length} albums in folder "${activeAlbumFolder}"`
                      : `Renovar links de stream dos vídeos de todos os ${videoAlbumsInList.length} álbuns da pasta "${activeAlbumFolder}"`)
                  : (isEn
                      ? `Renew video stream links for all ${videoAlbumsInList.length} video albums in the list`
                      : `Renovar links de stream dos vídeos de todos os ${videoAlbumsInList.length} álbuns da lista`)
              }
            >
              <RefreshCw size={14} className={isRenewingBatchStreams ? 'animate-spin text-violet-400' : 'text-violet-400'} />
              <span className="hidden sm:inline">
                {isRenewingBatchStreams
                  ? (batchRenewProgress
                      ? `${isEn ? 'Renewing' : 'Renovando'} (${batchRenewProgress.current}/${batchRenewProgress.total})...`
                      : (isEn ? 'Renewing...' : 'Renovando...'))
                  : (t.renewStreams || (isEn ? 'Renew Streams' : 'Renovar Streams'))}
              </span>
              <span className="sm:hidden">
                {isRenewingBatchStreams
                  ? (batchRenewProgress ? `${batchRenewProgress.current}/${batchRenewProgress.total}` : (isEn ? 'Renewing...' : 'Renovando...'))
                  : (isEn ? 'Renew' : 'Renovar')}
              </span>
              {!isRenewingBatchStreams && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-violet-950/60 text-violet-300 border border-violet-500/30">
                  {videoAlbumsInList.length}
                </span>
              )}
            </button>
          )}

          {/* Botão de Modo Seleção */}
          <button
            type="button"
            onClick={() => {
              if (isSelectionMode) {
                setIsSelectionMode(false);
                clearSelectedAlbums();
              } else {
                setIsSelectionMode(true);
              }
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border ${
              isSelectionMode || selectedAlbumIds.length > 0
                ? 'bg-violet-600 text-white border-violet-500 shadow-glow-brand'
                : 'bg-surface-elevated hover:bg-surface-hover border-border text-slate-200'
            }`}
          >
            <CheckSquare size={15} className={isSelectionMode || selectedAlbumIds.length > 0 ? 'text-white' : 'text-violet-400'} />
            <span>{isSelectionMode || selectedAlbumIds.length > 0 ? t.done : t.select}</span>
          </button>

          {/* Botão Selecionar Todos / Desmarcar quando em modo seleção */}
          {(isSelectionMode || selectedAlbumIds.length > 0) && (
            <button
              type="button"
              onClick={() => {
                if (selectedAlbumIds.length === filtered.length) {
                  clearSelectedAlbums();
                } else {
                  selectAllAlbums(filtered.map(a => a.id));
                }
              }}
              className="px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span>{selectedAlbumIds.length === filtered.length ? t.deselectAll : t.selectAll}</span>
            </button>
          )}

          {selectedAlbumIds.length > 0 && (
            <div className="flex items-center gap-2 animate-scale-up">
              <button
                onClick={() => openExportModal(albums.find(a => a.id === selectedAlbumIds[0]) || albums[0])}
                className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-glow-brand transition-all"
              >
                <Download size={13} />
                <span>{t.batchZip} ({selectedAlbumIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargetMoveFolder('Geral');
                  setActiveAlbumFolderModal({ type: 'move', albumIds: selectedAlbumIds });
                }}
                className="px-3.5 py-2 rounded-xl bg-violet-600/20 border border-violet-500/40 hover:bg-violet-600/30 text-violet-300 text-xs font-bold flex items-center gap-1.5 transition-all"
                title={t.moveAlbumsTitle || "Move selected albums to a folder"}
              >
                <Folder size={13} />
                <span>{t.move} ({selectedAlbumIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => handleRenewAllListStreams(selectedAlbumIds)}
                disabled={isRenewingBatchStreams}
                className="px-3.5 py-2 rounded-xl bg-violet-600/20 border border-violet-500/40 hover:bg-violet-600/30 text-violet-300 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                title={isEn ? "Renew stream links for selected albums" : "Renovar links de stream dos álbuns selecionados"}
              >
                <RefreshCw size={13} className={isRenewingBatchStreams ? 'animate-spin text-violet-400' : 'text-violet-400'} />
                <span>{isRenewingBatchStreams ? (isEn ? 'Renewing...' : 'Renovando...') : (t.renewStreams || (isEn ? 'Renew Streams' : 'Renovar Streams'))} ({selectedAlbumIds.length})</span>
              </button>
              <button
                onClick={() => setIsConfirmingBatchDelete(true)}
                className="px-3.5 py-2 rounded-xl bg-rose-600/20 border border-rose-500/40 hover:bg-rose-600/30 text-rose-300 text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <Trash2 size={13} />
                <span>{t.batchDelete} ({selectedAlbumIds.length})</span>
              </button>
            </div>
          )}

          {/* Botão Novo Álbum */}
          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-glow-brand transition-all"
          >
            <FolderPlus size={15} />
            <span>{t.newAlbum}</span>
          </button>
        </div>
      </div>

      {/* Album Folders Navigation Bar */}
      <div className="relative flex items-center gap-1.5">
        {!wrapFolders && albumFolders.length > 4 && (
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
          className={`flex-1 flex items-center gap-2 py-1.5 ${
            wrapFolders
              ? 'flex-wrap'
              : 'overflow-x-auto overflow-y-visible custom-scrollbar scroll-smooth'
          }`}
        >
        {/* All Albums Folder */}
        <button
          type="button"
          onClick={() => setActiveAlbumFolder(null)}
          className={`px-3.5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 border ${
            !activeAlbumFolder
              ? 'bg-brand-600 text-white border-brand-500 shadow-glow-brand'
              : 'bg-surface/60 hover:bg-surface-hover text-slate-300 border-border'
          }`}
        >
          <Folder size={14} />
          <span>{t.allFolders}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black/30">
            {albums.length}
          </span>
        </button>

        {/* Dynamic Folders */}
        {albumFolders.map(folder => {
          const isActive = activeAlbumFolder === folder.name;
          const isCustom = folder.name !== 'Geral';

          return (
            <div key={folder.id} className="relative flex items-center group">
              <button
                type="button"
                onClick={() => setActiveAlbumFolder(folder.name)}
                className={`px-3.5 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border ${
                  isActive
                    ? 'bg-purple-600 text-white border-purple-500 shadow-glow-accent'
                    : 'bg-surface/60 hover:bg-surface-hover text-slate-300 border-border'
                }`}
              >
                <Folder size={14} className={isActive ? 'text-white' : 'text-purple-400'} />
                <span>{folder.name}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black/30">
                  {folder.count}
                </span>
              </button>

              {/* Folder Actions Menu Trigger for Custom Folders */}
              {isCustom && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveFolderMenuName(activeFolderMenuName === folder.name ? null : folder.name);
                    }}
                    className={`ml-1 p-1.5 rounded-xl border transition-colors ${
                      activeFolderMenuName === folder.name
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'opacity-0 group-hover:opacity-100 hover:bg-white/10 text-slate-400 hover:text-white border-transparent'
                    }`}
                    title={t.folderActions}
                  >
                    <MoreVertical size={13} />
                  </button>

                  {/* Dropdown Menu */}
                  {activeFolderMenuName === folder.name && (
                    <div
                      className="absolute left-0 mt-2 w-44 rounded-2xl bg-slate-900 border border-border shadow-2xl p-1.5 z-50 animate-scale-up"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setFolderNameInput(folder.name);
                          setActiveAlbumFolderModal({ type: 'rename', folderName: folder.name });
                          setActiveFolderMenuName(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 rounded-xl flex items-center gap-2"
                      >
                        <Edit2 size={13} className="text-brand-400" />
                        <span>{t.renameFolder}</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.confirm(t.deleteFolderConfirm ? t.deleteFolderConfirm.replace('{folder}', folder.name) : `Tem certeza que deseja excluir a pasta "${folder.name}"? Os álbuns dentro dela serão mantidos e movidos para "Geral".`)) {
                            await deleteAlbumFolder(folder.name);
                          }
                          setActiveFolderMenuName(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 rounded-xl flex items-center gap-2"
                      >
                        <Trash2 size={13} />
                        <span>{t.deleteFolder}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* New Folder Button */}
        <button
          type="button"
          onClick={() => {
            setFolderNameInput('');
            setActiveAlbumFolderModal({ type: 'create' });
          }}
          className="px-3.5 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 bg-surface/40 hover:bg-surface-elevated text-purple-300 border border-purple-500/30 hover:border-purple-500"
          title={t.createFolderTitle || "Create new folder to organize albums"}
        >
          <FolderPlus size={14} />
          <span>{t.createFolder || "+ New Folder"}</span>
        </button>
        </div>

        {albumFolders.length > 4 && (
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

      {/* Search & Explorer Toolbar */}
      <div className="relative z-20 glass-panel p-3 sm:p-4 rounded-2xl border border-border space-y-3">
        <div className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-center justify-between">
          {/* Search Box */}
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={gallerySearchQuery}
              onChange={e => setGallerySearchQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-surface-elevated border border-border text-slate-100 placeholder-slate-500 text-xs outline-none focus:border-brand-500"
            />
          </div>

          {/* Explicit Dropdowns for Filters */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap min-w-0">
            <select
              value={localDomainFilter}
              onChange={e => setLocalDomainFilter(e.target.value)}
              className="h-10 px-3 rounded-xl bg-surface-elevated border border-border text-slate-200 text-xs outline-none focus:border-brand-500 max-w-[140px] sm:max-w-none truncate"
            >
              <option value="">{t.allWebsites || 'Todos os Websites'}</option>
              {allDomains.map((d: string) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            
            <select
              value={galleryTagFilter || ''}
              onChange={e => setGalleryTagFilter(e.target.value || null)}
              className="h-10 px-3 rounded-xl bg-surface-elevated border border-border text-slate-200 text-xs outline-none focus:border-brand-500 max-w-[140px] sm:max-w-none truncate"
            >
              <option value="">{t.artistsTags || 'Artistas / Tags'}</option>
              {allTags.map((tag: string) => (
                <option key={tag} value={tag}>#{tag}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Filters: Media Type & Storage Origin */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="flex flex-wrap items-center gap-2">
            {/* Filter: Tipo de Mídia (Fotos vs Vídeos) - Estilo 2/3 Micro-Squircle Duotone */}
            <div className="flex items-center p-1 rounded-xl bg-surface-elevated border border-border text-xs">
              <button
                type="button"
                onClick={() => setMediaTypeFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  mediaTypeFilter === 'all'
                    ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${mediaTypeFilter === 'all' ? 'bg-white/20 text-white' : 'bg-brand-500/15 text-brand-400'}`}>
                  <Layers size={11} />
                </div>
                <span>{t.mediaAll || 'Todos'} ({albums.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setMediaTypeFilter('photo')}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  mediaTypeFilter === 'photo'
                    ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${mediaTypeFilter === 'photo' ? 'bg-white/20 text-white' : 'bg-emerald-500/15 text-emerald-400'}`}>
                  <ImageIcon size={11} />
                </div>
                <span>{t.mediaPhotos || "Photo Albums"} ({albums.filter(a => matchesAlbumMediaFilter(a, 'photo')).length})</span>
              </button>
              <button
                type="button"
                onClick={() => setMediaTypeFilter('video')}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  mediaTypeFilter === 'video'
                    ? 'bg-violet-600 text-white shadow-sm ring-1 ring-violet-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${mediaTypeFilter === 'video' ? 'bg-white/20 text-white' : 'bg-violet-500/15 text-violet-400'}`}>
                  <VideoIcon size={11} />
                </div>
                <span>{t.mediaVideos || "Video Albums"} ({albums.filter(a => matchesAlbumMediaFilter(a, 'video')).length})</span>
              </button>
              <button
                type="button"
                onClick={() => setMediaTypeFilter('gif')}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  mediaTypeFilter === 'gif'
                    ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${mediaTypeFilter === 'gif' ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-400'}`}>
                  <Clapperboard size={11} />
                </div>
                <span>{t.mediaGifs || 'Com GIFs'} ({albums.filter(a => matchesAlbumMediaFilter(a, 'gif')).length})</span>
              </button>
            </div>

            {/* Filter: Origem (PC Local vs Nuvem) - Estilo 2/3 Micro-Squircle Duotone */}
            <div className="flex items-center p-1 rounded-xl bg-surface-elevated border border-border text-xs">
              <button
                type="button"
                onClick={() => setOriginFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  originFilter === 'all'
                    ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${originFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-700/50 text-slate-300'}`}>
                  <Compass size={11} />
                </div>
                <span>{t.originAll || 'Todas Origens'}</span>
              </button>
              <button
                type="button"
                onClick={() => setOriginFilter('local')}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  originFilter === 'local'
                    ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
                title={t.originLocalTitle || "Albums extracted by local server on your machine (Localhost)"}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${originFilter === 'local' ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-400'}`}>
                  <HardDrive size={11} />
                </div>
                <span>{t.originLocal || 'Servidor Local'} ({albums.filter(a => a.sourceOrigin === 'local' || a.sourceDomain === 'Upload Local' || a.sourceUrl?.startsWith('local://') || a.id.startsWith('manual-') || a.id.startsWith('local-')).length})</span>
              </button>
              <button
                type="button"
                onClick={() => setOriginFilter('remote')}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  originFilter === 'remote'
                    ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
                title={t.originRemoteTitle || "Cloud extractions"}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${originFilter === 'remote' ? 'bg-white/20 text-white' : 'bg-sky-500/15 text-sky-400'}`}>
                  <Cloud size={11} />
                </div>
                <span>{t.originRemote || 'Nuvem'} ({albums.filter(a => !(a.sourceOrigin === 'local' || a.sourceDomain === 'Upload Local' || a.sourceUrl?.startsWith('local://') || a.id.startsWith('manual-') || a.id.startsWith('local-'))).length})</span>
              </button>
            </div>
          </div>

          {(mediaTypeFilter !== 'all' || originFilter !== 'all' || localDomainFilter || galleryTagFilter) && (
            <button
              type="button"
              onClick={() => {
                setMediaTypeFilter('all');
                setOriginFilter('all');
                setLocalDomainFilter('');
                setGalleryTagFilter(null);
                setGallerySearchQuery('');
              }}
              className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <X size={12} />
              <span>{t.clearFilters || 'Limpar Filtros'}</span>
            </button>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-center justify-between min-w-0">
            <div className="flex items-center justify-between sm:justify-start gap-1.5 px-3 py-1.5 rounded-xl bg-surface-elevated border border-border text-xs text-slate-300 min-w-0 shrink-0">
              <span className="text-slate-500 shrink-0 flex items-center gap-1">
                <ArrowUpDown size={12} className="text-brand-400" />
                <span>{t.sortBy}</span>
              </span>
              <select
                value={gallerySortBy}
                onChange={e => setGallerySortBy(e.target.value as any)}
                className="bg-transparent font-semibold text-slate-200 outline-none cursor-pointer text-xs truncate max-w-[165px] sm:max-w-none"
              >
                <option value="recent" className="bg-surface">{gallerySortOrder === 'desc' ? (t.sortRecentDesc || 'Mais Recentes (Download)') : (t.sortRecentAsc || 'Mais Antigos (Download)')}</option>
                <option value="modified" className="bg-surface">{gallerySortOrder === 'desc' ? (t.sortModifiedDesc || "Recently Modified") : (t.sortModifiedAsc || 'Modificados Mais Antigos')}</option>
                <option value="favorites" className="bg-surface">{gallerySortOrder === 'desc' ? (t.sortFavoritesDesc || "Favorites First") : (t.sortFavoritesAsc || "Non-Favorites First")}</option>
                <option value="name" className="bg-surface">{gallerySortOrder === 'asc' ? (t.sortNameAsc || 'Nome (A → Z)') : (t.sortNameDesc || 'Nome (Z → A)')}</option>
                <option value="count" className="bg-surface">{gallerySortOrder === 'desc' ? (t.sortCountDesc || 'Qtd Fotos (Maior)') : (t.sortCountAsc || 'Qtd Fotos (Menor)')}</option>
                <option value="size" className="bg-surface">{gallerySortOrder === 'desc' ? (t.sortSizeDesc || 'Maior Tamanho') : (t.sortSizeAsc || 'Menor Tamanho')}</option>
              </select>
              <button
                onClick={toggleGallerySortOrder}
                className="p-1 rounded-lg bg-surface hover:bg-white/10 text-brand-400 hover:text-brand-300 transition-colors shrink-0 flex items-center gap-1 text-[10px] font-mono font-bold cursor-pointer"
                title={gallerySortOrder === 'desc' ? (settings.language === 'en-US' ? 'Descending Order (click for Ascending)' : 'Ordem Decrescente (clique para Crescente)') : (settings.language === 'en-US' ? 'Ascending Order (click for Decrescente)' : 'Ordem Crescente (clique para Decrescente)')}
              >
                {gallerySortOrder === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                <span className="hidden sm:inline uppercase text-[9px]">{gallerySortOrder}</span>
              </button>
            </div>

            {/* View Mode Switcher with 5 Clean Modes (3D Coverflow Excluído Permanentemente) */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-elevated border border-border overflow-x-auto no-scrollbar touch-scroll min-w-0 max-w-full">
              <button
                onClick={() => setGalleryViewMode('grid-xl')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  galleryViewMode === 'grid-xl' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
                title={t.viewXlTitle || "Extra Large Icons"}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${galleryViewMode === 'grid-xl' ? 'bg-white/20 text-white' : 'bg-brand-500/15 text-brand-400'}`}>
                  <LayoutGrid size={11} />
                </div>
                <span>XL</span>
              </button>
              <button
                onClick={() => setGalleryViewMode('grid-lg')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  galleryViewMode === 'grid-lg' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
                title={t.viewLTitle || "Large Icons"}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${galleryViewMode === 'grid-lg' ? 'bg-white/20 text-white' : 'bg-brand-500/15 text-brand-400'}`}>
                  <Grid size={11} />
                </div>
                <span>L</span>
              </button>
              <button
                onClick={() => setGalleryViewMode('grid-md')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  galleryViewMode === 'grid-md' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
                title={t.viewMTitle || "Medium Icons"}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${galleryViewMode === 'grid-md' ? 'bg-white/20 text-white' : 'bg-brand-500/15 text-brand-400'}`}>
                  <Grid size={10} />
                </div>
                <span>M</span>
              </button>
              <button
                onClick={() => setGalleryViewMode('details')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  galleryViewMode === 'details' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
                title={t.viewDetailsTitle || 'Tabela Detalhes (Windows Explorer)'}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${galleryViewMode === 'details' ? 'bg-white/20 text-white' : 'bg-brand-500/15 text-brand-400'}`}>
                  <List size={11} />
                </div>
                <span>{t.viewDetails || 'Detalhes'}</span>
              </button>
              <button
                onClick={() => setGalleryViewMode('list')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  galleryViewMode === 'list' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-surface'
                }`}
                title={t.viewListTitle || 'Lista com Carrossel'}
              >
                <div className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${galleryViewMode === 'list' ? 'bg-white/20 text-white' : 'bg-brand-500/15 text-brand-400'}`}>
                  <LayoutListIcon size={11} />
                </div>
                <span>{t.viewList || 'Lista'}</span>
              </button>
            </div>
          </div>

        {/* Color Wheel & Tag Cloud Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-border text-xs">
          {/* Semantic Color Palette Search - Estilo 3 Popover Dinâmico */}
          <div className="flex items-center gap-2 overflow-x-visible py-0.5">
            <ColorFilterPopover
              activeColor={galleryColorFilter}
              onSelectColor={setGalleryColorFilter}
              items={albums}
              language={settings.language}
              totalMatchedCount={galleryColorFilter ? filtered.length : undefined}
              singularLabel={settings.language === 'pt-BR' ? 'álbum' : 'album'}
              pluralLabel={settings.language === 'pt-BR' ? 'álbuns encontrados' : 'albums found'}
            />
          </div>

          {/* AI Tag Filter Chips with Horizontal Mouse Scroll */}
          <div
            onWheel={(e) => {
              e.currentTarget.scrollLeft += e.deltaY;
            }}
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-scroll max-w-full sm:max-w-md py-0.5"
          >
            <span className="text-slate-500 text-[11px] font-semibold shrink-0">{t.tagCloudTitle}</span>
            {allTags.map((tag: string) => (
              <button
                key={tag}
                onClick={() => setGalleryTagFilter(galleryTagFilter === tag ? null : tag)}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-all shrink-0 ${
                  galleryTagFilter === tag
                    ? 'bg-brand-500 text-white shadow-glow-brand'
                    : 'bg-surface-elevated text-slate-400 hover:text-slate-200'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Visual Presentation Area by ViewMode */}
      {galleryViewMode === 'details' ? (
        /* Windows Explorer Detailed Table Mode with Touch Scroll Container */
        <div className="glass-panel rounded-2xl border border-border overflow-x-auto touch-scroll shadow-sm">
          <StableVirtualTable className="w-full text-left text-xs min-w-[700px] border-collapse">
            <thead className="bg-surface-elevated border-b border-border text-slate-400 font-semibold font-mono text-[11px] uppercase tracking-wider">
              <tr>
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={selectedAlbumIds.length === filtered.length && filtered.length > 0}
                    onChange={e => {
                      if (e.target.checked) selectAllAlbums(filtered.map(a => a.id));
                      else clearSelectedAlbums();
                    }}
                    className="rounded text-brand-500 cursor-pointer w-4 h-4"
                  />
                </th>
                <th className="p-3 w-[250px]">{isEn ? "Album Title" : "Título do Álbum"}</th>
                <th className="p-3">Qtd Fotos</th>
                <th className="p-3">{isEn ? "% Resolution" : "% Resolução"}</th>
                <th className="p-3">Tamanho</th>
                <th className="p-3">{isEn ? "Domain" : "Domínio"}</th>
                <th className="p-3">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={13} className="text-slate-400" />
                    <span>Data</span>
                  </div>
                </th>
                <th className="p-3 text-right">{isEn ? "Actions" : "Ações"}</th>
              </tr>
            </thead>
            <VirtualCollection items={filtered} itemKey={album => album.id} layoutKey="album-table" tableColumns={8} gap={0} estimatedRowHeight={72} highlightedKey={highlightedItemId}
              className="divide-y divide-white/5" renderItem={album => (
                <tr
                  key={album.id}
                  onClick={() => navigateToView('album-detail', album.id)}
                  className="hover:bg-brand-500/10 transition-colors cursor-pointer group"
                >
                  <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedAlbumIds.includes(album.id)}
                      onChange={() => toggleSelectAlbum(album.id)}
                      className="rounded text-brand-500 cursor-pointer w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity"
                    />
                  </td>
                  <td className="p-3 font-semibold text-slate-100">
                    <div className="flex items-center gap-3">
                      <img
                        src={album.coverImage}
                        alt={album.title}
                        className="w-10 h-10 rounded-lg object-cover border border-border shrink-0 shadow-sm"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          if (album.rawCoverImage && e.currentTarget.src !== album.rawCoverImage) {
                            e.currentTarget.src = album.rawCoverImage;
                          }
                        }}
                      />
                      <span className="truncate max-w-[200px] text-sm group-hover:text-brand-300 transition-colors">{album.title}</span>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-slate-300">{album.imageCount}</td>
                  <td className="p-3 font-mono text-emerald-400 font-bold bg-emerald-500/5 px-2 rounded">
                    100% Original
                  </td>
                  <td className="p-3 font-mono text-slate-400">
                    {album.totalSizeBytes > 0 ? formatFileSize(album.totalSizeBytes) : 'Tam. N/D'}
                  </td>
                  <td className="p-3 text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-accent-purple/50"></span>
                      <span className="truncate max-w-[120px]">{album.sourceDomain}</span>
                    </div>
                  </td>
                  <td className="p-3 text-slate-500 font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} className="text-slate-500 shrink-0" />
                      <span>{new Date(album.createdAt).toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => toggleFavoriteAlbum(album.id)}
                        className={`p-2 rounded-xl bg-surface-elevated border border-border transition-all shadow-sm ${
                          album.isFavorite
                            ? 'text-rose-400 border-rose-500/40 bg-rose-500/10'
                            : 'text-slate-400 hover:text-rose-400 hover:border-rose-500'
                        }`}
                        title={album.isFavorite ? (t.removeFavorite || (isEn ? 'Remove from Favorites' : 'Remover dos Favoritos')) : (t.addFavorite || (isEn ? 'Favorite Album' : 'Favoritar Álbum'))}
                      >
                        <Heart size={14} className={album.isFavorite ? 'fill-rose-400' : ''} />
                      </button>
                      <button
                        onClick={() => openExportModal(album)}
                        className="p-2 rounded-xl bg-surface-elevated border border-border hover:bg-brand-600 hover:border-brand-500 hover:text-white text-slate-400 transition-all shadow-sm"
                        title="Download ZIP"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => setAlbumToDelete({ id: album.id, title: album.title })}
                        className="p-2 rounded-xl bg-surface-elevated border border-border hover:bg-rose-600 hover:border-rose-500 hover:text-white text-slate-400 transition-all shadow-sm"
                        title={t.deleteAlbum || (isEn ? 'Delete Album' : 'Excluir Álbum')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )} />
          </StableVirtualTable>
        </div>
      ) : galleryViewMode === 'list' ? (
        /* List with Interactive Thumbnail Carousel Mode (Restored in Full!) */
        <VirtualCollection items={filtered} itemKey={album => album.id} layoutKey="album-list" gap={16} estimatedRowHeight={180} highlightedKey={highlightedItemId}
          className="space-y-4" renderItem={album => (
            <div
              key={album.id}
              onClick={() => navigateToView('album-detail', album.id)}
              className="glass-panel p-4 rounded-2xl border border-border hover:border-brand-500/50 transition-all cursor-pointer flex flex-col md:flex-row gap-4 items-start md:items-center justify-between"
            >
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <img
                  src={album.coverImage}
                  alt={album.title}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border border-border shrink-0"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    if (album.rawCoverImage && e.currentTarget.src !== album.rawCoverImage) {
                      e.currentTarget.src = album.rawCoverImage;
                    }
                  }}
                />
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-slate-100 truncate hover:text-brand-300 transition-colors">
                    {album.title}
                  </h3>
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {album.sourceDomain} • {album.imageCount} fotos originais • {album.totalSizeBytes > 0 ? formatFileSize(album.totalSizeBytes) : 'Tam. N/D'}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex gap-1">
                      {album.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-[9px] font-mono px-2 py-0.5 rounded bg-surface-elevated text-slate-400 border border-border">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteAlbum(album.id);
                      }}
                      className={`p-1 rounded-lg transition-colors ${
                        album.isFavorite
                          ? 'text-rose-400 bg-rose-500/10'
                          : 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10'
                      }`}
                      title={album.isFavorite ? (t.removeFavorite || (isEn ? 'Remove from Favorites' : 'Remover dos Favoritos')) : (t.addFavorite || (isEn ? 'Favorite Album' : 'Favoritar Álbum'))}
                    >
                      <Heart size={13} className={album.isFavorite ? 'fill-rose-400' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAlbumToDelete({ id: album.id, title: album.title });
                      }}
                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title={t.deleteAlbum || (isEn ? 'Delete Album' : 'Excluir Álbum')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Horizontal Interactive Carousel of Thumbnails */}
              <div
                onWheel={(e) => {
                  e.currentTarget.scrollLeft += e.deltaY;
                }}
                className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-scroll max-w-full md:max-w-md py-1"
                onClick={e => e.stopPropagation()}
              >
                {(album.images || []).slice(0, 15).map((img, i) => (
                  <img
                    key={img.id}
                    src={img.thumbnailUrl}
                    alt={img.title}
                    loading="lazy"
                    decoding="async"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      openLightbox(img, album, {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                      });
                    }}
                    className="w-12 h-12 rounded-xl object-cover border border-border hover:scale-105 active:scale-95 transition-all shrink-0 cursor-pointer shadow-sm"
                    title={`Abrir foto #${i + 1}`}
                  />
                ))}
                {(album.images || []).length > 15 && (
                  <span className="text-[10px] font-mono text-slate-400 px-2 shrink-0">
                    +{album.images.length - 15} mais
                  </span>
                )}
              </div>
            </div>
          )} />
      ) : (
        /* Standard Grid Views (XL, LG, MD) Responsive */
        <VirtualCollection items={filtered} itemKey={album => album.id} layoutKey={`album-${galleryViewMode}`} estimatedRowHeight={350} highlightedKey={highlightedItemId}
          columns={galleryViewMode === 'grid-xl' ? [[0, 1], [640, 2], [1024, 3]] : galleryViewMode === 'grid-md' ? [[0, 2], [640, 3], [1024, 5]] : [[0, 1], [640, 2], [1024, 4]]}
          className={`gpu-accelerated-grid grid gap-3 sm:gap-5 ${
            galleryViewMode === 'grid-xl'
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              : galleryViewMode === 'grid-md'
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
          }`}
          renderItem={album => {
            const isSelected = selectedAlbumIds.includes(album.id);
            const mediaSummary = getAlbumMediaSummary(album);
            const albumKey = getCanonicalMediaFingerprint(album.title, album.sourceUrl);
            const isDuplicateAlbum = Boolean(albumKey && (duplicateAlbumMap.get(albumKey) || 0) > 1);

            return (
            <div
              key={album.id}
              data-album-id={album.id}
              onClick={() => {
                if (isSelectionMode || selectedAlbumIds.length > 0) {
                  toggleSelectAlbum(album.id);
                } else {
                  navigateToView('album-detail', album.id);
                }
              }}
              className={`group gpu-album-card bg-slate-900/90 rounded-2xl border overflow-hidden transition-all duration-300 cursor-pointer flex flex-col justify-between ${
                highlightedItemId === album.id
                  ? 'ring-4 ring-brand-500 shadow-glow-brand animate-pulse'
                  : ''
              } ${
                isSelected
                  ? 'border-violet-500 ring-2 ring-violet-500/50 bg-violet-950/20 shadow-glow-brand'
                  : 'border-border hover:border-brand-500/50 hover:shadow-card-elevated'
              }`}
            >
              {/* Cover Image & Hover Badges */}
              <div className="relative aspect-[4/3] overflow-hidden bg-slate-900">
                {album.coverImage ? (
                  <img
                    src={album.coverImage}
                    alt={album.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      if (album.rawCoverImage && e.currentTarget.src !== album.rawCoverImage) {
                        e.currentTarget.src = album.rawCoverImage;
                      } else {
                        e.currentTarget.style.display = 'none';
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 p-4 text-center">
                    <ImageIcon size={32} className="text-slate-600 mb-2" />
                    <span className="text-[11px] font-medium text-slate-400 line-clamp-1">{album.sourceDomain}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none"></div>

                {/* Checkbox de Seleção */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelectAlbum(album.id);
                  }}
                  className={`absolute top-2.5 left-2.5 z-20 p-1.5 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-violet-600 text-white border-violet-400 shadow-glow-brand opacity-100 scale-100'
                      : isSelectionMode || selectedAlbumIds.length > 0
                      ? 'bg-slate-950/85 text-slate-400 hover:text-white border-white/15 opacity-100'
                      : 'bg-slate-950/85 text-slate-400 hover:text-white border-white/15 opacity-0 group-hover:opacity-100'
                  }`}
                  title={isSelected ? (t.deselectAlbum || "Deselect album") : (t.selectAlbum || "Select album")}
                >
                  {isSelected ? <Check size={14} strokeWidth={3} /> : <Square size={13} />}
                </button>

                <span className={`absolute top-2.5 px-2 py-0.5 rounded-lg bg-slate-950/90 border border-white/15 font-mono text-[9px] sm:text-[10px] font-bold text-emerald-400 shadow-sm transition-all ${
                  isSelected || isSelectionMode || selectedAlbumIds.length > 0 ? 'left-11' : 'left-2.5 group-hover:left-11'
                }`}>
                  {mediaSummary.mediaType === 'video' ? (isEn ? 'Video' : 'Vídeo') : `${album.resolvedOriginalCount} / ${album.imageCount} ${isEn ? 'Originals' : 'Originais'}`}
                </span>

                {/* Badge de Origem Local, Vídeo ou Duplicado no canto superior direito */}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1 z-10 flex-wrap justify-end">
                  {isDuplicateAlbum && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/90 text-slate-950 font-bold text-[9px] shadow-sm" title={t.duplicateDetected || "Duplicate album detected in library"}>
                      <Copy size={10} />
                      <span>{t.duplicateBadge || "Duplicate"}</span>
                    </span>
                  )}
                  {album.sourceOrigin === 'local' && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/90 text-slate-950 font-bold text-[9px] shadow-sm" title={t.localServerAlbum || "Local PC Server Album"}>
                      <HardDrive size={10} />
                      <span>PC</span>
                    </span>
                  )}
                  {mediaSummary.hasVideos && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-600 text-white font-bold text-[9px] shadow-sm">
                      <VideoIcon size={10} />
                    </span>
                  )}
                  {mediaSummary.hasGifs && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-600/95 text-white font-bold text-[9px] shadow-sm border border-amber-400/30" title={isEn ? `Album contains ${mediaSummary.gifCount} GIF animations` : `Álbum contém ${mediaSummary.gifCount} animações GIF`}>
                      <Clapperboard size={10} />
                      <span>{mediaSummary.gifCount} GIFs</span>
                    </span>
                  )}
                </div>

                <div className="absolute bottom-2.5 left-2.5 flex items-center text-white text-xs">
                  <span className="text-[10px] sm:text-[11px] font-mono text-slate-300 font-semibold px-2 py-0.5 rounded bg-slate-950/90 border border-white/15 shadow-sm">
                    {album.totalSizeBytes > 0 ? formatFileSize(album.totalSizeBytes) : 'Tam. N/D'}
                  </span>
                </div>
              </div>

              {/* Title, Domain & Action Footer */}
              <div className="p-3 sm:p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-xs sm:text-sm text-slate-100 truncate group-hover:text-brand-400 transition-colors">
                      {album.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-400 truncate mt-0.5">
                      <span className="truncate">{album.sourceDomain}</span>
                      <span className="text-slate-600">•</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveAlbumFolder(album.folder || 'Geral');
                        }}
                        className="text-purple-400 hover:text-purple-200 font-medium flex items-center gap-0.5 shrink-0 hover:underline cursor-pointer"
                        title={`Filtrar biblioteca pela pasta "${album.folder || 'Geral'}"`}
                      >
                        <Folder size={10} />
                        <span>{album.folder || 'Geral'}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteAlbum(album.id);
                      }}
                      className={`p-1.5 rounded-lg transition-colors ${
                        album.isFavorite
                          ? 'text-rose-400 bg-rose-500/10'
                          : 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10'
                      }`}
                      title={album.isFavorite ? (t.removeFavorite || (isEn ? 'Remove from Favorites' : 'Remover dos Favoritos')) : (t.addFavorite || (isEn ? 'Favorite Album' : 'Favoritar Álbum'))}
                    >
                      <Heart size={14} className={album.isFavorite ? 'fill-rose-400' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTargetMoveFolder(album.folder || 'Geral');
                        setActiveAlbumFolderModal({ type: 'move', albumId: album.id, albumIds: [album.id] });
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                      title={t.moveAlbumToFolder || (isEn ? 'Move Album to another Folder' : 'Mover Álbum para outra Pasta')}
                    >
                      <Folder size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAlbumToDelete({ id: album.id, title: album.title });
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title={t.deleteAlbum || (isEn ? 'Delete Album' : 'Excluir Álbum')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-white/5 text-[10px] text-slate-400">
                  <div className="flex items-center gap-1 font-mono text-[9px] sm:text-[10px]">
                    <Calendar size={11} className="text-slate-500 shrink-0" />
                    <span>{new Date(album.createdAt).toLocaleDateString()}</span>
                  </div>
                  {album.updatedAt && album.updatedAt !== album.createdAt && (
                    <div className="flex items-center gap-1 font-mono text-[9px] text-amber-400/90" title={`Modificado em ${new Date(album.updatedAt).toLocaleString()}`}>
                      <Clock size={10} className="shrink-0" />
                      <span>{t.modified || (isEn ? 'Modified' : 'Modificado')}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {album.tags.slice(0, 3).map(tag => (
                    <span
                      key={tag}
                      className="text-[8px] sm:text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-elevated text-slate-400 border border-border"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            );
          }} />
      )}

      {/* Empty State when no albums match filters or folder */}
      {filtered.length === 0 && (
        <div className="col-span-full py-16 px-4 text-center glass-panel rounded-3xl border border-border my-6 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-surface-elevated text-slate-400 border border-border flex items-center justify-center mx-auto">
            <Folder size={22} />
          </div>
          <h4 className="text-sm font-bold text-slate-200">{isEn ? "No albums found" : "Nenhum álbum encontrado"}</h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {activeAlbumFolder
              ? (isEn ? `No albums in folder "${activeAlbumFolder}".` : `Não há álbuns cadastrados na pasta "${activeAlbumFolder}".`)
              : (isEn ? "No albums match the selected filters." : "Nenhum álbum corresponde aos filtros selecionados.")}
          </p>
          {activeAlbumFolder && (
            <button
              onClick={() => setActiveAlbumFolder(null)}
              className="px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm"
            >
              <span>{isEn ? "View All Albums" : "Ver Todos os Álbuns"}</span>
            </button>
          )}
        </div>
      )}

      {/* Modal de Criação / Upload de Álbum de Fotos */}
      {isUploadModalOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => {
              if (!isUploadingAlbum) setIsUploadModalOpen(false);
            }}
          >
            <div
              className="bg-slate-900 border border-brand-500/40 rounded-3xl p-5 sm:p-6 max-w-lg w-full space-y-4 shadow-2xl animate-scale-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
                  <FolderHeart size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-base text-white">{isEn ? "Create New Photo Album" : "Criar Novo Álbum de Fotos"}</h4>
                  <p className="text-xs text-slate-400">{isEn ? "Upload photos from your device to the gallery" : "Faça upload de fotos do seu dispositivo para a galeria"}</p>
                </div>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!uploadTitle.trim() || uploadFiles.length === 0 || isUploadingAlbum) return;
                  setIsUploadingAlbum(true);
                  const targetFolder = uploadFolder === '__custom__' ? (uploadCustomFolder.trim() || 'Geral') : (uploadFolder || 'Geral');
                  try {
                    const success = await uploadPhotoAlbum(uploadTitle.trim(), uploadFiles, targetFolder);
                    if (success) {
                      setUploadTitle('');
                      setUploadFiles([]);
                      setUploadCustomFolder('');
                      setIsUploadModalOpen(false);
                    }
                  } finally {
                    setIsUploadingAlbum(false);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    {isEn ? "Album Title:" : "Título do Álbum:"}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={isEn ? "Ex: Summer Vacation, Studio Session..." : "Ex: Férias de Verão, Sessão de Fotos..."}
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    className="w-full bg-surface border border-border rounded-2xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                    <span>{isEn ? "Destination Folder:" : "Pasta de Destino:"}</span>
                    <span className="text-[10px] text-slate-400 font-normal">{isEn ? "Organize your albums" : "Organize seus álbuns"}</span>
                  </label>
                  <select
                    value={uploadFolder}
                    onChange={(e) => setUploadFolder(e.target.value)}
                    className="w-full bg-surface border border-border rounded-2xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-brand-500"
                  >
                    {albumFolders.map((f) => (
                      <option key={f.id} value={f.name}>
                        {f.name} ({f.count})
                      </option>
                    ))}
                    <option value="__custom__">{isEn ? "+ New Custom Folder..." : "+ Nova Pasta Personalizada..."}</option>
                  </select>
                  {uploadFolder === '__custom__' && (
                    <input
                      type="text"
                      placeholder={isEn ? "New folder name..." : "Nome da nova pasta..."}
                      value={uploadCustomFolder}
                      onChange={(e) => setUploadCustomFolder(e.target.value)}
                      className="mt-2 w-full bg-surface border border-brand-500/60 rounded-2xl px-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500"
                      autoFocus
                    />
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    {isEn ? "Select Photos (JPEG, PNG, WebP):" : "Selecionar Fotos (JPEG, PNG, WebP):"}
                  </label>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    required
                    onChange={(e) => {
                      if (e.target.files) {
                        setUploadFiles(Array.from(e.target.files));
                      }
                    }}
                    className="w-full bg-surface border border-border rounded-2xl px-3 py-2 text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-brand-600 file:text-white hover:file:bg-brand-500 cursor-pointer"
                  />
                  {uploadFiles.length > 0 && (
                    <p className="text-[11px] text-emerald-400 font-mono mt-1.5 flex items-center gap-1">
                      <Check size={12} strokeWidth={3} />
                      <span>{uploadFiles.length} foto(s) selecionada(s)</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    disabled={isUploadingAlbum}
                    onClick={() => setIsUploadModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isUploadingAlbum || !uploadTitle.trim() || uploadFiles.length === 0}
                    className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-glow-brand flex items-center gap-1.5"
                  >
                    {isUploadingAlbum ? 'Enviando Fotos...' : 'Criar Álbum Agora'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Modal de Confirmação de Exclusão de Álbum */}
      {albumToDelete && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setAlbumToDelete(null)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
                <Trash2 size={24} />
              </div>
              <div>
                <h4 className="font-bold text-base text-white">{isEn ? "Delete Album?" : "Excluir Álbum?"}</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Tem certeza que deseja apagar o álbum <span className="font-semibold text-slate-200">"{albumToDelete.title}"</span>? O álbum será movido para a lixeira.
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setAlbumToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!await deleteAlbum(albumToDelete.id)) return;
                    setAlbumToDelete(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {isEn ? "Yes, Delete" : "Sim, Excluir"}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Modal de Confirmação de Exclusão em Lote */}
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
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
                <Trash2 size={24} />
              </div>
              <div>
                <h4 className="font-bold text-base text-white">{isEn ? `Delete ${selectedAlbumIds.length} Albums?` : `Excluir ${selectedAlbumIds.length} Álbuns?`}</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Tem certeza que deseja apagar os <span className="font-semibold text-rose-300">{selectedAlbumIds.length}</span> álbuns selecionados? Todos serão movidos para a lixeira.
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingBatchDelete(false)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    let allDeleted = true;
                    for (const id of selectedAlbumIds) {
                      if (!await deleteAlbum(id)) allDeleted = false;
                    }
                    if (!allDeleted) return;
                    clearSelectedAlbums();
                    setIsConfirmingBatchDelete(false);
                    setIsSelectionMode(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {isEn ? "Yes, Delete" : "Sim, Excluir"} Todos
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Modal de Criação de Pasta */}
      {activeAlbumFolderModal?.type === 'create' && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setActiveAlbumFolderModal(null)}
          >
            <div
              className="bg-slate-900 border border-purple-500/40 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                  <FolderPlus size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-base text-white">{isEn ? "New Album Folder" : "Nova Pasta de Álbuns"}</h4>
                  <p className="text-xs text-slate-400">{isEn ? "Organize your albums by artist or category" : "Organize seus álbuns por artista ou categoria"}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">{isEn ? "Folder Name:" : "Nome da Pasta:"}</label>
                <input
                  type="text"
                  autoFocus
                  value={folderNameInput}
                  onChange={e => setFolderNameInput(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && folderNameInput.trim()) {
                      await createAlbumFolder(folderNameInput.trim());
                      setActiveAlbumFolderModal(null);
                    }
                  }}
                  placeholder="Ex: Viagens, Favoritas..."
                  className="w-full h-10 px-3.5 rounded-xl bg-surface-elevated border border-border text-slate-100 text-xs outline-none focus:border-purple-500"
                />
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveAlbumFolderModal(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!folderNameInput.trim()}
                  onClick={async () => {
                    if (folderNameInput.trim()) {
                      await createAlbumFolder(folderNameInput.trim());
                      setActiveAlbumFolderModal(null);
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-purple-600/30 transition-colors"
                >
                  {isEn ? "Create Folder" : "Criar Pasta"}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Modal de Renomear Pasta */}
      {activeAlbumFolderModal?.type === 'rename' && activeAlbumFolderModal.folderName && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setActiveAlbumFolderModal(null)}
          >
            <div
              className="bg-slate-900 border border-brand-500/40 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-brand-500/20 text-brand-400 border border-brand-500/30 flex items-center justify-center">
                  <Edit2 size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-base text-white">{isEn ? "Rename Folder" : "Renomear Pasta"}</h4>
                  <p className="text-xs text-slate-400">{isEn ? "Update selected folder name" : "Atualize o nome da pasta selecionada"}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">{isEn ? "New Name:" : "Novo Nome:"}</label>
                <input
                  type="text"
                  autoFocus
                  value={folderNameInput}
                  onChange={e => setFolderNameInput(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && folderNameInput.trim()) {
                      await renameAlbumFolder(activeAlbumFolderModal.folderName!, folderNameInput.trim());
                      setActiveAlbumFolderModal(null);
                    }
                  }}
                  placeholder={activeAlbumFolderModal.folderName}
                  className="w-full h-10 px-3.5 rounded-xl bg-surface-elevated border border-border text-slate-100 text-xs outline-none focus:border-brand-500"
                />
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveAlbumFolderModal(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!folderNameInput.trim() || folderNameInput.trim() === activeAlbumFolderModal.folderName}
                  onClick={async () => {
                    if (folderNameInput.trim() && folderNameInput.trim() !== activeAlbumFolderModal.folderName) {
                      await renameAlbumFolder(activeAlbumFolderModal.folderName!, folderNameInput.trim());
                      setActiveAlbumFolderModal(null);
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-brand-600/30 transition-colors"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Modal de Mover Álbum(ns) */}
      {activeAlbumFolderModal?.type === 'move' && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
            onClick={() => setActiveAlbumFolderModal(null)}
          >
            <div
              className="bg-slate-900 border border-violet-500/40 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-scale-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-violet-500/20 text-violet-400 border border-violet-500/30 flex items-center justify-center">
                  <Folder size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-base text-white">{isEn ? "Move to Folder" : "Mover para Pasta"}</h4>
                  <p className="text-xs text-slate-400">
                    {isEn ? `Moving ${activeAlbumFolderModal.albumIds?.length || 1} selected album(s)` : `Movendo ${activeAlbumFolderModal.albumIds?.length || 1} álbum(ns) selecionado(s)`}
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">{isEn ? "Select or type folder name:" : "Selecione ou digite o nome da pasta:"}</label>
                <input
                  type="text"
                  autoFocus
                  value={targetMoveFolder}
                  onChange={e => setTargetMoveFolder(e.target.value)}
                  list="gallery-move-folder-options"
                  placeholder="Geral"
                  className="w-full h-10 px-3.5 rounded-xl bg-surface-elevated border border-border text-slate-100 text-xs outline-none focus:border-violet-500"
                />
                <datalist id="gallery-move-folder-options">
                  <option value="Geral" />
                  {albumFolders.map(f => (
                    <option key={f.name} value={f.name} />
                  ))}
                </datalist>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveAlbumFolderModal(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ids = activeAlbumFolderModal.albumIds || (activeAlbumFolderModal.albumId ? [activeAlbumFolderModal.albumId] : []);
                    if (ids.length > 0) {
                      await moveAlbumsToFolder(ids, targetMoveFolder.trim() || 'Geral');
                      clearSelectedAlbums();
                      setActiveAlbumFolderModal(null);
                      setIsSelectionMode(false);
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold shadow-lg shadow-violet-600/30 transition-colors"
                >
                  Confirmar e Mover
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
