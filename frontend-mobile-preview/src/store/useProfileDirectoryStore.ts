import { create } from 'zustand';
import type { DirectoryPage, DirectoryProfile } from '../services/profileDirectoryApi';

export interface DirectorySession {
  sourceUrl: string;
  pages: Record<string, DirectoryPage>;
  profiles: Record<string, DirectoryProfile>;
  pageUrl: string;
  search: string;
  sort: string;
  view: 'grid' | 'list';
  displayPage: number;
  focusedProfileKey: string | null;
  appendMode: boolean;
}
export type DirectoryViewState = Pick<DirectorySession, 'search' | 'sort' | 'view' | 'displayPage' | 'focusedProfileKey' | 'appendMode'>;
export const useProfileDirectoryStore = create<{
  directories: Record<string, DirectorySession>;
  commitPage: (page: DirectoryPage) => void;
  updateContext: (queryKey: string, patch: Partial<DirectoryViewState & Pick<DirectorySession, 'pageUrl'>>) => void;
  updateProfilesMeta: (queryKey: string, metaByUrl: Record<string, Partial<DirectoryProfile>>) => void;
}>((set) => ({
  directories: {},
  commitPage: page => set(state => {
    const previous = state.directories[page.query_key];
    const pages = { ...previous?.pages, [page.page_url]: page };
    return { directories: { ...state.directories, [page.query_key]: {
      ...(previous ?? { sourceUrl: page.source_url, search: '', sort: 'source', view: 'grid' as const, displayPage: 1, focusedProfileKey: null, appendMode: false }),
      pageUrl: page.page_url, pages,
      profiles: Object.fromEntries(Object.values(pages).flatMap(p => p.items).map(item => [item.key, item])),
    } } };
  }),
  updateContext: (key, patch) => set(state => {
    const session = state.directories[key];
    if (!session || patch.pageUrl && !session.pages[patch.pageUrl]) return state;
    return { directories: { ...state.directories, [key]: { ...session, ...patch } } };
  }),
  updateProfilesMeta: (key, metaByUrl) => set(state => {
    const session = state.directories[key];
    if (!session) return state;
    let changed = false;
    const nextProfiles = { ...session.profiles };

    for (const [rawUrl, meta] of Object.entries(metaByUrl)) {
      const cleanUrl = rawUrl.replace(/\/+$/, '').toLowerCase();
      for (const [pKey, item] of Object.entries(nextProfiles)) {
        const itemUrl = item.source_url.replace(/\/+$/, '').toLowerCase();
        if (itemUrl === cleanUrl) {
          nextProfiles[pKey] = {
            ...item,
            image_url: meta.image_url ?? item.image_url,
            description: meta.description ?? item.description,
            video_count: meta.video_count ?? item.video_count,
            photo_count: meta.photo_count ?? item.photo_count,
            gender: meta.gender ?? item.gender,
          };
          changed = true;
        }
      }
    }
    if (!changed) return state;

    const nextPages = { ...session.pages };
    for (const [pUrl, page] of Object.entries(nextPages)) {
      nextPages[pUrl] = {
        ...page,
        items: page.items.map(item => nextProfiles[item.key] ?? item),
      };
    }

    return {
      directories: {
        ...state.directories,
        [key]: {
          ...session,
          profiles: nextProfiles,
          pages: nextPages,
        },
      },
    };
  }),
}));
