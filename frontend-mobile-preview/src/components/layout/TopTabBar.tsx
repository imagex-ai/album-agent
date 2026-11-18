import React from 'react';
import { X, Plus, Zap, FolderHeart, Activity, Terminal, Sliders, Layers, Film, Compass, Home } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import { ViewId } from '../../types';

export const TopTabBar: React.FC = () => {
  const { openTabs, activeTabId, setActiveTab, closeTab, openTab, settings } = useAppStore();

  const getTabDisplayTitle = (tab: { id: string; viewId: ViewId; title: string }) => {
    const s = translations[settings.language]?.sidebar || translations['en-US'].sidebar;
    const h = translations[settings.language]?.header || translations['en-US'].header;
    if (tab.id === 'tab-home-default') {
      return s.home || (settings.language === 'en-US' ? 'Home' : 'Início');
    }
    if (tab.viewId === 'home') {
      if (tab.title === 'Nova Aba' || tab.title === 'New Tab') {
        return h.newTab || (settings.language === 'en-US' ? 'New Tab' : 'Nova Aba');
      }
      return tab.title || s.home || (settings.language === 'en-US' ? 'Home' : 'Início');
    }
    if (tab.viewId === 'album-detail' && tab.title) {
      return tab.title;
    }
    switch (tab.viewId) {
      case 'extractor': return s.imageExtractor;
      case 'profile-hub': return settings.language === 'en-US' ? 'Profile Hub' : 'Hub de Perfil';
      case 'multi-album': return s.multiAlbum;
      case 'web-video-scraper': return s.webVideoScraper;
      case 'batch-queue': return s.batchProcessor;
      case 'gallery': return s.albumLibrary;
      case 'videos': return s.videoGallery;
      case 'shorts': return s.shortsFeed;
      case 'live-monitor': return s.aiLiveMonitor;
      case 'album-detail': return s.albumDetail;
      case 'domain-patterns': return s.domainRules;
      case 'job-history': return s.jobManagement;
      case 'realtime-logs': return s.realtimeLogs;
      case 'performance-metrics': return s.performanceStorage;
      case 'settings': return s.systemSettings;
      case 'duplicates': return s.duplicatesFinder;
      case 'trash': return s.trash;
      default: return tab.title;
    }
  };

  const getTabIcon = (viewId: ViewId) => {
    switch (viewId) {
      case 'home': return <Home size={13} className="text-brand-400" />;
      case 'extractor': return <Zap size={13} className="text-brand-400" />;
      case 'multi-album': return <Compass size={13} className="text-indigo-400" />;
      case 'web-video-scraper': return <Film size={13} className="text-violet-400" />;
      case 'gallery': return <FolderHeart size={13} className="text-accent-purple" />;
      case 'videos': return <Film size={13} className="text-violet-400" />;
      case 'live-monitor': return <Activity size={13} className="text-emerald-400" />;
      case 'album-detail': return <Sliders size={13} className="text-amber-400" />;
      case 'realtime-logs': return <Terminal size={13} className="text-cyan-400" />;
      default: return <Layers size={13} className="text-slate-400" />;
    }
  };

  return (
    <div
      onWheel={(e) => {
        e.currentTarget.scrollLeft += e.deltaY;
      }}
      className="h-10 bg-surface/90 border-b border-border flex items-center px-2 gap-1 overflow-x-auto no-scrollbar touch-scroll select-none"
    >
      {openTabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group h-8 px-2.5 sm:px-3 rounded-lg flex items-center gap-1.5 sm:gap-2 text-xs font-medium cursor-pointer transition-all border shrink-0 max-w-[160px] ${
              isActive
                ? 'bg-surface-elevated text-slate-100 border-border shadow-sm'
                : 'text-slate-400 hover:bg-surface-elevated/40 hover:text-slate-200 border-transparent'
            }`}
          >
            <span className="shrink-0">{getTabIcon(tab.viewId)}</span>
            <span className="max-w-[110px] sm:max-w-[140px] truncate">{getTabDisplayTitle(tab)}</span>
            {tab.isClosable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="opacity-70 hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition-opacity md:opacity-0 md:group-hover:opacity-100"
                title={translations[settings.language]?.header?.closeTab || (settings.language === 'en-US' ? 'Close tab' : 'Fechar aba')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}

      <button
        onClick={() => openTab({
          viewId: 'home',
          title: translations[settings.language]?.header?.newTab || (settings.language === 'en-US' ? 'New Tab' : 'Nova Aba')
        })}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surface-elevated transition-colors"
        title={translations[settings.language]?.header?.newTab || (settings.language === 'en-US' ? 'New Tab' : 'Nova Aba')}
      >
        <Plus size={14} />
      </button>
    </div>
  );
};
