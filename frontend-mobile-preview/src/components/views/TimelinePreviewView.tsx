import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Smartphone, Monitor, ArrowLeft } from 'lucide-react';
import { ProfileTimelineView } from '../profile-hub/timeline/ProfileTimelineView';
import { TimelineMobileHeader } from '../profile-hub/timeline/TimelineMobileHeader';
import { useAppStore } from '../../store/useAppStore';
import { useProfileTimelineStore } from '../../store/useProfileTimelineStore';

export const TimelinePreviewView: React.FC<{active?: boolean; onOpenMobileMenu?: () => void}> = ({active = true, onOpenMobileMenu}) => {
  const isEn = useAppStore(state => state.settings?.language === 'en-US');
  const navigateToView = useAppStore(state => state.navigateToView);
  const pendingCreatorReturn = useProfileTimelineStore(state => state.pendingCreatorReturn);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>(() =>
    useProfileTimelineStore.getState().pendingCreatorReturn?.preferDesktopPreview ? 'desktop' : 'mobile'
  );
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  useLayoutEffect(() => {
    if (active && pendingCreatorReturn?.preferDesktopPreview) {
      setViewMode('desktop');
    }
  }, [active, pendingCreatorReturn]);

  useEffect(() => {
    if (!active) return;
    const checkMobile = () => {
      const isMobileWidth = window.innerWidth < 768;
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      setIsMobileDevice(isMobileWidth || (isTouch && window.innerWidth <= 1024));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [active]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!active || !surface) return;
    const toolbars = Array.from(surface.querySelectorAll<HTMLElement>('[data-timeline-toolbar]'));
    const update = () => {
      const desktop = toolbars.find(element => element.dataset.timelineToolbar === 'desktop');
      const desktopHeight = desktop?.offsetHeight || 0;
      surface.style.setProperty('--timeline-parent-toolbar-top', `${desktopHeight}px`);
      surface.style.setProperty('--timeline-watch-top', `${toolbars.reduce((sum, element) => sum + element.offsetHeight, 0)}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    toolbars.forEach(element => observer?.observe(element));
    return () => observer?.disconnect();
  }, [active, isMobileDevice, viewMode]);

  const isPhonePreview = !isMobileDevice && viewMode === 'mobile';

  // Se o usuário estiver no Desktop: permite alternar entre simulação de celular e modo desktop
  return (
    <div ref={surfaceRef} className={`flex-1 tl-themed bg-[var(--tl-bg)] text-[var(--tl-text-primary)] flex flex-col ${isMobileDevice ? 'w-full antialiased' : ''}`}>
      {/* Barra de Controle de Prévia (Exibida somente no desktop) */}
      {!isMobileDevice && <div data-timeline-toolbar="desktop" className="sticky top-0 shrink-0 bg-[var(--tl-surface-glass)] backdrop-blur-md border-b border-[var(--tl-border)] px-4 py-2.5 flex items-center justify-between z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateToView('home')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--tl-surface-elevated)] hover:bg-[var(--tl-surface-hover)] border border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] text-xs font-semibold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{isEn ? 'Back to App' : 'Voltar ao App'}</span>
          </button>
          <div className="h-4 w-px bg-[var(--tl-border-strong)] hidden sm:block" />
          <span className="text-xs font-bold text-[var(--tl-accent-text)] tracking-wide uppercase hidden sm:inline">
            {isEn ? 'Timeline Component (Isolated)' : 'Linha do Tempo Isolada (Sem Impactar App)'}
          </span>
        </div>

        {/* Alternador de Modo de Visualização */}
        <div className="flex items-center gap-1 bg-[var(--tl-bg)] p-1 rounded-xl border border-[var(--tl-border)]">
          <button
            onClick={() => setViewMode('mobile')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'mobile'
                ? 'bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] shadow-md'
                : 'text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>{isEn ? 'Mobile View' : 'Modo Mobile'}</span>
          </button>
          <button
            onClick={() => setViewMode('desktop')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'desktop'
                ? 'bg-[var(--tl-accent)] text-[var(--tl-accent-contrast)] shadow-md'
                : 'text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>{isEn ? 'Desktop View' : 'Modo Desktop'}</span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-[var(--tl-text-muted)] hidden md:block">
          <code>/#/timeline-preview</code>
        </div>
      </div>}

      {isMobileDevice && <TimelineMobileHeader onOpenMobileMenu={onOpenMobileMenu} />}

      {/* Keep the timeline's ancestor path stable across viewport and preview modes.
          Boxless wrappers retain the native and desktop layouts without remounting media. */}
      <div className={isMobileDevice ? 'contents' : 'flex-1 flex justify-center items-start p-4 sm:p-6 bg-[var(--tl-bg)]'}>
        <div className={isPhonePreview
          ? `w-full max-w-[430px] my-4 rounded-[36px] bg-[var(--tl-bg)] border-[6px] border-[var(--tl-border-strong)] shadow-2xl ${watchOpen ? 'overflow-visible' : 'overflow-hidden'} flex flex-col`
          : 'contents'}>
          {isPhonePreview && <TimelineMobileHeader onOpenMobileMenu={onOpenMobileMenu} />}
          <div className={isMobileDevice
            ? 'w-full max-w-lg mx-auto py-3.5 space-y-4 pb-24 flex-1'
            : isPhonePreview
              ? 'py-3.5 space-y-4 pb-20'
              : `w-full ${watchOpen ? 'max-w-7xl' : 'max-w-4xl'} py-2`}>
            <ProfileTimelineView active={active} isMobileOnly={isMobileDevice || isPhonePreview} onWatchOpenChange={setWatchOpen} />
          </div>
        </div>
      </div>
    </div>
  );
};
