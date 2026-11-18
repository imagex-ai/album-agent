import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import { useAppStore } from '../../store/useAppStore';
import React, { useState } from 'react';
import { 
  ArrowLeft, 
  MoreHorizontal, 
  Play, 
  Check, 
  Download, 
  FolderPlus, 
  ChevronDown, 
  SlidersHorizontal,
  Info,
  ExternalLink,
  Globe,
  Images
} from 'lucide-react';
import { MediaItemCard, PlaylistItem, AlbumItem } from './profileHubTypes';

interface CollectionDetailPanelProps {
  collection: PlaylistItem | AlbumItem;
  kind: 'playlist' | 'album' | 'gif-collection';
  items: MediaItemCard[];
  selectedItemIds: Set<string>;
  albums?: AlbumItem[];
  selectedAlbumIds?: Set<string>;
  onToggleSelectItem: (item: MediaItemCard) => void;
  onSelectAllItems: () => void;
  onClearAllItems?: () => void;
  onBack: () => void;
  onPlayAll?: (visibleItems?: MediaItemCard[]) => void;
  onSaveCollection?: () => void;
  onItemClick?: (item: MediaItemCard, visibleItems?: MediaItemCard[]) => void;
  onOpenAlbum?: (album: AlbumItem) => void;
  onToggleSelectAlbum?: (album: AlbumItem) => void;
  isLoading?: boolean;
  error?: string;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;
}

export const CollectionDetailPanel: React.FC<CollectionDetailPanelProps> = ({
  collection,
  kind,
  items,
  selectedItemIds,
  albums = [],
  selectedAlbumIds,
  onToggleSelectItem,
  onSelectAllItems,
  onClearAllItems,
  onBack,
  onPlayAll,
  onSaveCollection,
  onItemClick,
  onOpenAlbum,
  onToggleSelectAlbum,
  error = '',
  isLoading = false,
  onLoadMore,
  isLoadingMore = false,
  hasMore = false,
}) => {
  const { copy, formatDate, formatCount, formatMetadata } = useProfileHubPresentation();
  const isEn = useAppStore(state => state.settings.language === 'en-US');
  const [subTab, setSubTab] = useState<'items' | 'albums' | 'about'>('items');
  const sortOrder = copy.sourceOrder;

  const isPlaylist = kind === 'playlist';
  const isGif = kind === 'gif-collection';
  const isGifCollection = isGif || (collection as AlbumItem)?.category === 'GIFs' || collection?.id?.includes('gif') || (items.length > 0 && items.every(it => it.type === 'gif'));
  const [brokenImgIds, setBrokenImgIds] = useState<Set<string>>(new Set());
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!hasMore || isLoadingMore || error || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isLoadingMore) {
        onLoadMore();
      }
    }, { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, error, onLoadMore]);

  const totalCount = isPlaylist 
    ? (collection as PlaylistItem).videoCount 
    : (collection as AlbumItem).photoCount;

  const loadedCount = items.length;
  const knownTotal = totalCount != null && totalCount >= 0;
  const isComplete = !isLoading && !error && collection.paginationComplete === true;
  const progressPercent = knownTotal && totalCount > 0
    ? Math.min(100, Math.floor(loadedCount / totalCount * 100)) : null;
  const countLabel = formatCount(totalCount, isGifCollection ? 'GIFs' : (isPlaylist ? copy.videos : copy.photos));

  const visibleItems = isGifCollection ? items.filter(item => !brokenImgIds.has(item.id)) : items;
  const allSelected = visibleItems.length > 0 && visibleItems.every(item => selectedItemIds.has(item.id));

  return (
    <div className="flex flex-col h-full bg-[#100F1A] rounded-2xl md:rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
      {/* Top Bar with Back Button */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-white/10 flex items-center justify-between bg-[#141322]/80 backdrop-blur-md">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-300 hover:text-white transition-colors group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          <span>
            {isPlaylist ? copy.ui7 : copy.ui8}
          </span>
        </button>

        <button
          type="button"
          title={copy.ui73}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
         disabled>
          <MoreHorizontal size={18} />
        </button>
      </div>

      {error && <p role="alert" className="px-4 py-3 text-xs text-rose-300">{error}</p>}
      {/* Scrollable Content Container */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 sm:p-6 space-y-5">
        {/* Collection Hero Banner Card */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-white/10 shadow-lg group">
          <div className="relative aspect-[21/9] sm:aspect-[21/8] w-full overflow-hidden">
            <img loading="lazy" decoding="async" src={collection.thumbnailUrl}
              alt={collection.title}
              className="w-full h-full object-cover filter brightness-90 group-hover:scale-102 transition-transform duration-500"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#100F1A] via-black/40 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />

            {/* Floating Play / Action button on Banner */}
            <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
              <button
                type="button"
                onClick={() => onPlayAll && onPlayAll(visibleItems)}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/20 hover:bg-purple-600 backdrop-blur-md border border-white/40 hover:border-purple-500 flex items-center justify-center text-white shadow-2xl transition-all hover:scale-105 active:scale-95"
              >
                <Play size={22} fill="white" className="ml-1" />
              </button>
            </div>
          </div>

          {/* Banner Meta Info */}
          <div className="p-4 sm:p-5 space-y-3 -mt-6 sm:-mt-8 relative z-10">
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {collection.title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 font-medium mt-1">
                {countLabel} • {formatDate(collection.updatedAtRaw ?? collection.updatedAt, collection.metadataStatus)}
              </p>
              {(collection as PlaylistItem).description && (
                <p className="text-xs text-slate-300 leading-relaxed mt-2 max-w-2xl">
                  {(collection as PlaylistItem).description}
                </p>
              )}
            </div>

            {/* Progress Bar (Matching 32 de 46 carregados 70%) */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] sm:text-xs font-semibold">
                <span className="text-slate-300">
                  {loadedCount} {knownTotal ? `${copy.of} ${totalCount}` : ''} {copy.loaded}
                </span>
                <span className="text-purple-400 font-bold">{progressPercent == null ? copy.unknownTotal : `${progressPercent ?? 0}%`}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-600 to-indigo-500 shadow-sm transition-all duration-300"
                  style={{ width: `${progressPercent ?? 0}%` }}
                />
              </div>
            </div>

            {/* Primary Action Buttons (Single line on mobile & desktop) */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => onPlayAll && onPlayAll(visibleItems)}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all active:scale-98 min-w-0 truncate"
              >
                <Play size={16} fill="white" className="shrink-0" />
                <span className="truncate">
                  {isPlaylist ? copy.ui10 : isGif ? copy.ui11 : copy.ui12}
                </span>
              </button>

              <button
                type="button"
                onClick={onSaveCollection}
                className="py-3 px-3.5 sm:px-4 rounded-xl bg-[#1D1B2D] hover:bg-[#28253E] border border-white/10 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-98 shrink-0"
              >
                {isPlaylist ? <Download size={16} /> : <FolderPlus size={16} />}
                <span className="hidden sm:inline">
                  {isPlaylist ? copy.ui13 : copy.ui75}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (allSelected) {
                    if (onClearAllItems) onClearAllItems();
                  } else {
                    onSelectAllItems();
                  }
                }}
                className={`py-3 px-3.5 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-all shrink-0 ${
                  allSelected
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-[#1D1B2D] border-white/10 text-slate-300 hover:text-white'
                }`}
                title={allSelected ? copy.ui18 : copy.ui16}
              >
                <Check size={15} />
                <span className="hidden sm:inline">
                  {allSelected ? copy.ui18 : copy.ui16}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Sub-Tabs / Filter Row */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSubTab('items')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === 'items'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-[#1A1829] text-slate-300 hover:text-white'
              }`}
            >
              {isGifCollection ? `GIFs (${visibleItems.length})` : (isPlaylist ? `${copy.ui4} (${items.length})` : `${copy.photos} (${items.length})`)}
            </button>

            {isPlaylist && (
              <button
                type="button"
                onClick={() => setSubTab('albums')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  subTab === 'albums'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-[#1A1829] text-slate-300 hover:text-white'
                }`}
              >
                {copy.ui5} ({albums.length})
              </button>
            )}

            <button
              type="button"
              onClick={() => setSubTab('about')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === 'about'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-[#1A1829] text-slate-300 hover:text-white'
              }`}
            >
              {copy.ui6}
            </button>
          </div>

          {/* Sort Dropdown */}
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181625] border border-white/10 text-slate-300 hover:text-white text-xs font-medium"
             disabled>
              <SlidersHorizontal size={13} className="text-purple-400" />
              <span>{sortOrder}</span>
              <ChevronDown size={13} />
            </button>
          </div>
        </div>

        {/* Media Grid: Videos or Photos */}
        {subTab === 'items' && isLoading && (
          <div className="py-16 flex flex-col items-center justify-center space-y-3 text-center">
            <div className="w-10 h-10 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
            <p className="text-xs sm:text-sm font-semibold text-slate-300">
              {copy.loading}
            </p>
          </div>
        )}

        {subTab === 'items' && !isLoading && !error && items.length === 0 && <p role="status" className="py-8 text-center text-sm text-slate-400">{copy.emptyCollection}</p>}
        {subTab === 'items' && !isLoading && (
          <div className={`grid gap-3 sm:gap-3.5 ${
            isPlaylist 
              ? 'grid-cols-2 lg:grid-cols-3' 
              : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'
          }`}>
            {visibleItems.map(item => {
              const isSelected = selectedItemIds.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (onItemClick) onItemClick(item, visibleItems);
                  }}
                  className={`group/item relative rounded-xl sm:rounded-2xl overflow-hidden bg-[#171524] border transition-all cursor-pointer flex flex-col ${
                    isSelected
                      ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                      : 'border-white/10 hover:border-white/20 hover:bg-[#1E1B2E]'
                  }`}
                >
                  {/* Thumbnail */}
                  <div className={`relative w-full overflow-hidden bg-slate-900 ${
                    isPlaylist ? 'aspect-video' : 'aspect-square'
                  }`}>
                    <img loading="lazy" decoding="async" src={item.thumbnailUrl}
                      alt={item.title || copy.unnamedMedia}
                      onError={() => {
                        setBrokenImgIds(prev => new Set(prev).add(item.id));
                      }}
                      className="w-full h-full object-cover group-hover/item:scale-105 transition-transform duration-500"
                    />

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                    {/* Checkbox (Top-Right: Sleek Translucent or Purple Checkmark) */}
                    <button
                      type="button"
                      aria-label={copy.ui74}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelectItem(item);
                      }}
                      className={`absolute top-2 right-2 w-5 h-5 rounded-[5px] flex items-center justify-center transition-all z-10 ${
                        isSelected
                          ? 'bg-[#7C3AED] border border-[#7C3AED] text-white shadow-md shadow-purple-600/40'
                          : 'bg-black/50 border border-white/50 backdrop-blur-sm text-transparent hover:border-white hover:bg-black/70'
                      }`}
                    >
                      <Check size={13} strokeWidth={3} className={isSelected ? 'opacity-100' : 'opacity-0'} />
                    </button>

                    {/* Badge: Duration or GIF or 4K */}
                    {item.duration && (
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-[10px] font-bold text-white tracking-wider">
                        {item.duration}
                      </span>
                    )}

                    {item.type === 'gif' && (
                      <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-purple-600/90 text-[10px] font-bold text-white uppercase tracking-wider">
                        GIF
                      </span>
                    )}

                    {item.resolution && item.resolution !== 'GIF' && (
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-[10px] font-bold text-white">
                        {item.resolution}
                      </span>
                    )}
                  </div>

                  {/* Card Bottom Info */}
                  <div className="p-2.5 sm:p-3 flex items-start justify-between gap-1 flex-1">
                    <div className="min-w-0">
                      <h4 className="text-xs sm:text-sm font-bold text-white truncate leading-tight group-hover/item:text-purple-200 transition-colors">
                        {item.title || copy.unnamedMedia}
                      </h4>
                      <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                        {item.type === 'gif' ? (item.format ? item.format.toUpperCase() : 'GIF animado') : `${formatDate(item.uploadedAt || item.timeAgo, item.metadataStatus)} ${item.resolution ? `• ${item.resolution}` : ''}`}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/10 shrink-0"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {subTab === 'items' && hasMore && (
          <div className="pt-4 pb-6 flex flex-col items-center justify-center gap-2">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isLoadingMore ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>{copy.loading || 'Carregando mais...'}</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>{isEn ? `Load more (${loadedCount} ${knownTotal ? `of ${totalCount}` : ''} loaded)` : `Carregar mais (${loadedCount} ${knownTotal ? `de ${totalCount}` : ''} carregados)`}</span>
                </>
              )}
            </button>
            <div ref={sentinelRef} className="h-4 w-full pointer-events-none" />
            <p className="text-[11px] text-slate-400">
              {isEn ? 'Loads the next batch of results directly from the source' : 'Carrega o próximo lote de resultados diretamente da fonte'}
            </p>
          </div>
        )}

        {/* Albums tab for performer playlists */}
        {subTab === 'albums' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{copy.ui5} ({albums.length})</span>
            </div>
            {albums.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                {copy.ui67}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {albums.map((album) => {
                  const isSelected = selectedAlbumIds?.has(album.id);
                  return (
                    <div
                      key={album.id}
                      onClick={() => onOpenAlbum && onOpenAlbum(album)}
                      className={`group/album relative rounded-xl sm:rounded-2xl overflow-hidden bg-[#171524] border transition-all cursor-pointer flex flex-col ${
                        isSelected
                          ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                          : 'border-white/10 hover:border-white/20 hover:bg-[#1E1B2E]'
                      }`}
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-slate-900">
                        <img loading="lazy" decoding="async" src={album.thumbnailUrl}
                          alt={album.title || copy.unnamedMedia}
                          className="w-full h-full object-cover group-hover/album:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                        {onToggleSelectAlbum && (
                          <button
                            type="button"
                            aria-label={copy.ui75}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleSelectAlbum(album);
                            }}
                            className={`absolute top-2 right-2 w-5 h-5 rounded-[5px] flex items-center justify-center transition-all z-10 ${
                              isSelected
                                ? 'bg-[#7C3AED] border border-[#7C3AED] text-white shadow-md shadow-purple-600/40'
                                : 'bg-black/50 border border-white/50 backdrop-blur-sm text-transparent hover:border-white hover:bg-black/70'
                            }`}
                          >
                            <Check size={13} strokeWidth={3} className={isSelected ? 'opacity-100' : 'opacity-0'} />
                          </button>
                        )}
                        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-[10px] font-bold text-white tracking-wider flex items-center gap-1">
                          <Images size={11} className="text-purple-400" />
                          {formatCount(album.photoCount, copy.photos)}
                        </span>
                      </div>
                      <div className="p-2.5 flex items-center justify-between gap-1 flex-1">
                        <h4 className="text-xs font-bold text-white truncate leading-tight group-hover/album:text-purple-200 transition-colors">
                          {album.title || copy.unnamedMedia}
                        </h4>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* About tab with rich creator data and direct links */}
        {subTab === 'about' && (
          <div className="p-5 rounded-2xl bg-[#161423] border border-white/10 space-y-5 text-xs text-slate-300">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <Info size={18} className="text-purple-400" />
                <span>{isPlaylist ? copy.ui19 : isGif ? copy.ui20 : copy.ui21}</span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 font-semibold text-[11px] flex items-center gap-1">
                <Globe size={12} />
                {collection.url ? new URL(collection.url).hostname : copy.unknownSource}
              </span>
            </div>

            {/* Creator / Publisher Profile Card */}
            <div className="p-4 rounded-xl bg-[#1D1B2D] border border-white/10 space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {isPlaylist ? copy.ui22 : copy.publishedBy}
              </span>
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                    {(collection.author || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {formatMetadata(collection.author ? `@${collection.author}` : undefined, collection.metadataStatus, copy.unknownAuthor)}
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      {isPlaylist ? copy.playlistCreator : copy.publishedBy}
                    </p>
                  </div>
                </div>
                {collection.authorUrl && (
                  <a
                    href={collection.authorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <span>{copy.ui30}</span>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>

            {/* Metadata Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#141221] border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                  {isPlaylist ? copy.ui23 : copy.ui24}
                </span>
                <p className="text-base font-black text-white">
                  {countLabel}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#141221] border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{copy.ui25}</span>
                <p className="text-base font-black text-purple-300">
                  {formatMetadata(collection.views, collection.metadataStatus, copy.unknownValue)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#141221] border border-white/5 space-y-1 col-span-2 sm:col-span-1">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{isPlaylist ? copy.ui26 : copy.albumPublishedAt}</span>
                <p className="text-xs font-semibold text-slate-200 truncate">
                  {formatDate(collection.updatedAtRaw ?? collection.updatedAt, collection.metadataStatus)}
                </p>
              </div>
            </div>

            {/* Web Link / Original Source Button */}
            {collection.url && (
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#141221] border border-white/5">
                <div className="min-w-0">
                  <span className="text-[11px] font-semibold text-slate-400">
                    {isPlaylist ? copy.ui27 : copy.ui28}
                  </span>
                  <p className="text-xs text-purple-300 truncate font-mono mt-0.5">{collection.url}</p>
                </div>
                <a
                  href={collection.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-600/20 transition-all shrink-0"
                >
                  <ExternalLink size={14} />
                  <span>{copy.ui29}</span>
                </a>
              </div>
            )}

            {/* Synchronization status */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between text-slate-400">
              <span>{copy.ui31}</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {error ? copy.loadFailed : isLoading ? copy.loading : isComplete ? copy.loadComplete : `${loadedCount} ${copy.items} ${copy.loaded} • ${copy.partialCatalog}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
