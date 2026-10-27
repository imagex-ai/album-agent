const getIsEn = () => {
  if (typeof window !== 'undefined') {
    try {
      const s = localStorage.getItem('imagex_settings');
      if (s) return JSON.parse(s).language === 'en-US';
    } catch (_) {}
  }
  return false;
};
import { translations } from "../i18n/translations";
import { exitAllFullscreen } from "../services/desktopService";
import { create } from 'zustand';
import {
  Album,
  AlbumFolder,
  AppSettings,
  ChatMessage,
  DomainPattern,
  ExtractionJob,
  GalleryViewMode,
  ImageItem,
  LogEntry,
  NotificationItem,
  SessionTab,
  SetOfMarkCandidate,
  ViewId,
  AiEngineType,
  VideoItem,
  VideoFolder,
  TrashItem,
  TrashStats,
  WebScraperState,
  OllamaHealthStatus,
  OllamaModelInfo,
  MultiAlbumCustomSelection,
  GlobalSliderConfig
} from '../types';
import {
  INITIAL_ALBUMS,
  INITIAL_JOBS,
  INITIAL_LOGS,
  INITIAL_PATTERNS,
  INITIAL_SET_OF_MARKS
} from '../services/mockData';
import { soundEffects } from '../services/soundEffects';
import { ambientAudio } from '../services/ambientAudio';
import { backendApi } from '../services/realApi';
import { scrollRestorationManager, getViewScrollKey } from '../services/scrollRestoration';
import { matchesPaletteFuzzy, colorPaletteCache } from '../services/colorExtractor';

const DEFAULT_SETTINGS: AppSettings = {
  aiModel: 'qwen2.5:32b',
  geminiModel: 'gemini-3.6-flash',
  reasoningBudget: 3,
  temperature: 0.2,
  maxConcurrency: 6,
  requestTimeoutSeconds: 30,
  antiBotDelayMs: 500,
  userAgentRotation: true,
  minWidth: 1920,
  minHeight: 1080,
  discardDuplicates: true,
  theme: 'dark-slate',
  accent: 'blue',
  language: 'en-US',
  soundEnabled: true,
  ambientSoundVolume: 0.3,
  ambientSoundType: 'none',
  defaultFilenamePattern: '{album}_{index}_{res}.jpg',
  autoSaveToGallery: true,
  zipCompressionLevel: 6,
  removeExifOnExport: false,
  askFolderOnSave: true,
  defaultVideoFolder: getIsEn() ? 'Extracted' : 'Extraídos',
  defaultAlbumFolder: 'Geral',
  redirectTagBehavior: 'navigate',
  aiChatProvider: 'gemini',
  ollamaBaseUrl: 'http://localhost:11434',
  selectedOllamaModel: 'llama3.2',
  geminiChatModel: 'gemini-3.7-flash',
  lightboxOpenAnimation: 'expand',
  imageSwitchAnimation: 'switch',
  slideshowAnimation: 'switch',
  fullscreenAnimation: 'elastic',
  animationSpeed: 'normal',
  animationDistance: 'normal',
  disableAllAnimations: false,
  viewTransitionAnimation: 'fade',
  modalAnimation: 'scale',
  drawerAnimation: 'slide',
  taskDockAnimation: 'slide-up',
  videoPlayerAnimation: 'zoom',
};

interface AppState {
  // Navigation & Sessions
  currentView: ViewId;
  openTabs: SessionTab[];
  activeTabId: string;
  activeAlbumId: string | null;

  // Data
  albums: Album[];
  jobs: ExtractionJob[];
  logs: LogEntry[];
  domainPatterns: DomainPattern[];
  setOfMarks: SetOfMarkCandidate[];
  inspectingMarkId: number | null;
  notifications: NotificationItem[];
  settings: AppSettings;
  activeAiEngine: AiEngineType;

  // Active Background Job (Spotify Dock)
  activeJob: ExtractionJob | null;
  activeJobs: ExtractionJob[];
  isDockMinimized: boolean;
  setDockMinimized: (minimized: boolean) => void;
  setActiveJobById: (id: string) => void;
  isMobileBottomBarMinimized: boolean;
  setIsMobileBottomBarMinimized: (minimized: boolean) => void;
  sessionJobIds: string[];
  dismissedDockJobIds: string[];
  dismissDockJob: (id: string) => void;
  dismissAllDockJobs: () => void;

  // Gallery Filters & View Controls
  galleryViewMode: GalleryViewMode;
  gallerySearchQuery: string;
  galleryColorFilter: string | null;
  galleryTagFilter: string | null;
  gallerySortBy: 'date' | 'recent' | 'modified' | 'favorites' | 'name' | 'count' | 'resolution' | 'size';
  gallerySortOrder: 'asc' | 'desc';
  selectedAlbumIds: string[];

  // Album Detail Controls
  albumDetailZoomCols: number;
  selectedImageIds: string[];
  albumColorFilter: string | null;

  // Modals & Drawers
  lightboxImage: ImageItem | null;
  lightboxAlbum: Album | null;
  lightboxOriginRect: { x: number; y: number; width: number; height: number } | null;
  lightboxAnimationMode: 'open' | 'switch' | 'fullscreen';
  lightboxAnimCounter: number;
  slideshowOpen: boolean;
  slideshowInitialIndex: number;
  slideshowMode: 'album' | 'global';
  globalSliderConfig: GlobalSliderConfig;
  contactSheetOpen: boolean;
  coPilotOpen: boolean;
  exportModalOpen: boolean;
  exportModalAlbum: Album | null;
  keybindingsModalOpen: boolean;
  webhookModalOpen: boolean;
  commandPaletteOpen: boolean;
  notificationDrawerOpen: boolean;
  albumDiffModalOpen: boolean;
  colorHarmonyOpen: boolean;
  aiChatOpen: boolean;
  aiChatMessages: ChatMessage[];
  ollamaStatus: OllamaHealthStatus | null;
  ollamaModels: OllamaModelInfo[];
  isCheckingOllama: boolean;
  backendOnline: boolean;
  availableModels: string[];

  // Videos Module
  videos: VideoItem[];
  videoFolders: VideoFolder[];
  activeVideoFolder: string | null;
  videoSearchQuery: string;
  videoFilterFavoritesOnly: boolean;
  activePlayingVideo: VideoItem | null;
  activeFolderModal: { type: 'create' | 'rename' | 'move'; folderName?: string; videoId?: string; videoIds?: string[] } | null;
  selectedVideoIds: string[];
  uploadProgress: {
    isUploading: boolean;
    filename: string;
    percent: number;
    loaded: number;
    total: number;
    speed: number;
    currentFileIndex: number;
    totalFiles: number;
  } | null;

  // Video Actions
  isRenewingVideoStreams: boolean;
  renewVideoStreams: (videoIds?: string[], folder?: string) => Promise<{ succeeded: number; failed: number }>;
  syncVideos: (healThumbnails?: boolean) => Promise<void>;
  uploadVideo: (file: File, folder?: string, fileIndex?: number, totalFiles?: number) => Promise<boolean>;
  importLocalPath: (path: string, folder?: string, mode?: 'copy' | 'move') => Promise<boolean>;
  openVideosFolder: (folder?: string) => Promise<boolean>;
  addVideoByUrl: (url: string, folder?: string, title?: string, streamOnly?: boolean) => Promise<boolean>;
  uploadPhotoAlbum: (title: string, files: File[], folder?: string) => Promise<boolean>;
  createVideoFolder: (name: string) => Promise<boolean>;
  renameVideoFolder: (oldName: string, newName: string) => Promise<boolean>;
  deleteVideoFolder: (folderName: string) => Promise<boolean>;
  renameVideo: (videoId: string, title: string) => Promise<boolean>;
  moveVideo: (videoId: string, targetFolder: string) => Promise<boolean>;
  toggleVideoFavorite: (videoId: string) => Promise<boolean>;
  deleteVideo: (videoId: string) => Promise<boolean>;
  toggleSelectVideo: (id: string) => void;
  selectAllVideos: (allIds: string[]) => void;
  clearSelectedVideos: () => void;
  batchDeleteVideos: (videoIds: string[]) => Promise<boolean>;
  batchMoveVideos: (videoIds: string[], targetFolder: string) => Promise<boolean>;
  setActiveVideoFolder: (folder: string | null) => void;
  setVideoSearchQuery: (query: string) => void;
  setVideoFilterFavoritesOnly: (favOnly: boolean) => void;
  setActivePlayingVideo: (video: VideoItem | null) => void;
  setActiveFolderModal: (modal: { type: 'create' | 'rename' | 'move'; folderName?: string; videoId?: string; videoIds?: string[] } | null) => void;

  // Trash Bin State & Actions
  trashItems: TrashItem[];
  trashStats: TrashStats;
  selectedTrashIds: string[];
  trashFilterType: 'all' | 'photo' | 'video' | 'album';
  trashSearchQuery: string;
  fetchTrash: () => Promise<void>;
  restoreTrashItems: (trashIds: string[]) => Promise<boolean>;
  permanentDeleteTrashItems: (trashIds: string[]) => Promise<boolean>;
  emptyTrashBin: () => Promise<boolean>;
  toggleSelectTrashItem: (id: string) => void;
  selectAllTrashItems: (allIds: string[]) => void;
  clearSelectedTrashItems: () => void;
  setTrashFilterType: (type: 'all' | 'photo' | 'video' | 'album') => void;
  setTrashSearchQuery: (query: string) => void;

  // Actions
  syncBackendData: () => Promise<void>;
  syncJobs: () => Promise<void>;
  setAiChatOpen: (open: boolean) => void;
  setAiChatProvider: (provider: 'gemini' | 'ollama') => void;
  checkOllamaHealth: (urlOverride?: string) => Promise<OllamaHealthStatus>;
  sendAiChatMessage: (text: string, forceProvider?: 'gemini' | 'ollama') => Promise<void>;
  navigateToView: (viewId: ViewId, albumId?: string) => void;
  openTab: (tab: Omit<SessionTab, 'id'>) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Data Actions
  addAlbum: (album: Album) => void;
  updateAlbum: (id: string, updates: Partial<Album>) => void;
  setAlbumCover: (albumId: string, coverImageUrl: string) => Promise<boolean>;
  deleteAlbum: (id: string) => Promise<void> | void;
  refreshAlbumStreams: (albumId: string) => Promise<boolean>;
  isRenewingBatchStreams: boolean;
  batchRenewProgress: { current: number; total: number } | null;
  refreshBatchAlbumStreams: (albumIds: string[]) => Promise<{ succeeded: number; failed: number }>;
  removeImagesFromAlbum: (albumId: string, imageIds: string[]) => Promise<void> | void;
  renameAlbumImage: (albumId: string, imageId: string, newTitle: string) => Promise<boolean>;
  toggleFavoriteAlbum: (id: string) => void;
  toggleFavoriteImage: (albumId: string, imageId: string) => void;

  addJob: (job: ExtractionJob) => void;
  updateJob: (id: string, updates: Partial<ExtractionJob>) => void;
  setActiveJob: (job: ExtractionJob | null) => void;
  cancelJob: (id: string) => Promise<void>;
  pauseJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
  deleteJob: (id: string) => void;
  clearCompletedJobs: () => Promise<void> | void;
  pauseAllJobs: () => Promise<void>;
  resumeAllJobs: () => Promise<void>;
  retryAllFailedJobs: () => Promise<void>;
  clearActiveJob: () => void;
  subscribeToJob: (sessionId: string, url: string) => void;
  retryJob: (job: ExtractionJob) => Promise<boolean>;

  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;

  addNotification: (notif: Omit<NotificationItem, 'id' | 'timestamp' | 'isRead'>) => void;
  markNotificationsAsRead: () => void;

  updateSettings: (updates: Partial<AppSettings>) => void;
  setActiveAiEngine: (engine: AiEngineType) => void;

  // Selection Actions
  toggleSelectImage: (id: string) => void;
  selectAllImages: (allIds: string[]) => void;
  clearSelectedImages: () => void;
  selectOnlyOriginalImages: (images: ImageItem[]) => void;

  toggleSelectAlbum: (id: string) => void;
  selectAllAlbums: (allIds: string[]) => void;
  clearSelectedAlbums: () => void;

  // Modal Triggers
  openLightbox: (image: ImageItem, album?: Album, originRect?: { x: number; y: number; width: number; height: number } | null) => void;
  closeLightbox: () => void;
  setLightboxFullscreen: (fullscreen: boolean) => void;
  setSlideshowOpen: (open: boolean, initialIndex?: number, mode?: 'album' | 'global') => void;
  setGlobalSliderConfig: (partial: Partial<GlobalSliderConfig>) => void;
  setContactSheetOpen: (open: boolean) => void;
  setCoPilotOpen: (open: boolean) => void;
  openExportModal: (album: Album) => void;
  closeExportModal: () => void;
  setKeybindingsModalOpen: (open: boolean) => void;
  setWebhookModalOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setNotificationDrawerOpen: (open: boolean) => void;
  setAlbumDiffModalOpen: (open: boolean) => void;
  setColorHarmonyOpen: (open: boolean) => void;

  // View Controls
  setGalleryViewMode: (mode: GalleryViewMode) => void;
  setGallerySearchQuery: (query: string) => void;
  setGalleryColorFilter: (color: string | null) => void;
  setGalleryTagFilter: (tag: string | null) => void;
  setGallerySortBy: (sortBy: 'date' | 'name' | 'count' | 'resolution' | 'size') => void;
  toggleGallerySortOrder: () => void;
  setAlbumDetailZoomCols: (cols: number) => void;
  setAlbumColorFilter: (color: string | null) => void;

  // Extractor Media Filter
  mediaTypeFilter: 'all' | 'images' | 'videos' | 'gifs';
  setMediaTypeFilter: (filter: 'all' | 'images' | 'videos' | 'gifs') => void;
  saveExtractedVideoToGallery: (videoUrl: string, title?: string, folder?: string, sourceUrl?: string, thumbnailUrl?: string, streamOnly?: boolean) => Promise<boolean>;

  // Multi-Album Persistent State & Actions
  multiAlbumState: {
    url: string;
    performerName: string;
    maxRelated: number;
    maxPages?: number;
    pagesScanned?: number;
    results: any[];
    streamingStatus: string;
    lastSearchedPerformer: string | null;
    selectedUrls: string[];
    customSelections?: Record<string, MultiAlbumCustomSelection>;
    activeInspectingUrl?: string | null;
  };
  setMultiAlbumState: (partial: Partial<{
    url: string;
    performerName: string;
    maxRelated: number;
    maxPages?: number;
    pagesScanned?: number;
    results: any[];
    streamingStatus: string;
    lastSearchedPerformer: string | null;
    selectedUrls: string[];
    customSelections: Record<string, MultiAlbumCustomSelection>;
    activeInspectingUrl: string | null;
  }>) => void;
  clearMultiAlbumState: () => void;
  syncAlbums: () => Promise<void>;

  // Album Folders State & Actions
  albumFolders: AlbumFolder[];
  activeAlbumFolder: string | null;
  activeAlbumFolderModal: { type: 'create' | 'rename' | 'move'; folderName?: string; albumId?: string; albumIds?: string[] } | null;
  syncAlbumFolders: () => Promise<void>;
  setActiveAlbumFolder: (folder: string | null) => void;
  setActiveAlbumFolderModal: (modal: { type: 'create' | 'rename' | 'move'; folderName?: string; albumId?: string; albumIds?: string[] } | null) => void;
  createAlbumFolder: (name: string) => Promise<boolean>;
  renameAlbumFolder: (oldName: string, newName: string) => Promise<boolean>;
  deleteAlbumFolder: (name: string) => Promise<boolean>;
  moveAlbumsToFolder: (albumIds: string[], targetFolder: string) => Promise<boolean>;

  // Web Video Scraper Persistent State & Actions
  webScraperState: WebScraperState;
  setWebScraperState: (partial: Partial<WebScraperState>) => void;
  clearWebScraperState: () => void;

  // Highlight & Cross-Tab Navigation
  highlightedItemId: string | null;
  setHighlightedItemId: (id: string | null) => void;
  navigateToSavedItem: (targetView: 'videos' | 'gallery', folder: string, itemId: string) => void;
  checkItemSavedStatus: (params: {
    url?: string;
    title?: string;
    height?: number;
    width?: number;
    candidateId?: string;
    mediaType?: 'photo' | 'video' | 'album' | string;
  }) => {
    isSaved: boolean;
    isExactDuplicate: boolean;
    hasAlternativeResolution: boolean;
    savedFolder: string;
    folder: string;
    targetId: string;
    targetView: 'videos' | 'gallery';
    qualityLabel?: string;
  };

  // Optimistic Saved Registry
  optimisticSavedItems: Record<string, { folder: string; targetId: string; targetView: 'videos' | 'gallery'; timestamp: number }>;
  markItemAsSavedOptimistically: (params: { url?: string; title?: string; folder: string; targetId?: string; targetView?: 'videos' | 'gallery' }) => void;
}

export const mapServerJobToExtractionJob = (raw: any): ExtractionJob => {
  const isVideoSave = raw.mode === 'video_save' || raw.engine_type === 'video_downloader' || raw.engine_type === 'video_stream_register';
  const isFinished = raw.status === 'completed';
  const progStatus = String(raw.progress?.status || '');
  const isCancelled = raw.status === 'cancelled' || progStatus.toLowerCase().includes('cancelad');
  const isFailed = raw.status === 'failed' || raw.status === 'error';
  const isPaused = !isFinished && !isCancelled && !isFailed && (
    raw.status === 'paused' || progStatus.toLowerCase().includes('pausad')
  );
  const isQueued = !isFinished && !isCancelled && !isFailed && !isPaused && (
    raw.status === 'queued' ||
    progStatus.includes('Na fila') ||
    progStatus.includes('Aguardando')
  );
  const isActivelyWorking = !isFinished && !isCancelled && !isFailed && !isPaused && !isQueued && (
    raw.status === 'running' ||
    raw.status === 'active' ||
    progStatus.includes('Baixando') ||
    progStatus.includes('Reconectando') ||
    progStatus.includes('motor resiliente') ||
    progStatus.includes('Resolvendo') ||
    progStatus.includes('Registrando') ||
    progStatus.includes('Gerando miniatura') ||
    progStatus.includes('Iniciando') ||
    progStatus.includes('Inspecionada') ||
    progStatus.includes('Resolved') ||
    progStatus.includes('Álbum') ||
    progStatus.includes('Buscando') ||
    progStatus.includes('Analisando')
  );

  const status = isFinished
    ? 'completed'
    : isCancelled
    ? 'cancelled'
    : isFailed
    ? 'failed'
    : isPaused
    ? 'paused'
    : isQueued
    ? 'queued'
    : isActivelyWorking
    ? 'active'
    : (raw.status || 'paused');

  const total = isVideoSave ? (raw.total_bytes || raw.progress?.total_bytes || 1) : (raw.progress?.total || raw.resolved_count || 1);
  const current = isVideoSave ? (raw.downloaded_bytes || raw.progress?.downloaded_bytes || 0) : (raw.progress?.current || raw.resolved_count || 0);
  const percent = isFinished ? 100 : (raw.progress?.percent !== undefined ? raw.progress.percent : Math.round((current / Math.max(1, total)) * 100));
  let domain = 'web-source';
  try {
    domain = new URL(raw.url.startsWith('http') ? raw.url : 'https://' + raw.url).hostname;
  } catch (_) {}

  return {
    id: raw.session_id,
    url: raw.url,
    title: raw.progress?.title || (isVideoSave ? (getIsEn() ? 'Save Video' : 'Salvar Vídeo') : (getIsEn() ? `Extraction: ${domain}` : `Extração: ${domain}`)),
    status,
    mode: (raw.mode || raw.engine_type || 'ai_react') as any,
    progressPercent: isFinished ? 100 : Math.min(99, Math.max(1, percent)),
    discoveredImagesCount: isVideoSave ? 1 : total,
    resolvedOriginalCount: isVideoSave ? (isFinished ? 1 : 0) : current,
    failedCount: 0,
    currentStage: isFinished ? (isVideoSave ? (getIsEn() ? 'Video Saved Successfully!' : 'Vídeo Salvo com Sucesso!') : (getIsEn() ? 'Extraction 100% Completed!' : 'Extração 100% Concluída!')) : (raw.progress?.status || (isPaused ? (getIsEn() ? 'Paused by user' : 'Pausado pelo usuário') : isCancelled ? (getIsEn() ? 'Cancelled by user' : 'Cancelado pelo usuário') : (getIsEn() ? 'Processing in background...' : 'Processando em segundo plano...'))),
    startTime: raw.started_at || new Date().toISOString(),
    durationSeconds: raw.duration_seconds || (isFinished ? Math.max(2, current * 1.5) : 0),
    throughputMbps: raw.throughput_mbps || raw.progress?.throughput_mbps || (current > 0 && (raw.duration_seconds || 1) > 0 ? parseFloat(((current * 2.8) / (raw.duration_seconds || 1)).toFixed(1)) : 0),
    fps: 60,
    aiModel: raw.model || (isVideoSave ? 'Direct Stream Downloader' : 'qwen2.5:32b'),
    resultAlbumId: isVideoSave ? undefined : (isFinished ? raw.session_id : undefined),
    downloadedBytes: raw.downloaded_bytes || raw.progress?.downloaded_bytes || 0,
    totalBytes: raw.total_bytes || raw.progress?.total_bytes || 0,
    folder: raw.folder || (getIsEn() ? 'Extracted' : 'Extraídos'),
    videoId: raw.video_id
  };
};

let isPollingJobs = false;
const activeSSESubscriptions = new Map<string, () => void>();

export const triggerJobsPollingLoop = () => {
  if (isPollingJobs) return;
  isPollingJobs = true;

  const tick = async () => {
    try {
      await useAppStore.getState().syncJobs();
    } catch (_) {}
    const hasActive = useAppStore.getState().jobs.some(j => j.status === 'active' || j.status === 'queued' || j.status === 'paused');
    setTimeout(tick, hasActive ? 1200 : 5000);
  };
  setTimeout(tick, 1000);
};

export const getCanonicalMediaFingerprint = (title?: string, url?: string, height?: number): string => {
  // 1. Limpeza de Título (remove extensões, timestamps, resoluções e sufixos de sites)
  let cleanTitle = (title || '').trim().toLowerCase();
  cleanTitle = cleanTitle.replace(/\.(mp4|m4v|mkv|webm|avi|mov)$/i, '');
  // Remove sufixos de timestamp (ex: _1790476557, 1790476557 ou 1790494749)
  cleanTitle = cleanTitle.replace(/[_\s-]\d{9,12}(\s|$)/g, '$1');
  cleanTitle = cleanTitle.replace(/\d{9,12}$/g, '');
  // Remove marcas de resolução anexadas no título
  cleanTitle = cleanTitle.replace(/[_\s-](4k|2160p|1440p|1080p(\s*fhd|\s*hd)?|720p(\s*hd)?|480p|360p|240p)(\s|$)/gi, '$3');
  // Remove sufixos de sites e buscadores
  cleanTitle = cleanTitle.replace(/\s*[-–|•]\s*(?:watch online.*|[a-z0-9_-]+\s+video\s+search|[a-z0-9_-]+\.[a-z]{2,}).*$/i, '');
  // Remove pontuações e compacta espaços
  cleanTitle = cleanTitle.replace(/[_\-\.\,\:\;\|\(\)\[\]\/\\]+/g, ' ').replace(/\s+/g, ' ').trim();

  // 2. Chave Canônica de Origem / URL
  let canonicalKey = '';
  if (url && !url.includes('/api/videos/')) {
    const mPh = url.match(/viewkey=([a-zA-Z0-9]+)/i);
    const mEp = url.match(/video-([a-zA-Z0-9]{6,})/i);
    const mPvv = url.match(/\/videos\/(-?\d+\/\d+\/[a-zA-Z0-9_]+)/i);
    if (mPh) {
      canonicalKey = `ph:${mPh[1]}`;
    } else if (mEp) {
      canonicalKey = `ep:${mEp[1]}`;
    } else if (mPvv) {
      canonicalKey = `pvv:${mPvv[1]}`;
    } else {
      try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        canonicalKey = parsed.pathname.toLowerCase().replace(/\/$/, '');
      } catch {
        canonicalKey = url.split('?')[0].toLowerCase();
      }
    }
  }

  // 3. Faixa de Resolução (balde de 100px para separar 720p de 1080p)
  const resBucket = height ? Math.round(height / 100) * 100 : 'any';

  if (canonicalKey && !canonicalKey.endsWith('/stream')) {
    return `${canonicalKey}::${resBucket}`;
  }

  return `${cleanTitle}::${resBucket}`;
};

export const useAppStore = create<AppState>((set, get) => {
  // Load initial settings, tabs, filters, and history from localStorage if available
  let savedSettings = DEFAULT_SETTINGS;
  let savedTabs: SessionTab[] = [
    { id: 'tab-home-default', title: getIsEn() ? 'Home' : 'Início', viewId: 'home', isClosable: false }
  ];
  let savedActiveTabId = 'tab-home-default';
  let savedCurrentView: ViewId = 'home';
  let savedActiveAlbumId: string | null = null;
  let savedLogs: LogEntry[] = [];
  let savedGalleryViewMode: GalleryViewMode = 'grid-lg';
  let savedGallerySortBy: 'date' | 'name' | 'count' | 'resolution' | 'size' = 'date';
  let savedGallerySortOrder: 'asc' | 'desc' = 'desc';
  let savedAlbumZoomCols = 4;
  let savedChatMessages: ChatMessage[] = [];
  let savedNotifications: NotificationItem[] = [];
  let savedDomainPatterns: DomainPattern[] = [];
  let savedActiveJob: ExtractionJob | null = null;
  let savedDockMinimized = false;
  let savedMultiAlbumState = {
    url: '',
    performerName: '',
    maxRelated: 0,
    maxPages: 50,
    pagesScanned: 0,
    results: [] as any[],
    streamingStatus: '',
    lastSearchedPerformer: null as string | null,
    selectedUrls: [] as string[],
    customSelections: {} as Record<string, MultiAlbumCustomSelection>,
    activeInspectingUrl: null as string | null
  };
  let savedWebScraperState: WebScraperState = {
    url: '',
    scanResult: null,
    selectedIds: [],
    targetFolder: getIsEn() ? 'Extracted' : 'Extraídos',
    errorMsg: null,
    videoAlbums: [],
    selectedAlbumIds: [],
    activeInspectingAlbumId: null,
    viewLayout: 'albums'
  };

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('imagex_settings');
      if (stored) savedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };

      const storedTabs = localStorage.getItem('imagex_open_tabs');
      if (storedTabs) {
        const parsed = JSON.parse(storedTabs);
        if (Array.isArray(parsed)) {
          savedTabs = parsed.map((t: any) => ({
            ...t,
            isClosable: t.viewId !== 'home' ? true : t.isClosable
          }));
        }
      }

      const storedActiveTab = localStorage.getItem('imagex_active_tab');
      if (storedActiveTab) savedActiveTabId = storedActiveTab;

      const storedView = localStorage.getItem('imagex_current_view');
      if (storedView) savedCurrentView = storedView as ViewId;

      const storedAlbum = localStorage.getItem('imagex_active_album');
      if (storedAlbum) savedActiveAlbumId = storedAlbum;

      const storedLogs = localStorage.getItem('imagex_logs');
      if (storedLogs) {
        const parsed = JSON.parse(storedLogs);
        if (Array.isArray(parsed)) savedLogs = parsed;
      }

      const storedGMode = localStorage.getItem('imagex_gallery_view_mode');
      if (storedGMode && storedGMode !== 'coverflow-3d') savedGalleryViewMode = storedGMode as GalleryViewMode;

      const storedGSort = localStorage.getItem('imagex_gallery_sort_by');
      if (storedGSort) savedGallerySortBy = storedGSort as any;

      const storedGOrder = localStorage.getItem('imagex_gallery_sort_order');
      if (storedGOrder) savedGallerySortOrder = storedGOrder as any;

      const storedZoom = localStorage.getItem('imagex_album_zoom_cols');
      if (storedZoom) savedAlbumZoomCols = Number(storedZoom) || 4;

      const storedChat = localStorage.getItem('imagex_ai_chat');
      if (storedChat) {
        const parsed = JSON.parse(storedChat);
        if (Array.isArray(parsed)) savedChatMessages = parsed;
      }

      const storedNotifs = localStorage.getItem('imagex_notifications');
      if (storedNotifs) {
        const parsed = JSON.parse(storedNotifs);
        if (Array.isArray(parsed)) savedNotifications = parsed;
      }

      const storedPatterns = localStorage.getItem('imagex_domain_patterns');
      if (storedPatterns) {
        const parsed = JSON.parse(storedPatterns);
        if (Array.isArray(parsed)) savedDomainPatterns = parsed;
      }

      const storedJob = localStorage.getItem('imagex_active_job');
      if (storedJob) {
        const parsedJob = JSON.parse(storedJob);
        if (parsedJob && parsedJob.status !== 'completed' && parsedJob.status !== 'failed' && parsedJob.status !== 'cancelled') {
          savedActiveJob = parsedJob;
        }
      }

      const storedMinimized = localStorage.getItem('imagex_dock_minimized');
      if (storedMinimized !== null) {
        savedDockMinimized = storedMinimized === 'true';
      }

      const storedMulti = localStorage.getItem('imagex_multi_album_state');
      if (storedMulti) {
        const parsed = JSON.parse(storedMulti);
        if (parsed && typeof parsed === 'object') {
          savedMultiAlbumState = { ...savedMultiAlbumState, ...parsed };
        }
      }

      const storedWebScraper = localStorage.getItem('imagex_web_scraper_state');
      if (storedWebScraper) {
        const parsed = JSON.parse(storedWebScraper);
        if (parsed && typeof parsed === 'object') {
          savedWebScraperState = { ...savedWebScraperState, ...parsed };
        }
      }
    } catch (_) {}
  }

  if (savedTabs.length === 0) {
    savedTabs = [
      { id: 'tab-home-default', title: savedSettings.language === 'en-US' ? 'Home' : 'Início', viewId: 'home', isClosable: false }
    ];
    savedActiveTabId = 'tab-home-default';
    savedCurrentView = 'home';
  } else if (!savedTabs.some(t => t.id === savedActiveTabId)) {
    savedActiveTabId = savedTabs[0].id;
    savedCurrentView = savedTabs[0].viewId;
    savedActiveAlbumId = savedTabs[0].albumId || null;
  }

  const persistNav = (tabs: SessionTab[], activeTab: string, view: ViewId, albumId: string | null) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('imagex_open_tabs', JSON.stringify(tabs));
        localStorage.setItem('imagex_active_tab', activeTab);
        localStorage.setItem('imagex_current_view', view);
        if (albumId) localStorage.setItem('imagex_active_album', albumId);
        else localStorage.removeItem('imagex_active_album');
      } catch (_) {}
    }
  };

  return {
    currentView: savedCurrentView,
    openTabs: savedTabs,
    activeTabId: savedActiveTabId,
    activeAlbumId: savedActiveAlbumId,

    multiAlbumState: savedMultiAlbumState,
    webScraperState: savedWebScraperState,

    albums: [],
    isRenewingBatchStreams: false,
    batchRenewProgress: null,
    jobs: [],
    logs: savedLogs,
    domainPatterns: savedDomainPatterns,
    setOfMarks: [],
    inspectingMarkId: null,
    notifications: savedNotifications,
    settings: savedSettings,
    activeAiEngine: (savedSettings.defaultAiEngine as AiEngineType) || 'gemini_surgical_scout',

    activeJob: savedActiveJob,
    activeJobs: savedActiveJob ? [savedActiveJob] : [],
    isDockMinimized: savedDockMinimized,
    isMobileBottomBarMinimized: false,
    sessionJobIds: [],
    dismissedDockJobIds: (() => {
      if (typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('imagex_dismissed_dock_jobs');
          if (stored) return JSON.parse(stored);
        } catch (_) {}
      }
      return [];
    })(),

    setDockMinimized: (minimized: boolean) => {
      set({ isDockMinimized: minimized });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('imagex_dock_minimized', minimized ? 'true' : 'false');
        } catch (_) {}
      }
    },

    setIsMobileBottomBarMinimized: (minimized: boolean) => {
      set({ isMobileBottomBarMinimized: minimized });
    },

    setActiveJobById: (id: string) => {
      const target = get().jobs.find(j => j.id === id);
      if (target) {
        set({ activeJob: target });
      }
    },

    dismissDockJob: (id: string) => {
      set(state => {
        const next = Array.from(new Set([...state.dismissedDockJobIds, id]));
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_dismissed_dock_jobs', JSON.stringify(next));
          } catch (_) {}
        }
        return {
          dismissedDockJobIds: next,
          sessionJobIds: state.sessionJobIds.filter(jid => jid !== id)
        };
      });
    },

    dismissAllDockJobs: () => {
      set(state => {
        const currentIds = Array.from(new Set([...state.jobs.map(j => j.id), ...state.sessionJobIds]));
        const next = Array.from(new Set([...state.dismissedDockJobIds, ...currentIds]));
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_dismissed_dock_jobs', JSON.stringify(next));
          } catch (_) {}
        }
        return {
          dismissedDockJobIds: next,
          sessionJobIds: []
        };
      });
    },

    galleryViewMode: savedGalleryViewMode,
    gallerySearchQuery: '',
    galleryColorFilter: null,
    galleryTagFilter: null,
    gallerySortBy: savedGallerySortBy,
    gallerySortOrder: savedGallerySortOrder,
    selectedAlbumIds: [],

    albumDetailZoomCols: savedAlbumZoomCols,
    selectedImageIds: [],
    albumColorFilter: null,

    lightboxImage: null,
    lightboxAlbum: null,
    lightboxOriginRect: null,
    lightboxAnimationMode: 'open',
    lightboxAnimCounter: 0,
    slideshowOpen: false,
    slideshowInitialIndex: 0,
    slideshowMode: 'album',
    globalSliderConfig: {
      scope: 'all_app',
      mediaFilter: 'all',
      sequenceMode: 'random',
      alphabeticalOrder: 'asc',
      selectedArtist: '',
      selectedFolder: '',
      recentDaysLimit: 0,
      sizeSortOrder: 'desc',
      minResolution: 'all',
      minResolutionFilter: 'all',
      orientationFilter: 'all',
      onlyFavorites: false,
      speedSeconds: 3,
      kenBurnsEffect: true,
      shuffleSeed: 1,
    },
    contactSheetOpen: false,
    coPilotOpen: false,
    exportModalOpen: false,
    exportModalAlbum: null,
    keybindingsModalOpen: false,
    webhookModalOpen: false,
    commandPaletteOpen: false,
    notificationDrawerOpen: false,
    albumDiffModalOpen: false,
    colorHarmonyOpen: false,
    aiChatOpen: false,
    ollamaStatus: null,
    ollamaModels: [],
    isCheckingOllama: false,
    backendOnline: false,
    availableModels: ['qwen2.5:32b', 'qwen3:14b', 'qwen3:8b', 'qwen2.5:14b', 'qwen2.5:7b', 'qwen2.5:3b'],
    albumFolders: [
      { id: 'Geral', name: 'Geral', count: 0 }
    ],
    activeAlbumFolder: null,
    activeAlbumFolderModal: null,
    highlightedItemId: null,
    optimisticSavedItems: {},
    videos: [],
    videoFolders: [],
    activeVideoFolder: null,
    videoSearchQuery: '',
    videoFilterFavoritesOnly: false,
    isRenewingVideoStreams: false,
    activePlayingVideo: null,
    activeFolderModal: null,
    selectedVideoIds: [],
    uploadProgress: null,
    trashItems: [],
    trashStats: {
      total_items: 0,
      photos_count: 0,
      videos_count: 0,
      albums_count: 0,
      total_size_bytes: 0
    },
    selectedTrashIds: [],
    trashFilterType: 'all',
    trashSearchQuery: '',
    mediaTypeFilter: 'all',
    aiChatMessages: savedChatMessages.length > 0 ? savedChatMessages : [
      {
        id: 'msg-1',
        sender: 'agent',
        text: 'Olá! Sou o **Agente Co-Pilot IMAGEX.AI** com suporte a **Google Gemini Cloud** e **Ollama Local**. Posso executar ações na sua galeria, tirar dúvidas técnicas, sugerir filtros e acompanhar suas extrações.',
        timestamp: '12:00',
        reasoning: 'Co-Pilot conversacional pronto com suporte dual-engine.'
      }
    ],

    syncBackendData: async () => {
      try {
        const isOnline = await backendApi.checkBackendHealth();
        set({ backendOnline: isOnline });
        if (isOnline) {
          const [realAlbums, models, allServerJobs, patterns] = await Promise.all([
            backendApi.fetchRealAlbums(),
            backendApi.fetchAvailableModels(),
            backendApi.fetchAllJobs(),
            backendApi.fetchDomainPatterns()
          ]);
          await get().syncVideos();
          await get().syncAlbumFolders();
          await get().fetchTrash();
          if (models && models.length > 0) {
            set({ availableModels: models });
          }
          if (patterns && patterns.length > 0) {
            set({ domainPatterns: patterns });
          }
          if (realAlbums && realAlbums.length > 0) {
            set(state => {
              const existingIds = new Set(state.albums.map(a => a.id));
              const newReal = realAlbums.filter(a => !existingIds.has(a.id));
              return { albums: [...newReal, ...state.albums] };
            });
          }
          if (allServerJobs && Array.isArray(allServerJobs)) {
            const mappedJobs: ExtractionJob[] = allServerJobs.map(mapServerJobToExtractionJob);
            const runningMapped = mappedJobs.filter(j => j.status === 'active' || j.status === 'queued' || j.status === 'paused');

            // Clean up subscriptions for sessions that are no longer running or paused on server
            const runningIds = new Set(allServerJobs.filter((j: any) => j.status === 'running' || j.status === 'queued' || j.status === 'paused').map((j: any) => j.session_id));
            for (const [sessId, unsubscribe] of activeSSESubscriptions.entries()) {
              if (!runningIds.has(sessId)) {
                try { unsubscribe(); } catch (_) {}
                activeSSESubscriptions.delete(sessId);
              }
            }

            // Determine activeJob with smooth auto-advance when a job finishes
            let currentActive = get().activeJob;
            if (!currentActive || currentActive.status === 'completed' || currentActive.status === 'failed' || currentActive.status === 'cancelled') {
              if (runningMapped.length > 0) {
                currentActive = runningMapped.find(j => j.status === 'active') || runningMapped[0];
              }
            } else {
              const activeId = currentActive.id;
              const fresh = mappedJobs.find(j => j.id === activeId);
              if (fresh) {
                if (fresh.status === 'completed' || fresh.status === 'failed' || fresh.status === 'cancelled') {
                  const nextOngoing = runningMapped.find(j => j.id !== activeId && j.status === 'active') || runningMapped.find(j => j.id !== activeId);
                  currentActive = nextOngoing || fresh;
                } else {
                  currentActive = fresh;
                }
              } else if (runningMapped.length > 0) {
                currentActive = runningMapped[0];
              }
            }

            const currentSessionIds = new Set(get().sessionJobIds);
            const dismissedSet = new Set(get().dismissedDockJobIds);
            for (const j of mappedJobs) {
              if (j.status === 'active' || j.status === 'queued') {
                if (!dismissedSet.has(j.id)) {
                  currentSessionIds.add(j.id);
                }
              } else if (j.status === 'cancelled' || j.status === 'failed') {
                currentSessionIds.delete(j.id);
              }
            }

            set({
              jobs: mappedJobs,
              activeJobs: runningMapped,
              activeJob: currentActive,
              sessionJobIds: Array.from(currentSessionIds)
            });

            // Safely subscribe to each running session with its own isolated handler
            const runningServerJobs = allServerJobs.filter((j: any) => j.status === 'running');
            for (const running of runningServerJobs) {
              const sessId = running.session_id;
              if (activeSSESubscriptions.has(sessId)) continue;

              const unsub = backendApi.subscribeToSessionEvents(
                sessId,
                (eventData) => {
                  if (eventData.type === 'log') {
                    get().addLog({
                      level: eventData.level || 'info',
                      category: eventData.category || 'AGENT_EVENT',
                      message: eventData.message || ''
                    });
                  } else if (eventData.type === 'status') {
                    get().addLog({
                      level: 'info',
                      category: 'STATUS',
                      message: eventData.message || ''
                    });
                    get().updateJob(sessId, { currentStage: eventData.message });
                  } else if (eventData.type === 'album_init') {
                    get().updateJob(sessId, { discoveredImagesCount: eventData.total_candidates });
                  } else if (eventData.type === 'image_resolved' || eventData.type === 'candidate_processed') {
                    const pos = eventData.position || eventData.image?.position || 1;
                    const rawThumb = eventData.thumbnail_url || eventData.image?.thumbnail_url || eventData.image?.src || '';
                    const rawOrig = eventData.original_url || eventData.image?.original_url || '';
                    const safeThumb = rawThumb.startsWith('http')
                      ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}&referer=${encodeURIComponent(running.url || rawThumb)}`
                      : rawThumb;
                    const isPass = eventData.validation_status === 'PASS' || eventData.image?.validation_status === 'PASS';
                    const isNoise = eventData.image?.classification === 'banner_noise' || eventData.validation_status === 'REJECTED';
                    const dims = eventData.dimensions || (eventData.image?.width ? `${eventData.image.width}x${eventData.image.height}` : 'Original');

                    get().addLog({
                      level: isPass ? 'ai' : 'warning',
                      category: isPass ? 'Original_RESOLVED' : 'INSPECTING',
                      message: `Foto #${pos} ${isPass ? 'validada em alta resolução' : 'sendo analisada'} (${dims})`
                    });

                    // Only update setOfMarks if this job is the currently active one being inspected
                    if (get().activeJob?.id === sessId) {
                      const newMark: SetOfMarkCandidate = {
                        id: pos,
                        thumbnailUrl: safeThumb,
                        resolvedOriginalUrl: rawOrig,
                        label: isPass ? `Foto #${pos} (${dims})` : (isNoise ? `Banner Rejeitado #${pos}` : `Candidato #${pos}`),
                        type: isPass ? 'album_item' : (isNoise ? 'banner_noise' : 'unresolved'),
                        confidence: 0.98,
                        box: { top: 0, left: 0, width: 200, height: 200 }
                      };

                      set(state => {
                        const existingIdx = state.setOfMarks.findIndex(m => m.id === pos);
                        const updatedMarks = [...state.setOfMarks];
                        if (existingIdx >= 0) {
                          updatedMarks[existingIdx] = newMark;
                        } else {
                          updatedMarks.push(newMark);
                        }
                        return {
                          setOfMarks: updatedMarks,
                          inspectingMarkId: pos
                        };
                      });
                    }

                    const curJob = get().jobs.find(j => j.id === sessId);
                    if (curJob) {
                      const maxTotal = curJob.discoveredImagesCount || 1;
                      get().updateJob(sessId, {
                        resolvedOriginalCount: isPass ? Math.max(curJob.resolvedOriginalCount, pos) : curJob.resolvedOriginalCount,
                        progressPercent: Math.min(99, Math.round((pos / Math.max(1, maxTotal)) * 100))
                      });
                    }
                  }
                },
                (finishedAlbum) => {
                  get().addAlbum(finishedAlbum);
                  get().updateJob(sessId, {
                    status: 'completed',
                    progressPercent: 100,
                    currentStage: getIsEn() ? 'Extraction 100% Completed!' : 'Extração 100% Concluída!',
                    resultAlbumId: finishedAlbum.id,
                    resolvedOriginalCount: finishedAlbum.images.length,
                    discoveredImagesCount: finishedAlbum.images.length
                  });
                  const u = activeSSESubscriptions.get(sessId);
                  if (u) {
                    try { u(); } catch (_) {}
                    activeSSESubscriptions.delete(sessId);
                  }
                },
                (err) => {
                  console.warn(`SSE error on session ${sessId}:`, err);
                }
              );

              activeSSESubscriptions.set(sessId, unsub);
            }
          }
        }
        triggerJobsPollingLoop();
      } catch (err) {
        console.warn('Backend sync failed:', err);
      }
    },

    syncJobs: async () => {
      try {
        const allServerJobs = await backendApi.fetchAllJobs();
        if (allServerJobs && Array.isArray(allServerJobs)) {
          const mappedJobs = allServerJobs.map(mapServerJobToExtractionJob);
          const currentJobs = get().jobs;
          const hadActiveVideoJobs = currentJobs.some(j => j.status === 'active' && (j.mode as any) === 'video_save');
          const stillHasActiveVideoJobs = mappedJobs.some(j => j.status === 'active' && (j.mode as any) === 'video_save');

          const hadActiveAlbumJobs = currentJobs.some(j => j.status === 'active' && (j.mode as any) !== 'video_save');
          const stillHasActiveAlbumJobs = mappedJobs.some(j => j.status === 'active' && (j.mode as any) !== 'video_save');

          const runningMapped = mappedJobs.filter(j => j.status === 'active' || j.status === 'queued' || j.status === 'paused');

          let currentActive = get().activeJob;
          if (currentActive) {
            const activeId = currentActive.id;
            const fresh = mappedJobs.find(j => j.id === activeId);
            if (fresh) {
              if (fresh.status === 'completed' || fresh.status === 'failed' || fresh.status === 'cancelled') {
                const nextOngoing = runningMapped.find(j => j.id !== activeId && j.status === 'active') || runningMapped.find(j => j.id !== activeId);
                currentActive = nextOngoing || fresh;
              } else {
                currentActive = fresh;
              }
            } else if (runningMapped.length > 0) {
              currentActive = runningMapped.find(j => j.status === 'active') || runningMapped[0];
            }
          } else if (runningMapped.length > 0) {
            currentActive = runningMapped.find(j => j.status === 'active') || runningMapped[0];
          }

          const currentSessionIds = new Set(get().sessionJobIds);
          const dismissedSet = new Set(get().dismissedDockJobIds);
          for (const j of mappedJobs) {
            if (j.status === 'active' || j.status === 'queued') {
              if (!dismissedSet.has(j.id)) {
                currentSessionIds.add(j.id);
              }
            } else if (j.status === 'cancelled' || j.status === 'failed') {
              currentSessionIds.delete(j.id);
            }
          }

          set({
            jobs: mappedJobs,
            activeJobs: runningMapped,
            activeJob: currentActive,
            sessionJobIds: Array.from(currentSessionIds)
          });

          // Detecta tarefas que acabaram de transicionar para 'completed' individualmente
          const justCompletedJobs = mappedJobs.filter(newJ => {
            if (newJ.status !== 'completed') return false;
            const oldJ = currentJobs.find(oj => oj.id === newJ.id);
            return oldJ && oldJ.status !== 'completed';
          });

          if (justCompletedJobs.length === 0 && hadActiveVideoJobs && !stillHasActiveVideoJobs) {
            await get().syncVideos();
          }

          for (const cj of justCompletedJobs) {
            const isVid = (cj.mode as string) === 'video_save' || (cj.mode as string) === 'video_downloader' || (cj.mode as string) === 'video_stream_register';
            if (isVid) {
              await get().syncVideos();
              const curLang = (get().settings?.language || 'pt-BR') as 'pt-BR' | 'en-US';
              const tStore = translations[curLang]?.store || translations['pt-BR']?.store;
              get().addNotification({
                title: tStore?.videoSavedTitle || (curLang === 'en-US' ? 'Video Saved to Gallery' : 'Vídeo Salvo na Galeria'),
                message: (tStore?.videoSavedMsg || '"{title}" foi salvo com sucesso na pasta "{folder}".')
                  .replace('{title}', cj.title.replace(/^(?:Salvar Vídeo|Save Video):\s*/i, ''))
                  .replace('{folder}', cj.folder || (curLang === 'en-US' ? 'Extracted' : 'Extraídos')),
                type: 'success',
                linkViewId: 'videos'
              });
              soundEffects.success(get().settings.soundEnabled);
            } else {
              await get().syncAlbums();
              const curLang = (get().settings?.language || 'pt-BR') as 'pt-BR' | 'en-US';
              const tStore = translations[curLang]?.store || translations['pt-BR']?.store;
              get().addNotification({
                title: tStore?.extractionCompleteTitle || (curLang === 'en-US' ? 'Extraction Complete' : 'Extração Concluída'),
                message: (tStore?.extractionCompleteMsg || '"{title}" foi salvo com sucesso na Galeria.')
                  .replace('{title}', cj.title.replace(/^Extração:\s*/, '')),
                type: 'success',
                linkViewId: 'gallery'
              });
              soundEffects.success(get().settings.soundEnabled);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to sync jobs:', err);
      }
    },

    syncAlbums: async () => {
      try {
        const freshAlbums = await backendApi.fetchRealAlbums();
        if (freshAlbums && Array.isArray(freshAlbums)) {
          let storedFavs: string[] = [];
          if (typeof window !== 'undefined') {
            try {
              storedFavs = JSON.parse(localStorage.getItem('imagex_favorite_albums') || '[]');
            } catch (_) {}
          }
          let storedImgFavs: string[] = [];
          if (typeof window !== 'undefined') {
            try {
              storedImgFavs = JSON.parse(localStorage.getItem('imagex_favorite_images') || '[]');
            } catch (_) {}
          }
          const currentFavSet = new Set([
            ...get().albums.filter(a => a.isFavorite).map(a => a.id),
            ...storedFavs
          ]);
          const favImgSet = new Set(storedImgFavs);
          const mergedAlbums = freshAlbums.map(a => ({
            ...a,
            isFavorite: a.isFavorite || currentFavSet.has(a.id),
            images: (a.images || []).map(i => ({
              ...i,
              isFavorite: (i as any).isFavorite || favImgSet.has(i.id)
            }))
          }));
          set({ albums: mergedAlbums });
        }
        await get().syncAlbumFolders();
      } catch (err) {
        console.warn('Failed to sync albums:', err);
      }
    },


    syncAlbumFolders: async () => {
      try {
        const res = await backendApi.fetchAlbumFolders();
        const apiFolders = (res && Array.isArray(res.folders)) ? res.folders : [];
        const { albums } = get();

        // 1. Contagens reais baseadas nos álbuns carregados
        const folderCounts = new Map<string, number>();
        folderCounts.set('Geral', 0);

        albums.forEach(a => {
          const f = (a.folder || 'Geral').trim() || 'Geral';
          folderCounts.set(f, (folderCounts.get(f) || 0) + 1);
        });

        // 2. Mescla pastas retornadas pela API (mantendo maior contagem entre memória e backend)
        apiFolders.forEach(f => {
          const name = (f.name || f.id || '').trim();
          if (name) {
            if (!folderCounts.has(name)) {
              folderCounts.set(name, f.count || 0);
            } else {
              folderCounts.set(name, Math.max(folderCounts.get(name) || 0, f.count || 0));
            }
          }
        });


        // 4. Cache persistido do localStorage
        try {
          const cached = JSON.parse(localStorage.getItem('app_custom_album_folders_cache') || '[]');
          if (Array.isArray(cached)) {
            cached.forEach((name: string) => {
              if (name && !folderCounts.has(name)) {
                folderCounts.set(name, 0);
              }
            });
          }
        } catch (_) {}

        // 5. Ordenação: "Geral" sempre em primeiro, seguido pelas demais em ordem alfabética
        const sortedNames = ['Geral', ...Array.from(folderCounts.keys()).filter(k => k !== 'Geral').sort((a, b) => a.localeCompare(b))];
        const mergedFolders: AlbumFolder[] = sortedNames.map(name => ({
          id: name,
          name: name,
          count: folderCounts.get(name) || 0
        }));

        set({ albumFolders: mergedFolders });

        try {
          localStorage.setItem('app_custom_album_folders_cache', JSON.stringify(sortedNames.filter(n => n !== 'Geral')));
        } catch (_) {}
      } catch (err) {
        console.warn('Failed to sync album folders:', err);
      }
    },

    setActiveAlbumFolder: (folder) => set({ activeAlbumFolder: folder }),

    setActiveAlbumFolderModal: (modal) => set({ activeAlbumFolderModal: modal }),

    createAlbumFolder: async (name) => {
      const clean = name.trim();
      if (!clean) return false;
      try {
        const res = await backendApi.createAlbumFolder(clean);
        if (res.success) {
          set({ albumFolders: res.folders, activeAlbumFolder: clean });
          get().addNotification({
            title: 'Pasta Criada',
            message: `Pasta "${clean}" criada com sucesso.`,
            type: 'success',
          });
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    renameAlbumFolder: async (oldName, newName) => {
      const clean = newName.trim();
      if (!clean || clean === oldName) return false;
      try {
        const res = await backendApi.renameAlbumFolder(oldName, clean);
        if (res.success) {
          const { activeAlbumFolder, albums } = get();
          const updatedAlbums = albums.map(a => (a.folder === oldName ? { ...a, folder: clean } : a));
          set({
            albumFolders: res.folders,
            albums: updatedAlbums,
            activeAlbumFolder: activeAlbumFolder === oldName ? clean : activeAlbumFolder,
          });
          get().addNotification({
            title: 'Pasta Renomeada',
            message: `Pasta renomeada para "${clean}".`,
            type: 'success',
          });
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    deleteAlbumFolder: async (folderName) => {
      try {
        const res = await backendApi.deleteAlbumFolder(folderName);
        if (res.success) {
          const { activeAlbumFolder, albums } = get();
          const updatedAlbums = albums.map(a => (a.folder === folderName ? { ...a, folder: 'Geral' } : a));
          set({
            albumFolders: res.folders,
            albums: updatedAlbums,
            activeAlbumFolder: activeAlbumFolder === folderName ? null : activeAlbumFolder,
          });
          get().addNotification({
            title: get().settings?.language === 'en-US' ? 'Folder Deleted' : 'Pasta Excluída',
            message: get().settings?.language === 'en-US' ? `Folder "${folderName}" deleted. Albums moved to "General".` : `Pasta "${folderName}" excluída. Álbuns movidos para "Geral".`,
            type: 'info',
          });
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    moveAlbumsToFolder: async (albumIds, targetFolder) => {
      try {
        const res = await backendApi.moveAlbumsToFolder(albumIds, targetFolder);
        if (res.success) {
          const { albums } = get();
          const idSet = new Set(albumIds);
          const updatedAlbums = albums.map(a => (idSet.has(a.id) ? { ...a, folder: targetFolder } : a));
          set({ albums: updatedAlbums });
          await get().syncAlbumFolders();
          get().addNotification({
            title: get().settings?.language === 'en-US' ? 'Albums Moved' : 'Álbuns Movidos',
            message: get().settings?.language === 'en-US' ? `${res.moved} album(s) moved to "${targetFolder}".` : `${res.moved} álbum(ns) movido(s) para "${targetFolder}".`,
            type: 'success',
          });
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    setMultiAlbumState: (partial) => {
      set((state) => {
        const next = { ...state.multiAlbumState, ...partial };
        if (typeof window !== 'undefined') {
          if ((window as any).__multiAlbumSaveTimeout) {
            clearTimeout((window as any).__multiAlbumSaveTimeout);
          }
          (window as any).__multiAlbumSaveTimeout = setTimeout(() => {
            try {
              localStorage.setItem('imagex_multi_album_state', JSON.stringify(next));
            } catch (_) {}
          }, 400);
        }
        return { multiAlbumState: next };
      });
    },

    clearMultiAlbumState: () => {
      if (typeof window !== 'undefined' && (window as any).__multiAlbumSaveTimeout) {
        clearTimeout((window as any).__multiAlbumSaveTimeout);
      }
      const reset = {
        url: '',
        performerName: '',
        maxRelated: 0,
        maxPages: 50,
        pagesScanned: 0,
        results: [],
        streamingStatus: '',
        lastSearchedPerformer: null,
        selectedUrls: [],
        customSelections: {},
        activeInspectingUrl: null
      };
      try {
        localStorage.removeItem('imagex_multi_album_state');
      } catch (_) {}
      set({ multiAlbumState: reset });
    },

    setWebScraperState: (partial) => {
      set((state) => {
        const next = { ...state.webScraperState, ...partial };
        try {
          localStorage.setItem('imagex_web_scraper_state', JSON.stringify(next));
        } catch (_) {}
        return { webScraperState: next };
      });
    },

    clearWebScraperState: () => {
      const reset: WebScraperState = {
        url: '',
        scanResult: null,
        selectedIds: [],
        targetFolder: getIsEn() ? 'Extracted' : 'Extraídos',
        errorMsg: null,
        videoAlbums: [],
        selectedAlbumIds: [],
        activeInspectingAlbumId: null,
        viewLayout: 'albums'
      };
      try {
        localStorage.removeItem('imagex_web_scraper_state');
      } catch (_) {}
      set({ webScraperState: reset });
    },

    setAiChatOpen: (open) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      set({ aiChatOpen: open });
    },

    setAiChatProvider: (provider: 'gemini' | 'ollama') => {
      get().updateSettings({ aiChatProvider: provider });
    },

    checkOllamaHealth: async (urlOverride?: string) => {
      set({ isCheckingOllama: true });
      const targetUrl = urlOverride || get().settings.ollamaBaseUrl || 'http://localhost:11434';
      try {
        const status = await backendApi.getOllamaStatus(targetUrl);
        const detailedModels = await backendApi.getOllamaModels(targetUrl);
        const currentModel = get().settings.selectedOllamaModel;

        if (status?.installedModels?.length) {
          if (!currentModel || !status.installedModels.includes(currentModel)) {
            const preferred = status.installedModels.find(m =>
              m.includes('llama3.2') || m.includes('7b') || m.includes('3b')
            ) || status.installedModels[0];
            get().updateSettings({ selectedOllamaModel: preferred });
          }
        }

        const healthStatus: OllamaHealthStatus = status || {
          isAvailable: false,
          endpoint: targetUrl,
          installedModels: [],
          lastChecked: Date.now(),
          error: 'Sem resposta'
        };

        set({
          ollamaStatus: healthStatus,
          ollamaModels: detailedModels,
          isCheckingOllama: false
        });
        return healthStatus;
      } catch (e: any) {
        const fallbackStatus: OllamaHealthStatus = {
          isAvailable: false,
          endpoint: targetUrl,
          installedModels: [],
          lastChecked: Date.now(),
          error: e?.message || 'Falha ao conectar'
        };
        set({ ollamaStatus: fallbackStatus, isCheckingOllama: false });
        return fallbackStatus;
      }
    },

    sendAiChatMessage: async (text: string, forceProvider?: 'gemini' | 'ollama') => {
      const { settings, aiChatMessages } = get();
      soundEffects.click(settings.soundEnabled);

      const activeProvider = forceProvider || settings.aiChatProvider || 'gemini';
      const activeModel = activeProvider === 'gemini'
        ? (settings.geminiChatModel || settings.geminiModel || 'gemini-3.7-flash')
        : (settings.selectedOllamaModel || 'llama3.2');

      const userMsg: ChatMessage = {
        id: `msg-u-${Date.now()}`,
        sender: 'user',
        text,
        timestamp: new Date().toLocaleTimeString().slice(0, 5)
      };

      set(state => ({ aiChatMessages: [...state.aiChatMessages, userMsg] }));

      // Natural language chromatic commands recognition
      const lowerText = text.toLowerCase().trim();
      const isPt = settings.language === 'pt-BR';

      // Check for clear / reset color filter intent
      const isClearIntent =
        /(?:limpar|remover|resetar|tirar|desativar|apagar)\s*(?:o\s*)?(?:filtro|filtro de cor|filtro cromático|cores?)/i.test(lowerText) ||
        /(?:clear|remove|reset)\s*(?:the\s*)?(?:color\s*)?filter/i.test(lowerText) ||
        lowerText === 'limpar filtro' || lowerText === 'remover filtro' || lowerText === 'clear filter';

      if (isClearIntent) {
        set({ galleryColorFilter: null, albumColorFilter: null });
        const replyText = isPt
          ? 'Filtro cromático removido com sucesso. Exibindo todos os itens normalmente.'
          : 'Chromatic filter cleared successfully. Displaying all items.';
        const agentMsg: ChatMessage = {
          id: `msg-a-${Date.now()}`,
          sender: 'agent',
          text: replyText,
          timestamp: new Date().toLocaleTimeString().slice(0, 5),
          reasoning: isPt ? 'Comando Co-Pilot: Limpeza de filtro cromático' : 'Co-Pilot command: Clear chromatic filter',
          provider: activeProvider,
          model: activeModel,
        };
        set(state => ({ aiChatMessages: [...state.aiChatMessages, agentMsg] }));
        soundEffects.click(settings.soundEnabled);
        return;
      }

      // Chromatic palette options
      const chromaticOptions = [
        { regex: /(?:amarel[ao]s?|dourad[ao]s?|ouro|yellow|gold)/i, hex: '#facc15', namePt: 'amarela / dourada', nameEn: 'yellow / golden' },
        { regex: /(?:laranjas?|alaranjad[ao]s?|orange)/i, hex: '#f97316', namePt: 'laranja', nameEn: 'orange' },
        { regex: /(?:vermelh[ao]s?|rubi|red)/i, hex: '#dc2626', namePt: 'vermelha', nameEn: 'red' },
        { regex: /(?:verdes?|esmeralda|green)/i, hex: '#10b981', namePt: 'verde', nameEn: 'green' },
        { regex: /(?:ciano|turquesa|cyan|turquoise)/i, hex: '#06b6d4', namePt: 'ciano / turquesa', nameEn: 'cyan / turquoise' },
        { regex: /(?:azuis|azul|blue)/i, hex: '#3b82f6', namePt: 'azul', nameEn: 'blue' },
        { regex: /(?:rox[ao]s?|violetas?|p[uú]rpuras?|purple|violet)/i, hex: '#8b5cf6', namePt: 'roxa / violeta', nameEn: 'purple / violet' },
        { regex: /(?:rosas?|magentas?|pink)/i, hex: '#ec4899', namePt: 'rosa / magenta', nameEn: 'pink / magenta' },
        { regex: /(?:monocrom[aá]tic[ao]s?|preto\s+e\s+branco|p&b|cinzas?|black\s+(?:and|&)\s+white|monochrome|grayscale)/i, hex: '#1e293b', namePt: 'monocromática / preto e branco', nameEn: 'monochrome / black and white' },
      ];

      const isColorQueryIntent =
        /(?:mostr(?:e|ar)|filtr(?:ar|e)|busc(?:ar|e)|procur(?:ar|e)|ver|tra(?:zer|ga)|encontr(?:ar|e)|exib(?:ir|a)|fotos?|imagens?|álbuns?|albuns?|ton?s?|tonalidade|quentes?|frias?|show|filter|find)/i.test(lowerText);

      const matchedColor = chromaticOptions.find(opt => opt.regex.test(lowerText));

      if (matchedColor && (isColorQueryIntent || lowerText.includes('cor') || lowerText.includes('tom') || lowerText.includes('tonalidade'))) {
        const { currentView, activeAlbumId, albums } = get();

        if (currentView === 'album-detail' && activeAlbumId) {
          // Inside album scope: filter individual photos in the open album
          set({ albumColorFilter: matchedColor.hex });
          const currentAlbum = albums.find(a => a.id === activeAlbumId);
          const matchCount = (currentAlbum?.images || []).filter(img => {
            const pal = (img.colorPalette && img.colorPalette.length > 0)
              ? img.colorPalette
              : (colorPaletteCache.get(img.previewUrl || img.originalUrl || img.thumbnailUrl) || []);
            return matchesPaletteFuzzy(pal, matchedColor.hex);
          }).length;

          const replyText = isPt
            ? `Filtrei o álbum atual para exibir fotos com tonalidade ${matchedColor.namePt}. Encontrei ${matchCount} ${matchCount === 1 ? 'foto correspondente' : 'fotos correspondentes'}.`
            : `Filtered the active album to show photos with ${matchedColor.nameEn} tone. Found ${matchCount} matching ${matchCount === 1 ? 'photo' : 'photos'}.`;

          const agentMsg: ChatMessage = {
            id: `msg-a-${Date.now()}`,
            sender: 'agent',
            text: replyText,
            timestamp: new Date().toLocaleTimeString().slice(0, 5),
            reasoning: isPt ? `Filtro cromático interno aplicado (${matchedColor.namePt})` : `Internal chromatic filter applied (${matchedColor.nameEn})`,
            provider: activeProvider,
            model: activeModel,
          };
          set(state => ({ aiChatMessages: [...state.aiChatMessages, agentMsg] }));
          soundEffects.click(settings.soundEnabled);
          return;
        } else {
          // Gallery scope: filter album library by cover/images chromatic harmony
          set({ galleryColorFilter: matchedColor.hex });
          if (currentView !== 'gallery') {
            get().navigateToView('gallery');
          }
          const matchCount = albums.filter(alb =>
            (alb.coverColorPalette && matchesPaletteFuzzy(alb.coverColorPalette, matchedColor.hex)) ||
            (alb.images || []).some(img => {
              const pal = (img.colorPalette && img.colorPalette.length > 0)
                ? img.colorPalette
                : (colorPaletteCache.get(img.originalUrl) || colorPaletteCache.get(img.thumbnailUrl) || []);
              return matchesPaletteFuzzy(pal, matchedColor.hex);
            }) ||
            (alb.coverImage ? matchesPaletteFuzzy(colorPaletteCache.get(alb.coverImage) || [], matchedColor.hex) : false)
          ).length;

          const replyText = isPt
            ? `Filtrei a galeria para exibir álbuns com fotos na tonalidade ${matchedColor.namePt}. Encontrei ${matchCount} ${matchCount === 1 ? 'álbum correspondente' : 'álbuns correspondentes'}.`
            : `Filtered the gallery to show albums with ${matchedColor.nameEn} tone. Found ${matchCount} matching ${matchCount === 1 ? 'album' : 'albums'}.`;

          const agentMsg: ChatMessage = {
            id: `msg-a-${Date.now()}`,
            sender: 'agent',
            text: replyText,
            timestamp: new Date().toLocaleTimeString().slice(0, 5),
            reasoning: isPt ? `Filtro cromático da galeria aplicado (${matchedColor.namePt})` : `Gallery chromatic filter applied (${matchedColor.nameEn})`,
            provider: activeProvider,
            model: activeModel,
          };
          set(state => ({ aiChatMessages: [...state.aiChatMessages, agentMsg] }));
          soundEffects.click(settings.soundEnabled);
          return;
        }
      }

      // Format last 6 messages as conversation history (excluding error/fallback messages)
      const recentHistory = aiChatMessages
        .filter(m => !m.errorType)
        .slice(-6)
        .map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text
        }));

      // Context of current application view
      const { currentView, activeAlbumId, activeAlbumFolder, activeVideoFolder } = get();
      const appContext = {
        currentView,
        activeAlbumId,
        activeFolder: activeAlbumFolder || activeVideoFolder || 'Geral'
      };

      try {
        const res = await backendApi.sendChatMessage(text, {
          provider: activeProvider,
          model: activeModel,
          ollamaUrl: settings.ollamaBaseUrl || 'http://localhost:11434',
          conversationHistory: recentHistory,
          context: appContext
        });

        const agentMsg: ChatMessage = {
          id: `msg-a-${Date.now()}`,
          sender: 'agent',
          text: res?.reply || 'Sem resposta do assistente.',
          timestamp: new Date().toLocaleTimeString().slice(0, 5),
          reasoning: activeProvider === 'gemini'
            ? `Google Gemini Cloud (${activeModel})`
            : `Ollama Local (${activeModel})`,
          provider: res?.provider || activeProvider,
          model: res?.model || activeModel,
          errorType: res?.error_type,
          canFallback: res?.can_fallback,
          mediaItems: res?.media_items || [],
          executedTools: res?.executed_tools || [],
          thoughtChain: res?.thought_chain || [],
          clientAction: res?.client_action || undefined
        };

        set(state => ({ aiChatMessages: [...state.aiChatMessages, agentMsg] }));
        soundEffects.click(settings.soundEnabled);

        // Auto-dispatch client actions requested by the Copilot Master Agent
        if (res?.client_action) {
          const act = res.client_action;
          if (act.type === 'navigate' && act.view) {
            const v = act.view.toLowerCase();
            if (v === 'gallery' || v === 'albums') {
              get().navigateToView('gallery');
            } else if (v === 'videos') {
              get().navigateToView('videos');
            } else if (v === 'tasks' || v === 'jobs' || v === 'batch-queue') {
              get().navigateToView('batch-queue');
            } else if (v === 'trash') {
              get().navigateToView('trash');
            } else if (v === 'settings') {
              get().navigateToView('settings');
            } else if (v === 'album-detail' && act.target_id) {
              get().navigateToView('album-detail', act.target_id);
            }
          } else if (act.type === 'filter') {
            if (act.filter_type === 'search_query' && act.value) {
              if (get().currentView === 'videos') {
                set({ videoSearchQuery: act.value });
              } else {
                set({ gallerySearchQuery: act.value });
              }
            } else if (act.filter_type === 'color' && act.value) {
              if (get().currentView === 'album-detail') {
                set({ albumColorFilter: act.value });
              } else {
                set({ galleryColorFilter: act.value });
              }
            }
          }
        }
      } catch (err: any) {
        const errorMsg: ChatMessage = {
          id: `msg-a-${Date.now()}`,
          sender: 'agent',
          text: `Erro ao comunicar com a IA: ${err?.message || err}`,
          timestamp: new Date().toLocaleTimeString().slice(0, 5),
          reasoning: 'Exceção de rede',
          provider: activeProvider,
          model: activeModel,
          errorType: 'network_exception',
          canFallback: true
        };
        set(state => ({ aiChatMessages: [...state.aiChatMessages, errorMsg] }));
      }
    },

    navigateToView: (viewId: ViewId, albumId?: string) => {
      // Snapshot scroll position of outgoing tab/view before navigating
      scrollRestorationManager.snapshotCurrentPosition(get().activeTabId, get().currentView, get().activeAlbumId);

      const { settings, openTabs } = get();
      soundEffects.click(settings.soundEnabled);

      let tabTitle = viewId.replace('-', ' ').toUpperCase();
      const isPt = settings.language === 'pt-BR';
      if (viewId === 'home') tabTitle = isPt ? 'Início' : 'Home';
      else if (viewId === 'extractor') tabTitle = isPt ? 'Extrator de Mídia' : 'Media Extractor';
      else if (viewId === 'multi-album') tabTitle = isPt ? 'Extrator de Multi-album' : 'Multi-Album Extractor';
      else if (viewId === 'web-video-scraper') tabTitle = isPt ? 'Extrator de Vídeos Web' : 'Web Video Extractor';
      else if (viewId === 'gallery') tabTitle = isPt ? 'Galeria de Álbuns' : 'Album Library';
      else if (viewId === 'videos') tabTitle = isPt ? 'Galeria de Vídeos' : 'Video Gallery';
      else if (viewId === 'shorts') tabTitle = isPt ? 'Shorts & Reels' : 'Shorts & Reels';
      else if (viewId === 'live-monitor') tabTitle = isPt ? 'Monitor da IA' : 'AI Live Monitor';
      else if (viewId === 'job-history') tabTitle = isPt ? 'Gestão de Tarefas' : 'Task Management';
      else if (viewId === 'duplicates') tabTitle = isPt ? 'Detector de Duplicatas' : 'Duplicates Finder';
      else if (viewId === 'trash') tabTitle = isPt ? 'Lixeira' : 'Trash';
      else if (viewId === 'batch-queue') tabTitle = isPt ? 'Processador em Lote' : 'Batch Processor';
      else if (viewId === 'album-detail' && albumId) {
        const album = get().albums.find(a => a.id === albumId);
        tabTitle = album
          ? (album.title.length > 24 ? album.title.slice(0, 24) + '...' : album.title)
          : (isPt ? 'Studio do Álbum' : 'Album Studio');

        backendApi.fetchAlbumDetails(albumId).then(fresh => {
          if (fresh && fresh.images && fresh.images.length > 0) {
            set(state => ({
              albums: state.albums.map(a => a.id === albumId ? fresh : a)
            }));
          }
        }).catch(() => {});
      }

      const currentActiveTab = openTabs.find(t => t.id === get().activeTabId);
      const existingTab = openTabs.find(t => t.viewId === viewId && (!albumId || t.albumId === albumId));

      // Contextual transition: If user is on a home tab and choosing a module/view
      if (currentActiveTab && currentActiveTab.viewId === 'home' && viewId !== 'home') {
        if (existingTab) {
          // If the target view already exists in an open tab, switch to it without creating duplicate
          let updatedTabs = openTabs;
          if (currentActiveTab.isClosable && openTabs.length > 1) {
            updatedTabs = openTabs.filter(t => t.id !== currentActiveTab.id);
          }
          persistNav(updatedTabs, existingTab.id, viewId, albumId || null);
          set({
            currentView: viewId,
            activeAlbumId: albumId || null,
            openTabs: updatedTabs,
            activeTabId: existingTab.id
          });
          return;
        }

        // If target view doesn't exist, transform current home tab into the target view
        const updatedTabs = openTabs.map(t =>
          t.id === currentActiveTab.id
            ? { ...t, viewId, title: tabTitle, albumId, isClosable: true }
            : t
        );
        persistNav(updatedTabs, currentActiveTab.id, viewId, albumId || null);
        set({
          currentView: viewId,
          activeAlbumId: albumId || null,
          openTabs: updatedTabs,
          activeTabId: currentActiveTab.id
        });
        return;
      }

      const randSuffix = Math.random().toString(36).slice(2, 6);
      let activeTabId = existingTab ? existingTab.id : `tab-${viewId}-${Date.now()}-${randSuffix}`;

      let updatedTabs = openTabs;
      if (!existingTab) {
        updatedTabs = [
          ...openTabs,
          { id: activeTabId, title: tabTitle, viewId, albumId, isClosable: true }
        ];
      }

      persistNav(updatedTabs, activeTabId, viewId, albumId || null);
      set({
        currentView: viewId,
        activeAlbumId: albumId || null,
        openTabs: updatedTabs,
        activeTabId
      });
    },

    openTab: (tab) => {
      // Snapshot scroll position of outgoing tab/view before opening new tab
      scrollRestorationManager.snapshotCurrentPosition(get().activeTabId, get().currentView, get().activeAlbumId);

      const { openTabs, settings } = get();
      soundEffects.click(settings.soundEnabled);
      const randSuffix = Math.random().toString(36).slice(2, 6);
      const id = `tab-${tab.viewId}-${Date.now()}-${randSuffix}`;
      scrollRestorationManager.initNewTabPosition(id, 0);
      const newTabs = [...openTabs, { ...tab, id, isClosable: true }];
      persistNav(newTabs, id, tab.viewId, tab.albumId || null);
      set({
        openTabs: newTabs,
        activeTabId: id,
        currentView: tab.viewId,
        activeAlbumId: tab.albumId || null
      });
    },

    closeTab: (tabId) => {
      scrollRestorationManager.deleteTabPosition(tabId);
      const { openTabs, activeTabId, settings } = get();
      soundEffects.click(settings.soundEnabled);

      const remaining = openTabs.filter(t => t.id !== tabId);
      let nextActive = activeTabId;
      let nextView = get().currentView;
      let nextAlbumId = get().activeAlbumId;

      if (remaining.length === 0) {
        const homeTab: SessionTab = {
          id: 'tab-home-default',
          title: settings.language === 'en-US' ? 'Home' : 'Início',
          viewId: 'home',
          isClosable: false
        };
        persistNav([homeTab], homeTab.id, 'home', null);
        set({
          openTabs: [homeTab],
          activeTabId: homeTab.id,
          currentView: 'home',
          activeAlbumId: null
        });
        return;
      } else if (activeTabId === tabId) {
        const lastTab = remaining[remaining.length - 1];
        nextActive = lastTab.id;
        nextView = lastTab.viewId;
        nextAlbumId = lastTab.albumId || null;
      }

      persistNav(remaining, nextActive, nextView, nextAlbumId);
      set({
        openTabs: remaining,
        activeTabId: nextActive,
        currentView: nextView,
        activeAlbumId: nextAlbumId
      });
    },

    setActiveTab: (tabId) => {
      // Snapshot scroll position of outgoing tab/view before switching
      scrollRestorationManager.snapshotCurrentPosition(get().activeTabId, get().currentView, get().activeAlbumId);

      const { openTabs, settings } = get();
      soundEffects.click(settings.soundEnabled);
      const tab = openTabs.find(t => t.id === tabId);
      if (tab) {
        persistNav(openTabs, tab.id, tab.viewId, tab.albumId || null);
        set({
          activeTabId: tab.id,
          currentView: tab.viewId,
          activeAlbumId: tab.albumId || null
        });
      }
    },

    addAlbum: (album) => {
      set(state => {
        const exists = state.albums.some(a => a.id === album.id);
        if (exists) {
          return { albums: state.albums.map(a => a.id === album.id ? album : a) };
        }
        return { albums: [album, ...state.albums] };
      });
    },

    updateAlbum: async (id, updates) => {
      if (updates.title) {
        try {
          await backendApi.renameAlbum(id, updates.title);
        } catch (_) {}
      }
      set(state => ({
        albums: state.albums.map(a => (a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a))
      }));
    },

    renameAlbumImage: async (albumId: string, imageId: string, newTitle: string) => {
      const clean = newTitle.trim();
      if (!clean) return false;
      try {
        await backendApi.renameAlbumImage(albumId, imageId, clean);
      } catch (_) {}

      set(state => ({
        albums: state.albums.map(a => {
          if (a.id !== albumId) return a;
          const updatedImages = (a.images || []).map(img =>
            img.id === imageId ? { ...img, title: clean } : img
          );
          return {
            ...a,
            images: updatedImages,
            updatedAt: new Date().toISOString()
          };
        })
      }));
      return true;
    },

    setAlbumCover: async (albumId: string, coverImageUrl: string) => {
      try {
        const success = await backendApi.setAlbumCover(albumId, coverImageUrl);
        if (success) {
          const safeUrl = (coverImageUrl.startsWith('http') && !coverImageUrl.includes('unsplash.com'))
            ? `/api/proxy-image?url=${encodeURIComponent(coverImageUrl)}&referer=${encodeURIComponent(coverImageUrl)}`
            : coverImageUrl;

          set(state => ({
            albums: state.albums.map(a =>
              a.id === albumId
                ? { ...a, coverImage: safeUrl, rawCoverImage: coverImageUrl, updatedAt: new Date().toISOString() }
                : a
            )
          }));

          get().addNotification({
            title: get().settings?.language === 'en-US' ? 'Album Cover Updated' : 'Capa do Álbum Atualizada',
            message: get().settings?.language === 'en-US' ? 'Album thumbnail updated successfully.' : 'A miniatura deste álbum na galeria foi alterada com sucesso.',
            type: 'success'
          });
          return true;
        }
      } catch (err) {
        console.error('Failed to set album cover:', err);
      }
      return false;
    },

    deleteAlbum: async (id) => {
      try {
        await backendApi.deleteAlbum(id);
        await get().fetchTrash();
      } catch (_) {}
      scrollRestorationManager.deletePosition(getViewScrollKey('album-detail', id));
      set(state => ({
        albums: state.albums.filter(a => a.id !== id),
        openTabs: state.openTabs.filter(t => t.albumId !== id)
      }));
      get().addNotification({
        title: get().settings?.language === 'en-US' ? 'Album Moved to Trash' : 'Álbum Movido para a Lixeira',
        message: get().settings?.language === 'en-US' ? 'Album moved to trash and can be restored at any time.' : 'O álbum foi enviado para a lixeira do app e pode ser restaurado a qualquer momento.',
        type: 'warning'
      });
    },

    refreshAlbumStreams: async (albumId) => {
      const ok = await backendApi.refreshAlbumStreams(albumId);
      if (ok) {
        // Reload the album details to get fresh stream URLs
        const fresh = await backendApi.fetchAlbumDetails(albumId);
        if (fresh) {
          set(state => ({
            albums: state.albums.map(a => a.id === albumId ? fresh : a)
          }));
        }
        get().addNotification({
          title: 'Streams Renovados',
          message: get().settings?.language === 'en-US' ? 'Video links updated successfully.' : 'Os links de vídeo foram atualizados com sucesso.',
          type: 'success'
        });
      } else {
        get().addNotification({
          title: 'Falha ao Renovar Streams',
          message: get().settings?.language === 'en-US' ? 'Could not obtain new links. Try again later.' : 'Não foi possível obter novos links. Tente novamente mais tarde.',
          type: 'error'
        });
      }
      return ok;
    },

    refreshBatchAlbumStreams: async (albumIds: string[]) => {
      if (!albumIds || albumIds.length === 0) return { succeeded: 0, failed: 0 };
      const state = get();
      if (state.isRenewingBatchStreams) return { succeeded: 0, failed: 0 };

      const isEn = state.settings?.language === 'en-US';
      set({
        isRenewingBatchStreams: true,
        batchRenewProgress: { current: 0, total: albumIds.length }
      });

      get().addNotification({
        title: isEn ? 'Renewing Video Streams' : 'Renovando Streams',
        message: isEn
          ? `Starting renewal of video streams for ${albumIds.length} albums in the background...`
          : `Iniciando renovação de streams para ${albumIds.length} álbuns em segundo plano...`,
        type: 'info'
      });

      let succeeded = 0;
      let failed = 0;

      try {
        for (let i = 0; i < albumIds.length; i++) {
          const albumId = albumIds[i];
          set({
            batchRenewProgress: { current: i + 1, total: albumIds.length }
          });

          try {
            const ok = await backendApi.refreshAlbumStreams(albumId);
            if (ok) {
              const fresh = await backendApi.fetchAlbumDetails(albumId);
              if (fresh) {
                set(curr => ({
                  albums: curr.albums.map(a => a.id === albumId ? fresh : a)
                }));
              }
              succeeded++;
            } else {
              failed++;
            }
          } catch (err) {
            console.error(`Failed to refresh streams for album ${albumId}:`, err);
            failed++;
          }
        }
      } finally {
        set({
          isRenewingBatchStreams: false,
          batchRenewProgress: null
        });
      }

      const finalState = get();
      if (succeeded > 0) {
        finalState.addNotification({
          title: isEn ? 'Streams Renewal Completed' : 'Renovação Concluída',
          message: isEn
            ? `${succeeded} of ${albumIds.length} albums had their video streams renewed successfully!${failed > 0 ? ` (${failed} failed)` : ''}`
            : `${succeeded} de ${albumIds.length} álbuns tiveram seus streams de vídeo renovados com sucesso!${failed > 0 ? ` (${failed} falharam)` : ''}`,
          type: failed > 0 ? 'warning' : 'success'
        });
      } else {
        finalState.addNotification({
          title: isEn ? 'Streams Renewal Failed' : 'Falha na Renovação',
          message: isEn
            ? 'Could not renew video streams for the albums in the list.'
            : 'Não foi possível renovar os links de stream dos álbuns da lista.',
          type: 'error'
        });
      }

      return { succeeded, failed };
    },

    removeImagesFromAlbum: async (albumId, imageIds) => {
      try {
        await backendApi.deleteAlbumImages(albumId, imageIds);
        await get().fetchTrash();
      } catch (_) {}
      set(state => ({
        albums: state.albums.map(a => {
          if (a.id !== albumId) return a;
          const updatedImages = (a.images || []).filter(img => !imageIds.includes(img.id));
          const updatedBytes = updatedImages.reduce((sum, img) => sum + (img.fileSizeBytes || 0), 0);
          return {
            ...a,
            images: updatedImages,
            imageCount: updatedImages.length,
            totalSizeBytes: updatedBytes,
            coverImage: updatedImages[0]?.thumbnailUrl || a.coverImage,
            updatedAt: new Date().toISOString()
          };
        })
      }));
      get().addNotification({
        title: 'Fotos Movidas para a Lixeira',
        message: `${imageIds.length} foto(s) enviada(s) para a lixeira do app.`,
        type: 'warning'
      });
    },

    toggleFavoriteAlbum: (id) => {
      const currentAlbums = get().albums;
      const target = currentAlbums.find(a => a.id === id);
      const newFavState = target ? !target.isFavorite : true;

      // Update local state immediately
      const newAlbums = currentAlbums.map(a => (a.id === id ? { ...a, isFavorite: newFavState } : a));
      set({ albums: newAlbums });

      // Persist to localStorage
      if (typeof window !== 'undefined') {
        try {
          const favIds = newAlbums.filter(a => a.isFavorite).map(a => a.id);
          localStorage.setItem('imagex_favorite_albums', JSON.stringify(favIds));
        } catch (_) {}
      }

      // Synchronize with backend API
      backendApi.toggleAlbumFavorite(id).catch(err => {
        console.warn('Failed to persist album favorite to backend:', err);
      });
    },

    toggleFavoriteImage: (albumId, imageId) => {
      let storedFavs: string[] = [];
      if (typeof window !== 'undefined') {
        try {
          storedFavs = JSON.parse(localStorage.getItem('imagex_favorite_images') || '[]');
        } catch (_) {}
      }

      const favSet = new Set(storedFavs);
      const currentAlbums = get().albums;
      const album = currentAlbums.find(a => a.id === albumId);
      const img = (album?.images || []).find(i => i.id === imageId);
      const newFavState = img ? !(img as any).isFavorite : !favSet.has(imageId);

      if (newFavState) {
        favSet.add(imageId);
      } else {
        favSet.delete(imageId);
      }

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('imagex_favorite_images', JSON.stringify(Array.from(favSet)));
        } catch (_) {}
      }

      set(state => {
        const updatedAlbums = state.albums.map(a => {
          if (a.id !== albumId) return a;
          const updatedImages = (a.images || []).map(i =>
            i.id === imageId ? { ...i, isFavorite: newFavState } : i
          );
          return { ...a, images: updatedImages };
        });

        const updatedLightboxImage =
          state.lightboxImage && state.lightboxImage.id === imageId
            ? { ...state.lightboxImage, isFavorite: newFavState }
            : state.lightboxImage;

        return {
          albums: updatedAlbums,
          lightboxImage: updatedLightboxImage
        };
      });
    },


    addJob: (job) => {
      set(state => {
        const existing = state.jobs.some(j => j.id === job.id);
        const newJobs = existing ? state.jobs.map(j => j.id === job.id ? job : j) : [job, ...state.jobs];
        const activeJobs = newJobs.filter(j => j.status === 'active' || j.status === 'paused');
        return {
          jobs: newJobs,
          activeJob: (!state.activeJob || state.activeJob.status === 'completed') ? job : state.activeJob,
          activeJobs,
          sessionJobIds: Array.from(new Set([...state.sessionJobIds, job.id])),
          dismissedDockJobIds: state.dismissedDockJobIds.filter(id => id !== job.id)
        };
      });
    },

    updateJob: (id, updates) => {
      set(state => {
        const updatedJobs = state.jobs.map(j => (j.id === id ? { ...j, ...updates } : j));
        const updatedActive = state.activeJob?.id === id ? { ...state.activeJob, ...updates } : state.activeJob;
        const activeJobs = updatedJobs.filter(j => j.status === 'active' || j.status === 'paused');
        return { jobs: updatedJobs, activeJob: updatedActive, activeJobs };
      });
    },

    setActiveJob: (job) => set({ activeJob: job }),

    cancelJob: async (id) => {
      try {
        await backendApi.cancelJob(id);
      } catch (_) {}
      const unsub = activeSSESubscriptions.get(id);
      if (unsub) {
        try { unsub(); } catch (_) {}
        activeSSESubscriptions.delete(id);
      }
      set(state => {
        const updatedJobs = state.jobs.map(j => (j.id === id ? { ...j, status: 'cancelled' as const, currentStage: getIsEn() ? 'Cancelled by user' : 'Cancelado pelo usuário' } : j));
        const activeJobs = updatedJobs.filter(j => j.status === 'active' || j.status === 'paused');
        const updatedActive = state.activeJob?.id === id ? (activeJobs[0] || null) : state.activeJob;
        const nextDismissed = Array.from(new Set([...state.dismissedDockJobIds, id]));
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_dismissed_dock_jobs', JSON.stringify(nextDismissed));
          } catch (_) {}
        }
        return {
          jobs: updatedJobs,
          activeJob: updatedActive,
          activeJobs,
          dismissedDockJobIds: nextDismissed,
          sessionJobIds: state.sessionJobIds.filter(jid => jid !== id)
        };
      });
      get().addNotification({
        title: 'Job Cancelado',
        message: `A tarefa #${id} foi abortada com sucesso.`,
        type: 'warning'
      });
    },

    pauseJob: async (id) => {
      try {
        await backendApi.pauseJob(id);
      } catch (_) {}
      set(state => {
        const updatedJobs = state.jobs.map(j => (j.id === id ? { ...j, status: 'paused' as any, currentStage: getIsEn() ? 'Paused by user' : 'Pausado pelo usuário' } : j));
        const activeJobs = updatedJobs.filter(j => j.status === 'active' || j.status === 'paused');
        const updatedActive = state.activeJob?.id === id ? { ...state.activeJob, status: 'paused' as any, currentStage: getIsEn() ? 'Paused by user' : 'Pausado pelo usuário' } : state.activeJob;
        return { jobs: updatedJobs, activeJob: updatedActive, activeJobs };
      });
      get().addNotification({
        title: 'Job Pausado',
        message: `A tarefa #${id} foi pausada com sucesso.`,
        type: 'info'
      });
    },

    resumeJob: async (id) => {
      try {
        await backendApi.resumeJob(id);
      } catch (_) {}
      const nowIso = new Date().toISOString();
      set(state => {
        const updatedJobs = state.jobs.map(j =>
          j.id === id
            ? {
                ...j,
                status: 'active' as const,
                startTime: nowIso,
                durationSeconds: 0,
                currentStage: getIsEn() ? 'Connecting & resolving Full HD stream...' : 'Conectando e resolvendo stream Full HD...'
              }
            : j
        );
        const activeJobs = updatedJobs.filter(j => j.status === 'active' || j.status === 'paused');
        const updatedActive =
          state.activeJob?.id === id
            ? {
                ...state.activeJob,
                status: 'active' as const,
                startTime: nowIso,
                durationSeconds: 0,
                currentStage: getIsEn() ? 'Connecting & resolving Full HD stream...' : 'Conectando e resolvendo stream Full HD...'
              }
            : state.activeJob;
        const nextDismissed = state.dismissedDockJobIds.filter(dId => dId !== id);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_dismissed_dock_jobs', JSON.stringify(nextDismissed));
          } catch (_) {}
        }
        return {
          jobs: updatedJobs,
          activeJob: updatedActive,
          activeJobs,
          sessionJobIds: Array.from(new Set([...state.sessionJobIds, id])),
          dismissedDockJobIds: nextDismissed
        };
      });
      triggerJobsPollingLoop();
      setTimeout(() => {
        get().syncJobs();
      }, 400);
      get().addNotification({
        title: 'Job Retomado',
        message: `A tarefa #${id} foi retomada com sucesso.`,
        type: 'success'
      });
    },

    retryJob: async (job: ExtractionJob) => {
      const isVideoSave = (job.mode as string) === 'video_save' || (job.mode as string) === 'video_downloader';
      const stageMsg = isVideoSave
        ? (getIsEn() ? 'Connecting & resolving Full HD stream...' : 'Conectando e resolvendo stream Full HD...')
        : (getIsEn() ? 'Re-running extraction in background...' : 'Re-executando extração em segundo plano...');
      const nowIso = new Date().toISOString();
      const shouldResetStale99 = job.progressPercent >= 99;

      // Optimistically transition the clicked card in-place so the user gets immediate visual feedback
      set(state => {
        const updatedJobs = state.jobs.map(j =>
          j.id === job.id
            ? {
                ...j,
                status: 'active' as const,
                startTime: nowIso,
                durationSeconds: 0,
                throughputMbps: 0,
                downloadedBytes: shouldResetStale99 ? 0 : j.downloadedBytes,
                totalBytes: shouldResetStale99 ? 0 : j.totalBytes,
                currentStage: stageMsg,
                progressPercent: shouldResetStale99 ? 0 : (j.progressPercent > 0 && j.progressPercent < 99 ? j.progressPercent : 5)
              }
            : j
        );
        const activeJobs = updatedJobs.filter(j => j.status === 'active' || j.status === 'paused');
        const nextDismissed = state.dismissedDockJobIds.filter(dId => dId !== job.id);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_dismissed_dock_jobs', JSON.stringify(nextDismissed));
          } catch (_) {}
        }
        return {
          jobs: updatedJobs,
          activeJob:
            state.activeJob?.id === job.id
              ? { ...state.activeJob, status: 'active' as const, startTime: nowIso, durationSeconds: 0, currentStage: stageMsg }
              : state.activeJob,
          activeJobs,
          sessionJobIds: Array.from(new Set([...state.sessionJobIds, job.id])),
          dismissedDockJobIds: nextDismissed
        };
      });

      // Attempt in-place resume/relaunch on the backend first (preserves session_id and partial files)
      try {
        const resumedInPlace = await backendApi.resumeJob(job.id);
        if (resumedInPlace) {
          if (!isVideoSave) {
            get().subscribeToJob(job.id, job.url);
          }
          triggerJobsPollingLoop();
          setTimeout(() => {
            get().syncJobs();
          }, 400);
          get().addNotification({
            title: getIsEn() ? 'Re-execution Started' : 'Re-execução Iniciada',
            message: getIsEn()
              ? `Task "${job.title || job.url}" restarted in background.`
              : `A tarefa "${job.title || job.url}" foi reiniciada em segundo plano.`,
            type: 'info'
          });
          return true;
        }
      } catch (_) {}

      // Fallback if job record was not found on backend (e.g., deleted externally)
      if (isVideoSave) {
        const cleanTitle = (job.title || 'video_extraido').replace(/^(?:Save Video:\s*|Salvar Vídeo:\s*)+/i, '').trim() || 'video_extraido';
        await get().deleteJob(job.id);
        return await get().saveExtractedVideoToGallery(
          job.url,
          cleanTitle,
          job.folder || 'Extraídos'
        );
      }

      const { settings, activeAiEngine } = get();
      try {
        const isVid = (job.mode as string) === 'video_save' || (job.mode as string) === 'video_downloader';
        const res = await backendApi.startExtraction(
          job.url,
          (job.mode as any) || activeAiEngine || 'ai_react',
          job.aiModel || settings.aiModel,
          settings.geminiModel || 'gemini-3.7-flash',
          settings.reasoningBudget || 3,
          settings.maxConcurrency || 3,
          settings.antiBotDelayMs || 500,
          isVid ? 'videos' : 'all',
          job.folder || 'Geral'
        );

        if (res && res.session_id) {
          await get().deleteJob(job.id);
          let fallbackTitle = job.url;
          try {
            fallbackTitle = `Extração: ${new URL(job.url.startsWith('http') ? job.url : 'https://' + job.url).hostname}`;
          } catch (_) {}

          const newJob: ExtractionJob = {
            id: res.session_id,
            url: job.url,
            title: job.title || fallbackTitle,
            status: 'active',
            mode: (job.mode as any) || 'ai_react',
            aiModel: job.aiModel || `${settings.geminiModel || 'gemini-3.7-flash'} + ${settings.aiModel}`,
            progressPercent: 5,
            currentStage: getIsEn() ? 'Starting extraction in background...' : 'Iniciando extração em segundo plano...',
            discoveredImagesCount: 0,
            resolvedOriginalCount: 0,
            failedCount: 0,
            startTime: new Date().toISOString(),
            durationSeconds: 0,
            throughputMbps: 0,
            fps: 60,
            folder: job.folder || 'Geral'
          };

          get().addJob(newJob);
          get().subscribeToJob(res.session_id, job.url);
          triggerJobsPollingLoop();
          get().addNotification({
            title: get().settings?.language === 'en-US' ? 'Re-execution Started' : 'Re-execução Iniciada',
            message: get().settings?.language === 'en-US' ? `Extraction for "${job.title || job.url}" restarted in background.` : `Extração para "${job.title || job.url}" reiniciada automaticamente em segundo plano.`,
            type: 'info'
          });
          return true;
        }
        return false;
      } catch (err: any) {
        console.error('Failed to retry extraction job:', err);
        get().addNotification({
          title: 'Falha ao Re-executar',
          message: err?.message || (get().settings?.language === 'en-US' ? 'Server connection error while restarting task.' : 'Erro de conexão com o servidor ao re-executar tarefa.'),
          type: 'error'
        });
        return false;
      }
    },

    deleteJob: async (id) => {
      try {
        await backendApi.deleteJob(id);
      } catch (_) {}
      const unsub = activeSSESubscriptions.get(id);
      if (unsub) {
        try { unsub(); } catch (_) {}
        activeSSESubscriptions.delete(id);
      }
      set(state => {
        const remaining = state.jobs.filter(j => j.id !== id);
        const activeJobs = remaining.filter(j => j.status === 'active');
        return {
          jobs: remaining,
          activeJob: state.activeJob?.id === id ? (activeJobs[0] || null) : state.activeJob,
          activeJobs
        };
      });
    },

    clearCompletedJobs: async () => {
      try {
        await backendApi.clearFinishedJobs();
      } catch (_) {}
      set(state => {
        const remaining = state.jobs.filter(j => j.status === 'active' || j.status === 'queued' || j.status === 'paused');
        return {
          jobs: remaining,
          activeJobs: remaining.filter(j => j.status === 'active' || j.status === 'paused')
        };
      });
    },

    pauseAllJobs: async () => {
      try {
        await backendApi.pauseAllJobs();
      } catch (_) {}
      set(state => {
        const updated = state.jobs.map(j => {
          if (j.status === 'active') {
            return { ...j, status: 'paused' as any, currentStage: 'Pausado em lote' };
          }
          return j;
        });
        return {
          jobs: updated,
          activeJobs: updated.filter(j => j.status === 'active' || j.status === 'paused')
        };
      });
      get().addNotification({
        title: 'Fila Pausada',
        message: 'Todas as tarefas ativas foram pausadas com sucesso.',
        type: 'info'
      });
    },

    resumeAllJobs: async () => {
      try {
        await backendApi.resumeAllJobs();
      } catch (_) {}
      set(state => {
        const updated = state.jobs.map(j => {
          if (j.status === 'paused') {
            return { ...j, status: 'active' as any, currentStage: 'Retomando em lote...' };
          }
          return j;
        });
        return {
          jobs: updated,
          activeJobs: updated.filter(j => j.status === 'active' || j.status === 'paused')
        };
      });
      triggerJobsPollingLoop();
      setTimeout(() => {
        get().syncJobs();
      }, 400);
      get().addNotification({
        title: 'Fila Retomada',
        message: 'Tarefas pausadas foram retomadas com sucesso.',
        type: 'success'
      });
    },

    retryAllFailedJobs: async () => {
      try {
        await backendApi.retryAllFailedJobs();
      } catch (_) {}
      set(state => {
        const updated = state.jobs.map(j => {
          if (j.status === 'failed' || j.status === 'cancelled') {
            return { ...j, status: 'active' as any, currentStage: 'Na fila de re-execução em lote...' };
          }
          return j;
        });
        return {
          jobs: updated,
          activeJobs: updated.filter(j => j.status === 'active' || j.status === 'paused')
        };
      });
      triggerJobsPollingLoop();
      setTimeout(() => {
        get().syncJobs();
      }, 400);
      get().addNotification({
        title: getIsEn() ? 'Batch Retry Started' : 'Re-execução em Lote Iniciada',
        message: getIsEn() ? 'All failed and cancelled tasks have been re-queued.' : 'Todas as tarefas com falha ou canceladas foram reenfileiradas.',
        type: 'info'
      });
    },

    clearActiveJob: () => {
      set(state => {
        const activeJobs = state.jobs.filter(j => j.status === 'active');
        return {
          activeJob: null,
          activeJobs,
          setOfMarks: [],
          inspectingMarkId: null
        };
      });
    },

    subscribeToJob: (sessionId: string, url: string) => {
      if (activeSSESubscriptions.has(sessionId)) return;
      const unsub = backendApi.subscribeToSessionEvents(
        sessionId,
        (eventData) => {
          if (eventData.type === 'log') {
            get().addLog({ level: eventData.level || 'info', category: eventData.category || 'AGENT_EVENT', message: eventData.message || '' });
          } else if (eventData.type === 'ai_thought') {
            get().addLog({
              level: 'ai',
              category: eventData.stage || 'AI_REASONING',
              message: eventData.thought || ''
            });
            get().updateJob(sessionId, { currentStage: eventData.thought });
          } else if (eventData.type === 'status') {
            get().updateJob(sessionId, { currentStage: eventData.message });
            get().addLog({
              level: 'info',
              category: 'STATUS',
              message: eventData.message || ''
            });
          } else if (eventData.type === 'inspecting_candidate') {
            const pos = eventData.position || 1;
            set({ inspectingMarkId: pos });
            get().addLog({
              level: 'dom',
              category: 'DOM_INSPECT',
              message: `Inspecionando elemento #${pos}: ${eventData.selector || eventData.url || 'Nó DOM sob análise'}`
            });
          } else if (eventData.type === 'album_init') {
            get().updateJob(sessionId, {
              discoveredImagesCount: eventData.total_candidates,
              title: eventData.title || undefined
            });
            get().addLog({
              level: 'info',
              category: 'PAGE_INGESTION',
              message: `Página carregada: "${eventData.title || 'Galeria'}" (${eventData.total_candidates} candidatos detectados no DOM)`
            });
          } else if (eventData.type === 'image_resolved' || eventData.type === 'candidate_processed') {
            const pos = eventData.position || eventData.image?.position || 1;
            const isPass = eventData.validation_status === 'PASS' || eventData.image?.validation_status === 'PASS';
            const isNoise = eventData.image?.classification === 'banner_noise' || eventData.validation_status === 'REJECTED';
            const rawThumb = eventData.image?.thumbnail_url || eventData.thumbnail_url || eventData.image?.src || '';
            const safeThumb = rawThumb ? (rawThumb.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : rawThumb) : '';
            const dims = eventData.dimensions || (eventData.image?.width ? `${eventData.image.width}x${eventData.image.height}` : 'Original');

            get().addLog({
              level: isPass ? 'ai' : isNoise ? 'warning' : 'dom',
              category: isPass ? 'ORIGINAL_RESOLVED' : isNoise ? 'NOISE_REJECTED' : 'CANDIDATE_EVAL',
              message: isPass
                ? `Foto #${pos} validada em alta resolução (${dims}) via ${eventData.image?.resolution_method || 'vetor direto'}`
                : isNoise
                ? `Elemento #${pos} descartado como ruído/ad banner`
                : `Avaliando candidato #${pos} (${dims})`
            });

            const newMark: SetOfMarkCandidate = {
              id: pos,
              thumbnailUrl: safeThumb,
              resolvedOriginalUrl: eventData.image?.original_url || eventData.resolved_url,
              label: isPass ? `Foto #${pos} (${dims})` : (isNoise ? `Ruído / Banner #${pos}` : `Candidato #${pos}`),
              type: isPass ? 'album_item' : (isNoise ? 'banner_noise' : 'unresolved'),
              confidence: 0.98,
              box: { top: 0, left: 0, width: 200, height: 200 }
            };

            set(state => {
              const existingIdx = state.setOfMarks.findIndex(m => m.id === pos);
              const updatedMarks = [...state.setOfMarks];
              if (existingIdx >= 0) {
                updatedMarks[existingIdx] = newMark;
              } else {
                updatedMarks.push(newMark);
              }
              return {
                setOfMarks: updatedMarks,
                inspectingMarkId: pos
              };
            });

            const jobState = get().jobs.find(j => j.id === sessionId);
            if (jobState) {
              const maxTotal = jobState.discoveredImagesCount || 1;
              get().updateJob(sessionId, {
                resolvedOriginalCount: isPass ? Math.max(jobState.resolvedOriginalCount || 0, pos) : jobState.resolvedOriginalCount,
                progressPercent: Math.min(99, Math.round((pos / Math.max(1, maxTotal)) * 100))
              });
            }
          }
        },
        (finishedAlbum) => {
          get().addAlbum(finishedAlbum);
          get().updateJob(sessionId, {
            status: 'completed',
            progressPercent: 100,
            currentStage: getIsEn() ? 'Extraction 100% Completed!' : 'Extração 100% Concluída!',
            resultAlbumId: finishedAlbum.id,
            resolvedOriginalCount: finishedAlbum.images.length,
            discoveredImagesCount: finishedAlbum.images.length
          });
          const u = activeSSESubscriptions.get(sessionId);
          if (u) {
            try { u(); } catch (_) {}
            activeSSESubscriptions.delete(sessionId);
          }
        },
        (err) => {
          get().updateJob(sessionId, { status: 'failed', currentStage: `Erro: ${err}` });
          const u = activeSSESubscriptions.get(sessionId);
          if (u) {
            try { u(); } catch (_) {}
            activeSSESubscriptions.delete(sessionId);
          }
        }
      );
      activeSSESubscriptions.set(sessionId, unsub);
    },

    addLog: (log) => {
      const now = new Date();
      const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
      const entry: LogEntry = {
        ...log,
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp
      };
      set(state => {
        const updatedLogs = [entry, ...state.logs.slice(0, 1999)];
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_logs', JSON.stringify(updatedLogs.slice(0, 500)));
          } catch (_) {}
        }
        return { logs: updatedLogs };
      });
    },

    clearLogs: () => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('imagex_logs');
        } catch (_) {}
      }
      set({ logs: [] });
    },

    addNotification: (notif) => {
      const now = new Date();
      const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const item: NotificationItem = {
        ...notif,
        id: `notif-${Date.now()}`,
        timestamp,
        isRead: false
      };
      set(state => {
        const updated = [item, ...state.notifications].slice(0, 50);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_notifications', JSON.stringify(updated));
          } catch (_) {}
        }
        return { notifications: updated };
      });
    },

    markNotificationsAsRead: () => {
      set(state => {
        const updated = state.notifications.map(n => ({ ...n, isRead: true }));
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_notifications', JSON.stringify(updated));
          } catch (_) {}
        }
        return { notifications: updated };
      });
    },

    updateSettings: (updates) => {
      set(state => {
        const newSettings = { ...state.settings, ...updates };
        try {
          localStorage.setItem('imagex_settings', JSON.stringify(newSettings));
        } catch (_) {}

        if (updates.ambientSoundType !== undefined || updates.ambientSoundVolume !== undefined) {
          ambientAudio.play(newSettings.ambientSoundType, newSettings.ambientSoundVolume);
        }

        return { settings: newSettings };
      });
    },

    setActiveAiEngine: (engine) => {
      set({ activeAiEngine: engine });
      const { settings, updateSettings } = get();
      updateSettings({ defaultAiEngine: engine });
    },

    toggleSelectImage: (id) => {
      set(state => ({
        selectedImageIds: state.selectedImageIds.includes(id)
          ? state.selectedImageIds.filter(i => i !== id)
          : [...state.selectedImageIds, id]
      }));
    },

    selectAllImages: (allIds) => set({ selectedImageIds: allIds }),
    clearSelectedImages: () => set({ selectedImageIds: [] }),
    selectOnlyOriginalImages: (images) => {
      set({ selectedImageIds: images.filter(i => i.isResolvedOriginal).map(i => i.id) });
    },

    toggleSelectAlbum: (id) => {
      set(state => ({
        selectedAlbumIds: state.selectedAlbumIds.includes(id)
          ? state.selectedAlbumIds.filter(i => i !== id)
          : [...state.selectedAlbumIds, id]
      }));
    },

    selectAllAlbums: (allIds) => set({ selectedAlbumIds: allIds }),
    clearSelectedAlbums: () => set({ selectedAlbumIds: [] }),

    openLightbox: (image, album, originRect) => {
      const { settings, lightboxImage } = get();
      soundEffects.whoosh(settings.soundEnabled);
      const isAlreadyOpen = Boolean(lightboxImage);
      set({
        lightboxImage: image,
        lightboxAlbum: album || null,
        lightboxOriginRect: isAlreadyOpen ? null : (originRect || null),
        lightboxAnimationMode: isAlreadyOpen ? 'switch' : 'open',
        lightboxAnimCounter: (get().lightboxAnimCounter || 0) + 1,
      });
    },
    closeLightbox: () => {
      exitAllFullscreen();
      set({
        lightboxImage: null,
        lightboxAlbum: null,
        lightboxOriginRect: null,
        lightboxAnimationMode: 'open',
      });
    },
    setLightboxFullscreen: (fullscreen) => {
      set({
        lightboxAnimationMode: fullscreen ? 'fullscreen' : 'switch',
        lightboxAnimCounter: (get().lightboxAnimCounter || 0) + 1,
      });
    },

    setSlideshowOpen: (open, initialIndex = 0, mode = 'album') => {
      if (!open) exitAllFullscreen();
      set(state => ({
        slideshowOpen: open,
        slideshowInitialIndex: Math.max(0, initialIndex),
        slideshowMode: mode,
        globalSliderConfig: {
          ...state.globalSliderConfig,
          scope: mode === 'global' ? 'all_app' : 'current_album',
        },
      }));
    },
    setGlobalSliderConfig: (partial) => {
      set(state => ({
        globalSliderConfig: {
          ...state.globalSliderConfig,
          ...partial,
        },
      }));
    },
    setContactSheetOpen: (open) => set({ contactSheetOpen: open }),

    setCoPilotOpen: (open) => set({ coPilotOpen: open }),

    openExportModal: (album) => {
      const { settings } = get();
      soundEffects.whoosh(settings.soundEnabled);
      set({ exportModalOpen: true, exportModalAlbum: album });
    },
    closeExportModal: () => set({ exportModalOpen: false, exportModalAlbum: null }),

    setKeybindingsModalOpen: (open) => set({ keybindingsModalOpen: open }),
    setWebhookModalOpen: (open) => set({ webhookModalOpen: open }),
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setNotificationDrawerOpen: (open) => set({ notificationDrawerOpen: open }),
    setAlbumDiffModalOpen: (open) => set({ albumDiffModalOpen: open }),
    setColorHarmonyOpen: (open) => set({ colorHarmonyOpen: open }),

    setGalleryViewMode: (mode) => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('imagex_gallery_view_mode', mode);
        } catch (_) {}
      }
      set({ galleryViewMode: mode });
    },
    setGallerySearchQuery: (query) => set({ gallerySearchQuery: query }),
    setGalleryColorFilter: (color) => set({ galleryColorFilter: color }),
    setAlbumColorFilter: (color) => set({ albumColorFilter: color }),
    setGalleryTagFilter: (tag) => set({ galleryTagFilter: tag }),
    setGallerySortBy: (sortBy) => {
      const nextOrder: 'asc' | 'desc' = sortBy === 'name' ? 'asc' : 'desc';
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('imagex_gallery_sort_by', sortBy);
          localStorage.setItem('imagex_gallery_sort_order', nextOrder);
        } catch (_) {}
      }
      set({ gallerySortBy: sortBy, gallerySortOrder: nextOrder });
    },

    toggleGallerySortOrder: () =>
      set(state => {
        const next = state.gallerySortOrder === 'asc' ? 'desc' : 'asc';
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('imagex_gallery_sort_order', next);
          } catch (_) {}
        }
        return { gallerySortOrder: next };
      }),
    setAlbumDetailZoomCols: (cols) => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('imagex_album_zoom_cols', String(cols));
        } catch (_) {}
      }
      set({ albumDetailZoomCols: cols });
    },

    // ==========================================
    // Video Gallery Actions
    // ==========================================
    syncVideos: async (healThumbnails: boolean = false) => {
      try {
        const { videos, folders } = await backendApi.fetchVideos(healThumbnails);
        set({ videos, videoFolders: folders });
      } catch (err) {
        console.warn('Failed to sync videos:', err);
      }
    },

    renewVideoStreams: async (videoIds?: string[], folder?: string) => {
      const state = get();
      if (state.isRenewingVideoStreams) return { succeeded: 0, failed: 0 };
      const lang = state.settings?.language || 'pt-BR';
      const isEn = lang === 'en-US';
      const tVid = translations[lang]?.videos || translations['en-US'].videos;
      set({ isRenewingVideoStreams: true });
      get().addNotification({
        title: tVid.renewStartedTitle || (isEn ? 'Renewing Video Streams' : 'Renovando Streams'),
        message: tVid.renewStartedMsg || (isEn
          ? 'Starting renewal of video stream links in background...'
          : 'Iniciando renovação dos links de stream em segundo plano...'),
        type: 'info'
      });
      try {
        const res = await backendApi.renewVideoStreams(videoIds, folder);
        await get().syncVideos();
        if (res.refreshed > 0) {
          const successMsg = (tVid.renewSuccess || (isEn
            ? '{count} video streams renewed successfully!'
            : '{count} streams de vídeo renovados com sucesso!'))
            .replace('{count}', String(res.refreshed));
          const warningMsg = (tVid.renewWarning || (isEn
            ? '{succeeded} of {total} streams renewed ({failed} failed).'
            : '{succeeded} de {total} streams renovados ({failed} falharam).'))
            .replace('{succeeded}', String(res.refreshed))
            .replace('{total}', String(res.refreshed + res.failed))
            .replace('{failed}', String(res.failed));

          get().addNotification({
            title: tVid.renewCompletedTitle || (isEn ? 'Streams Renewal Completed' : 'Renovação Concluída'),
            message: res.failed > 0 ? warningMsg : successMsg,
            type: res.failed > 0 ? 'warning' : 'success'
          });
          if (res.deletedOnSource && res.deletedOnSource > 0) {
            get().addNotification({
              title: isEn ? 'Removed on Source Website' : 'Removido no Site de Origem',
              message: isEn
                ? `${res.deletedOnSource} video(s) were permanently removed on the source website (DMCA/Copyright) and marked with a warning badge.`
                : `${res.deletedOnSource} vídeo(s) foram excluídos permanentemente no site de origem (DMCA/Direitos Autorais) e marcados com selo de aviso.`,
              type: 'warning'
            });
          }
        } else {
          if (res.deletedOnSource && res.deletedOnSource > 0) {
            get().addNotification({
              title: isEn ? 'Removed on Source Website' : 'Removido no Site de Origem',
              message: isEn
                ? `All ${res.deletedOnSource} selected video(s) were permanently deleted on the source website (DMCA/Copyright).`
                : `Todos os ${res.deletedOnSource} vídeo(s) selecionados foram excluídos permanentemente no site de origem (DMCA/Direitos Autorais).`,
              type: 'warning'
            });
          } else {
            get().addNotification({
              title: tVid.renewFailedTitle || (isEn ? 'Streams Renewal Failed' : 'Falha na Renovação'),
              message: tVid.renewError || (isEn
                ? 'Could not renew video streams at this time.'
                : 'Não foi possível renovar os links de stream dos vídeos no momento.'),
              type: 'error'
            });
          }
        }
        return { succeeded: res.refreshed, failed: res.failed };
      } catch (err) {
        console.error('Error renewing video streams:', err);
        return { succeeded: 0, failed: videoIds?.length || 1 };
      } finally {
        set({ isRenewingVideoStreams: false });
      }
    },

    uploadVideo: async (file: File, folder: string = 'Geral', fileIndex: number = 1, totalFiles: number = 1) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);

      set({
        uploadProgress: {
          isUploading: true,
          filename: file.name,
          percent: 0,
          loaded: 0,
          total: file.size,
          speed: 0,
          currentFileIndex: fileIndex,
          totalFiles: totalFiles
        }
      });

      const res = await backendApi.uploadVideo(file, folder, (percent, loaded, total, speed) => {
        set({
          uploadProgress: {
            isUploading: true,
            filename: file.name,
            percent,
            loaded,
            total,
            speed,
            currentFileIndex: fileIndex,
            totalFiles: totalFiles
          }
        });
      });

      set({ uploadProgress: null });

      if (res) {
        await get().syncVideos();
        soundEffects.success(settings.soundEnabled);
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Video Imported' : 'Vídeo Importado',
          message: get().settings?.language === 'en-US' ? `Video "${res.title}" imported successfully into folder ${res.folder}.` : `O vídeo "${res.title}" foi importado com sucesso na pasta ${res.folder}.`,
          type: 'success'
        });
        return true;
      } else {
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Import Failed' : 'Falha na Importação',
          message: get().settings?.language === 'en-US' ? `Could not import video "${file.name}".` : `Não foi possível importar o vídeo "${file.name}".`,
          type: 'error'
        });
        return false;
      }
    },

    importLocalPath: async (path: string, folder: string = 'Geral', mode: 'copy' | 'move' = 'copy') => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const res = await backendApi.importLocalPath(path, folder, mode);
      if (res.success && res.count > 0) {
        await get().syncVideos();
        soundEffects.success(settings.soundEnabled);
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Instant Import' : 'Importação Instantânea',
          message: get().settings?.language === 'en-US' ? `${res.count} video(s) imported successfully into folder ${folder}.` : `${res.count} vídeo(s) importado(s) com sucesso na pasta ${folder}.`,
          type: 'success'
        });
        return true;
      } else {
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Local Import Error' : 'Erro na Importação Local',
          message: res.error || (get().settings?.language === 'en-US' ? 'No compatible videos found at specified path.' : 'Nenhum vídeo compatível encontrado no caminho especificado.'),
          type: 'error'
        });
        return false;
      }
    },

    openVideosFolder: async (folder: string = 'Geral') => {
      const res = await backendApi.openVideosFolder(folder);
      if (res.success) {
        get().addNotification({
          title: 'Pasta Aberta',
          message: `A pasta data/videos/${res.folder || 'Geral'} foi aberta no Windows Explorer.`,
          type: 'info'
        });
        return true;
      }
      return false;
    },

    addVideoByUrl: async (url: string, folder: string = 'Geral', title?: string, streamOnly: boolean = false) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const res = await backendApi.addVideoUrl(url, folder, title, streamOnly);
      if (res) {
        await get().syncVideos();
        get().addNotification({
          title: get().settings?.language === 'en-US' ? (streamOnly ? 'Remote Stream Added' : 'Video Downloaded') : (streamOnly ? 'Stream Remoto Adicionado' : 'Vídeo Baixado'),
          message: streamOnly
            ? `Vídeo remoto "${res.title}" adicionado para reprodução sem ocupar espaço local.`
            : `Vídeo "${res.title}" salvo na pasta ${res.folder}.`,
          type: 'success'
        });
        return true;
      }
      return false;
    },

    uploadPhotoAlbum: async (title: string, files: File[], folder?: string) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const targetFolder = (folder || 'Geral').trim() || 'Geral';
      const res = await backendApi.uploadPhotoAlbum(title, files, targetFolder);
      if (res && res.success) {
        const albums = await backendApi.fetchRealAlbums();
        set({ albums });
        await get().syncAlbumFolders();
        soundEffects.success(settings.soundEnabled);
        const curLang = (get().settings?.language || 'pt-BR') as 'pt-BR' | 'en-US';
        const tStore = translations[curLang]?.store || translations['pt-BR']?.store;
        get().addNotification({
          title: tStore?.albumCreatedTitle || (curLang === 'en-US' ? 'Album Created!' : 'Álbum Criado!'),
          message: (tStore?.albumCreatedMsg || 'O álbum "{title}" com {count} fotos foi adicionado na pasta "{folder}".')
            .replace('{title}', title)
            .replace('{count}', String(files.length))
            .replace('{folder}', targetFolder),
          type: 'success'
        });
        return true;
      } else {
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Error Creating Album' : 'Erro ao Criar Álbum',
          message: res?.error || 'Falha no envio das imagens.',
          type: 'error'
        });
        return false;
      }
    },

    createVideoFolder: async (name: string) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const ok = await backendApi.createVideoFolder(name);
      if (ok) {
        await get().syncVideos();
        get().addNotification({
          title: 'Pasta Criada',
          message: `A pasta "${name}" foi criada com sucesso no armazenamento.`,
          type: 'success'
        });
        return true;
      }
      return false;
    },

    renameVideoFolder: async (oldName: string, newName: string) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const ok = await backendApi.renameVideoFolder(oldName, newName);
      if (ok) {
        await get().syncVideos();
        if (get().activeVideoFolder === oldName) {
          set({ activeVideoFolder: newName });
        }
        get().addNotification({
          title: 'Pasta Renomeada',
          message: `Pasta renomeada de "${oldName}" para "${newName}".`,
          type: 'success'
        });
        return true;
      }
      return false;
    },

    deleteVideoFolder: async (folderName: string) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const ok = await backendApi.deleteVideoFolder(folderName);
      if (ok) {
        if (get().activeVideoFolder === folderName) {
          set({ activeVideoFolder: null });
        }
        await get().syncVideos();
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Folder Deleted' : 'Pasta Excluída',
          message: `Pasta "${folderName}" excluída. Os vídeos foram movidos para a pasta Geral.`,
          type: 'info'
        });
        return true;
      }
      return false;
    },

    renameVideo: async (videoId: string, title: string) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const ok = await backendApi.renameVideo(videoId, title);
      if (ok) {
        await get().syncVideos();
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Video Renamed' : 'Vídeo Renomeado',
          message: get().settings?.language === 'en-US' ? `Title changed to "${title}".` : `Título alterado para "${title}".`,
          type: 'success'
        });
        return true;
      }
      return false;
    },

    moveVideo: async (videoId: string, targetFolder: string) => {
      const { settings } = get();
      soundEffects.click(settings.soundEnabled);
      const ok = await backendApi.moveVideo(videoId, targetFolder);
      if (ok) {
        await get().syncVideos();
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Video Moved' : 'Vídeo Movido',
          message: get().settings?.language === 'en-US' ? `Video moved to folder "${targetFolder}".` : `Vídeo movido para a pasta "${targetFolder}".`,
          type: 'success'
        });
        return true;
      }
      return false;
    },

    toggleVideoFavorite: async (videoId: string) => {
      const { settings } = get();
      soundEffects.star(settings.soundEnabled);
      const isFav = await backendApi.toggleVideoFavorite(videoId);
      set(state => ({
        videos: state.videos.map(v => v.id === videoId ? { ...v, isFavorite: isFav } : v),
        activePlayingVideo: state.activePlayingVideo?.id === videoId ? { ...state.activePlayingVideo, isFavorite: isFav } : state.activePlayingVideo
      }));
      return isFav;
    },

    deleteVideo: async (videoId: string) => {
      const { settings } = get();
      soundEffects.trash(settings.soundEnabled);
      const ok = await backendApi.deleteVideo(videoId);
      if (ok) {
        set(state => ({
          videos: state.videos.filter(v => v.id !== videoId),
          selectedVideoIds: state.selectedVideoIds.filter(id => id !== videoId),
          activePlayingVideo: state.activePlayingVideo?.id === videoId ? null : state.activePlayingVideo
        }));
        await get().syncVideos();
        await get().fetchTrash();
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Video Moved to Trash' : 'Vídeo Movido para a Lixeira',
          message: get().settings?.language === 'en-US' ? 'Video moved to trash and can be restored at any time.' : 'O vídeo foi enviado para a lixeira do app e pode ser restaurado a qualquer momento.',
          type: 'warning'
        });
        return true;
      }
      return false;
    },

    toggleSelectVideo: (id: string) => {
      set(state => {
        const isSelected = state.selectedVideoIds.includes(id);
        return {
          selectedVideoIds: isSelected
            ? state.selectedVideoIds.filter(item => item !== id)
            : [...state.selectedVideoIds, id]
        };
      });
    },

    selectAllVideos: (allIds: string[]) => set({ selectedVideoIds: allIds }),

    clearSelectedVideos: () => set({ selectedVideoIds: [] }),

    batchDeleteVideos: async (videoIds: string[]) => {
      const { settings } = get();
      soundEffects.trash(settings.soundEnabled);
      const deleted = await backendApi.batchDeleteVideos(videoIds);
      if (deleted.length > 0) {
        set(state => ({
          videos: state.videos.filter(v => !deleted.includes(v.id)),
          selectedVideoIds: state.selectedVideoIds.filter(id => !deleted.includes(id)),
          activePlayingVideo: state.activePlayingVideo && deleted.includes(state.activePlayingVideo.id) ? null : state.activePlayingVideo
        }));
        await get().syncVideos();
        await get().fetchTrash();
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Videos Moved to Trash' : 'Vídeos Movidos para a Lixeira',
          message: get().settings?.language === 'en-US' ? `${deleted.length} video(s) moved to trash.` : `${deleted.length} vídeo(s) foram enviados para a lixeira do app.`,
          type: 'warning'
        });
        return true;
      }
      return false;
    },

    batchMoveVideos: async (videoIds: string[], targetFolder: string) => {
      const moved = await backendApi.batchMoveVideos(videoIds, targetFolder);
      if (moved.length > 0) {
        await get().syncVideos();
        set({ selectedVideoIds: [] });
        get().addNotification({
          title: get().settings?.language === 'en-US' ? 'Videos Transferred' : 'Vídeos Transferidos',
          message: get().settings?.language === 'en-US' ? `${moved.length} video(s) moved to folder "${targetFolder}".` : `${moved.length} vídeo(s) movido(s) para a pasta "${targetFolder}".`,
          type: 'success'
        });
        return true;
      }
      return false;
    },

    setActiveVideoFolder: (folder) => set({ activeVideoFolder: folder }),
    setVideoSearchQuery: (query) => set({ videoSearchQuery: query }),
    setVideoFilterFavoritesOnly: (favOnly) => set({ videoFilterFavoritesOnly: favOnly }),
    setActivePlayingVideo: (video) => {
      if (!video) exitAllFullscreen();
      set({ activePlayingVideo: video });
    },
    setActiveFolderModal: (modal) => set({ activeFolderModal: modal }),

    // Trash Bin Actions
    fetchTrash: async () => {
      try {
        const res = await backendApi.getTrash();
        set({ trashItems: res.items, trashStats: res.stats });
      } catch (err) {
        console.error('Failed to sync trash:', err);
      }
    },

    restoreTrashItems: async (trashIds: string[]) => {
      const { settings } = get();
      soundEffects.success(settings.soundEnabled);
      try {
        const restored = await backendApi.restoreTrash(trashIds);
        if (restored.length > 0) {
          const freshAlbums = await backendApi.fetchRealAlbums();
          set(state => ({
            albums: freshAlbums,
            selectedTrashIds: state.selectedTrashIds.filter(id => !restored.includes(id))
          }));
          await Promise.all([get().fetchTrash(), get().syncVideos()]);
          const curLang = (get().settings?.language || 'pt-BR') as 'pt-BR' | 'en-US';
          const tStore = translations[curLang]?.store || translations['pt-BR']?.store;
          get().addNotification({
            title: tStore?.itemsRestoredTitle || (curLang === 'en-US' ? 'Items Restored' : 'Itens Restaurados'),
            message: (tStore?.itemsRestoredMsg || '{count} item(ns) restaurado(s) com sucesso para o local original.')
              .replace('{count}', String(restored.length)),
            type: 'success'
          });
          return true;
        }
        return false;
      } catch (err) {
        console.error('Failed to restore trash items:', err);
        return false;
      }
    },

    permanentDeleteTrashItems: async (trashIds: string[]) => {
      const { settings } = get();
      soundEffects.trash(settings.soundEnabled);
      try {
        const deleted = await backendApi.permanentDeleteTrash(trashIds);
        if (deleted.length > 0) {
          await get().fetchTrash();
          set(state => ({
            selectedTrashIds: state.selectedTrashIds.filter(id => !deleted.includes(id))
          }));
          get().addNotification({
            title: get().settings?.language === 'en-US' ? 'Permanent Deletion' : 'Exclusão Permanente',
            message: get().settings?.language === 'en-US' ? `${deleted.length} item(s) permanently deleted from disk.` : `${deleted.length} item(ns) excluído(s) definitivamente do disco.`,
            type: 'info'
          });
          return true;
        }
        return false;
      } catch (err) {
        console.error('Failed to permanently delete trash items:', err);
        return false;
      }
    },

    emptyTrashBin: async () => {
      const { settings } = get();
      soundEffects.trash(settings.soundEnabled);
      try {
        const ok = await backendApi.emptyTrash();
        if (ok) {
          set({
            trashItems: [],
            trashStats: {
              total_items: 0,
              photos_count: 0,
              videos_count: 0,
              albums_count: 0,
              total_size_bytes: 0
            },
            selectedTrashIds: []
          });
          get().addNotification({
            title: 'Lixeira Esvaziada',
            message: 'Todos os arquivos foram apagados permanentemente do disco.',
            type: 'info'
          });
          return true;
        }
        return false;
      } catch (err) {
        console.error('Failed to empty trash:', err);
        return false;
      }
    },

    toggleSelectTrashItem: (id: string) => {
      set(state => ({
        selectedTrashIds: state.selectedTrashIds.includes(id)
          ? state.selectedTrashIds.filter(i => i !== id)
          : [...state.selectedTrashIds, id]
      }));
    },

    selectAllTrashItems: (allIds: string[]) => {
      set({ selectedTrashIds: allIds });
    },

    clearSelectedTrashItems: () => {
      set({ selectedTrashIds: [] });
    },

    setTrashFilterType: (type: 'all' | 'photo' | 'video' | 'album') => {
      set({ trashFilterType: type });
    },

    setTrashSearchQuery: (query: string) => {
      set({ trashSearchQuery: query });
    },

    setMediaTypeFilter: (filter: 'all' | 'images' | 'videos' | 'gifs') => {
      set({ mediaTypeFilter: filter });
    },

    saveExtractedVideoToGallery: async (videoUrl: string, title?: string, folder?: string, sourceUrl?: string, thumbnailUrl?: string, streamOnly: boolean = true) => {
      const { settings } = get();
      const curLang = (settings?.language || 'pt-BR') as 'pt-BR' | 'en-US';
      const tStore: any = translations[curLang]?.store || translations['pt-BR']?.store || {};
      const effFolder = folder || tStore.defaultVideoFolder || 'Extraídos';
      const effTitle = title || tStore.saveVideo || 'Vídeo';
      try {
        const result = await backendApi.saveExtractedVideoToGallery(videoUrl, title, effFolder, sourceUrl, thumbnailUrl, streamOnly);
        if (result.success && result.job_id) {
          const newJob: ExtractionJob = {
            id: result.job_id,
            url: videoUrl,
            title: `${tStore.saveVideo || 'Salvar Vídeo'}: ${effTitle}`,
            status: 'active',
            mode: 'video_save' as any,
            progressPercent: 1,
            discoveredImagesCount: 1,
            resolvedOriginalCount: 0,
            failedCount: 0,
            currentStage: streamOnly ? (tStore.savingStreamStage || '') : (tStore.savingLocalStage || ''),
            startTime: new Date().toISOString(),
            durationSeconds: 0,
            throughputMbps: 0,
            fps: 60,
            aiModel: streamOnly ? 'Web Stream Registry (0 MB)' : 'Direct Stream Downloader',
            folder: effFolder
          };

          // Marcação imediata no estado otimista da UI para exibir a tag Salvo em [Pasta] na hora
          get().markItemAsSavedOptimistically({
            url: videoUrl,
            title,
            folder: effFolder,
            targetId: result.job_id,
            targetView: 'videos'
          });

          set(state => ({
            jobs: [newJob, ...state.jobs.filter(j => j.id !== result.job_id)],
            activeJob: newJob,
            activeJobs: [newJob, ...state.activeJobs.filter(j => j.id !== result.job_id)],
            sessionJobIds: Array.from(new Set([...state.sessionJobIds, result.job_id!])),
            dismissedDockJobIds: state.dismissedDockJobIds.filter(id => id !== result.job_id!)
          }));
          get().addNotification({
            title: streamOnly ? (tStore.videoStreamSavedTitle || '') : (tStore.videoLocalDownloadTitle || ''),
            message: (tStore.videoSavingProgressMsg || '"{title}" ({folder})')
              .replace('{title}', effTitle)
              .replace('{folder}', effFolder),
            type: 'info'
          });
          triggerJobsPollingLoop();
          if (streamOnly) {
            setTimeout(() => get().syncVideos(), 2500);
          }
          return true;
        } else if (result.success) {
          get().markItemAsSavedOptimistically({
            url: videoUrl,
            title,
            folder: effFolder,
            targetId: result.video?.id,
            targetView: 'videos'
          });
          soundEffects.success(settings.soundEnabled);
          await get().syncVideos();
          get().addNotification({
            title: tStore.videoSavedTitle || '',
            message: (tStore.videoSavedMsg || '"{title}" -> "{folder}"')
              .replace('{title}', effTitle)
              .replace('{folder}', effFolder),
            type: 'success'
          });
          return true;
        } else {
          get().addNotification({
            title: tStore.videoSaveStartErrorTitle || '',
            message: result.error || (tStore.videoSaveStartErrorMsg || ''),
            type: 'error'
          });
          return false;
        }
      } catch (err) {
        console.error('saveExtractedVideoToGallery failed:', err);
        return false;
      }
    },

    markItemAsSavedOptimistically: (params: { url?: string; title?: string; folder: string; targetId?: string; targetView?: 'videos' | 'gallery' }) => {
      const { url, title, folder, targetId, targetView = 'videos' } = params;
      const targetFolder = folder || (targetView === 'videos' ? 'Extraídos' : 'Geral');
      const now = Date.now();
      const newEntries: Record<string, { folder: string; targetId: string; targetView: 'videos' | 'gallery'; timestamp: number }> = {};
      const entry = { folder: targetFolder, targetId: targetId || '', targetView, timestamp: now };

      if (url) {
        newEntries[url] = entry;
        newEntries[url.split('?')[0].toLowerCase()] = entry;
      }
      if (title) {
        const fp = getCanonicalMediaFingerprint(title, url);
        newEntries[fp] = entry;
        newEntries[title.toLowerCase().trim()] = entry;
      }

      set(state => ({
        optimisticSavedItems: {
          ...state.optimisticSavedItems,
          ...newEntries
        }
      }));
    },

    setHighlightedItemId: (id: string | null) => set({ highlightedItemId: id }),

    navigateToSavedItem: (targetView: 'videos' | 'gallery', folder: string, itemId: string) => {
      set({
        highlightedItemId: itemId,
        activeAlbumFolder: targetView === 'gallery' ? (folder || null) : null,
        activeVideoFolder: targetView === 'videos' ? (folder || null) : null,
      });

      if (targetView === 'videos') {
        set({ videoSearchQuery: '', videoFilterFavoritesOnly: false });
        get().navigateToView('videos');
      } else {
        set({ gallerySearchQuery: '', galleryTagFilter: null, galleryColorFilter: null });
        get().navigateToView('gallery');
      }

      // Automatically clear highlight after 5 seconds
      setTimeout(() => {
        if (get().highlightedItemId === itemId) {
          set({ highlightedItemId: null });
        }
      }, 5000);
    },

    checkItemSavedStatus: (params: {
      url?: string;
      title?: string;
      height?: number;
      width?: number;
      candidateId?: string;
      mediaType?: 'photo' | 'video' | 'album' | string;
    }) => {
      const { videos, albums, optimisticSavedItems } = get();
      const { url, title, height } = params;

      // 0. Verificação Otimista Imediata (exibe a tag "Salvo em [Pasta]" sem esperar o download)
      if (url && optimisticSavedItems[url]) {
        const opt = optimisticSavedItems[url];
        return {
          isSaved: true,
          isExactDuplicate: true,
          hasAlternativeResolution: false,
          savedFolder: opt.folder,
          folder: opt.folder,
          targetId: opt.targetId,
          targetView: opt.targetView
        };
      }
      if (url && optimisticSavedItems[url.split('?')[0].toLowerCase()]) {
        const opt = optimisticSavedItems[url.split('?')[0].toLowerCase()];
        return {
          isSaved: true,
          isExactDuplicate: true,
          hasAlternativeResolution: false,
          savedFolder: opt.folder,
          folder: opt.folder,
          targetId: opt.targetId,
          targetView: opt.targetView
        };
      }
      const targetFingerprint = getCanonicalMediaFingerprint(title, url, height);
      if (optimisticSavedItems[targetFingerprint]) {
        const opt = optimisticSavedItems[targetFingerprint];
        return {
          isSaved: true,
          isExactDuplicate: true,
          hasAlternativeResolution: false,
          savedFolder: opt.folder,
          folder: opt.folder,
          targetId: opt.targetId,
          targetView: opt.targetView
        };
      }

      const cleanTitle = (title || '').toLowerCase().trim();
      const normTitle = cleanTitle.replace(/[_\-\.\s]+/g, ' ');

      const extractKey = (u?: string) => {
        if (!u) return '';
        const mPh = u.match(/viewkey=([a-zA-Z0-9]+)/i);
        if (mPh) return mPh[1];
        const mEp = u.match(/video-([a-zA-Z0-9]{6,})/i);
        if (mEp) return mEp[1];
        const mPvv = u.match(/\/videos\/(-?\d+\/\d+\/[a-zA-Z0-9_]+)/i);
        if (mPvv) return mPvv[1];
        return u.split('?')[0].toLowerCase();
      };

      const targetKey = extractKey(url);

      // 1. Verificar em Vídeos Salvos na Galeria
      for (const v of videos) {
        const vKey = extractKey(v.sourceUrl || v.url);
        const vFingerprint = getCanonicalMediaFingerprint(v.title, v.sourceUrl || v.url, v.height);
        const sameFingerprint = Boolean(targetFingerprint && vFingerprint && targetFingerprint === vFingerprint);
        const vTitleNorm = (v.title || '').toLowerCase().replace(/[_\-\.\s]+/g, ' ');
        const sameSource = Boolean(targetKey && vKey && targetKey === vKey);
        const sameTitle = Boolean(normTitle && vTitleNorm && (normTitle === vTitleNorm || normTitle.includes(vTitleNorm) || vTitleNorm.includes(normTitle)));

        if (sameFingerprint || sameSource || (sameTitle && normTitle.length > 8)) {
          const vH = (v as any).height || ((v as any).resolution && parseInt(String((v as any).resolution).split('x')[1] || String((v as any).resolution))) || 0;
          const targetH = height || 0;

          if (targetH > 0 && vH > 0 && Math.abs(targetH - vH) > 50) {
            const qual = vH >= 1080 ? '1080p HD' : (vH >= 720 ? '720p HD' : `${vH}p`);
            return {
              isSaved: true,
              isExactDuplicate: false,
              hasAlternativeResolution: true,
              savedFolder: v.folder || 'Extraídos',
              folder: v.folder || 'Extraídos',
              targetId: v.id,
              targetView: 'videos' as const,
              qualityLabel: qual,
            };
          } else {
            return {
              isSaved: true,
              isExactDuplicate: true,
              hasAlternativeResolution: false,
              savedFolder: v.folder || 'Extraídos',
              folder: v.folder || 'Extraídos',
              targetId: v.id,
              targetView: 'videos' as const,
            };
          }
        }
      }

      // 2. Verificar em Álbuns Salvos na Galeria
      for (const a of albums) {
        const aKey = extractKey(a.sourceUrl);
        const aFingerprint = getCanonicalMediaFingerprint(a.title, a.sourceUrl);
        const sameFingerprint = Boolean(targetFingerprint && aFingerprint && targetFingerprint === aFingerprint);
        const aTitleNorm = (a.title || '').toLowerCase().replace(/[_\-\.\s]+/g, ' ');
        const sameSource = Boolean(targetKey && aKey && targetKey === aKey);
        const sameTitle = Boolean(normTitle && aTitleNorm && normTitle === aTitleNorm);

        if (sameFingerprint || sameSource || (sameTitle && normTitle.length > 8)) {
          return {
            isSaved: true,
            isExactDuplicate: true,
            hasAlternativeResolution: false,
            savedFolder: a.folder || 'Geral',
            folder: a.folder || 'Geral',
            targetId: a.id,
            targetView: 'gallery' as const,
          };
        }
      }

      return {
        isSaved: false,
        isExactDuplicate: false,
        hasAlternativeResolution: false,
        savedFolder: '',
        folder: '',
        targetId: '',
        targetView: 'videos' as const,
      };
    },
  };
});
