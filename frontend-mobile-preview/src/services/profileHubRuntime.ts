import { useProfileHubStore } from '../store/useProfileHubStore';
import { useProfileDirectoryStore } from '../store/useProfileDirectoryStore';
import { scrollRestorationManager } from './scrollRestoration';
import { createProfileHubNavigator } from './profileHubNavigation';
import { useProfileDirectoryLibraryStore } from '../store/useProfileDirectoryLibraryStore';

export const hubNavigation = createProfileHubNavigator({
  hash: () => window.location.hash,
  push: hash => window.history.pushState(null, '', hash),
  replace: hash => window.history.replaceState(null, '', hash),
  back: () => window.history.back(),
  snapshot: token => {
    const route = useProfileHubStore.getState().route;
    if (route?.mode === 'directory') {
      const session = useProfileDirectoryStore.getState().directories[route.queryKey];
      if (session) {
        const { search, sort, view, displayPage, focusedProfileKey, appendMode } = session;
        hubNavigation.amendCurrent({ ...route, viewState: { search, sort, view, displayPage, focusedProfileKey, appendMode } });
      }
    }
    const main = scrollRestorationManager.getContainer();
    if (main && !scrollRestorationManager.isRestorationLocked()) {
      scrollRestorationManager.savePosition(`profile-hub:${token}`, main.scrollTop);
    }
  },
  apply: (route, token) => {
    const store = useProfileHubStore.getState();
    if (route.mode === 'profile') {
      const session = store.profiles[route.profileKey];
      if (!session) return false;
      let panel = route.panel;
      if (panel?.type === 'playlist') {
        const previous = panel.item;
        panel = { ...panel, item: session.playlists.find(item => item.id === previous.id) ?? previous };
      } else if (panel?.type === 'album') {
        const previous = panel.item;
        panel = { ...panel, item: session.albums.find(item => item.id === previous.id) ?? previous };
      }
      store.setRoute({ ...route, panel }, token);
      if (!session.demoMode && session.sourceUrl) useProfileDirectoryLibraryStore.getState().visit({ kind: 'profile', url: session.sourceUrl, name: session.profile.name || null, imageUrl: session.profile.avatarUrl || null }, { ...route, panel });
    } else if (route.mode === 'directory') {
      const session = useProfileDirectoryStore.getState().directories[route.queryKey];
      if (!session?.pages[route.pageUrl]) return false;
      useProfileDirectoryStore.getState().updateContext(route.queryKey, { ...route.viewState, pageUrl: route.pageUrl });
      store.setRoute(route, token);
      useProfileDirectoryLibraryStore.getState().visit({ kind: 'directory', url: route.pageUrl, name: null, imageUrl: null }, route);
    } else {
      store.setRoute(route, token);
    }
    return true;
  },
});

export function restoreProfileHubLocation(hash: string) {
  if (!new URLSearchParams(hash.split('?')[1] || '').has('context')) return;
  const restored = hubNavigation.restore(hash);
  // Contexts live only in memory. A cold reload has no route to restore and
  // starts at the Hub home instead of selecting the demo profile.
  if (!restored && !hubNavigation.hasContext() && !useProfileHubStore.getState().route) {
    window.history.replaceState(null, '', '#/profile-hub');
    useProfileHubStore.getState().setNavigationUnavailable(false);
    return;
  }
  useProfileHubStore.getState().setNavigationUnavailable(!restored);
}
