import { useAppStore } from '../store/useAppStore';
import { useProfileHubStore } from '../store/useProfileHubStore';

/** Explicit user navigation only: the Hub owns validation/discovery/review.
 * No selection, execution request, URL-hash payload or persistence is created.
 */
export function openProfileInHub(sourceUrl: string): boolean {
  const value = sourceUrl.trim();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false;
  } catch {
    return false;
  }
  useProfileHubStore.getState().requestProfileOpen(value);
  useAppStore.getState().navigateToView('profile-hub');
  return true;
}
