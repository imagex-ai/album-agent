import {discoverProfileRoot} from './profileHubApi';
import type {ProfileRoot} from './profileHubApi';
import {engagementSourceUrl} from './profileHubEngagement';
import {
  extractPlaylistsFromScan,
  mapScanResponseToTimelinePosts,
  mergeTimelineCreatorStats,
  resolveTimelinePlatform,
} from '../components/profile-hub/timeline/timelineModel';
import type {TimelineCreator, TimelinePost} from '../components/profile-hub/timeline/timelineModel';

export interface TimelineCreatorProfileSnapshot {creator:TimelineCreator; posts:TimelinePost[]; incomplete?:boolean;}
interface Options {
  url:string;
  existingCreator?:TimelineCreator;
  expectedName?:string;
  seedAvatar?:string | null;
  existingPosts:TimelinePost[];
  signal:AbortSignal;
  onSnapshot?:(value:TimelineCreatorProfileSnapshot)=>void;
  unnamedLabel:string;
}

/** Full creator catalog using the Hub scanner and the existing timeline media mappers.
 * Does not add a creator to the saved feed, change favorites, or navigate the app.
 */
export async function loadTimelineCreatorProfile(options:Options):Promise<TimelineCreatorProfileSnapshot> {
  const url=engagementSourceUrl(options.url);
  if (!url) throw new Error('Invalid creator URL');
  const previous=options.existingCreator;
  const publish=(root:ProfileRoot):TimelineCreatorProfileSnapshot => {
    if (options.signal.aborted) throw new DOMException('Cancelled','AbortError');
    if (!root.profile_key || !engagementSourceUrl(root.source_url)) throw new Error('Invalid creator response');
    const hero=root.profile_data;
    const creator:TimelineCreator={
      id:previous?.id || root.profile_key,
      name:hero?.name || root.name || previous?.name || options.expectedName || options.unnamedLabel,
      handle:hero?.handle || previous?.handle || '',
      avatar:hero?.avatarUrl || previous?.avatar || options.seedAvatar || '',
      site:resolveTimelinePlatform(root.source_url, hero?.site || previous?.site) || previous?.site,
      profileUrl:root.source_url,
      verified:hero?.verified ?? previous?.verified ?? false,
      stats:mergeTimelineCreatorStats(previous?.stats, hero?.stats as Record<string, unknown> | undefined, hero?.bio_details),
      bio:root.description || hero?.tagline || previous?.bio,
    };
    const playlists=extractPlaylistsFromScan(creator,root);
    creator.playlists=playlists.length ? playlists : previous?.playlists;
    const snapshot={creator,posts:mapScanResponseToTimelinePosts(creator,root,options.existingPosts),incomplete:Boolean(root.discovery_errors?.length)};
    options.onSnapshot?.(snapshot);
    return snapshot;
  };
  // Opening a creator requests their catalog; feed refresh keeps its separate recent transport.
  const root=await discoverProfileRoot(url,options.signal,partial => { publish(partial); });
  return publish(root);
}
