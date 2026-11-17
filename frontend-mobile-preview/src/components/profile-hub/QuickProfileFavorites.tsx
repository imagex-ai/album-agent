import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, X } from 'lucide-react';
import type { ProfileShortcut } from '../../store/useProfileDirectoryLibraryStore';
import { useProfileDirectoryLibraryStore } from '../../store/useProfileDirectoryLibraryStore';
import { profileDirectoryCopy } from '../../services/profileDirectoryCopy';
import type { Language } from '../../types';
import { ProfileSourceLabel } from './ProfileSourceLabel';

interface Props {
  favorites: ProfileShortcut[];
  currentUrl: string;
  language: Language;
  active: boolean;
  onOpen: (favorite: ProfileShortcut) => void;
}

export function QuickProfileFavorites({ favorites, currentUrl, language, active, onOpen }: Props) {
  const copy = profileDirectoryCopy[language];
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });

  useEffect(() => {
    const element = strip.current;
    if (!element || !active) return;
    const measure = () => {
      // One CSS pixel accommodates fractional scroll coordinates at browser zoom.
      setEdges({ previous: element.scrollLeft > 1,
        next: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); };
  }, [active, favorites, language]);

  const scroll = (direction: number) => {
    const element = strip.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return (
    <section className="pd-quick-favorites" aria-label={copy.favorites}>
      <div className="pd-quick-favorites-label"><Heart size={14} /><span>{copy.favorites}</span></div>
      <button type="button" className="pd-icon-button pd-favorites-scroll" aria-label={copy.previousFavorites}
        title={copy.previousFavorites} disabled={!edges.previous} onClick={() => scroll(-1)}><ChevronLeft size={16} /></button>
      <div className="pd-quick-favorites-viewport no-scrollbar" ref={strip}
        data-overflow-start={edges.previous} data-overflow-end={edges.next}>
        <div className="pd-quick-favorites-items">
          {favorites.map(favorite => (
            <div key={favorite.key} className={`pd-quick-favorite ${favorite.url.replace(/\/+$/, '') === currentUrl.replace(/\/+$/, '') ? 'is-active' : ''}`}>
              <button type="button" className="pd-quick-favorite-open" onClick={() => onOpen(favorite)} title={`${favorite.name || favorite.url} • ${favorite.url}`}>
                {favorite.imageUrl
                  ? <img src={favorite.imageUrl} alt="" referrerPolicy="no-referrer" />
                  : <span className="pd-quick-favorite-avatar">{(favorite.name || favorite.url).charAt(0).toUpperCase()}</span>}
                <ProfileSourceLabel name={favorite.name || favorite.url} sourceUrl={favorite.url} active={active} nameClassName="font-medium truncate max-w-[160px]" />
              </button>
              <button type="button" className="pd-quick-favorite-remove" onClick={() => useProfileDirectoryLibraryStore.getState().toggleFavorite(favorite)}
                title={copy.unfavorite} aria-label={`${copy.unfavorite} ${favorite.name || favorite.url}`}><X size={13} /></button>
            </div>
          ))}
        </div>
      </div>
      <button type="button" className="pd-icon-button pd-favorites-scroll" aria-label={copy.nextFavorites}
        title={copy.nextFavorites} disabled={!edges.next} onClick={() => scroll(1)}><ChevronRight size={16} /></button>
    </section>
  );
}
