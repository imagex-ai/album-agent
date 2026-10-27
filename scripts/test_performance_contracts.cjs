// Run: node --test scripts/test_performance_contracts.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'frontend-mobile-preview/src');
const ts = require(path.join(root, 'frontend-mobile-preview/node_modules/typescript'));
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(src, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in mocks, 'Unexpected dependency: ' + name); return mocks[name]; }, module, module.exports);
  return module.exports;
}
const media = load('utils/mediaClassification.ts');
const { BackendApiClient } = load('services/realApi.ts', { './colorExtractor': { colorPaletteCache: new Map() }, '../utils/mediaClassification': media });
const { createSavedMediaLookup } = load('services/savedMediaLookup.ts');
const storeSource = fs.readFileSync(path.join(src, 'store/useAppStore.ts'), 'utf8');
const ast = ts.createSourceFile('store.ts', storeSource, ts.ScriptTarget.Latest, true);
let fpSource;
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'getCanonicalMediaFingerprint') fpSource = node.initializer.getText(ast); ts.forEachChild(node, visit); }
visit(ast);
const fpModule = { exports: {} };
new Function('module', ts.transpileModule('module.exports = ' + fpSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(fpModule);
const fingerprint = fpModule.exports;
const video = (id, extra = {}) => ({ id, title: 'An existing media title', sourceUrl: 'https://fixture.test/watch/' + id, folder: 'Original', height: 1080, ...extra });
const album = (id, extra = {}) => ({ id, title: 'An existing album title', sourceUrl: 'https://fixture.test/album/' + id, folder: 'Albums', images: [], ...extra });

test('empty stored titles never mark an unrelated result as saved', () => {
  const lookup = createSavedMediaLookup([video('empty', { title: '' }), video('missing', { title: undefined }), video('nullable', { title: null, sourceUrl: null })], [], fingerprint);
  assert.equal(lookup({ title: 'A completely new media title', url: 'https://new.test/unique' }).isSaved, false);
});
test('an earlier fuzzy match retains priority over a later exact URL', () => {
  const lookup = createSavedMediaLookup([video('earlier', { title: 'Complete concert' }), video('later', { title: 'Different description' })], [], fingerprint);
  const result = lookup({ title: 'Complete concert performance', url: 'https://fixture.test/watch/later' });
  assert.equal(result.targetId, 'earlier');
});
test('source aliases and alternate resolution keep saved folder and target', () => {
  const lookup = createSavedMediaLookup([video('source', { sourceUrl: 'https://fixture.test/watch?viewkey=abcdef', height: 720 })], [], fingerprint);
  const result = lookup({ url: 'https://other.test/watch?viewkey=abcdef&token=changed', title: 'New description', height: 1080 });
  assert.equal(result.targetId, 'source');
  assert.equal(result.folder, 'Original');
  assert.equal(result.isExactDuplicate, false);
  assert.equal(result.qualityLabel, '720p HD');
});
test('album fallback and short title rules are preserved', () => {
  const lookup = createSavedMediaLookup([], [album('one'), album('two', { title: 'Short' })], fingerprint);
  assert.equal(lookup({ title: 'An existing album title', url: 'https://new.test/unrelated' }).targetId, 'one');
  assert.equal(lookup({ title: 'Short', url: 'https://new.test/unrelated' }).isSaved, false);
});
test('query cache does not mix resolution or retain a deleted item in a new snapshot', () => {
  const videos = [video('one')];
  const lookup = createSavedMediaLookup(videos, [], fingerprint);
  assert.equal(lookup({ url: videos[0].sourceUrl, height: 1080 }).isExactDuplicate, true);
  assert.equal(lookup({ url: videos[0].sourceUrl, height: 720 }).hasAlternativeResolution, true);
  assert.equal(createSavedMediaLookup([], [], fingerprint)({ url: videos[0].sourceUrl }).isSaved, false);
});
test('large result sets normalize the saved library once, not for each result', () => {
  let calls = 0;
  const counted = (...args) => { calls++; return fingerprint(...args); };
  const lookup = createSavedMediaLookup(Array.from({ length: 1000 }, (_, i) => video(String(i))), [], counted);
  for (let i = 0; i < 1000; i++) lookup({ title: 'New unmatched record ' + i, url: 'https://new.test/item/' + i });
  assert.equal(calls, 2000);
});
test('summary cache follows media arrays and keeps animated-video transport separate', () => {
  const images = [{ originalUrl: 'https://fixture.test/photo.jpg', format: 'jpeg', mediaType: 'image', animationChecked: true }];
  const original = media.getAlbumMediaSummary({ images });
  assert.equal(media.getAlbumMediaSummary({ images, isFavorite: true }), original);
  const changed = [...images, { originalUrl: 'https://fixture.test/loop.mp4', mediaType: 'video', isAnimated: true, videoUrl: '/api/proxy-video-stream?url=x' }];
  assert.equal(media.getAlbumMediaSummary({ images: changed }).gifCount, 1);
  assert.equal(media.getAlbumMediaSummary({ images: changed }).videoCount, 0);
  assert.equal(media.hasAlbumVideoTransport({ images: changed }), true);
});

function response(data, headers = {}, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => data, headers: { get: key => headers[key] || null } }; }
test('concurrent album loads share pages and return the complete collection', async () => {
  const previous = global.fetch;
  const records = Array.from({ length: 51 }, (_, i) => ({ session_id: 'a' + i, title: 'Album ' + i, images: [] }));
  const requests = [];
  global.fetch = async url => {
    requests.push(url);
    const params = new URL(url, 'https://fixture.test').searchParams;
    const start = params.has('after') ? records.findIndex(a => a.session_id === params.get('after')) + 1 : 0;
    return response(records.slice(start, start + 24), { 'X-Library-Paging': 'cursor' });
  };
  try {
    const client = new BackendApiClient();
    const [a, b] = await Promise.all([client.fetchRealAlbums(), client.fetchRealAlbums()]);
    assert.equal(a, b);
    assert.equal(a.length, 51);
    assert.equal(new Set(a.map(x => x.id)).size, 51);
    assert.equal(requests.length, 3);
  } finally { global.fetch = previous; }
});
test('a failed album page rejects rather than publishing a partial or empty library', async () => {
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => ++calls === 1 ? response(Array.from({ length: 24 }, (_, i) => ({ session_id: String(i), images: [] })), { 'X-Library-Paging': 'cursor' }) : response(null, {}, 503);
  try { await assert.rejects(new BackendApiClient().fetchRealAlbums(), /503/); } finally { global.fetch = previous; }
});
test('legacy full-list servers and conditional job polling remain compatible', async () => {
  const previous = global.fetch;
  const jobs = [{ session_id: 'one', status: 'completed' }];
  let calls = 0;
  global.fetch = async (url, options) => {
    if (url.startsWith('/api/albums')) return response([{ session_id: 'legacy', images: [] }]);
    calls++;
    if (calls === 2) { assert.equal(options.headers['If-None-Match'], '"fixture"'); return response(null, {}, 304); }
    return response(jobs, { ETag: '"fixture"' });
  };
  try {
    const client = new BackendApiClient();
    assert.equal((await client.fetchRealAlbums())[0].id, 'legacy');
    assert.equal(await client.fetchAllJobs(), await client.fetchAllJobs());
  } finally { global.fetch = previous; }
});

const React = require(path.join(root, 'frontend-mobile-preview/node_modules/react'));
const virtual = load('components/common/VirtualCollection.tsx', { react: React, '../../services/scrollRestoration': { scrollRestorationManager: {} } });
test('variable row geometry covers deep positions and keeps full scroll extent', () => {
  const offsets = virtual.rowOffsets(Array.from({ length: 10000 }, (_, i) => 200 + i % 5 * 20), 20);
  const { start, end } = virtual.visibleRowRange(offsets, 1000000, 900);
  assert.ok(offsets[start] <= 1000000);
  assert.ok(offsets[end] >= 1000900);
  assert.ok(end - start < 20);
  assert.equal(offsets.at(-1), 2600000);
});
test('virtual range is valid for empty, single-row and clamped-end collections', () => {
  for (const count of [0, 1, 2, 1000]) {
    const offsets = virtual.rowOffsets(Array(count).fill(300), 20);
    const range = virtual.visibleRowRange(offsets, 1e9, 900);
    assert.ok(range.start >= 0 && range.end <= count);
    assert.ok(count === 0 || range.end > range.start);
  }
});

const esbuild = require(path.join(root, 'frontend-mobile-preview/node_modules/esbuild'));
const Module = require('node:module');
function isolatedStore() {
  const contents = storeSource.replace(/export const triggerJobsPollingLoop = \(\) => \{[\s\S]*?\n\};\n\nexport const getCanonicalMediaFingerprint/, 'export const triggerJobsPollingLoop = () => { globalThis.__performancePollingStarts = (globalThis.__performancePollingStarts || 0) + 1; };\n\nexport const getCanonicalMediaFingerprint');
  const bundled = esbuild.buildSync({ stdin: { contents, resolveDir: path.join(src, 'store'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const module = new Module('isolated-performance-store');
  module._compile(bundled.outputFiles[0].text + '\nmodule.exports.api = backendApi;', path.join(src, 'store/isolated-test.cjs'));
  return { store: module.exports.useAppStore, api: module.exports.api };
}
test('unchanged job polling preserves state identities and does not publish', async () => {
  const { store, api } = isolatedStore();
  api.fetchAllJobs = async () => [{ session_id: 'one', url: 'https://fixture.test/one', status: 'completed', mode: 'video_save', started_at: '2026-01-01' }];
  await store.getState().syncJobs();
  const previous = store.getState();
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  await store.getState().syncJobs();
  assert.equal(store.getState(), previous);
  assert.equal(updates, 0);
  unsubscribe();
});
test('a completion joining an old library scan queues a fresh snapshot', async () => {
  const { store, api } = isolatedStore();
  let resolveFirst, calls = 0;
  api.fetchRealAlbums = () => ++calls === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve([album('new'), album('old')]);
  store.setState({ syncAlbumFolders: async () => {} });
  const first = store.getState().syncAlbums();
  const completion = store.getState().syncAlbums();
  resolveFirst([album('old')]);
  await Promise.all([first, completion]);
  assert.equal(calls, 2);
  assert.deepEqual(store.getState().albums.map(a => a.id), ['new', 'old']);
});
test('initial album failure still initializes jobs and polling without clearing the library', async () => {
  const { store, api } = isolatedStore();
  api.checkBackendHealth = async () => true;
  api.fetchRealAlbums = async () => { throw new Error('fixture page failure'); };
  api.fetchAvailableModels = api.fetchDomainPatterns = async () => [];
  api.fetchAllJobs = async () => [{ session_id: 'job', url: 'https://fixture.test/job', status: 'completed', started_at: '2026-01-01' }];
  store.setState({ albums: [album('keep')], syncVideos: async () => {}, syncAlbumFolders: async () => {}, fetchTrash: async () => {} });
  const before = global.__performancePollingStarts || 0;
  const warning = console.warn;
  console.warn = () => {};
  try { await store.getState().syncBackendData(); } finally { console.warn = warning; }
  assert.equal(store.getState().albums[0].id, 'keep');
  assert.equal(store.getState().jobs[0].id, 'job');
  assert.ok(global.__performancePollingStarts > before);
});

test('deleting during a scan never resurrects the removed album', async () => {
  const { store, api } = isolatedStore();
  const removed = album('removed'), keep = album('keep');
  store.setState({ albums: [removed, keep], syncAlbumFolders: async () => {}, fetchTrash: async () => {} });
  let resolveFirst, calls = 0;
  api.fetchRealAlbums = () => ++calls === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve([keep]);
  api.deleteAlbum = async () => true;
  const scan = store.getState().syncAlbums(false);
  await store.getState().deleteAlbum('removed');
  let resurrected = false;
  const unsubscribe = store.subscribe(state => { resurrected ||= state.albums.some(a => a.id === 'removed'); });
  resolveFirst([removed, keep]);
  await scan;
  unsubscribe();
  assert.equal(resurrected, false);
  assert.equal(calls, 2);
  assert.deepEqual(store.getState().albums.map(a => a.id), ['keep']);
});
