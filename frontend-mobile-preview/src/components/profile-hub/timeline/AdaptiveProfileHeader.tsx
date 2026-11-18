import React from 'react';
import { 
  ArrowLeft, 
  FolderPlus, 
  Share2, 
  Check, 
  UserPlus, 
  Youtube, 
  Globe,
  Film
} from 'lucide-react';
import { TimelineCreator, resolveCreatorHandle, resolveTimelinePlatform } from './timelineModel';
import { SourceAvatar } from '../common/SourceAvatar';
import { useResolvedAvatar } from '../../../store/useProfileAvatarStore';
import { useProfileTimelineStore } from '../../../store/useProfileTimelineStore';
import { useAppStore } from '../../../store/useAppStore';
import { profileShortcutIdentity, useProfileDirectoryLibraryStore } from '../../../store/useProfileDirectoryLibraryStore';
import { openProfileInHub } from '../../../services/profileHubEntry';
import { handleProxiedImageError } from '../../../services/profileHubImageFallback';

interface AdaptiveProfileHeaderProps {
  creator: TimelineCreator;
  onBack: () => void;
  backLabel?: string;
}

export const AdaptiveProfileHeader: React.FC<AdaptiveProfileHeaderProps> = ({
  creator,
  onBack,
  backLabel,
}) => {
  const isEn = useAppStore(state => state.settings?.language === 'en-US');
  const addNotification = useAppStore(state => state.addNotification);

  const toggleFollowCreator = useProfileTimelineStore(state => state.toggleFollowCreator);
  const favorites = useProfileDirectoryLibraryStore(state => state.favorites);
  const favoritesSyncStatus = useProfileDirectoryLibraryStore(state => state.favoritesSyncStatus);
  const initSync = useProfileDirectoryLibraryStore(state => state.initSync);
  const creatorIdentity = profileShortcutIdentity(creator.profileUrl);
  const cleanHandle = resolveCreatorHandle({
    handle: creator.handle,
    name: creator.name,
    profileUrl: creator.profileUrl,
  });
  const isFollowing = !!creatorIdentity && favorites.some(item => item.kind === 'profile' && profileShortcutIdentity(item.url) === creatorIdentity);
  const creatorName = creator.name?.trim() || (isEn ? 'Unknown creator' : 'Criador desconhecido');
  const rawCreatorAvatar = creator.avatar && !creator.avatar.startsWith('data:image/gif') ? creator.avatar : null;
  const resolvedCreatorAvatar = useResolvedAvatar(creator.profileUrl, rawCreatorAvatar, {
    hydrate: !rawCreatorAvatar && Boolean(creator.profileUrl),
  });
  const handleFollow = () => {
    if (!toggleFollowCreator(creator)) {
      addNotification({
        type: 'error',
        title: isEn ? 'Could not update saved creator' : 'Não foi possível atualizar o criador salvo',
        message: isEn ? 'The change could not be queued. Check the profile and try again.' : 'Não foi possível colocar a alteração na fila. Confira o perfil e tente novamente.',
      });
    }
  };

  // Identificação do badge da plataforma
  const site = resolveTimelinePlatform(creator.profileUrl, creator.site) || '';
  const platformBadges: Record<string, { label: string; icon: React.ReactNode; colorClass: string }> = {
    youtube: {
      label: isEn ? 'YouTube Channel' : 'Canal YouTube',
      icon: <Youtube className="w-3.5 h-3.5 text-red-500 fill-red-500" />,
      colorClass: 'bg-[var(--tl-surface-glass)] text-red-300 border-red-500/40'
    },
    eporner: {
      label: isEn ? 'Eporner Creator' : 'Criador Eporner',
      icon: <Film className="w-3.5 h-3.5 text-[var(--tl-accent-text)]" />,
      colorClass: 'bg-[var(--tl-surface-glass)] text-[var(--tl-accent-text)] border-[var(--tl-accent-border)]'
    },
    pornhub: {
      label: isEn ? 'Pornhub Creator' : 'Criador Pornhub',
      icon: <Film className="w-3.5 h-3.5 text-amber-400" />,
      colorClass: 'bg-[var(--tl-surface-glass)] text-amber-300 border-amber-500/40'
    },
    xhamster: {
      label: isEn ? 'xHamster Creator' : 'Criador xHamster',
      icon: <Film className="w-3.5 h-3.5 text-rose-400" />,
      colorClass: 'bg-[var(--tl-surface-glass)] text-rose-300 border-rose-500/40'
    }
  };
  const platformBadge = platformBadges[site] ?? {
    label: isEn ? 'Creator' : 'Criador',
    icon: <Globe className="w-3.5 h-3.5 text-[var(--tl-accent-text)]" />,
    colorClass: 'bg-[var(--tl-surface-glass)] text-[var(--tl-accent-text)] border-[var(--tl-accent-border)]'
  };

  const handleShare = () => {
    const shareUrl = creator.profileUrl || window.location.href;
    const showManualCopy = () => addNotification({
      type: 'info',
      title: isEn ? 'Copy link manually' : 'Copie o link manualmente',
      message: isEn ? `Automatic copying is unavailable. Copy this link: ${shareUrl}` : `A cópia automática está indisponível. Copie este link: ${shareUrl}`,
    });
    if (typeof navigator.clipboard?.writeText === 'function') {
      navigator.clipboard.writeText(shareUrl).then(() => {
        addNotification({
          type: 'info',
          title: isEn ? 'Link copied' : 'Link copiado',
          message: isEn ? 'Profile link copied to clipboard' : 'Link do perfil copiado para a área de transferência'
        });
      }).catch(showManualCopy);
    } else showManualCopy();
  };

  const stats = creator.stats || {};
  const metricValue = (value: string | number | undefined) => {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0
        ? value.toLocaleString(isEn ? 'en-US' : 'pt-BR')
        : null;
    }
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const openInHubLabel = isEn
    ? 'Open profile in Profile Hub for review'
    : 'Abrir perfil no Profile Hub para revisão';
  const handleOpenInHub = () => {
    if (!openProfileInHub(creator.profileUrl)) {
      addNotification({
        type: 'info',
        title: isEn ? 'Unable to open profile' : 'Não foi possível abrir o perfil',
        message: isEn ? 'The profile URL is missing or invalid.' : 'A URL do perfil está ausente ou é inválida.',
      });
    }
  };
  const candidates: Array<{ label: string; raw: string | number | undefined; hideWhenZero?: boolean; highlight?: string }> = [
    { label: 'POSTS', raw: stats.posts },
    { label: isEn ? 'VIDEOS' : 'VÍDEOS', raw: stats.videos },
    { label: isEn ? 'ALBUMS' : 'ÁLBUNS', raw: stats.albums, hideWhenZero: true },
    { label: 'GIFs', raw: stats.gifs, hideWhenZero: true },
    { label: isEn ? 'LIKES' : 'CURTIDAS', raw: stats.likes, highlight: 'text-rose-400' },
    { label: isEn ? 'SUBSCRIBERS' : 'INSCRITOS', raw: stats.subscribers ?? stats.followers, highlight: 'text-[var(--tl-accent-text)]' },
    { label: isEn ? 'VIEWS' : 'VISUALIZAÇÕES', raw: stats.views },
  ];
  const metrics = candidates.flatMap((entry) => {
    if (entry.hideWhenZero && entry.raw === 0) return [];
    const value = metricValue(entry.raw);
    return value !== null ? [{ label: entry.label, value, highlight: entry.highlight }] : [];
  });
  const mobileGridClass =
    metrics.length <= 1
      ? 'grid-cols-1'
      : metrics.length === 3
        ? 'grid-cols-3'
        : metrics.length <= 4
          ? 'grid-cols-2'
          : 'grid-cols-2 min-[420px]:grid-cols-3';

  return (
    <div className="space-y-4">
      {/* Botão Voltar */}
      <div className="flex items-center justify-between gap-3 px-3.5 sm:px-0 min-w-0">
        <button
          data-action="back-to-timeline"
          onClick={onBack}
          className="group/back cute-press flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--tl-surface)] hover:bg-[var(--tl-surface-hover)] border border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] text-xs font-semibold shadow transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-[var(--tl-accent-text)] cute-nudge-left" />
          <span>{backLabel || (isEn ? 'Back to Timeline' : 'Voltar para a Linha do Tempo')}</span>
        </button>

        {cleanHandle && (
          <span className="text-[10px] font-mono text-[var(--tl-text-muted)] min-w-0 truncate text-right">
            {cleanHandle}
          </span>
        )}
      </div>

      {/* Hero Card Nativo — Encostando nas laterais no mobile */}
      <div className="w-full bg-[var(--tl-surface)] border border-[var(--tl-border)] rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl relative">
        {/* Banner com Efeito Ambiente Desfocado */}
        <div
          className="relative h-32 w-full overflow-hidden bg-[var(--tl-surface-elevated)]"
          style={{ backgroundImage: 'linear-gradient(135deg, var(--tl-accent-soft), var(--tl-surface), var(--tl-accent-soft))' }}
        >
          {resolvedCreatorAvatar.src && (
            <img
              src={resolvedCreatorAvatar.src}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-40 scale-125"
              onError={(e) =>
                handleProxiedImageError(e, {
                  rawUrl: resolvedCreatorAvatar.src,
                  referer: creator.profileUrl,
                  hideOnExhausted: true,
                })
              }
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--tl-surface)] via-[var(--tl-hero-via)] to-transparent" />

          {/* Badge da Plataforma no Canto Superior Direito */}
          <div className="absolute top-2.5 right-2.5">
            <a
              href={creator.profileUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border backdrop-blur-md shadow ${platformBadge.colorClass}`}
            >
              {platformBadge.icon}
              <span>{platformBadge.label}</span>
            </a>
          </div>
        </div>

        <div className="px-4 pb-4 pt-0 relative">
          {/* Avatar e Nome com Sobreposição (-mt-10) */}
          <div className="flex items-end gap-3 -mt-10">
            <div className="relative w-18 h-18 rounded-full p-1 bg-gradient-to-tr from-[var(--tl-gradient-from)] to-[var(--tl-gradient-to)] border-4 border-[var(--tl-surface)] shadow-2xl shrink-0">
              <SourceAvatar
                name={creatorName}
                src={rawCreatorAvatar}
                profileUrl={creator.profileUrl}
                referer={creator.profileUrl}
                hydrate={!rawCreatorAvatar && Boolean(creator.profileUrl)}
                alt={creatorName}
                className="w-16 h-16 rounded-full object-cover bg-[var(--tl-surface)]"
              />
              {creator.verified === true && <div aria-label={isEn ? 'Verified creator' : 'Criador verificado'} className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-[var(--tl-accent)] border-2 border-[var(--tl-surface)] text-[var(--tl-accent-contrast)] flex items-center justify-center text-[8px] font-bold">
                ✓
              </div>}
            </div>

            <div className="space-y-0.5 flex-1 min-w-0 pb-1">
              <h3 data-profile-creator-name={creator.name} className="text-base font-black text-[var(--tl-text-primary)] truncate">
                {creatorName}
              </h3>
              {cleanHandle && (
                <p className="text-[11px] font-semibold text-[var(--tl-accent-text)] font-mono truncate">
                  {cleanHandle}
                </p>
              )}
            </div>
          </div>

          {creator.bio && (
            <p className="text-xs text-[var(--tl-text-secondary)] line-clamp-2 mt-2 leading-relaxed">
              {creator.bio}
            </p>
          )}

          {/* Botões de Ação em Linha Dedicada */}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleFollow}
              aria-pressed={isFollowing}
              className={`cute-press flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 smooth-transition shadow-md ${
                isFollowing
                  ? 'bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] text-[var(--tl-accent-contrast)] shadow-md'
                  : 'bg-[var(--tl-surface-elevated)] text-[var(--tl-text-primary)] border border-[var(--tl-border)] hover:bg-[var(--tl-surface-hover)]'
              }`}
            >
              {isFollowing ? (
                <>
                  <Check className="w-4 h-4 text-[var(--tl-accent-contrast)] follow-spring" />
                  <span>{isEn ? 'Following' : 'Seguindo'}</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>{isEn ? 'Follow Creator' : 'Seguir Criador'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-action="open-profile-in-hub"
              onClick={handleOpenInHub}
              aria-label={openInHubLabel}
              className="group/hub cute-press p-2 rounded-xl bg-[var(--tl-surface-elevated)] border border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors"
              title={openInHubLabel}
            >
              <FolderPlus className="w-4 h-4 transition-transform duration-200 group-hover/hub:-rotate-6 group-hover/hub:-translate-y-0.5 motion-reduce:transform-none" />
            </button>

            <button
              onClick={handleShare}
              className="cute-press p-2 rounded-xl bg-[var(--tl-surface-elevated)] border border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors"
              title={isEn ? 'Share Profile' : 'Compartilhar Perfil'}
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>

          {(favoritesSyncStatus === 'pending' || favoritesSyncStatus === 'unavailable') && (
            <p role="status" className="text-[10px] text-[var(--tl-text-muted)] mt-2">
              {favoritesSyncStatus === 'pending'
                ? (isEn ? 'Syncing saved creators…' : 'Sincronizando criadores salvos…')
                : (isEn ? 'Sync unavailable. Saved creators may be out of date.' : 'Sincronização indisponível. Os criadores salvos podem estar desatualizados.')}
              {favoritesSyncStatus === 'unavailable' && <button type="button" onClick={() => void initSync()} className="ml-2 underline hover:text-[var(--tl-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]">{isEn ? 'Try again' : 'Tentar novamente'}</button>}
            </p>
          )}

          {/* Métricas Sociais Reais (Grid Responsivo no Mobile + Flex com Divisores no Desktop) */}
          {metrics.length > 0 && (
            <div
              data-testid="profile-metrics-bar"
              className={`grid ${mobileGridClass} gap-2.5 sm:gap-0 sm:flex sm:flex-nowrap sm:items-center sm:justify-around p-2.5 bg-[var(--tl-surface-elevated)] border border-[var(--tl-border)] rounded-2xl mt-3 text-center`}
            >
              {metrics.map((m, idx) => (
                <React.Fragment key={m.label}>
                  {idx > 0 && <div className="hidden sm:block w-px h-5 bg-[var(--tl-border)] shrink-0" />}
                  <div className="px-1.5 sm:px-2 sm:flex-1 min-w-0">
                    <span className={`block text-xs font-black tabular-nums truncate ${m.highlight || 'text-[var(--tl-text-primary)]'}`}>
                      {m.value}
                    </span>
                    <span className="block text-[9px] font-semibold text-[var(--tl-text-muted)] uppercase tracking-wider truncate">
                      {m.label}
                    </span>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
