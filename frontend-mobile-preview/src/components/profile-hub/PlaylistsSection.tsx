import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React, { useRef } from 'react';
import { PlayCircle, ChevronRight, Play, MoreHorizontal } from 'lucide-react';
import { PlaylistItem } from './profileHubTypes';

interface PlaylistsSectionProps {
  playlists: PlaylistItem[];
  activePlaylistId?: string;
  onSelectPlaylist: (playlist: PlaylistItem) => void;
  onSeeAll?: () => void;
}

export const PlaylistsSection: React.FC<PlaylistsSectionProps> = ({
  playlists,
  activePlaylistId,
  onSelectPlaylist,
  onSeeAll
}) => {
  const { copy, formatDate, formatCount } = useProfileHubPresentation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollNext = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 300, behavior: 'smooth' });
    }
  };

  return (
    <div className="mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <PlayCircle size={18} className="text-purple-400" />
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
            {copy.ui3}
          </h2>
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs sm:text-sm font-medium text-slate-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
        >
          <span>{copy.ui2}</span>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Playlists Track */}
      <div className="relative group">
        <div
          ref={scrollRef}
          className="flex items-stretch gap-4 overflow-x-auto no-scrollbar pb-2 snap-x snap-mandatory"
        >
          {playlists.map(playlist => {
            const isSelected = activePlaylistId === playlist.id;
            return (
              <div
                key={playlist.id}
                onClick={() => onSelectPlaylist(playlist)}
                className={`relative shrink-0 w-[220px] sm:w-[260px] rounded-2xl overflow-hidden bg-[#161522] border transition-all cursor-pointer group/card snap-start flex flex-col ${
                  isSelected
                    ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.25)]'
                    : 'border-white/10 hover:border-white/25 hover:bg-[#1C1A2C]'
                }`}
              >
                {/* Thumbnail Container */}
                <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                  <img loading="lazy" decoding="async" src={playlist.thumbnailUrl}
                    alt={playlist.title || copy.unnamedMedia}
                    className="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

                  {/* Play Overlay Button */}
                  <div className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-black/60 backdrop-blur-md border border-white/30 flex items-center justify-center text-white group-hover/card:bg-purple-600 group-hover/card:border-purple-500 transition-all">
                    <Play size={14} fill="white" className="ml-0.5" />
                  </div>
                </div>

                {/* Info Container */}
                <div className="p-3.5 flex items-start justify-between gap-2 flex-1">
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-white truncate leading-tight group-hover/card:text-purple-200 transition-colors">
                      {playlist.title || copy.unnamedMedia}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 font-medium">
                      {formatCount(playlist.videoCount, copy.videos)} • {formatDate(playlist.updatedAtRaw || playlist.lastAddedDate || playlist.updatedAt, playlist.metadataStatus)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    title={copy.ui72}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Next Arrow on Desktop */}
        <button
          type="button"
          onClick={scrollNext}
          title={copy.ui69}
          className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#181624]/90 border border-white/20 items-center justify-center text-white shadow-xl hover:bg-purple-600 hover:border-purple-500 transition-all z-10"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};
