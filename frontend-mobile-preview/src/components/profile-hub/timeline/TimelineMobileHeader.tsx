import React, { useState, useRef, useEffect } from 'react';
import { Search, Bell, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useProfileTimelineStore } from '../../../store/useProfileTimelineStore';
import { updateNeedsAttention } from '../../../services/updateAlerts';

export interface TimelineMobileHeaderProps {
  onOpenMobileMenu?: () => void;
}

export const TimelineMobileHeader: React.FC<TimelineMobileHeaderProps> = ({ onOpenMobileMenu }) => {
  const isEn = useAppStore(state => state.settings?.language === 'en-US');
  const updateAttention = useAppStore(state => updateNeedsAttention(state.updateInfo, state.dismissedUpdateVersion));
  const setNotificationDrawerOpen = useAppStore(state => state.setNotificationDrawerOpen);
  const unreadCount = useAppStore(state => state.notifications.filter(notification => !notification.isRead).length);
  const searchQuery = useProfileTimelineStore(state => state.searchQuery);
  const setSearchQuery = useProfileTimelineStore(state => state.setSearchQuery);
  const selectedCreatorId = useProfileTimelineStore(state => state.selectedCreatorId);
  const setSelectedCreatorId = useProfileTimelineStore(state => state.setSelectedCreatorId);
  const [isSearchOpen, setSearchOpen] = useState(() => Boolean(searchQuery));
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isSearchOpen) searchInput.current?.focus();
  }, [isSearchOpen]);

  const closeSearch = () => {
    setSearchQuery('');
    setSearchOpen(false);
    searchTrigger.current?.focus();
  };

  return (
    <header data-timeline-toolbar="mobile" style={{top:'var(--timeline-parent-toolbar-top, 0px)'}} className="sticky top-0 z-40 bg-[var(--tl-surface-glass)] backdrop-blur-xl border-b border-[var(--tl-border)] px-3.5 py-2.5 shrink-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
      <button
        type="button"
        onClick={() => onOpenMobileMenu?.()}
        className="relative flex items-center gap-2.5 min-w-0 cursor-pointer group rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tl-accent-hover)]"
        title={isEn ? 'Open navigation menu' : 'Abrir menu de navegação'}
        aria-label={isEn ? `Open navigation menu${updateAttention ? ': update available' : ''}` : `Abrir menu de navegação${updateAttention ? ': atualização disponível' : ''}`}
      >
        <img
          src="/app-icon.png"
          alt="IMAGEX"
          className="w-7 h-7 rounded-lg object-cover shadow-md shrink-0 group-hover:scale-105 transition-transform"
        />
        {updateAttention && <span aria-hidden="true" className="absolute -top-0.5 left-5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-[var(--tl-surface)]" />}
        <span className="font-extrabold text-sm text-[var(--tl-text-primary)] tracking-tight truncate">
          IMAGEX
        </span>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        <button 
          ref={searchTrigger}
          type="button"
          onClick={() => {
            if (isSearchOpen) closeSearch();
            else {
              if (selectedCreatorId) setSelectedCreatorId(null);
              setSearchOpen(true);
            }
          }}
          aria-expanded={isSearchOpen}
          aria-controls="timeline-local-search"
          aria-label={isEn ? 'Search' : 'Buscar'}
          className="w-8 h-8 rounded-full bg-[var(--tl-surface-elevated)] border border-[var(--tl-border)] flex items-center justify-center text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors"
          title={isEn ? 'Search' : 'Buscar'}
        >
          {isSearchOpen ? <X className="w-3.5 h-3.5" /> : <Search className="w-3.5 h-3.5" />}
        </button>
        <button 
          type="button"
          onClick={() => setNotificationDrawerOpen(true)}
          className="w-8 h-8 rounded-full bg-[var(--tl-surface-elevated)] border border-[var(--tl-border)] flex items-center justify-center text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors relative"
          title={isEn ? 'Notifications' : 'Notificações'}
          aria-label={isEn ? `Notifications (${unreadCount} unread)` : `Notificações (${unreadCount} não lidas)`}
        >
          <Bell className="w-3.5 h-3.5" />
          {unreadCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--tl-accent)] ring-2 ring-[var(--tl-surface)]" />}
        </button>
      </div>
      </div>
      {isSearchOpen && <form id="timeline-local-search" role="search" className="mt-3 space-y-1.5" onSubmit={event => event.preventDefault()}>
        <label className="sr-only" htmlFor="timeline-local-search-input">{isEn ? 'Search loaded creators and posts' : 'Buscar criadores e publicações carregados'}</label>
        <input
          ref={searchInput}
          id="timeline-local-search-input"
          type="search"
          value={searchQuery}
          onChange={event => {
            if (selectedCreatorId) setSelectedCreatorId(null);
            setSearchQuery(event.target.value);
          }}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeSearch(); } }}
          aria-describedby="timeline-local-search-scope"
          placeholder={isEn ? 'Search loaded content...' : 'Buscar conteúdo carregado...'}
          className="w-full bg-[var(--tl-surface-elevated)] border border-[var(--tl-border)] rounded-xl px-3 py-2 text-xs text-[var(--tl-text-primary)] placeholder:text-[var(--tl-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-hover)]"
        />
        <p id="timeline-local-search-scope" className="text-[10px] text-[var(--tl-text-muted)]">{isEn ? 'Searches only creators and posts already loaded.' : 'Busca apenas criadores e publicações já carregados.'}</p>
      </form>}
    </header>
  );
};
