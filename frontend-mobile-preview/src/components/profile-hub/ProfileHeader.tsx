import { formatProfileBioValue, profileBioEntries, useProfileHubPresentation } from '../../services/profileHubPresentation';
import { soundEffects } from '../../services/soundEffects';
import React, { useState, useRef, useEffect } from 'react';
import { 
  Folder, 
  MoreHorizontal, 
  ChevronDown, 
  Check, 
  Film, 
  ListMusic, 
  Images, 
  Heart,
  Copy,
  ExternalLink,
  RotateCw,
  RotateCcw,
  CheckSquare,
  Square
} from 'lucide-react';
import { ProfileHeroData } from './profileHubTypes';

export interface ProfileHeaderProps {
  profile: ProfileHeroData;
  sourceUrl?: string;
  onDestinationFolderChange?: (folder: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onToggleFollow?: () => void;
  onRefresh?: () => void;
  onSelectAllMedia?: () => void;
  onClearSelection?: () => void;
  hasSelection?: boolean;
  onRestoreDemo?: () => void;
  demoMode?: boolean;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  profile,
  sourceUrl,
  onDestinationFolderChange,
  isFavorite,
  onToggleFavorite,
  onToggleFollow,
  onRefresh,
  onSelectAllMedia,
  onClearSelection,
  hasSelection = false,
  onRestoreDemo,
  demoMode = false,
}) => {
  const { copy, sourceLabel } = useProfileHubPresentation();
  const bioDetails = profileBioEntries(profile.bio_details);
  const socialLinks = Object.entries(profile.social_links ?? {}).filter(([, link]) => typeof link === 'string' && link.trim());
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [following, setFollowing] = useState(profile.following ?? false);

  const favoriteActive = isFavorite !== undefined ? isFavorite : following;
  const showFavoriteBtn = Boolean(onToggleFavorite || onToggleFollow);

  const handleToggleFav = () => {
    soundEffects.star();
    if (onToggleFavorite) {
      onToggleFavorite();
    } else if (onToggleFollow) {
      setFollowing(!following);
      onToggleFollow();
    }
  };

  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const folderTriggerRef = useRef<HTMLButtonElement>(null);

  // Close More Actions Menu on Click Outside or Escape
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        moreMenuRef.current && 
        !moreMenuRef.current.contains(target) && 
        !moreTriggerRef.current?.contains(target)
      ) {
        setMoreMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMoreMenuOpen(false);
        moreTriggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen]);

  // Close Folder Dropdown Menu on Click Outside or Escape
  useEffect(() => {
    if (!folderMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        folderMenuRef.current && 
        !folderMenuRef.current.contains(target) && 
        !folderTriggerRef.current?.contains(target)
      ) {
        setFolderMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setFolderMenuOpen(false);
        folderTriggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [folderMenuOpen]);

  const effectiveUrl = sourceUrl || profile.id || '';

  const handleCopyLink = async () => {
    if (!effectiveUrl) return;
    try {
      await navigator.clipboard.writeText(effectiveUrl);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setMoreMenuOpen(false);
      }, 900);
    } catch {
      setMoreMenuOpen(false);
    }
  };

  return (
    <div className="relative rounded-2xl md:rounded-3xl bg-[#12111B] border border-white/10 shadow-2xl mb-6">
      {/* Cover Banner with Vignette Gradient & Floating Top-Right Actions */}
      <div className="relative h-48 sm:h-56 md:h-64 w-full bg-slate-950 rounded-t-2xl md:rounded-t-3xl">
        <div className="absolute inset-0 overflow-hidden rounded-t-2xl md:rounded-t-3xl">
          <img
            src={profile.coverUrl || undefined}
            alt={profile.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center filter brightness-90"
            loading="eager"
            fetchPriority="high"
          />
          {/* Soft vignette gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#12111B] via-[#12111B]/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#12111B]/50 via-transparent to-[#12111B]/50" />
        </div>

        {/* Top-Right Banner Action Buttons */}
        <div className="absolute top-4 right-4 sm:top-5 sm:right-6 flex items-center gap-2 z-20">
          {showFavoriteBtn && (
            <button
              type="button"
              onClick={handleToggleFav}
              title={favoriteActive ? (copy.unfavoriteProfile || 'Remover dos Favoritos') : (copy.favoriteProfile || 'Favoritar Perfil')}
              aria-label={favoriteActive ? (copy.unfavoriteProfile || 'Remover dos Favoritos') : (copy.favoriteProfile || 'Favoritar Perfil')}
              aria-pressed={favoriteActive}
              className={`px-3.5 py-2 rounded-xl backdrop-blur-md font-semibold text-xs sm:text-sm flex items-center gap-1.5 transition-all shadow-lg active:scale-95 border ${
                favoriteActive
                  ? 'bg-pink-600/30 hover:bg-pink-600/40 text-pink-200 border-pink-400/50 shadow-pink-500/25 ring-1 ring-pink-400/30'
                  : 'bg-black/60 hover:bg-black/80 text-white border-white/20'
              }`}
            >
              <Heart
                size={14}
                className={favoriteActive ? "fill-pink-400 text-pink-400 animate-in zoom-in-75 duration-150" : "text-white"}
              />
              <span>{favoriteActive ? (copy.favoriteProfileActive || 'Favoritado') : (copy.favoriteProfileCta || 'Favoritar')}</span>
            </button>
          )}

          {/* More Actions Menu Button & Dropdown Popover */}
          <div className="relative">
            <button
              ref={moreTriggerRef}
              type="button"
              title={copy.ui73}
              aria-label={copy.profileActions || copy.ui73}
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              onClick={() => setMoreMenuOpen(prev => !prev)}
              className={`p-2 sm:p-2.5 rounded-xl backdrop-blur-md border text-white transition-all active:scale-95 shadow-lg ${
                moreMenuOpen
                  ? 'bg-purple-600/90 border-purple-400/60 shadow-purple-500/25 ring-2 ring-purple-500/30'
                  : 'bg-black/60 hover:bg-black/80 border-white/20'
              }`}
            >
              <MoreHorizontal size={18} />
            </button>

            {moreMenuOpen && (
              <div
                ref={moreMenuRef}
                role="menu"
                aria-label={copy.profileActions || copy.ui73}
                className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl bg-[#161524]/95 border border-white/15 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-white/10 mb-1">
                  <span>{copy.profileActions || copy.ui73}</span>
                  {demoMode && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-300 font-semibold">
                      Demo
                    </span>
                  )}
                </div>

                {/* Section 1: Web & Links */}
                <div className="space-y-0.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleCopyLink}
                    disabled={!effectiveUrl}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 flex items-center gap-2.5 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className={`p-1.5 rounded-lg transition-colors ${
                      copied 
                        ? 'bg-emerald-500/20 text-emerald-400' 
                        : 'bg-white/5 text-slate-300 group-hover:text-purple-300 group-hover:bg-purple-500/20'
                    }`}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </div>
                    <span className="flex-1 truncate">
                      {copied ? (copy.linkCopied || 'Copiado!') : (copy.copyLink || 'Copiar link')}
                    </span>
                  </button>

                  {effectiveUrl && effectiveUrl.startsWith('http') && (
                    <a
                      href={effectiveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      role="menuitem"
                      onClick={() => setMoreMenuOpen(false)}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 flex items-center gap-2.5 transition-colors group"
                    >
                      <div className="p-1.5 rounded-lg bg-white/5 text-slate-300 group-hover:text-blue-300 group-hover:bg-blue-500/20 transition-colors">
                        <ExternalLink size={14} />
                      </div>
                      <span className="flex-1 truncate">{copy.openInBrowser || 'Abrir perfil na web'}</span>
                      <span className="text-[10px] text-slate-500 opacity-80">↗</span>
                    </a>
                  )}

                  {showFavoriteBtn && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        handleToggleFav();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 flex items-center gap-2.5 transition-colors group"
                    >
                      <div className={`p-1.5 rounded-lg transition-colors ${
                        favoriteActive 
                          ? 'bg-pink-500/20 text-pink-400' 
                          : 'bg-white/5 text-slate-300 group-hover:text-pink-300 group-hover:bg-pink-500/20'
                      }`}>
                        <Heart size={14} className={favoriteActive ? "fill-pink-400" : ""} />
                      </div>
                      <span className="flex-1 truncate">
                        {favoriteActive ? (copy.unfavoriteProfile || 'Remover dos Favoritos') : (copy.favoriteProfile || 'Favoritar Perfil')}
                      </span>
                    </button>
                  )}

                  {onRefresh && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        onRefresh();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 flex items-center gap-2.5 transition-colors group"
                    >
                      <div className="p-1.5 rounded-lg bg-white/5 text-slate-300 group-hover:text-amber-300 group-hover:bg-amber-500/20 transition-colors">
                        <RotateCw size={14} />
                      </div>
                      <span className="flex-1 truncate">{copy.refreshCatalog || 'Refresh catalog'}</span>
                    </button>
                  )}
                </div>

                {/* Section 2: Catalog Selection Commands */}
                {(onSelectAllMedia || onClearSelection) && (
                  <>
                    <div className="my-1 border-t border-white/10" role="separator" />
                    <div className="space-y-0.5">
                      {onSelectAllMedia && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreMenuOpen(false);
                            onSelectAllMedia();
                          }}
                          className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 flex items-center gap-2.5 transition-colors group"
                        >
                          <div className="p-1.5 rounded-lg bg-white/5 text-slate-300 group-hover:text-purple-300 group-hover:bg-purple-500/20 transition-colors">
                            <CheckSquare size={14} />
                          </div>
                          <span className="flex-1 truncate">{copy.selectAllMedia || 'Select all catalog media'}</span>
                        </button>
                      )}

                      {onClearSelection && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!hasSelection}
                          onClick={() => {
                            setMoreMenuOpen(false);
                            onClearSelection();
                          }}
                          className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors group ${
                            hasSelection
                              ? 'text-slate-200 hover:text-white hover:bg-white/10'
                              : 'text-slate-500 opacity-40 cursor-not-allowed'
                          }`}
                        >
                          <div className="p-1.5 rounded-lg bg-white/5 text-slate-400 transition-colors">
                            <Square size={14} />
                          </div>
                          <span className="flex-1 truncate">{copy.clearSelection || 'Clear profile selection'}</span>
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Section 3: Restore Demo Profile */}
                {onRestoreDemo && (
                  <>
                    <div className="my-1 border-t border-white/10" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        onRestoreDemo();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 flex items-center gap-2.5 transition-colors group"
                    >
                      <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 group-hover:bg-rose-500/20 transition-colors">
                        <RotateCcw size={14} />
                      </div>
                      <span className="flex-1 truncate">{copy.restoreDemo || 'Restore demo profile'}</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Profile Details Container */}
      <div className="relative px-4 sm:px-6 md:px-8 pb-5 pt-0">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 -mt-14 sm:-mt-16 md:-mt-20">
          {/* Avatar and Identity */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 md:gap-5 min-w-0 flex-1">
            {/* Circular Avatar with Purple Glowing Ring */}
            <div className="relative shrink-0">
              <div className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-full overflow-hidden p-1 bg-gradient-to-tr from-purple-600 via-pink-500 to-amber-400 shadow-[0_0_30px_rgba(168,85,247,0.4)]">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full rounded-full object-cover bg-slate-950"
                    loading="eager"
                    fetchPriority="high"
                  />
                ) : (
                  <div
                    aria-label={profile.name}
                    className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center text-3xl sm:text-4xl font-extrabold text-white select-none"
                  >
                    {(profile.name || '?').trim().slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Title, Tagline and Stat Counters */}
            <div className="min-w-0 space-y-1 sm:pb-1 flex-1">
              {/* Name & Purple Verified Badge */}
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                  {profile.name}
                </h1>
                {profile.verified && (
                  <span 
                    title={copy.verified}
                    className="inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#7C3AED] text-white shadow-md shadow-purple-600/40"
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </div>

              {/* Tagline / Bio */}
              <p className="text-xs sm:text-sm text-slate-300 font-medium max-w-xl">
                {formatProfileBioValue(profile.tagline)}
              </p>

              {/* Bio Details Badges & Social Links */}
              {(bioDetails.length > 0 || socialLinks.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5 max-w-3xl">
                  {bioDetails.map(([key, val]) => {
                    const isRanking = key === 'Ranking';
                    return (
                      <span 
                        key={key}
                        className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-medium transition-all ${
                          isRanking 
                            ? 'bg-purple-950/60 border-purple-500/30 text-purple-200 shadow-sm'
                            : 'bg-white/5 border-white/10 text-slate-300'
                        }`}
                      >
                        <strong className={isRanking ? "text-purple-300 font-bold" : "text-purple-400 font-semibold"}>
                          {sourceLabel(key)}:
                        </strong>{' '}
                        {val}
                      </span>
                    );
                  })}
                  {socialLinks.map(([platform, link]) => (
                    <a
                      key={platform}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-0.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 text-[11px] text-blue-300 font-semibold flex items-center gap-1 transition-colors"
                    >
                      <span>{platform}</span>
                      <span className="text-[9px] opacity-70">↗</span>
                    </a>
                  ))}
                </div>
              )}

              {/* Stats Bar */}
              <div className="flex items-center gap-4 sm:gap-6 pt-1.5 text-xs sm:text-sm text-slate-300">
                <div className="flex items-center gap-1.5 font-medium">
                  <Film size={14} className="text-purple-400" />
                  <span className="font-bold text-white">{profile.stats.videos ?? '—'}</span>
                  <span className="text-slate-400">{copy.ui59}</span>
                </div>
                <div className="flex items-center gap-1.5 font-medium">
                  <ListMusic size={14} className="text-purple-400" />
                  <span className="font-bold text-white">{profile.stats.playlists ?? '—'}</span>
                  <span className="text-slate-400">{copy.playlists}</span>
                </div>
                <div className="flex items-center gap-1.5 font-medium">
                  <Images size={14} className="text-purple-400" />
                  <span className="font-bold text-white">{profile.stats.albums ?? '—'}</span>
                  <span className="text-slate-400">{copy.ui60}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Destination Folder Selector (Positioned on the Right of Stats, matching 01_Canonico) */}
          <div className="relative shrink-0 pb-1">
            <button
              ref={folderTriggerRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={folderMenuOpen}
              aria-label={`${copy.ui41}: ${profile.destinationFolder}`}
              onClick={() => setFolderMenuOpen(!folderMenuOpen)}
              className={`text-left px-3.5 py-2.5 rounded-xl bg-[#181624]/90 hover:bg-[#221F33] border text-slate-200 transition-all flex items-center gap-2.5 min-w-[210px] sm:min-w-[230px] shadow-sm ${
                folderMenuOpen ? 'border-purple-500/50 ring-2 ring-purple-500/20' : 'border-white/10'
              }`}
            >
              <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
                <Folder size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  {copy.ui41}
                </span>
                <span className="block text-xs sm:text-sm font-medium text-white truncate">
                  {profile.destinationFolder}
                </span>
              </div>
              <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform duration-200 ${folderMenuOpen ? 'rotate-180 text-purple-300' : ''}`} />
            </button>

            {/* Folder Dropdown Menu with Click-Outside and Escape Light-Dismiss */}
            {folderMenuOpen && (
              <div 
                ref={folderMenuRef}
                role="listbox"
                aria-label={copy.ui41}
                className="absolute right-0 bottom-full mb-2 z-30 w-full min-w-[240px] max-h-64 overflow-y-auto no-scrollbar rounded-xl bg-[#191827] border border-white/15 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
              >
                <p className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-white/10 mb-1">
                  {copy.ui42}
                </p>
                <div className="space-y-0.5">
                  {profile.availableFolders.map(folder => (
                    <button
                      key={folder}
                      type="button"
                      role="option"
                      aria-selected={profile.destinationFolder === folder}
                      onClick={() => {
                        if (onDestinationFolderChange) onDestinationFolderChange(folder);
                        setFolderMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                        profile.destinationFolder === folder
                          ? 'bg-purple-600/20 text-purple-300 font-semibold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className="truncate">{folder}</span>
                      {profile.destinationFolder === folder && (
                        <Check size={14} className="text-purple-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
