import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Copy, Trash2, CheckCircle2, ShieldCheck, AlertCircle, ImageOff, Shapes, ChevronDown, ChevronUp, FolderHeart, Film, Play, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ImageItem } from '../../types';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';
import { getDuplicateSourceKey } from '../../utils/duplicateSource';
import { buildCleanupGroups, CleanupEntry, CleanupReason, getCleanupEntryKey, getCleanupAlbumFingerprint, mergeCleanupScanAlbums } from '../../utils/albumCleanup';
import { backendApi } from '../../services/realApi';
import { buildDuplicateAlbumGroups } from '../../utils/duplicateAlbums';
import { scanVideos, scanLocalAlbums, trashScannedVideo } from '../../services/duplicateMediaApi';
import { buildVideoSourceGroups } from '../../utils/duplicateVideoSources';

const OCCURRENCE_PAGE_SIZE = 6;

interface DuplicateCluster {
  id: string;
  matchReason: string;
  bestItem: CleanupEntry;
  redundantItems: CleanupEntry[];
}

const ReviewPreview: React.FC<{ image: ImageItem; label: string; unavailable: string; thumbnail?: boolean; compact?: boolean }> = ({ image, label, unavailable, thumbnail, compact }) => {
  const source = thumbnail ? image.thumbnailUrl : image.originalUrl || image.rawOriginalUrl;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return (
    <div className="rounded-xl bg-slate-950 border border-border overflow-hidden">
      {source && !failed ? (
        <img src={source} alt={label} onError={() => setFailed(true)} className={`w-full object-contain ${compact ? 'h-16' : 'h-40'}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        <div className={`flex flex-col items-center justify-center gap-2 text-slate-500 text-xs text-center ${compact ? 'h-16 p-1' : 'h-40 p-3'}`}><ImageOff size={compact ? 18 : 24} /><span className={compact ? 'sr-only' : undefined}>{unavailable}</span></div>
      )}
    </div>
  );
};

export const DuplicatesView: React.FC = () => {
  const { albums, videos, removeImagesFromAlbum, addNotification, openLightbox, settings, navigateToView, deleteAlbum, deleteVideo, syncVideos, setActivePlayingVideo, fetchTrash } = useAppStore();
  const [filterQuery, setFilterQuery] = useState('');
  const [activePanel, setActivePanel] = useState<'duplicates' | 'cleanup' | 'albums' | 'videos'>('duplicates');
  const [selectedCleanupKeys, setSelectedCleanupKeys] = useState<string[]>([]);
  const [expandedSources, setExpandedSources] = useState<string[]>([]);
  const [expandedClusters, setExpandedClusters] = useState<string[]>([]);
  const [visibleSourceOccurrences, setVisibleSourceOccurrences] = useState<Record<string, number>>({});
  const [visibleClusterOccurrences, setVisibleClusterOccurrences] = useState<Record<string, number>>({});
  const [isRemoving, setIsRemoving] = useState(false);
  const [removalProgress, setRemovalProgress] = useState({ completed: 0, total: 0 });
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ loaded: 0, total: 0 });
  const [scanFailed, setScanFailed] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanCancelled, setScanCancelled] = useState(false);
  const scanController = useRef<AbortController | null>(null);
  const removalLock = useRef(false);
  const reviewedReasons = useRef(new Map<string, CleanupReason>());
  const [visibleClusterCount, setVisibleClusterCount] = useState(16);
  const [visibleCleanupCount, setVisibleCleanupCount] = useState(24);
  const t = translations[settings.language].duplicates;
  const coverageIncomplete = albums.some(album => album.imageCount > (album.images || []).length);
  const [expandedMedia, setExpandedMedia] = useState<string[]>([]);
  const [visibleMediaOccurrences, setVisibleMediaOccurrences] = useState<Record<string, number>>({});
  const [visibleMediaGroups, setVisibleMediaGroups] = useState(16);
  const [visibleSourceVideoGroups, setVisibleSourceVideoGroups] = useState(16);
  const [videoScanMode, setVideoScanMode] = useState<'exact' | 'similar'>('exact');
  const [localAlbumResult, setLocalAlbumResult] = useState<{ scanId: string; groups: { id: string; albumIds: string[] }[]; skipped: number; fingerprint: string } | null>(null);
  const [localAlbumScanning, setLocalAlbumScanning] = useState(false);
  const [localAlbumProgress, setLocalAlbumProgress] = useState({ loaded: 0, total: 0 });
  const [localAlbumState, setLocalAlbumState] = useState<'idle' | 'failed' | 'cancelled' | 'stale' | 'inventory'>('idle');
  const [visibleLocalAlbumGroups, setVisibleLocalAlbumGroups] = useState(16);
  const localAlbumController = useRef<AbortController | null>(null);
  const [videoResult, setVideoResult] = useState<{ groups: { id: string; videoIds: string[]; reason?: 'exact' | 'similar' }[]; scanId: string; skipped: number; fingerprint: string; mode: 'exact' | 'similar' } | null>(null);
  const [videoScanning, setVideoScanning] = useState(false);
  const [videoProgress, setVideoProgress] = useState({ loaded: 0, total: 0 });
  const [videoScanState, setVideoScanState] = useState<'idle' | 'failed' | 'cancelled' | 'stale' | 'inventory'>('idle');
  const [mediaRemoving, setMediaRemoving] = useState(false);
  const videoController = useRef<AbortController | null>(null);
  const mediaRemovalLock = useRef(false);
  const videoFingerprint = (items: typeof videos) => JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)));
  const currentVideoFingerprint = videoFingerprint(videos);
  const albumFingerprint = (items: typeof albums) => JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)).map(album => [album.id, getCleanupAlbumFingerprint(album), album]));
  const currentAlbumFingerprint = albumFingerprint(albums);
  const albumById = useMemo(() => new Map(albums.map(album => [album.id, album])), [albums]);
  const missingLocalAlbumIds = Boolean(localAlbumResult?.groups.some(group => group.albumIds.some(id => !albumById.has(id))));
  const validLocalAlbumResult = localAlbumResult?.fingerprint === currentAlbumFingerprint && !missingLocalAlbumIds ? localAlbumResult : null;
  useEffect(() => {
    if (localAlbumResult && (missingLocalAlbumIds || localAlbumResult.fingerprint !== currentAlbumFingerprint)) {
      setLocalAlbumResult(null);
      setLocalAlbumState(missingLocalAlbumIds ? 'inventory' : 'stale');
    }
  }, [currentAlbumFingerprint, missingLocalAlbumIds, localAlbumResult]);

  const albumGroups = useMemo(() => buildDuplicateAlbumGroups(albums), [albums]);
  const videoById = useMemo(() => new Map(videos.map(video => [video.id, video])), [videos]);
  const missingVideoIds = Boolean(videoResult?.groups.some(group => group.videoIds.some(id => !videoById.has(id))));
  const validVideoResult = videoResult?.fingerprint === currentVideoFingerprint && !missingVideoIds ? videoResult : null;
  useEffect(() => {
    if (videoResult && (missingVideoIds || videoResult.fingerprint !== currentVideoFingerprint)) {
      setVideoResult(null);
      setVideoScanState(missingVideoIds ? 'inventory' : 'stale');
    }
  }, [currentVideoFingerprint, missingVideoIds, videoResult]);
  const query = filterQuery.trim().toLowerCase();
  const filteredAlbumGroups = albumGroups.filter(group => !query || group.albums.some(album => `${album.title} ${album.sourceUrl} ${album.folder || ''}`.toLowerCase().includes(query)));
  const filteredLocalAlbumGroups = (validLocalAlbumResult?.groups || []).map(group => ({ ...group, albums: group.albumIds.map(id => albumById.get(id)).filter((album): album is NonNullable<typeof album> => Boolean(album)) })).filter(group => group.albums.length > 1 && (!query || group.albums.some(album => `${album.title} ${album.sourceUrl} ${album.folder || ''}`.toLowerCase().includes(query))));
  const sourceVideoGroups = useMemo(() => buildVideoSourceGroups(videos), [videos]);
  const filteredSourceVideoGroups = sourceVideoGroups.map(group => ({ ...group, videos: group.videoIds.map(id => videoById.get(id)).filter((video): video is NonNullable<typeof video> => Boolean(video)) })).filter(group => group.videos.length > 1 && (!query || group.videos.some(video => `${video.title} ${video.filename} ${video.folder} ${video.sourceUrl || video.url || video.cloudUrl || ''}`.toLowerCase().includes(query))));
  const filteredVideoGroups = (validVideoResult?.groups || []).map(group => ({ ...group, videos: group.videoIds.map(id => videoById.get(id)).filter((video): video is NonNullable<typeof video> => Boolean(video)) })).filter(group => group.videos.length > 1 && (!query || group.videos.some(video => `${video.title} ${video.filename} ${video.folder}`.toLowerCase().includes(query))));
  const busy = isRemoving || isScanning || localAlbumScanning || videoScanning || mediaRemoving;


  useEffect(() => () => {
    scanController.current?.abort();
    scanController.current = null;
    localAlbumController.current?.abort();
    localAlbumController.current = null;
    videoController.current?.abort();
    videoController.current = null;
  }, []);

  const scanAllAlbums = async () => {
    if (removalLock.current || mediaRemovalLock.current || scanController.current || localAlbumController.current || videoController.current) return;
    const controller = new AbortController();
    const startingAlbums = new Map(useAppStore.getState().albums.map(album => [album.id, getCleanupAlbumFingerprint(album)]));
    scanController.current = controller;
    setIsScanning(true);
    setScanFailed(false);
    setScanCancelled(false);
    setSelectedCleanupKeys([]);
    setScanProgress({ loaded: 0, total: 0 });
    try {
      const fullAlbums = await backendApi.fetchCleanupAlbums(progress => {
        if (!controller.signal.aborted && scanController.current === controller) setScanProgress(progress);
      }, controller.signal);
      if (controller.signal.aborted || scanController.current !== controller) return;
      useAppStore.setState({ albums: mergeCleanupScanAlbums(startingAlbums, useAppStore.getState().albums, fullAlbums) });
      setScanComplete(true);
    } catch {
      if (!controller.signal.aborted && scanController.current === controller) setScanFailed(true);
    } finally {
      if (scanController.current === controller) {
        scanController.current = null;
        setIsScanning(false);
      }
    }
  };
  const cancelScan = () => {
    scanController.current?.abort();
    scanController.current = null;
    setIsScanning(false);
    setScanCancelled(true);
  };

  const cleanupGroups = useMemo(() => {
    const groups = buildCleanupGroups(albums, reviewedReasons.current);
    groups.forEach(group => reviewedReasons.current.set(group.sourceKey, group.reason));
    return groups;
  }, [albums]);
  const cleanupSourceKeys = useMemo(() => new Set(cleanupGroups.map(group => group.sourceKey)), [cleanupGroups]);
  const clusters: DuplicateCluster[] = useMemo(() => {
    const groups = new Map<string, CleanupEntry[]>();
    albums.forEach(album => (album.images || []).forEach(image => {
      const source = getDuplicateSourceKey(image.rawOriginalUrl || image.originalUrl || '');
      if (!source || cleanupSourceKeys.has(source)) return;
      const entries = groups.get(source) || [];
      if (!entries.some(entry => entry.albumId === album.id && entry.image.id === image.id)) entries.push({ image, albumId: album.id, albumTitle: album.title });
      groups.set(source, entries);
    }));
    const result: DuplicateCluster[] = [];
    groups.forEach((items, source) => {
      if (items.length < 2) return;
      items.sort((a, b) => {
        const area = (b.image.width || 0) * (b.image.height || 0) - (a.image.width || 0) * (a.image.height || 0);
        if (area) return area;
        if (a.image.isResolvedOriginal !== b.image.isResolvedOriginal) return a.image.isResolvedOriginal ? -1 : 1;
        return (b.image.fileSizeBytes || 0) - (a.image.fileSizeBytes || 0);
      });
      result.push({ id: source, matchReason: t.identicalUrl, bestItem: items[0], redundantItems: items.slice(1) });
    });
    return result;
  }, [albums, cleanupSourceKeys, t.identicalUrl]);

  const filteredClusters = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return clusters;
    return clusters.filter(cluster => [cluster.bestItem, ...cluster.redundantItems].some(entry => `${entry.albumTitle} ${entry.image.title}`.toLowerCase().includes(query)));
  }, [clusters, filterQuery]);
  const filteredCleanupGroups = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    return query ? cleanupGroups.filter(group => `${group.sourceLabel} ${group.entries.map(entry => `${entry.albumTitle} ${entry.image.title}`).join(' ')}`.toLowerCase().includes(query)) : cleanupGroups;
  }, [cleanupGroups, filterQuery]);
  const displayedClusters = filteredClusters.slice(0, visibleClusterCount);
  const displayedCleanupGroups = filteredCleanupGroups.slice(0, visibleCleanupCount);
  const cleanupEntries = useMemo(() => cleanupGroups.flatMap(group => group.entries), [cleanupGroups]);
  const selectedEntries = activePanel === 'cleanup'
    ? displayedCleanupGroups.flatMap(group => group.entries).filter(entry => selectedCleanupKeys.includes(getCleanupEntryKey(entry)))
    : [];
  const visibleCleanupKeys = displayedCleanupGroups.flatMap(group => group.entries.map(getCleanupEntryKey));
  const allVisibleSelected = visibleCleanupKeys.length > 0 && visibleCleanupKeys.every(key => selectedCleanupKeys.includes(key));
  const totalRedundantCount = filteredClusters.reduce((count, cluster) => count + cluster.redundantItems.length, 0);

  useEffect(() => {
    setVisibleClusterCount(16);
    setVisibleCleanupCount(24);
    setSelectedCleanupKeys([]);
    setVisibleMediaGroups(16);
    setVisibleSourceVideoGroups(16);
    setVisibleLocalAlbumGroups(16);
  }, [filterQuery, activePanel]);
  useEffect(() => {
    const available = new Set(filteredCleanupGroups.slice(0, visibleCleanupCount).flatMap(group => group.entries.map(getCleanupEntryKey)));
    setSelectedCleanupKeys(previous => {
      const retained = previous.filter(key => available.has(key));
      return retained.length === previous.length ? previous : retained;
    });
  }, [filteredCleanupGroups, visibleCleanupCount]);

  const formatBytes = (bytes: number): string => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  const toggleEntries = (entries: CleanupEntry[]) => {
    if (removalLock.current || scanController.current) return;
    const keys = entries.map(getCleanupEntryKey);
    setSelectedCleanupKeys(previous => keys.every(key => previous.includes(key)) ? previous.filter(key => !keys.includes(key)) : Array.from(new Set([...previous, ...keys])));
  };

  const removeEntries = async (requested: CleanupEntry[]) => {
    if (removalLock.current || scanController.current || !requested.length) return;
    const entries = Array.from(new Map(requested.map(entry => [getCleanupEntryKey(entry), entry])).values());
    const byAlbum = new Map<string, CleanupEntry[]>();
    entries.forEach(entry => byAlbum.set(entry.albumId, [...(byAlbum.get(entry.albumId) || []), entry]));
    const confirmation = t.confirmRemoval.replace('{count}', String(entries.length)).replace('{albums}', String(byAlbum.size));
    if (!window.confirm(confirmation)) return;
    removalLock.current = true;
    setIsRemoving(true);
    setRemovalProgress({ completed: 0, total: byAlbum.size });
    let removed = 0;
    let failed = 0;
    try {
      for (const [albumId, requestedEntries] of byAlbum) {
        const currentAlbum = useAppStore.getState().albums.find(album => album.id === albumId);
        const currentByKey = new Map((currentAlbum?.images || []).map(image => [getCleanupEntryKey({ albumId, albumTitle: currentAlbum?.title || '', image }), image]));
        const ids = requestedEntries.map(entry => currentByKey.get(getCleanupEntryKey(entry))?.id).filter((id): id is string => Boolean(id));
        failed += requestedEntries.length - ids.length;
        if (!ids.length) {
          setRemovalProgress(previous => ({ ...previous, completed: previous.completed + 1 }));
          continue;
        }
        const success = await removeImagesFromAlbum(albumId, ids).catch(() => false);
        if (success) removed += ids.length;
        else failed += ids.length;
        setRemovalProgress(previous => ({ ...previous, completed: previous.completed + 1 }));
      }
      addNotification({
        title: failed ? t.cleanupPartialTitle : t.cleanupDone,
        message: (failed ? t.cleanupPartialMsg : t.reviewRemovedMsg).replace('{count}', String(removed)).replace('{failed}', String(failed)),
        type: failed ? (removed ? 'warning' : 'error') : 'success'
      });
    } finally {
      // The server may return fresh image IDs after a deletion. Review survivors again.
      setSelectedCleanupKeys([]);
      removalLock.current = false;
      setIsRemoving(false);
    }
  };
  const handleDiscardSingle = async (entry: CleanupEntry) => { await removeEntries([entry]); };
  const handleDiscardAllRedundant = async () => { await removeEntries(filteredClusters.flatMap(cluster => cluster.redundantItems)); };
  const startLocalAlbumScan = async () => {
    if (localAlbumController.current || scanController.current || videoController.current || removalLock.current || mediaRemovalLock.current) return;
    const controller = new AbortController();
    const fingerprint = albumFingerprint(useAppStore.getState().albums);
    localAlbumController.current = controller;
    setLocalAlbumScanning(true);
    setLocalAlbumResult(null);
    setLocalAlbumState('idle');
    setLocalAlbumProgress({ loaded: 0, total: 0 });
    setVisibleLocalAlbumGroups(16);
    setExpandedMedia(previous => previous.filter(key => !key.startsWith('album-local:')));
    setVisibleMediaOccurrences(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith('album-local:'))));
    try {
      const result = await scanLocalAlbums(progress => {
        if (!controller.signal.aborted && localAlbumController.current === controller) setLocalAlbumProgress(progress);
      }, controller.signal);
      if (controller.signal.aborted || localAlbumController.current !== controller) return;
      const latestAlbums = useAppStore.getState().albums;
      const availableIds = new Set(latestAlbums.map(album => album.id));
      if (result.groups.some(group => group.albumIds.some(id => !availableIds.has(id)))) setLocalAlbumState('inventory');
      else if (fingerprint !== albumFingerprint(latestAlbums)) setLocalAlbumState('stale');
      else setLocalAlbumResult({ ...result, fingerprint });
    } catch {
      if (!controller.signal.aborted && localAlbumController.current === controller) setLocalAlbumState('failed');
    } finally {
      if (localAlbumController.current === controller) { localAlbumController.current = null; setLocalAlbumScanning(false); }
    }
  };
  const cancelLocalAlbumScan = () => {
    localAlbumController.current?.abort();
    localAlbumController.current = null;
    setLocalAlbumScanning(false);
    setLocalAlbumState('cancelled');
  };
  const removeLocalAlbum = async (id: string, title: string) => {
    if (mediaRemovalLock.current || !validLocalAlbumResult || !window.confirm(t.confirmLocalAlbumTrash.replace('{name}', title))) return;
    const latestAlbums = useAppStore.getState().albums;
    if (validLocalAlbumResult.fingerprint !== albumFingerprint(latestAlbums) || !validLocalAlbumResult.groups.some(group => group.albumIds.includes(id))) {
      setLocalAlbumResult(null); setLocalAlbumState('stale'); return;
    }
    mediaRemovalLock.current = true;
    setMediaRemoving(true);
    const scanId = validLocalAlbumResult.scanId;
    setLocalAlbumResult(null);
    try {
      await deleteAlbum(id, scanId);
    } catch {
      addNotification({ title: t.localAlbumTrashFailed, message: t.localAlbumRescan, type: 'error' });
    } finally { mediaRemovalLock.current = false; setMediaRemoving(false); setLocalAlbumState('stale'); }
  };
  const startVideoScan = async (mode: 'exact' | 'similar') => {
    if (videoController.current || localAlbumController.current || scanController.current || removalLock.current || mediaRemovalLock.current) return;
    const controller = new AbortController();
    const fingerprint = videoFingerprint(useAppStore.getState().videos);
    videoController.current = controller;
    setVideoScanning(true);
    setVideoScanMode(mode);
    setExpandedMedia(previous => previous.filter(key => !key.startsWith('video:')));
    setVisibleMediaOccurrences(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith('video:'))));
    setVisibleMediaGroups(16);
    setVideoResult(null);
    setVideoScanState('idle');
    setVideoProgress({ loaded: 0, total: 0 });
    try {
      const result = await scanVideos(progress => {
        if (!controller.signal.aborted && videoController.current === controller) setVideoProgress(progress);
      }, controller.signal, mode);
      if (controller.signal.aborted || videoController.current !== controller) return;
      const latestVideos = useAppStore.getState().videos;
      const availableIds = new Set(latestVideos.map(video => video.id));
      if (result.groups.some(group => group.videoIds.some(id => !availableIds.has(id)))) setVideoScanState('inventory');
      else if (fingerprint !== videoFingerprint(latestVideos)) setVideoScanState('stale');
      else setVideoResult({ ...result, fingerprint, mode });
    } catch {
      if (!controller.signal.aborted && videoController.current === controller) setVideoScanState('failed');
    } finally {
      if (videoController.current === controller) { videoController.current = null; setVideoScanning(false); }
    }
  };
  const cancelVideoScan = () => {
    videoController.current?.abort();
    videoController.current = null;
    setVideoScanning(false);
    setVideoScanState('cancelled');
  };
  const removeAlbum = async (id: string, title: string) => {
    if (mediaRemovalLock.current || !window.confirm(t.confirmAlbumTrash.replace('{name}', title))) return;
    mediaRemovalLock.current = true;
    setMediaRemoving(true);
    try { await deleteAlbum(id); } finally { mediaRemovalLock.current = false; setMediaRemoving(false); }
  };
  const removeVideo = async (id: string, title: string, reason: 'exact' | 'similar') => {
    if (mediaRemovalLock.current || !validVideoResult || !window.confirm((reason === 'similar' ? t.confirmSimilarVideoTrash : t.confirmVideoTrash).replace('{name}', title))) return;
    if (validVideoResult.fingerprint !== videoFingerprint(useAppStore.getState().videos)) { setVideoResult(null); setVideoScanState('stale'); return; }
    mediaRemovalLock.current = true;
    setMediaRemoving(true);
    const scanId = validVideoResult.scanId;
    setVideoResult(null);
    try {
      const success = await trashScannedVideo(scanId, id);
      if (!success) throw new Error('Trash failed');
      await Promise.all([syncVideos(), fetchTrash()]);
      addNotification({ title: t.videoTrashDone, message: t.videoRescan, type: 'success' });
    } catch {
      addNotification({ title: t.videoTrashFailed, message: t.videoRescan, type: 'error' });
    } finally { mediaRemovalLock.current = false; setMediaRemoving(false); setVideoScanState('stale'); }
  };
  const removeSourceVideo = async (id: string, title: string, groupId: string, fingerprint: string) => {
    if (mediaRemovalLock.current || !window.confirm(t.confirmSourceVideoTrash.replace('{name}', title))) return;
    const latestVideos = useAppStore.getState().videos;
    if (fingerprint !== videoFingerprint(latestVideos) || !buildVideoSourceGroups(latestVideos).some(group => group.id === groupId && group.videoIds.includes(id))) {
      addNotification({ title: t.videoSourceChanged, message: t.videoSourceChangedDesc, type: 'warning' });
      return;
    }
    mediaRemovalLock.current = true;
    setMediaRemoving(true);
    try {
      if (!await deleteVideo(id)) addNotification({ title: t.videoTrashFailed, message: t.videoSourceChangedDesc, type: 'error' });
    } catch {
      addNotification({ title: t.videoTrashFailed, message: t.videoSourceChangedDesc, type: 'error' });
    } finally { mediaRemovalLock.current = false; setMediaRemoving(false); }
  };
  const toggleMedia = (id: string) => setExpandedMedia(previous => previous.includes(id) ? previous.filter(key => key !== id) : [...previous, id]);
  const formatDuration = (seconds?: number) => seconds != null && Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : t.mediaUnknown;
  const actionClass = 'px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full" aria-busy={busy}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2.5"><IconBadge icon={<Copy size={20} />} variant="gold" size="md" /><span>{t.title}</span></h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">{t.subtitle}</p>
        </div>
        {activePanel === 'duplicates' && totalRedundantCount > 0 && (
          <button type="button" onClick={handleDiscardAllRedundant} disabled={isRemoving || isScanning} className={actionClass}><ShieldCheck size={16} /><span>{t.keepOnlyOriginals.replace('{count}', String(totalRedundantCount))}</span></button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t.reviewSections}>
        <button type="button" aria-pressed={activePanel === 'duplicates'} disabled={busy} onClick={() => { setActivePanel('duplicates'); setSelectedCleanupKeys([]); }} className={`px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed ${activePanel === 'duplicates' ? 'bg-brand-500/15 border-brand-500/40 text-brand-300' : 'bg-surface border-border text-slate-400 hover:text-slate-200'}`}><Copy size={15} />{t.repeatedSourcesTab} ({clusters.length})</button>
        <button type="button" aria-pressed={activePanel === 'cleanup'} disabled={busy} onClick={() => { setActivePanel('cleanup'); setSelectedCleanupKeys([]); }} className={`px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed ${activePanel === 'cleanup' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-surface border-border text-slate-400 hover:text-slate-200'}`}><Shapes size={15} />{t.cleanupTab} ({cleanupGroups.length})</button>
        <button type="button" aria-pressed={activePanel === 'albums'} disabled={busy} onClick={() => setActivePanel('albums')} className={`px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${activePanel === 'albums' ? 'bg-brand-500/15 border-brand-500/40 text-brand-300' : 'bg-surface border-border text-slate-400 hover:text-slate-200'}`}><FolderHeart size={15} />{t.albumsTab} ({albumGroups.length})</button>
        <button type="button" aria-pressed={activePanel === 'videos'} disabled={busy} onClick={() => setActivePanel('videos')} className={`px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${activePanel === 'videos' ? 'bg-rose-500/15 border-rose-500/40 text-rose-300' : 'bg-surface border-border text-slate-400 hover:text-slate-200'}`}><Film size={15} />{t.videosTab}{validVideoResult ? ` (${validVideoResult.groups.length})` : ''}</button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface-elevated/40 border border-border text-xs">
        <div className="flex items-start gap-2 text-slate-300"><AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" /><span>{activePanel === 'cleanup' ? t.cleanupDescription : activePanel === 'albums' ? t.albumEvidence : activePanel === 'videos' ? t.videoEvidence : t.duplicateEvidenceDescription}</span></div>
        <input type="search" value={filterQuery} disabled={isRemoving || isScanning} onChange={event => { setFilterQuery(event.target.value); setSelectedCleanupKeys([]); }} placeholder={activePanel === 'albums' || activePanel === 'videos' ? t.mediaSearch : t.searchPlaceholder} aria-label={activePanel === 'albums' || activePanel === 'videos' ? t.mediaSearch : t.searchPlaceholder} className="sm:w-64 shrink-0 px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-200 outline-none focus:border-brand-500 disabled:opacity-50" />
      </div>
      {isRemoving && <p role="status" aria-live="polite" className="text-xs text-amber-300 font-mono">{t.removingProgress.replace('{current}', String(removalProgress.completed)).replace('{total}', String(removalProgress.total))}</p>}

      {activePanel === 'albums' ? (
        <section className="space-y-4" aria-label={t.albumsTab}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 rounded-2xl border border-border bg-surface-elevated/40">
            <div className="flex-1 min-w-0 space-y-1 text-xs"><p className={coverageIncomplete ? 'text-amber-300' : 'text-slate-300'}>{coverageIncomplete ? t.coveragePartial : scanComplete ? t.coverageComplete : t.coverageRefresh}</p>{isScanning && <p role="status" aria-live="polite" className="text-brand-300 font-mono">{t.scanningAlbums.replace('{loaded}', String(scanProgress.loaded)).replace('{total}', scanProgress.total ? String(scanProgress.total) : '…')}</p>}{scanFailed && <p role="alert" className="text-rose-300">{t.scanFailed}</p>}{scanCancelled && <p role="status" className="text-slate-400">{t.scanCancelled}</p>}</div>
            {isScanning ? <button type="button" onClick={cancelScan} className="px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-300 cursor-pointer">{t.cancelScan}</button> : <button type="button" disabled={busy} onClick={scanAllAlbums} className="px-3 py-2 rounded-xl bg-brand-500/15 border border-brand-500/40 text-brand-300 text-xs font-semibold cursor-pointer disabled:opacity-50">{scanFailed ? t.retryScan : t.scanAllAlbums}</button>}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 rounded-2xl border border-border bg-surface-elevated/40"><div className="flex-1 min-w-0 space-y-1 text-xs"><p className="font-semibold text-slate-200">{t.localAlbumTitle}</p><p className="text-slate-300">{t.localAlbumCoverage}</p>{localAlbumScanning && <p role="status" aria-live="polite" className="text-brand-300 font-mono">{t.scanningLocalAlbums.replace('{loaded}', String(localAlbumProgress.loaded)).replace('{total}', localAlbumProgress.total ? String(localAlbumProgress.total) : '…')}</p>}{localAlbumState === 'failed' && <p role="alert" className="text-rose-300">{t.localAlbumScanFailed}</p>}{localAlbumState === 'cancelled' && <p role="status" className="text-slate-400">{t.localAlbumScanCancelled}</p>}{(localAlbumState === 'inventory' || missingLocalAlbumIds) && <p role="status" className="text-amber-300">{t.localAlbumInventoryStale}</p>}{(localAlbumState === 'stale' || (localAlbumResult && !validLocalAlbumResult && !missingLocalAlbumIds)) && <p role="status" className="text-amber-300">{t.localAlbumRescan}</p>}{validLocalAlbumResult && <p className="text-slate-400">{t.localAlbumSkipped.replace('{count}', String(validLocalAlbumResult.skipped))}</p>}</div>{localAlbumScanning ? <button type="button" onClick={cancelLocalAlbumScan} className="px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-300 cursor-pointer">{t.cancelScan}</button> : <button type="button" disabled={busy} onClick={startLocalAlbumScan} className="px-3 py-2 rounded-xl bg-brand-500/15 border border-brand-500/40 text-brand-300 text-xs font-semibold cursor-pointer disabled:opacity-50">{t.scanLocalAlbums}</button>}</div>
          {filteredLocalAlbumGroups.slice(0, visibleLocalAlbumGroups).map(group => {
            const key = `album-local:${group.id}`; const expanded = expandedMedia.includes(key); const shown = Math.min(visibleMediaOccurrences[key] || OCCURRENCE_PAGE_SIZE, group.albums.length); const first = group.albums[0];
            return <article key={key} className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3"><div className="flex items-start gap-3"><div className="w-16 h-16 rounded-xl bg-slate-950 border border-border overflow-hidden shrink-0">{first.coverImage ? <img src={first.coverImage} alt="" className="w-full h-full object-cover" loading="lazy" /> : <IconBadge icon={<FolderHeart size={18} />} variant="gold" size="md" />}</div><div className="min-w-0 flex-1 space-y-1"><p className="text-xs font-bold text-slate-200 break-words">{first.title}</p><p className="text-xs text-emerald-300">{t.localAlbumExact}</p><p className="text-xs text-slate-400">{t.mediaCount.replace('{count}', String(group.albums.length))}</p></div><button type="button" onClick={() => toggleMedia(key)} aria-expanded={expanded} aria-label={(expanded ? t.hideOccurrencesFor : t.showOccurrencesFor).replace('{name}', first.title)} className="min-h-11 px-3 py-2 rounded-xl bg-surface border border-border text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-500">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span className="hidden sm:inline">{expanded ? t.hideOccurrences : t.showOccurrences}</span></button></div>
              {expanded && <div className="space-y-3 border-t border-border pt-3"><p className="text-xs text-slate-400">{t.occurrencesShown.replace('{shown}', String(shown)).replace('{total}', String(group.albums.length))}</p><ul className="space-y-2">{group.albums.slice(0, shown).map(album => <li key={album.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-border bg-surface-elevated/30"><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-slate-200 break-words">{album.title}</p><p className="text-[11px] text-slate-400 break-all">{album.sourceUrl || t.mediaUnknown} • {album.imageCount} {t.imagesLabel}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => navigateToView('album-detail', album.id)} className="px-3 py-2 rounded-xl border border-border text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"><ExternalLink size={14} />{t.openAlbum}</button><button type="button" disabled={busy} onClick={() => removeLocalAlbum(album.id, album.title)} className={actionClass}><Trash2 size={14} />{t.moveToTrash}</button></div></li>)}</ul>{shown < group.albums.length && <button type="button" onClick={() => setVisibleMediaOccurrences(previous => ({ ...previous, [key]: shown + OCCURRENCE_PAGE_SIZE }))} className="w-full min-h-11 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreOccurrences}</button>}</div>}</article>;
          })}
          {visibleLocalAlbumGroups < filteredLocalAlbumGroups.length && <button type="button" onClick={() => setVisibleLocalAlbumGroups(previous => previous + 16)} className="w-full py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreGroups.replace('{shown}', String(visibleLocalAlbumGroups)).replace('{total}', String(filteredLocalAlbumGroups.length))}</button>}
          {validLocalAlbumResult && !filteredLocalAlbumGroups.length && <p className="text-xs text-slate-400">{query ? t.noSearchResults : t.noLocalAlbumGroups}</p>}
          <div className="border-t border-border pt-4"><h2 className="text-sm font-bold text-slate-200">{t.albumSuggestionsTitle}</h2></div>
          {filteredAlbumGroups.slice(0, visibleMediaGroups).map(group => {
            const key = `album:${group.id}`; const expanded = expandedMedia.includes(key); const shown = Math.min(visibleMediaOccurrences[key] || OCCURRENCE_PAGE_SIZE, group.albums.length); const first = group.albums[0];
            return <article key={key} className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3"><div className="flex items-start gap-3"><div className="w-16 h-16 rounded-xl bg-slate-950 border border-border overflow-hidden shrink-0">{first.coverImage ? <img src={first.coverImage} alt="" className="w-full h-full object-cover" loading="lazy" /> : <IconBadge icon={<FolderHeart size={18} />} variant="gold" size="md" />}</div><div className="min-w-0 flex-1 space-y-1"><p className="text-xs font-bold text-slate-200 break-words">{first.title}</p><p className="text-xs text-amber-300">{group.reason === 'sameSource' ? t.albumSameSource : group.reason === 'similarItems' ? t.albumSimilarItems : t.albumSameItems}</p><p className="text-xs text-slate-400">{t.mediaCount.replace('{count}', String(group.albums.length))}</p></div><button type="button" onClick={() => toggleMedia(key)} aria-expanded={expanded} aria-label={(expanded ? t.hideOccurrencesFor : t.showOccurrencesFor).replace('{name}', first.title)} className="min-h-11 px-3 py-2 rounded-xl bg-surface border border-border text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-500">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span className="hidden sm:inline">{expanded ? t.hideOccurrences : t.showOccurrences}</span></button></div>
            {expanded && <div className="space-y-3 border-t border-border pt-3"><p className="text-xs text-slate-400">{t.occurrencesShown.replace('{shown}', String(shown)).replace('{total}', String(group.albums.length))}</p><ul className="space-y-2">{group.albums.slice(0, shown).map(album => <li key={album.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-border bg-surface-elevated/30"><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-slate-200 break-words">{album.title}</p><p className="text-[11px] text-slate-400 break-all">{album.sourceUrl || t.mediaUnknown} • {album.imageCount} {t.imagesLabel}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => navigateToView('album-detail', album.id)} className="px-3 py-2 rounded-xl border border-border text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"><ExternalLink size={14} />{t.openAlbum}</button><button type="button" disabled={busy} onClick={() => removeAlbum(album.id, album.title)} className={actionClass}><Trash2 size={14} />{t.moveToTrash}</button></div></li>)}</ul>{shown < group.albums.length && <button type="button" onClick={() => setVisibleMediaOccurrences(previous => ({ ...previous, [key]: shown + OCCURRENCE_PAGE_SIZE }))} className="w-full min-h-11 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreOccurrences}</button>}</div>}</article>;
          })}
          {visibleMediaGroups < filteredAlbumGroups.length && <button type="button" onClick={() => setVisibleMediaGroups(previous => previous + 16)} className="w-full py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreGroups.replace('{shown}', String(visibleMediaGroups)).replace('{total}', String(filteredAlbumGroups.length))}</button>}
          {!filteredAlbumGroups.length && <div className="p-8 glass-panel rounded-3xl border border-border text-center text-sm text-slate-400">{query ? t.noSearchResults : t.noAlbumGroups}</div>}
        </section>
      ) : activePanel === 'videos' ? (
        <section className="space-y-4" aria-label={t.videosTab}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 rounded-2xl border border-border bg-surface-elevated/40"><div className="flex-1 space-y-1 text-xs text-slate-300"><p>{t.videoCoverage}</p><p>{t.similarVideoCoverage}</p>{videoScanning && <p role="status" aria-live="polite" className="text-brand-300 font-mono">{(videoScanMode === 'similar' ? t.scanningSimilarVideos : t.scanningVideos).replace('{loaded}', String(videoProgress.loaded)).replace('{total}', videoProgress.total ? String(videoProgress.total) : '…')}</p>}{videoScanState === 'failed' && <p role="alert" className="text-rose-300">{t.videoScanFailed}</p>}{videoScanState === 'cancelled' && <p role="status" className="text-slate-400">{t.videoScanCancelled}</p>}{(videoScanState === 'inventory' || missingVideoIds) && <p role="status" className="text-amber-300">{t.videoInventoryStale}</p>}{(videoScanState === 'stale' || (videoResult && !validVideoResult && !missingVideoIds)) && <p role="status" className="text-amber-300">{t.videoRescan}</p>}{validVideoResult && <p className="text-slate-400">{t.videoSkipped.replace('{count}', String(validVideoResult.skipped))}</p>}</div>{(videoScanState === 'inventory' || missingVideoIds) && !videoScanning && <button type="button" disabled={busy} onClick={async () => { setMediaRemoving(true); try { await syncVideos(); } finally { setMediaRemoving(false); } }} className="px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-300 cursor-pointer disabled:opacity-50">{t.refreshVideoList}</button>}{videoScanning ? <button type="button" onClick={cancelVideoScan} className="px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-300 cursor-pointer">{t.cancelScan}</button> : <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => startVideoScan('exact')} className="px-3 py-2 rounded-xl bg-brand-500/15 border border-brand-500/40 text-brand-300 text-xs font-semibold cursor-pointer disabled:opacity-50">{t.scanVideos}</button><button type="button" disabled={busy} onClick={() => startVideoScan('similar')} className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-semibold cursor-pointer disabled:opacity-50">{t.scanSimilarVideos}</button></div>}</div>
          {filteredVideoGroups.slice(0, visibleMediaGroups).map(group => { const key = `video:${group.id}`; const expanded = expandedMedia.includes(key); const shown = Math.min(visibleMediaOccurrences[key] || OCCURRENCE_PAGE_SIZE, group.videos.length); const first = group.videos[0]; return <article key={key} className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3"><div className="flex items-start gap-3"><div className="w-16 h-16 rounded-xl bg-slate-950 border border-border overflow-hidden shrink-0">{first.thumbnailUrl ? <img src={first.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <IconBadge icon={<Film size={18} />} variant="rose" size="md" />}</div><div className="min-w-0 flex-1 space-y-1"><p className="text-xs font-bold text-slate-200 break-words">{first.title}</p><p className={`text-xs ${(validVideoResult?.mode === 'similar' || group.reason === 'similar') ? 'text-amber-300' : 'text-emerald-300'}`}>{(validVideoResult?.mode === 'similar' || group.reason === 'similar') ? t.videoSimilar : t.videoExact}</p><p className="text-xs text-slate-400">{t.mediaCount.replace('{count}', String(group.videos.length))}</p></div><button type="button" onClick={() => toggleMedia(key)} aria-expanded={expanded} aria-label={(expanded ? t.hideOccurrencesFor : t.showOccurrencesFor).replace('{name}', first.title)} className="min-h-11 px-3 py-2 rounded-xl bg-surface border border-border text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-500">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span className="hidden sm:inline">{expanded ? t.hideOccurrences : t.showOccurrences}</span></button></div>{expanded && <div className="space-y-3 border-t border-border pt-3"><p className="text-xs text-slate-400">{t.occurrencesShown.replace('{shown}', String(shown)).replace('{total}', String(group.videos.length))}</p><ul className="space-y-2">{group.videos.slice(0, shown).map(video => <li key={video.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-border bg-surface-elevated/30"><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-slate-200 break-words">{video.title}</p><p className="text-[11px] text-slate-400 break-all">{video.folder || t.mediaUnknown} • {formatDuration(video.durationSeconds)} • {video.fileSizeBytes > 0 ? formatBytes(video.fileSizeBytes) : t.mediaUnknown}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setActivePlayingVideo(video)} className="px-3 py-2 rounded-xl border border-border text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"><Play size={14} />{t.playVideo}</button><button type="button" disabled={busy} onClick={() => removeVideo(video.id, video.title, validVideoResult?.mode === 'similar' || group.reason === 'similar' ? 'similar' : 'exact')} className={actionClass}><Trash2 size={14} />{t.moveToTrash}</button></div></li>)}</ul>{shown < group.videos.length && <button type="button" onClick={() => setVisibleMediaOccurrences(previous => ({ ...previous, [key]: shown + OCCURRENCE_PAGE_SIZE }))} className="w-full min-h-11 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreOccurrences}</button>}</div>}</article>; })}
          {visibleMediaGroups < filteredVideoGroups.length && <button type="button" onClick={() => setVisibleMediaGroups(previous => previous + 16)} className="w-full py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreGroups.replace('{shown}', String(visibleMediaGroups)).replace('{total}', String(filteredVideoGroups.length))}</button>}
          {validVideoResult && !filteredVideoGroups.length && <div className="p-8 glass-panel rounded-3xl border border-border text-center text-sm text-slate-400">{query ? t.noSearchResults : validVideoResult.mode === 'similar' ? t.noSimilarVideoGroups : t.noVideoGroups}</div>}
          <div className="border-t border-border pt-4 space-y-1"><h2 className="text-sm font-bold text-slate-200">{t.videoSourceTitle}</h2><p className="text-xs text-slate-400">{t.videoSourceDescription}</p></div>
          {filteredSourceVideoGroups.slice(0, visibleSourceVideoGroups).map(group => { const key = `video-source:${group.id}`; const expanded = expandedMedia.includes(key); const shown = Math.min(visibleMediaOccurrences[key] || OCCURRENCE_PAGE_SIZE, group.videos.length); const first = group.videos[0]; return <article key={key} className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3"><div className="flex items-start gap-3"><div className="w-16 h-16 rounded-xl bg-slate-950 border border-border overflow-hidden shrink-0">{first.thumbnailUrl ? <img src={first.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <IconBadge icon={<Film size={18} />} variant="rose" size="md" />}</div><div className="min-w-0 flex-1 space-y-1"><p className="text-xs font-bold text-slate-200 break-words">{first.title}</p><p className="text-xs text-amber-300">{t.videoSameSource}</p><p className="text-xs text-slate-400">{t.mediaCount.replace('{count}', String(group.videos.length))}</p></div><button type="button" onClick={() => toggleMedia(key)} aria-expanded={expanded} aria-label={(expanded ? t.hideOccurrencesFor : t.showOccurrencesFor).replace('{name}', first.title)} className="min-h-11 px-3 py-2 rounded-xl bg-surface border border-border text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-500">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span className="hidden sm:inline">{expanded ? t.hideOccurrences : t.showOccurrences}</span></button></div>{expanded && <div className="space-y-3 border-t border-border pt-3"><p className="text-xs text-slate-400">{t.occurrencesShown.replace('{shown}', String(shown)).replace('{total}', String(group.videos.length))}</p><ul className="space-y-2">{group.videos.slice(0, shown).map(video => <li key={video.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-border bg-surface-elevated/30"><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-slate-200 break-words">{video.title}</p><p className="text-[11px] text-slate-400 break-all">{video.sourceUrl || video.url || video.cloudUrl || t.mediaUnknown} • {video.folder || t.mediaUnknown} • {formatDuration(video.durationSeconds)} • {video.fileSizeBytes > 0 ? formatBytes(video.fileSizeBytes) : t.mediaUnknown}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setActivePlayingVideo(video)} className="px-3 py-2 rounded-xl border border-border text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"><Play size={14} />{t.playVideo}</button><button type="button" disabled={busy} onClick={() => removeSourceVideo(video.id, video.title, group.id, currentVideoFingerprint)} className={actionClass}><Trash2 size={14} />{t.moveToTrash}</button></div></li>)}</ul>{shown < group.videos.length && <button type="button" onClick={() => setVisibleMediaOccurrences(previous => ({ ...previous, [key]: shown + OCCURRENCE_PAGE_SIZE }))} className="w-full min-h-11 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreOccurrences}</button>}</div>}</article>; })}
          {visibleSourceVideoGroups < filteredSourceVideoGroups.length && <button type="button" onClick={() => setVisibleSourceVideoGroups(previous => previous + 16)} className="w-full py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold cursor-pointer">{t.loadMoreGroups.replace('{shown}', String(visibleSourceVideoGroups)).replace('{total}', String(filteredSourceVideoGroups.length))}</button>}
          {!filteredSourceVideoGroups.length && <p className="text-xs text-slate-400">{query ? t.noSearchResults : t.noSourceVideoGroups}</p>}

        </section>
      ) : activePanel === 'cleanup' ? (
        <section className="space-y-4" aria-label={t.cleanupTab}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 rounded-2xl border border-border bg-surface-elevated/40">
            <div className="flex-1 min-w-0 space-y-1 text-xs">
              <p className={coverageIncomplete ? 'text-amber-300' : 'text-slate-300'}>{coverageIncomplete ? t.coveragePartial : scanComplete ? t.coverageComplete : t.coverageRefresh}</p>
              {isScanning && <p role="status" aria-live="polite" className="text-brand-300 font-mono">{t.scanningAlbums.replace('{loaded}', String(scanProgress.loaded)).replace('{total}', scanProgress.total ? String(scanProgress.total) : '…')}</p>}
              {scanFailed && <p role="alert" className="text-rose-300">{t.scanFailed}</p>}
              {scanCancelled && <p role="status" className="text-slate-400">{t.scanCancelled}</p>}
            </div>
            {isScanning ? <button type="button" onClick={cancelScan} className="px-3 py-2 rounded-xl bg-surface border border-border text-xs text-slate-300 hover:bg-surface-elevated cursor-pointer">{t.cancelScan}</button> : <button type="button" disabled={isRemoving || isScanning} onClick={scanAllAlbums} className="px-3 py-2 rounded-xl bg-brand-500/15 border border-brand-500/40 text-brand-300 text-xs font-semibold hover:bg-brand-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{scanFailed ? t.retryScan : t.scanAllAlbums}</button>}
          </div>
          {filteredCleanupGroups.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-2xl border border-border bg-surface-elevated/40">
              <label className="flex items-center gap-2 p-1 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={allVisibleSelected} ref={element => { if (element) element.indeterminate = !allVisibleSelected && visibleCleanupKeys.some(key => selectedCleanupKeys.includes(key)); }} disabled={isRemoving || isScanning} onChange={() => toggleEntries(displayedCleanupGroups.flatMap(group => group.entries))} className="accent-blue-500 w-4 h-4" />{t.selectVisible.replace('{count}', String(visibleCleanupKeys.length))}</label>
              <span className="text-xs text-slate-400">{t.selectedReferences.replace('{count}', String(selectedEntries.length))}</span>
              <button type="button" disabled={isRemoving || isScanning || !selectedEntries.length} onClick={() => setSelectedCleanupKeys([])} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{t.clearSelection}</button>
              <button type="button" disabled={isRemoving || isScanning || !selectedEntries.length} onClick={() => removeEntries(selectedEntries)} className={`${actionClass} sm:ml-auto`}><Trash2 size={14} />{t.removeSelected.replace('{count}', String(selectedEntries.length))}</button>
              <p className="w-full text-[11px] text-slate-500">{t.selectionScope}</p>
            </div>
          )}
          {displayedCleanupGroups.map(group => {
            const first = group.entries[0];
            const expanded = expandedSources.includes(group.sourceKey);
            const selectedCount = group.entries.filter(entry => selectedCleanupKeys.includes(getCleanupEntryKey(entry))).length;
            const visibleOccurrences = Math.min(visibleSourceOccurrences[group.sourceKey] || OCCURRENCE_PAGE_SIZE, group.entries.length);
            return (
              <article key={group.sourceKey} className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="w-16 shrink-0 space-y-1.5"><ReviewPreview image={first.image} label={t.originalAsset} unavailable={t.previewUnavailable} compact /><p className="text-[10px] text-slate-500">{t.originalAsset}</p></div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 p-1 text-xs font-bold text-slate-200 cursor-pointer"><input type="checkbox" disabled={isRemoving || isScanning} checked={selectedCount === group.entries.length} ref={element => { if (element) element.indeterminate = selectedCount > 0 && selectedCount < group.entries.length; }} onChange={() => toggleEntries(group.entries)} aria-label={t.selectSource.replace('{name}', group.sourceLabel)} className="accent-blue-500 w-4 h-4" /><span className="break-all">{group.sourceLabel}</span></label>
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">{t.reviewSuggestion}</span>
                    </div>
                    <p className="text-xs text-slate-300">{t.cleanupReasons[group.reason]}</p>
                    <p className="text-[11px] text-slate-400 font-mono">{t.occurrenceSummary.replace('{count}', String(group.entries.length)).replace('{albums}', String(group.albumCount))} • {first.image.width > 0 && first.image.height > 0 ? `${first.image.width}×${first.image.height} px` : t.originalSize}{first.image.fileSizeBytes ? ` • ${formatBytes(first.image.fileSizeBytes)}` : ''}</p>
                    {group.thumbnailMismatchCount > 0 && <p className="text-xs text-amber-300 flex items-start gap-1.5"><AlertCircle size={13} className="shrink-0 mt-0.5" />{t.thumbnailMismatch.replace('{count}', String(group.thumbnailMismatchCount))}</p>}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button type="button" disabled={isRemoving || isScanning} onClick={() => removeEntries(group.entries)} className={actionClass}><Trash2 size={14} />{t.removeSource.replace('{count}', String(group.entries.length))}</button>
                      <button type="button" disabled={isRemoving || isScanning} onClick={() => setExpandedSources(previous => expanded ? previous.filter(key => key !== group.sourceKey) : [...previous, group.sourceKey])} className="min-h-11 px-3 py-2 rounded-xl bg-surface border border-border text-slate-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-surface-elevated cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-expanded={expanded} aria-label={(expanded ? t.hideOccurrencesFor : t.showOccurrencesFor).replace('{name}', group.sourceLabel)}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded ? t.hideOccurrences : t.showOccurrences}</button>
                    </div>
                  </div>
                </div>
                {expanded && <div className="space-y-3 border-t border-border pt-3"><p className="text-xs text-slate-400">{t.occurrencesShown.replace('{shown}', String(visibleOccurrences)).replace('{total}', String(group.entries.length))}</p><ul className="space-y-2">{group.entries.slice(0, visibleOccurrences).map(entry => {
                  const key = getCleanupEntryKey(entry);
                  const thumbnailDiffers = getDuplicateSourceKey(entry.image.rawThumbnailUrl || entry.image.thumbnailUrl || '') !== group.sourceKey;
                  return <li key={key} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-border bg-surface-elevated/30">
                    <label className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"><input type="checkbox" disabled={isRemoving || isScanning} checked={selectedCleanupKeys.includes(key)} onChange={() => toggleEntries([entry])} className="accent-blue-500 w-4 h-4 shrink-0" /><span className="text-xs text-slate-300 break-words">{entry.albumTitle}<span className="block text-[10px] text-slate-500 mt-1">{entry.image.title}</span></span></label>
                    {thumbnailDiffers && <div className="w-24 shrink-0"><img src={entry.image.thumbnailUrl} alt={t.linkedThumbnail} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="w-24 h-14 object-contain rounded-lg bg-slate-950" /><span className="block text-[9px] text-amber-300 mt-1">{t.linkedThumbnail}</span></div>}
                    <button type="button" disabled={isRemoving || isScanning} onClick={() => removeEntries([entry])} className={actionClass} aria-label={t.removeOccurrenceFrom.replace('{album}', entry.albumTitle)}><Trash2 size={13} />{t.removeOccurrence}</button>
                  </li>;
                })}</ul>{visibleOccurrences < group.entries.length && <button type="button" disabled={isRemoving || isScanning} onClick={() => setVisibleSourceOccurrences(previous => ({ ...previous, [group.sourceKey]: visibleOccurrences + OCCURRENCE_PAGE_SIZE }))} className="w-full min-h-11 py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold hover:bg-surface-elevated cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{t.loadMoreOccurrences}</button>}</div>}
              </article>
            );
          })}
          {visibleCleanupCount < filteredCleanupGroups.length && <button type="button" disabled={isRemoving || isScanning} onClick={() => setVisibleCleanupCount(previous => previous + 24)} className="w-full py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold hover:bg-surface-elevated cursor-pointer disabled:opacity-50">{t.loadMoreGroups.replace('{shown}', String(displayedCleanupGroups.length)).replace('{total}', String(filteredCleanupGroups.length))}</button>}
          {!filteredCleanupGroups.length && <div className="p-8 sm:p-12 glass-panel rounded-3xl border border-border text-center space-y-3"><Shapes size={28} className="mx-auto text-slate-500" /><h2 className="font-bold text-slate-200 text-sm">{filterQuery.trim() ? t.noSearchResults : t.noCleanupCandidates}</h2><p className="text-xs text-slate-400 max-w-xl mx-auto">{filterQuery.trim() ? t.noSearchResultsDesc : t.noCleanupCandidatesDesc}</p></div>}
        </section>
      ) : filteredClusters.length > 0 ? (
        <section className="space-y-4" aria-label={t.repeatedSourcesTab}>
          {displayedClusters.map(cluster => {
            const expanded = expandedClusters.includes(cluster.id);
            const entries = [cluster.bestItem, ...cluster.redundantItems];
            const visibleOccurrences = Math.min(visibleClusterOccurrences[cluster.id] || OCCURRENCE_PAGE_SIZE, entries.length);
            return (
              <article key={cluster.id} className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-16 shrink-0"><ReviewPreview image={cluster.bestItem.image} label={cluster.bestItem.image.title} unavailable={t.previewUnavailable} compact /></div>
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold text-[10px]">{cluster.matchReason}</span>
                      <span className="font-semibold text-slate-200 break-words">{t.albumLabel}{cluster.bestItem.albumTitle}</span>
                      <span className="text-slate-400 font-mono text-[11px]">{t.redundancySummary.replace('{count}', String(cluster.redundantItems.length))}</span>
                    </div>
                  </div>
                  <button type="button" disabled={isRemoving || isScanning} onClick={() => setExpandedClusters(previous => expanded ? previous.filter(key => key !== cluster.id) : [...previous, cluster.id])} aria-expanded={expanded} aria-label={(expanded ? t.hideOccurrencesFor : t.showOccurrencesFor).replace('{name}', cluster.bestItem.image.title)} className="min-h-11 px-3 py-2 rounded-xl bg-surface border border-border text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-surface-elevated cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded ? t.hideOccurrences : t.showOccurrences}</button>
                </div>
                {expanded && <div className="space-y-3 border-t border-border pt-3">
                  <p className="text-xs text-slate-400">{t.occurrencesShown.replace('{shown}', String(visibleOccurrences)).replace('{total}', String(entries.length))}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {entries.slice(0, visibleOccurrences).map((entry, index) => (
                      <div key={getCleanupEntryKey(entry)} className={`p-3 rounded-2xl flex flex-col justify-between gap-2 ${index === 0 ? 'bg-emerald-950/20 border-2 border-emerald-500 shadow-glow-emerald' : 'bg-surface-elevated/40 border border-border'}`}>
                        <button type="button" className="relative text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl" aria-label={t.inspectImage.replace('{name}', entry.image.title)} onClick={event => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          openLightbox(entry.image, undefined, { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) });
                        }}><ReviewPreview image={entry.image} label={entry.image.title} unavailable={t.previewUnavailable} /><span className={`absolute top-2 right-2 px-2 py-0.5 rounded font-mono font-bold text-[9px] ${index === 0 ? 'bg-emerald-500 text-black' : 'bg-rose-500/80 text-white'}`}>{index === 0 ? t.keepBadge : t.duplicateBadge}</span></button>
                        <div className="space-y-1"><p className={`text-xs font-semibold break-words ${index === 0 ? 'text-emerald-400' : 'text-slate-300'}`}>{index === 0 ? t.bestResolution : entry.albumTitle}</p><p className="text-[11px] font-mono text-slate-400">{entry.image.width > 0 ? `${entry.image.width}×${entry.image.height} px` : t.originalSize}{entry.image.fileSizeBytes ? ` • ${formatBytes(entry.image.fileSizeBytes)}` : ''}</p></div>
                        {index === 0 ? <CheckCircle2 size={14} className="text-emerald-400" /> : <button type="button" disabled={isRemoving || isScanning} onClick={() => handleDiscardSingle(entry)} className={actionClass}><Trash2 size={13} />{t.discardSingle}</button>}
                      </div>
                    ))}
                  </div>
                  {visibleOccurrences < entries.length && <button type="button" disabled={isRemoving || isScanning} onClick={() => setVisibleClusterOccurrences(previous => ({ ...previous, [cluster.id]: visibleOccurrences + OCCURRENCE_PAGE_SIZE }))} className="w-full min-h-11 py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold hover:bg-surface-elevated cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{t.loadMoreOccurrences}</button>}
                </div>}
              </article>
            );
          })}
          {visibleClusterCount < filteredClusters.length && <button type="button" disabled={isRemoving || isScanning} onClick={() => setVisibleClusterCount(previous => previous + 16)} className="w-full py-3 rounded-xl border border-border bg-surface text-brand-300 text-xs font-semibold hover:bg-surface-elevated cursor-pointer disabled:opacity-50">{t.loadMoreGroups.replace('{shown}', String(displayedClusters.length)).replace('{total}', String(filteredClusters.length))}</button>}
        </section>
      ) : (
        <div className="p-8 sm:p-12 glass-panel rounded-3xl border border-border text-center space-y-3"><CheckCircle2 size={28} className="text-emerald-400 mx-auto" /><h2 className="font-bold text-slate-200 text-sm">{filterQuery.trim() ? t.noSearchResults : t.noDuplicates}</h2><p className="text-xs text-slate-400 max-w-xl mx-auto">{filterQuery.trim() ? t.noSearchResultsDesc : t.noDuplicatesDesc}</p></div>
      )}
    </div>
  );
};
