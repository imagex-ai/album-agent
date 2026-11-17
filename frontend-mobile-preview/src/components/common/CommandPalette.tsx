import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Zap,
  FolderHeart,
  Activity,
  Copy,
  Terminal,
  BarChart3,
  Settings,
  X,
  BookOpen,
  Film,
  Compass,
  Folder,
  Clapperboard,
  Video
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import {
  getModalAnimationClass,
  getSpeedClass,
  getDistanceClass
} from '../../services/motionConfig';
import { ViewId, Album, VideoItem, AlbumFolder, VideoFolder } from '../../types';
import { IconBadge } from './IconBadge';

interface PaletteItem {
  id: string;
  category: 'nav' | 'folder' | 'album' | 'video';
  label: string;
  subLabel?: string;
  badge?: string;
  icon?: React.ElementType;
  thumbnail?: string;
  onSelect: () => void;
}

export const CommandPalette: React.FC = () => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    navigateToView,
    albums,
    albumFolders,
    setActiveAlbumFolder,
    videos,
    videoFolders,
    setActiveVideoFolder,
    setActivePlayingVideo,
    settings
  } = useAppStore();

  const t = translations[settings.language].commandPalette;
  const isEn = settings.language === 'en-US';

  // Navigation Commands
  const navCommands = [
    { label: t.goToExtractor, viewId: 'extractor' as ViewId, icon: Zap },
    { label: t.goToMultiAlbum, viewId: 'multi-album' as ViewId, icon: Compass },
    { label: t.goToWebVideoScraper, viewId: 'web-video-scraper' as ViewId, icon: Film },
    { label: t.goToGallery, viewId: 'gallery' as ViewId, icon: FolderHeart },
    { label: t.goToVideos, viewId: 'videos' as ViewId, icon: Film },
    { label: t.goToLiveMonitor, viewId: 'live-monitor' as ViewId, icon: Activity },
    { label: t.goToDuplicates, viewId: 'duplicates' as ViewId, icon: Copy },
    { label: t.goToDomainPatterns, viewId: 'domain-patterns' as ViewId, icon: BookOpen },
    { label: t.goToRealtimeLogs, viewId: 'realtime-logs' as ViewId, icon: Terminal },
    { label: t.goToPerformance, viewId: 'performance-metrics' as ViewId, icon: BarChart3 },
    { label: t.goToSettings, viewId: 'settings' as ViewId, icon: Settings },
  ];

  const q = query.trim().toLowerCase();

  // 1. Navigation items
  const filteredNav: PaletteItem[] = navCommands
    .filter(c => !q || c.label.toLowerCase().includes(q))
    .map(c => ({
      id: `nav-${c.viewId}`,
      category: 'nav',
      label: c.label,
      icon: c.icon,
      badge: t.open,
      onSelect: () => {
        navigateToView(c.viewId);
        setCommandPaletteOpen(false);
      }
    }));

  // 2. Folder items (shows recent examples when search is empty, or filtered matches)
  const matchedAlbumFolders = (albumFolders || [])
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .slice(0, !q ? 3 : 6)
    .map(f => ({
      id: `folder-album-${f.id || f.name}`,
      category: 'folder' as const,
      label: f.name,
      subLabel: `${f.count || 0} ${t.photos || (isEn ? 'photos' : 'fotos')} • ${t.albumFolder || (isEn ? 'Album Folder' : 'Pasta de Álbuns')}`,
      icon: Folder,
      badge: t.folder || (isEn ? 'Folder' : 'Pasta'),
      onSelect: () => {
        setActiveAlbumFolder(f.name);
        navigateToView('gallery');
        setCommandPaletteOpen(false);
      }
    }));

  const matchedVideoFolders = (videoFolders || [])
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .slice(0, !q ? 3 : 6)
    .map(f => ({
      id: `folder-video-${f.id || f.name}`,
      category: 'folder' as const,
      label: f.name,
      subLabel: `${f.videoCount || 0} ${isEn ? 'videos' : 'vídeos'} • ${t.videoFolder || (isEn ? 'Video Folder' : 'Pasta de Vídeos')}`,
      icon: Folder,
      badge: t.folder || (isEn ? 'Folder' : 'Pasta'),
      onSelect: () => {
        setActiveVideoFolder(f.name);
        navigateToView('videos');
        setCommandPaletteOpen(false);
      }
    }));

  const filteredFolders = [...matchedAlbumFolders, ...matchedVideoFolders];

  // 3. Album items (including GIF detection and examples when empty)
  const filteredAlbums: PaletteItem[] = (albums || [])
    .filter(a => {
      if (!q) return true;
      const isGifQuery = q === 'gif' || q === 'gifs' || q === 'animado';
      const hasGif = a.hasGifs || a.mediaType === 'gif' || (a.tags && a.tags.some(tItem => tItem.toLowerCase().includes('gif')));
      if (isGifQuery && hasGif) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.tags && a.tags.some(tItem => tItem.toLowerCase().includes(q))) ||
        (a.sourceDomain && a.sourceDomain.toLowerCase().includes(q)) ||
        (a.folder && a.folder.toLowerCase().includes(q))
      );
    })
    .slice(0, !q ? 4 : 8)
    .map(a => {
      const isGif = a.hasGifs || a.mediaType === 'gif' || (a.tags && a.tags.some(tItem => tItem.toLowerCase().includes('gif')));
      return {
        id: `album-${a.id}`,
        category: 'album',
        label: a.title,
        subLabel: `${a.imageCount} ${t.photos || 'fotos'} • ${a.sourceDomain}${a.folder ? ` • ${a.folder}` : ''}`,
        thumbnail: a.coverImage,
        badge: isGif ? 'GIF' : (a.mediaType === 'video' ? (t.video || (isEn ? 'Video' : 'Vídeo')) : t.originalVerified),
        onSelect: () => {
          navigateToView('album-detail', a.id);
          setCommandPaletteOpen(false);
        }
      };
    });

  // 4. Video items (including GIF detection and examples when empty)
  const filteredVideos: PaletteItem[] = (videos || [])
    .filter(v => {
      if (!q) return true;
      const isGifQuery = q === 'gif' || q === 'gifs' || q === 'animado';
      const isGif = v.format?.toLowerCase() === 'gif' || v.format?.toLowerCase() === 'webp' || v.filename?.toLowerCase().includes('.gif') || v.title?.toLowerCase().includes('gif');
      if (isGifQuery && isGif) return true;
      return (
        v.title.toLowerCase().includes(q) ||
        (v.folder && v.folder.toLowerCase().includes(q)) ||
        (v.format && v.format.toLowerCase().includes(q)) ||
        (v.filename && v.filename.toLowerCase().includes(q))
      );
    })
    .slice(0, !q ? 4 : 6)
    .map(v => {
      const isGif = v.format?.toLowerCase() === 'gif' || v.filename?.toLowerCase().includes('.gif');
      return {
        id: `video-${v.id}`,
        category: 'video',
        label: v.title,
        subLabel: `${v.folder ? `${v.folder} • ` : ''}${v.format ? v.format.toUpperCase() : 'MP4'}${v.durationSeconds ? ` (${Math.round(v.durationSeconds)}s)` : ''}`,
        thumbnail: v.thumbnailUrl,
        icon: isGif ? Clapperboard : Video,
        badge: isGif ? 'GIF' : (t.video || (isEn ? 'Video' : 'Vídeo')),
        onSelect: () => {
          setActivePlayingVideo(v);
          setCommandPaletteOpen(false);
        }
      };
    });

  // Combined flat list for unified ArrowUp/ArrowDown index navigation
  const allItems: PaletteItem[] = [
    ...filteredNav,
    ...filteredFolders,
    ...filteredAlbums,
    ...filteredVideos
  ];

  const allItemsRef = useRef(allItems);
  allItemsRef.current = allItems;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  // Reset selected index when query changes
  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSelectedIndex(0);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      if (!commandPaletteOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setCommandPaletteOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const len = allItemsRef.current.length;
        setSelectedIndex(prev => (len > 0 ? (prev + 1) % len : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const len = allItemsRef.current.length;
        setSelectedIndex(prev => (len > 0 ? (prev - 1 + len) % len : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = allItemsRef.current[selectedIndexRef.current];
        if (item) {
          item.onSelect();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  // Auto-scroll active item into view
  useEffect(() => {
    if (!commandPaletteOpen) return;
    const activeEl = document.getElementById(`palette-item-${selectedIndex}`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, commandPaletteOpen]);


  if (!commandPaletteOpen) return null;

  let currentItemIdx = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={() => setCommandPaletteOpen(false)}
      ></div>

      <div className={`relative w-full max-w-2xl bg-surface border border-border shadow-2xl rounded-2xl overflow-hidden flex flex-col z-10 ${getModalAnimationClass(settings.modalAnimation || 'scale', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')}`}>
        {/* Search Input */}
        <div className="p-4 border-b border-border flex items-center gap-3">
          <IconBadge icon={<Search size={16} />} variant="cyan" size="sm" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder={t.placeholder}
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-sm outline-none font-medium"
          />
          <button
            onClick={() => setCommandPaletteOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surface-elevated transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results List */}
        <div ref={resultsContainerRef} className="max-h-96 overflow-y-auto p-3 space-y-4">
          {/* Navigation Items */}
          {filteredNav.length > 0 && (
            <div className="space-y-1">
              <div className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {t.categoryNav}
              </div>
              {filteredNav.map(item => {
                const globalIdx = currentItemIdx++;
                const isSelected = globalIdx === selectedIndex;
                const Icon = item.icon || Zap;

                return (
                  <button
                    key={item.id}
                    id={`palette-item-${globalIdx}`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs transition-all text-left ${
                      isSelected
                        ? 'ring-1 ring-brand-500 bg-brand-500/20 text-brand-300'
                        : 'text-slate-300 hover:bg-surface-elevated border border-transparent'
                    }`}
                  >
                    <IconBadge icon={<Icon size={14} />} variant="neon" size="xs" />
                    <span className="flex-1 font-medium truncate">{item.label}</span>
                    <span className="text-[10px] font-mono text-slate-400">{item.badge}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Library Folders */}
          {filteredFolders.length > 0 && (
            <div className="space-y-1">
              <div className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {!q ? (t.libraryFolders || 'Pastas da Biblioteca') : (t.folder || 'Pastas')} ({filteredFolders.length})
              </div>
              {filteredFolders.map(item => {
                const globalIdx = currentItemIdx++;
                const isSelected = globalIdx === selectedIndex;

                return (
                  <button
                    key={item.id}
                    id={`palette-item-${globalIdx}`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs transition-all text-left ${
                      isSelected
                        ? 'ring-1 ring-brand-500 bg-brand-500/20 text-brand-300'
                        : 'text-slate-300 hover:bg-surface-elevated border border-transparent'
                    }`}
                  >
                    <IconBadge icon={<Folder size={14} />} variant="gold" size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-100 truncate">{item.label}</div>
                      {item.subLabel && (
                        <div className="text-[10px] text-slate-400 truncate">{item.subLabel}</div>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
                      {item.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Albums Matching Query or Recent Examples */}
          {filteredAlbums.length > 0 && (
            <div className="space-y-1">
              <div className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {!q ? (t.recentAlbums || (isEn ? 'Recent Albums' : 'Álbuns Recentes')) : (t.albumsAndGifs || (isEn ? 'Albums & GIFs' : 'Álbuns & GIFs'))} ({filteredAlbums.length})
              </div>
              {filteredAlbums.map(item => {
                const globalIdx = currentItemIdx++;
                const isSelected = globalIdx === selectedIndex;

                return (
                  <button
                    key={item.id}
                    id={`palette-item-${globalIdx}`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs transition-all text-left ${
                      isSelected
                        ? 'ring-1 ring-brand-500 bg-brand-500/20 text-brand-300'
                        : 'text-slate-300 hover:bg-surface-elevated border border-transparent'
                    }`}
                  >
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.label}
                        className="w-8 h-8 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : (
                      <IconBadge icon={<FolderHeart size={14} />} variant="gold" size="xs" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-100 truncate">{item.label}</div>
                      {item.subLabel && (
                        <div className="text-[10px] text-slate-400 truncate">{item.subLabel}</div>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-brand-500/20 text-brand-400 font-mono">
                      {item.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Videos & GIFs Matching Query or Recent Examples */}
          {filteredVideos.length > 0 && (
            <div className="space-y-1">
              <div className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {!q ? (t.recentVideos || (isEn ? 'Recent Videos & GIFs' : 'Vídeos e GIFs Recentes')) : (t.videosAndMedia || (isEn ? 'Videos & Media' : 'Vídeos & Animações'))} ({filteredVideos.length})
              </div>

              {filteredVideos.map(item => {
                const globalIdx = currentItemIdx++;
                const isSelected = globalIdx === selectedIndex;

                return (
                  <button
                    key={item.id}
                    id={`palette-item-${globalIdx}`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs transition-all text-left ${
                      isSelected
                        ? 'ring-1 ring-brand-500 bg-brand-500/20 text-brand-300'
                        : 'text-slate-300 hover:bg-surface-elevated border border-transparent'
                    }`}
                  >
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.label}
                        className="w-8 h-8 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : (
                      <IconBadge icon={<Video size={14} />} variant="rose" size="xs" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-100 truncate">{item.label}</div>
                      {item.subLabel && (
                        <div className="text-[10px] text-slate-400 truncate">{item.subLabel}</div>
                      )}
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono">
                      {item.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {allItems.length === 0 && (
            <div className="text-center py-10 text-slate-500 text-xs">
              {t.noResults} "{query}".
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border bg-surface-elevated/40 flex items-center justify-between text-[11px] text-slate-400 px-4">
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-[10px]">↑</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-[10px]">↓</kbd>
            <span>{t.toNavigate}</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-[10px]">Enter</kbd>
            <span>{t.toSelect || (isEn ? 'to select' : 'para selecionar')}</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-[10px]">Esc</kbd>
            <span>{t.toClose}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
