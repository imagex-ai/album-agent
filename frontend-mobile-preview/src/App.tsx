import { useShallow } from 'zustand/react/shallow';
import { toggleDesktopFullscreen, restoreDesktopWindow, isDesktopApp } from './services/desktopService';
import React, { useEffect, useState, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { useScrollRestoration } from './hooks/useScrollRestoration';
import { useProfileHubStore } from './store/useProfileHubStore';
import { restoreProfileHubLocation } from './services/profileHubRuntime';
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
import { UpdateModal } from './components/common/UpdateModal';
import { VideoPlayerModal } from './components/common/VideoPlayerModal';
import { FloatingMiniPlayer } from './components/video-player/FloatingMiniPlayer';
import { PersistentPlayerHost } from './components/video-player/engine/PersistentPlayerHost';
import { FolderModal } from './components/common/FolderModal';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { translations } from './i18n/translations';
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
import { ProfileHubView } from './components/views/ProfileHubView';
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
import { TimelinePreviewView } from './components/views/TimelinePreviewView';
import { ProfileHubLibraryView } from './components/profile-hub/library/ProfileHubLibraryView';
import { AddToPlaylistModal } from './components/profile-hub/library/AddToPlaylistModal';

// Match the backend update-check cache so a long-running session discovers releases.
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

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
  const profileHubVisited = useRef(false);
  if (currentView === 'profile-hub') profileHubVisited.current = true;
  const mainContainerRef = useRef<HTMLElement | null>(null);
  const hubRouteToken = useProfileHubStore(state => state.routeToken);

  // Unified scroll position retention & seamless restoration across views and tabs
  useScrollRestoration({
    containerRef: mainContainerRef,
    currentView,
    activeTabId,
    activeAlbumId,
    contextKey: currentView === 'profile-hub' && hubRouteToken ? `profile-hub:${hubRouteToken}` : undefined,
  });

  // Global safety keyboard listener for F11 and Escape (garante que nunca fique preso em tela cheia)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.key === 'F11' && isDesktopApp()) {
        e.preventDefault();
        toggleDesktopFullscreen();
      } else if (e.key === 'Escape') {
        const state = useAppStore.getState();
        if (e.defaultPrevented || state.currentView === 'shorts' || state.lightboxImage || state.slideshowOpen || state.activePlayingVideo ||
            state.contactSheetOpen || state.coPilotOpen || state.exportModalOpen || state.keybindingsModalOpen ||
            state.webhookModalOpen || state.commandPaletteOpen || state.notificationDrawerOpen || state.albumDiffModalOpen ||
            state.colorHarmonyOpen || state.aiChatOpen || state.activeFolderModal || state.activeAlbumFolderModal || state.updateModalOpen ||
            document.fullscreenElement || document.querySelector('dialog[open], [role="dialog"]')) return;
        if (isDesktopApp()) void restoreDesktopWindow();
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

      if (hash === 'profile-hub') {
        const state = useAppStore.getState();
        const activeTab = state.openTabs.find(tab => tab.id === state.activeTabId);
        if (state.currentView !== 'profile-hub' || activeTab?.viewId !== 'profile-hub') navigateToView('profile-hub');
        restoreProfileHubLocation(window.location.hash);
        return;
      }

      if (hash === 'album-detail' && albumIdParam) {
        navigateToView('album-detail', albumIdParam);
        return;
      }

      const validViews = [
        'home', 'extractor', 'profile-hub', 'multi-album', 'web-video-scraper', 'batch-queue', 'live-monitor', 'gallery',
        'videos', 'shorts', 'trash', 'duplicates', 'domain-patterns', 'job-history',
        'realtime-logs', 'performance-metrics', 'settings', 'timeline-preview',
        'timeline-history', 'timeline-playlists', 'timeline-favorites', 'timeline-liked'
      ];
      if (validViews.includes(hash)) {
        navigateToView(hash as any);
      }
    };

    parseHash();
    window.addEventListener('hashchange', parseHash);
    window.addEventListener('popstate', parseHash);
    return () => {
      window.removeEventListener('hashchange', parseHash);
      window.removeEventListener('popstate', parseHash);
    };
  }, [navigateToView]);

  // Update URL hash whenever currentView changes
  useEffect(() => {
    // Parsing a deep link can synchronously navigate before this render's
    // effects finish. Never publish that render's outgoing view over the link.
    if (useAppStore.getState().currentView !== currentView) return;
    if (currentView && currentView !== 'album-detail') {
      const expectedHash = `#/${currentView}`;
      if (currentView === 'profile-hub' && window.location.hash.split('?')[0] === expectedHash) return;
      if (window.location.hash !== expectedHash) {
        if (window.location.hash.startsWith('#/profile-hub?')) window.history.pushState(null, '', expectedHash);
        else window.history.replaceState(null, '', expectedHash);
      }
    }
  }, [currentView]);

  // Sync with real backend data on mount
  useEffect(() => {
    syncBackendData();
  }, [syncBackendData]);

  useEffect(() => {
    const checkWhileVisible = () => {
      const state = useAppStore.getState();
      if (document.visibilityState === 'visible' && !state.isCheckingUpdate) {
        void state.checkForUpdates(true, false);
      }
    };
    const timer = window.setInterval(checkWhileVisible, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhileVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkWhileVisible);
    };
  }, []);

  // Apply Theme class to document element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-dark-slate', 'theme-deep-oled', 'theme-clean-light', 'theme-cyber-studio', 'theme-hub-violet');
    root.classList.add(`theme-${settings.theme}`);
  }, [settings.theme]);

  const renderActiveView = () => {
    switch (currentView) {
      case 'home':
        return <HomeView />;
      case 'extractor':
        return <ExtractorView />;
      case 'profile-hub':
        return null;
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
      case 'timeline-preview':
        return <TimelinePreviewView onOpenMobileMenu={() => setMobileMenuOpen(true)} />;
      case 'timeline-history':
        return <ProfileHubLibraryView mode="history" onOpenMobileMenu={() => setMobileMenuOpen(true)} />;
      case 'timeline-playlists':
        return <ProfileHubLibraryView mode="playlists" onOpenMobileMenu={() => setMobileMenuOpen(true)} />;
      case 'timeline-favorites':
        return <ProfileHubLibraryView mode="favorites" onOpenMobileMenu={() => setMobileMenuOpen(true)} />;
      case 'timeline-liked':
        return <ProfileHubLibraryView mode="liked" onOpenMobileMenu={() => setMobileMenuOpen(true)} />;
      default:
        return <HomeView />;
    }
  };

  const isTimelineLibraryView =
    currentView === 'timeline-history' ||
    currentView === 'timeline-playlists' ||
    currentView === 'timeline-favorites' ||
    currentView === 'timeline-liked';

  return (
    <div className="flex h-[100dvh] w-full max-w-full bg-background text-slate-100 overflow-hidden select-none">
      {/* Sidebar Navigation with Mobile Drawer Support */}
      <Sidebar isMobileOpen={mobileMenuOpen} onCloseMobile={() => setMobileMenuOpen(false)} />

      {/* Main Layout Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Header (Hidden in Shorts and Timeline Preview; desktop-only for Profile Hub Library views) */}
        {currentView !== 'shorts' && currentView !== 'timeline-preview' && (
          <div className={isTimelineLibraryView ? 'hidden md:block shrink-0' : 'shrink-0'}>
            <TopHeader onOpenMobileMenu={() => setMobileMenuOpen(true)} />
          </div>
        )}

        {/* Multi-Tab Session Bar with Smooth Touch Scroll */}
        {currentView !== 'shorts' && currentView !== 'profile-hub' && currentView !== 'timeline-preview' && !isTimelineLibraryView && (
          <div className="shrink-0">
            <TopTabBar />
          </div>
        )}

        {/* Active View Container with Unified Safe Viewport Scroll */}
        <main
          ref={mainContainerRef}
          className={`flex-1 relative ${
            currentView === 'shorts'
              ? 'overflow-hidden pb-0'
              : currentView === 'timeline-preview' || isTimelineLibraryView
                ? 'profile-hub-scroll timeline-scroll-surface flex flex-col overflow-y-auto overflow-x-clip touch-scroll pb-0'
                : currentView === 'profile-hub'
                  ? 'profile-hub-scroll overflow-y-auto overflow-x-clip touch-scroll pb-0'
                  : 'overflow-y-auto touch-scroll pb-6'
          }`}
        >
          {currentView !== 'profile-hub' && <ErrorBoundary>
            <div
              key={`${currentView}-${activeTabId}`}
              className={`${getViewTransitionClass(settings.viewTransitionAnimation || 'fade', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')} ${
                currentView === 'shorts'
                  ? 'h-full'
                  : currentView === 'timeline-preview' || isTimelineLibraryView
                    ? 'flex-1 shrink-0 flex flex-col'
                    : 'min-h-full'
              } w-full`}
            >
              {renderActiveView()}
            </div>
          </ErrorBoundary>}
          {profileHubVisited.current && <div hidden={currentView !== 'profile-hub'} style={{ display: currentView === 'profile-hub' ? 'flex' : 'none' }} className="min-h-full w-full flex-col"><ErrorBoundary><ProfileHubView active={currentView === 'profile-hub'} /></ErrorBoundary></div>}
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
      <UpdateModal />
      <PersistentPlayerHost />
      <FloatingMiniPlayer />
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
                {translations[useAppStore.getState().settings.language || 'pt-BR']?.player?.closePlayer || translations['pt-BR']?.player?.closePlayer}
              </button>
            </div>
          </div>
        )}
      >
        <VideoPlayerModal />
      </ErrorBoundary>
      <FolderModal />
      <AiChatDrawer />
      <AddToPlaylistModal />
    </div>
  );
};
