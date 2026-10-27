// Run: node --test scripts/test_album_cleanup.cjs
// Pure classification and fixture-driven actions: no real-library mutations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend-mobile-preview/src');
const ts = require(path.join(root, 'frontend-mobile-preview/node_modules/typescript'));
function evaluate(source, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in mocks, 'Unexpected dependency ' + name);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}
const read = filename => fs.readFileSync(path.join(frontend, filename), 'utf8');
const media = evaluate(read('utils/mediaClassification.ts'));
const identity = evaluate(read('utils/duplicateSource.ts'));
const cleanup = evaluate(read('utils/albumCleanup.ts'), { './mediaClassification': media, './duplicateSource': identity });
const { translations } = evaluate(read('i18n/translations.ts'));
const { BackendApiClient } = evaluate(read('services/realApi.ts'), { './colorExtractor': { colorPaletteCache: new Map() }, '../utils/mediaClassification': media });
const picture = (source, id = 'image', extra = {}) => ({ id, title: id, rawOriginalUrl: source, originalUrl: source, rawThumbnailUrl: source, thumbnailUrl: source, width: 200, height: 200, fileSizeBytes: 17000, ...extra });
const album = (id, images) => ({ id, title: id, images });

test('SVG, ICO, logo, and loading assets are suggestions with explicit reasons', () => {
  for (const [source, reason] of [['https://cdn.test/art.svg?x=1','vector'], ['https://cdn.test/favicon.ico','icon'], ['https://cdn.test/logo-brand.png','logo'], ['https://cdn.test/site_loading.gif','interface']]) {
    const groups = cleanup.buildCleanupGroups([album('a', [picture(source)])]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].reason, reason);
  }
});
test('inline SVG is reviewable without treating other inline images as SVG', () => {
  assert.equal(cleanup.buildCleanupGroups([album('a', [picture('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')])])[0].reason, 'vector');
  assert.equal(cleanup.buildCleanupGroups([album('a', [picture('data:image/png;base64,ZmFrZQ==')])]).length, 0);
});
test('the screenshot-like hashed logo is suggested across 87 distinct albums', () => {
  const albums = Array.from({length:87}, (_, index) => album('a'+index, [picture('https://cdn.test/cpp/b/hash.png', 'logo')]));
  const groups = cleanup.buildCleanupGroups(albums);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, 'repeatedSmall');
  assert.equal(groups[0].entries.length, 87);
  assert.equal(groups[0].albumCount, 87);
});
test('dimensions alone, distinct origins and repeats in one album do not imply a logo', () => {
  assert.equal(cleanup.buildCleanupGroups(Array.from({length:5},(_,i)=>album('a'+i,[picture('https://cdn.test/image-'+i+'.png')]))).length, 0);
  assert.equal(cleanup.buildCleanupGroups([album('a',Array.from({length:5},(_,i)=>picture('https://cdn.test/hash.png','image'+i)))]).length, 0);
});
test('large photos, video posters, and query keywords are not technical-asset evidence', () => {
  const large = Array.from({length:5},(_,i)=>album('a'+i,[picture('https://cdn.test/photo.jpg','image',{width:1920,height:1080,fileSizeBytes:200000})]));
  assert.equal(cleanup.buildCleanupGroups(large).length, 0);
  assert.equal(cleanup.buildCleanupGroups([album('a',[picture('https://cdn.test/logo.mp4','video',{mediaType:'video',videoUrl:'/api/videos/a/stream'})])]).length, 0);
  assert.equal(cleanup.buildCleanupGroups([album('a',[picture('https://cdn.test/photo.jpg?referer=logo.svg&name=icon')])]).length, 0);
});
test('proxy identity and thumbnail mismatches are retained for review', () => {
  const source='https://cdn.test/logo.png';
  const image=picture(source, 'logo', {rawThumbnailUrl:'https://cdn.test/photo.jpg',thumbnailUrl:'/api/proxy-image?url=https%3A%2F%2Fcdn.test%2Fphoto.jpg'});
  const second=picture('/api/proxy-image?url='+encodeURIComponent(source),'logo');
  const groups=cleanup.buildCleanupGroups([album('a',[image]),album('b',[second])]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].entries.length,2);
  assert.equal(groups[0].thumbnailMismatchCount,1);
});
test('previously reviewed small asset stays available after partial removals', () => {
  const source='https://cdn.test/hash.png';
  const values=Array.from({length:5},(_,i)=>album('a'+i,[picture(source)]));
  const group=cleanup.buildCleanupGroups(values)[0];
  const reviewed=new Map([[group.sourceKey,group.reason]]);
  assert.equal(cleanup.buildCleanupGroups(values.slice(0,1),reviewed)[0].entries.length,1);
});

function initializer(filename,name) {
  const source=ts.createSourceFile(filename,read(filename),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if ((ts.isVariableDeclaration(node)||ts.isPropertyAssignment(node)) && node.name.getText(source)===name) expression=node.initializer;
    ts.forEachChild(node,visit);
  }
  visit(source);
  assert.ok(expression,'Missing '+name);
  return expression.getText(source);
}
function action(filename,name,context) {
  const module={exports:{}};
  const code=ts.transpileModule('module.exports = ('+initializer(filename,name)+');',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('module',...Object.keys(context),code)(module,...Object.values(context));
  return module.exports;
}
function removalFixture(remove,confirm=true) {
  const notifications=[],calls=[],selection=[];
  let currentAlbums = ['a','b'].map(id => album(id, entries.filter(entry=>entry.albumId===id).map(entry=>entry.image)));
  const context={removalLock:{current:false},scanController:{current:null},getCleanupEntryKey:cleanup.getCleanupEntryKey,
    useAppStore:{getState:()=>({albums:currentAlbums})},
    t:translations['pt-BR'].duplicates,window:{confirm:()=>confirm},setIsRemoving:()=>{},
    setRemovalProgress:()=>{},setSelectedCleanupKeys:value=>selection.push(value),addNotification:value=>notifications.push(value),
    removeImagesFromAlbum:async(id,ids)=>{calls.push([id,ids]); return remove(id,ids);}};
  return {run:action('components/views/DuplicatesView.tsx','removeEntries',context),context,notifications,calls,selection,setAlbums:value=>{currentAlbums=value;}};
}
const entries=[{albumId:'a',albumTitle:'A',image:picture('https://cdn.test/logo.svg','one')},{albumId:'a',albumTitle:'A',image:picture('https://cdn.test/icon.svg','two')},{albumId:'b',albumTitle:'B',image:picture('https://cdn.test/logo.svg','three')}];

test('selection identity rejects reassigned positions and changed stable sources',()=>{
  const original=entries[0];
  const replacement={...original,image:picture('https://cdn.test/photo.jpg','one')};
  assert.notEqual(cleanup.getCleanupEntryKey(original),cleanup.getCleanupEntryKey(replacement));
  const stable={...original,image:{...original.image,backendImageRef:{candidate_id:'candidate',index:0}}};
  const shifted={...stable,image:{...stable.image,id:'shifted',backendImageRef:{candidate_id:'candidate',index:2}}};
  assert.equal(cleanup.getCleanupEntryKey(stable),cleanup.getCleanupEntryKey(shifted));
  assert.notEqual(cleanup.getCleanupEntryKey(stable),cleanup.getCleanupEntryKey({...shifted,image:{...shifted.image,rawOriginalUrl:'https://cdn.test/changed.svg'}}));
});

test('stale removal cannot delete the new occupant of the same position',async()=>{
  const fixture=removalFixture(async()=>true);
  fixture.setAlbums([album('a',[picture('https://cdn.test/photo.jpg','one')])]);
  await fixture.run([entries[0]]);
  assert.deepEqual(fixture.calls,[]);
  assert.equal(fixture.notifications[0].type,'error');
});

test('hidden groups and other panels cannot contribute actionable selections',()=>{
  const context={activePanel:'cleanup',displayedCleanupGroups:[{entries:[entries[0]]}],selectedCleanupKeys:entries.map(cleanup.getCleanupEntryKey),getCleanupEntryKey:cleanup.getCleanupEntryKey};
  assert.deepEqual(action('components/views/DuplicatesView.tsx','selectedEntries',context),[entries[0]]);
  context.activePanel='duplicates';
  assert.deepEqual(action('components/views/DuplicatesView.tsx','selectedEntries',context),[]);
});

test('scan merge hydrates unchanged copies while preserving edits and deletions',()=>{
  const initial=[album('same',[]),album('edited',[]),album('deleted',[])];
  const starting=new Map(initial.map(value=>[value.id,cleanup.getCleanupAlbumFingerprint(value)]));
  const edited={...initial[1],title:'Renamed',isFavorite:true};
  const added=album('new',[]);
  const loaded=initial.map(value=>({...value,images:[picture('https://cdn.test/logo.svg')]}));
  const merged=cleanup.mergeCleanupScanAlbums(starting,[{...initial[0]},edited,added],loaded);
  assert.deepEqual(merged.map(value=>value.id),['same','edited','new']);
  assert.equal(merged[0].images.length,1);
  assert.equal(merged[1],edited);
  assert.equal(merged[2],added);
});
test('cancelled cleanup performs no deletion',async()=>{
  const fixture=removalFixture(async()=>true,false);
  await fixture.run(entries);
  assert.deepEqual(fixture.calls,[]);
  assert.deepEqual(fixture.notifications,[]);
});
test('confirmed cleanup groups all occurrences by album and reports success',async()=>{
  const fixture=removalFixture(async()=>true);
  await fixture.run([...entries,entries[0]]);
  assert.deepEqual(fixture.calls,[['a',['one','two']],['b',['three']]]);
  assert.equal(fixture.notifications[0].type,'success');
  assert.ok(fixture.notifications[0].message.includes('3'));
  assert.equal(fixture.context.removalLock.current,false);
  assert.deepEqual(fixture.selection,[[]]);
});
test('partial failure continues and never claims full success',async()=>{
  const fixture=removalFixture(async id=>id==='b');
  await fixture.run(entries);
  assert.equal(fixture.calls.length,2);
  assert.equal(fixture.notifications[0].type,'warning');
  assert.ok(fixture.notifications[0].message.includes('1'));
  assert.ok(fixture.notifications[0].message.includes('2'));
});
test('pending deletion and scanning suppress duplicate removal submits',async()=>{
  let resolve;
  const fixture=removalFixture(()=>new Promise(done=>{resolve=done;}));
  const pending=fixture.run([entries[0]]);
  await fixture.run([entries[0]]);
  assert.equal(fixture.calls.length,1);
  resolve(true);await pending;
  fixture.context.scanController.current={};
  await fixture.run([entries[0]]);
  assert.equal(fixture.calls.length,1);
});

function scanFixture(fetchAlbums) {
  let state={albums:[album('a',[])]};
  const events={failed:false,complete:false,cancelled:false};
  const context={removalLock:{current:false},mediaRemovalLock:{current:false},localAlbumController:{current:null},videoController:{current:null},scanController:{current:null},
    getCleanupAlbumFingerprint:cleanup.getCleanupAlbumFingerprint,mergeCleanupScanAlbums:cleanup.mergeCleanupScanAlbums,
    useAppStore:{getState:()=>state,setState:update=>{state={...state,...update};}},
    backendApi:{fetchCleanupAlbums:fetchAlbums},setIsScanning:()=>{},setScanFailed:v=>{events.failed=v;},
    setScanCancelled:v=>{events.cancelled=v;},setScanComplete:v=>{events.complete=v;},
    setSelectedCleanupKeys:()=>{},setScanProgress:()=>{}};
  return {run:action('components/views/DuplicatesView.tsx','scanAllAlbums',context),
    cancel:action('components/views/DuplicatesView.tsx','cancelScan',context),context,events,getState:()=>state};
}
test('scan failure preserves the existing library',async()=>{
  const fixture=scanFixture(async()=>{throw new Error('network');});
  await fixture.run();
  assert.equal(fixture.getState().albums[0].id,'a');
  assert.equal(fixture.events.failed,true);
});
test('cancelled or unmounted scan cannot apply late results',async()=>{
  let resolve;
  const fixture=scanFixture(()=>new Promise(done=>{resolve=done;}));
  const pending=fixture.run();
  fixture.cancel();resolve([album('changed',[])]);await pending;
  assert.equal(fixture.getState().albums[0].id,'a');
  assert.equal(fixture.events.complete,false);
});
test('scan preserves concurrently completed new extraction albums',async()=>{
  let resolve;
  const fixture=scanFixture(()=>new Promise(done=>{resolve=done;}));
  const pending=fixture.run();
  fixture.context.useAppStore.setState({albums:[album('a',[]),album('new',[])]});
  resolve([album('a',[picture('https://cdn.test/logo.svg')])]);await pending;
  assert.deepEqual(fixture.getState().albums.map(a=>a.id),['a','new']);
  assert.equal(fixture.events.complete,true);
});
test('full metadata scan pages without the startup ten-image cap',async t=>{
  const calls=[],progress=[];
  t.mock.method(global,'fetch',async url=>{
    calls.push(url);
    const page=calls.length===1?Array.from({length:12},(_,i)=>({album_id:'a'+i,images:[]})):[{album_id:'last',images:[]}];
    return {ok:true,status:200,json:async()=>page,headers:new Headers({'X-Library-Paging':'cursor','X-Total-Count':'13'})};
  });
  const albums=await new BackendApiClient().fetchCleanupAlbums(value=>progress.push(value));
  assert.equal(albums.length,13);
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>!url.includes('limit_images_per_album')));
  assert.ok(calls[1].includes('after=a11'));
  assert.deepEqual(progress.at(-1),{loaded:13,total:13});
});
test('aborted full metadata scan makes no request',async t=>{
  let calls=0;
  t.mock.method(global,'fetch',async()=>{calls+=1;});
  const controller=new AbortController();controller.abort();
  await assert.rejects(new BackendApiClient().fetchCleanupAlbums(undefined,controller.signal),{name:'AbortError'});
  assert.equal(calls,0);
});
test('API sends exact identity and adopts canonical image IDs after each deletion',async t=>{
  const raw={session_id:'a',album_id:'a',source_page:'Upload Local',images:[
    {original_url:'local://albums/a/logo.svg',thumbnail_url:'local://albums/a/logo.svg'},
    {original_url:'local://albums/a/photo.jpg',thumbnail_url:'local://albums/a/photo.jpg'},
    {original_url:'local://albums/a/icon.svg',thumbnail_url:'local://albums/a/icon.svg'}]};
  const api=new BackendApiClient();
  let state={albums:[api.mapBackendAlbumToFrontend(raw)],settings:{language:'pt-BR'},addNotification:()=>{},fetchTrash:async()=>{}};
  const payloads=[];
  t.mock.method(global,'fetch',async(url,options)=>{
    const payload=JSON.parse(options.body);payloads.push(payload);
    raw.images.splice(payload.image_refs[0].index,1);
    return {ok:true,json:async()=>({album:raw,deleted_count:1})};
  });
  const context={get:()=>state,set:update=>{state={...state,...update(state)};},backendApi:api,translations};
  const remove=action('store/useAppStore.ts','removeImagesFromAlbum',context);
  assert.equal(await remove('a',['real-img-a-0']),true);
  assert.deepEqual(state.albums[0].images.map(image=>image.id),['real-img-a-0','real-img-a-1']);
  assert.equal(await remove('a',['real-img-a-1']),true);
  assert.equal(payloads[1].image_refs[0].index,1);
  assert.equal(payloads[1].image_refs[0].original_url,'local://albums/a/icon.svg');
  assert.equal(state.albums[0].images[0].rawOriginalUrl,'local://albums/a/photo.jpg');
});
