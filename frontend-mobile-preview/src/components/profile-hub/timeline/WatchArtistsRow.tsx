import React, { useEffect, useId, useMemo, useState } from 'react';
import { BadgeCheck, Check, ChevronRight, Users } from 'lucide-react';
import { WatchVideoArtist } from '../../../services/profileHubWatchApi';
import { profileShortcutIdentity } from '../../../store/useProfileDirectoryLibraryStore';
import { SourceAvatar } from '../common/SourceAvatar';

const ARTISTS_COLLAPSE_THRESHOLD = 6;

export interface WatchArtistsRowProps {
  artists: WatchVideoArtist[];
  sourceUrl: string | null;
  creatorIdentity?: string | null;
  followedProfileIdentities?: ReadonlySet<string> | string[];
  onOpenArtist: (artist: WatchVideoArtist) => void;
  isEn: boolean;
  disableMotion?: boolean;
}

export function filterVisibleWatchArtists(
  artists: WatchVideoArtist[],
  creatorIdentity?: string | null
): WatchVideoArtist[] {
  const seen = new Set<string>();
  const result: WatchVideoArtist[] = [];
  for (const artist of artists) {
    const identity = profileShortcutIdentity(artist.url) || artist.url;
    if (creatorIdentity && identity === creatorIdentity) continue;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(artist);
  }
  return result;
}

export const WatchArtistsRow: React.FC<WatchArtistsRowProps> = ({
  artists,
  sourceUrl,
  creatorIdentity = null,
  followedProfileIdentities,
  onOpenArtist,
  isEn,
  disableMotion = false,
}) => {
  const labelId = useId();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [sourceUrl]);

  const visibleArtists = useMemo(
    () => filterVisibleWatchArtists(artists, creatorIdentity),
    [artists, creatorIdentity]
  );

  const followedSet = useMemo(() => {
    if (!followedProfileIdentities) return new Set<string>();
    return followedProfileIdentities instanceof Set
      ? followedProfileIdentities
      : new Set(followedProfileIdentities);
  }, [followedProfileIdentities]);

  if (visibleArtists.length === 0) return null;

  const hasOverflow = visibleArtists.length > ARTISTS_COLLAPSE_THRESHOLD;
  const shownArtists =
    hasOverflow && !expanded ? visibleArtists.slice(0, ARTISTS_COLLAPSE_THRESHOLD) : visibleArtists;
  const hiddenCount = visibleArtists.length - shownArtists.length;

  return (
    <div
      data-watch-artists
      className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-2.5 gap-y-1 min-w-0"
    >
      <span
        id={labelId}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--tl-text-muted)] mr-0.5 shrink-0"
      >
        <Users className="w-3.5 h-3.5 text-[var(--tl-accent-text)]" aria-hidden="true" />
        <span>{isEn ? 'Featuring' : 'Participações'}</span>
      </span>

      <ul
        role="list"
        aria-labelledby={labelId}
        className="watch-swipe-row flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible list-none m-0 py-1 px-0.5 min-w-0 flex-1"
      >
        {shownArtists.map((artist, index) => {
          const identity = profileShortcutIdentity(artist.url) || artist.url;
          const isFollowing = followedSet.has(identity);

          return (
            <li
              key={identity}
              style={{ '--stagger-index': index } as React.CSSProperties}
              className={`shrink-0 max-w-full list-none ${disableMotion ? '' : 'watch-artist-chip-enter'}`}
            >
              <button
                type="button"
                data-watch-artist-chip
                data-watch-artist-url={artist.url}
                onClick={() => onOpenArtist(artist)}
                className={`inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 min-h-[36px] max-w-full rounded-full border text-xs font-semibold ${disableMotion ? 'transition-colors' : 'cute-press'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tl-accent-hover)] group ${
                  isFollowing
                    ? 'bg-[var(--tl-accent-soft)] border-[var(--tl-accent-border)] text-[var(--tl-accent-text-strong)] hover:bg-[var(--tl-accent-soft-hover)] hover:border-[var(--tl-accent)] active:bg-[var(--tl-accent-soft-hover)]'
                    : 'bg-[var(--tl-surface)] border-[var(--tl-border)] text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] hover:border-[var(--tl-accent-border)] active:bg-[var(--tl-surface-elevated)]'
                }`}
              >
                <SourceAvatar
                  name={artist.name}
                  src={artist.avatar_url}
                  profileUrl={artist.url}
                  referer={sourceUrl || artist.url}
                  hydrate
                  disableMotion={disableMotion}
                  className={`w-6 h-6 rounded-full object-cover shrink-0 bg-[var(--tl-surface-elevated)] ring-1 ring-[var(--tl-border)] group-hover:ring-[var(--tl-accent-hover)] ${disableMotion ? '' : 'transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6'}`}
                />
                <span className="truncate max-w-[11.5rem] sm:max-w-[14rem]">{artist.name}</span>
                {artist.verified && (
                  <>
                    <BadgeCheck className="w-3.5 h-3.5 text-[var(--tl-accent-text)] shrink-0" aria-hidden="true" />
                    <span className="sr-only">{isEn ? ', Verified' : ', Verificado'}</span>
                  </>
                )}
                {isFollowing ? (
                  <>
                    <Check className={`w-3 h-3 text-[var(--tl-accent-text)] shrink-0 ${disableMotion ? '' : 'transition-transform group-hover:scale-110'}`} aria-hidden="true" />
                    <span className="sr-only">{isEn ? ', Following' : ', Seguindo'}</span>
                  </>
                ) : (
                  <ChevronRight
                    className={`w-3 h-3 text-[var(--tl-text-muted)] group-hover:text-[var(--tl-accent-text)] ${disableMotion ? '' : 'group-hover:translate-x-0.5 transition-all'} shrink-0`}
                    aria-hidden="true"
                  />
                )}
                <span className="sr-only">{isEn ? ' — Open profile' : ' — Abrir perfil'}</span>
              </button>
            </li>
          );
        })}

        {hasOverflow && (
          <li
            style={{ '--stagger-index': shownArtists.length } as React.CSSProperties}
            className={`shrink-0 list-none ${disableMotion ? '' : 'watch-artist-chip-enter'}`}
          >
            <button
              type="button"
              data-watch-artists-toggle
              aria-expanded={expanded}
              onClick={() => setExpanded((previous) => !previous)}
              className={`inline-flex items-center gap-1 px-3 py-1 min-h-[36px] rounded-full text-xs font-semibold bg-[var(--tl-surface)] border border-[var(--tl-border)] text-[var(--tl-accent-text)] hover:bg-[var(--tl-surface-hover)] hover:text-[var(--tl-text-primary)] hover:border-[var(--tl-accent-border)] active:bg-[var(--tl-surface-elevated)] ${disableMotion ? 'transition-colors' : 'cute-press'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tl-accent-hover)]`}
            >
              <span>{expanded ? (isEn ? 'Show less' : 'Ver menos') : `+${hiddenCount} ${isEn ? 'more' : 'mais'}`}</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
};
