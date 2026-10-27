const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'frontend-mobile-preview/node_modules/typescript'));
function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(root, 'frontend-mobile-preview/src/utils', file), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',compiled)(name => mocks[name],module,module.exports);
  return module.exports;
}
const identity = load('duplicateSource.ts');
const {buildDuplicateAlbumGroups} = load('duplicateAlbums.ts', {'./duplicateSource':identity});
const {buildVideoSourceGroups} = load('duplicateVideoSources.ts', {'./duplicateSource':identity});
const album = (id, urls, extra = {}) => ({id, sourceUrl:'', imageCount:urls.length, images:urls.map(originalUrl=>({originalUrl})), ...extra});

test('same source is a suggestion, not content confirmation',()=>{
  const result=buildDuplicateAlbumGroups([album('a',['https://cdn/a'],{sourceUrl:'https://site/page'}),album('b',['https://cdn/b'],{sourceUrl:'https://site/page'})]);
  assert.equal(result.length,1);assert.equal(result[0].reason,'sameSource');
});
test('complete matching URL lists work regardless of order and count repeated items',()=>{
  const result=buildDuplicateAlbumGroups([album('a',['https://cdn/a','https://cdn/b']),album('b',['https://cdn/b','https://cdn/a']),album('c',['https://cdn/a','https://cdn/a'])]);
  assert.deepEqual(result.map(group=>group.albums.map(item=>item.id)),[['a','b']]);
  assert.equal(result[0].reason,'sameItems');
});
test('partial, empty and missing URL albums do not appear as matching contents',()=>{
  const values=[album('a',['https://cdn/a'],{imageCount:5}),album('b',['https://cdn/a'],{imageCount:5}),album('c',[]),album('d',[]),album('e',['']),album('f',[''])];
  assert.deepEqual(buildDuplicateAlbumGroups(values),[]);
});
test('local upload marker and a domain alone are not valid shared source pages',()=>{
  assert.deepEqual(buildDuplicateAlbumGroups([album('a',['https://cdn/a'],{sourceUrl:'Upload Local'}),album('b',['https://cdn/b'],{sourceUrl:'Upload Local'})]),[]);
});
test('albums with substantial but not identical overlap are review suggestions',()=>{
  const common=['https://cdn/a','https://cdn/b','https://cdn/c','https://cdn/d'];
  const result=buildDuplicateAlbumGroups([album('a',[...common,'https://cdn/e']),album('b',[...common,'https://cdn/f'])]);
  assert.equal(result.length,1);assert.equal(result[0].reason,'similarItems');
});
test('few common images or incomplete metadata do not establish similarity',()=>{
  const common=['https://cdn/a','https://cdn/b','https://cdn/c'];
  assert.deepEqual(buildDuplicateAlbumGroups([album('a',[...common,'https://cdn/1','https://cdn/2']),album('b',[...common,'https://cdn/3','https://cdn/4'])]),[]);
  assert.deepEqual(buildDuplicateAlbumGroups([album('a',common,{imageCount:10}),album('b',common,{imageCount:10})]),[]);
});
test('widely repeated shared assets are not similarity evidence',()=>{
  const common=['https://cdn/logo','https://cdn/icon','https://cdn/spinner'];
  const values=Array.from({length:11},(_,i)=>album('album'+i,[...common,`https://cdn/unique${i}`]));
  assert.deepEqual(buildDuplicateAlbumGroups(values),[]);
});
test('remote video addresses are grouped only as source suggestions',()=>{
  const videos=[{id:'a',sourceUrl:'https://site.test/watch?id=1'},{id:'b',sourceUrl:'https://site.test/watch?id=1'},{id:'c',sourceUrl:'https://site.test/watch?id=2'}];
  assert.deepEqual(buildVideoSourceGroups(videos).map(group=>[group.reason,group.videoIds]),[['sameSource',['a','b']]]);
});
