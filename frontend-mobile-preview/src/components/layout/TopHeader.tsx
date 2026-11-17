import React, { useState, useEffect } from 'react';
import { Search, Bell, Menu, Command, Bot, Folder, X, Languages, Maximize2, Minimize2 } from 'lucide-react';
import { toggleAppFullscreen, isAppFullscreen, isDesktopApp, getDesktopFullscreen, toggleDesktopFullscreen, desktopFullscreenEvent } from '../../services/desktopService';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';

interface TopHeaderProps {
  onOpenMobileMenu?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onOpenMobileMenu }) => {
  const {
    settings,
    updateSettings,
    notifications,
    setNotificationDrawerOpen,
    setCommandPaletteOpen,
    setAiChatOpen,
    currentView,
    activeAlbumId,
    albums,
    activeAlbumFolder,
    setActiveAlbumFolder,
    navigateToView
  } = useAppStore();

  const t = translations[settings.language].header;
  const isEn = settings.language === 'en-US';
  const unreadCount = notifications.filter(n => !n.isRead).length;
  const currentAlbum = currentView === 'album-detail' ? albums.find(a => a.id === activeAlbumId) : null;
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const syncFullscreenState = async () => {
      const native = await getDesktopFullscreen();
      if (mounted) setIsFullscreen(native === null ? isAppFullscreen() : native);
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    document.addEventListener('mozfullscreenchange', syncFullscreenState);
    document.addEventListener('MSFullscreenChange', syncFullscreenState);
    window.addEventListener(desktopFullscreenEvent, syncFullscreenState);
    window.addEventListener('pywebviewready', syncFullscreenState);

    return () => {
      mounted = false;
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
      document.removeEventListener('mozfullscreenchange', syncFullscreenState);
      document.removeEventListener('MSFullscreenChange', syncFullscreenState);
      window.removeEventListener(desktopFullscreenEvent, syncFullscreenState);
      window.removeEventListener('pywebviewready', syncFullscreenState);
    };
  }, []);

  return (
    <header className="h-14 border-b border-border glass-panel px-3 sm:px-4 flex items-center justify-between gap-3 select-none relative z-20 max-w-full">
      {/* Left: Mobile Menu & Active Folder Breadcrumb */}
      <div className="flex items-center gap-2 shrink-0">
        {onOpenMobileMenu && (
          <button
            onClick={onOpenMobileMenu}
            className="md:hidden p-2 rounded-xl bg-surface-elevated border border-border text-slate-300 hover:text-white shrink-0 active:scale-95 transition-transform"
            title={t.navigationMenu || (isEn ? 'Navigation Menu' : 'Menu de Navegação')}
            aria-label={t.openMenu || (isEn ? 'Open Menu' : 'Abrir Menu')}
          >
            <Menu size={18} />
          </button>
        )}

        {/* Top Bar Folder Breadcrumb if viewing an album or filtered gallery folder */}
        {currentAlbum ? (
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 bg-surface-elevated/70 px-2.5 py-1 rounded-xl border border-border">
            <button
              onClick={() => {
                setActiveAlbumFolder(null);
                navigateToView('gallery');
              }}
              className="hover:text-brand-300 transition-colors"
              title={t.goToAllAlbums || (isEn ? 'Go to all albums' : 'Ir para todos os álbuns')}
            >
              {t.allAlbums || (isEn ? 'Albums' : 'Álbuns')}
            </button>
            <span className="text-slate-600">/</span>
            <button
              onClick={() => {
                setActiveAlbumFolder(currentAlbum.folder || (isEn ? 'General' : 'Geral'));
                navigateToView('gallery');
              }}
              className="text-violet-400 hover:text-violet-200 font-semibold flex items-center gap-1 cursor-pointer"
              title={(t.viewFolderAlbums || (isEn ? 'View all albums in folder "{folder}"' : 'Ver todos os álbuns da pasta "{folder}"')).replace('{folder}', currentAlbum.folder || (isEn ? 'General' : 'Geral'))}
            >
              <Folder size={12} />
              <span>{currentAlbum.folder || (isEn ? 'General' : 'Geral')}</span>
            </button>
          </div>
        ) : activeAlbumFolder && currentView === 'gallery' ? (
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 bg-surface-elevated/70 pl-2.5 pr-1.5 py-1 rounded-xl border border-border">
            <span>{t.folder || 'Folder:'}</span>
            <span className="text-violet-400 font-semibold flex items-center gap-1">
              <Folder size={12} />
              {activeAlbumFolder}
            </span>
            <button
              onClick={() => setActiveAlbumFolder(null)}
              className="p-0.5 rounded-md hover:bg-white/10 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer ml-0.5"
              title={t.clearFolderFilter || 'Limpar filtro de pasta'}
            >
              <X size={12} />
            </button>
          </div>
        ) : null}
      </div>

      {/* Center: Search & Raycast Trigger (Fluid responsive sizing) */}
      <div className="flex-1 min-w-0 max-w-2xl">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="w-full flex items-center justify-between px-3.5 py-2 rounded-xl bg-surface-elevated/80 border border-border text-slate-400 hover:text-slate-200 hover:border-slate-700 text-xs transition-all shadow-inner truncate group"
        >
          <div className="flex items-center gap-2 min-w-0 truncate">
            <Search size={14} className="text-slate-400 group-hover:text-brand-400 transition-colors shrink-0" />
            <span className="truncate text-xs">{t.searchPlaceholder}</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border text-[10px] font-mono text-slate-400 shrink-0">
            <Command size={10} /> K
          </kbd>
        </button>
      </div>

      {/* Right: Language switch + Fullscreen Toggle + AI Chat & Notification Bell */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Toggle Window Fullscreen / Restore Button */}
        <button
          onClick={() => isDesktopApp() ? toggleDesktopFullscreen() : toggleAppFullscreen(isFullscreen, setIsFullscreen)}
          className="px-2.5 py-1.5 rounded-xl bg-surface-elevated border border-border text-slate-300 hover:text-white hover:border-brand-500/40 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm cursor-pointer"
          title={
            isFullscreen
              ? (isEn ? "Exit Fullscreen (Esc / F11)" : "Sair da Tela Cheia (Esc / F11)")
              : (isEn ? "Toggle Fullscreen / Normal Window (F11)" : "Alternar Tela Cheia / Janela Normal (F11)")
          }
          aria-label={isEn ? "Toggle Fullscreen" : "Alternar Tela Cheia"}
        >
          {isFullscreen ? (
            <Minimize2 size={14} className="text-amber-400" />
          ) : (
            <Maximize2 size={14} className="text-brand-400" />
          )}
          <span className="hidden xl:inline text-[11px] font-semibold text-slate-300">
            {isFullscreen
              ? (isEn ? "Exit Fullscreen" : "Sair Tela Cheia")
              : (isEn ? "Fullscreen" : "Tela Cheia")}
          </span>
        </button>
        {/* Language Toggle Button */}
        <button
          onClick={() => updateSettings({ language: settings.language === 'en-US' ? 'pt-BR' : 'en-US' })}
          className="px-2.5 py-1.5 rounded-xl bg-surface-elevated border border-border text-xs font-mono font-bold text-slate-300 hover:text-white hover:border-brand-500/40 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
          title={settings.language === 'en-US' ? t.switchToPt : t.switchToEn}
          aria-label={t.languageToggle}
        >
          <Languages size={14} className="text-brand-400" />
          <span className="uppercase text-[11px] font-bold">{settings.language === 'en-US' ? 'EN' : 'PT'}</span>
        </button>

        {/* AI Co-Pilot Chat Drawer Trigger */}
        <button
          onClick={() => setAiChatOpen(true)}
          className="p-2 sm:px-3 sm:py-2 rounded-xl bg-surface-elevated border border-border text-slate-300 hover:text-white hover:border-brand-500/40 relative transition-all shrink-0 active:scale-95 flex items-center gap-1.5 group"
          title={t.openAiChat || 'Abrir AI Chat Co-Pilot'}
          aria-label={t.openAiChat || 'Abrir AI Chat Co-Pilot'}
        >
          <Bot size={16} className="text-brand-400 group-hover:scale-110 transition-transform" />
          <span className="hidden md:inline text-xs font-semibold text-slate-200">AI Chat</span>
        </button>

        <button
          onClick={() => setNotificationDrawerOpen(true)}
          className="p-2 sm:p-2.5 rounded-xl bg-surface-elevated border border-border text-slate-400 hover:text-slate-200 hover:border-slate-700 relative transition-all shrink-0 active:scale-95"
          title={t.notifications}
          aria-label={t.notifications}
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
          )}
        </button>
      </div>
    </header>
  );
};
