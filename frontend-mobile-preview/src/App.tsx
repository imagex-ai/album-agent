import { useShallow } from 'zustand/react/shallow';
import { toggleDesktopFullscreen, restoreDesktopWindow, exitAllFullscreen } from './services/desktopService';
import React, { useEffect, useState, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { useScrollRestoration } from './hooks/useScrollRestoration';
import { Sidebar } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { TopTabBar } from './components/layout/TopTabBar';
import { MiniTaskDock } from './components/layout/MiniTaskDock';
import { NotificationDrawer } from './components/layout/NotificationDrawer';
import { AiChatDrawer } from './components/layout/AiChatDrawer';

import { CommandPalette } from './components/common/CommandPalette';
import { LightboxModal } from './components/common/LightboxModal';
import { SlideshowModal } from './components/common/SlideshowModal';
import { ContactSheetModal } from './components/common/ContactSheetModal';
import { CoPilotModal } from './components/common/CoPilotModal';
import { ExportModal } from './components/common/ExportModal';
import { KeybindingsModal } from './components/common/KeybindingsModal';
import { VideoPlayerModal } from './components/common/VideoPlayerModal';
import { FolderModal } from './components/common/FolderModal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import {
  getViewTransitionClass,
  getSpeedClass,
  getDistanceClass
} from './services/motionConfig';

// Dedicated Views
import { HomeView } from './components/views/HomeView';
import { ExtractorView } from './components/views/ExtractorView';
import { MultiAlbumView } from './components/views/MultiAlbumView';
import { WebVideoScraperView } from './components/views/WebVideoScraperView';
import { BatchQueueView } from './components/views/BatchQueueView';
import { LiveMonitorView } from './components/views/LiveMonitorView';
import { GalleryView } from './components/views/GalleryView';
import { VideosView } from './components/views/VideosView';
import { ShortsView } from './components/views/ShortsView';
import { TrashView } from './components/views/TrashView';
import { DuplicatesView } from './components/views/DuplicatesView';
import { AlbumDetailView } from './components/views/AlbumDetailView';
import { DomainPatternsView } from './components/views/DomainPatternsView';
import { JobHistoryView } from './components/views/JobHistoryView';
import { RealtimeLogsView } from './components/views/RealtimeLogsView';
import { PerformanceMetricsView } from './components/views/PerformanceMetricsView';
import { SettingsView } from './components/views/SettingsView';

export const App: React.FC = () => {
  const {
    currentView,
    navigateToView,
    settings,
    syncBackendData,
    activeTabId,
    activeAlbumId
  } = useAppStore(useShallow(state => ({
    currentView: state.currentView,
    navigateToView: state.navigateToView,
    settings: state.settings,
    syncBackendData: state.syncBackendData,
    activeTabId: state.activeTabId,
    activeAlbumId: state.activeAlbumId,
  })));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mainContainerRef = useRef<HTMLElement | null>(null);

  // Unified scroll position retention & seamless restoration across views and tabs
  useScrollRestoration({
    containerRef: mainContainerRef,
    currentView,
    activeTabId,
    activeAlbumId
  });

  // Global safety keyboard listener for F11 and Escape (garante que nunca fique preso em tela cheia)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleDesktopFullscreen();
      } else if (e.key === 'Escape') {
        exitAllFullscreen();
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, []);

  // Global mouse-wheel horizontal scroll for any horizontal overflow-x-auto bar
  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== 'function') return;
      const hScrollEl = target.closest('.overflow-x-auto') as HTMLElement | null;
      if (!hScrollEl) return;
      // Only hijack vertical wheel if this container overflows horizontally and does NOT overflow vertically
      const canScrollHorizontally = hScrollEl.scrollWidth > hScrollEl.clientWidth + 2;
      const canScrollVertically = hScrollEl.scrollHeight > hScrollEl.clientHeight + 8;
      if (canScrollHorizontally && !canScrollVertically) {
        e.preventDefault();
        hScrollEl.scrollLeft += e.deltaY;
      }
    };
    window.addEventListener('wheel', handleGlobalWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleGlobalWheel);
  }, []);

  // Sync initial tab from URL hash on load (e.g. /#/videos, /#/gallery, /#/extractor)
  useEffect(() => {
    const parseHash = () => {
      const rawHash = window.location.hash.replace('#/', '').replace('#', '').trim();
      const [viewPath, queryString] = rawHash.split('?');
      const hash = (viewPath || '').toLowerCase();
      const params = new URLSearchParams(queryString || '');
      const albumIdParam = params.get('id');

      if (hash === 'album-detail' && albumIdParam) {
        navigateToView('album-detail', albumIdParam);
        return;
      }

      const validViews = [
        'home', 'extractor', 'multi-album', 'web-video-scraper', 'batch-queue', 'live-monitor', 'gallery',
        'videos', 'shorts', 'trash', 'duplicates', 'domain-patterns', 'job-history',
        'realtime-logs', 'performance-metrics', 'settings'
      ];
      if (validViews.includes(hash)) {
        navigateToView(hash as any);
      }
    };

    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, [navigateToView]);

  // Update URL hash whenever currentView changes
  useEffect(() => {
    if (currentView && currentView !== 'album-detail') {
      const expectedHash = `#/${currentView}`;
      if (window.location.hash !== expectedHash) {
        window.history.replaceState(null, '', expectedHash);
      }
    }
  }, [currentView]);

  // Sync with real backend data on mount
  useEffect(() => {
    syncBackendData();
  }, [syncBackendData]);

  // Apply Theme class to document element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-dark-slate', 'theme-deep-oled', 'theme-clean-light', 'theme-cyber-studio');
    root.classList.add(`theme-${settings.theme}`);
  }, [settings.theme]);

  const renderActiveView = () => {
    switch (currentView) {
      case 'home':
        return <HomeView />;
      case 'extractor':
        return <ExtractorView />;
      case 'multi-album':
        return <MultiAlbumView />;
      case 'web-video-scraper':
        return <WebVideoScraperView />;
      case 'batch-queue':
        return <BatchQueueView />;
      case 'live-monitor':
        return <LiveMonitorView />;
      case 'gallery':
        return <GalleryView />;
      case 'videos':
        return <VideosView />;
      case 'shorts':
        return <ShortsView />;
      case 'trash':
        return <TrashView />;
      case 'duplicates':
        return <DuplicatesView />;
      case 'album-detail':
        return <AlbumDetailView />;
      case 'domain-patterns':
        return <DomainPatternsView />;
      case 'job-history':
        return <JobHistoryView />;
      case 'realtime-logs':
        return <RealtimeLogsView />;
      case 'performance-metrics':
        return <PerformanceMetricsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="flex h-[100dvh] w-full max-w-full bg-background text-slate-100 overflow-hidden select-none">
      {/* Sidebar Navigation with Mobile Drawer Support */}
      <Sidebar isMobileOpen={mobileMenuOpen} onCloseMobile={() => setMobileMenuOpen(false)} />

      {/* Main Layout Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Header (Hidden in Shorts for full immersive view) */}
        {currentView !== 'shorts' && (
          <TopHeader onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        )}

        {/* Multi-Tab Session Bar with Smooth Touch Scroll (Hidden in Shorts) */}
        {currentView !== 'shorts' && (
          <div className="shrink-0">
            <TopTabBar />
          </div>
        )}

        {/* Active View Container with Unified Safe Viewport Scroll */}
        <main
          ref={mainContainerRef}
          className={`flex-1 relative ${currentView === 'shorts' ? 'overflow-hidden pb-0' : 'overflow-y-auto touch-scroll pb-6'}`}
        >
          <ErrorBoundary>
            <div
              key={`${currentView}-${activeTabId}`}
              className={`${getViewTransitionClass(settings.viewTransitionAnimation || 'fade', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')} ${currentView === 'shorts' ? 'h-full' : 'min-h-full'} w-full`}
            >
              {renderActiveView()}
            </div>
          </ErrorBoundary>
        </main>

        {/* Spotify-style Mini-Dock for background extractions (Hidden in Shorts to prevent overlay collision) */}
        {currentView !== 'shorts' && <MiniTaskDock />}
      </div>

      {/* Global Modals & Drawers */}
      <NotificationDrawer />
      <CommandPalette />
      <LightboxModal />
      <SlideshowModal />
      <ContactSheetModal />
      <CoPilotModal />
      <ExportModal />
      <KeybindingsModal />
      <ErrorBoundary
        fallback={(_error, reset) => (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-rose-500/40 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto shadow-glow-rose">
                <AlertTriangle size={32} />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base sm:text-lg font-bold text-white">{useAppStore.getState().settings.language === "en-US" ? "Video Player Error" : "Falha no Reprodutor de Vídeo"}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {useAppStore.getState().settings.language === "en-US" ? "An unexpected error occurred in the video player. App navigation remains active and functional." : "Ocorreu um erro inesperado no reprodutor de vídeo. A navegação do app permanece ativa e funcional."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  useAppStore.getState().setActivePlayingVideo(null);
                  reset();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-lg shadow-brand-600/30 transition-colors cursor-pointer"
              >
                Fechar Reprodutor
              </button>
            </div>
          </div>
        )}
      >
        <VideoPlayerModal />
      </ErrorBoundary>
      <FolderModal />
      <AiChatDrawer />
    </div>
  );
};
