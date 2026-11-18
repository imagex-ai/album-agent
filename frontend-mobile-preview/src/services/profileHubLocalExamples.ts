import type { ProfileHubSession } from '../store/useProfileHubStore';

export async function saveLocalExample(id: string, session: ProfileHubSession): Promise<ProfileHubSession> {
  // Explicit example data stays outside scanners, media execution and the library.
  const { profile, highlights, playlists, albums, videos, gifs, playlistVideosMap, albumPhotosMap } = session;
  const response = await fetch('/api/profile-hub/local-profiles', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, snapshot: { profile, highlights, playlists, albums, videos, gifs, playlistVideosMap, albumPhotosMap } }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const saved = await response.json();
  if (saved.id !== id || !saved.snapshot?.profile || !Array.isArray(saved.snapshot.videos)
    || !Array.isArray(saved.snapshot.albums) || !Array.isArray(saved.snapshot.playlists)) throw new Error('Invalid local profile');
  return { ...session, ...saved.snapshot, sourceUrl: id, demoMode: true,
    selectedVideos: {}, selectedAlbums: {}, selectedAlbumPhotos: {}, selectedPlaylists: {}, activeSidePanel: null };
}
