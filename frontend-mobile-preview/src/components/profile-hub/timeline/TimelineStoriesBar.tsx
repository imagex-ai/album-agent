import React, { useEffect } from 'react';
import { Heart } from 'lucide-react';
import { TimelineCreator } from './timelineModel';
import { useAppStore } from '../../../store/useAppStore';
import { useProfileDirectoryLibraryStore } from '../../../store/useProfileDirectoryLibraryStore';
import { useProfileAvatarStore } from '../../../store/useProfileAvatarStore';
import { SourceAvatar } from '../common/SourceAvatar';

interface TimelineStoriesBarProps {
  creators: TimelineCreator[];
  onSelectCreator: (creatorId: string | null) => void;
  selectedCreatorId: string | null;
}

export const getInitialsAvatar = (name: string) => {
  const first = Array.from((name || '').trim())[0] || 'C';
  // Keep complete code points; isolated UTF-16 surrogates cannot be URI encoded.
  const initial = (/^[\uD800-\uDFFF]$/.test(first) ? 'C' : first)
    .toUpperCase()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="avatarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#9333ea" />
        <stop offset="100%" stop-color="#4f46e5" />
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill="url(#avatarGrad)" />
    <text x="50" y="62" font-family="system-ui, -apple-system, sans-serif" font-size="44" font-weight="bold" fill="#ffffff" text-anchor="middle">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const TimelineStoriesBar: React.FC<TimelineStoriesBarProps> = ({
  creators,
  onSelectCreator,
  selectedCreatorId
}) => {
  const isEn = useAppStore(state => state.settings?.language === 'en-US');
  const favoritesSyncStatus = useProfileDirectoryLibraryStore(state => state.favoritesSyncStatus);
  const initSync = useProfileDirectoryLibraryStore(state => state.initSync);
  const seedAvatars = useProfileAvatarStore(state => state.seedAvatars);

  useEffect(() => {
    seedAvatars(
      creators.map((c) => ({
        url: c.profileUrl,
        avatar: c.avatar && !c.avatar.startsWith('data:image/gif') ? c.avatar : null,
      }))
    );
  }, [creators, seedAvatars]);

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden bg-[var(--tl-surface)] border border-[var(--tl-border)] rounded-2xl p-3.5 shadow-xl">
      <div className="flex items-center justify-between pb-2 text-[10px] font-bold text-[var(--tl-text-muted)] uppercase tracking-wider px-1">
        <span>{isEn ? 'Saved creators' : 'Criadores salvos'}</span>
        <span id="creators-count-badge" className="text-[var(--tl-accent-text)] font-mono">
          {creators.length}
        </span>
      </div>

      {(favoritesSyncStatus === 'pending' || favoritesSyncStatus === 'unavailable') && (
        <p role="status" className="px-1 pb-2 text-[10px] text-[var(--tl-text-muted)]">
          {favoritesSyncStatus === 'pending'
            ? (isEn ? 'Syncing saved creators…' : 'Sincronizando criadores salvos…')
            : (isEn ? 'Sync unavailable. Saved creators may be out of date.' : 'Sincronização indisponível. Os criadores salvos podem estar desatualizados.')}
          {favoritesSyncStatus === 'unavailable' && <button type="button" onClick={() => void initSync()} className="ml-2 underline hover:text-[var(--tl-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]">{isEn ? 'Try again' : 'Tentar novamente'}</button>}
        </p>
      )}

      <div className="flex items-center gap-3.5 overflow-x-auto py-1.5 px-2 no-scrollbar">
        {/* Botão Todos / Feed Geral */}
        <button
          type="button"
          onClick={() => onSelectCreator(null)}
          className="flex flex-col items-center gap-1 shrink-0 group focus:outline-none cursor-pointer"
          title={isEn ? 'All Creators' : 'Todos os Criadores'}
        >
          <div className={`w-14 h-14 rounded-full p-0.5 bg-gradient-to-tr from-[var(--tl-gradient-from)] to-[var(--tl-gradient-to)] border-2 smooth-transition group-hover:scale-105 ${
            selectedCreatorId === null 
              ? 'border-[var(--tl-accent-hover)] scale-105 story-ring-active ring-2 ring-[var(--tl-accent-ring)]' 
              : 'border-transparent opacity-80 group-hover:opacity-100 group-hover:border-[var(--tl-accent-border)]'
          }`}>
            <div className="w-full h-full rounded-full bg-[var(--tl-surface)] flex items-center justify-center text-[var(--tl-accent-text)]">
              <Heart className="w-5 h-5 fill-current" />
            </div>
          </div>
          <span className={`text-[10px] font-semibold max-w-[56px] truncate smooth-transition ${
            selectedCreatorId === null ? 'text-[var(--tl-accent-text)] font-bold' : 'text-[var(--tl-text-secondary)] group-hover:text-[var(--tl-text-primary)]'
          }`}>
            {isEn ? 'All' : 'Todos'}
          </span>
        </button>

        {/* Círculos de Criadores */}
        {creators.map((creator) => {
          const isSelected = selectedCreatorId === creator.id;
          const creatorName = creator.name?.trim() || (isEn ? 'Unknown creator' : 'Criador desconhecido');
          const hasValidAvatar = creator.avatar && !creator.avatar.startsWith('data:image/gif') && creator.avatar.length > 50;

          return (
            <button
              type="button"
              key={creator.id}
              data-creator-id={creator.id}
              onClick={() => onSelectCreator(creator.id)}
              className="flex flex-col items-center gap-1 shrink-0 group focus:outline-none cursor-pointer"
              title={creatorName}
            >
              <div className={`w-14 h-14 rounded-full p-0.5 bg-gradient-to-tr from-[var(--tl-gradient-from)] to-[var(--tl-gradient-to)] border-2 smooth-transition group-hover:scale-105 ${
                isSelected 
                  ? 'border-[var(--tl-accent-hover)] ring-2 ring-[var(--tl-accent-ring)] scale-105 story-ring-active' 
                  : 'border-[var(--tl-border-strong)] group-hover:border-[var(--tl-accent)]'
              }`}>
                <SourceAvatar
                  name={creatorName}
                  src={hasValidAvatar ? creator.avatar : null}
                  profileUrl={creator.profileUrl}
                  referer={creator.profileUrl}
                  hydrate={!hasValidAvatar && Boolean(creator.profileUrl)}
                  alt={creatorName}
                  className="w-full h-full rounded-full object-cover bg-[var(--tl-surface)]"
                />
              </div>
              <span className={`text-[10px] font-semibold max-w-[56px] truncate smooth-transition ${
                isSelected ? 'text-[var(--tl-accent-text)] font-bold' : 'text-[var(--tl-text-secondary)] group-hover:text-[var(--tl-text-primary)]'
              }`}>
                {creatorName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
