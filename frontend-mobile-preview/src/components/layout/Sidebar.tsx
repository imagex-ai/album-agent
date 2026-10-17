import React, { useState } from 'react';
import {
  Zap,
  Compass,
  Layers,
  Activity,
  GraduationCap,
  FolderHeart,
  Copy,
  Sliders,
  BookOpen,
  ListTodo,
  Terminal,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Film,
  Trash2,
  X,
  Home,
  Flame,
  Sparkles
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import { ViewId } from '../../types';

interface SidebarProps {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface NavItem {
  id: ViewId;
  label: string;
  icon: any;
  badge: string | null;
  badgeColor?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen = false, onCloseMobile }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { currentView, navigateToView, setSlideshowOpen, albums, videos, trashItems, jobs, logs, settings } = useAppStore();
  const t = translations[settings.language].sidebar;

  const activeJobsCount = jobs.filter(j => j.status === 'active').length;
  const errorLogsCount = logs.filter(l => l.level === 'error').length;

  const navSections: NavSection[] = [
    {
      title: t.coreEngine,
      items: [
        { id: 'home' as ViewId, label: t.home || (settings.language === 'en-US' ? 'Home' : 'Início'), icon: Home, badge: null },
        { id: 'extractor' as ViewId, label: t.imageExtractor, icon: Zap, badge: null },
        { id: 'multi-album' as ViewId, label: t.multiAlbum, icon: Compass, badge: null },
        { id: 'web-video-scraper' as ViewId, label: t.webVideoScraper, icon: Film, badge: null },
        { id: 'batch-queue' as ViewId, label: t.batchProcessor, icon: Layers, badge: null },
        { id: 'live-monitor' as ViewId, label: t.aiLiveMonitor, icon: Activity, badge: activeJobsCount > 0 ? `${activeJobsCount} ${t.badgeLive || 'LIVE'}` : null, badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
      ]
    },
    {
      title: t.libraryExplorer,
      items: [
        { id: 'gallery' as ViewId, label: t.albumLibrary, icon: FolderHeart, badge: albums.length.toString() },
        { id: 'videos' as ViewId, label: t.videoGallery, icon: Film, badge: videos.length > 0 ? videos.length.toString() : null },
        { id: 'shorts' as ViewId, label: t.shortsFeed || 'Shorts & Reels', icon: Flame, badge: 'HOT', badgeColor: 'bg-rose-500/20 text-rose-300 border border-rose-500/30' },
        { id: 'duplicates' as ViewId, label: t.duplicatesFinder, icon: Copy, badge: null },
        { id: 'trash' as ViewId, label: t.trash || 'Trash', icon: Trash2, badge: trashItems.length > 0 ? trashItems.length.toString() : null, badgeColor: 'bg-rose-500/20 text-rose-300 border border-rose-500/30' },
      ]
    },
    {
      title: t.studioTools,
      items: [
        { id: 'album-detail' as ViewId, label: t.albumDetail, icon: Sliders, badge: null },
        { id: 'domain-patterns' as ViewId, label: t.domainRules, icon: BookOpen, badge: null },
      ]
    },
    {
      title: t.observability,
      items: [
        { id: 'job-history' as ViewId, label: t.jobManagement, icon: ListTodo, badge: jobs.length.toString() },
        { id: 'realtime-logs' as ViewId, label: t.realtimeLogs, icon: Terminal, badge: errorLogsCount > 0 ? `${errorLogsCount} ERR` : null, badgeColor: 'bg-rose-500/20 text-rose-400 border border-rose-500/30' },
        { id: 'performance-metrics' as ViewId, label: t.performanceStorage, icon: BarChart3, badge: null },
      ]
    },
    {
      title: t.systemConfig,
      items: [
        { id: 'settings' as ViewId, label: t.systemSettings, icon: Settings, badge: null },
      ]
    }
  ];

  const handleItemClick = (id: ViewId) => {
    navigateToView(id);
    if (onCloseMobile) onCloseMobile();
  };

  const sidebarContent = (
    <div className="h-full flex flex-col">
      {/* Brand Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        {!collapsed || isMobileOpen ? (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-accent-purple flex items-center justify-center font-bold text-white shadow-glow-brand">
              X
            </div>
            <div>
              <div className="font-extrabold text-sm tracking-wider text-slate-100 flex items-center gap-1.5">
                IMAGEX.AI
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 font-mono font-semibold">
                  v5.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Enterprise Extraction</p>
            </div>
          </div>
        ) : (
          <div className="w-10 h-10 mx-auto rounded-xl bg-gradient-to-tr from-brand-600 to-accent-purple flex items-center justify-center font-bold text-white shadow-glow-brand">
            X
          </div>
        )}

        {/* Mobile Close Button */}
        {isMobileOpen ? (
          <button
            onClick={onCloseMobile}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-surface-elevated"
          >
            <X size={20} />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-elevated transition-colors"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 touch-scroll">
        {navSections.map((section, idx) => (
          <div key={idx}>
            {(!collapsed || isMobileOpen) && (
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">
                {section.title}
              </h3>
            )}
            <div className="space-y-1">
              {section.items.map(item => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                      isActive
                        ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30 shadow-glow-brand'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-surface-elevated'
                    }`}
                    title={collapsed && !isMobileOpen ? item.label : undefined}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        size={18}
                        className={`transition-colors ${
                          isActive ? 'text-brand-400' : 'text-slate-400 group-hover:text-slate-200'
                        }`}
                      />
                      {(!collapsed || isMobileOpen) && <span>{item.label}</span>}
                    </div>

                    {(!collapsed || isMobileOpen) && item.badge && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
                          item.badgeColor || 'bg-surface-elevated text-slate-400 border border-border'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Global Dopamine Slider Launcher */}
      <div className="px-3 pb-2">
        <button
          onClick={() => {
            setSlideshowOpen(true, 0, 'global');
            if (onCloseMobile) onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600/25 to-fuchsia-600/25 hover:from-brand-600/40 hover:to-fuchsia-600/40 text-brand-200 border border-brand-500/30 transition-all shadow-lg cursor-pointer"
          title={t.globalSlider || 'Slider Global (Fotos/GIFs)'}
        >
          <Sparkles size={15} className="text-amber-300 shrink-0" />
          {(!collapsed || isMobileOpen) && <span className="truncate">{t.globalSlider || 'Slider Global (Fotos/GIFs)'}</span>}
        </button>
      </div>

      {/* Footer Status */}
      <div className="p-3 border-t border-border bg-surface/40">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
          {(!collapsed || isMobileOpen) && (
            <div className="truncate">
              <span className="font-semibold text-slate-300">Anti-Bot Shield</span>
              <p className="text-[10px] text-slate-400">Stealth Active</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex h-screen flex-col glass-panel border-r border-border transition-all duration-300 relative z-30 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay with Smooth iOS Slide-In & Backdrop Blur */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-all duration-300 ease-out ${
          isMobileOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none delay-200'
        }`}
        aria-hidden={!isMobileOpen}
      >
        <div
          className={`fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity duration-300 ease-out ${
            isMobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onCloseMobile}
        />
        <div
          className={`fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-2xl border-r border-border z-50 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            isMobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarContent}
        </div>
      </div>
    </>
  );
};
