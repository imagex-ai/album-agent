import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Compass,
  Search,
  Sparkles,
  ExternalLink,
  Layers,
  ArrowRight,
  AlertCircle,
  Loader2,
  FolderHeart,
  Maximize2,
  X,
  CheckSquare,
  Square,
  Download,
  Folder,
  FolderDown,
  ChevronDown,
  CheckCircle2,
  Clock,
  RotateCcw,
  Check,
  Images,
  Eye,
  ArrowLeft,
  Filter
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { backendApi } from '../../services/realApi';
import { soundEffects } from '../../services/soundEffects';
import { translations } from '../../i18n/translations';
import { FolderSelectModal } from '../common/FolderSelectModal';
import { SavedRedirectBadge } from '../common/SavedRedirectBadge';
import { IconBadge } from '../common/IconBadge';
import { ModalPortal } from '../common/ModalPortal';
import { MultiAlbumPreviewImage, MultiAlbumCustomSelection } from '../../types';

interface DiscoveredItem {
  title: string;
  url: string;
  thumbnail_url?: string | null;
  source_type: 'related' | 'performer_page' | 'search' | 'primary';
  total_images_hint?: number;
  page_found?: number;
}

const normalizeUrl = (u?: string | null): string => {
  if (!u) return '';
  return u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
};

export const MultiAlbumView: React.FC = () => {
  const {
    multiAlbumState,
    setMultiAlbumState,
    clearMultiAlbumState,
    navigateToView,
    jobs,
    albums,
    albumFolders,
    syncJobs,
    syncAlbums,
    settings,
    checkItemSavedStatus,
    markItemAsSavedOptimistically
  } = useAppStore();

  const t = translations[settings.language].multiAlbum || translations['en-US'].multiAlbum;
  const isEn = settings.language === 'en-US';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Per-Album Image Inspection & Subset Selection State
  const [inspectingAlbum, setInspectingAlbum] = useState<DiscoveredItem | null>(null);
  const [isLoadingAlbumPreview, setIsLoadingAlbumPreview] = useState(false);
  const [albumPreviewError, setAlbumPreviewError] = useState<string | null>(null);
  const [albumPreviewImages, setAlbumPreviewImages] = useState<MultiAlbumPreviewImage[]>([]);
  const [draftSelectedImageUrls, setDraftSelectedImageUrls] = useState<Set<string>>(new Set());
  const [inspectorMediaFilter, setInspectorMediaFilter] = useState<'all' | 'photo' | 'gif'>('all');

  // Destination folder state
  const [destinationFolder, setDestinationFolder] = useState<string>('');
  const [folderModalState, setFolderModalState] = useState<{
    isOpen: boolean;
    mode: 'single' | 'batch';
    targetAlbum?: DiscoveredItem;
    overrideSelectedUrls?: string[];
  }>({ isOpen: false, mode: 'single' });

  // Optimistic queue state for immediate card feedback
  const [optimisticQueuedUrls, setOptimisticQueuedUrls] = useState<Set<string>>(new Set());

  // Batch Action States
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'main' | 'recommended' | 'all'>('main');
  const [toast, setToast] = useState<{ type: 'success' | 'info' | 'error'; message: string; actionLabel?: string; onAction?: () => void } | null>(null);

  // Read persisted form and results
  const url = multiAlbumState.url || '';
  const performerName = multiAlbumState.performerName || '';
  const maxRelated = multiAlbumState.maxRelated || 0;
  const maxPages = multiAlbumState.maxPages ?? 50;
  const pagesScanned = multiAlbumState.pagesScanned ?? 0;
  const results: DiscoveredItem[] = multiAlbumState.results || [];
  const streamingStatus = multiAlbumState.streamingStatus || '';
  const lastSearchedPerformer = multiAlbumState.lastSearchedPerformer || null;
  const selectedUrls = useMemo(() => new Set(multiAlbumState.selectedUrls || []), [multiAlbumState.selectedUrls]);
  const customSelections: Record<string, MultiAlbumCustomSelection> = multiAlbumState.customSelections || {};

  // Sync albums & jobs on mount
  useEffect(() => {
    syncAlbums(false);
    syncJobs();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleDiscover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError(t.urlRequiredError);
      return;
    }

    setLoading(true);
    setError(null);
    setMultiAlbumState({
      results: [],
      selectedUrls: [],
      pagesScanned: 0,
      streamingStatus: t.connectingStream,
      lastSearchedPerformer: performerName.trim() || null
    });
    setShowDownloadDropdown(false);

    try {
      const res = await fetch('/api/multi-album/discover-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          performer_name: performerName.trim() || null,
          max_related: maxRelated,
          max_pages: maxPages,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Erro HTTP ${res.status}`);
      }

      if (!res.body) {
        throw new Error(t.streamNotSupported);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentResults: DiscoveredItem[] = [];

      let pendingBatch: DiscoveredItem[] = [];
      let lastFlush = Date.now();

      const flushBatch = () => {
        if (pendingBatch.length > 0) {
          currentResults = [...currentResults, ...pendingBatch];
          pendingBatch = [];
          setMultiAlbumState({ results: currentResults });
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const payload = JSON.parse(trimmed.slice(6));
              if (payload.type === 'album' && payload.album) {
                const exists = currentResults.some((a) => a.url === payload.album.url) || pendingBatch.some((a) => a.url === payload.album.url);
                if (!exists) {
                  pendingBatch.push(payload.album);
                  if (Date.now() - lastFlush > 100 || pendingBatch.length >= 20) {
                    flushBatch();
                    lastFlush = Date.now();
                  }
                }
              } else if (payload.type === 'page') {
                setMultiAlbumState({
                  streamingStatus: payload.message || '',
                  pagesScanned: payload.page || 1
                });
              } else if (payload.type === 'status') {
                setMultiAlbumState({ streamingStatus: payload.message || '' });
              } else if (payload.type === 'done') {
                flushBatch();
                setMultiAlbumState({
                  streamingStatus: t.streamDone.replace('{total}', String(payload.total)),
                  ...(payload.pages_scanned ? { pagesScanned: payload.pages_scanned } : {})
                });
              }
            } catch (_) {}
          }
        }
      }
      flushBatch();
    } catch (err: any) {
      setError(err.message || t.streamFetchError);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractSingle = (albumUrl: string) => {
    try {
      localStorage.setItem('imagex_extractor_single_url', albumUrl);
      localStorage.setItem('imagex_extractor_tab', 'single');
    } catch (_) {}
    navigateToView('extractor');
  };

  // Selection toggles
  const toggleSelect = (albumUrl: string) => {
    const next = new Set(selectedUrls);
    if (next.has(albumUrl)) {
      next.delete(albumUrl);
    } else {
      next.add(albumUrl);
    }
    setMultiAlbumState({ selectedUrls: Array.from(next) });
  };

  const savedAlbumUrlMap = useMemo(() => {
    const map = new Map<string, typeof albums[0]>();
    for (const a of albums) {
      if (a.sourceUrl) map.set(normalizeUrl(a.sourceUrl), a);
      if (a.title) map.set(a.title.trim().toLowerCase(), a);
    }
    return map;
  }, [albums]);

  const jobsUrlMap = useMemo(() => {
    const map = new Map<string, typeof jobs[0]>();
    for (const j of jobs) {
      if (j.url) map.set(normalizeUrl(j.url), j);
    }
    return map;
  }, [jobs]);

  const isAlbumSavedInGallery = (album: DiscoveredItem) => {
    const normAlbumUrl = normalizeUrl(album.url);
    if (normAlbumUrl && savedAlbumUrlMap.has(normAlbumUrl)) return true;
    const normTitle = album.title ? album.title.trim().toLowerCase() : '';
    if (normTitle && savedAlbumUrlMap.has(normTitle)) return true;
    return false;
  };

  const mainAlbums = useMemo(() => {
    return results.filter(a => a.source_type !== 'related');
  }, [results]);

  const recommendedAlbums = useMemo(() => {
    return results.filter(a => a.source_type === 'related');
  }, [results]);
  const allAlbums = results;

  const effectiveTab = (activeTab === 'main' && mainAlbums.length === 0 && recommendedAlbums.length > 0)
    ? 'recommended'
    : (activeTab === 'recommended' && recommendedAlbums.length === 0 && mainAlbums.length > 0)
    ? 'main'
    : activeTab;

  const displayedAlbums = effectiveTab === 'main'
    ? mainAlbums
    : effectiveTab === 'recommended'
    ? recommendedAlbums
    : allAlbums;

  const [visibleCount, setVisibleCount] = useState(36);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(36);
  }, [activeTab, url]);

  const visibleAlbums = useMemo(() => {
    return displayedAlbums.slice(0, visibleCount);
  }, [displayedAlbums, visibleCount]);

  useEffect(() => {
    if (!loadMoreSentinelRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && displayedAlbums.length > visibleCount) {
        setVisibleCount((prev) => prev + 36);
      }
    }, { rootMargin: '400px' });

    observer.observe(loadMoreSentinelRef.current);
    return () => observer.disconnect();
  }, [displayedAlbums.length, visibleCount]);

  const displayedUrls = useMemo(() => displayedAlbums.map(a => a.url), [displayedAlbums]);
  const isAllDisplayedSelected = displayedUrls.length > 0 && displayedUrls.every(url => selectedUrls.has(url));
  const newDisplayedAlbums = useMemo(() => displayedAlbums.filter(a => !isAlbumSavedInGallery(a)), [displayedAlbums, isAlbumSavedInGallery]);

  const handleSelectAll = () => {
    if (isAllDisplayedSelected) {
      const next = new Set(selectedUrls);
      displayedUrls.forEach(url => next.delete(url));
      setMultiAlbumState({ selectedUrls: Array.from(next) });
    } else {
      const next = new Set(selectedUrls);
      displayedUrls.forEach(url => next.add(url));
      setMultiAlbumState({ selectedUrls: Array.from(next) });
    }
  };

  const handleSelectOnlyNew = () => {
    const next = new Set(selectedUrls);
    newDisplayedAlbums.forEach(a => next.add(a.url));
    setMultiAlbumState({ selectedUrls: Array.from(next) });
    soundEffects.click(settings.soundEnabled);
  };

  const clearSelection = () => {
    setMultiAlbumState({ selectedUrls: [] });
    setShowDownloadDropdown(false);
  };

  const totalSavedCount = results.filter(a => isAlbumSavedInGallery(a)).length;
  const totalNewCount = results.length - totalSavedCount;

  // Status helper for real-time card indicators with normalized URL matching (O(1) Map lookups)
  const getAlbumStatus = (albumUrl: string, albumTitle: string) => {
    const normAlbumUrl = normalizeUrl(albumUrl);
    const normTitle = albumTitle.trim().toLowerCase();

    // 1. Saved in library? (O(1) Map lookup)
    const savedAlbum = (normAlbumUrl ? savedAlbumUrlMap.get(normAlbumUrl) : undefined) ||
                       (normTitle ? savedAlbumUrlMap.get(normTitle) : undefined);
    if (savedAlbum) {
      return {
        status: 'saved' as const,
        label: `${t.viewInGallery} (${savedAlbum.folder || t.folderPlaceholder})`,
        color: 'emerald',
        albumId: savedAlbum.id,
        savedFolder: savedAlbum.folder || t.folderPlaceholder
      };
    }

    // 2. Active or completed job? (O(1) Map lookup)
    const job = normAlbumUrl ? jobsUrlMap.get(normAlbumUrl) : undefined;
    if (job) {
      if (job.status === 'active') {
        return {
          status: 'extracting' as const,
          label: `${t.extracting} (${job.progressPercent}%)`,
          color: 'brand',
          jobId: job.id
        };
      }
      if (job.status === 'completed') {
        const foundAlb = (job.resultAlbumId ? albums.find(a => a.id === job.resultAlbumId) : undefined) || (job.url ? savedAlbumUrlMap.get(normalizeUrl(job.url)) : undefined);
        return {
          status: 'saved' as const,
          label: `${t.viewInGallery} (${foundAlb?.folder || job.folder || t.folderPlaceholder})`,
          color: 'emerald',
          albumId: job.resultAlbumId || foundAlb?.id,
          savedFolder: foundAlb?.folder || job.folder || t.folderPlaceholder
        };
      }
      if (job.status === 'failed') {
        return { status: 'error' as const, label: t.statusFailed || 'Falha', color: 'rose' };
      }
    }

    // 3. Optimistically queued?
    if (optimisticQueuedUrls.has(normAlbumUrl)) {
      return { status: 'queued' as const, label: t.inQueue, color: 'brand' };
    }

    return null;
  };

  const effectiveFolder = destinationFolder.trim() || settings.defaultAlbumFolder || performerName.trim() || 'Geral';

  // Helper that attaches custom subset selection (selected_image_urls) to an album payload if the user selected specific images
  const enrichAlbumWithSelection = (album: DiscoveredItem, overrideSelectedUrls?: string[]) => {
    const custom = customSelections[album.url];
    const selectedList = overrideSelectedUrls !== undefined
      ? overrideSelectedUrls
      : (custom && Array.isArray(custom.selectedImageUrls) && custom.selectedImageUrls.length > 0)
      ? custom.selectedImageUrls
      : undefined;
    return {
      ...album,
      selected_image_urls: selectedList,
    };
  };

  // Opens an album to inspect & select specific images before saving/downloading
  const openAlbumImageSelector = async (album: DiscoveredItem, forceRefresh: boolean = false) => {
    soundEffects.click(settings.soundEnabled);
    setInspectingAlbum(album);
    setAlbumPreviewError(null);
    setInspectorMediaFilter('all');

    const cached = customSelections[album.url];
    if (!forceRefresh && cached && Array.isArray(cached.images) && cached.images.length > 0) {
      setAlbumPreviewImages(cached.images);
      setDraftSelectedImageUrls(new Set(cached.selectedImageUrls));
      setIsLoadingAlbumPreview(false);
      return;
    }

    setIsLoadingAlbumPreview(true);
    setAlbumPreviewImages([]);
    setDraftSelectedImageUrls(new Set());

    const res = await backendApi.previewMultiAlbum(album);
    setIsLoadingAlbumPreview(false);
    if (!res.success || res.images.length === 0) {
      setAlbumPreviewError(
        res.error ||
          (isEn
            ? 'Could not extract preview images from this album page.'
            : 'Não foi possível carregar a prévia de imagens deste álbum.')
      );
      return;
    }

    const allUrls = res.images.map((i) => i.original_url);
    const hasExplicitZeroSelection = cached && Array.isArray(cached.selectedImageUrls) && cached.selectedImageUrls.length === 0 && cached.totalImages > 0;
    const initialSelected = cached && Array.isArray(cached.selectedImageUrls) && cached.selectedImageUrls.length > 0
      ? cached.selectedImageUrls.filter((u) => allUrls.includes(u))
      : hasExplicitZeroSelection
      ? []
      : allUrls;
    const effectiveSelected = hasExplicitZeroSelection
      ? []
      : (initialSelected.length > 0 ? initialSelected : allUrls);

    setAlbumPreviewImages(res.images);
    setDraftSelectedImageUrls(new Set(effectiveSelected));

    // Cache previewed images immediately
    const nextCustom: Record<string, MultiAlbumCustomSelection> = {
      ...customSelections,
      [album.url]: {
        albumUrl: album.url,
        totalImages: res.images.length,
        selectedImageUrls: effectiveSelected,
        images: res.images,
        updatedAt: Date.now(),
      },
    };
    setMultiAlbumState({ customSelections: nextCustom });
  };

  const handleConfirmAlbumImageSelection = () => {
    if (!inspectingAlbum) return;
    soundEffects.click(settings.soundEnabled);
    if (isLoadingAlbumPreview || albumPreviewImages.length === 0) {
      setInspectingAlbum(null);
      return;
    }
    const selectedArr = Array.from(draftSelectedImageUrls);
    const nextCustom: Record<string, MultiAlbumCustomSelection> = {
      ...customSelections,
      [inspectingAlbum.url]: {
        albumUrl: inspectingAlbum.url,
        totalImages: albumPreviewImages.length,
        selectedImageUrls: selectedArr,
        images: albumPreviewImages,
        updatedAt: Date.now(),
      },
    };

    // Automatically select this album in the Multi-Album list if at least 1 image is selected
    const nextSelectedAlbums = new Set(selectedUrls);
    if (selectedArr.length > 0) {
      nextSelectedAlbums.add(inspectingAlbum.url);
    } else {
      nextSelectedAlbums.delete(inspectingAlbum.url);
    }

    setMultiAlbumState({
      customSelections: nextCustom,
      selectedUrls: Array.from(nextSelectedAlbums),
    });
    setInspectingAlbum(null);
  };

  const handleClearAlbumCustomSelection = (albumUrl: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextCustom = { ...customSelections };
    delete nextCustom[albumUrl];
    setMultiAlbumState({ customSelections: nextCustom });
  };

  // Direct actions
  const executeSaveSingleDirect = async (album: DiscoveredItem, targetFolder: string, overrideSelectedUrls?: string[]) => {
    const normUrl = normalizeUrl(album.url);
    setOptimisticQueuedUrls((prev) => new Set(prev).add(normUrl));
    const enriched = enrichAlbumWithSelection(album, overrideSelectedUrls);

    try {
      const res = await backendApi.batchSaveMultiAlbums([enriched], targetFolder);
      if (res.success) {
        markItemAsSavedOptimistically({
          url: album.url,
          title: album.title,
          folder: targetFolder,
          targetView: 'gallery'
        });
        setToast({
          type: 'success',
          message: t.albumSavedToast.replace('{title}', album.title.slice(0, 30)).replace('{folder}', targetFolder),
          actionLabel: t.viewInGallery,
          onAction: () => navigateToView('gallery'),
        });
        await syncJobs();
        await syncAlbums();
      } else {
        setOptimisticQueuedUrls((prev) => {
          const next = new Set(prev);
          next.delete(normUrl);
          return next;
        });
        setToast({ type: 'error', message: res.message });
      }
    } catch (err: any) {
      setOptimisticQueuedUrls((prev) => {
        const next = new Set(prev);
        next.delete(normUrl);
        return next;
      });
      setToast({ type: 'error', message: err.message || t.queueError });
    }
  };

  const handleInitiateSingleSave = (album: DiscoveredItem) => {
    if (settings.askFolderOnSave) {
      setFolderModalState({
        isOpen: true,
        mode: 'single',
        targetAlbum: album
      });
    } else {
      executeSaveSingleDirect(album, effectiveFolder);
    }
  };

  const handleDownloadSingleDirect = (album: DiscoveredItem, overrideSelectedUrls?: string[]) => {
    const enriched = enrichAlbumWithSelection(album, overrideSelectedUrls);
    setToast({
      type: 'info',
      message: t.startingSingleZip.replace('{title}', album.title.slice(0, 28)),
    });
    backendApi.triggerSingleAlbumZipDownload(album.url, album.title, enriched.selected_image_urls);
  };

  const executeBatchSaveToApp = async (targetFolder: string) => {
    const selectedAlbums = results.filter((r) => selectedUrls.has(r.url)).map((a) => enrichAlbumWithSelection(a));
    if (selectedAlbums.length === 0) return;

    // Set optimistic queued status for all selected
    setOptimisticQueuedUrls((prev) => {
      const next = new Set(prev);
      selectedAlbums.forEach((a) => next.add(normalizeUrl(a.url)));
      return next;
    });

    setIsSavingBatch(true);
    try {
      const res = await backendApi.batchSaveMultiAlbums(selectedAlbums, targetFolder);
      if (res.success) {
        selectedAlbums.forEach(a => {
          markItemAsSavedOptimistically({
            url: a.url,
            title: a.title,
            folder: targetFolder,
            targetView: 'gallery'
          });
        });
        setToast({
          type: 'success',
          message: t.batchSavedToast.replace('{count}', String(res.queued)).replace('{folder}', targetFolder),
          actionLabel: t.viewInGallery,
          onAction: () => navigateToView('gallery'),
        });
        clearSelection();
        await syncJobs();
        await syncAlbums();
      } else {
        setToast({ type: 'error', message: res.message });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || t.batchSaveError });
    } finally {
      setIsSavingBatch(false);
    }
  };

  const handleInitiateBatchSave = () => {
    const selectedAlbums = results.filter((r) => selectedUrls.has(r.url));
    if (selectedAlbums.length === 0) return;
    if (settings.askFolderOnSave) {
      setFolderModalState({
        isOpen: true,
        mode: 'batch'
      });
    } else {
      executeBatchSaveToApp(effectiveFolder);
    }
  };

  const handleBatchDownload = async (format: 'unified' | 'individual') => {
    const selectedAlbums = results.filter((r) => selectedUrls.has(r.url)).map((a) => enrichAlbumWithSelection(a));
    if (selectedAlbums.length === 0) return;

    setShowDownloadDropdown(false);

    if (format === 'individual') {
      setToast({
        type: 'info',
        message: t.startingMultiZip.replace('{count}', String(selectedAlbums.length)),
      });
      selectedAlbums.forEach((alb, idx) => {
        setTimeout(() => {
          backendApi.triggerSingleAlbumZipDownload(alb.url, alb.title, alb.selected_image_urls);
        }, idx * 600);
      });
      clearSelection();
      return;
    }

    // Unified ZIP
    setIsDownloadingBatch(true);
    setToast({
      type: 'info',
      message: t.startingUnifiedZip.replace('{count}', String(selectedAlbums.length)),
    });

    try {
      const res = await backendApi.batchDownloadMultiAlbumsZip(selectedAlbums, 'unified');
      if (res.success) {
        setToast({
          type: 'success',
          message: t.unifiedZipSuccess,
        });
        clearSelection();
      } else {
        setToast({
          type: 'error',
          message: res.error || t.unifiedZipError,
        });
      }
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || t.zipGenError });
    } finally {
      setIsDownloadingBatch(false);
    }
  };

  const getSourceBadge = (type: string) => {
    switch (type) {
      case 'primary':
      case 'performer_page':
        return <span className="px-2 py-0.5 text-[10px] rounded-full font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">{t.sourcePrimary || 'Principal'}</span>;
      case 'related':
        return <span className="px-2 py-0.5 text-[10px] rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">{t.sourceRelated}</span>;
      case 'search':
        return <span className="px-2 py-0.5 text-[10px] rounded-full font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">{t.sourceSearch}</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] rounded-full font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">{t.sourcePrimary || 'Principal'}</span>;
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full pb-8">
      {/* Hero Header Card */}
      <div className="p-6 rounded-3xl glass-panel-elevated border border-border flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/40 shrink-0">
              {t.badgeTag}
            </span>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {t.badgeMode}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-100 flex items-center gap-2.5 tracking-tight">
            <IconBadge icon={<Compass size={20} />} variant="sapphire" size="md" />
            {t.title}
          </h1>
          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
            {t.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {results.length > 0 && (
            <button
              onClick={() => {
                clearMultiAlbumState();
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
            onClick={() => navigateToView('gallery')}
            className="px-3.5 py-2 rounded-xl bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/40 text-brand-300 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title={t.albumGalleryTitle}
          >
            <FolderHeart size={14} />
            <span>{t.albumGallery}</span>
          </button>
        </div>
      </div>

      {/* Form Card */}
      <div className="glass-panel p-6 rounded-3xl border border-border space-y-6">
        <form onSubmit={handleDiscover} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Target URL */}
            <div className="lg:col-span-5 space-y-1.5">
              <div className="h-5 flex items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block truncate">
                  {t.urlLabel}
                </label>
              </div>
              <div className="relative">
                <input
                  type="url"
                  required
                  placeholder={t.urlPlaceholder}
                  value={url}
                  onChange={(e) => setMultiAlbumState({ url: e.target.value })}
                  className="w-full h-12 px-4 rounded-2xl bg-surface-elevated border border-border text-slate-100 placeholder-slate-500 text-xs sm:text-sm font-medium outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all shadow-inner"
                />
              </div>
            </div>

            {/* Artist Name */}
            <div className="lg:col-span-3 space-y-1.5">
              <div className="h-5 flex items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block truncate">
                  {t.performerLabel}
                </label>
              </div>
              <div className="relative">
                <input
                  type="text"
                  placeholder={t.performerPlaceholder}
                  value={performerName}
                  onChange={(e) => setMultiAlbumState({ performerName: e.target.value })}
                  className="w-full h-12 px-4 rounded-2xl bg-surface-elevated border border-border text-slate-100 placeholder-slate-500 text-xs sm:text-sm font-medium outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all shadow-inner"
                />
              </div>
            </div>

            {/* Limit (Optional) */}
            <div className="lg:col-span-2 space-y-1.5">
              <div className="h-5 flex items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block truncate whitespace-nowrap" title={t.limitTitle || t.qtyTitle}>
                  {t.limitLabel || t.qtyLabel}
                </label>
              </div>
              <input
                type="number"
                min="0"
                max="5000"
                placeholder={t.limitPlaceholder || t.qtyPlaceholder}
                value={maxRelated === 0 ? '' : maxRelated}
                onChange={(e) => setMultiAlbumState({ maxRelated: e.target.value === '' ? 0 : Number(e.target.value) })}
                className="w-full h-12 px-4 rounded-2xl bg-surface-elevated border border-border text-slate-100 placeholder-slate-500 text-xs sm:text-sm font-medium outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all shadow-inner"
              />
            </div>

            {/* Max Pages (Multi-page Crawler) */}
            <div className="lg:col-span-2 space-y-1.5">
              <div className="h-5 flex items-center">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block truncate whitespace-nowrap" title={t.maxPagesTooltip}>
                  {t.maxPagesLabel}
                </label>
              </div>
              <input
                type="number"
                min="1"
                max="200"
                placeholder={t.maxPagesPlaceholder || '50 págs'}
                value={maxPages || 50}
                onChange={(e) => setMultiAlbumState({ maxPages: Number(e.target.value) || 50 })}
                className="w-full h-12 px-4 rounded-2xl bg-surface-elevated border border-border text-slate-100 placeholder-slate-500 text-xs sm:text-sm font-medium outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all shadow-inner"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" />
              <span>{t.realtimeStreamHint}</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="h-12 px-6 rounded-2xl text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-glow-brand transition-all disabled:opacity-50 bg-gradient-to-r from-brand-600 to-accent-purple hover:from-brand-500 hover:to-accent-purple"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{maxRelated === 0 ? t.autoScrollScanning : t.discoveringBtn}</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>{t.discoverBtn}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Error alert */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm glass-panel">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-400" />
          <p>{error}</p>
        </div>
      )}

      {/* Results Header with Live Counter and Action Buttons */}
      {(results.length > 0 || loading) && (
        <div className="space-y-4">
          {/* Destination Folder & Actions Toolbar (Unified Style Matching WebVideoScraperView) */}
          <div className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Folder Destination & Selector */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-slate-400">
                  {t.saveFolder || (isEn ? "Save to Folder:" : "Salvar na Pasta:")}
                </span>
                <div className="relative flex items-center gap-1.5">
                  <input
                    type="text"
                    value={destinationFolder}
                    onChange={(e) => setDestinationFolder(e.target.value)}
                    placeholder={performerName.trim() || t.folderPlaceholder || 'Geral'}
                    className="bg-surface-elevated border border-border focus:border-brand-500 text-slate-100 text-xs font-bold rounded-xl px-3 py-1.5 outline-none w-48"
                  />
                  {/* Folder Select Dropdown Helper */}
                  {albumFolders.length > 0 && (
                    <select
                      onChange={(e) => e.target.value && setDestinationFolder(e.target.value)}
                      value=""
                      className="bg-surface-elevated border border-border text-slate-300 text-xs rounded-xl px-2 py-1.5 outline-none cursor-pointer"
                      title={t.chooseExistingFolder || 'Escolher pasta existente na Galeria'}
                    >
                      <option value="" disabled>{t.existingFolders || 'Pastas Existentes'}</option>
                      {albumFolders.map((f) => (
                        <option key={f.id || f.name} value={f.name}>{f.name} ({f.count ?? 0})</option>
                      ))}
                    </select>
                  )}
                </div>

                {lastSearchedPerformer && (
                  <span className="text-[11px] text-slate-400 truncate max-w-xs font-medium">
                    {t.forPerformer} "{lastSearchedPerformer}"
                  </span>
                )}
              </div>

              {/* Selection & Batch Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {newDisplayedAlbums.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectOnlyNew}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                    title={t.selectNewTitle}
                  >
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span>{t.selectNew} ({newDisplayedAlbums.length})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {isAllDisplayedSelected ? (
                    <>
                      <CheckSquare size={13} className="text-brand-400" />
                      <span>{t.deselectAll} ({displayedAlbums.length})</span>
                    </>
                  ) : (
                    <>
                      <Square size={13} />
                      <span>{t.selectAll} ({displayedAlbums.length})</span>
                    </>
                  )}
                </button>

                <span className="text-xs font-mono font-bold text-indigo-300 px-2.5 py-1 rounded bg-indigo-950/60 border border-indigo-500/30">
                  {selectedUrls.size} {t.selected}
                </span>

                {/* Save Selected To App */}
                <button
                  type="button"
                  onClick={handleInitiateBatchSave}
                  disabled={selectedUrls.size === 0 || isSavingBatch || isDownloadingBatch}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-emerald-600/30 disabled:opacity-50 transition-all cursor-pointer"
                  title={t.saveToAppTooltip}
                >
                  {isSavingBatch ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>{t.extracting || (isEn ? "Saving..." : "Salvando...")}</span>
                    </>
                  ) : (
                    <>
                      <FolderHeart size={13} />
                      <span>{t.saveToApp} ({selectedUrls.size})</span>
                    </>
                  )}
                </button>

                {/* Download Dropdown */}
                {selectedUrls.size === 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const alb = results.find((r) => selectedUrls.has(r.url));
                      if (alb) handleDownloadSingleDirect(alb);
                    }}
                    disabled={isSavingBatch || isDownloadingBatch}
                    className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                    title={t.downloadZipTooltip}
                  >
                    <Download size={13} />
                    <span>{t.downloadZip}</span>
                  </button>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
                      disabled={selectedUrls.size === 0 || isSavingBatch || isDownloadingBatch}
                      className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                      title={t.downloadFormatTooltip}
                    >
                      {isDownloadingBatch ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      <span>{t.downloadSelected} ({selectedUrls.size})</span>
                      <ChevronDown size={13} className="ml-0.5" />
                    </button>

                    {showDownloadDropdown && (
                      <div className="absolute right-0 top-full mt-2 w-60 rounded-2xl bg-slate-900 border border-border shadow-2xl p-1.5 z-50 text-xs">
                        <button
                          type="button"
                          onClick={() => handleBatchDownload('unified')}
                          className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-brand-500/20 text-slate-200 hover:text-white flex items-center gap-2 transition-all font-medium cursor-pointer"
                        >
                          <FolderDown className="w-4 h-4 text-brand-400 shrink-0" />
                          <div>
                            <div className="font-bold">{t.unifiedZip}</div>
                            <div className="text-[10px] text-slate-400">{t.unifiedZipDesc}</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBatchDownload('individual')}
                          className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-brand-500/20 text-slate-200 hover:text-white flex items-center gap-2 transition-all font-medium cursor-pointer"
                        >
                          <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                          <div>
                            <div className="font-bold">{t.multipleZip}</div>
                            <div className="text-[10px] text-slate-400">{t.multipleZipDesc}</div>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    clearMultiAlbumState();
                    soundEffects.click(settings.soundEnabled);
                  }}
                  className="p-2 rounded-xl bg-surface border border-border hover:border-rose-500/40 text-slate-400 hover:text-rose-300 text-xs transition-all cursor-pointer"
                  title={t.clearTitle}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>

            {/* Segmented Section Filter Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/40">
              <div className="flex flex-wrap items-center gap-2">
                {/* Tab: Álbuns Principais */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('main');
                    soundEffects.click(settings.soundEnabled);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                    effectiveTab === 'main'
                      ? 'bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-brand-600/30 ring-1 ring-brand-400/40'
                      : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
                  }`}
                >
                  <Compass size={13} className={effectiveTab === 'main' ? 'text-white' : 'text-brand-400'} />
                  <span>{t.mainAlbums || (isEn ? "Main Albums" : "Álbuns Principais")} ({mainAlbums.length})</span>
                </button>

                {/* Tab: Relacionados / Recomendados */}
                {recommendedAlbums.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('recommended');
                      soundEffects.click(settings.soundEnabled);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                      effectiveTab === 'recommended'
                        ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-amber-600/30 ring-1 ring-amber-400/40'
                        : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
                    }`}
                  >
                    <Sparkles size={13} className={effectiveTab === 'recommended' ? 'text-white' : 'text-amber-400'} />
                    <span>{t.recommendedAlbums || 'Relacionados / Recomendados'} ({recommendedAlbums.length})</span>
                  </button>
                )}

                {/* Tab: Todos */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('all');
                    soundEffects.click(settings.soundEnabled);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                    effectiveTab === 'all'
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-purple-600/30 ring-1 ring-purple-400/40'
                      : 'bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border'
                  }`}
                >
                  <Layers size={13} className={effectiveTab === 'all' ? 'text-white' : 'text-purple-400'} />
                  <span>{t.allAlbums || 'Todos'} ({results.length})</span>
                </button>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-bold text-slate-300 px-2 py-0.5 rounded bg-surface border border-border">
                  {t.totalCount}: {results.length}
                </span>
                {pagesScanned > 0 && (
                  <span className="text-xs font-mono font-bold text-indigo-300 px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/30">
                    {t.pagesScannedBadge.replace('{count}', String(pagesScanned))}
                  </span>
                )}
                <span className="text-xs font-mono font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30">
                  {t.savedCount}: {totalSavedCount}
                </span>
                <span className="text-xs font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30">
                  {t.newCount}: {totalNewCount}
                </span>
              </div>
            </div>
          </div>

          {/* Album Grid or Empty State */}
          {displayedAlbums.length === 0 ? (
            <div className="glass-panel p-10 rounded-3xl border border-border text-center space-y-3">
              <IconBadge
                icon={activeTab === 'recommended' ? <Sparkles size={22} /> : <Compass size={22} />}
                variant={activeTab === 'recommended' ? 'gold' : 'sapphire'}
                size="lg"
                className="mx-auto"
              />
              <p className="text-sm font-semibold text-slate-300">
                {activeTab === 'recommended' ? t.noRecommendedFound : t.noMainFound}
              </p>
              <p className="text-xs text-slate-500">
                {t.switchToAllHint}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleAlbums.map((album) => {
                const isSelected = selectedUrls.has(album.url);
                const statusInfo = getAlbumStatus(album.url, album.title);
                const customSel = customSelections[album.url];
                const hasCustomSubset = Boolean(
                  customSel &&
                  customSel.selectedImageUrls.length > 0 &&
                  customSel.selectedImageUrls.length < customSel.totalImages
                );
                const hasInspectedAll = Boolean(
                  customSel &&
                  customSel.totalImages > 0 &&
                  customSel.selectedImageUrls.length === customSel.totalImages
                );

                return (
                  <div
                    key={album.url}
                    style={{
                      contentVisibility: 'auto',
                      containIntrinsicSize: 'auto 380px',
                    }}
                    className={`bg-surface-elevated border rounded-2xl p-4 flex flex-col justify-between transition-all group shadow-md relative ${
                      isSelected
                        ? 'border-brand-500 bg-brand-950/20 shadow-glow-brand ring-1 ring-brand-500/30'
                        : 'border-border hover:border-brand-500/40'
                    }`}
                  >
                  <div className="space-y-3">
                    {/* Thumbnail Preview */}
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-950/80 flex items-center justify-center border border-border relative group/thumb">
                      {/* Checkbox Overlay */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(album.url);
                        }}
                        className={`absolute top-2 left-2 z-20 p-1.5 rounded-lg backdrop-blur-md transition-all border ${
                          isSelected
                            ? 'bg-brand-600 text-white border-brand-400 shadow-md'
                            : 'bg-black/60 text-white/70 hover:text-white hover:bg-black/90 border-white/20 opacity-80 group-hover:opacity-100'
                        }`}
                        title={isSelected ? t.deselectAlbumTooltip : t.selectAlbumTooltip}
                      >
                        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>

                      {/* Quick Inspect / Select Images Overlay Pill */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAlbumImageSelector(album);
                        }}
                        className="absolute bottom-2 left-2 z-20 px-2.5 py-1 rounded-lg bg-indigo-950/85 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-400/40 text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-md transition-all shadow-lg cursor-pointer"
                        title={isEn ? 'Open album to inspect and select specific images to download' : 'Abrir álbum para inspecionar e escolher quais imagens baixar'}
                      >
                        <Images className="w-3.5 h-3.5 text-indigo-300" />
                        <span>
                          {customSel
                            ? `${customSel.selectedImageUrls.length}/${customSel.totalImages} ${isEn ? 'imgs' : 'fotos'}`
                            : (isEn ? 'Select Images' : 'Selecionar Fotos')}
                        </span>
                      </button>

                      {album.thumbnail_url ? (
                        <>
                          <img
                            src={`/api/proxy-image?url=${encodeURIComponent(album.thumbnail_url)}`}
                            alt={album.title}
                            className="w-full h-full object-contain cursor-pointer transition-transform duration-300"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onClick={() => openAlbumImageSelector(album)}
                            title={isEn ? 'Click to open album and select images' : 'Clique para abrir o álbum e selecionar imagens'}
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewImage(album.thumbnail_url || null);
                            }}
                            className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/70 text-white/80 hover:text-white hover:bg-black/95 opacity-0 group-hover/thumb:opacity-100 transition-opacity backdrop-blur-sm border border-white/10"
                            title={t.viewRealSizeTooltip}
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <div
                          onClick={() => openAlbumImageSelector(album)}
                          className="flex flex-col items-center justify-center text-slate-600 gap-1 cursor-pointer w-full h-full"
                        >
                          <FolderHeart className="w-8 h-8 opacity-40" />
                          <span className="text-[10px] font-bold">{t.noThumbnail}</span>
                        </div>
                      )}

                      <div className="absolute top-2 right-2 pointer-events-none">
                        {getSourceBadge(album.source_type)}
                      </div>

                      {/* Page Found Badge */}
                      {album.page_found && album.page_found > 1 && (
                        <span className="absolute bottom-2 right-2 z-20 px-1.5 py-0.5 rounded bg-indigo-950/90 backdrop-blur-md text-[9px] font-mono font-bold text-indigo-300 border border-indigo-500/40">
                          P.{album.page_found}
                        </span>
                      )}
                    </div>

                    {/* Title and Status */}
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          onClick={() => openAlbumImageSelector(album)}
                          className="font-bold text-slate-100 hover:text-brand-300 cursor-pointer text-sm line-clamp-2 title-tooltip flex-1 transition-colors"
                          title={album.title}
                        >
                          {album.title}
                        </h3>
                        {statusInfo && (
                          statusInfo.status === 'saved' ? (
                            <SavedRedirectBadge
                              savedInfo={{
                                isSaved: true,
                                savedFolder: statusInfo.savedFolder || t.folderPlaceholder,
                                targetId: statusInfo.albumId,
                                targetView: 'gallery'
                              }}
                            />
                          ) : (
                            <span
                              className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                statusInfo.color === 'emerald'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                  : statusInfo.color === 'brand'
                                  ? 'bg-brand-500/20 text-brand-300 border-brand-500/30 animate-pulse'
                                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                              }`}
                            >
                              {statusInfo.status === 'extracting' && <Loader2 className="w-3 h-3 animate-spin text-brand-400" />}
                              {statusInfo.status === 'queued' && <Clock className="w-3 h-3 text-brand-400" />}
                              <span>{statusInfo.label}</span>
                            </span>
                          )
                        )}
                      </div>

                      {/* Custom Image Selection Status Badge */}
                      {(hasCustomSubset || hasInspectedAll) && customSel && (
                        <div className="mt-1.5 flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-[11px] text-cyan-300 font-semibold">
                          <button
                            type="button"
                            onClick={() => openAlbumImageSelector(album)}
                            className="flex items-center gap-1.5 hover:underline text-left truncate cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                            <span>
                              {hasCustomSubset
                                ? (isEn
                                    ? `${customSel.selectedImageUrls.length} of ${customSel.totalImages} images selected`
                                    : `${customSel.selectedImageUrls.length} de ${customSel.totalImages} imagens selecionadas`)
                                : (isEn
                                    ? `All ${customSel.totalImages} images verified`
                                    : `Todas as ${customSel.totalImages} imagens selecionadas`)}
                            </span>
                          </button>
                          {hasCustomSubset && (
                            <button
                              type="button"
                              onClick={(e) => handleClearAlbumCustomSelection(album.url, e)}
                              className="text-[10px] text-slate-400 hover:text-rose-300 px-1.5 py-0.5 rounded bg-black/30 hover:bg-rose-500/20 transition-colors shrink-0"
                              title={isEn ? 'Reset to download all images' : 'Resetar para baixar todas as imagens'}
                            >
                              {isEn ? 'Reset' : 'Todas'}
                            </button>
                          )}
                        </div>
                      )}

                      <p className="text-xs text-slate-500 font-mono truncate mt-1" title={album.url}>
                        {album.url}
                      </p>
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-3 border-t border-border">
                    {/* Botão Abrir / Selecionar Imagens */}
                    <button
                      type="button"
                      onClick={() => openAlbumImageSelector(album)}
                      className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-[11px] font-bold transition-all cursor-pointer"
                      title={isEn ? 'Open album and choose which images to download' : 'Abrir álbum e escolher quais fotos baixar'}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Images' : 'Fotos'}</span>
                    </button>

                    {/* Botão Dinâmico: Se Salvo -> "Ver na Galeria", Se Extraindo -> "Extraindo...", Se Normal -> "Salvar no App" */}
                    {statusInfo?.status === 'saved' ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (statusInfo.albumId) {
                            navigateToView('album-detail', statusInfo.albumId);
                          } else {
                            navigateToView('gallery');
                          }
                        }}
                        className="flex-1 min-w-[100px] flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition-all shadow-glow-emerald"
                        title={t.openInGalleryTooltip}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{t.viewInGallery}</span>
                      </button>
                    ) : statusInfo?.status === 'extracting' || statusInfo?.status === 'queued' ? (
                      <div className="flex-1 min-w-[100px] flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-brand-500/20 text-brand-300 border border-brand-500/30 text-[11px] font-bold">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                        <span>{statusInfo.status === 'queued' ? t.inQueue : t.extracting}</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleInitiateSingleSave(album)}
                        className="flex-1 min-w-[95px] flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-[11px] font-bold transition-all"
                        title={t.saveToAppTooltip}
                      >
                        <FolderHeart className="w-3.5 h-3.5" />
                        <span>
                          {hasCustomSubset && customSel
                            ? `${t.saveToApp} (${customSel.selectedImageUrls.length})`
                            : t.saveToApp}
                        </span>
                      </button>
                    )}

                    {/* Baixar ZIP Direto */}
                    <button
                      type="button"
                      onClick={() => handleDownloadSingleDirect(album)}
                      className="flex-1 min-w-[85px] flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 border border-brand-500/20 text-[11px] font-bold transition-all"
                      title={t.downloadZipTooltip}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {hasCustomSubset && customSel
                          ? `ZIP (${customSel.selectedImageUrls.length})`
                          : t.downloadZip}
                      </span>
                    </button>

                    {/* Extrair com o Agente (Aba Extrator) */}
                    <button
                      type="button"
                      onClick={() => handleExtractSingle(album.url)}
                      className="p-1.5 rounded-xl bg-surface border border-border hover:bg-surface-elevated hover:text-brand-400 text-slate-400 transition-colors"
                      title={t.openManualExtractor}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    {/* Link Original */}
                    <a
                      href={album.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-xl bg-surface border border-border hover:bg-surface-elevated hover:text-brand-400 text-slate-400 transition-colors"
                      title={t.openOriginalLink}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

              {displayedAlbums.length > visibleCount && (
                <div
                  ref={loadMoreSentinelRef}
                  className="flex flex-col items-center justify-center pt-8 pb-4 gap-3 border border-dashed border-border/60 rounded-2xl bg-surface/30 mt-4"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-brand-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      {isEn
                        ? `Showing ${visibleAlbums.length} of ${displayedAlbums.length} albums...`
                        : `Exibindo ${visibleAlbums.length} de ${displayedAlbums.length} álbuns...`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + 36)}
                    className="px-6 py-2.5 rounded-2xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-200 text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer hover:border-brand-500/40"
                  >
                    <Sparkles size={14} className="text-brand-400" />
                    <span>
                      {settings.language === 'en-US'
                        ? `Load Next 36 (${displayedAlbums.length - visibleAlbums.length} remaining)`
                        : `Carregar Mais 36 (${displayedAlbums.length - visibleAlbums.length} restantes)`}
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
          <div
            className={`px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur-xl flex items-center gap-3 text-xs sm:text-sm font-semibold ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                : toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
                : 'bg-brand-950/90 border-brand-500/40 text-brand-200'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toast.type === 'info' && <Sparkles className="w-4 h-4 text-brand-400 shrink-0" />}
            <span>{toast.message}</span>
            {toast.actionLabel && toast.onAction && (
              <button
                type="button"
                onClick={toast.onAction}
                className="ml-2 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all underline"
              >
                {toast.actionLabel}
              </button>
            )}
            <button type="button" onClick={() => setToast(null)} className="ml-2 hover:opacity-75">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Modal de Inspeção do Álbum e Seleção Individual de Imagens */}
      {inspectingAlbum && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex flex-col p-2 sm:p-5 overflow-hidden animate-in fade-in duration-200"
            onClick={handleConfirmAlbumImageSelection}
          >
            <div
              className="relative w-full max-w-7xl mx-auto flex-1 flex flex-col bg-slate-900/95 border border-border rounded-3xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top Header */}
              <div className="p-4 sm:p-5 border-b border-border bg-slate-950/60 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={handleConfirmAlbumImageSelection}
                    className="px-3 py-2 rounded-xl bg-surface-elevated hover:bg-brand-600/20 text-slate-200 hover:text-brand-300 border border-border hover:border-brand-500/40 text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
                    title={isEn ? 'Back to Multi-Album list keeping selection' : 'Voltar à lista de álbuns mantendo a seleção'}
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>{isEn ? 'Back to Albums' : 'Voltar aos Álbuns'}</span>
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                        {isEn ? 'IMAGE SELECTOR' : 'SELETOR DE IMAGENS DO ÁLBUM'}
                      </span>
                      <span className="text-xs font-mono font-bold text-cyan-300">
                        {draftSelectedImageUrls.size} / {albumPreviewImages.length} {isEn ? 'selected' : 'selecionadas'}
                      </span>
                    </div>
                    <h2 className="text-sm sm:text-base font-black text-white truncate mt-1" title={inspectingAlbum.title}>
                      {inspectingAlbum.title}
                    </h2>
                    <p className="text-[11px] text-slate-400 font-mono truncate">{inspectingAlbum.url}</p>
                  </div>
                </div>

                {/* Filter & Selection Toolbar */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Media Type Filter */}
                  {albumPreviewImages.some((i) => i.media_type === 'gif') && (
                    <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-border text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => setInspectorMediaFilter('all')}
                        className={`px-2.5 py-1 rounded-lg transition-all ${
                          inspectorMediaFilter === 'all' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {isEn ? 'All' : 'Todas'} ({albumPreviewImages.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectorMediaFilter('photo')}
                        className={`px-2.5 py-1 rounded-lg transition-all ${
                          inspectorMediaFilter === 'photo' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {isEn ? 'Photos' : 'Fotos'} ({albumPreviewImages.filter((i) => i.media_type !== 'gif').length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectorMediaFilter('gif')}
                        className={`px-2.5 py-1 rounded-lg transition-all ${
                          inspectorMediaFilter === 'gif' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        GIFs ({albumPreviewImages.filter((i) => i.media_type === 'gif').length})
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const visible = albumPreviewImages.filter((img) =>
                        inspectorMediaFilter === 'all' ? true : img.media_type === inspectorMediaFilter
                      );
                      const next = new Set(draftSelectedImageUrls);
                      visible.forEach((img) => next.add(img.original_url));
                      setDraftSelectedImageUrls(next);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-brand-400" />
                    <span>{t.selectAll}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const visible = albumPreviewImages.filter((img) =>
                        inspectorMediaFilter === 'all' ? true : img.media_type === inspectorMediaFilter
                      );
                      const next = new Set(draftSelectedImageUrls);
                      visible.forEach((img) => next.delete(img.original_url));
                      setDraftSelectedImageUrls(next);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-200 border border-border text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.deselectAll}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set<string>();
                      albumPreviewImages.forEach((img) => {
                        if (!draftSelectedImageUrls.has(img.original_url)) {
                          next.add(img.original_url);
                        }
                      });
                      setDraftSelectedImageUrls(next);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Filter className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isEn ? 'Invert' : 'Inverter'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openAlbumImageSelector(inspectingAlbum, true)}
                    disabled={isLoadingAlbumPreview}
                    className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border text-xs cursor-pointer disabled:opacity-50"
                    title={isEn ? 'Reload album images' : 'Recarregar imagens do álbum'}
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isLoadingAlbumPreview ? 'animate-spin' : ''}`} />
                  </button>

                  <button
                    type="button"
                    onClick={handleConfirmAlbumImageSelection}
                    className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 cursor-pointer"
                    title={t.closeLightbox}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Images Grid Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {isLoadingAlbumPreview ? (
                  <div className="h-72 flex flex-col items-center justify-center gap-3 text-slate-300">
                    <Loader2 className="w-10 h-10 animate-spin text-brand-400" />
                    <p className="text-sm font-bold">
                      {isEn ? 'Scanning album and extracting high-res image previews...' : 'Extraindo e inspecionando imagens deste álbum...'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {isEn ? 'You will be able to select exactly which photos or GIFs to download.' : 'Você poderá escolher exatamente quais fotos ou GIFs deseja baixar.'}
                    </p>
                  </div>
                ) : albumPreviewError ? (
                  <div className="h-64 flex flex-col items-center justify-center gap-3 text-rose-300 p-6 text-center">
                    <AlertCircle className="w-10 h-10 text-rose-400" />
                    <p className="text-sm font-bold">{albumPreviewError}</p>
                    <button
                      type="button"
                      onClick={() => openAlbumImageSelector(inspectingAlbum, true)}
                      className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center gap-2"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Try Again' : 'Tentar Novamente'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {albumPreviewImages
                      .filter((img) => (inspectorMediaFilter === 'all' ? true : img.media_type === inspectorMediaFilter))
                      .map((img) => {
                        const isImgSelected = draftSelectedImageUrls.has(img.original_url);
                        return (
                          <div
                            key={img.id || img.original_url}
                            style={{
                              contentVisibility: 'auto',
                              containIntrinsicSize: 'auto 240px',
                            }}
                            onClick={() => {
                              const next = new Set(draftSelectedImageUrls);
                              if (next.has(img.original_url)) {
                                next.delete(img.original_url);
                              } else {
                                next.add(img.original_url);
                              }
                              setDraftSelectedImageUrls(next);
                            }}
                            className={`group relative aspect-[4/5] rounded-2xl overflow-hidden border-2 cursor-pointer transition-all select-none bg-slate-950 ${
                              isImgSelected
                                ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-lg'
                                : 'border-slate-800/80 opacity-60 hover:opacity-95 hover:border-slate-600'
                            }`}
                          >
                            <img
                              src={img.thumbnail_url}
                              alt={img.filename || `Image #${img.position}`}
                              loading="lazy"
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />

                            {/* Top-left position & selection badge */}
                            <div className="absolute top-2 left-2 flex items-center gap-1.5">
                              <span
                                className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all shadow ${
                                  isImgSelected
                                    ? 'bg-emerald-500 border-emerald-300 text-white'
                                    : 'bg-black/70 border-white/25 text-white/70'
                                }`}
                              >
                                {isImgSelected ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <span className="text-[10px] font-mono">{img.position}</span>}
                              </span>
                              {img.media_type === 'gif' && (
                                <span className="px-1.5 py-0.5 rounded bg-fuchsia-600/90 text-white text-[9px] font-black uppercase">
                                  GIF
                                </span>
                              )}
                            </div>

                            {/* Zoom full image button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewImage(img.original_url);
                              }}
                              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-black text-white/80 hover:text-white border border-white/15 opacity-0 group-hover:opacity-100 transition-opacity"
                              title={t.viewRealSizeTooltip}
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>

                            {/* Bottom info bar */}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 pt-5 flex items-center justify-between text-[10px] text-slate-200 font-mono">
                              <span className="truncate">#{img.position}</span>
                              {img.width && img.height ? (
                                <span>{img.width}×{img.height}</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Sticky Footer Actions */}
              <div className="p-4 sm:p-5 border-t border-border bg-slate-950/90 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {isEn
                      ? `${draftSelectedImageUrls.size} of ${albumPreviewImages.length} images selected for this album.`
                      : `${draftSelectedImageUrls.size} de ${albumPreviewImages.length} imagens selecionadas neste álbum.`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
                  {/* Save Selection & Return to Multi-Album List */}
                  <button
                    type="button"
                    onClick={handleConfirmAlbumImageSelection}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {isEn
                        ? `Confirm Selection (${draftSelectedImageUrls.size}) & Back to Albums`
                        : `Confirmar Seleção (${draftSelectedImageUrls.size}) e Voltar aos Álbuns`}
                    </span>
                  </button>

                  {/* Save Directly to App Library Now */}
                  <button
                    type="button"
                    disabled={draftSelectedImageUrls.size === 0}
                    onClick={() => {
                      const selectedArr = Array.from(draftSelectedImageUrls);
                      const targetAlb = inspectingAlbum;
                      handleConfirmAlbumImageSelection();
                      if (settings.askFolderOnSave) {
                        setFolderModalState({
                          isOpen: true,
                          mode: 'single',
                          targetAlbum: targetAlb,
                          overrideSelectedUrls: selectedArr,
                        });
                      } else {
                        executeSaveSingleDirect(targetAlb, effectiveFolder, selectedArr);
                      }
                    }}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                  >
                    <FolderHeart className="w-4 h-4" />
                    <span>
                      {isEn
                        ? `Save ${draftSelectedImageUrls.size} to App Now`
                        : `Salvar ${draftSelectedImageUrls.size} no App Agora`}
                    </span>
                  </button>

                  {/* Download ZIP of Selected Images Now */}
                  <button
                    type="button"
                    disabled={draftSelectedImageUrls.size === 0}
                    onClick={() => {
                      const selectedArr = Array.from(draftSelectedImageUrls);
                      const targetAlb = inspectingAlbum;
                      handleConfirmAlbumImageSelection();
                      handleDownloadSingleDirect(targetAlb, selectedArr);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand-600/30 transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {isEn
                        ? `Download ZIP (${draftSelectedImageUrls.size})`
                        : `Baixar ZIP (${draftSelectedImageUrls.size})`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Lightbox Modal para visualizar miniatura sem cortes */}
      {previewImage && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setPreviewImage(null)}
          >
            <div
              className="relative max-w-4xl max-h-[92vh] bg-surface-elevated border border-border rounded-2xl overflow-hidden p-3 shadow-2xl flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/70 text-white/90 hover:bg-black/95 transition-all border border-white/20 shadow-lg"
                title={t.closeLightbox}
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={previewImage.startsWith('/api/') ? previewImage : `/api/proxy-image?url=${encodeURIComponent(previewImage)}`}
                alt={t.previewImageAlt || 'Preview'}
                className="max-h-[85vh] w-auto max-w-full rounded-xl object-contain shadow-inner"
              />
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Folder Select Modal for MultiAlbumView */}
      <FolderSelectModal
        isOpen={folderModalState.isOpen}
        onClose={() => setFolderModalState({ isOpen: false, mode: 'single' })}
        title={folderModalState.mode === 'batch' 
          ? t.folderModalBatchTitle.replace('{count}', String(selectedUrls.size))
          : t.folderModalSingleTitle}
        subtitle={t.folderModalSubtitle}
        existingFolders={albumFolders.map(f => f.name)}
        defaultFolder={destinationFolder.trim() || settings.defaultAlbumFolder || performerName.trim() || (t.folderPlaceholder || 'General')}
        type="album"
        onConfirm={(selectedFolder: string) => {
          setDestinationFolder(selectedFolder);
          if (folderModalState.mode === 'batch') {
            executeBatchSaveToApp(selectedFolder);
          } else if (folderModalState.targetAlbum) {
            executeSaveSingleDirect(folderModalState.targetAlbum, selectedFolder, folderModalState.overrideSelectedUrls);
          }
        }}
      />
    </div>
  );
};
