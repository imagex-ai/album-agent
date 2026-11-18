import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React, { useRef } from 'react';
import { Images, ChevronRight } from 'lucide-react';
import { AlbumItem } from './profileHubTypes';

interface AlbumsSectionProps {
  albums: AlbumItem[];
  activeAlbumId?: string;
  onSelectAlbum: (album: AlbumItem) => void;
  onSeeAll?: () => void;
}

export const AlbumsSection: React.FC<AlbumsSectionProps> = ({
  albums,
  activeAlbumId,
  onSelectAlbum,
  onSeeAll
}) => {
  const { copy, formatDate, formatCount } = useProfileHubPresentation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollNext = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 280, behavior: 'smooth' });
    }
  };

  return (
    <div className="mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Images size={18} className="text-purple-400" />
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
            {copy.ui5}
          </h2>
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs sm:text-sm font-medium text-slate-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
        >
          <span>{copy.ui1}</span>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Albums Track */}
      <div className="relative group">
        <div
          ref={scrollRef}
          className="flex items-stretch gap-4 overflow-x-auto no-scrollbar pb-2 snap-x snap-mandatory"
        >
          {albums.map(album => {
            const isSelected = activeAlbumId === album.id;
            return (
              <div
                key={album.id}
                onClick={() => onSelectAlbum(album)}
                className={`relative shrink-0 w-[180px] sm:w-[210px] rounded-2xl overflow-hidden bg-[#161522] border transition-all cursor-pointer group/card snap-start flex flex-col ${
                  isSelected
                    ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.25)]'
                    : 'border-white/10 hover:border-white/25 hover:bg-[#1C1A2C]'
                }`}
              >
                {/* Thumbnail */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900">
                  <img loading="lazy" decoding="async" src={album.thumbnailUrl}
                    alt={album.title || copy.unnamedMedia}
                    className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                </div>

                {/* Info */}
                <div className="p-3">
                  <h3 className="text-xs sm:text-sm font-bold text-white truncate leading-tight group-hover/card:text-purple-200 transition-colors">
                    {album.title || copy.unnamedMedia}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 font-medium">
                    {formatCount(album.photoCount, copy.photos)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Next Arrow on Desktop */}
        <button
          type="button"
          onClick={scrollNext}
          title={copy.ui70}
          className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#181624]/90 border border-white/20 items-center justify-center text-white shadow-xl hover:bg-purple-600 hover:border-purple-500 transition-all z-10"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};
