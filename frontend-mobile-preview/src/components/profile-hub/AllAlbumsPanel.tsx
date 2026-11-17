import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React, { useState } from 'react';
import { 
  ArrowLeft, 
  MoreHorizontal, 
  Search, 
  SlidersHorizontal, 
  ChevronDown, 
  Check, 
  Download, 
  FolderPlus, 
  Trash2,
  Images
} from 'lucide-react';
import { AlbumItem } from './profileHubTypes';

interface AllAlbumsPanelProps {
  profileName?: string;
  albums: AlbumItem[];
  selectedAlbumIds: Set<string>;
  onToggleSelectAlbum: (album: AlbumItem) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onOpenAlbum: (album: AlbumItem) => void;
  onBack: () => void;
  onBatchDownload?: () => void;
}

export const AllAlbumsPanel: React.FC<AllAlbumsPanelProps> = ({
  profileName = 'Perfil',
  albums,
  selectedAlbumIds,
  onToggleSelectAlbum,
  onSelectAll,
  onClearAll,
  onOpenAlbum,
  onBack,
  onBatchDownload
}) => {
  const { copy, formatDate, formatCount } = useProfileHubPresentation();
  const [searchTerm, setSearchTerm] = useState('');
  const sortOrder = copy.sourceOrder;

  const filteredAlbums = albums.filter(alb => 
    alb.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const allSelected = filteredAlbums.length > 0 && 
    filteredAlbums.every(alb => selectedAlbumIds.has(alb.id));

  const selectedCount = selectedAlbumIds.size;
  const selectedCountsKnown = albums.filter(alb => selectedAlbumIds.has(alb.id)).every(alb => alb.photoCount != null);
  const selectedPhotosCount = albums
    .filter(alb => selectedAlbumIds.has(alb.id))
    .reduce((acc, alb) => acc + (alb.photoCount ?? 0), 0);

  return (
    <div className="flex flex-col h-full bg-[#100F1A] rounded-2xl md:rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
      {/* Header */}
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

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 sm:p-6 space-y-5">
        {/* Title */}
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {copy.ui33}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 font-medium mt-1">
            {profileName} • {formatCount(albums.length, copy.albums)}
          </p>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={copy.ui78}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#171524] border border-white/10 text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          <button
            type="button"
            className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#171524] border border-white/10 text-xs font-medium text-slate-300 hover:text-white"
           disabled>
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal size={13} className="text-purple-400" />
              <span>{sortOrder}</span>
            </div>
            <ChevronDown size={13} />
          </button>
        </div>

        {/* Select All Checkbox */}
        <div className="flex items-center justify-between pt-1 border-t border-white/10">
          <label className="flex items-center gap-2.5 cursor-pointer text-xs sm:text-sm font-semibold text-slate-300 hover:text-white">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                if (allSelected) onClearAll();
                else onSelectAll();
              }}
              className="w-4 h-4 rounded text-purple-600 bg-[#1A1828] border-white/20 focus:ring-purple-500 focus:ring-offset-0"
            />
            <span>{copy.ui17}</span>
          </label>

          <span className="text-xs text-slate-400">
            {filteredAlbums.length} no total
          </span>
        </div>

        {/* Albums Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {filteredAlbums.map(album => {
            const isSelected = selectedAlbumIds.has(album.id);
            return (
              <div
                key={album.id}
                onClick={() => onOpenAlbum(album)}
                className={`relative rounded-2xl overflow-hidden bg-[#161522] border transition-all cursor-pointer group flex flex-col ${
                  isSelected
                    ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                    : 'border-white/10 hover:border-white/25 hover:bg-[#1C1A2C]'
                }`}
              >
                {/* Thumbnail */}
                <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                  <img loading="lazy" decoding="async" src={album.thumbnailUrl}
                    alt={album.title || copy.unnamedMedia}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />

                  {/* Top-Left Selection Checkbox */}
                  <button
                    type="button"
                    aria-label={copy.ui75}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelectAlbum(album);
                    }}
                    className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-md flex items-center justify-center transition-all z-10 ${
                      isSelected
                        ? 'bg-purple-600 text-white shadow-md shadow-purple-600/50 ring-1 ring-purple-400'
                        : 'bg-black/60 border border-white/40 text-transparent hover:border-white'
                    }`}
                  >
                    <Check size={14} strokeWidth={3} className={isSelected ? 'opacity-100' : 'opacity-0'} />
                  </button>
                </div>

                {/* Info */}
                <div className="p-3.5 flex items-start justify-between gap-2 flex-1">
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-purple-200 transition-colors">
                      {album.title || copy.unnamedMedia}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 font-medium">
                      {formatCount(album.photoCount, copy.photos)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Batch Selection Card (Bottom of Albums) */}
        {selectedCount > 0 && (
          <div className="p-4 sm:p-5 rounded-2xl bg-[#161424] border border-white/10 space-y-3.5 shadow-xl">
            <div className="flex items-center gap-2">
              <Images size={18} className="text-purple-400" />
              <div>
                <span className="text-sm font-bold text-white">
                  {selectedCount} {selectedCount === 1 ? copy.ui57 : copy.ui58}
                </span>
                <p className="text-[11px] text-slate-400">
                  {selectedCountsKnown ? formatCount(selectedPhotosCount, copy.photos) : copy.unknownCount}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="py-2.5 px-3 rounded-xl bg-[#221F33] hover:bg-[#2C2842] border border-white/10 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all"
               disabled>
                <FolderPlus size={14} />
                <span>{copy.ui40}</span>
              </button>

              <button
                type="button"
                onClick={onClearAll}
                className="py-2.5 px-3 rounded-xl bg-[#221F33] hover:bg-rose-950/40 border border-white/10 text-slate-300 hover:text-rose-300 font-medium text-xs flex items-center justify-center gap-1.5 transition-all"
              >
                <Trash2 size={14} />
                <span>{copy.ui76}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onBatchDownload}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all"
            >
              <Download size={15} />
              <span>{copy.ui44}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
