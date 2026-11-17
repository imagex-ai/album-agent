import { buildTimelineStreamUrl, isTimelineDataPayload, sortTimelinePostsByPublication } from '../components/profile-hub/timeline/timelineModel';
import type { TimelineDataPayload, TimelineSourceIdentityHint } from '../components/profile-hub/timeline/timelineModel';

// Separate, versioned read cache. Never writes the personal media library or
// interaction storage. IndexedDB avoids the much smaller localStorage quota.
const DATABASE = 'imagex_timeline_catalog';
const DATABASE_VERSION = 1;
const STORE = 'snapshots';
const CATALOG_KEY = 'catalog';
const FORMAT_VERSION = 1;

export interface TimelineCatalogSnapshot extends TimelineDataPayload {
  version: 1;
  savedAt: string;
  identityHints: TimelineSourceIdentityHint[];
  creatorRefreshedAt: Record<string, number>;
}

export function catalogSnapshot(data: TimelineDataPayload, identityHints: TimelineSourceIdentityHint[], creatorRefreshedAt: Record<string, number>): TimelineCatalogSnapshot {
  return {
    version: FORMAT_VERSION, savedAt: new Date().toISOString(),
    creators: data.creators.map(creator => ({...creator, playlists: creator.playlists?.map(({videos, ...playlist}) => playlist)})),
    identityHints: identityHints.map(hint => ({...hint})),
    creatorRefreshedAt: {...creatorRefreshedAt},
    posts: data.posts.map(({videoUrl, masterHlsUrl, qualities, previewVideoUrl, playlistVideos, comments, ...post}) => ({
      ...post, comments: [],
      photos: post.type === 'gif' && post.streamResolverUrl ? [post.streamResolverUrl] : post.photos,
      photoItems: post.type === 'gif' && post.streamResolverUrl
        ? post.photoItems?.map(item => ({...item,url:post.streamResolverUrl!})) : post.photoItems,
      // Renew from the stable source page on open; signed runtime streams must
      // never become the bootstrap transport after their expiry.
      videoUrl: post.type === 'gif' && post.streamResolverUrl
        ? buildTimelineStreamUrl(post.streamResolverUrl,post.originalUrl)
        : post.type === 'video' && post.originalUrl
          ? buildTimelineStreamUrl(post.originalUrl, post.originalUrl, undefined, post.youtubeId) : undefined,
    })),
  };
}

export function isTimelineCatalogSnapshot(value: unknown): value is TimelineCatalogSnapshot {
  if (!isTimelineDataPayload(value)) return false;
  const candidate = value as Partial<TimelineCatalogSnapshot>;
  return candidate.version === FORMAT_VERSION && typeof candidate.savedAt === 'string'
    && Number.isFinite(Date.parse(candidate.savedAt)) && Array.isArray(candidate.identityHints)
    && candidate.identityHints.every(hint => hint && typeof hint.id === 'string' && typeof hint.creatorId === 'string'
      && typeof hint.type === 'string' && [hint.originalUrl,hint.albumUrl].every(url => url === undefined || typeof url === 'string'))
    && candidate.posts!.every(post => typeof post.date === 'string' && Array.isArray(post.comments)
      && (post.dateObservedAt === undefined || typeof post.dateObservedAt === 'string')
      && (post.publicationDatePrecision === undefined || post.publicationDatePrecision === 'day'))
    && candidate.creators!.every(creator => typeof creator.verified === 'boolean' && creator.stats !== null
      && typeof creator.stats === 'object' && !Array.isArray(creator.stats))
    && !!candidate.creatorRefreshedAt && typeof candidate.creatorRefreshedAt === 'object'
    && !Array.isArray(candidate.creatorRefreshedAt)
    && Object.values(candidate.creatorRefreshedAt).every(stamp => typeof stamp === 'number' && Number.isFinite(stamp));
}

/** Merge under the IndexedDB write transaction, retaining concurrent reads.
 * This cache has no deletion action; absent items in a partial read are retained.
 * Creator entries are metadata only: the persisted favorites collection owns
 * Saved Creators membership, including removals, independently of this union.
 */
export function mergeCatalogSnapshots(previous: TimelineCatalogSnapshot, incoming: TimelineCatalogSnapshot): TimelineCatalogSnapshot {
  const [newer,older] = Date.parse(incoming.savedAt) >= Date.parse(previous.savedAt) ? [incoming,previous] : [previous,incoming];
  const posts = new Map(newer.posts.map(post => [post.id,post]));
  for (const post of older.posts) {
    const current = posts.get(post.id);
    const observed = Date.parse(post.dateObservedAt || '');
    const existingObserved = Date.parse(current?.dateObservedAt || '');
    if (!current || (Number.isFinite(observed) && (!Number.isFinite(existingObserved) || observed > existingObserved))) posts.set(post.id,post);
  }
  const creators = new Map(older.creators.map(creator => [creator.id,creator]));
  for (const creator of newer.creators) creators.set(creator.id,creator);
  const hints = new Map(older.identityHints.map(hint => [hint.id,hint]));
  for (const hint of newer.identityHints) hints.set(hint.id,hint);
  const checked = {...older.creatorRefreshedAt};
  for (const [id,stamp] of Object.entries(newer.creatorRefreshedAt)) checked[id] = Math.max(stamp,checked[id] || 0);
  return {...newer,creators:[...creators.values()],posts:sortTimelinePostsByPublication([...posts.values()]),identityHints:[...hints.values()],creatorRefreshedAt:checked};
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    let done = false;
    const finish = (database: IDBDatabase | null) => {
      if (done) { database?.close(); return; }
      done = true; resolve(database);
    };
    try {
      const request = indexedDB.open(DATABASE,DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}

export async function readTimelineCatalog(): Promise<TimelineCatalogSnapshot | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise(resolve => {
      const transaction = database.transaction(STORE,'readonly');
      const request = transaction.objectStore(STORE).get(CATALOG_KEY);
      transaction.oncomplete = () => resolve(isTimelineCatalogSnapshot(request.result) ? request.result : null);
      transaction.onerror = transaction.onabort = () => resolve(null);
    });
  } catch { return null; }
  finally { database.close(); }
}

async function write(snapshot: TimelineCatalogSnapshot): Promise<boolean> {
  if (!isTimelineCatalogSnapshot(snapshot)) return false;
  const database = await openDatabase();
  if (!database) return false;
  try {
    return await new Promise(resolve => {
      const transaction = database.transaction(STORE,'readwrite');
      const store = transaction.objectStore(STORE);
      const existing = store.get(CATALOG_KEY);
      existing.onsuccess = () => {
        // Read and merge while holding the database's write lock, including
        // writes from another tab; never commit an old whole-cache snapshot.
        store.put(isTimelineCatalogSnapshot(existing.result) ? mergeCatalogSnapshots(existing.result,snapshot) : snapshot,CATALOG_KEY);
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = transaction.onabort = () => resolve(false);
    });
  } catch { return false; }
  finally { database.close(); }
}

let writes: Promise<boolean> = Promise.resolve(true);
export function writeTimelineCatalog(snapshot: TimelineCatalogSnapshot): Promise<boolean> {
  // Preserve completion order inside this app session, so an older async write
  // cannot overwrite the state captured by a later source response.
  const next = writes.then(() => write(snapshot), () => write(snapshot));
  writes = next;
  return next;
}
