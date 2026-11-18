import { SavedDirectories } from './SavedDirectories';
import { ProfileFavoriteButton } from './ProfileFavoriteButton';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Clock3, Compass, Copy, Grid2X2, Heart, Home, Image, List, Loader2, RefreshCw, Search, SlidersHorizontal, Smartphone, Sparkles, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useProfileDirectoryStore } from '../../store/useProfileDirectoryStore';
import { useResolvedAvatar } from '../../store/useProfileAvatarStore';
import { useProfileHubStore } from '../../store/useProfileHubStore';
import { shortcutKey, useProfileDirectoryLibraryStore, type ProfileShortcut } from '../../store/useProfileDirectoryLibraryStore';
import { discoverProfileDirectory, fetchBatchProfileMeta, type DirectoryProfile } from '../../services/profileDirectoryApi';
import { handleProxiedImageError } from '../../services/profileHubImageFallback';
import { directoryFilterUrl, projectDirectory } from '../../services/profileDirectoryModel';
import { profileDirectoryCopy } from '../../services/profileDirectoryCopy';
import { hubNavigation } from '../../services/profileHubRuntime';
import { DirectoryActionsMenu, DirectoryShortcutsDialog } from './DirectoryControls';
import './profile-directory.css';

function ProfileCover({ item }: { item: DirectoryProfile }) {
  const [failed, setFailed] = useState(false);
  const resolved = useResolvedAvatar(item.source_url, item.image_url, {
    hydrate: !item.image_url && Boolean(item.source_url),
  });
  const src = resolved.src;

  useEffect(() => {
    setFailed(false);
  }, [src, item.source_url]);

  return <div className="pd-cover">
    {src && !failed ? <img key={src} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => {
      const attemptKey = `${src}|${item.source_url || ''}`;
      if (e.currentTarget.dataset.proxiedFor === attemptKey) {
        setFailed(true);
      } else {
        handleProxiedImageError(e, { rawUrl: src, referer: item.source_url || src });
      }
    }} />
      : <span className="pd-cover-fallback" aria-hidden="true">{item.name?.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase() || <Compass size={40} />}</span>}
    <span className="pd-card-dot" aria-hidden="true" />
  </div>;
}

export function ProfileDirectoryPanel({ queryKey, entryForm, tabsBar, onOpenUrl, onOpenShortcut, onDirectoryNavigation, active }: {
  queryKey: string; entryForm: React.ReactNode; tabsBar?: React.ReactNode; onOpenUrl: (url: string) => void; onOpenShortcut: (item: ProfileShortcut) => void; onDirectoryNavigation: () => void; active: boolean;
}) {
  const language = useAppStore(state => state.settings.language);
  const copy = profileDirectoryCopy[language];
  const session = useProfileDirectoryStore(state => state.directories[queryKey]);
  const favorites = useProfileDirectoryLibraryStore(state => state.favorites);
  const storageAvailable = useProfileDirectoryLibraryStore(state => state.storageAvailable);
  const page = session.pages[session.pageUrl];
  const [localLetter, setLocalLetter] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'history' | 'favorites' | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const activeDraftGender = draft['gender']?.[0] ?? null;
  const projection = useMemo(() => projectDirectory(session, language, localLetter, activeDraftGender), [session, language, localLetter, activeDraftGender]);
  const [category, setCategory] = useState('');
  const [filterError, setFilterError] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastRequest = useRef<{ url: string; append: boolean; force: boolean; resetLocal: boolean }>();
  const generation = useRef(0);
  const format = (n: number) => new Intl.NumberFormat(language).format(n);
  const patch = (value: Parameters<ReturnType<typeof useProfileDirectoryStore.getState>['updateContext']>[1]) => useProfileDirectoryStore.getState().updateContext(queryKey, value);

  const handleGenderChange = (val: string) => {
    const nextDraft = { ...draft, gender: val ? [val] : [] };
    setDraft(nextDraft);
    try {
      const url = directoryFilterUrl(page, nextDraft, category || undefined);
      setFilterError('');
      void load(url, false, true);
    } catch {
      setFilterError(copy.invalidFilter);
    }
  };
  useEffect(() => { setBusy(false); return () => { ++generation.current; controller.current?.abort(); }; }, [queryKey, page.page_url]);
  useEffect(() => {
    if (!active) { ++generation.current; controller.current?.abort(); setBusy(false); setDialog(null); }
  }, [active]);
  useEffect(() => {
    const params = new URL(page.page_url).searchParams;
    setDraft(Object.fromEntries(page.capabilities.remote_filters.map(field => [field.name, params.getAll(field.name)])));
    setCategory(''); setFilterError(''); setLocalLetter(null);
  }, [page.page_url]);
  useEffect(() => {
    const missing = projection.items.filter(item => !item.image_url).map(item => item.source_url);
    if (!missing.length) return;
    const abort = new AbortController();
    fetchBatchProfileMeta(missing.slice(0, 50), abort.signal).then(metaByUrl => {
      if (Object.keys(metaByUrl).length > 0) {
        useProfileDirectoryStore.getState().updateProfilesMeta(queryKey, metaByUrl);
      }
    }).catch(() => {});
    return () => abort.abort();
  }, [queryKey, projection.displayPage, page.page_url]);
  useEffect(() => {
    const key = session.focusedProfileKey;
    if (key) requestAnimationFrame(() => document.getElementById(`pd-profile-${key}`)?.focus({ preventScroll: true }));
  }, [queryKey]);
  const notify = (message: string, type: 'info' | 'error' = 'info') => useAppStore.getState().addNotification({ title: copy.title, message, type });
  const copyUrl = async (url: string) => { try { await navigator.clipboard.writeText(url); notify(copy.copied); } catch { notify(copy.copyFailed, 'error'); } };
  const load = async (url: string, append = false, force = false, resetLocal = false) => {
    onDirectoryNavigation();
    controller.current?.abort();
    const nextController = new AbortController(); controller.current = nextController;
    const requestId = ++generation.current;
    lastRequest.current = { url, append, force, resetLocal };
    setError(false); setBusy(true);
    try {
      const cached = Object.values(useProfileDirectoryStore.getState().directories).find(value => value.pages[url])?.pages[url];
      const result = cached && !force ? cached : await discoverProfileDirectory(url, nextController.signal);
      if (nextController.signal.aborted || generation.current !== requestId || useAppStore.getState().currentView !== 'profile-hub') return;
      const previous = useProfileDirectoryStore.getState().directories[queryKey];
      hubNavigation.checkpoint();
      useProfileDirectoryStore.getState().commitPage(result);
      const sort = ['source', 'name', 'name_desc'].includes(previous.sort) || result.capabilities.local_sort_fields.includes(previous.sort) ? previous.sort : 'source';
      useProfileDirectoryStore.getState().updateContext(result.query_key, {
        ...(result.query_key !== queryKey || resetLocal ? { search: resetLocal ? '' : previous.search, sort: resetLocal ? 'source' : sort, view: previous.view, displayPage: 1, focusedProfileKey: null } : {}),
        appendMode: append,
      });
      hubNavigation.navigate({ mode: 'directory', queryKey: result.query_key, pageUrl: result.page_url }, false, false);
    } catch {
      if (!nextController.signal.aborted && requestId === generation.current) setError(true);
    } finally { if (!nextController.signal.aborted && requestId === generation.current) setBusy(false); }
  };
  const cancel = () => { ++generation.current; controller.current?.abort(); setBusy(false); };
  const clearFilters = () => { setLocalLetter(null); setAdvanced(false); void load(page.source_url, false, false, true); };
  const activeFilters = [...new URL(page.page_url).searchParams.entries()].filter(([key, value]) => value !== '' && page.capabilities.remote_filters.some(field => field.name === key)).length + (page.capabilities.active_category ? 1 : 0);
  const localPages = Array.from({ length: projection.pageCount }, (_, index) => index + 1).filter(number => number === 1 || number === projection.pageCount || Math.abs(number - projection.displayPage) <= 1);
  const remotePages = [...new Map([{ page: page.pagination.current_page, url: page.page_url }, ...page.pagination.links,
    ...Object.values(session.pages).map(value => ({ page: value.pagination.current_page, url: value.page_url }))].map(value => [value.page, value])).values()]
    .sort((a, b) => a.page - b.page).filter(value => value.page === 1 || Math.abs(value.page - page.pagination.current_page) <= 3 || value.page === Math.max(...page.pagination.links.map(link => link.page), page.pagination.current_page));
  const pageButton = (direction: -1 | 1) => {
    if (projection.local) patch({ displayPage: projection.displayPage + direction });
    else { const target = direction === -1 ? page.pagination.previous_url : page.pagination.next_url; if (target) void load(target, false); }
  };
  return <section className="profile-directory" aria-labelledby="pd-heading">
    <header className="pd-topbar"><nav aria-label={copy.navigation} className="pd-breadcrumb">
      {hubNavigation.canGoBack() && <button type="button" className="pd-icon-button" onClick={() => hubNavigation.back()} aria-label={copy.back}><ArrowLeft size={15} /></button>}
      <button type="button" className="pd-icon-button" onClick={() => useAppStore.getState().navigateToView('home')} aria-label={language === 'pt-BR' ? 'Início' : 'Home'}><Home size={15} /></button>
      <button type="button" className="pd-breadcrumb-root" onClick={() => { const hub = useProfileHubStore.getState(); if (hub.activeProfileKey) hubNavigation.navigate({ mode: 'profile', profileKey: hub.activeProfileKey, panel: hub.profiles[hub.activeProfileKey].activeSidePanel }); }}>Profile Hub</button><span className="pd-slash">/</span><strong aria-current="page">{copy.title}</strong>
    </nav><div className="pd-top-actions"><SavedDirectories onOpenUrl={onOpenUrl} currentUrl={page.capabilities.query_url || page.source_url} active={active} /><button type="button" className="pd-button" onClick={() => setDialog('history')}><Clock3 size={14} />{copy.history}</button>
      <button type="button" className="pd-button pd-favorites-button" onClick={() => setDialog('favorites')}><Heart size={15} />{copy.favorites}</button>
      <button type="button" className="pd-button" onClick={() => useAppStore.getState().navigateToView('timeline-preview')} title={copy.timelinePreview} aria-label={copy.timelinePreview}><Smartphone size={14} />{copy.timeline}</button>
      <DirectoryActionsMenu label={copy.more}><button type="button" onClick={() => void copyUrl(page.page_url)}><Copy size={15} />{copy.copyUrl}</button><a href={page.page_url} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15} />{copy.openSource}</a><button type="button" onClick={() => void load(page.page_url, session.appendMode, true)}><RefreshCw size={15} />{copy.refresh}</button><button type="button" onClick={clearFilters}><X size={15} />{copy.clearFilters}</button></DirectoryActionsMenu>
    </div></header>
    <div className="pd-hero"><div><p className="pd-eyebrow"><Sparkles size={13} />{copy.navigation}</p><h1 id="pd-heading">{copy.heading}</h1><p>{copy.intro}<br />{copy.intro2}</p></div><div className="pd-hero-emblem" aria-hidden="true"><Compass size={51} strokeWidth={1.7} /></div></div>
    <div className="pd-entry">{entryForm}</div>
    {tabsBar}
    {!storageAvailable && <p className="pd-warning" role="status">{copy.storageError}</p>}
    {error && <div className="pd-inline-error" role="alert"><span>{copy.error}</span><button type="button" className="pd-button" onClick={() => { const request = lastRequest.current; if (request) void load(request.url, request.append, request.force, request.resetLocal); }}>{copy.retry}</button></div>}
    {!page.page_complete && <p className="pd-warning" role="status">{copy.partial}</p>}
    <div className="pd-catalog-heading">
      <div>
        <h2>
          <Compass size={19} />
          <span>{copy.found}</span>
          <span className="pd-count">
            {page.pagination.reported_total && page.pagination.reported_total > 1
              ? `${format(page.pagination.reported_total)} ${copy.pages}`
              : `${format(projection.loaded)} ${copy.onPage}`}
          </span>
        </h2>
        <p>
          {new URL(page.source_url).hostname} · {format(projection.loaded)} {copy.onPage} · {copy.page} {format(page.pagination.current_page)}
          {page.pagination.reported_total && page.pagination.reported_total > 1 ? ` ${copy.ofPages.replace('{pages}', format(page.pagination.reported_total))}` : ''}
          {page.pagination.has_more ? ` · ${copy.moreAvailable}` : ''}
        </p>
      </div>
      <div className="pd-toolbar"><div className="pd-search"><Search size={15} /><input type="search" aria-label={copy.search} placeholder={copy.search} value={session.search} onChange={event => patch({ search: event.target.value, displayPage: 1 })} />{session.search && <button type="button" aria-label={copy.clearSearch} onClick={() => patch({ search: '', displayPage: 1 })}><X size={14} /></button>}</div>
        <select className="pd-select" aria-label={copy.sort} value={session.sort} onChange={event => patch({ sort: event.target.value, displayPage: 1 })}><option value="source">{page.capabilities.source_order === 'rank' ? copy.popular : copy.sourceOrder}</option><option value="name">{copy.name}</option><option value="name_desc">{copy.nameDesc}</option>{page.capabilities.local_sort_fields.includes('rank') && <option value="rank">{copy.rank}</option>}{page.capabilities.local_sort_fields.includes('video_count') && <option value="video_count">{copy.videosSort}</option>}{page.capabilities.local_sort_fields.includes('photo_count') && <option value="photo_count">{copy.photosSort}</option>}</select>
        <button type="button" className="pd-icon-button pd-filter-button" aria-label={copy.filters} aria-expanded={advanced} aria-controls="pd-advanced" onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={16} />{activeFilters > 0 && <span>{activeFilters}</span>}</button>
        <div className="pd-view-toggle"><button type="button" aria-label={copy.grid} aria-pressed={session.view === 'grid'} onClick={() => patch({ view: 'grid' })}><Grid2X2 size={17} /></button><button type="button" aria-label={copy.list} aria-pressed={session.view === 'list'} onClick={() => patch({ view: 'list' })}><List size={17} /></button></div>
      </div>
    </div>
    <div className="pd-alphabet-row"><div className="pd-alphabet" aria-label="A–Z"><button type="button" className={!page.capabilities.active_letter && !localLetter ? 'pd-active' : ''} aria-pressed={!page.capabilities.active_letter && !localLetter} disabled={!page.capabilities.all_url && !localLetter} onClick={() => { setLocalLetter(null); if (page.capabilities.all_url) void load(page.capabilities.all_url); }}>{copy.all}</button>{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => {
      const remoteUrl = page.capabilities.alphabet_links[letter];
      const isActive = page.capabilities.active_letter === letter || localLetter === letter;
      return <button key={letter} type="button" aria-pressed={isActive} className={isActive ? 'pd-active' : ''} onClick={() => {
        if (remoteUrl) {
          setLocalLetter(null);
          void load(remoteUrl);
        } else {
          setLocalLetter(current => current === letter ? null : letter);
          patch({ displayPage: 1 });
        }
      }}>{letter}</button>;
    })}</div><button type="button" className="pd-advanced-toggle" aria-expanded={advanced} aria-controls="pd-advanced" onClick={() => setAdvanced(!advanced)}>{copy.advanced}<ChevronRight size={13} /></button></div>
    {advanced && <form id="pd-advanced" className="pd-advanced" noValidate onSubmit={event => { event.preventDefault(); try { const url = directoryFilterUrl(page, draft, category || undefined); setFilterError(''); void load(url); } catch { setFilterError(copy.invalidFilter); } }}>
      {Object.keys(page.capabilities.category_links).length > 0 && <label>{copy.categories}<select value={category} onChange={event => setCategory(event.target.value)}><option value="">{page.capabilities.active_category === 'female' ? copy.female : page.capabilities.active_category === 'male' ? copy.male : copy.any}</option>{Object.entries(page.capabilities.category_links).map(([name, url]) => <option key={name} value={url}>{name === 'female' ? copy.female : name === 'male' ? copy.male : name}</option>)}</select></label>}
      {page.capabilities.remote_filters.map(field => <label key={field.name}>{copy.filterLabels[field.name] || field.name}{field.kind === 'choice'
        ? <select
            multiple={field.multiple}
            size={field.multiple ? 3 : undefined}
            value={field.multiple ? draft[field.name] ?? [] : draft[field.name]?.[0] ?? ''}
            onChange={event => {
              const selectedValues = Array.from(event.target.selectedOptions).map(option => option.value).filter(Boolean);
              if (field.name === 'gender') {
                handleGenderChange(selectedValues[0] || '');
              } else {
                setDraft(previous => ({ ...previous, [field.name]: selectedValues }));
              }
            }}
          >
            {!field.multiple && <option value="">{copy.any}</option>}
            {field.choices.filter(choice => choice.value !== '').map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        : <input type="number" min={field.minimum ?? undefined} max={field.maximum ?? undefined} value={draft[field.name]?.[0] ?? ''} onChange={event => setDraft(previous => ({ ...previous, [field.name]: [event.target.value] }))} />}</label>)}
      <div className="pd-filter-actions">{filterError && <p role="alert">{filterError}</p>}<button type="button" className="pd-button" onClick={clearFilters}>{copy.clearFilters}</button><button type="submit" className="pd-button pd-primary">{copy.apply}</button></div>
    </form>}
    <div className="pd-results-meta"><small>{copy.searchScope}</small>{busy && <span role="status"><Loader2 size={13} className="animate-spin" />{copy.loading}<button type="button" onClick={cancel}>{copy.cancel}</button></span>}</div>
    {!projection.items.length ? <div className="pd-empty"><Compass size={35} /><h3>{projection.local ? copy.noResults : copy.noProfiles}</h3><p>{projection.local ? copy.noResultsHint : copy.noProfilesHint}</p><button type="button" className="pd-button" onClick={projection.local ? () => { setLocalLetter(null); patch({ search: '', sort: 'source', displayPage: 1 }); } : clearFilters}>{copy.clearFilters}</button></div>
    : <div className={`pd-results ${session.view === 'list' ? 'pd-results-list' : ''}`} aria-busy={busy}>{projection.items.map(item => {
      const name = item.name || copy.unnamed;
      const isFavorite = favorites.some(value => value.key === shortcutKey('profile', item.source_url));
      const open = () => { patch({ focusedProfileKey: item.key }); onOpenUrl(item.source_url); };
      const toggleFavorite = () => { const success = useProfileDirectoryLibraryStore.getState().toggleFavorite({ kind: 'profile', url: item.source_url, name: item.name, imageUrl: item.image_url }); if (!success) notify(copy.favoriteLimit, 'error'); return success; };
      const counts = [[item.video_count, copy.videos], [item.photo_count, copy.photos], [item.album_count, copy.albums]].filter(([count]) => count != null).map(([count, noun]) => `${format(count as number)} ${noun}`);
      return <article className="pd-profile-card" key={item.key}><a id={`pd-profile-${item.key}`} className="pd-profile-open" href={item.source_url} aria-label={`${copy.openProfile}: ${name}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); open(); } }}>
        <ProfileCover item={item} /><div className="pd-profile-info"><div className="pd-profile-name"><h3>{name}</h3></div><p>{item.description || new URL(item.source_url).hostname}</p><small><Image size={12} />{counts.join(' · ') || copy.unknown}</small></div>
      </a><ProfileFavoriteButton pressed={isFavorite} label={`${isFavorite ? copy.unfavorite : copy.favorite}: ${name}`} onToggle={toggleFavorite} /><DirectoryActionsMenu label={`${copy.profileActions}: ${name}`} className="pd-card-menu"><button type="button" onClick={open}><ArrowUpRight size={15} />{copy.openProfile}</button><button type="button" onClick={toggleFavorite}><Heart size={15} fill={isFavorite ? 'currentColor' : 'none'} />{isFavorite ? copy.unfavorite : copy.favorite}</button><button type="button" onClick={() => void copyUrl(item.source_url)}><Copy size={15} />{copy.copyUrl}</button><a href={item.source_url} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15} />{copy.openSource}</a></DirectoryActionsMenu></article>;
    })}</div>}
    <footer className="pd-pagination"><p>{format(projection.items.length)} {copy.onPage} · {format(projection.loaded)} {copy.discovered}{projection.local && <span> · {copy.localPages}</span>}</p><div>
      {page.pagination.next_url && <button type="button" className="pd-load-more" disabled={busy} onClick={() => void load(page.pagination.next_url!, true)}>{copy.loadMore}</button>}
      <nav aria-label={copy.pageNavigation}><button type="button" className="pd-page-number" aria-label={copy.previous} disabled={busy || (projection.local ? projection.displayPage <= 1 : !page.pagination.previous_url)} onClick={() => pageButton(-1)}><ChevronLeft size={15} /></button>
        {projection.local ? localPages.map(number => <button key={number} type="button" className={`pd-page-number ${number === projection.displayPage ? 'pd-active' : ''}`} aria-current={number === projection.displayPage ? 'page' : undefined} onClick={() => patch({ displayPage: number })}>{format(number)}</button>)
          : remotePages.map(({ page: number, url }) => <button key={number} type="button" className={`pd-page-number ${number === page.pagination.current_page ? 'pd-active' : ''}`} aria-current={number === page.pagination.current_page ? 'page' : undefined} disabled={busy} onClick={() => void load(url, false)}>{format(number)}</button>)}
        <button type="button" className="pd-page-number" aria-label={copy.next} disabled={busy || (projection.local ? projection.displayPage >= projection.pageCount : !page.pagination.next_url)} onClick={() => pageButton(1)}><ChevronRight size={15} /></button>
      </nav></div></footer>
    {dialog && <DirectoryShortcutsDialog mode={dialog} copy={copy} language={language} onClose={() => setDialog(null)} onOpen={onOpenShortcut} />}
  </section>;
}
