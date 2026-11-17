import type { HubRoute } from '../store/useProfileHubStore';

export interface HubNavigationPort {
  hash: () => string;
  push: (hash: string) => void;
  replace: (hash: string) => void;
  back: () => void;
  apply: (route: HubRoute, token: string) => boolean;
  snapshot: (token: string) => void;
}

/** One local history registry; URLs contain opaque references, not source URLs/names. */
export function createProfileHubNavigator(port: HubNavigationPort) {
  const entries = new Map<string, HubRoute>();
  const parents = new Map<string, string | null>();
  const sessionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0;
  let activeToken: string | null = null;
  const readToken = (hash: string) => {
    const [path, query = ''] = hash.split('?');
    return path === '#/profile-hub' ? new URLSearchParams(query).get('context') : null;
  };
  return {
    navigate(route: HubRoute, replace = false, takeSnapshot = true) {
      if (activeToken && takeSnapshot) port.snapshot(activeToken);
      const token = `h${sessionId}-${++sequence}`;
      if (!port.apply(route, token)) return false;
      entries.set(token, route);
      parents.set(token, replace ? (activeToken ? parents.get(activeToken) ?? null : null) : activeToken);
      activeToken = token;
      const hash = `#/profile-hub?mode=${route.mode}&context=${token}`;
      if (replace) port.replace(hash); else port.push(hash);
      return true;
    },
    restore(hash = port.hash()) {
      const token = readToken(hash);
      if (!token) return false;
      const route = entries.get(token);
      if (!route) return false; // A cold link never triggers an arbitrary network request.
      if (activeToken === token) return true;
      if (activeToken) port.snapshot(activeToken);
      if (!port.apply(route, token)) return false;
      activeToken = token;
      return true;
    },
    back() { if (activeToken) port.snapshot(activeToken); port.back(); },
    amendCurrent(route: HubRoute) { if (activeToken && entries.has(activeToken)) entries.set(activeToken, route); },
    checkpoint() { if (activeToken) port.snapshot(activeToken); },
    canGoBack: () => activeToken !== null && parents.get(activeToken) != null,
    hasContext: () => activeToken !== null,
  };
}
