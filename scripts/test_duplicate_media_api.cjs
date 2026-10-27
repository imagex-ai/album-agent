const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'frontend-mobile-preview/node_modules/typescript'));
const source = fs.readFileSync(path.join(root, 'frontend-mobile-preview/src/services/duplicateMediaApi.ts'), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const moduleBox = {exports:{}};
new Function('module','exports',code)(moduleBox,moduleBox.exports);
const {scanVideos, scanLocalAlbums, trashScannedVideo} = moduleBox.exports;

test('video scan only starts on request and returns exact groups', async t=>{
  const calls=[], progress=[];
  t.mock.method(global,'fetch',async (url,options)=>{
    calls.push([url,options.method]);
    return {ok:true,json:async()=>calls.length===1?{scanId:'job'}:{status:'completed',loaded:2,total:2,skipped:1,groups:[{id:'hash',videoIds:['a','b']}]}};
  });
  const result=await scanVideos(value=>progress.push(value),new AbortController().signal);
  assert.deepEqual(result,{scanId:'job',skipped:1,groups:[{id:'hash',videoIds:['a','b']}]});
  assert.deepEqual(progress,[{loaded:2,total:2}]);
  assert.equal(calls[0][1],'POST');
});

test('cancellation after starting tells server to stop',async t=>{
  const controller=new AbortController(), calls=[];
  t.mock.method(global,'fetch',async (url,options)=>{
    calls.push(options.method);
    if (calls.length===1) {controller.abort();return {ok:true,json:async()=>({scanId:'job'})};}
    return {ok:true};
  });
  await assert.rejects(scanVideos(()=>{},controller.signal),{name:'AbortError'});
  assert.deepEqual(calls,['POST','DELETE']);
});

test('guarded trash failure cannot be reported as success',async t=>{
  t.mock.method(global,'fetch',async()=>({ok:false,status:409}));
  assert.equal(await trashScannedVideo('job','id'),false);
});

test('local album comparison reports scan progress and confirmed groups',async t=>{
  let count=0;const progress=[];
  t.mock.method(global,'fetch',async()=>({ok:true,json:async()=>++count===1?{scanId:'album-job'}:{status:'completed',loaded:2,total:2,skipped:1,groups:[{id:'match',albumIds:['a','b']}]}}));
  const result=await scanLocalAlbums(value=>progress.push(value),new AbortController().signal);
  assert.deepEqual(result,{scanId:'album-job',groups:[{id:'match',albumIds:['a','b']}],skipped:1});
  assert.deepEqual(progress,[{loaded:2,total:2}]);
});

test('similar-video scan selects the separate mode',async t=>{
  const urls=[];
  t.mock.method(global,'fetch',async url=>{urls.push(url);return {ok:true,json:async()=>urls.length===1?{scanId:'job'}:{status:'completed',groups:[],loaded:0,total:0}};});
  await scanVideos(()=>{},new AbortController().signal,'similar');
  assert.ok(urls[0].includes('mode=similar'));
});
