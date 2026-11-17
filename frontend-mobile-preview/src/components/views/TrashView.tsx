import { normalizePlayerHighlights } from '../video-player/engine/playerHighlights';
import React, { useState, useMemo } from 'react';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Search,
  CheckSquare,
  Square,
  Filter,
  ArrowUpDown,
  HardDrive,
  Film,
  Image as ImageIcon,
  FolderHeart,
  Play,
  X,
  RefreshCw,
  Clock,
  Sparkles,
  Calendar,
  Check
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { TrashItem } from '../../types';
import { formatFileSize } from '../../utils/formatters';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';
import { ModalPortal } from '../common/ModalPortal';
import { UniversalVideoPlayer } from '../video-player/ui/UniversalVideoPlayer';

export const TrashView: React.FC = () => {
  const {
    trashItems,
    trashStats,
    selectedTrashIds,
    trashFilterType,
    trashSearchQuery,
    fetchTrash,
    restoreTrashItems,
    permanentDeleteTrashItems,
    emptyTrashBin,
    toggleSelectTrashItem,
    selectAllTrashItems,
    clearSelectedTrashItems,
    setTrashFilterType,
    setTrashSearchQuery,
    navigateToView,
    settings
  } = useAppStore();

  const t: any = translations[settings.language].trash || {};
  const isEn = settings.language === 'en-US';

  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'size_desc' | 'name_asc'>('date_desc');
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Modals state
  const [confirmEmptyModal, setConfirmEmptyModal] = useState<boolean>(false);
  const [confirmDeleteSingle, setConfirmDeleteSingle] = useState<TrashItem | null>(null);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState<boolean>(false);
  const [previewingVideoItem, setPreviewingVideoItem] = useState<TrashItem | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchTrash();
    setIsRefreshing(false);
  };

  // Filter and Sort items
  const filteredAndSortedItems = useMemo(() => {
    let result = [...trashItems];

    // Filter by type
    if (trashFilterType !== 'all') {
      result = result.filter(item => item.type === trashFilterType);
    }

    // Filter by search
    if (trashSearchQuery.trim()) {
      const q = trashSearchQuery.toLowerCase();
      result = result.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.original_location.toLowerCase().includes(q)
      );
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'date_desc') {
        return new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime();
      }
      if (sortBy === 'date_asc') {
        return new Date(a.deleted_at).getTime() - new Date(b.deleted_at).getTime();
      }
      if (sortBy === 'size_desc') {
        return (b.file_size_bytes || 0) - (a.file_size_bytes || 0);
      }
      if (sortBy === 'name_asc') {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

    return result;
  }, [trashItems, trashFilterType, trashSearchQuery, sortBy]);

  const allFilteredSelected =
    filteredAndSortedItems.length > 0 &&
    filteredAndSortedItems.every(i => selectedTrashIds.includes(i.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      clearSelectedTrashItems();
    } else {
      selectAllTrashItems(filteredAndSortedItems.map(i => i.id));
    }
  };

  const handleBatchRestore = async () => {
    if (selectedTrashIds.length === 0) return;
    await restoreTrashItems(selectedTrashIds);
  };

  const handleBatchPermanentDelete = async () => {
    if (selectedTrashIds.length === 0) return;
    await permanentDeleteTrashItems(selectedTrashIds);
    setConfirmDeleteSelected(false);
  };

  const handleSingleRestore = async (item: TrashItem) => {
    await restoreTrashItems([item.id]);
  };

  const handleSinglePermanentDelete = async () => {
    if (!confirmDeleteSingle) return;
    await permanentDeleteTrashItems([confirmDeleteSingle.id]);
    setConfirmDeleteSingle(null);
  };

  const handleEmptyTrash = async () => {
    await emptyTrashBin();
    setConfirmEmptyModal(false);
  };

  const formatDeletedDate = (isoString: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto animate-fade-in select-none pb-28">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface/70 backdrop-blur-xl border border-border rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="flex items-start sm:items-center gap-4">
          <IconBadge icon={<Trash2 size={28} />} variant="rose" size="xl" />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {t.title}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                {trashStats.total_items} {trashStats.total_items === 1 ? t.itemSingle : t.itemsCount.replace('{count}', '')}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              {t.subtitle}
            </p>
          </div>
        </div>

        {/* Global Trash Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto shrink-0">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2.5 rounded-2xl bg-surface-elevated hover:bg-white/10 text-slate-300 border border-border hover:border-white/20 transition-all flex items-center justify-center"
            title={t.refresh}
          >
            <RefreshCw size={18} className={isRefreshing ? 'animate-spin text-brand-400' : ''} />
          </button>

          <button
            onClick={() => setConfirmEmptyModal(true)}
            disabled={trashStats.total_items === 0}
            className="px-4 py-2.5 rounded-2xl bg-rose-600/90 hover:bg-rose-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold shadow-lg shadow-rose-600/20 transition-all flex items-center gap-2"
            title={t.emptyTrash}
          >
            <Trash2 size={16} />
            <span>{t.emptyTrash}</span>
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-surface/60 border border-border rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <IconBadge icon={<ImageIcon size={18} />} variant="sapphire" size="md" />
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 font-medium truncate">{t.photosInTrash}</p>
            <p className="text-lg font-bold text-white font-mono">{trashStats.photos_count}</p>
          </div>
        </div>

        <div className="bg-surface/60 border border-border rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <IconBadge icon={<Film size={18} />} variant="gold" size="md" />
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 font-medium truncate">{t.videosInTrash}</p>
            <p className="text-lg font-bold text-white font-mono">{trashStats.videos_count}</p>
          </div>
        </div>

        <div className="bg-surface/60 border border-border rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <IconBadge icon={<FolderHeart size={18} />} variant="emerald" size="md" />
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 font-medium truncate">{t.albumsInTrash}</p>
            <p className="text-lg font-bold text-white font-mono">{trashStats.albums_count}</p>
          </div>
        </div>

        <div className="bg-surface/60 border border-border rounded-2xl p-4 flex items-center gap-3.5 shadow-sm">
          <IconBadge icon={<HardDrive size={18} />} variant="neon" size="md" />
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400 font-medium truncate">{t.spaceOccupied}</p>
            <p className="text-lg font-bold text-white font-mono">{formatFileSize(trashStats.total_size_bytes)}</p>
          </div>
        </div>
      </div>

      {/* Controls & Filter Toolbar */}
      <div className="bg-surface/60 border border-border rounded-2xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-md">
        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 touch-scroll">
          {[
            { id: 'all', label: t.filterAll, count: trashStats.total_items },
            { id: 'photo', label: t.filterPhotos, count: trashStats.photos_count },
            { id: 'video', label: t.filterVideos, count: trashStats.videos_count },
            { id: 'album', label: t.filterAlbums, count: trashStats.albums_count }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setTrashFilterType(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                trashFilterType === tab.id
                  ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
                  : 'bg-surface-elevated/70 text-slate-400 hover:text-slate-200 border border-border'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                trashFilterType === tab.id ? 'bg-white/20 text-white' : 'bg-white/5 text-slate-400'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Right side controls: Search, Sort & Selection Mode */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative flex-1 sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={trashSearchQuery}
              onChange={(e) => setTrashSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-surface-elevated border border-border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
            />
            {trashSearchQuery && (
              <button
                onClick={() => setTrashSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Sort Selector */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-1.5 text-xs bg-surface-elevated border border-border rounded-xl text-slate-300 focus:outline-none focus:border-brand-500 pr-7 appearance-none cursor-pointer"
            >
              <option value="date_desc">{t.sortRecent}</option>
              <option value="date_asc">{t.sortOldest}</option>
              <option value="size_desc">{t.sortSize}</option>
              <option value="name_asc">{t.sortName}</option>
            </select>
            <ArrowUpDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          {/* Multi-Select Toggle Button */}
          <button
            onClick={() => {
              setIsSelectionMode(!isSelectionMode);
              if (isSelectionMode) clearSelectedTrashItems();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
              isSelectionMode
                ? 'bg-brand-500/20 text-brand-300 border-brand-500/40 shadow-glow-brand'
                : 'bg-surface-elevated text-slate-300 border-border hover:bg-white/10'
            }`}
          >
            <CheckSquare size={14} />
            <span>{isSelectionMode ? t.done : t.select}</span>
          </button>
        </div>
      </div>

      {/* Floating / Sticky Batch Actions Bar when items are selected */}
      {selectedTrashIds.length > 0 && (
        <div className="sticky top-4 z-40 bg-slate-900/95 backdrop-blur-2xl border border-brand-500/40 rounded-2xl p-3 sm:p-4 shadow-2xl flex flex-wrap items-center justify-between gap-3 animate-scale-up">
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleSelectAll}
              className="p-1.5 rounded-lg bg-surface hover:bg-surface-elevated text-slate-300 transition-colors"
              title={allFilteredSelected ? t.deselectAll : t.selectAll}
            >
              {allFilteredSelected ? <CheckSquare size={16} className="text-brand-400" /> : <Square size={16} />}
            </button>
            <span className="text-xs sm:text-sm font-semibold text-white">
              <span className="font-mono text-brand-400 font-bold">{selectedTrashIds.length}</span> item(ns)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleBatchRestore}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
            >
              <RotateCcw size={14} />
              <span>{t.restore} ({selectedTrashIds.length})</span>
            </button>

            <button
              onClick={() => setConfirmDeleteSelected(true)}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              <span>{t.deletePermanent} ({selectedTrashIds.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* Items Content Grid */}
      {filteredAndSortedItems.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center p-6 bg-surface/30 rounded-3xl border border-dashed border-border/80">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/80 text-slate-500 border border-slate-700/60 flex items-center justify-center mb-4">
            <Trash2 size={32} />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-200">
            {trashSearchQuery ? 'Nenhum resultado para esta busca' : t.emptyState}
          </h3>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-sm">
            {trashSearchQuery
              ? 'Tente ajustar os termos de pesquisa ou filtros.'
              : t.emptyStateDesc}
          </p>
          {!trashSearchQuery && (
            <div className="flex items-center gap-2.5 mt-6">
              <button
                onClick={() => navigateToView('gallery')}
                className="px-4 py-2 rounded-xl bg-surface-elevated hover:bg-white/10 text-slate-300 text-xs font-semibold border border-border transition-colors cursor-pointer"
              >
                {t.viewPhotosGallery || 'Ver Galeria de Fotos'}
              </button>
              <button
                onClick={() => navigateToView('videos')}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition-colors shadow-md shadow-brand-600/20 cursor-pointer"
              >
                {t.viewVideosGallery || (isEn ? 'View Video Gallery' : 'Ver Galeria de Vídeos')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
          {filteredAndSortedItems.map((item) => {
            const isSelected = selectedTrashIds.includes(item.id);

            return (
              <div
                key={item.id}
                className={`group relative bg-surface/70 hover:bg-surface-elevated/90 border rounded-2xl overflow-hidden transition-all duration-200 shadow-md flex flex-col justify-between ${
                  isSelected
                    ? 'border-brand-500 shadow-glow-brand ring-2 ring-brand-500/30'
                    : 'border-border hover:border-white/20'
                }`}
              >
                {/* Visual Thumbnail Preview Container */}
                <div className="relative aspect-video sm:aspect-square bg-slate-950 overflow-hidden">
                  {item.thumbnail_url ? (
                    <img
                      src={item.thumbnail_url}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 bg-slate-900">
                      {item.type === 'video' && <Film size={32} />}
                      {item.type === 'photo' && <ImageIcon size={32} />}
                      {item.type === 'album' && <FolderHeart size={32} />}
                    </div>
                  )}

                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

                  {/* Top Left: Type Badge */}
                  <div className="absolute top-2 left-2 flex items-center gap-1">
                    <span
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider backdrop-blur-md flex items-center gap-1 shadow-sm ${
                        item.type === 'video'
                          ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                          : item.type === 'album'
                          ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                          : 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                      }`}
                    >
                      {item.type === 'video' && <Film size={10} />}
                      {item.type === 'photo' && <ImageIcon size={10} />}
                      {item.type === 'album' && <FolderHeart size={10} />}
                      <span>{item.type === 'video' ? (t.typeVideo || (isEn ? 'Video' : 'Vídeo')) : item.type === 'album' ? (t.typeAlbum || (isEn ? 'Album' : 'Álbum')) : (t.typePhoto || (isEn ? 'Photo' : 'Foto'))}</span>
                    </span>
                  </div>

                  {/* Top Right: Selection Checkbox */}
                  {(isSelectionMode || isSelected) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectTrashItem(item.id);
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-xl bg-black/60 hover:bg-black/80 backdrop-blur-md text-white transition-all shadow-md z-10"
                    >
                      {isSelected ? (
                        <CheckSquare size={16} className="text-brand-400" />
                      ) : (
                        <Square size={16} className="text-slate-400" />
                      )}
                    </button>
                  )}

                  {/* Center Play Button for Videos */}
                  {item.type === 'video' && item.stream_url && (
                    <button
                      onClick={() => setPreviewingVideoItem(item)}
                      className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-black/60 hover:bg-brand-600/90 text-white flex items-center justify-center backdrop-blur-md border border-white/20 transition-all opacity-80 group-hover:opacity-100 group-hover:scale-110 shadow-lg cursor-pointer"
                      title={t.previewVideo || (isEn ? 'Preview Video' : 'Pré-visualizar Vídeo')}
                    >
                      <Play size={18} className="translate-x-0.5" />
                    </button>
                  )}

                  {/* Bottom Right: File Size */}
                  {item.file_size_bytes > 0 && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-mono text-slate-300 backdrop-blur-md">
                      {formatFileSize(item.file_size_bytes)}
                    </span>
                  )}
                </div>

                {/* Card Info Details */}
                <div className="p-3 flex-1 flex flex-col justify-between space-y-2.5">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-brand-300 transition-colors" title={item.title}>
                      {item.title}
                    </h4>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5" title={item.original_location}>
                      {item.original_location}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono mt-1 flex items-center gap-1">
                      <Clock size={10} />
                      <span>{formatDeletedDate(item.deleted_at)}</span>
                    </p>
                  </div>

                  {/* Card Actions Footer */}
                  <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/60">
                    <button
                      onClick={() => handleSingleRestore(item)}
                      className="flex-1 py-1.5 px-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold transition-all flex items-center justify-center gap-1 shadow-sm"
                      title={t.restore}
                    >
                      <RotateCcw size={12} />
                      <span>{t.restore}</span>
                    </button>

                    <button
                      onClick={() => setConfirmDeleteSingle(item)}
                      className="py-1.5 px-2.5 rounded-xl bg-surface hover:bg-rose-600/20 text-slate-400 hover:text-rose-400 border border-border hover:border-rose-500/30 text-[11px] font-semibold transition-all flex items-center justify-center"
                      title={t.deletePermanent}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal: Empty Entire Trash */}
      {confirmEmptyModal && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setConfirmEmptyModal(false)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-scale-up text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto shadow-lg shadow-rose-500/10">
                <AlertTriangle size={30} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{t.emptyTrashConfirm}</h3>
                <p className="text-xs sm:text-sm text-slate-400 mt-2 leading-relaxed">
                  {t.emptyTrashWarning}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  onClick={() => setConfirmEmptyModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleEmptyTrash}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.emptyTrash}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Confirmation Modal: Single Permanent Delete */}
      {confirmDeleteSingle && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setConfirmDeleteSingle(null)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-scale-up text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{t.confirmDeleteTitle}</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {t.confirmDeleteDesc.replace('{title}', confirmDeleteSingle.title)}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  onClick={() => setConfirmDeleteSingle(null)}
                  className="flex-1 py-2 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleSinglePermanentDelete}
                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.deletePermanent}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Confirmation Modal: Batch Permanent Delete */}
      {confirmDeleteSelected && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setConfirmDeleteSelected(false)}
          >
            <div
              className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl animate-scale-up text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{t.confirmBatchDeleteTitle.replace('{count}', String(selectedTrashIds.length))}</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {t.confirmBatchDeleteDesc.replace('{count}', String(selectedTrashIds.length))}
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  onClick={() => setConfirmDeleteSelected(false)}
                  className="flex-1 py-2 rounded-xl bg-surface hover:bg-surface-elevated text-slate-300 text-xs font-semibold border border-border transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleBatchPermanentDelete}
                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
                >
                  {t.deletePermanent}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Video Preview Modal inside Trash */}
      {previewingVideoItem && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setPreviewingVideoItem(null)}
          >
            <div
              className="bg-slate-950 border border-border rounded-3xl overflow-hidden max-w-2xl w-full shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-white truncate">{previewingVideoItem.title}</h4>
                  <p className="text-xs text-slate-400">{previewingVideoItem.original_location}</p>
                </div>
                <button
                  onClick={() => setPreviewingVideoItem(null)}
                  className="p-1.5 rounded-xl bg-surface hover:bg-white/10 text-slate-300 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="aspect-video bg-black flex items-center justify-center">
                <UniversalVideoPlayer
                  density="compact"
                  autoPlayOnActive
                  posterUrl={previewingVideoItem.thumbnail_url}
                  source={{
                    id: previewingVideoItem.id,
                    highlights: normalizePlayerHighlights(previewingVideoItem),
                    title: previewingVideoItem.title,
                    streamUrl: previewingVideoItem.stream_url || '',
                    posterUrl: previewingVideoItem.thumbnail_url,
                  }}
                  className="w-full h-full object-contain rounded-none border-0"
                />
              </div>
              <div className="p-4 flex items-center justify-end gap-2 border-t border-border">
                <button
                  onClick={() => {
                    handleSingleRestore(previewingVideoItem);
                    setPreviewingVideoItem(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <RotateCcw size={14} />
                  <span>{t.restoreVideo || (isEn ? 'Restore Video' : 'Restaurar Vídeo')}</span>
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
