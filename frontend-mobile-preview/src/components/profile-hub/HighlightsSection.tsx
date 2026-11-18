import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React, { useRef, useState } from 'react';
import { Sparkles, ChevronRight, Play } from 'lucide-react';
import { HighlightItem } from './profileHubTypes';

interface HighlightsSectionProps {
  highlights: HighlightItem[];
  onSelectHighlight: (item: HighlightItem) => void;
  onSeeAll?: () => void;
}

export const HighlightsSection: React.FC<HighlightsSectionProps> = ({
  highlights,
  onSelectHighlight,
  onSeeAll
}) => {
  const { copy } = useProfileHubPresentation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const heroItem = highlights.find(h => h.isHero) || highlights[0];
  const secondaryItems = highlights.filter(h => !h.isHero);

  const scrollNext = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 300, behavior: 'smooth' });
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const progress = el.scrollLeft / (el.scrollWidth - el.clientWidth || 1);
    const index = Math.min(Math.round(progress * highlights.length), highlights.length - 1);
    setActiveIndex(index);
  };

  return (
    <div className="mb-8">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-400" />
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
            {copy.ui0}
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

      {/* Highlights Horizontal Scroll Track */}
      <div className="relative group">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex items-stretch gap-3.5 sm:gap-4 overflow-x-auto no-scrollbar pb-2 snap-x snap-mandatory"
        >
          {/* Main Hero Highlight Card (Wider aspect to accommodate full subtitle) */}
          {heroItem && (
            <div
              key={heroItem.id}
              onClick={() => onSelectHighlight(heroItem)}
              className="relative shrink-0 w-[300px] sm:w-[380px] md:w-[420px] aspect-[16/10] rounded-2xl overflow-hidden bg-slate-900 border border-white/10 shadow-lg cursor-pointer group/card hover:border-purple-500/50 transition-all snap-start"
            >
              <img loading="lazy" decoding="async" src={heroItem.thumbnailUrl}
                alt={heroItem.title || copy.unnamedMedia}
                className="w-full h-full object-cover object-center group-hover/card:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />

              {/* Top Tag */}
              {heroItem.tag && (
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-purple-600/90 text-[10px] font-bold text-white tracking-wider uppercase shadow-md">
                  {heroItem.tag === 'video' ? copy.videos : heroItem.tag === 'album' ? copy.albums : heroItem.tag}
                </div>
              )}

              {/* Bottom Info and Play Button */}
              <div className="absolute inset-x-0 bottom-0 p-3.5 sm:p-4 flex items-end justify-between gap-3">
                <div className="min-w-0 pr-1 flex-1">
                  <h3 className="text-sm sm:text-base font-bold text-white leading-tight truncate">
                    {heroItem.title || copy.unnamedMedia}
                  </h3>
                  {heroItem.subtitle && (
                    <p className="text-[11px] sm:text-xs text-slate-300 font-normal leading-snug mt-1 line-clamp-2">
                      {heroItem.subtitle}
                    </p>
                  )}
                </div>

                {/* Circular Play Button */}
                <div className="shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/20 backdrop-blur-md border border-white/40 flex items-center justify-center text-white shadow-lg group-hover/card:bg-purple-600 group-hover/card:border-purple-500 group-hover/card:scale-110 transition-all">
                  <Play size={16} fill="white" className="ml-0.5" />
                </div>
              </div>
            </div>
          )}

          {/* Secondary Highlight Cards */}
          {secondaryItems.map(item => (
            <div
              key={item.id}
              onClick={() => onSelectHighlight(item)}
              className="relative shrink-0 w-[160px] sm:w-[190px] md:w-[200px] aspect-[16/10] rounded-2xl overflow-hidden bg-slate-900 border border-white/10 shadow-lg cursor-pointer group/card hover:border-purple-500/50 transition-all snap-start flex flex-col justify-end"
            >
              <img loading="lazy" decoding="async" src={item.thumbnailUrl}
                alt={item.title || copy.unnamedMedia}
                className="absolute inset-0 w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

              <div className="relative p-3">
                <h3 className="text-xs sm:text-sm font-bold text-white leading-tight truncate">
                  {item.title || copy.unnamedMedia}
                </h3>
                {item.countLabel && (
                  <p className="text-[10px] sm:text-[11px] text-slate-300 font-medium mt-0.5">
                    {item.countLabel}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Carousel Arrow Button on Desktop */}
        <button
          type="button"
          onClick={scrollNext}
          title={copy.ui71}
          className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#181624]/90 border border-white/20 items-center justify-center text-white shadow-xl hover:bg-purple-600 hover:border-purple-500 transition-all z-10"
        >
          <ChevronRight size={18} />
        </button>

        {/* Dots Indicators for Mobile */}
        <div className="flex md:hidden items-center justify-center gap-1.5 mt-3">
          {highlights.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                activeIndex === i ? 'w-5 bg-purple-500' : 'w-1.5 bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
