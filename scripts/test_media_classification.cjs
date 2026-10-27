// Run: node --test scripts/test_media_classification.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend-mobile-preview/src');
const ts = require(path.join(root, 'frontend-mobile-preview/node_modules/typescript'));
function evaluate(source, mocks = {}) {
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  const container = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name);
    return mocks[name];
  }, container, container.exports);
  return container.exports;
}
const media = evaluate(fs.readFileSync(path.join(frontend, 'utils/mediaClassification.ts'), 'utf8'));
const { BackendApiClient } = evaluate(fs.readFileSync(path.join(frontend, 'services/realApi.ts'), 'utf8'), {
  './colorExtractor': {colorPaletteCache: new Map()}, '../utils/mediaClassification': media
});
function map(images, extra = {}) {
  return new BackendApiClient().mapBackendAlbumToFrontend({session_id:'fixture', source_page:'https://example.test/gallery', images, ...extra});
}
function item(fields = {}) {
  return {original_url:'https://cdn.test/photo.webp', thumbnail_url:'https://cdn.test/photo.webp', format:'webp', media_type:'image', is_animated:false, ...fields};
}
for (const source of ['https://cdn.test/photo.webp', 'https://cdn.test/animals/photo.webp?token=abc']) {
  test('static WebP remains a photo: ' + source, () => {
    const value = map([item({original_url:source, file_size:1500000})]);
    assert.equal(media.getMediaCategory(value.images[0]), 'photo');
    assert.equal(value.hasGifs, false);
    assert.equal(media.matchesAlbumMediaFilter(value, 'photo'), true);
    assert.equal(media.matchesAlbumMediaFilter(value, 'gif'), false);
  });
}
for (const format of ['gif','webp','png','avif']) {
  test('verified animation keeps real ' + format + ' format', () => {
    const value = map([item({original_url:'https://cdn.test/clip.'+format, format, media_type:'gif', is_animated:true, animation_checked:true})]);
    assert.equal(media.getMediaCategory(value.images[0]), 'gif');
    assert.equal(media.getMediaExtension(value.images[0]), format);
    assert.equal(value.gifCount, 1);
  });
}
test('verified single-frame GIF is not labeled animated', () => {
  const value = map([item({original_url:'https://cdn.test/still.gif', format:'gif', media_type:'gif', animation_checked:true})]);
  assert.equal(media.getMediaCategory(value.images[0]), 'photo');
  assert.equal(value.hasGifs, false);
});
test('legacy GIF URL with query is recognized without format metadata', () => {
  const value = map([item({original_url:'https://cdn.test/clip.gif?token=abc', format:null})]);
  assert.equal(media.getMediaCategory(value.images[0]), 'gif');
});
test('legacy MP4-as-GIF uses video playback and GIF filter', () => {
  const value = map([item({original_url:'https://cdn.test/loop.mp4?token=abc', format:'gif', media_type:'gif', is_animated:true})]);
  const loop = value.images[0];
  assert.equal(loop.format, 'mp4');
  assert.equal(loop.mediaType, 'video');
  assert.equal(media.isVideoMedia(loop), true);
  assert.ok(loop.videoUrl.startsWith('/api/proxy-video-stream'));
  assert.ok(!loop.originalUrl.startsWith('/api/proxy-image'));
  assert.equal(media.getMediaCategory(loop), 'gif');
  assert.equal(media.getMediaExtension(loop), 'mp4');
  const summary = media.getAlbumMediaSummary(value);
  assert.equal(summary.gifCount, 1);
  assert.equal(summary.videoCount, 0);
});
test('mixed album categories sum exactly once per item', () => {
  const value = map([
    item(), item({original_url:'https://cdn.test/a.gif',format:'gif',is_animated:true}),
    item({original_url:'https://cdn.test/loop.mp4',format:'mp4',media_type:'video',is_animated:true}),
    item({original_url:'https://cdn.test/full.mp4',format:'mp4',media_type:'video'})
  ]);
  const summary = media.getAlbumMediaSummary(value);
  assert.deepEqual([summary.photoCount,summary.gifCount,summary.videoCount], [1,2,1]);
  assert.equal(summary.photoCount+summary.gifCount+summary.videoCount, value.images.length);
});
test('stale flags/tags do not put a photo album into GIF results', () => {
  const value = map([item()], {has_gifs:true,gif_count:10,tags:['gif','animado','travel'],metadata:{has_gifs:true,gif_count:10}});
  assert.equal(value.hasGifs, false);
  assert.equal(value.gifCount, 0);
  assert.ok(!value.tags.includes('gif') && value.tags.includes('travel'));
  assert.equal(media.matchesAlbumMediaFilter(value, 'gif'), false);
});
test('empty albums clear old animation metadata', () => {
  const value = map([], {has_gifs:true,gif_count:1,tags:['gif']});
  assert.equal(value.hasGifs, false);
  assert.equal(value.gifCount, 0);
  assert.equal(media.matchesAlbumMediaFilter(value, 'gif'), false);
});
test('loaded items override stale false GIF counters', () => {
  const value = map([item({original_url:'https://cdn.test/a.webp',media_type:'gif',is_animated:true,animation_checked:true})], {has_gifs:false,gif_count:0});
  assert.equal(value.hasGifs, true);
  assert.equal(value.gifCount, 1);
});
test('verified image bytes override misleading video suffix', () => {
  const value = map([item({original_url:'https://cdn.test/image.mp4',format:'webp',animation_checked:true})]);
  assert.equal(media.isVideoMedia(value.images[0]), false);
  assert.equal(media.getMediaCategory(value.images[0]), 'photo');
  assert.equal(media.getMediaExtension(value.images[0]), 'webp');
});
for (const source of ['/api/videos/abc/stream', '/api/trash/videos/abc/stream', '/api/proxy-video-stream?url=https%3A%2F%2Fcdn.test%2Fendpoint']) {
  test('legacy app stream transport remains playable: '+source, () => {
    assert.equal(media.isVideoMedia({originalUrl:source}), true);
    assert.equal(media.getMediaExtension({originalUrl:source,format:'jpeg'}), 'mp4');
  });
}
test('an unrelated image path containing stream does not become a video', () => {
  assert.equal(media.isVideoMedia({originalUrl:'https://cdn.test/stream/photo.webp',format:'webp'}), false);
});

const extractorFile = path.join(frontend, 'components/views/ExtractorView.tsx');
const extractor = ts.createSourceFile(extractorFile, fs.readFileSync(extractorFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let initializer;
  function walk(node) {
    if(ts.isVariableDeclaration(node) && node.name.getText(extractor) === name) initializer=node.initializer;
    ts.forEachChild(node,walk);
  }
  walk(extractor);
  assert.ok(initializer, name+' not found');
  return initializer.getText(extractor);
}
function modeFor(selected, urls) {
  const code = ts.transpileModule('module.exports = '+declaration('getEffectiveMediaType'), {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const keywordModule = {exports:{}};
  const keywordCode = ts.transpileModule('module.exports = '+declaration('isVideoKeyword'), {}).outputText;
  new Function('module',keywordCode)(keywordModule);
  const module={exports:{}};
  new Function('module','mediaTypeFilter','isVideoKeyword',code)(module, selected, keywordModule.exports);
  return module.exports(urls);
}
for (const selected of ['gifs','images','videos']) {
  test('explicit '+selected+' is preserved for video-looking URL and mixed batch', () => {
    assert.equal(modeFor(selected,['https://example.test/watch/123']),selected);
    assert.equal(modeFor(selected,['https://example.test/watch/123','https://example.test/gallery/1']),selected);
  });
}
test('all mode infers videos only for an entirely video batch', () => {
  assert.equal(modeFor('all',['https://example.test/watch/123']),'videos');
  assert.equal(modeFor('all',['https://example.test/watch/123','https://example.test/gallery/1']),'all');
});
test('typing a video URL leaves explicit GIF selection intact', () => {
  const module={exports:{}};
  let setFilterCalls=0;
  const code=ts.transpileModule('module.exports = '+declaration('handleSetSingleUrl'),{}).outputText;
  new Function('module','setSingleUrl','setMediaTypeFilter',code)(module,()=>{},()=>{setFilterCalls+=1;});
  module.exports('https://example.test/watch/123');
  assert.equal(setFilterCalls,0);
});test('photo album with preview GIFs is classified as photo and matches photo filter, not gif filter', () => {
  const images = [
    ...Array(382).fill(null).map((_, i) => ({ originalUrl: `https://cdn.test/photo_${i}.jpg`, format: 'jpeg' })),
    ...Array(10).fill(null).map((_, i) => ({ originalUrl: `https://cdn.test/anim_${i}.gif`, format: 'gif', isAnimated: true }))
  ];
  const album = { images };
  const summary = media.getAlbumMediaSummary(album);
  assert.equal(summary.mediaType, 'photo');
  assert.equal(summary.photoCount, 382);
  assert.equal(summary.gifCount, 10);
  assert.equal(media.matchesAlbumMediaFilter(album, 'photo'), true);
  assert.equal(media.matchesAlbumMediaFilter(album, 'gif'), false);
  const tags = media.normalizeAlbumMediaTags(['Original', 'media_gallery'], false);
  assert.equal(tags.includes('gif'), false);
  assert.equal(tags.includes('animado'), false);
});

test('pure GIF album with no photos is classified as gif and matches gif filter', () => {
  const images = Array(15).fill(null).map((_, i) => ({ originalUrl: `https://cdn.test/anim_${i}.gif`, format: 'gif', isAnimated: true }));
  const album = { images };
  const summary = media.getAlbumMediaSummary(album);
  assert.equal(summary.mediaType, 'gif');
  assert.equal(summary.photoCount, 0);
  assert.equal(summary.gifCount, 15);
  assert.equal(media.matchesAlbumMediaFilter(album, 'photo'), false);
  assert.equal(media.matchesAlbumMediaFilter(album, 'gif'), true);
  const tags = media.normalizeAlbumMediaTags(['Original'], true);
  assert.equal(tags.includes('gif'), true);
  assert.equal(tags.includes('animado'), true);
});
test('truncated photo album with lone GIF preview is classified as photo and never matches gif filter', () => {
  const truncatedAlbum = {
    imageCount: 392,
    images: [{ originalUrl: 'https://cdn.test/preview.gif', format: 'gif', isAnimated: true }]
  };
  const summary = media.getAlbumMediaSummary(truncatedAlbum);
  assert.equal(summary.mediaType, 'photo');
  assert.equal(summary.photoCount, 391);
  assert.equal(summary.gifCount, 1);
  assert.equal(media.matchesAlbumMediaFilter(truncatedAlbum, 'photo'), true);
  assert.equal(media.matchesAlbumMediaFilter(truncatedAlbum, 'gif'), false);
});

test('truncated pure GIF album retains gif classification', () => {
  const truncatedGifAlbum = {
    imageCount: 20,
    mediaType: 'gif',
    images: [{ originalUrl: 'https://cdn.test/preview.gif', format: 'gif', isAnimated: true }]
  };
  const summary = media.getAlbumMediaSummary(truncatedGifAlbum);
  assert.equal(summary.mediaType, 'gif');
  assert.equal(summary.photoCount, 0);
  assert.equal(summary.gifCount, 20);
  assert.equal(media.matchesAlbumMediaFilter(truncatedGifAlbum, 'photo'), false);
  assert.equal(media.matchesAlbumMediaFilter(truncatedGifAlbum, 'gif'), true);
});
