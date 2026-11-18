export type ProfileCategoryTab = 'destaques' | 'playlists' | 'albuns' | 'videos';

export interface ProfileStat {
  label: string;
  count: number;
}

export interface ProfileHeroData {
  id: string;
  name: string;
  handle?: string;
  tagline: string;
  avatarUrl: string;
  coverUrl: string;
  site?: string;
  verified: boolean;
  following: boolean;
  stats: {
    videos: number | null;
    playlists: number | null;
    albums: number | null;
    posts?: number | null;
    gifs?: number | null;
    likes?: string | number | null;
    subscribers?: string | number | null;
    followers?: string | number | null;
    views?: string | number | null;
  };
  destinationFolder: string;
  availableFolders: string[];
  bio_details?: Record<string, string>;
  social_links?: Record<string, string>;
}

export interface HighlightItem {
  id: string;
  title: string;
  subtitle?: string;
  tag?: string;
  countLabel?: string;
  thumbnailUrl: string;
  type: 'video' | 'playlist' | 'album' | 'gif';
  duration?: string;
  isHero?: boolean;
}

export interface PlaylistItem {
  id: string;
  title: string;
  videoCount: number | null;
  updatedAt: string;
  thumbnailUrl: string;
  description?: string;
  loadedCount?: number;
  url?: string;
  author?: string;
  authorUrl?: string;
  views?: string;
  lastAddedDate?: string;
  metadataStatus?: 'fetched' | 'error';
  updatedAtRaw?: string;
  reportedCount?: number | null;
  paginationComplete?: boolean;
}

export interface AlbumItem {
  id: string;
  title: string;
  photoCount: number | null;
  updatedAt: string;
  thumbnailUrl: string;
  category?: string;
  author?: string;
  authorUrl?: string;
  views?: string;
  metadataStatus?: 'fetched' | 'error';
  updatedAtRaw?: string;
  loadedCount?: number;
  paginationComplete?: boolean;
  isComplete?: boolean;
  url?: string;
  batchPage?: number;
}

export interface MediaItemCard {
  id: string;
  title: string;
  subtitle?: string;
  thumbnailUrl: string;
  duration?: string;
  resolution?: string;
  metadataStatus?: 'fetched' | 'error';
  uploadedAt?: string;
  timeAgo: string;
  type: 'video' | 'photo' | 'gif';
  collectionId?: string;
  collectionTitle?: string;
  streamUrl?: string;
  originalUrl?: string;
  pageUrl?: string;
  sourcePage?: string;
  isResolvedOriginal?: boolean;
  format?: string;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  views?: string;
  uploader?: string;
  isFavorite?: boolean;
  artistSlug?: string;
  artistName?: string;
}

export type ActiveSidePanel = 
  | { type: 'playlist'; item: PlaylistItem }
  | { type: 'album'; item: AlbumItem }
  | { type: 'gif-collection'; item: AlbumItem }
  | { type: 'all-playlists' }
  | { type: 'all-albums' }
  | { type: 'review-selection' }
  | null;
