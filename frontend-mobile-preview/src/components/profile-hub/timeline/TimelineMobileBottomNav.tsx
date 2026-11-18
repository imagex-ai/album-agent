import React from 'react';
import { Home, Compass, FolderClosed, MoreHorizontal } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';

export const TimelineMobileBottomNav: React.FC = () => {
  const isEn = useAppStore(state => state.settings?.language === 'en-US');
  const navigateToView = useAppStore(state => state.navigateToView);

  return (
    <nav className="sticky bottom-0 left-0 right-0 z-40 bg-[var(--tl-surface-glass)] backdrop-blur-lg border-t border-[var(--tl-border)] px-6 py-2 flex items-center justify-between shrink-0 shadow-2xl">
      <button 
        type="button"
        onClick={() => navigateToView('home')}
        className="flex flex-col items-center gap-0.5 text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] transition-colors"
      >
        <Home className="w-4 h-4" />
        <span className="text-[10px] font-semibold">{isEn ? 'Home' : 'Início'}</span>
      </button>

      <button 
        type="button"
        className="flex flex-col items-center gap-0.5 text-[var(--tl-accent-text)] font-bold"
      >
        <Compass className="w-4 h-4 text-[var(--tl-accent-text)]" />
        <span className="text-[10px] font-semibold">Profile Hub</span>
      </button>

      <button 
        type="button"
        onClick={() => navigateToView('gallery')}
        className="flex flex-col items-center gap-0.5 text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] transition-colors"
      >
        <FolderClosed className="w-4 h-4" />
        <span className="text-[10px] font-semibold">{isEn ? 'Library' : 'Biblioteca'}</span>
      </button>

      <button 
        type="button"
        className="flex flex-col items-center gap-0.5 text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
        <span className="text-[10px] font-semibold">{isEn ? 'More' : 'Mais'}</span>
      </button>
    </nav>
  );
};
