import React, { useState, useMemo, useEffect } from 'react';
import {
  Compass,
  Film,
  Zap,
  FolderHeart,
  Clock,
  ArrowRight,
  Sparkles,
  Folder,
  Play,
  Images,
  ExternalLink,
  Layers,
  ChevronRight,
  LucideIcon,
  Flame
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import { Album, VideoItem, ViewId } from '../../types';
import { IconBadge, IconBadgeVariant } from '../common/IconBadge';
import { getAlbumMediaSummary } from '../../utils/mediaClassification';

interface UnifiedRecentItem {
  id: string;
  type: 'album' | 'video' | 'gif';
  title: string;
  timestamp: number;
  folder: string;
  thumbnailUrl?: string;
  subLabel?: string;
  album?: Album;
  video?: VideoItem;
}

const isGifAlbum = (album: Album): boolean => {
  const summary = getAlbumMediaSummary(album);
  return summary.gifCount > 0 && summary.photoCount === 0;
};

export const HomeView: React.FC = () => {
  const {
    albums,
    videos,
    syncAlbums,
    syncVideos,
    navigateToView,
    setActivePlayingVideo,
    setSlideshowOpen,
    settings
  } = useAppStore();

  useEffect(() => {
    // App initializes the library once. Later visits refresh in the background.
    if (useAppStore.getState().backendOnline) {
      syncAlbums(false);
      syncVideos();
    }
  }, [syncAlbums, syncVideos]);

  const isEn = settings.language === 'en-US';
  const t = translations[settings.language]?.homeView || (translations['pt-BR'] as any).homeView;
  const [activeMediaFilter, setActiveMediaFilter] = useState<'all' | 'album' | 'video' | 'gif'>('all');

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return t.greetingMorning || (isEn ? 'Good morning' : 'Bom dia');
    if (hour >= 12 && hour < 18) return t.greetingAfternoon || (isEn ? 'Good afternoon' : 'Boa tarde');
    return t.greetingEvening || (isEn ? 'Good evening' : 'Boa noite');
  }, [t, isEn]);

  const gifCount = useMemo(() => {
    return albums.filter(isGifAlbum).length;
  }, [albums]);

  // Combine and sort recent items (albums, videos, and gifs)
  const allRecentItems = useMemo<UnifiedRecentItem[]>(() => {
    const list: UnifiedRecentItem[] = [];

    const parseTime = (dateStr?: string) => {
      if (!dateStr) return 0;
      const parsed = new Date(dateStr).getTime();
      if (!isNaN(parsed) && parsed > 0) return parsed;
      const clean = dateStr.replace(' UTC', 'Z').replace(' ', 'T');
      const fallback = new Date(clean).getTime();
      return !isNaN(fallback) ? fallback : 0;
    };

    // Albums & GIFs
    albums.forEach(album => {
      const dateStr = album.updatedAt || album.createdAt;
      const parsedTime = parseTime(dateStr);
      const cover = album.coverImage || album.rawCoverImage || album.images?.[0]?.thumbnailUrl || '';
      const isGif = isGifAlbum(album);
      list.push({
        id: album.id,
        type: isGif ? 'gif' : 'album',
        title: album.title || (isEn ? 'Untitled Album' : (t.untitledAlbum || 'Álbum Sem Título')),
        timestamp: parsedTime,
        folder: album.folder || (isEn ? 'General' : 'Geral'),
        thumbnailUrl: cover,
        subLabel: isGif
          ? `${album.gifCount || album.imageCount || album.images?.length || 0} ${t.statGifs || 'GIFs'}`
          : `${album.imageCount || album.images?.length || 0} ${isEn ? 'photos' : 'fotos'}`,
        album
      });
    });

    // Videos
    videos.forEach(video => {
      const dateStr = video.updatedAt || video.createdAt;
      const parsedTime = parseTime(dateStr);
      list.push({
        id: video.id,
        type: 'video',
        title: video.title || video.filename || (isEn ? 'Untitled Video' : (t.untitledVideo || 'Vídeo Sem Título')),
        timestamp: parsedTime,
        folder: video.folder || (isEn ? 'Extracted' : 'Extraídos'),
        thumbnailUrl: video.thumbnailUrl || '',
        subLabel: video.format ? video.format.toUpperCase() : 'MP4',
        video
      });
    });

    // Sort descending by timestamp with stable tie-breaker
    return list.sort((a, b) => (b.timestamp - a.timestamp) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }, [albums, videos, isEn, t.statGifs, t.untitledAlbum, t.untitledVideo]);

  const recentAll = useMemo(() => allRecentItems.slice(0, 18), [allRecentItems]);
  const recentAlbums = useMemo(() => allRecentItems.filter(i => i.type === 'album').slice(0, 18), [allRecentItems]);
  const recentVideos = useMemo(() => allRecentItems.filter(i => i.type === 'video').slice(0, 18), [allRecentItems]);
  const recentGifs = useMemo(() => allRecentItems.filter(i => i.type === 'gif').slice(0, 18), [allRecentItems]);

  const displayedRecentItems = useMemo(() => {
    if (activeMediaFilter === 'album') return recentAlbums;
    if (activeMediaFilter === 'video') return recentVideos;
    if (activeMediaFilter === 'gif') return recentGifs;
    return recentAll;
  }, [activeMediaFilter, recentAll, recentAlbums, recentVideos, recentGifs]);


  const modules: Array<{
    id: ViewId;
    title: string;
    description: string;
    icon: LucideIcon;
    accentColor: string;
    iconVariant: IconBadgeVariant;
    badge?: string;
    badgeStyle?: string;
    stat?: string;
  }> = [
    {
      id: 'multi-album',
      title: t.moduleMultiAlbumTitle || (isEn ? 'Multi-Album Extractor' : 'Extrator de Multi-Álbum'),
      description: t.moduleMultiAlbumDesc || (isEn ? 'Mass scanning of creator profiles and categories with real-time streaming.' : 'Varredura em massa de perfis, criadores e galerias com streaming em tempo real.'),
      icon: Compass,
      accentColor: 'indigo',
      iconVariant: 'sapphire'
    },
    {
      id: 'web-video-scraper',
      title: t.moduleWebVideoTitle || (isEn ? 'Web Video Extractor' : 'Extrator de Vídeos Web'),
      description: t.moduleWebVideoDesc || (isEn ? 'Concurrent scraping and download of web channels and videos with built-in player.' : 'Raspagem e download concorrente de canais e vídeos com player integrado.'),
      icon: Film,
      accentColor: 'violet',
      iconVariant: 'rose'
    },
    {
      id: 'extractor',
      title: t.moduleExtractorTitle || (isEn ? 'Media Extractor' : 'Extrator de Mídia Individual'),
      description: t.moduleExtractorDesc || (isEn ? 'Surgical extraction with ReAct AI and Gemini to resolve lossless original files.' : 'Análise cirúrgica com IA ReAct e Gemini para resolver arquivos originais.'),
      icon: Zap,
      accentColor: 'brand',
      iconVariant: 'neon'
    },
    {
      id: 'gallery',
      title: t.moduleGalleryTitle || (isEn ? 'Album Library' : 'Biblioteca de Álbuns'),
      description: t.moduleGalleryDesc || (isEn ? 'Browse, semantic search, intelligent folders and high-resolution grid preview.' : 'Navegação, busca semântica, pastas inteligentes e visualização em grade.'),
      icon: FolderHeart,
      accentColor: 'purple',
      iconVariant: 'gold',
      stat: `${albums.length} ${isEn ? 'albums' : 'álbuns'}`
    },
    {
      id: 'videos',
      title: t.moduleVideosTitle || (isEn ? 'Video Gallery' : 'Galeria de Vídeos'),
      description: t.moduleVideosDesc || (isEn ? 'Immersive video player, custom folders and organized file management.' : 'Reprodutor de vídeo imersivo, pastas personalizadas e gestão de arquivos.'),
      icon: Layers,
      accentColor: 'emerald',
      iconVariant: 'emerald',
      stat: `${videos.length} ${isEn ? 'videos' : 'vídeos'}`
    },
    {
      id: 'shorts',
      title: isEn ? 'Shorts & Reels (Videos & Photos)' : 'Shorts & Reels (Vídeos e Fotos)',
      description: isEn ? 'Vertical dopamine feed for videos, photos and GIFs with random shuffle, orientation filters and auto-advance.' : 'Feed vertical de alta dopamina para vídeos, fotos e GIFs com modo aleatório, orientação e auto-avanço.',
      icon: Flame,
      accentColor: 'rose',
      iconVariant: 'rose',
      badge: 'DOPAMINE'
    }
  ];

  const handleRecentClick = (item: UnifiedRecentItem) => {
    if ((item.type === 'album' || item.type === 'gif') && item.album) {
      navigateToView('album-detail', item.album.id);
    } else if (item.type === 'video' && item.video) {
      setActivePlayingVideo(item.video);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 animate-fade-in touch-scroll">
      {/* Welcome Banner / Header */}
      <div className="relative p-6 sm:p-8 rounded-3xl glass-panel-elevated border border-border overflow-hidden">
        {/* Ambient Gradient Glows */}
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-64 h-64 bg-accent-purple/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/40">
                IMAGEX.AI STUDIO
              </span>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-surface-elevated text-slate-400 border border-border flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t.systemReady || (isEn ? 'System Ready' : 'Sistema Pronto')}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight flex items-center gap-3">
              <span>{greeting},</span>
              <span className="bg-gradient-to-r from-brand-400 via-indigo-300 to-accent-purple bg-clip-text text-transparent">
                {t.commandCenter || (isEn ? 'Command Center' : 'Central de Operações')}
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              {t.welcomeSubtitle || (isEn ? 'Select a tool to start or pick up where you left off.' : 'Selecione uma ferramenta para iniciar ou continue de onde parou.')}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="px-4 py-3 rounded-2xl bg-surface-elevated/80 border border-border flex items-center gap-3 shadow-inner">
              <IconBadge icon={<FolderHeart size={18} />} variant="gold" size="md" />
              <div>
                <div className="text-xs font-bold text-slate-200">{albums.length}</div>
                <div className="text-[10px] text-slate-400">{isEn ? 'Albums' : 'Álbuns'}</div>
              </div>
            </div>
            <div className="px-4 py-3 rounded-2xl bg-surface-elevated/80 border border-border flex items-center gap-3 shadow-inner">
              <IconBadge icon={<Film size={18} />} variant="rose" size="md" />
              <div>
                <div className="text-xs font-bold text-slate-200">{videos.length}</div>
                <div className="text-[10px] text-slate-400">{isEn ? 'Videos' : 'Vídeos'}</div>
              </div>
            </div>
            <div className="px-4 py-3 rounded-2xl bg-surface-elevated/80 border border-border flex items-center gap-3 shadow-inner">
              <IconBadge icon={<Zap size={18} />} variant="neon" size="md" />
              <div>
                <div className="text-xs font-bold text-slate-200">{gifCount}</div>
                <div className="text-[10px] text-slate-400">{t.statGifs || 'GIFs'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Launchpad Grid: Core Modules */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <IconBadge icon={<Sparkles size={14} />} variant="neon" size="xs" />
            <span>{t.availableTools || (isEn ? 'Available Tools' : 'Ferramentas do Sistema')}</span>
          </h2>
          <button
            onClick={() => setSlideshowOpen(true, 0, 'global')}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-fuchsia-600 hover:from-brand-500 hover:to-fuchsia-500 text-white text-xs font-bold flex items-center gap-2 shadow-glow-brand transition-all cursor-pointer"
          >
            <Sparkles size={14} className="text-amber-200" />
            <span>{isEn ? 'Global Slider (All App Photos & GIFs)' : 'Slider Global (Todas as Fotos e GIFs)'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map(mod => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                onClick={() => navigateToView(mod.id)}
                className="p-5 rounded-3xl bg-surface-elevated/60 hover:bg-surface-elevated border border-border hover:border-brand-500/40 transition-all duration-200 group text-left relative overflow-hidden shadow-lg hover:shadow-glow-brand flex flex-col justify-between cursor-pointer"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <IconBadge icon={<Icon size={20} />} variant={mod.iconVariant} size="lg" />

                    <div className="flex items-center gap-2">
                      {mod.stat && (
                        <span className="text-[11px] font-mono font-semibold text-slate-400 px-2 py-0.5 rounded-lg bg-surface border border-border">
                          {mod.stat}
                        </span>
                      )}
                      {mod.badge && (
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${mod.badgeStyle || 'bg-brand-500/20 text-brand-300 border-brand-500/30'}`}>
                          {mod.badge}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-slate-100 group-hover:text-brand-300 transition-colors flex items-center justify-between">
                      <span>{mod.title}</span>
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed mt-1 line-clamp-2">
                      {mod.description}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs font-semibold text-slate-400 group-hover:text-slate-200 transition-colors">
                  <span>{t.openModule || (isEn ? 'Open tool' : 'Abrir ferramenta')}</span>
                  <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform text-brand-400" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Pick Up Where You Left Off (Recent Items Carousel) */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconBadge icon={<Clock size={14} />} variant="cyan" size="xs" />
            <h2 className="text-base font-extrabold text-slate-100">
              {t.recentSectionTitle || (isEn ? 'Pick up where you left off' : 'Continuar de Onde Parou')}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateToView('gallery')}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-brand-300 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
              title={t.viewAllAlbums || (isEn ? 'View all albums' : 'Ver todos os álbuns')}
            >
              <FolderHeart size={13} className="text-purple-400" />
              <span>{t.viewAllAlbums || (isEn ? 'View all albums' : 'Ver todos os álbuns')}</span>
            </button>
            <button
              onClick={() => navigateToView('videos')}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-violet-300 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
              title={t.viewAllVideos || (isEn ? 'View all videos' : 'Ver todos os vídeos')}
            >
              <Film size={13} className="text-violet-400" />
              <span>{t.viewAllVideos || (isEn ? 'View all videos' : 'Ver todos os vídeos')}</span>
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setActiveMediaFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
              activeMediaFilter === 'all'
                ? 'bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-brand-600/30 ring-1 ring-brand-400/40'
                : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
            }`}
          >
            <span>{t.filterAll || (isEn ? 'All' : 'Todos')}</span>
            <span className="text-[10px] opacity-70">({recentAll.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMediaFilter('album')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
              activeMediaFilter === 'album'
                ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-blue-600/30 ring-1 ring-blue-400/40'
                : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
            }`}
          >
            <Images size={13} className={activeMediaFilter === 'album' ? 'text-white' : 'text-cyan-400'} />
            <span>{t.filterAlbums || (isEn ? 'Photo Albums' : 'Álbuns de Fotos')}</span>
            <span className="text-[10px] opacity-70">({recentAlbums.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMediaFilter('video')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
              activeMediaFilter === 'video'
                ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-violet-600/30 ring-1 ring-violet-400/40'
                : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
            }`}
          >
            <Film size={13} className={activeMediaFilter === 'video' ? 'text-white' : 'text-violet-400'} />
            <span>{t.filterVideos || (isEn ? 'Videos' : 'Vídeos')}</span>
            <span className="text-[10px] opacity-70">({recentVideos.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMediaFilter('gif')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
              activeMediaFilter === 'gif'
                ? 'bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white shadow-fuchsia-600/30 ring-1 ring-fuchsia-400/40'
                : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
            }`}
          >
            <Zap size={13} className={activeMediaFilter === 'gif' ? 'text-white' : 'text-fuchsia-400'} />
            <span>{t.filterGifs || (isEn ? 'Animated GIFs' : 'GIFs Animados')}</span>
            <span className="text-[10px] opacity-70">({recentGifs.length})</span>
          </button>
        </div>

        {displayedRecentItems.length > 0 ? (
          <div
            onWheel={(e) => {
              e.currentTarget.scrollLeft += e.deltaY;
            }}
            className="flex gap-4 overflow-x-auto no-scrollbar touch-scroll pb-3 pt-1 -mx-1 px-1"
          >
            {displayedRecentItems.map(item => {

              const isVideo = item.type === 'video';
              const isGif = item.type === 'gif';
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => handleRecentClick(item)}
                  className="w-60 sm:w-64 shrink-0 rounded-2xl bg-surface-elevated/70 hover:bg-surface-elevated border border-border hover:border-brand-500/50 transition-all duration-200 p-3 flex flex-col justify-between cursor-pointer group shadow-md hover:shadow-glow-brand"
                >
                  <div className="space-y-2.5">
                    {/* Media Thumbnail */}
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-950/80 flex items-center justify-center border border-border relative group/thumb">
                      {/* Fallback placeholder background icon always rendered */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 gap-1 bg-slate-950">
                        {isVideo ? <Film size={24} /> : isGif ? <Zap size={24} className="text-fuchsia-500/50" /> : <Images size={24} />}
                      </div>

                      {item.thumbnailUrl && (
                        <img
                          src={item.thumbnailUrl.startsWith('/') || item.thumbnailUrl.startsWith('data:') ? item.thumbnailUrl : `/api/proxy-image?url=${encodeURIComponent(item.thumbnailUrl)}`}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-300 relative z-10"
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}

                      {/* Type Overlay Badge */}
                      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md backdrop-blur-md border flex items-center gap-1 ${
                          isVideo
                            ? 'bg-violet-950/80 text-violet-300 border-violet-500/40'
                            : isGif
                            ? 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-500/40'
                            : 'bg-brand-950/80 text-brand-300 border-brand-500/40'
                        }`}>
                          {isVideo ? (
                            <>
                              <Film size={10} className="text-violet-400" />
                              <span>{t.videoBadge || (isEn ? 'Video' : 'Vídeo')}</span>
                            </>
                          ) : isGif ? (
                            <>
                              <Zap size={10} className="text-fuchsia-400" />
                              <span>{t.gifBadge || (isEn ? 'GIF' : 'GIF Animado')}</span>
                            </>
                          ) : (
                            <>
                              <Images size={10} className="text-brand-400" />
                              <span>{t.albumBadge || (isEn ? 'Album' : 'Álbum')}</span>
                            </>
                          )}
                        </span>
                      </div>

                      {/* Folder Overlay Badge - only display for specific custom folders, not default root folder */}
                      {item.folder && item.folder !== 'Geral' && item.folder !== 'General' && item.folder !== 'My Fun new Collection' && (
                        <div className="absolute bottom-2 left-2 z-10">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-black/75 text-slate-300 backdrop-blur-md border border-white/10 flex items-center gap-1">
                            <Folder size={10} className="text-purple-400" />
                            <span className="truncate max-w-[120px]">{item.folder}</span>
                          </span>
                        </div>
                      )}

                      {/* Play / Inspect overlay icon */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-brand-600/90 text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                          {isVideo ? <Play size={16} className="fill-current ml-0.5" /> : <ExternalLink size={16} />}
                        </div>
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-slate-200 group-hover:text-brand-300 transition-colors truncate" title={item.title}>
                        {item.title}
                      </h4>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{item.subLabel}</span>
                        {item.timestamp > 0 && (
                          <span className="font-mono text-[10px]">
                            {new Date(item.timestamp).toLocaleDateString(isEn ? 'en-US' : 'pt-BR', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 rounded-2xl bg-surface-elevated/40 border border-border border-dashed text-center space-y-3">
            <IconBadge
              icon={<Images size={22} />}
              variant="cyan"
              size="lg"
              className="mx-auto"
            />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-300">
                {t.noRecentItems || (isEn ? 'No recent items found.' : 'Nenhum item recente encontrado.')}
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {t.noRecentHint}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
