import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ExternalLink, Film, Folder, Home, Image, Images, Layers, ListVideo, RotateCcw, UserRound, Video, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getGlobalProfileSelection, useProfileHubStore } from '../../store/useProfileHubStore';
import { getReviewGroups, reviewDestinationIssues, type ReviewEntry, type ReviewKind } from '../../services/profileHubReviewModel';
import { profileHubReviewCopy, reviewText, type ProfileHubReviewCopy } from '../../services/profileHubReviewCopy';
import { hubNavigation } from '../../services/profileHubRuntime';
import { FolderSelectModal } from '../common/FolderSelectModal';
import { ProfileHubSelectionBar } from './ProfileHubSelectionBar';
import { ProfileExecutionPanel } from './ProfileExecutionPanel';
import { profileHubExecutionCopy } from '../../services/profileHubExecutionCopy';
import { useProfileHubExecutionStore } from '../../store/useProfileHubExecutionStore';
import './profile-directory.css';
import './profile-review.css';

type ReviewGroup = ReturnType<typeof getReviewGroups>[number];
type ReviewRow = ReviewGroup['rows'][number];
const kindIcons = { video: Video, playlist: ListVideo, album: Images, photo: Image, gif: Film };

function ReviewImage({ src, className = '', fallback }: { src: string; className?: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <span className={className}>{src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : fallback}</span>;
}

function itemDetail(row: ReviewRow, copy: ProfileHubReviewCopy, number: (value: number) => string): string {
  if (row.kind === 'playlist') {
    const count = row.item.videoCount;
    return count == null || !Number.isFinite(count) || count < 0 ? copy.unknownVideos : reviewText(copy.videoCount, { count: number(count) });
  }
  if (row.kind === 'album') {
    const count = row.item.photoCount;
    return count == null || !Number.isFinite(count) || count < 0 ? copy.unknownPhotos : reviewText(copy.photoCount, { count: number(count) });
  }
  return [copy[row.kind], row.item.duration, row.item.resolution].filter(Boolean).join(' · ');
}

export function ProfileReviewPage({ active, onDownloadZip, zipAvailable, zipBusy = false, actionError = '', actionMessage = '' }: {
  active: boolean; onDownloadZip: () => void; zipAvailable: boolean; zipBusy?: boolean; actionError?: string; actionMessage?: string;
}) {
  const profiles = useProfileHubStore(state => state.profiles);
  const entries = useProfileHubStore(state => state.reviewEntries);
  const limits = useProfileHubStore(state => state.reviewDisplayLimits);
  const routeToken = useProfileHubStore(state => state.routeToken);
  const selectionClearVersion = useProfileHubStore(state => state.selectionClearVersion);
  const language = useAppStore(state => state.settings.language);
  const videoFolders = useAppStore(state => state.videoFolders);
  const albumFolders = useAppStore(state => state.albumFolders);
  const copy = profileHubReviewCopy[language];
  const executionCopy = profileHubExecutionCopy[language];
  const tracking = useProfileHubExecutionStore(state => Boolean(state.batch || state.draft || state.lastId));
  const profileName = (group: ReviewGroup) => group.session.profile.name?.trim() || copy.unnamed;
  const number = (value: number) => new Intl.NumberFormat(language).format(value);
  const groups = useMemo(() => getReviewGroups(profiles, entries), [profiles, entries]);
  const selection = useMemo(() => getGlobalProfileSelection(profiles, false), [profiles]);
  const [picker, setPicker] = useState<{ profileKey: string; domain: 'video' | 'gallery' } | null>(null);
  const [undo, setUndo] = useState<{ entry: ReviewEntry; selected: boolean; clearVersion: number } | null>(null);
  const [message, setMessage] = useState<'removed' | 'restored' | ''>('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setUndo(null); setMessage(''); }, [selectionClearVersion]);
  useEffect(() => { if (active) heading.current?.focus({ preventScroll: true }); else setPicker(null); }, [active, routeToken]);
  useEffect(() => {
    if (!active) return;
    const previous = document.title; document.title = `${copy.title} · IMAGEX`;
    return () => { document.title = previous; };
  }, [active, copy.title]);
  const back = () => {
    if (hubNavigation.canGoBack()) hubNavigation.back();
    else {
      const state = useProfileHubStore.getState();
      const key = state.activeProfileKey;
      if (key) hubNavigation.navigate({ mode: 'profile', profileKey: key, panel: state.profiles[key].activeSidePanel }, true);
    }
  };
  const remove = (row: ReviewRow, trigger: HTMLButtonElement) => {
    const next = trigger.closest('.phr-items')?.querySelector<HTMLInputElement>('input:not(:disabled)');
    const group = trigger.closest<HTMLElement>('.phr-profile');
    setUndo({ entry: row, selected: row.selected, clearVersion: selectionClearVersion }); setMessage('removed');
    useProfileHubStore.getState().removeReviewEntry(row.key);
    // The removed control is gone after commit; keep keyboard focus in the same profile.
    requestAnimationFrame(() => { if (next?.isConnected) next.focus({ preventScroll: true }); else group?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); });
  };

  const media = (group: ReviewGroup, video: boolean) => {
    const rows = video ? group.videos : group.gallery;
    const key = JSON.stringify([group.profileKey, video ? 'video' : 'gallery']);
    const limit = limits[key] ?? 12;
    const independent = rows.filter(row => row.coveredBy === null);
    return <section className="phr-media"><h3 className="phr-section-title">{video ? <Video size={16} /> : <Images size={16} />}{video ? copy.videos : copy.gallery}
      <small>{reviewText(copy.marked, { selected: number(independent.filter(row => row.selected).length), total: number(independent.length) })}</small></h3>
      <div className="phr-items">{rows.slice(0, limit).map(row => {
        const Icon = kindIcons[row.kind];
        const covered = row.coveredBy !== null;
        return <article key={row.key} className={`phr-item ${row.selected || covered ? '' : 'phr-unchecked'}`}>
          <label><input type="checkbox" checked={row.selected || covered} disabled={covered} aria-label={reviewText(copy.selectItem, { item: row.item.title || copy.untitled, profile: profileName(group) })}
            onChange={event => useProfileHubStore.getState().selectReviewEntry(row.key, event.target.checked)} />
            <ReviewImage className="phr-art" src={row.item.thumbnailUrl} fallback={<Icon size={26} aria-hidden="true" />} />
            <strong>{row.item.title || copy.untitled}</strong><small>{itemDetail(row, copy, number)}</small></label>
          {covered && <small className="phr-included">{reviewText(copy.included, { collection: row.coveredBy! })}</small>}
          <button type="button" className="phr-remove" disabled={covered} aria-label={reviewText(copy.removeItem, { item: row.item.title || copy.untitled })} onClick={event => remove(row, event.currentTarget)}><X size={13} /></button>
        </article>;
      })}</div>
      {!rows.length && <p className="phr-muted">{copy.noItems}</p>}
      {rows.length > limit && <button type="button" className="pd-button phr-more" onClick={() => useProfileHubStore.getState().showMoreReviewItems(key)}>{copy.showMore} · {number(Math.min(limit, rows.length))}/{number(rows.length)}</button>}
    </section>;
  };
  const target = (group: ReviewGroup, domain: 'video' | 'gallery') => {
    const video = domain === 'video';
    const config = group.session.destinations;
    const issues = reviewDestinationIssues(group.session, group.selected.map(row => row.kind));
    const missing = video ? issues.videoFolder : issues.galleryFolder;
    const index = groups.indexOf(group);
    const fieldId = `phr-target-${index}-${domain}`;
    const folder = video ? config.videoFolder : config.galleryFolder;
    const selectFolder = () => setPicker({ profileKey: group.profileKey, domain });
    return <section className="phr-target"><h3>{video ? <Video size={16} /> : <Images size={16} />}{video ? copy.videoTarget : copy.galleryTarget}</h3>
      <p className="phr-muted">{video ? copy.videoHint : copy.galleryHint}</p>
      <button id={fieldId} type="button" className={`phr-path ${missing ? 'phr-invalid' : ''}`} aria-label={`${video ? copy.videoTarget : copy.galleryTarget}: ${profileName(group)}. ${folder || copy.chooseFolder}`}
        aria-invalid={missing}
        aria-describedby={missing ? `${fieldId}-error` : undefined} onClick={selectFolder}><Folder size={15} /><span>{folder || copy.chooseFolder}</span><ChevronDown size={14} /></button>
      <button type="button" className="pd-button" onClick={selectFolder}><Folder size={14} />{copy.changeFolder}</button>
      {missing && <p id={`${fieldId}-error`} className="phr-error">{folder?.trim() ? executionCopy.invalidFolder : copy.folderRequired}</p>}
      {video ? <><label className="phr-field-label" htmlFor={`${fieldId}-mode`}>{copy.mode}</label><select id={`${fieldId}-mode`} className="phr-select" value={config.videoMode ?? ''}
        aria-invalid={issues.videoMode} aria-describedby={issues.videoMode ? `${fieldId}-mode-error` : `${fieldId}-mode-hint`}
        onChange={event => { const videoMode = event.target.value; if (videoMode === '' || videoMode === 'web_stream' || videoMode === 'download') useProfileHubStore.getState().updateField(group.profileKey, 'destinations', current => ({ ...current, videoMode: videoMode || null })); }}>
        <option value="">{copy.chooseMode}</option><option value="web_stream">{copy.stream}</option><option value="download">{copy.download}</option></select>
        {issues.videoMode ? <p id={`${fieldId}-mode-error`} className="phr-error">{copy.modeRequired}</p> : <p id={`${fieldId}-mode-hint`} className="phr-mode-help">{config.videoMode === 'web_stream' ? copy.streamHint : config.videoMode === 'download' ? copy.downloadHint : copy.chooseMode}</p>}</>
        : <p className="phr-mode-help">{copy.galleryMode}</p>}
    </section>;
  };
  const selectedRows = groups.flatMap(group => group.selected);
  const counts = (kinds: ReviewKind[]) => selectedRows.filter(row => kinds.includes(row.kind)).length;
  const pending = groups.some(group => Object.values(reviewDestinationIssues(group.session, group.selected.map(row => row.kind))).some(Boolean));
  const stats = [
    { icon: UserRound, label: copy.profileCount, count: selection.groups.length }, { icon: Video, label: copy.videoStat, count: counts(['video']) },
    { icon: Images, label: copy.albumStat, count: counts(['album']) }, { icon: ListVideo, label: copy.playlistStat, count: counts(['playlist']) },
    { icon: Image, label: copy.photoStat, count: counts(['photo', 'gif']) }, { icon: Layers, label: copy.itemCount, count: selection.count },
  ];
  const pickerSession = picker ? profiles[picker.profileKey] : null;
  return <div className="pd-page phr-page"><div className="phr-content">
    <nav className="phr-breadcrumb" aria-label={copy.hub}><Home size={15} aria-hidden="true" /><button type="button" onClick={back}>{copy.hub}</button><span>/</span><strong>{copy.title}</strong></nav>
    <header className="phr-heading"><div><h1 id="profile-hub-review-title" ref={heading} tabIndex={-1}>{copy.title}</h1><p>{copy.subtitle}</p></div><div className="phr-total" aria-live="polite"><Layers size={21} />{reviewText(copy.total, { profiles: number(selection.groups.length), items: number(selection.count) })}</div></header>
    <div className="phr-layout"><div className="phr-groups">
      {!selection.count && <section className="phr-empty" role="status"><Layers size={26} /><h2>{copy.empty}</h2><p>{copy.emptyHint}</p><button type="button" className="pd-button" onClick={back}><ArrowLeft size={16} />{copy.back}</button></section>}
      {groups.map(group => <article className="phr-profile" key={group.profileKey}><header className="phr-profile-head"><div className="phr-identity">
        <ReviewImage className="phr-avatar" src={group.session.profile.avatarUrl} fallback={<UserRound size={24} aria-hidden="true" />} />
        <div><h2>{profileName(group)}</h2><p>{reviewText(copy.selected, { count: number(group.selected.length) })}</p></div></div>
        <div className="phr-profile-actions"><button type="button" className="pd-button" onClick={() => hubNavigation.navigate({ mode: 'profile', profileKey: group.profileKey, panel: useProfileHubStore.getState().profiles[group.profileKey].activeSidePanel })}><ExternalLink size={14} />{copy.viewProfile}</button>
          <button type="button" className="pd-button" onClick={() => useProfileHubStore.getState().selectReviewGroup(group.profileKey)}>{copy.markGroup}</button></div></header>
        <div className="phr-row">{media(group, true)}{target(group, 'video')}</div><div className="phr-row">{media(group, false)}{target(group, 'gallery')}</div>
      </article>)}
      <div className="phr-notice" role="status" aria-live="polite">{message && copy[message]}{undo && <button type="button" className="pd-button" onClick={() => {
        if (useProfileHubStore.getState().selectionClearVersion === undo.clearVersion) { useProfileHubStore.getState().restoreReviewEntry(undo.entry, undo.selected); setMessage('restored'); }
        setUndo(null);
      }}><RotateCcw size={14} />{copy.undo}</button>}</div>
    </div><aside className="phr-summary" id="phr-summary" aria-labelledby="phr-summary-title"><Layers size={32} className="phr-summary-icon" /><h2 id="phr-summary-title">{tracking ? executionCopy.tracking : copy.summary}</h2><p className="phr-muted">{tracking ? executionCopy.snapshotHint : copy.summaryHint}</p>
      {!tracking && <><dl className="phr-stats">{stats.map(stat => <div key={stat.label}><dt><stat.icon size={16} />{stat.label}</dt><dd>{number(stat.count)}</dd></div>)}</dl>
      <section className="phr-summary-profiles"><h3>{copy.profileItems}</h3>{groups.filter(group => group.selected.length).map(group => <div key={group.profileKey}><span><strong>{profileName(group)}</strong><small>{copy.independent}</small></span><b>{number(group.selected.length)}</b></div>)}</section>
      <p className="phr-mode-help">{copy.collectionHint}</p>
      </>}
      <ProfileExecutionPanel eligible={selection.count > 0 && !pending} />
      {pending && <p className="phr-error">{copy.pending}</p>}
      <button type="button" className="pd-button phr-back" onClick={back}><ArrowLeft size={16} />{copy.back}</button>
      <button type="button" className="pd-button phr-back" onClick={onDownloadZip} disabled={!zipAvailable || zipBusy} aria-busy={zipBusy} aria-describedby={!zipAvailable ? 'phr-zip-hint' : undefined}>{copy.zip}</button>
      {!zipAvailable && <p id="phr-zip-hint" className="phr-mode-help">{copy.zipHint}</p>}
      {actionError && <p role="alert" className="phr-error">{actionError}</p>}
      {actionMessage && <p role="status" className="phr-mode-help">{actionMessage}</p>}
    </aside></div>
  </div><ProfileHubSelectionBar active={active} />
  {active && picker && pickerSession && <FolderSelectModal key={JSON.stringify([picker.profileKey, picker.domain])} purpose="destination" isOpen
    onClose={() => setPicker(null)} title={picker.domain === 'video' ? copy.chooseVideoFolder : copy.chooseGalleryFolder} itemTitle={pickerSession.profile.name?.trim() || copy.unnamed}
    mediaType={picker.domain === 'video' ? 'video' : 'album'} existingFolders={(picker.domain === 'video' ? videoFolders : albumFolders).map(folder => folder.name)}
    currentFolder={(picker.domain === 'video' ? pickerSession.destinations.videoFolder : pickerSession.destinations.galleryFolder) ?? undefined}
    onConfirm={folder => { const { profileKey, domain } = picker; useProfileHubStore.getState().updateField(profileKey, 'destinations', current => ({ ...current, [domain === 'video' ? 'videoFolder' : 'galleryFolder']: folder })); }} />}
  </div>;
}
