import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Film,
  Search,
  Loader2,
  CheckCircle2,
  Check,
  Save,
  Download,
  Play,
  Pause,
  Folder,
  Layers,
  Sparkles,
  ExternalLink,
  ChevronDown,
  Trash2,
  CheckSquare,
  Square,
  AlertCircle,
  RotateCcw,
  Copy,
  Eye,
  ArrowLeft,
  FolderPlus,
  LayoutGrid,
  Filter,
  X
} from 'lucide-react';
import { useAppStore, triggerJobsPollingLoop, getCanonicalMediaFingerprint } from '../../store/useAppStore';
import { backendApi } from '../../services/realApi';
import { soundEffects } from '../../services/soundEffects';
import { ScannedVideoItem, VideoScraperAlbum } from '../../types';
import { FolderSelectModal } from '../common/FolderSelectModal';
import { SavedRedirectBadge } from '../common/SavedRedirectBadge';
import { getProxiedStreamUrl } from './AlbumDetailView';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';
import { ModalPortal } from '../common/ModalPortal';

export const WebVideoScraperView: React.FC = () => {
  const {
    settings,
    videoFolders,
    videos,
    jobs,
    addNotification,
    navigateToView,
    syncJobs,
    syncVideos,
    webScraperState,
    setWebScraperState,
    clearWebScraperState,
    checkItemSavedStatus,
    markItemAsSavedOptimistically
  } = useAppStore();

  const t = translations[settings.language].webVideoScraper || translations['en-US'].webVideoScraper;
  const isEn = settings.language === 'en-US';

  const { url, scanResult, selectedIds, targetFolder, errorMsg } = webScraperState;
  const saveLocally = Boolean(webScraperState.saveLocally);
  const activeTab = webScraperState.activeTab || 'main';
  const viewLayout = webScraperState.viewLayout || 'albums';
  const videoAlbums: VideoScraperAlbum[] = webScraperState.videoAlbums || [];
  const selectedAlbumIds: string[] = webScraperState.selectedAlbumIds || [];

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgressInfo, setScanProgressInfo] = useState<string | null>(null);
  const scanAbortControllerRef = useRef<AbortController | null>(null);
  const [scanningSubAlbumUrl, setScanningSubAlbumUrl] = useState<string | null>(null);
  const [isBatchSaving, setIsBatchSaving] = useState(false);
  const [limit, setLimit] = useState<number | ''>('');
  const [maxPages, setMaxPages] = useState<number | ''>('');

  useEffect(() => {
    return () => {
      if (scanAbortControllerRef.current) {
        scanAbortControllerRef.current.abort();
      }
    };
  }, []);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [savingSingleId, setSavingSingleId] = useState<string | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateVideosList, setDuplicateVideosList] = useState<ScannedVideoItem[]>([]);
  const [onlyNewVideosList, setOnlyNewVideosList] = useState<ScannedVideoItem[]>([]);
  const [folderModalState, setFolderModalState] = useState<{
    isOpen: boolean;
    mode: 'single' | 'batch' | 'album_batch';
    targetVideo?: ScannedVideoItem;
    customBatchVideos?: ScannedVideoItem[];
  }>({ isOpen: false, mode: 'single' });

  // Interactive Video Album Inspector State (Enter album -> select videos -> return to albums)
  const [inspectingAlbumId, setInspectingAlbumId] = useState<string | null>(null);
  const [draftAlbumSelectedIds, setDraftAlbumSelectedIds] = useState<Set<string>>(new Set());
  const [inspectorSearchQuery, setInspectorSearchQuery] = useState<string>('');
  const [inspectorSectionFilter, setInspectorSectionFilter] = useState<'all' | 'new' | 'hd'>('all');

  const inspectingAlbum = useMemo(
    () => videoAlbums.find(a => a.id === inspectingAlbumId) || null,
    [videoAlbums, inspectingAlbumId]
  );

  const handleUrlChange = (val: string) => {
    setWebScraperState({ url: val });
  };

  // High-performance gallery lookup index (O(1) lookups instead of O(N*M) per frame)
  const existingGalleryLookup = useMemo(() => {
    const idSet = new Set<string>();
    const urlSet = new Set<string>();
    const titleSet = new Set<string>();

    for (const v of videos) {
      if (v.id) idSet.add(v.id);
      if ((v as any).source_id) idSet.add((v as any).source_id);
      if (v.filename) idSet.add(v.filename);
      if ((v as any).source_url) urlSet.add((v as any).source_url.toLowerCase().trim());
      if ((v as any).url) urlSet.add((v as any).url.toLowerCase().trim());
      if (v.title) titleSet.add(v.title.toLowerCase().trim());
    }
    return { idSet, urlSet, titleSet };
  }, [videos]);

  const isVideoSavedInGallery = (item: ScannedVideoItem) => {
    if (item.already_saved) return true;
    if (item.id && existingGalleryLookup.idSet.has(item.id)) return true;
    if (item.url && existingGalleryLookup.urlSet.has(item.url.toLowerCase().trim())) return true;
    if (item.title && existingGalleryLookup.titleSet.has(item.title.toLowerCase().trim())) return true;
    const status = checkItemSavedStatus({
      url: item.url || item.stream_url,
      title: item.title,
      mediaType: 'video'
    });
    return Boolean(status && status.isSaved);
  };

  // In-page duplicate detection map (canonical fingerprint)
  const inPageDuplicateMap = useMemo(() => {
    const counts = new Map<string, number>();
    if (!scanResult || !scanResult.videos) return counts;
    scanResult.videos.forEach(v => {
      const key = getCanonicalMediaFingerprint(v.title, v.url || v.stream_url, v.height);
      if (key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    return counts;
  }, [scanResult]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const mainVideos = useMemo(() => {
    return scanResult ? scanResult.videos.filter(v => v.is_primary !== false && v.section !== 'recommended') : [];
  }, [scanResult]);

  const recommendedVideos = useMemo(() => {
    return scanResult ? scanResult.videos.filter(v => v.is_primary === false || v.section === 'recommended') : [];
  }, [scanResult]);

  const allVideos = useMemo(() => {
    return scanResult ? scanResult.videos : [];
  }, [scanResult]);

  const displayedVideos = useMemo(() => {
    return activeTab === 'main'
      ? mainVideos
      : activeTab === 'recommended'
      ? recommendedVideos
      : allVideos;
  }, [activeTab, mainVideos, recommendedVideos, allVideos]);

  // Progressive infinite scroll windowing (48 items per slice to eliminate DOM freezing)
  const [visibleCount, setVisibleCount] = useState(48);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(48);
  }, [activeTab, url, viewLayout]);

  const visibleVideos = useMemo(() => {
    return displayedVideos.slice(0, visibleCount);
  }, [displayedVideos, visibleCount]);

  useEffect(() => {
    if (!loadMoreSentinelRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && displayedVideos.length > visibleCount) {
        setVisibleCount(prev => prev + 48);
      }
    }, { rootMargin: '400px' });

    observer.observe(loadMoreSentinelRef.current);
    return () => observer.disconnect();
  }, [displayedVideos.length, visibleCount]);

  const displayedIds = useMemo(() => displayedVideos.map(v => v.id), [displayedVideos]);
  const isAllDisplayedSelected = useMemo(() => {
    return displayedIds.length > 0 && displayedIds.every(id => selectedSet.has(id));
  }, [displayedIds, selectedSet]);

  const newDisplayedVideos = useMemo(() => {
    return displayedVideos.filter(v => !isVideoSavedInGallery(v));
  }, [displayedVideos, existingGalleryLookup]);

  const totalSavedCount = useMemo(() => {
    if (!scanResult || !scanResult.videos) return 0;
    return scanResult.videos.filter(v => isVideoSavedInGallery(v)).length;
  }, [scanResult, existingGalleryLookup]);

  const totalNewCount = useMemo(() => {
    if (!scanResult || !scanResult.videos) return 0;
    return scanResult.videos.length - totalSavedCount;
  }, [scanResult, totalSavedCount]);

  // Progressive infinite scroll for Album Inspector Modal
  const [inspectorVisibleCount, setInspectorVisibleCount] = useState(48);
  const inspectorLoadMoreRef = useRef<HTMLDivElement | null>(null);

  const filteredInspectorVideos = useMemo(() => {
    if (!inspectingAlbum) return [];
    return inspectingAlbum.videos.filter((vItem) => {
      if (inspectorSearchQuery.trim()) {
        const q = inspectorSearchQuery.trim().toLowerCase();
        if (!(vItem.title || '').toLowerCase().includes(q)) return false;
      }
      if (inspectorSectionFilter === 'new') {
        return !isVideoSavedInGallery(vItem);
      }
      if (inspectorSectionFilter === 'hd') {
        const qHint = (vItem.quality_hint || vItem.resolution || '').toLowerCase();
        return (vItem.height || 0) >= 720 || qHint.includes('hd') || qHint.includes('1080') || qHint.includes('720') || qHint.includes('4k') || !vItem.height;
      }
      return true;
    });
  }, [inspectingAlbum, inspectorSearchQuery, inspectorSectionFilter, existingGalleryLookup]);

  useEffect(() => {
    setInspectorVisibleCount(48);
  }, [inspectingAlbumId, inspectorSearchQuery, inspectorSectionFilter]);

  const visibleInspectorVideos = useMemo(() => {
    return filteredInspectorVideos.slice(0, inspectorVisibleCount);
  }, [filteredInspectorVideos, inspectorVisibleCount]);

  useEffect(() => {
    if (!inspectorLoadMoreRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && filteredInspectorVideos.length > inspectorVisibleCount) {
        setInspectorVisibleCount(prev => prev + 48);
      }
    }, { rootMargin: '400px' });

    observer.observe(inspectorLoadMoreRef.current);
    return () => observer.disconnect();
  }, [filteredInspectorVideos.length, inspectorVisibleCount]);

  // Build VideoAlbums from a scan response and merge with existing albums
  const buildAlbumsFromScan = (
    cleanUrl: string,
    pageTitle: string,
    suggestedFolder: string,
    scannedVideos: ScannedVideoItem[],
    appendMode: boolean = false
  ): { nextAlbums: VideoScraperAlbum[]; nextSelectedAlbumIds: string[] } => {
    const primaryVids = scannedVideos.filter(v => v.is_primary !== false && v.section !== 'recommended');
    const recVids = scannedVideos.filter(v => v.is_primary === false || v.section === 'recommended');

    const createdAlbums: VideoScraperAlbum[] = [];
    const baseId = `valb-${cleanUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}-${Date.now().toString(36).slice(-4)}`;

    if (primaryVids.length > 0) {
      const unsavedPrimaryIds = primaryVids
        .filter(v => !v.already_saved && !isVideoSavedInGallery(v))
        .map(v => v.id);
      createdAlbums.push({
        id: `${baseId}-main`,
        title: pageTitle || cleanUrl,
        url: cleanUrl,
        thumbnailUrl: primaryVids[0]?.thumbnail_url || scannedVideos[0]?.thumbnail_url || '',
        suggestedFolder,
        videos: primaryVids,
        selectedVideoIds: unsavedPrimaryIds.length > 0 ? unsavedPrimaryIds : primaryVids.map(v => v.id),
        sourceType: 'main',
        scannedAt: Date.now()
      });
    }

    if (recVids.length > 0) {
      const unsavedRecIds = recVids
        .filter(v => !v.already_saved && !isVideoSavedInGallery(v))
        .map(v => v.id);
      createdAlbums.push({
        id: `${baseId}-rec`,
        title: `${pageTitle || cleanUrl} — ${isEn ? 'Related / Recommended' : 'Recomendados da Página'}`,
        url: `${cleanUrl}#recommended`,
        thumbnailUrl: recVids[0]?.thumbnail_url || scannedVideos[0]?.thumbnail_url || '',
        suggestedFolder,
        videos: recVids,
        selectedVideoIds: unsavedRecIds.length > 0 ? unsavedRecIds : recVids.map(v => v.id),
        sourceType: 'recommended',
        scannedAt: Date.now()
      });
    }

    if (createdAlbums.length === 0 && scannedVideos.length > 0) {
      createdAlbums.push({
        id: `${baseId}-all`,
        title: pageTitle || cleanUrl,
        url: cleanUrl,
        thumbnailUrl: scannedVideos[0]?.thumbnail_url || '',
        suggestedFolder,
        videos: scannedVideos,
        selectedVideoIds: scannedVideos.map(v => v.id),
        sourceType: 'main',
        scannedAt: Date.now()
      });
    }

    const baseExisting = appendMode
      ? videoAlbums.filter(a => a.url !== cleanUrl && a.url !== `${cleanUrl}#recommended`)
      : [];
    const nextAlbums = [...createdAlbums, ...baseExisting];
    const autoSelectAlbumIds = createdAlbums
      .filter(a => a.sourceType === 'main' || createdAlbums.length === 1)
      .map(a => a.id);
    const nextSelectedAlbumIds = appendMode
      ? Array.from(new Set([...selectedAlbumIds, ...autoSelectAlbumIds]))
      : autoSelectAlbumIds;

    return { nextAlbums, nextSelectedAlbumIds };
  };

  const handleScanPage = async (appendAsNewAlbum: boolean = false) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    setWebScraperState({ errorMsg: null });
    setIsScanning(true);
    setScanProgressInfo(isEn ? 'Connecting...' : 'Conectando...');
    soundEffects.click(settings.soundEnabled);

    if (scanAbortControllerRef.current) {
      scanAbortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    scanAbortControllerRef.current = abortCtrl;

    try {
      const maxToScan = typeof limit === 'number' && limit > 0 ? limit : 5000;
      const maxPagesNum = typeof maxPages === 'number' && maxPages > 0 ? maxPages : undefined;

      let currentVideos: ScannedVideoItem[] = [];
      let pageTitle = cleanUrl;
      let targetFolder = 'Extraídos';

      const res = await backendApi.scanPageForVideosStream(
        cleanUrl,
        maxToScan,
        maxPagesNum,
        // onPageDiscovered callback -> updates UI in real-time as each page loads!
        (pageData) => {
          if (pageData.page_title) pageTitle = pageData.page_title;
          if (pageData.suggested_folder) targetFolder = pageData.suggested_folder;

          if (pageData.new_videos && pageData.new_videos.length > 0) {
            currentVideos = [...currentVideos, ...pageData.new_videos];

            const primaryVids = currentVideos.filter(v => v.is_primary !== false && v.section !== 'recommended');
            const targetVids = primaryVids.length > 0 ? primaryVids : currentVideos;
            const unsavedTargetIds = targetVids
              .filter((v: ScannedVideoItem) => !v.already_saved && !isVideoSavedInGallery(v))
              .map(v => v.id);

            const { nextAlbums, nextSelectedAlbumIds } = buildAlbumsFromScan(
              cleanUrl,
              pageTitle,
              targetFolder,
              currentVideos,
              appendAsNewAlbum
            );

            setWebScraperState({
              scanResult: {
                success: true,
                page_title: pageTitle,
                suggested_folder: targetFolder,
                total_found: currentVideos.length,
                main_count: primaryVids.length,
                recommended_count: currentVideos.length - primaryVids.length,
                already_saved_count: currentVideos.filter(v => v.already_saved).length,
                new_videos_count: currentVideos.filter(v => !v.already_saved).length,
                album_id: '',
                pages_scanned: pageData.pages_scanned,
                videos: currentVideos
              },
              targetFolder: targetFolder,
              activeTab: 'main',
              selectedIds: unsavedTargetIds,
              videoAlbums: nextAlbums,
              selectedAlbumIds: nextSelectedAlbumIds,
              errorMsg: null
            });
          }

          setScanProgressInfo(
            isEn
              ? `Page ${pageData.page_number} (${currentVideos.length} videos)`
              : `Pág. ${pageData.page_number} (${currentVideos.length} vídeos)`
          );
        },
        // onComplete
        () => {
          soundEffects.success(settings.soundEnabled);
        },
        // onError
        (error) => {
          setWebScraperState({ errorMsg: error });
          soundEffects.trash(settings.soundEnabled);
        },
        abortCtrl.signal
      );

      // Final synchronization
      if (res && res.videos && res.videos.length > 0) {
        const folder = res.suggested_folder || targetFolder || 'Extraídos';
        const primaryVids = res.videos.filter((v: ScannedVideoItem) => v.is_primary !== false && v.section !== 'recommended');
        const targetVids = primaryVids.length > 0 ? primaryVids : res.videos;
        const unsavedTargetIds = targetVids
          .filter((v: ScannedVideoItem) => !v.already_saved && !isVideoSavedInGallery(v))
          .map((v: ScannedVideoItem) => v.id);

        const { nextAlbums, nextSelectedAlbumIds } = buildAlbumsFromScan(
          cleanUrl,
          res.page_title || pageTitle,
          folder,
          res.videos,
          appendAsNewAlbum
        );

        setWebScraperState({
          scanResult: {
            ...res,
            page_title: res.page_title || pageTitle,
            suggested_folder: folder
          },
          targetFolder: folder,
          activeTab: 'main',
          selectedIds: unsavedTargetIds,
          videoAlbums: nextAlbums,
          selectedAlbumIds: nextSelectedAlbumIds,
          errorMsg: null
        });
        soundEffects.success(settings.soundEnabled);
      } else if (currentVideos.length === 0) {
        setWebScraperState({ errorMsg: res?.error || (isEn ? "No videos found on this page." : "Nenhum vídeo encontrado nesta página.") });
        soundEffects.trash(settings.soundEnabled);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setWebScraperState({ errorMsg: err.message || (isEn ? "Failed to scan page." : "Falha ao escanear página.") });
        soundEffects.trash(settings.soundEnabled);
      }
    } finally {
      setIsScanning(false);
      setScanProgressInfo(null);
    }
  };

  // Scan a specific video card's target page as a sub-album and open it in the Video Album Selector!
  const handleInspectVideoPageAsAlbum = async (item: ScannedVideoItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const pageUrl = (item.url || '').trim();
    if (!pageUrl) return;

    // Check if already in videoAlbums
    const existing = videoAlbums.find(a => a.url === pageUrl);
    if (existing) {
      openVideoAlbumInspector(existing);
      return;
    }

    setScanningSubAlbumUrl(pageUrl);
    soundEffects.click(settings.soundEnabled);
    try {
      const res = await backendApi.scanPageForVideos(pageUrl, 200, 1);
      if (res.success && res.videos && res.videos.length > 0) {
        const unsavedIds = res.videos
          .filter((v: ScannedVideoItem) => !v.already_saved && !isVideoSavedInGallery(v))
          .map((v: ScannedVideoItem) => v.id);
        const newAlbum: VideoScraperAlbum = {
          id: `valb-sub-${Date.now().toString(36)}`,
          title: res.page_title || item.title || pageUrl,
          url: pageUrl,
          thumbnailUrl: item.thumbnail_url || res.videos[0]?.thumbnail_url || '',
          suggestedFolder: res.suggested_folder || targetFolder || 'Extraídos',
          videos: res.videos,
          selectedVideoIds: unsavedIds.length > 0 ? unsavedIds : res.videos.map((v: ScannedVideoItem) => v.id),
          sourceType: 'sub_album',
          scannedAt: Date.now()
        };
        const nextAlbums = [newAlbum, ...videoAlbums];
        const nextSelAlbums = Array.from(new Set([...selectedAlbumIds, newAlbum.id]));
        setWebScraperState({
          videoAlbums: nextAlbums,
          selectedAlbumIds: nextSelAlbums
        });
        openVideoAlbumInspector(newAlbum);
      } else {
        // Fallback: create a single-item album for this video if page has no sub-list
        const fallbackAlbum: VideoScraperAlbum = {
          id: `valb-sub-${Date.now().toString(36)}`,
          title: item.title || pageUrl,
          url: pageUrl,
          thumbnailUrl: item.thumbnail_url || '',
          suggestedFolder: targetFolder || 'Extraídos',
          videos: [item],
          selectedVideoIds: [item.id],
          sourceType: 'sub_album',
          scannedAt: Date.now()
        };
        const nextAlbums = [fallbackAlbum, ...videoAlbums];
        setWebScraperState({
          videoAlbums: nextAlbums,
          selectedAlbumIds: Array.from(new Set([...selectedAlbumIds, fallbackAlbum.id]))
        });
        openVideoAlbumInspector(fallbackAlbum);
      }
    } catch (_) {
    } finally {
      setScanningSubAlbumUrl(null);
    }
  };

  // Enter a Video Album to select which videos will be downloaded from that album
  const openVideoAlbumInspector = (album: VideoScraperAlbum) => {
    soundEffects.click(settings.soundEnabled);
    setInspectingAlbumId(album.id);
    setDraftAlbumSelectedIds(new Set(album.selectedVideoIds));
    setInspectorSearchQuery('');
    setInspectorSectionFilter('all');
  };

  // Confirm video selection for the inspected album and return to the Video Albums view
  const handleConfirmVideoAlbumSelection = () => {
    if (!inspectingAlbum) return;
    soundEffects.click(settings.soundEnabled);
    const selectedArr = Array.from(draftAlbumSelectedIds);
    const updatedAlbums = videoAlbums.map(a =>
      a.id === inspectingAlbum.id
        ? { ...a, selectedVideoIds: selectedArr }
        : a
    );
    const nextSelAlbums = new Set(selectedAlbumIds);
    if (selectedArr.length > 0) {
      nextSelAlbums.add(inspectingAlbum.id);
    } else {
      nextSelAlbums.delete(inspectingAlbum.id);
    }

    // Also sync flat selectedIds if this is the main album
    const allSelectedVideoIdsAcrossAlbums = Array.from(
      new Set(
        updatedAlbums
          .filter(a => nextSelAlbums.has(a.id))
          .flatMap(a => a.selectedVideoIds)
      )
    );

    setWebScraperState({
      videoAlbums: updatedAlbums,
      selectedAlbumIds: Array.from(nextSelAlbums),
      selectedIds: allSelectedVideoIdsAcrossAlbums.length > 0 ? allSelectedVideoIdsAcrossAlbums : selectedIds
    });
    setInspectingAlbumId(null);
  };

  const toggleSelectVideoAlbum = (albumId: string) => {
    const next = selectedAlbumIds.includes(albumId)
      ? selectedAlbumIds.filter(id => id !== albumId)
      : [...selectedAlbumIds, albumId];
    setWebScraperState({ selectedAlbumIds: next });
  };

  const handleRemoveVideoAlbum = (albumId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    soundEffects.trash(settings.soundEnabled);
    const updatedAlbums = videoAlbums.filter(a => a.id !== albumId);
    const updatedSelectedIds = selectedAlbumIds.filter(id => id !== albumId);
    if (inspectingAlbumId === albumId) {
      setInspectingAlbumId(null);
    }
    setWebScraperState({
      videoAlbums: updatedAlbums,
      selectedAlbumIds: updatedSelectedIds
    });
  };

  // Total videos selected across all currently selected Video Albums
  const selectedVideosFromSelectedAlbums = useMemo(() => {
    const map = new Map<string, ScannedVideoItem>();
    videoAlbums
      .filter(a => selectedAlbumIds.includes(a.id))
      .forEach(alb => {
        const selSet = new Set(alb.selectedVideoIds);
        alb.videos.forEach(v => {
          if (selSet.has(v.id)) {
            map.set(v.id, v);
          }
        });
      });
    return Array.from(map.values());
  }, [videoAlbums, selectedAlbumIds]);

  const handleDownloadSelectedVideoAlbums = () => {
    if (selectedVideosFromSelectedAlbums.length === 0 || isBatchSaving) return;
    const duplicates = selectedVideosFromSelectedAlbums.filter(v => isVideoSavedInGallery(v));
    const onlyNew = selectedVideosFromSelectedAlbums.filter(v => !isVideoSavedInGallery(v));

    if (duplicates.length > 0) {
      setDuplicateVideosList(duplicates);
      setOnlyNewVideosList(onlyNew);
      setShowDuplicateModal(true);
      return;
    }

    const prefilledFolder = targetFolder.trim();
    if (!prefilledFolder && settings.askFolderOnSave) {
      setFolderModalState({
        isOpen: true,
        mode: 'album_batch',
        customBatchVideos: selectedVideosFromSelectedAlbums
      });
    } else {
      executeBatchSave(
        selectedVideosFromSelectedAlbums,
        true,
        prefilledFolder || settings.defaultVideoFolder || 'Extraídos'
      );
    }
  };

  const handleDownloadSingleVideoAlbum = (album: VideoScraperAlbum, overrideSelectedIds?: string[]) => {
    const selSet = new Set(overrideSelectedIds || album.selectedVideoIds);
    const videosToDownload = album.videos.filter(v => selSet.has(v.id));
    if (videosToDownload.length === 0 || isBatchSaving) return;

    const prefilledFolder = targetFolder.trim() || (album.suggestedFolder || '').trim();
    if (!prefilledFolder && settings.askFolderOnSave) {
      setFolderModalState({
        isOpen: true,
        mode: 'album_batch',
        customBatchVideos: videosToDownload
      });
    } else {
      executeBatchSave(
        videosToDownload,
        true,
        prefilledFolder || settings.defaultVideoFolder || 'Extraídos'
      );
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = selectedIds.includes(id) ? selectedIds.filter(vId => vId !== id) : [...selectedIds, id];
    setWebScraperState({ selectedIds: next });
  };

  const handleSelectOnlyNew = () => {
    const newInTab = displayedVideos.filter(v => !isVideoSavedInGallery(v)).map(v => v.id);
    setWebScraperState({ selectedIds: newInTab });
  };

  const handleSelectAll = () => {
    if (displayedVideos.length === 0) return;
    if (isAllDisplayedSelected) {
      setWebScraperState({ selectedIds: selectedIds.filter(id => !displayedIds.includes(id)) });
    } else {
      const combined = Array.from(new Set([...selectedIds, ...displayedIds]));
      setWebScraperState({ selectedIds: combined });
    }
  };

  const handleBatchSave = () => {
    if (!scanResult || selectedIds.length === 0 || isBatchSaving) return;

    const selectedVideos = scanResult.videos.filter(v => selectedIds.includes(v.id));
    const duplicates = selectedVideos.filter(v => isVideoSavedInGallery(v));
    const onlyNew = selectedVideos.filter(v => !isVideoSavedInGallery(v));

    if (duplicates.length > 0) {
      setDuplicateVideosList(duplicates);
      setOnlyNewVideosList(onlyNew);
      setShowDuplicateModal(true);
      return;
    }

    const prefilledFolder = targetFolder.trim() || (scanResult.suggested_folder || '').trim();
    if (!prefilledFolder && settings.askFolderOnSave) {
      setFolderModalState({
        isOpen: true,
        mode: 'batch'
      });
    } else {
      executeBatchSave(selectedVideos, true, prefilledFolder || settings.defaultVideoFolder || 'Extraídos');
    }
  };

  const executeBatchSave = async (videosToSave: ScannedVideoItem[], skipExisting: boolean = true, customFolder?: string) => {
    if (videosToSave.length === 0) {
      setShowDuplicateModal(false);
      return;
    }
    const folderToUse = (customFolder || targetFolder).trim() || 'Extraídos';
    setIsBatchSaving(true);
    setShowDuplicateModal(false);
    soundEffects.click(settings.soundEnabled);

    try {
      const streamOnly = !saveLocally;
      const res = await backendApi.batchSaveVideos(videosToSave, folderToUse, 2, skipExisting, streamOnly);
      if (res.success) {
        // Marcação otimista imediata para cada vídeo salvo
        videosToSave.forEach(v => {
          markItemAsSavedOptimistically({
            url: v.url || v.stream_url,
            title: v.title,
            folder: folderToUse,
            targetId: v.id,
            targetView: 'videos'
          });
        });
        const saveIdSet = new Set(videosToSave.map(v => v.id));
        const updatedVideoAlbums = videoAlbums.map(alb => ({
          ...alb,
          videos: alb.videos.map(v => saveIdSet.has(v.id) ? { ...v, already_saved: true, saved_folder: folderToUse } : v)
        }));
        if (scanResult) {
          const updatedVideos = scanResult.videos.map(v => saveIdSet.has(v.id) ? { ...v, already_saved: true, saved_folder: folderToUse } : v);
          setWebScraperState({
            scanResult: {
              ...scanResult,
              videos: updatedVideos
            },
            videoAlbums: updatedVideoAlbums
          });
        } else {
          setWebScraperState({
            videoAlbums: updatedVideoAlbums
          });
        }

        addNotification({
          type: 'success',
          title: streamOnly ? t.streamQueuedTitle : t.backgroundDownloads,
          message: streamOnly
            ? t.streamQueuedMsg.replace('{count}', String(videosToSave.length)).replace('{folder}', folderToUse)
            : t.queueVideosMsg.replace('{count}', String(videosToSave.length)).replace('{folder}', folderToUse)
        });
        soundEffects.success(settings.soundEnabled);
        await syncJobs();
        triggerJobsPollingLoop();
        if (streamOnly) {
          setTimeout(() => syncVideos(), 1800);
          setTimeout(() => syncVideos(), 4500);
        }
      } else {
        addNotification({
          type: 'error',
          title: t.errorSaving,
          message: res.error || t.couldNotQueueVideos
        });
        soundEffects.trash(settings.soundEnabled);
      }
    } catch (err: any) {
      addNotification({
        type: 'error',
        title: t.connectionError,
        message: err.message || t.failedConnectServer
      });
      soundEffects.trash(settings.soundEnabled);
    } finally {
      setIsBatchSaving(false);
    }
  };

  const isVideoSaving = (item: ScannedVideoItem) => {
    return savingSingleId === item.id || jobs.some(j =>
      (j.status === 'active' || j.status === 'queued') &&
      (j.mode === 'video_save' || (j.mode as string) === 'video_downloader' || (j.mode as string) === 'video_stream_register') &&
      ((item.title && j.title.toLowerCase().includes(item.title.toLowerCase())) ||
       (item.url && j.url && j.url === item.url) ||
       (j.id && j.id.includes(item.id)))
    );
  };

  const handleInitiateSingleSave = (item: ScannedVideoItem) => {
    if (isVideoSaving(item)) return;
    const savedStatus = checkItemSavedStatus({
      url: item.url || item.stream_url,
      title: item.title,
      mediaType: 'video'
    });

    if (savedStatus.isSaved && !savedStatus.hasAlternativeResolution) {
      const proceed = window.confirm(
        t.alreadySavedConfirm.replace('{folder}', savedStatus.folder || '')
      );
      if (!proceed) return;
    }

    const prefilledFolder = targetFolder.trim() || (scanResult?.suggested_folder || '').trim();
    if (!prefilledFolder && settings.askFolderOnSave) {
      setFolderModalState({
        isOpen: true,
        mode: 'single',
        targetVideo: item
      });
    } else {
      handleSaveSingleVideo(item, prefilledFolder || settings.defaultVideoFolder || 'Extraídos');
    }
  };

  const handleSaveSingleVideo = async (item: ScannedVideoItem, customFolder?: string) => {
    if (isVideoSaving(item)) return;
    setSavingSingleId(item.id);
    const folderToUse = (customFolder || targetFolder).trim() || 'Extraídos';

    soundEffects.click(settings.soundEnabled);
    try {
      const streamOnly = !saveLocally;
      const res = await backendApi.batchSaveVideos([item], folderToUse, 2, true, streamOnly);
      if (res.success) {
        markItemAsSavedOptimistically({
          url: item.url || item.stream_url,
          title: item.title,
          folder: folderToUse,
          targetId: item.id,
          targetView: 'videos'
        });
        const updatedVideoAlbums = videoAlbums.map(alb => ({
          ...alb,
          videos: alb.videos.map(v => v.id === item.id ? { ...v, already_saved: true, saved_folder: folderToUse } : v)
        }));
        if (scanResult) {
          const updatedVideos = scanResult.videos.map(v => v.id === item.id ? { ...v, already_saved: true, saved_folder: folderToUse } : v);
          setWebScraperState({
            scanResult: {
              ...scanResult,
              videos: updatedVideos
            },
            videoAlbums: updatedVideoAlbums
          });
        } else {
          setWebScraperState({
            videoAlbums: updatedVideoAlbums
          });
        }

        addNotification({
          type: 'success',
          title: streamOnly ? t.streamQueuedTitle : t.savingVideoBackground,
          message: `"${item.title}" (${folderToUse})`
        });
        soundEffects.success(settings.soundEnabled);
        await syncJobs();
        triggerJobsPollingLoop();
        if (streamOnly) {
          setTimeout(() => syncVideos(), 1800);
          setTimeout(() => syncVideos(), 4000);
        }
      } else {
        addNotification({
          type: 'error',
          title: t.errorSaving,
          message: res.error || t.couldNotQueueVideo
        });
        soundEffects.trash(settings.soundEnabled);
      }
    } catch (err: any) {
      addNotification({
        type: 'error',
        title: t.connectionError,
        message: err.message || t.failedConnectServer
      });
      soundEffects.trash(settings.soundEnabled);
    } finally {
      setTimeout(() => setSavingSingleId(null), 2000);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-6 min-w-0 max-w-full">
      {/* Hero Header Card */}
      <div className="p-6 rounded-3xl glass-panel-elevated border border-border flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/40 shrink-0">
              {t.badgeTag}
            </span>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30">
              {t.badgeMode}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-100 flex items-center gap-2.5 tracking-tight">
            <IconBadge icon={<Film size={20} />} variant="rose" size="md" />
            {t.title}
          </h1>
          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
            {t.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {(scanResult || videoAlbums.length > 0) && (
            <button
              onClick={() => {
                clearWebScraperState();
                soundEffects.click(settings.soundEnabled);
              }}
              className="px-3.5 py-2 rounded-xl bg-surface-elevated hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-border hover:border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              title={t.clearTitle}
            >
              <RotateCcw size={14} />
              <span>{t.clearBtn}</span>
            </button>
          )}
          <button
            onClick={() => navigateToView('job-history')}
            className="px-3.5 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title={t.taskMgmtTitle}
          >
            <Layers size={14} className="text-brand-400" />
            <span>{t.taskMgmt}</span>
          </button>
          <button
            onClick={() => navigateToView('videos')}
            className="px-3.5 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title={t.videoGalleryTitle}
          >
            <Folder size={14} />
            <span>{t.videoGallery}</span>
          </button>
        </div>
      </div>

      {/* Input URL Section */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5 md:col-span-5 lg:col-span-5 space-y-1.5">
            <div className="h-5 flex items-center">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider truncate">
                {t.urlLabel}
              </label>
            </div>
            <input
              type="url"
              value={url}
              onChange={e => handleUrlChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleScanPage(false)}
              placeholder={t.urlPlaceholder}
              className="w-full h-12 bg-surface-elevated border border-border focus:border-violet-500 text-slate-100 text-xs sm:text-sm rounded-2xl px-4 outline-none transition-colors shadow-inner"
            />
          </div>
          <div className="sm:col-span-2 md:col-span-2 lg:col-span-2 space-y-1.5">
            <div className="h-5 flex items-center">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider truncate whitespace-nowrap" title={t.limitTitle}>
                {t.limitLabel}
              </label>
            </div>
            <input
              type="number"
              min="0"
              max="5000"
              value={limit === '' ? '' : limit}
              onChange={e => setLimit(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={t.limitPlaceholder || (isEn ? 'All (unlimited)' : 'Todos (sem limite)')}
              title={t.limitTitle || (isEn ? "Leave empty to fetch all videos from page and next pages" : "Deixe vazio para buscar todos os vídeos da página e das próximas")}
              className="w-full h-12 bg-surface-elevated border border-border focus:border-violet-500 text-slate-100 text-xs sm:text-sm rounded-2xl px-3 outline-none transition-colors shadow-inner text-center font-medium"
            />
          </div>
          <div className="sm:col-span-2 md:col-span-2 lg:col-span-2 space-y-1.5">
            <div className="h-5 flex items-center">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider truncate whitespace-nowrap" title={t.maxPagesTitle || (isEn ? "Max pages to seek (leave empty to scan all next pages)" : "Máximo de páginas para carregar (deixe vazio para todas)")}>
                {t.maxPagesLabel || (isEn ? "Max Pages:" : "Máx. Páginas:")}
              </label>
            </div>
            <input
              type="number"
              min="1"
              max="100"
              value={maxPages === '' ? '' : maxPages}
              onChange={e => setMaxPages(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={t.maxPagesPlaceholder || (isEn ? 'All (auto)' : 'Todas (auto)')}
              title={t.maxPagesTitle || (isEn ? "Scan all next pages of playlist/category (or enter a page limit e.g. 5)" : "Carregar todas as páginas da playlist/categoria (ou defina um limite, ex: 5)")}
              className="w-full h-12 bg-surface-elevated border border-border focus:border-violet-500 text-slate-100 text-xs sm:text-sm rounded-2xl px-3 outline-none transition-colors shadow-inner text-center font-medium"
            />
          </div>
          <div className="sm:col-span-3 md:col-span-3 lg:col-span-3 flex items-center gap-2">
            <button
              onClick={() => handleScanPage(false)}
              disabled={isScanning || !url.trim()}
              className="flex-1 h-12 px-4 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {isScanning ? (
                <>
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <span className="truncate">{scanProgressInfo ? `${t.scanningBtn.replace('...', '')} (${scanProgressInfo})` : t.scanningBtn}</span>
                </>
              ) : (
                <>
                  <Search size={16} className="shrink-0" />
                  <span className="truncate">{t.scanBtn}</span>
                </>
              )}
            </button>

            {isScanning && (
              <button
                type="button"
                onClick={() => {
                  if (scanAbortControllerRef.current) {
                    scanAbortControllerRef.current.abort();
                  }
                  setIsScanning(false);
                  setScanProgressInfo(null);
                }}
                className="h-12 px-3 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                title={isEn ? "Stop scanning and keep discovered videos" : "Parar busca e manter vídeos carregados"}
              >
                <X size={15} />
                <span className="hidden xl:inline">{isEn ? 'Stop' : 'Parar'}</span>
              </button>
            )}

            {videoAlbums.length > 0 && (
              <button
                type="button"
                onClick={() => handleScanPage(true)}
                disabled={isScanning || !url.trim()}
                className="h-12 px-3.5 rounded-2xl bg-surface-elevated hover:bg-violet-500/20 text-violet-300 border border-violet-500/40 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer disabled:opacity-50"
                title={isEn ? 'Scan URL and add as another Video Album to your selection' : 'Escanear URL e adicionar como mais um Álbum de Vídeos na seleção'}
              >
                <FolderPlus size={15} />
                <span className="hidden xl:inline">{isEn ? '+ Add Album' : '+ Álbum'}</span>
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Scanned Results Toolbar & Actions */}
      {(scanResult || videoAlbums.length > 0) && (
        <div className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Folder Destination & Suggestion */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-slate-400">
                {t.saveFolder}
              </span>
              <div className="relative flex items-center gap-1.5">
                <input
                  type="text"
                  value={targetFolder}
                  onChange={e => setWebScraperState({ targetFolder: e.target.value })}
                  placeholder={t.folderPlaceholder}
                  className="bg-surface-elevated border border-border focus:border-brand-500 text-slate-100 text-xs font-bold rounded-xl px-3 py-1.5 outline-none w-48"
                />
                {videoFolders.length > 0 && (
                  <select
                    onChange={e => e.target.value && setWebScraperState({ targetFolder: e.target.value })}
                    value=""
                    className="bg-surface-elevated border border-border text-slate-300 text-xs rounded-xl px-2 py-1.5 outline-none cursor-pointer"
                    title={t.chooseExistingFolder}
                  >
                    <option value="" disabled>{t.existingFolders}</option>
                    {videoFolders.map(f => (
                      <option key={f.id} value={f.name}>{f.name} ({f.videoCount})</option>
                    ))}
                  </select>
                )}
              </div>

              {/* View Mode Switcher: Video Albums vs Flat Video Grid */}
              <div className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-border text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setWebScraperState({ viewLayout: 'albums' })}
                  className={`px-3 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    viewLayout === 'albums'
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers size={13} />
                  <span>{isEn ? `Video Albums (${videoAlbums.length})` : `Álbuns de Vídeos (${videoAlbums.length})`}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWebScraperState({ viewLayout: 'videos' })}
                  className={`px-3 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    viewLayout === 'videos'
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LayoutGrid size={13} />
                  <span>{isEn ? `All Videos Grid (${allVideos.length})` : `Grade de Vídeos (${allVideos.length})`}</span>
                </button>
              </div>

              {/* Storage Mode Switcher: Web Stream (0 MB default) vs Local Data Download */}
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/90 p-1.5 rounded-xl border border-border text-xs font-bold">
                <span className="text-[10px] font-mono uppercase text-slate-400 px-2">
                  {t.saveModeLabel}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setWebScraperState({ saveLocally: false });
                    soundEffects.click(settings.soundEnabled);
                  }}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    !saveLocally
                      ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/50'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border border-slate-700/70'
                  }`}
                  title={t.modeStreamFastTitle}
                >
                  <Sparkles size={13} />
                  <span>{t.modeStreamFast}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWebScraperState({ saveLocally: true });
                    soundEffects.click(settings.soundEnabled);
                  }}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                    saveLocally
                      ? 'bg-violet-600 text-white shadow-sm ring-1 ring-violet-400/50'
                      : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700 border border-slate-700/70'
                  }`}
                  title={t.modeLocalDataTitle}
                >
                  <Download size={13} />
                  <span>{t.modeLocalData}</span>
                </button>
              </div>
            </div>

            {/* Selection & Batch Download Buttons (Context-aware for Albums Mode vs Videos Mode) */}
            {viewLayout === 'albums' ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedAlbumIds.length === videoAlbums.length) {
                      setWebScraperState({ selectedAlbumIds: [] });
                    } else {
                      setWebScraperState({ selectedAlbumIds: videoAlbums.map(a => a.id) });
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {selectedAlbumIds.length === videoAlbums.length && videoAlbums.length > 0 ? (
                    <>
                      <CheckSquare size={13} className="text-brand-400" />
                      <span>{t.deselectAll} ({videoAlbums.length})</span>
                    </>
                  ) : (
                    <>
                      <Square size={13} />
                      <span>{t.selectAll} ({videoAlbums.length})</span>
                    </>
                  )}
                </button>

                <span className="text-xs font-mono font-bold text-violet-300 px-2.5 py-1 rounded bg-violet-950/60 border border-violet-500/30">
                  {selectedAlbumIds.length} {isEn ? 'albums' : 'álbuns'} • {selectedVideosFromSelectedAlbums.length} {isEn ? 'videos' : 'vídeos'}
                </span>

                <button
                  type="button"
                  onClick={handleDownloadSelectedVideoAlbums}
                  disabled={selectedVideosFromSelectedAlbums.length === 0 || isBatchSaving}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-violet-600/30 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {isBatchSaving ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>{t.queuing}</span>
                    </>
                  ) : (
                    <>
                      <Save size={13} />
                      <span>
                        {t.saveSelectedVideosBtn.replace('{count}', String(selectedVideosFromSelectedAlbums.length))}
                      </span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {newDisplayedVideos.length > 0 && (
                  <button
                    onClick={handleSelectOnlyNew}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                    title={t.selectOnlyNewTitle}
                  >
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span>{t.selectOnlyNew} ({newDisplayedVideos.length})</span>
                  </button>
                )}

                <button
                  onClick={handleSelectAll}
                  className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  {isAllDisplayedSelected ? (
                    <>
                      <CheckSquare size={13} className="text-brand-400" />
                      <span>{t.deselectAll} ({displayedVideos.length})</span>
                    </>
                  ) : (
                    <>
                      <Square size={13} />
                      <span>{t.selectAll} ({displayedVideos.length})</span>
                    </>
                  )}
                </button>

                <span className="text-xs font-mono font-bold text-violet-300 px-2.5 py-1 rounded bg-violet-950/60 border border-violet-500/30">
                  {selectedIds.length} {t.selected}
                </span>

                <button
                  onClick={handleBatchSave}
                  disabled={selectedIds.length === 0 || isBatchSaving}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-violet-600/30 disabled:opacity-50 transition-all"
                >
                  {isBatchSaving ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>{t.queuing}</span>
                    </>
                  ) : (
                    <>
                      <Save size={13} />
                      <span>{saveLocally ? t.downloadSelected : t.saveSelectedBtn} ({selectedIds.length})</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Segmented Section Filter Tabs (when in flat videos layout) */}
          {viewLayout === 'videos' && scanResult && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/40">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setWebScraperState({ activeTab: 'main' });
                    soundEffects.click(settings.soundEnabled);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                    activeTab === 'main'
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-violet-600/30 ring-1 ring-violet-400/40'
                      : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
                  }`}
                >
                  <Film size={13} className={activeTab === 'main' ? 'text-white' : 'text-violet-400'} />
                  <span>{t.mainVideos} ({mainVideos.length})</span>
                </button>

                {recommendedVideos.length > 0 && (
                  <button
                    onClick={() => {
                      setWebScraperState({ activeTab: 'recommended' });
                      soundEffects.click(settings.soundEnabled);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                      activeTab === 'recommended'
                        ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-amber-600/30 ring-1 ring-amber-400/40'
                        : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
                    }`}
                  >
                    <Sparkles size={13} className={activeTab === 'recommended' ? 'text-white' : 'text-amber-400'} />
                    <span>{t.recommendedVideos} ({recommendedVideos.length})</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setWebScraperState({ activeTab: 'all' });
                    soundEffects.click(settings.soundEnabled);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                    activeTab === 'all'
                      ? 'bg-slate-700 text-white shadow-slate-700/30 ring-1 ring-slate-400/30'
                      : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
                  }`}
                >
                  <span>{t.allVideos} ({allVideos.length})</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400 font-medium">
                {scanResult.pages_scanned && scanResult.pages_scanned > 1 && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-500/50 text-indigo-300 font-bold flex items-center gap-1 shadow-sm">
                    <Layers size={11} className="text-indigo-400" />
                    <span>{t.pagesScannedBadge ? t.pagesScannedBadge.replace('{count}', String(scanResult.pages_scanned)) : `${scanResult.pages_scanned} ${isEn ? 'pages scanned' : 'páginas escaneadas'}`}</span>
                  </span>
                )}
                {totalSavedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-bold flex items-center gap-1 shadow-sm">
                    <Check size={11} className="text-emerald-400" />
                    <span>{totalSavedCount} {t.savedCount}</span>
                  </span>
                )}
                {totalNewCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-violet-950/80 border border-violet-500/40 text-violet-300 font-bold">
                    {totalNewCount} {t.newCount}
                  </span>
                )}
                <span>
                  {t.displaying} <span className="font-bold text-slate-200">{displayedVideos.length}</span> {activeTab === 'main' ? t.mainOf : activeTab === 'recommended' ? t.recommendedOf : t.ofTotal}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW MODE 1: VIDEO ALBUMS / COLLECTIONS (Enter album -> select videos -> return & download selected) */}
      {viewLayout === 'albums' && videoAlbums.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videoAlbums.map((vAlbum) => {
            const isAlbumSelected = selectedAlbumIds.includes(vAlbum.id);
            const selectedCount = vAlbum.selectedVideoIds.length;
            const totalCount = vAlbum.videos.length;
            const isCustomSubset = selectedCount > 0 && selectedCount < totalCount;
            const savedInAlbumCount = vAlbum.videos.filter(v => isVideoSavedInGallery(v)).length;
            const previewThumbs = vAlbum.videos.slice(0, 4).map(v => v.thumbnail_url).filter(Boolean);

            return (
              <div
                key={vAlbum.id}
                className={`bg-surface-elevated border rounded-2xl p-4 flex flex-col justify-between transition-all group shadow-md relative ${
                  isAlbumSelected
                    ? 'border-violet-500 bg-violet-950/20 shadow-glow-brand ring-1 ring-violet-500/30'
                    : 'border-border hover:border-violet-500/40'
                }`}
              >
                <div className="space-y-3">
                  {/* Album Mosaic / Cover Preview */}
                  <div
                    onClick={() => openVideoAlbumInspector(vAlbum)}
                    className="aspect-video w-full rounded-xl overflow-hidden bg-slate-950/90 border border-border relative cursor-pointer group/thumb"
                    title={isEn ? 'Click to open album and select which videos to download' : 'Clique para entrar no álbum e escolher quais vídeos baixar'}
                  >
                    {/* Checkbox to select/deselect entire Video Album */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectVideoAlbum(vAlbum.id);
                      }}
                      className={`absolute top-2.5 left-2.5 z-20 p-1.5 rounded-lg backdrop-blur-md transition-all border ${
                        isAlbumSelected
                          ? 'bg-violet-600 text-white border-violet-400 shadow-md'
                          : 'bg-black/60 text-white/70 hover:text-white hover:bg-black/90 border-white/20'
                      }`}
                    >
                      {isAlbumSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>

                    {/* Mosaic of up to 4 video thumbnails */}
                    {previewThumbs.length >= 4 ? (
                      <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-0.5 bg-slate-900">
                        {previewThumbs.slice(0, 4).map((thumb, idx) => (
                          <img
                            key={idx}
                            src={thumb}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-300"
                          />
                        ))}
                      </div>
                    ) : vAlbum.thumbnailUrl ? (
                      <img
                        src={vAlbum.thumbnailUrl}
                        alt={vAlbum.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-1">
                        <Film className="w-8 h-8 opacity-50" />
                      </div>
                    )}

                    {/* Badge: Source Type */}
                    <div className="absolute top-2.5 right-2.5 z-10">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border backdrop-blur-md ${
                          vAlbum.sourceType === 'recommended'
                            ? 'bg-amber-950/90 text-amber-300 border-amber-500/40'
                            : vAlbum.sourceType === 'sub_album'
                            ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/40'
                            : 'bg-violet-950/90 text-violet-300 border-violet-500/40'
                        }`}
                      >
                        {vAlbum.sourceType === 'recommended'
                          ? t.badgeRecommended
                          : vAlbum.sourceType === 'sub_album'
                          ? (isEn ? 'Inspected Page' : 'Página Inspecionada')
                          : t.badgePrimary}
                      </span>
                    </div>

                    {/* Bottom Overlay Pill: Open & Select Videos */}
                    <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-between">
                      <span className="px-2.5 py-1 rounded-lg bg-violet-600/90 hover:bg-violet-500 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-lg">
                        <Eye className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Open & Select Videos' : 'Abrir & Selecionar Vídeos'}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-black/80 text-slate-200 font-mono text-[10px] font-bold border border-white/10">
                        {totalCount} {isEn ? 'videos' : 'vídeos'}
                      </span>
                    </div>
                  </div>

                  {/* Title & Subset Selection Status */}
                  <div className="space-y-1.5">
                    <h3
                      onClick={() => openVideoAlbumInspector(vAlbum)}
                      className="font-bold text-slate-100 hover:text-violet-300 text-sm line-clamp-2 cursor-pointer transition-colors"
                      title={vAlbum.title}
                    >
                      {vAlbum.title}
                    </h3>

                    {/* Subset selection indicator */}
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-violet-950/50 border border-violet-500/30 text-[11px] font-semibold text-violet-200">
                      <button
                        type="button"
                        onClick={() => openVideoAlbumInspector(vAlbum)}
                        className="flex items-center gap-1.5 hover:underline truncate cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>
                          {isEn
                            ? `${selectedCount} of ${totalCount} videos selected`
                            : `${selectedCount} de ${totalCount} vídeos selecionados`}
                        </span>
                      </button>
                      {isCustomSubset && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = videoAlbums.map(a =>
                              a.id === vAlbum.id ? { ...a, selectedVideoIds: a.videos.map(v => v.id) } : a
                            );
                            setWebScraperState({ videoAlbums: updated });
                          }}
                          className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-black/40"
                          title={isEn ? 'Select all videos in this album' : 'Selecionar todos os vídeos deste álbum'}
                        >
                          {isEn ? 'All' : 'Todos'}
                        </button>
                      )}
                    </div>

                    {savedInAlbumCount > 0 && (
                      <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                        <Check size={11} />
                        <span>
                          {savedInAlbumCount} {isEn ? 'already saved in gallery' : 'já salvos na galeria'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => openVideoAlbumInspector(vAlbum)}
                    className="flex-1 py-2 px-3 rounded-xl bg-surface hover:bg-violet-500/20 text-slate-200 hover:text-violet-200 border border-border hover:border-violet-500/40 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-violet-400" />
                    <span>{isEn ? 'Select Videos' : 'Escolher Vídeos'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedCount === 0 || isBatchSaving}
                    onClick={() => handleDownloadSingleVideoAlbum(vAlbum)}
                    className="flex-1 py-2 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>
                      {isEn ? `Save (${selectedCount})` : `Baixar (${selectedCount})`}
                    </span>
                  </button>

                  {videoAlbums.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => handleRemoveVideoAlbum(vAlbum.id, e)}
                      className="p-2 rounded-xl bg-surface hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-border hover:border-rose-500/40 transition-all cursor-pointer"
                      title={isEn ? 'Remove this video album from list' : 'Remover este álbum de vídeos da lista'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: FLAT VIDEOS GRID */}
      {(viewLayout === 'videos' || videoAlbums.length === 0) && scanResult && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {visibleVideos.map((item, idx) => {
            const isSelected = selectedSet.has(item.id);
            const isSaved = isVideoSavedInGallery(item);
            const savedStatus = isSaved ? checkItemSavedStatus({
              url: item.url || item.stream_url,
              title: item.title,
              mediaType: 'video',
              height: item.height || (item.resolution && parseInt(item.resolution)) || undefined
            }) : { isSaved: false };
            const isSaving = isVideoSaving(item);
            const isPlaying = playingVideoId === item.id;
            const itemFingerprint = getCanonicalMediaFingerprint(item.title, item.url || item.stream_url, item.height);
            const isInPageDuplicate = Boolean(itemFingerprint && (inPageDuplicateMap.get(itemFingerprint) || 0) > 1);

            return (
              <div
                key={item.id}
                onClick={() => handleToggleSelect(item.id)}
                style={{
                  contentVisibility: 'auto',
                  containIntrinsicSize: 'auto 320px',
                }}
                className={`group relative glass-panel rounded-2xl border overflow-hidden cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                  isSelected
                    ? 'border-violet-500 ring-2 ring-violet-500/40 shadow-glow-brand bg-surface-elevated'
                    : isSaved
                    ? 'border-emerald-500/40 bg-emerald-950/15 hover:border-emerald-400/60'
                    : 'border-border hover:border-violet-500/40'
                }`}
              >
                {/* Thumbnail / Video Preview Area */}
                <div className="relative aspect-video bg-black overflow-hidden">
                  {isPlaying ? (
                    <div
                      className="w-full h-full relative"
                      onClick={e => e.stopPropagation()}
                    >
                      <video
                        src={getProxiedStreamUrl(item.stream_url || item.url, item.url)}
                        controls
                        autoPlay
                        playsInline
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <img
                      src={item.thumbnail_url}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={e => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}

                  {/* Top-Left Selection Checkbox */}
                  <div
                    onClick={e => {
                      e.stopPropagation();
                      handleToggleSelect(item.id);
                    }}
                    className="absolute top-2.5 left-2.5 z-10"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="w-4 h-4 rounded text-violet-500 cursor-pointer"
                    />
                  </div>

                  {/* Section Badge (Salvo / Recomendado / Principal) */}
                  {isSaved ? (
                    <div className="absolute top-2.5 left-8 z-10">
                      <SavedRedirectBadge savedInfo={savedStatus} />
                    </div>
                  ) : item.is_primary === false || item.section === 'recommended' ? (
                    <span className="absolute top-2.5 left-8 z-10 px-2 py-0.5 rounded-full bg-amber-950/90 backdrop-blur-md border border-amber-500/50 text-[9px] font-bold text-amber-300 flex items-center gap-1 shadow-sm">
                      <Sparkles size={9} /> {t.badgeRecommended}
                    </span>
                  ) : activeTab === 'all' ? (
                    <span className="absolute top-2.5 left-8 z-10 px-2 py-0.5 rounded-full bg-violet-950/90 backdrop-blur-md border border-violet-500/50 text-[9px] font-bold text-violet-300 flex items-center gap-1 shadow-sm">
                      <Film size={9} /> {t.badgePrimary}
                    </span>
                  ) : null}

                  {/* Duplicado na Página Badge */}
                  {isInPageDuplicate && !isSaved && (
                    <span
                      className="absolute top-2.5 right-20 z-10 px-2 py-0.5 rounded-full bg-amber-500/90 text-slate-950 font-bold text-[9px] shadow-sm flex items-center gap-1 backdrop-blur-md"
                      title={t.badgeDuplicateOnPageTitle}
                    >
                      <Copy size={9} />
                      <span>{t.badgeDuplicateOnPage}</span>
                    </span>
                  )}

                  {/* Duration Badge */}
                  {item.duration && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-[10px] font-mono font-bold text-slate-200 border border-white/10">
                      {item.duration}
                    </span>
                  )}

                  {/* Quality Badge */}
                  <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-violet-950/80 backdrop-blur-md border border-violet-500/40 text-[9px] font-mono font-bold text-violet-200">
                    {item.quality_hint || '1080p HD'}
                  </span>

                  {/* Page Found Badge */}
                  {item.page_found && item.page_found > 1 && (
                    <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-indigo-950/90 backdrop-blur-md text-[9px] font-mono font-bold text-indigo-300 border border-indigo-500/40">
                      P.{item.page_found}
                    </span>
                  )}
                </div>

                {/* Card Info and Buttons */}
                <div className="p-3 space-y-2 flex-1 flex flex-col justify-between">
                  <h3 className="text-xs font-bold text-slate-200 line-clamp-2" title={item.title}>
                    {item.title}
                  </h3>

                  <div className="flex items-center justify-between pt-1 border-t border-border/50 text-slate-400 text-xs">
                    <span className="text-[10px] font-mono text-slate-500">
                      #{idx + 1}
                    </span>

                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      {/* Inspect video target page as a Video Album */}
                      {item.url && (
                        <button
                          type="button"
                          onClick={(e) => handleInspectVideoPageAsAlbum(item, e)}
                          disabled={scanningSubAlbumUrl === item.url}
                          className="p-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 transition-colors shadow-sm"
                          title={isEn ? 'Open this video page as an Album to select videos' : 'Abrir página deste vídeo como Álbum para selecionar vídeos'}
                        >
                          {scanningSubAlbumUrl === item.url ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Layers size={13} />
                          )}
                        </button>
                      )}

                      {/* Individual Save Button */}
                      <button
                        onClick={() => handleInitiateSingleSave(item)}
                        disabled={isSaving}
                        className={`p-1.5 rounded-lg border transition-colors shadow-sm disabled:opacity-80 flex items-center gap-1 text-[11px] font-bold ${
                          isSaving
                            ? 'bg-violet-900/90 text-violet-200 border-violet-500/60'
                            : isSaved
                            ? 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border-emerald-500/40 px-2'
                            : 'bg-violet-900/90 hover:bg-violet-800 text-violet-200 hover:text-white border border-violet-500/40'
                        }`}
                        title={
                          isSaving
                            ? t.savingInBackground
                            : isSaved
                            ? t.savedInFolderTooltip.replace('{folder}', (savedStatus as any).folder || '')
                            : t.saveToGalleryTooltip.replace('{folder}', targetFolder)
                        }
                      >
                        {isSaving ? (
                          <Loader2 size={13} className="animate-spin text-violet-300" />
                        ) : isSaved ? (
                          <>
                            <Check size={12} className="text-emerald-400" />
                            <span>{t.savedVideo}</span>
                          </>
                        ) : (
                          <Save size={13} />
                        )}
                      </button>

                      {/* Direct Browser Download */}
                      <button
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = `/api/proxy-video-stream?url=${encodeURIComponent(item.stream_url || item.url)}&download=true&filename=${encodeURIComponent(item.title)}`;
                          link.download = `${item.title}.mp4`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className="p-1.5 rounded-lg bg-black/60 hover:bg-black text-slate-300 hover:text-white border border-white/10 transition-colors shadow-sm"
                        title={t.downloadDirectMp4}
                      >
                        <Download size={13} />
                      </button>

                      {/* Link to source */}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg bg-black/60 hover:bg-black text-slate-400 hover:text-slate-200 border border-white/10 transition-colors shadow-sm"
                        title={t.openOriginalPage}
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Progressive Scroll Sentinel and Load More for Flat Video Grid */}
          {displayedVideos.length > visibleCount && (
            <div
              ref={loadMoreSentinelRef}
              className="col-span-full py-8 flex flex-col items-center justify-center gap-3 border border-dashed border-border/60 rounded-2xl bg-surface/30 mt-2"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {isEn
                    ? `Showing ${visibleVideos.length} of ${displayedVideos.length} videos...`
                    : `Exibindo ${visibleVideos.length} de ${displayedVideos.length} vídeos...`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setVisibleCount(prev => prev + 48)}
                className="px-4 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-bold transition-all cursor-pointer shadow-sm hover:border-violet-500/40"
              >
                {isEn
                  ? `Load Next 48 (${displayedVideos.length - visibleVideos.length} remaining)`
                  : `Carregar Mais 48 (${displayedVideos.length - visibleVideos.length} restantes)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal de Inspeção do Álbum de Vídeos (Entrar no Álbum -> Selecionar Vídeos -> Voltar aos Álbuns) */}
      {inspectingAlbum && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex flex-col p-2 sm:p-5 overflow-hidden animate-in fade-in duration-200"
            onClick={handleConfirmVideoAlbumSelection}
          >
            <div
              className="relative w-full max-w-7xl mx-auto flex-1 flex flex-col bg-slate-900/95 border border-border rounded-3xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 sm:p-5 border-b border-border bg-slate-950/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={handleConfirmVideoAlbumSelection}
                    className="px-3 py-2 rounded-xl bg-surface-elevated hover:bg-violet-600/20 text-slate-200 hover:text-violet-300 border border-border hover:border-violet-500/40 text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>{isEn ? 'Back to Video Albums' : 'Voltar aos Álbuns'}</span>
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-violet-500/20 text-violet-300 border border-violet-500/40">
                        {isEn ? 'VIDEO ALBUM SELECTOR' : 'SELETOR DE VÍDEOS DO ÁLBUM'}
                      </span>
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        {draftAlbumSelectedIds.size} / {inspectingAlbum.videos.length} {isEn ? 'selected' : 'selecionados'}
                      </span>
                    </div>
                    <h2 className="text-sm sm:text-base font-black text-white truncate mt-1" title={inspectingAlbum.title}>
                      {inspectingAlbum.title}
                    </h2>
                    <p className="text-[11px] text-slate-400 font-mono truncate">{inspectingAlbum.url}</p>
                  </div>
                </div>

                {/* Selection & Filter Controls inside Album */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search input inside Album */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={inspectorSearchQuery}
                      onChange={(e) => setInspectorSearchQuery(e.target.value)}
                      placeholder={isEn ? 'Filter videos...' : 'Filtrar vídeos...'}
                      className="pl-8 pr-2.5 py-1.5 rounded-xl bg-slate-950 border border-border text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 w-36 sm:w-44"
                    />
                  </div>

                  {/* Quick Filter Pills: All / Only New / HD */}
                  <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-border text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setInspectorSectionFilter('all')}
                      className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                        inspectorSectionFilter === 'all' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {isEn ? 'All' : 'Todos'} ({inspectingAlbum.videos.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectorSectionFilter('new')}
                      className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                        inspectorSectionFilter === 'new' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {isEn ? 'New' : 'Novos'} ({inspectingAlbum.videos.filter(v => !isVideoSavedInGallery(v)).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectorSectionFilter('hd')}
                      className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                        inspectorSectionFilter === 'hd' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      HD
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const onlyNewIds = inspectingAlbum.videos
                        .filter(v => !isVideoSavedInGallery(v))
                        .map(v => v.id);
                      setDraftAlbumSelectedIds(new Set(onlyNewIds));
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t.selectOnlyNew}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDraftAlbumSelectedIds(new Set(inspectingAlbum.videos.map(v => v.id)))}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-violet-400" />
                    <span>{t.selectAll}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDraftAlbumSelectedIds(new Set())}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.deselectAll}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set<string>();
                      inspectingAlbum.videos.forEach(v => {
                        if (!draftAlbumSelectedIds.has(v.id)) next.add(v.id);
                      });
                      setDraftAlbumSelectedIds(next);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Filter className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isEn ? 'Invert' : 'Inverter'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleConfirmVideoAlbumSelection}
                    className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Videos Grid inside Album Inspector */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {visibleInspectorVideos.map((vItem, idx) => {
                    const isVidSelected = draftAlbumSelectedIds.has(vItem.id);
                    const isPlaying = playingVideoId === vItem.id;
                    const isSaving = isVideoSaving(vItem);
                    const isSaved = isVideoSavedInGallery(vItem);
                    const savedStatus = isSaved ? checkItemSavedStatus({
                      url: vItem.url || vItem.stream_url,
                      title: vItem.title,
                      mediaType: 'video'
                    }) : { isSaved: false };

                    return (
                      <div
                        key={vItem.id}
                        onClick={() => {
                          const next = new Set(draftAlbumSelectedIds);
                          if (next.has(vItem.id)) next.delete(vItem.id);
                          else next.add(vItem.id);
                          setDraftAlbumSelectedIds(next);
                        }}
                        style={{
                          contentVisibility: 'auto',
                          containIntrinsicSize: 'auto 320px',
                        }}
                        className={`group relative rounded-2xl border-2 overflow-hidden cursor-pointer transition-all flex flex-col justify-between bg-slate-950 ${
                            isVidSelected
                              ? 'border-violet-500 ring-2 ring-violet-500/30 shadow-lg'
                              : 'border-slate-800/80 opacity-65 hover:opacity-95 hover:border-slate-600'
                          }`}
                        >
                          <div className="relative aspect-video bg-black overflow-hidden">
                            {isPlaying ? (
                              <div className="w-full h-full" onClick={e => e.stopPropagation()}>
                                <video
                                  src={getProxiedStreamUrl(vItem.stream_url || vItem.url, vItem.url)}
                                  controls
                                  autoPlay
                                  playsInline
                                  className="w-full h-full object-contain"
                                />
                              </div>
                            ) : (
                              <img
                                src={vItem.thumbnail_url}
                                alt={vItem.title}
                                loading="lazy"
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            )}

                            {/* Checkbox badge */}
                            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all shadow ${
                                  isVidSelected
                                    ? 'bg-violet-600 border-violet-300 text-white'
                                    : 'bg-black/70 border-white/25 text-white/70'
                                }`}
                              >
                                {isVidSelected ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <span className="text-[10px] font-mono">{idx + 1}</span>}
                              </span>
                              {savedStatus.isSaved && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-600/90 text-white text-[9px] font-bold">
                                  {t.savedVideo}
                                </span>
                              )}
                            </div>

                            {/* Quality Badge */}
                            <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-violet-950/80 backdrop-blur-md border border-violet-500/40 text-[9px] font-mono font-bold text-violet-200">
                              {vItem.quality_hint || '1080p HD'}
                            </span>

                            {/* Page Found Badge */}
                            {vItem.page_found && vItem.page_found > 1 && (
                              <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-indigo-950/90 backdrop-blur-md text-[9px] font-mono font-bold text-indigo-300 border border-indigo-500/40">
                                P.{vItem.page_found}
                              </span>
                            )}

                            {/* Play Preview Toggle Button */}
                            {vItem.stream_url && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPlayingVideoId(isPlaying ? null : vItem.id);
                                }}
                                className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/80 hover:bg-violet-600 text-white text-[10px] font-bold flex items-center gap-1 border border-white/15 z-10"
                              >
                                {isPlaying ? <Pause size={11} /> : <Play size={11} />}
                                <span>{isPlaying ? t.pauseVideo : t.playVideo}</span>
                              </button>
                            )}

                            {vItem.duration && (
                              <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono font-bold text-slate-200">
                                {vItem.duration}
                              </span>
                            )}
                          </div>

                          <div className="p-3 flex items-center justify-between gap-2">
                            <h4 className="text-xs font-bold text-slate-200 line-clamp-2 flex-1" title={vItem.title}>
                              {vItem.title}
                            </h4>
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {vItem.url && (
                                <button
                                  type="button"
                                  onClick={(e) => handleInspectVideoPageAsAlbum(vItem, e)}
                                  disabled={scanningSubAlbumUrl === vItem.url}
                                  className="p-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 transition-colors"
                                  title={isEn ? 'Inspect this video page as a sub-album' : 'Inspecionar página deste vídeo como sub-álbum'}
                                >
                                  {scanningSubAlbumUrl === vItem.url ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Layers size={12} />
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleInitiateSingleSave(vItem)}
                                disabled={isSaving}
                                className="p-1.5 rounded-lg bg-violet-900/80 hover:bg-violet-700 text-violet-200 hover:text-white border border-violet-500/40 transition-colors"
                                title={isEn ? 'Save only this video now' : 'Salvar apenas este vídeo agora'}
                              >
                                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  {/* Progressive Scroll Sentinel and Load More for Inspector Modal */}
                  {filteredInspectorVideos.length > inspectorVisibleCount && (
                    <div
                      ref={inspectorLoadMoreRef}
                      className="col-span-full py-8 flex flex-col items-center justify-center gap-3 border border-dashed border-border/60 rounded-2xl bg-surface/30 mt-2"
                    >
                      <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>
                          {isEn
                            ? `Showing ${visibleInspectorVideos.length} of ${filteredInspectorVideos.length} videos in album...`
                            : `Exibindo ${visibleInspectorVideos.length} de ${filteredInspectorVideos.length} vídeos no álbum...`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInspectorVisibleCount(prev => prev + 48)}
                        className="px-4 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-bold transition-all cursor-pointer shadow-sm hover:border-violet-500/40"
                      >
                        {isEn
                          ? `Load Next 48 (${filteredInspectorVideos.length - visibleInspectorVideos.length} remaining)`
                          : `Carregar Mais 48 (${filteredInspectorVideos.length - visibleInspectorVideos.length} restantes)`}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Sticky Footer */}
              <div className="p-4 sm:p-5 border-t border-border bg-slate-950/90 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {isEn
                      ? `${draftAlbumSelectedIds.size} of ${inspectingAlbum.videos.length} videos selected in this album.`
                      : `${draftAlbumSelectedIds.size} de ${inspectingAlbum.videos.length} vídeos selecionados neste álbum.`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={handleConfirmVideoAlbumSelection}
                    className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-violet-600/30 transition-all cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {isEn
                        ? `Confirm Selection (${draftAlbumSelectedIds.size}) & Back to Albums`
                        : `Confirmar Seleção (${draftAlbumSelectedIds.size}) e Voltar aos Álbuns`}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={draftAlbumSelectedIds.size === 0 || isBatchSaving}
                    onClick={() => {
                      const selectedArr = Array.from(draftAlbumSelectedIds);
                      const targetAlb = inspectingAlbum;
                      handleConfirmVideoAlbumSelection();
                      handleDownloadSingleVideoAlbum(targetAlb, selectedArr);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>
                      {isEn
                        ? `Download ${draftAlbumSelectedIds.size} Selected Videos Now`
                        : `Baixar ${draftAlbumSelectedIds.size} Vídeos Selecionados Agora`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Duplicate Videos Warning / Confirmation Modal */}
      {showDuplicateModal && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-lg glass-panel-elevated border border-emerald-500/40 rounded-3xl p-6 shadow-2xl space-y-5 animate-scale-up">
              <div className="flex items-start gap-4">
                <IconBadge variant="emerald" size="lg" icon={<CheckCircle2 size={24} />} />
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    {t.duplicateModalTitle}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <span className="font-bold text-emerald-400">{duplicateVideosList.length}</span> {t.ofCount || 'dos'} {duplicateVideosList.length + onlyNewVideosList.length} {t.duplicateModalSubtitle}
                  </p>
                </div>
              </div>

              {/* List of duplicate titles */}
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {duplicateVideosList.map((d, i) => (
                  <div key={d.id || i} className="p-2.5 rounded-xl bg-surface-elevated border border-border flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-200 font-medium truncate flex-1" title={d.title}>
                      {d.title}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold shrink-0">
                      {d.saved_folder || t.defaultFolder || 'Galeria'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-2xl bg-violet-950/40 border border-violet-500/30 text-xs text-violet-200 flex items-center gap-2">
                <Sparkles size={14} className="text-violet-400 shrink-0" />
                <span>
                  {onlyNewVideosList.length > 0 
                    ? t.skipDuplicateModalDesc.replace('{count}', String(onlyNewVideosList.length))
                    : t.duplicateModalAllSavedHint}
                </span>
              </div>

              {/* Modal Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2">
                <button
                  onClick={() => setShowDuplicateModal(false)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-border text-xs font-semibold transition-colors"
                >
                  {t.cancel}
                </button>

                {onlyNewVideosList.length > 0 && (
                  <button
                    onClick={() => executeBatchSave(onlyNewVideosList, true)}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all"
                  >
                    <Check size={14} />
                    <span>
                      {t.skipSavedAndDownloadCount.replace('{count}', String(onlyNewVideosList.length))}
                    </span>
                  </button>
                )}

                <button
                  onClick={() => executeBatchSave([...duplicateVideosList, ...onlyNewVideosList], false)}
                  className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-300 text-xs font-semibold border border-border transition-colors"
                  title={t.forceNewDownload}
                >
                  {t.downloadAllAnywayCount.replace('{count}', String(duplicateVideosList.length + onlyNewVideosList.length))}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Folder Select Modal */}
      <FolderSelectModal
        isOpen={folderModalState.isOpen}
        onClose={() => setFolderModalState({ isOpen: false, mode: 'single' })}
        title={
          folderModalState.mode === 'album_batch'
            ? t.saveCountVideosFolder.replace('{count}', String(folderModalState.customBatchVideos?.length || 0))
            : folderModalState.mode === 'batch'
            ? t.saveCountVideosFolder.replace('{count}', String(selectedIds.length))
            : t.folderModalSingleTitle
        }
        subtitle={t.folderModalSubtitle}
        existingFolders={videoFolders.map(f => f.name)}
        defaultFolder={targetFolder.trim() || settings.defaultVideoFolder || 'Extraídos'}
        type="video"
        onConfirm={(selectedFolder: string) => {
          setWebScraperState({ targetFolder: selectedFolder });
          if (folderModalState.mode === 'album_batch' && folderModalState.customBatchVideos) {
            executeBatchSave(folderModalState.customBatchVideos, true, selectedFolder);
          } else if (folderModalState.mode === 'batch') {
            const selectedVideos = scanResult?.videos.filter(v => selectedIds.includes(v.id)) || [];
            executeBatchSave(selectedVideos, true, selectedFolder);
          } else if (folderModalState.targetVideo) {
            handleSaveSingleVideo(folderModalState.targetVideo, selectedFolder);
          }
        }}
      />
    </div>
  );
};
