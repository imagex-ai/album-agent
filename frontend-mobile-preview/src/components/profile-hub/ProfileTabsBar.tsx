import React, { useEffect, useRef } from 'react';
import { Compass, X, Plus } from 'lucide-react';
import type { ProfileTabItem } from '../../store/useProfileHubStore';
import { profileSiteSource, ProfileSourceLabel } from './ProfileSourceLabel';

export interface ProfileTabsBarProps {
  openTabs: ProfileTabItem[];
  activeTabKey: string; // 'directory' or profileKey
  directoryLabel: string;
  closeTabLabel: string;
  newTabLabel: string;
  onSelectDirectory: () => void;
  onSelectProfile: (profileKey: string) => void;
  onCloseTab: (profileKey: string) => void;
  onNewTabClick?: () => void;
  className?: string;
  active?: boolean;
}

export const ProfileTabsBar: React.FC<ProfileTabsBarProps> = ({
  openTabs,
  activeTabKey,
  directoryLabel,
  closeTabLabel,
  newTabLabel,
  onSelectDirectory,
  onSelectProfile,
  onCloseTab,
  onNewTabClick,
  className = '',
  active = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !active) return;
    const revealActiveTab = () => {
      const tab = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!tab) return;
      const bounds = container.getBoundingClientRect();
      const rect = tab.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(container).paddingLeft) || 0;
      if (rect.left < bounds.left + padding) container.scrollLeft += rect.left - bounds.left - padding;
      else if (rect.right > bounds.right - padding) container.scrollLeft += rect.right - bounds.right + padding;
    };
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(container);
    revealActiveTab();
    return () => observer.disconnect();
  }, [active, activeTabKey, openTabs]);

  const isDirectoryActive = activeTabKey === 'directory';

  return (
    <div
      className={`w-full max-w-[1900px] mx-auto mb-3 ${className}`}
      role="region"
      aria-label="Profile Hub Tabs"
    >
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Profile Hub Navigation Tabs"
        onWheel={(e) => {
          if (containerRef.current) {
            containerRef.current.scrollLeft += e.deltaY;
          }
        }}
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-scroll py-1 px-1 border-b border-white/10 select-none"
      >
        {/* Permanent Primary Tab: Explore Profiles (Directory Catalog) */}
        <button
          type="button"
          role="tab"
          aria-selected={isDirectoryActive}
          tabIndex={isDirectoryActive ? 0 : -1}
          onClick={onSelectDirectory}
          title={directoryLabel}
          className={`group h-8 sm:h-9 px-3 rounded-t-lg flex items-center gap-2 text-xs font-semibold cursor-pointer transition-all border-t border-x shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
            isDirectoryActive
              ? 'bg-[#1e1b2e] text-white border-purple-500/50 shadow-[0_-4px_12px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/30'
              : 'bg-black/30 text-slate-400 hover:bg-white/5 hover:text-slate-200 border-white/5'
          }`}
        >
          <span className={`p-1 rounded transition-colors ${isDirectoryActive ? 'bg-purple-500/25 text-purple-300' : 'bg-white/5 text-slate-400 group-hover:text-purple-300'}`}>
            <Compass size={13} className="shrink-0" />
          </span>
          <span className="max-w-[140px] truncate">{directoryLabel}</span>
        </button>

        {/* Dynamic Profile Tabs */}
        {openTabs.map((tab) => {
          const isActive = activeTabKey === tab.key;
          const hasSiteSource = Boolean(profileSiteSource(tab.sourceUrl));
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectProfile(tab.key)}
              title={`${tab.name}${tab.sourceUrl ? ` • ${tab.sourceUrl}` : ''}`}
              className={`group h-8 sm:h-9 px-2.5 sm:px-3 ${hasSiteSource ? 'pr-4 sm:pr-4' : ''} rounded-t-lg flex items-center gap-2 text-xs font-semibold cursor-pointer transition-all border-t border-x shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                isActive
                  ? 'bg-[#1e1b2e] text-white border-purple-500/50 shadow-[0_-4px_12px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/30'
                  : 'bg-black/30 text-slate-400 hover:bg-white/5 hover:text-slate-200 border-white/5'
              }`}
            >
              {tab.avatarUrl ? (
                <img
                  src={tab.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={`w-4 h-4 rounded-full object-cover shrink-0 ring-1 ${isActive ? 'ring-purple-400' : 'ring-white/20'}`}
                />
              ) : (
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] uppercase font-bold shrink-0 ${isActive ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  {tab.name.charAt(0) || 'P'}
                </div>
              )}

              <ProfileSourceLabel name={tab.name} sourceUrl={tab.sourceUrl} active={active} nameClassName="max-w-[110px] sm:max-w-[150px] truncate" />

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.key);
                }}
                className="opacity-60 hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/20 p-0.5 rounded transition-all ml-0.5"
                title={`${closeTabLabel}: ${tab.name}`}
                aria-label={`${closeTabLabel}: ${tab.name}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {/* New Tab / Search Shortcut Button */}
        {onNewTabClick && (
          <button
            type="button"
            onClick={onNewTabClick}
            title={newTabLabel}
            aria-label={newTabLabel}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-purple-300 hover:bg-white/5 transition-colors border border-dashed border-white/10 shrink-0 ml-1"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
