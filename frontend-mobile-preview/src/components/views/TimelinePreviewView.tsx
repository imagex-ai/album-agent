import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ProfileTimelineView } from '../profile-hub/timeline/ProfileTimelineView';
import { TimelineMobileHeader } from '../profile-hub/timeline/TimelineMobileHeader';

function isMobileTimeline(): boolean {
  if (typeof window === 'undefined') return false;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return window.innerWidth < 768 || (isTouch && window.innerWidth <= 1024);
}

export const TimelinePreviewView: React.FC<{active?: boolean; onOpenMobileMenu?: () => void}> = ({active = true, onOpenMobileMenu}) => {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(isMobileTimeline);

  useEffect(() => {
    if (!active) return;
    const update = () => setIsMobileDevice(isMobileTimeline());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!active || !surface) return;
    const toolbars = Array.from(surface.querySelectorAll<HTMLElement>('[data-timeline-toolbar]'));
    const update = () => {
      surface.style.setProperty('--timeline-parent-toolbar-top', '0px');
      surface.style.setProperty('--timeline-watch-top', `${toolbars.reduce((sum, element) => sum + element.offsetHeight, 0)}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    toolbars.forEach(element => observer?.observe(element));
    return () => observer?.disconnect();
  }, [active, isMobileDevice]);

  return (
    <div ref={surfaceRef} className={`flex-1 tl-themed bg-[var(--tl-bg)] text-[var(--tl-text-primary)] flex flex-col ${isMobileDevice ? 'w-full antialiased' : ''}`}>
      {isMobileDevice && <TimelineMobileHeader onOpenMobileMenu={onOpenMobileMenu} />}
      {/* Keep the timeline's ancestor path stable across viewport changes. */}
      <div className={isMobileDevice ? 'contents' : 'flex-1 flex justify-center items-start p-4 sm:p-6 bg-[var(--tl-bg)]'}>
        <div className="contents">
          <div className={isMobileDevice
            ? 'w-full max-w-lg mx-auto py-3.5 space-y-4 pb-24 flex-1'
            : `w-full ${watchOpen ? 'max-w-7xl' : 'max-w-4xl'} py-2`}>
            <ProfileTimelineView active={active} isMobileOnly={isMobileDevice} onWatchOpenChange={setWatchOpen} />
          </div>
        </div>
      </div>
    </div>
  );
};
