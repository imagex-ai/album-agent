import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, 
  MoreHorizontal, 
  Check, 
  Folder, 
  ChevronDown, 
  Download, 
  Bookmark, 
  Trash2,
  Film,
  Images
} from 'lucide-react';
import { MediaItemCard, AlbumItem } from './profileHubTypes';

interface ReviewSelectionPanelProps {
  profileName?: string;
  selectedVideos: MediaItemCard[];
  selectedAlbums: AlbumItem[];
  destinationFolder: string;
  availableFolders: string[];
  onDestinationFolderChange?: (folder: string) => void;
  onRemoveVideo: (videoId: string) => void;
  onRemoveAlbum: (albumId: string) => void;
  onSaveToGallery: () => void;
  onDownloadZip: () => void;
  onBack: () => void;
}

export const ReviewSelectionPanel: React.FC<ReviewSelectionPanelProps> = ({
  profileName = 'Perfil',
  selectedVideos,
  selectedAlbums,
  destinationFolder,
  availableFolders,
  onDestinationFolderChange,
  onRemoveVideo,
  onRemoveAlbum,
  onSaveToGallery,
  onDownloadZip,
  onBack
}) => {
  const { copy, formatDate, formatCount } = useProfileHubPresentation();
  const [filterTab, setFilterTab] = useState<'all' | 'videos' | 'albums'>('all');
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const folderDropdownRef = useRef<HTMLDivElement>(null);
  const folderTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!folderDropdownOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        folderDropdownRef.current &&
        !folderDropdownRef.current.contains(target) &&
        !folderTriggerRef.current?.contains(target)
      ) {
        setFolderDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setFolderDropdownOpen(false);
        folderTriggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [folderDropdownOpen]);

  const totalItemsCount = selectedVideos.length + selectedAlbums.length;
  const photoCountsKnown = selectedAlbums.every(album => album.photoCount != null);
  const totalPhotosInAlbums = selectedAlbums.reduce((acc, a) => acc + (a.photoCount ?? 0), 0);

  const showVideos = filterTab === 'all' || filterTab === 'videos';
  const showAlbums = filterTab === 'all' || filterTab === 'albums';

  return (
    <div className="flex flex-col h-full bg-[#100F1A] rounded-2xl md:rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
      {/* Header with Back Button */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-white/10 flex items-center justify-between bg-[#141322]/80 backdrop-blur-md">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-300 hover:text-white transition-colors group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          <span>{copy.ui9}</span>
        </button>

        <button
          type="button"
          title={copy.ui73}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
         disabled>
          <MoreHorizontal size={18} />
        </button>
      </div>

      {/* Main Review Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 sm:p-6 space-y-6">
        {/* Title & Context */}
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {copy.ui37}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 font-medium mt-1">
            Escolhas do perfil {profileName}
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              filterTab === 'all'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-[#181624] text-slate-300 hover:text-white'
            }`}
          >
            Todos ({totalItemsCount})
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('videos')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              filterTab === 'videos'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-[#181624] text-slate-300 hover:text-white'
            }`}
          >
            {copy.ui4} ({selectedVideos.length})
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('albums')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              filterTab === 'albums'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-[#181624] text-slate-300 hover:text-white'
            }`}
          >
            {copy.ui5} ({selectedAlbums.length})
          </button>
        </div>

        {/* Empty State */}
        {totalItemsCount === 0 && (
          <div className="text-center py-12 px-4 rounded-2xl bg-[#151322] border border-white/5 space-y-3">
            <div className="w-12 h-12 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center mx-auto">
              <Bookmark size={24} />
            </div>
            <h3 className="text-base font-bold text-white">{copy.ui50}</h3>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              {copy.ui65}
            </p>
          </div>
        )}

        {/* Selected Videos Section */}
        {showVideos && selectedVideos.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Film size={15} className="text-purple-400" />
                  <span>{copy.ui38}</span>
                </h3>
                <p className="text-[11px] text-slate-400 font-medium">
                  {formatCount(selectedVideos.length, copy.videos)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {selectedVideos.map(video => (
                <div
                  key={video.id}
                  className="p-2.5 sm:p-3 rounded-xl bg-[#171524] border border-white/10 hover:border-purple-500/40 transition-all flex items-center gap-3 group"
                >
                  {/* Thumbnail */}
                  <div className="relative w-24 sm:w-28 aspect-video rounded-lg overflow-hidden bg-slate-900 shrink-0">
                    <img loading="lazy" decoding="async" src={video.thumbnailUrl}
                      alt={video.title || copy.unnamedMedia}
                      className="w-full h-full object-cover"
                    />
                    {video.duration && (
                      <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/80 text-[9px] font-bold text-white">
                        {video.duration}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs sm:text-sm font-bold text-white truncate leading-tight">
                      {video.title || copy.unnamedMedia}
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {copy.video} • {video.duration || copy.unknownDuration} • {video.resolution || copy.unknownQuality}
                    </p>
                    {video.collectionTitle && (
                      <p className="text-[10px] text-purple-300 font-medium truncate mt-0.5">
                        {video.collectionTitle}
                      </p>
                    )}
                  </div>

                  {/* Purple Selected Checkbox & Remove */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      title={copy.ui51}
                      className="w-6 h-6 rounded-md bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-600/40"
                     disabled>
                      <Check size={14} strokeWidth={3} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveVideo(video.id)}
                      title={copy.ui76}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selected Albums Section */}
        {showAlbums && selectedAlbums.length > 0 && (
          <div className="space-y-3 pt-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Images size={15} className="text-purple-400" />
                <span>{copy.ui39}</span>
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                {formatCount(selectedAlbums.length, copy.albums)}
              </p>
            </div>

            <div className="space-y-2">
              {selectedAlbums.map(album => (
                <div
                  key={album.id}
                  className="p-2.5 sm:p-3 rounded-xl bg-[#171524] border border-white/10 hover:border-purple-500/40 transition-all flex items-center gap-3 group"
                >
                  <div className="relative w-24 sm:w-28 aspect-video rounded-lg overflow-hidden bg-slate-900 shrink-0">
                    <img loading="lazy" decoding="async" src={album.thumbnailUrl}
                      alt={album.title || copy.unnamedMedia}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs sm:text-sm font-bold text-white truncate leading-tight">
                      {album.title || copy.unnamedMedia}
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {copy.albumComplete} • {formatCount(album.photoCount, copy.photos)}
                    </p>
                    <p className="text-[10px] text-purple-300 font-medium truncate mt-0.5">
                      {album.category || copy.ui68}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      title={copy.ui51}
                      className="w-6 h-6 rounded-md bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-600/40"
                     disabled>
                      <Check size={14} strokeWidth={3} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveAlbum(album.id)}
                      title={copy.ui76}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Destination Folder Configuration */}
        <div className="pt-3 border-t border-white/10 space-y-2">
          <label className="block text-[11px] font-semibold text-slate-300">
            {copy.ui41}
          </label>
          <div className="relative">
            <button
              ref={folderTriggerRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={folderDropdownOpen}
              onClick={() => setFolderDropdownOpen(!folderDropdownOpen)}
              className="w-full px-3.5 py-3 rounded-xl bg-[#181624] border border-white/10 text-left text-xs sm:text-sm font-medium text-white flex items-center justify-between hover:bg-[#221F33] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Folder size={16} className="text-purple-400 shrink-0" />
                <span className="truncate">{destinationFolder}</span>
              </div>
              <ChevronDown size={14} className="text-slate-400 shrink-0" />
            </button>

            {folderDropdownOpen && (
              <div 
                ref={folderDropdownRef}
                role="listbox"
                className="absolute left-0 bottom-full mb-1.5 w-full max-h-64 overflow-y-auto no-scrollbar rounded-xl bg-[#1A1828] border border-white/15 p-1.5 shadow-2xl z-30 animate-in fade-in zoom-in-95 duration-150"
              >
                {availableFolders.map(folder => (
                  <button
                    key={folder}
                    type="button"
                    onClick={() => {
                      if (onDestinationFolderChange) onDestinationFolderChange(folder);
                      setFolderDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between ${
                      destinationFolder === folder
                        ? 'bg-purple-600/20 text-purple-300'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span>{folder}</span>
                    {destinationFolder === folder && <Check size={14} className="text-purple-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            {copy.ui66}
          </p>
        </div>

        {/* Action Summary Card (Bottom of review panel) */}
        {totalItemsCount > 0 && (
          <div className="p-4 sm:p-5 rounded-2xl bg-[#161424] border border-white/10 space-y-3.5 shadow-xl">
            <div>
              <span className="text-sm sm:text-base font-extrabold text-white">
                {totalItemsCount} {totalItemsCount === 1 ? copy.ui53 : copy.ui54}
              </span>
              <p className="text-xs text-slate-400 mt-0.5">
                {formatCount(selectedVideos.length, copy.videos)} • {formatCount(selectedAlbums.length, copy.albums)} ({photoCountsKnown ? formatCount(totalPhotosInAlbums, copy.photos) : copy.unknownCount})
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onSaveToGallery}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all active:scale-98"
              >
                <Bookmark size={15} />
                <span>{copy.ui14}</span>
              </button>

              <button
                type="button"
                onClick={onDownloadZip}
                className="w-full py-3 px-4 rounded-xl bg-[#221F33] hover:bg-[#2C2842] border border-white/10 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-98"
              >
                <Download size={15} />
                <span>{copy.ui43}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
