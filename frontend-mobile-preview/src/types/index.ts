export type ThemeMode = 'dark-slate' | 'deep-oled' | 'clean-light' | 'cyber-studio';
export type AccentColor = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'cyan';
export type Language = 'pt-BR' | 'en-US';

export type ViewId =
  | 'home'
  | 'extractor'
  | 'web-video-scraper'
  | 'multi-album'
  | 'batch-queue'
  | 'live-monitor'
  | 'gallery'
  | 'videos'
  | 'shorts'
  | 'trash'
  | 'duplicates'
  | 'album-detail'
  | 'domain-patterns'
  | 'job-history'
  | 'realtime-logs'
  | 'performance-metrics'
  | 'settings';

export type GalleryViewMode =
  | 'grid-xl'
  | 'grid-lg'
  | 'grid-md'
  | 'grid-sm'
  | 'details'
  | 'list'
  | 'masonry'
  | 'coverflow-3d'
  | 'magazine';

export type ExtractionMode =
  | 'classic'
  | 'ai_react'
  | 'gemini_surgical_scout'
  | 'gemini_layout_explorer'
  | 'lightning_probe'
  | 'ultra_original'
  | 'ultra_lossless'
  | 'stealth'
  | 'stealth_mode'
  | 'deep_archive'
  | 'video_save';

export type AiEngineType =
  | 'gemini_layout_explorer'
  | 'gemini_surgical_scout'
  | 'ai_react'
  | 'classic';

export interface ImageItem {
  id: string;
  thumbnailUrl: string;
  originalUrl: string;
  previewUrl: string;
  title: string;
  rawOriginalUrl?: string;
  rawThumbnailUrl?: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  aspectRatio: string;
  megapixels: number;
  format: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif';
  isResolvedOriginal: boolean;
  status: 'resolved' | 'unresolved' | 'failed';
  aestheticScore: number; // 0 to 10
  sharpnessScore: number; // 0 to 100%
  colorPalette: string[]; // hex strings e.g. ['#1e293b', '#3b82f6', ...]
  tags: string[];
  inImageText?: string;
  gps?: {
    latitude: number;
    longitude: number;
    locationName: string;
  };
  rating?: number; // 1-5 stars
  colorFlag?: 'red' | 'yellow' | 'green' | 'blue' | null;
  aiPrompt?: {
    prompt: string;
    negativePrompt?: string;
    seed?: number;
    model?: string;
    sampler?: string;
    steps?: number;
  };
  // Media type fields (for video/GIF extraction)
  mediaType?: 'image' | 'video' | 'gif';
  isAnimated?: boolean;
  videoUrl?: string;
  posterUrl?: string;
  durationSeconds?: number;
  candidateId?: string; // Video candidate id for individual stream refresh
  isFavorite?: boolean;
}

export type MediaExtractFilter = 'all' | 'images' | 'videos' | 'gifs';

export interface Album {
  id: string;
  title: string;
  description?: string;
  sourceUrl: string;
  sourceDomain: string;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
  totalImages?: number;
  resolvedOriginalCount: number;
  totalSizeBytes: number;
  coverImage: string;
  rawCoverImage?: string;
  coverColorPalette?: string[];
  images: ImageItem[];
  tags: string[];
  extractionMode: ExtractionMode;
  aiModel: string;
  durationSeconds: number;
  isFavorite?: boolean;
  mediaType?: 'photo' | 'video' | 'gif';
  hasGifs?: boolean;
  gifCount?: number;
  sourceOrigin?: 'local' | 'remote';
  sourcePage?: string;
  folder?: string;
  syncStats?: {
    total_images?: number;
    updated_dimensions?: number;
    updated_sizes?: number;
    repaired_links?: number;
    palettes_generated?: number;
    failed_count?: number;
    failed_details?: string[];
  };
  syncMessage?: string;
}

export interface ExtractionJob {
  id: string;
  url: string;
  title: string;
  status: 'queued' | 'active' | 'completed' | 'paused' | 'failed' | 'cancelled';
  progressPercent: number;
  discoveredImagesCount: number;
  resolvedOriginalCount: number;
  failedCount: number;
  currentStage: string;
  startTime: string;
  endTime?: string;
  durationSeconds: number;
  throughputMbps: number;
  fps: number;
  mode: ExtractionMode;
  aiModel: string;
  resultAlbumId?: string;
  error?: string;
  priority?: 'high' | 'medium' | 'low';
  downloadedBytes?: number;
  totalBytes?: number;
  folder?: string;
  videoId?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'ai' | 'network' | 'dom' | 'warning' | 'error';
  category: string;
  message: string;
  metadata?: Record<string, any>;
}

export interface SetOfMarkCandidate {
  id: number;
  selector?: string;
  label: string;
  type: 'album_item' | 'banner_noise' | 'unresolved' | 'button';
  confidence: number;
  box: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  resolvedOriginalUrl?: string;
  thumbnailUrl: string;
}

export interface DomainPattern {
  id: string;
  domain: string;
  name: string;
  regexTarget: string;
  replacementPattern: string;
  confidenceScore: number;
  testSamples: {
    thumb: string;
    resolved: string;
    status: 'valid' | 'invalid';
  }[];
  isCustom?: boolean;
  primaryContainers?: string[];
  positiveSignatures?: string[];
  negativeFilters?: string[];
  preferredResolutionMethods?: string[];
  sampleEvidence?: string[];
  demonstrationCount?: number;
  updatedAt?: string;
}

export interface ChatMediaItem {
  type: 'image' | 'video' | 'album';
  id?: string;
  title?: string;
  thumbnail_url?: string;
  original_url?: string;
  preview_url?: string;
  stream_url?: string;
  folder?: string;
  item_count?: number;
  album_id?: string;
  duration?: number;
}

export interface ChatExecutedTool {
  name: string;
  args: Record<string, any>;
  result: Record<string, any>;
  summary: string;
}

export interface ChatClientAction {
  type: 'navigate' | 'filter' | 'preview';
  view?: string;
  target_id?: string;
  filter_type?: string;
  value?: string;
  media_type?: string;
  url?: string;
  title?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  reasoning?: string;
  actionExecuted?: {
    type: 'select_images' | 'open_upscale' | 'navigate' | 'filter_color' | 'general_answer';
    label: string;
  };
  provider?: 'gemini' | 'ollama';
  model?: string;
  errorType?: string;
  canFallback?: boolean;
  mediaItems?: ChatMediaItem[];
  executedTools?: ChatExecutedTool[];
  thoughtChain?: string[];
  clientAction?: ChatClientAction;
}


export interface OllamaHealthStatus {
  isAvailable: boolean;
  version?: string;
  endpoint: string;
  installedModels: string[];
  latencyMs?: number | null;
  lastChecked?: number;
  error?: string | null;
}

export interface OllamaModelInfo {
  name: string;
  label: string;
  size_gb: number;
  size_bytes?: number;
  modified_at?: string;
  details?: Record<string, any>;
}

export interface SessionTab {
  id: string;
  title: string;
  viewId: ViewId;
  albumId?: string;
  iconName?: string;
  isClosable?: boolean;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'success' | 'warning' | 'info' | 'error';
  isRead: boolean;
  linkViewId?: ViewId;
  linkAlbumId?: string;
}

export interface KeybindingMap {
  [action: string]: string; // e.g. "openCommandPalette": "ctrl+k", "toggleFullscreen": "f"
}

export type LightboxOpenAnimation = 'expand' | 'elastic' | 'zoom' | 'switch' | 'fade' | 'none';
export type ImageSwitchAnimation = 'switch' | 'fade' | 'slide' | 'zoom' | 'elastic' | 'none';
export type SlideshowAnimation = 'switch' | 'fade' | 'slide' | 'zoom' | 'none';
export type FullscreenAnimation = 'elastic' | 'smooth' | 'instant' | 'none';
export type AnimationSpeed = 'ultra-fast' | 'fast' | 'normal' | 'slow';
export type AnimationDistance = 'subtle' | 'normal' | 'large';
export type ViewTransitionAnimation = 'fade' | 'slide' | 'zoom' | 'none';
export type ModalAnimation = 'scale' | 'slide-up' | 'fade' | 'none';
export type DrawerAnimation = 'slide' | 'fade' | 'none';
export type TaskDockAnimation = 'slide-up' | 'bounce' | 'fade' | 'none';
export type VideoPlayerAnimation = 'zoom' | 'fade' | 'slide-up' | 'none';

export interface AppSettings {
  aiModel: string;
  reasoningBudget: number; // 1 to 5
  temperature: number;
  maxConcurrency: number;
  requestTimeoutSeconds: number;
  antiBotDelayMs: number;
  userAgentRotation: boolean;
  minWidth: number;
  minHeight: number;
  discardDuplicates: boolean;
  theme: ThemeMode;
  accent: AccentColor;
  language: Language;
  soundEnabled: boolean;
  ambientSoundVolume: number;
  ambientSoundType: 'none' | 'lofi' | 'rain' | 'whitenoise';
  defaultFilenamePattern: string;
  autoSaveToGallery: boolean;
  zipCompressionLevel: number;
  removeExifOnExport: boolean;
  discordWebhookUrl?: string;
  defaultAiEngine?: AiEngineType;
  geminiModel?: string;
  geminiApiKey?: string;
  askFolderOnSave?: boolean;
  defaultVideoFolder?: string;
  defaultAlbumFolder?: string;
  redirectTagBehavior?: 'navigate' | 'quick_menu';
  aiChatProvider?: 'gemini' | 'ollama';
  ollamaBaseUrl?: string;
  selectedOllamaModel?: string;
  geminiChatModel?: string;
  // Configurações Avançadas de Animação e Movimento (Senior Full-Stack UI/UX)
  lightboxOpenAnimation?: LightboxOpenAnimation;
  imageSwitchAnimation?: ImageSwitchAnimation;
  slideshowAnimation?: SlideshowAnimation;
  fullscreenAnimation?: FullscreenAnimation;
  animationSpeed?: AnimationSpeed;
  animationDistance?: AnimationDistance;
  disableAllAnimations?: boolean;
  viewTransitionAnimation?: ViewTransitionAnimation;
  modalAnimation?: ModalAnimation;
  drawerAnimation?: DrawerAnimation;
  taskDockAnimation?: TaskDockAnimation;
  videoPlayerAnimation?: VideoPlayerAnimation;
  customAnimationDurationMs?: number;
}

export interface VideoHighlight {
  id?: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  rank?: 'gold' | 'silver' | 'bronze' | number | string;
  label: string;
  reason?: string;
}

export interface VideoItem {
  id: string;
  title: string;
  filename: string;
  folder: string;
  fileSizeBytes: number;
  format: string;
  isFavorite: boolean;
  createdAt: string;
  relPath: string;
  streamUrl: string;
  downloadUrl: string;
  thumbnailUrl: string;
  storageLocation?: 'huggingface' | 'local' | 'render_local' | 'stream_url';
  cloudUrl?: string;
  sourceOrigin?: 'pc' | 'web';
  url?: string;
  sourceUrl?: string;
  sourceId?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSeconds?: number;
  introEnd?: number;
  highlightStart?: number;
  highlightEnd?: number;
  highlightScore?: number;
  highlights?: VideoHighlight[];
}

export interface StorageAnalytics {
  cloud_huggingface: {
    is_connected: boolean;
    provider: string;
    repo_id: string;
    total_bytes_used: number;
    max_bytes_limit: number;
    used_percentage: number;
    files_count: number;
    app_recorded_videos: number;
    error?: string;
  };
  render_local: {
    total_bytes_used: number;
    videos_count: number;
    is_overflow_risk: boolean;
  };
  stream_only: {
    videos_count: number;
  };
  albums: {
    total_albums: number;
    total_photos: number;
    total_size_bytes: number;
  };
}

export interface AlbumFolder {
  id: string;
  name: string;
  count: number;
}

export interface VideoFolder {
  id: string;
  name: string;
  videoCount: number;
  totalSizeBytes: number;
}

export interface TrashItem {
  id: string;
  type: 'photo' | 'video' | 'album';
  title: string;
  original_location: string;
  file_size_bytes: number;
  thumbnail_url: string;
  stream_url?: string;
  deleted_at: string;
  metadata?: any;
}

export interface TrashStats {
  total_items: number;
  photos_count: number;
  videos_count: number;
  albums_count: number;
  total_size_bytes: number;
}

export interface ScannedVideoItem {
  id: string;
  title: string;
  url: string;
  thumbnail_url: string;
  duration?: string;
  quality_hint?: string;
  stream_url?: string;
  section?: 'main' | 'recommended';
  is_primary?: boolean;
  already_saved?: boolean;
  saved_folder?: string;
  saved_filename?: string;
  saved_video_id?: string;
  height?: number;
  width?: number;
  resolution?: string;
}

export interface ScanPageVideosResponse {
  success: boolean;
  page_title: string;
  suggested_folder: string;
  total_found: number;
  main_count?: number;
  recommended_count?: number;
  already_saved_count?: number;
  new_videos_count?: number;
  album_id: string;
  videos: ScannedVideoItem[];
}

export type AlbumImage = ImageItem;

export interface MultiAlbumPreviewImage {
  id: string;
  position: number;
  thumbnail_url: string;
  original_url: string;
  width: number;
  height: number;
  file_size: number;
  format: string;
  media_type: 'image' | 'video' | 'gif';
  is_animated: boolean;
  title: string;
  filename?: string;
}

export interface MultiAlbumCustomSelection {
  albumUrl?: string;
  selectedImageUrls: string[];
  totalImages: number;
  images?: MultiAlbumPreviewImage[];
  cachedImages?: MultiAlbumPreviewImage[];
  updatedAt: number;
}

export interface VideoScraperAlbum {
  id: string;
  title: string;
  url?: string;
  sourceUrl?: string;
  suggestedFolder: string;
  thumbnailUrl?: string;
  videos: ScannedVideoItem[];
  selectedVideoIds: string[];
  createdAt?: string;
  scannedAt?: number;
  sectionType?: 'page' | 'sub_album' | 'main' | 'recommended';
  sourceType?: 'main' | 'recommended' | 'sub_album' | 'page';
}

export interface WebScraperState {
  url: string;
  scanResult: ScanPageVideosResponse | null;
  selectedIds: string[];
  targetFolder: string;
  errorMsg: string | null;
  activeTab?: 'main' | 'recommended' | 'all';
  videoAlbums?: VideoScraperAlbum[];
  selectedAlbumIds?: string[];
  activeInspectingAlbumId?: string | null;
  viewLayout?: 'albums' | 'grid' | 'videos';
}

export type SliderSequenceMode = 'random' | 'alphabetical' | 'artist' | 'folder' | 'recent' | 'size' | 'orientation';
export type SliderMediaFilter = 'all' | 'photos' | 'images' | 'gifs';
export type SliderOrientationFilter = 'all' | 'vertical' | 'horizontal';

export interface GlobalSliderConfig {
  scope: 'all_app' | 'current_album';
  mediaFilter: SliderMediaFilter;
  sequenceMode: SliderSequenceMode;
  alphabeticalOrder: 'asc' | 'desc';
  sortOrder?: 'asc' | 'desc';
  selectedArtist: string;
  selectedFolder: string;
  recentDaysLimit?: number;
  onlyRecent?: boolean;
  recentDays?: number;
  sizeSortOrder?: 'asc' | 'desc';
  minResolution: 'all' | 'hd' | '4k';
  minResolutionFilter?: string;
  minSizeFilter?: 'all' | '4k' | 'hd' | 'largeBytes';
  orientationFilter: SliderOrientationFilter;
  onlyFavorites: boolean;
  speedSeconds: number;
  kenBurnsEffect: boolean;
  shuffleSeed: number;
}


