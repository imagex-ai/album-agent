// Run with: node --test scripts/test_library_actions.cjs
// Execute production TypeScript with fixture state, without opening the real library.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'frontend-mobile-preview/node_modules/typescript'));
const frontend = path.join(root, 'frontend-mobile-preview/src');

function evaluate(source, mocks = {}) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
  }).outputText;
  const container = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in mocks, 'Unexpected dependency: ' + name);
    return mocks[name];
  }, container, container.exports);
  return container.exports;
}
const sourceIdentity = evaluate(fs.readFileSync(path.join(frontend, 'utils/duplicateSource.ts'), 'utf8'));
const mediaClassification = evaluate(fs.readFileSync(path.join(frontend, 'utils/mediaClassification.ts'), 'utf8'));
const { translations } = evaluate(fs.readFileSync(path.join(frontend, 'i18n/translations.ts'), 'utf8'));
const storePath = path.join(frontend, 'store/useAppStore.ts');
const storeSource = ts.createSourceFile(storePath, fs.readFileSync(storePath, 'utf8'), ts.ScriptTarget.Latest, true);

function storeAction(name, state, backendApi) {
  let initializer;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(storeSource) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(storeSource);
  assert.ok(initializer, 'Action not found: ' + name);
  const code = ts.transpileModule('module.exports = (' + initializer.getText(storeSource) + ');', {}).outputText;
  const container = { exports: {} };
  const deletedScrollKeys = [];
  new Function('module', 'backendApi', 'get', 'set', 'scrollRestorationManager', 'getViewScrollKey', 'translations', 'getAlbumMediaSummary', 'normalizeAlbumMediaTags', code)(
    container, backendApi, () => state, updater => Object.assign(state, typeof updater === 'function' ? updater(state) : updater),
    { deletePosition: key => deletedScrollKeys.push(key) }, (view, id) => view + ':' + id, translations,
    mediaClassification.getAlbumMediaSummary, mediaClassification.normalizeAlbumMediaTags
  );
  return { run: container.exports, deletedScrollKeys };
}

function fixtureState(language) {
  const notifications = [];
  let trashRefreshes = 0;
  const state = {
    albums: [{ id: 'album-a', images: [{ id: 'photo-a', fileSizeBytes: 50 }, { id: 'photo-b', fileSizeBytes: 75 }], imageCount: 2 }, { id: 'album-b', images: [] }],
    openTabs: [{ albumId: 'album-a' }, { albumId: 'album-b' }], selectedAlbumIds: ['album-a', 'album-b'],
    settings: { language }, addNotification: value => notifications.push(value),
    fetchTrash: async () => { trashRefreshes += 1; }
  };
  return { state, notifications, getTrashRefreshes: () => trashRefreshes };
}

for (const language of ['pt-BR', 'en-US']) {
  for (const name of ['deleteAlbum', 'removeImagesFromAlbum']) {
    for (const failure of ['false', 'rejection']) {
      test(`${name} preserves state and reports error on ${failure} (${language})`, async () => {
        const fixture = fixtureState(language);
        const original = JSON.stringify(fixture.state);
        const api = async () => { if (failure === 'rejection') throw new Error('fixture failure'); return false; };
        const { run, deletedScrollKeys } = storeAction(name, fixture.state, { deleteAlbum: api, deleteAlbumImages: api });
        assert.equal(await run('album-a', ['photo-a']), false);
        assert.equal(JSON.stringify(fixture.state), original);
        assert.deepEqual(deletedScrollKeys, []);
        assert.equal(fixture.getTrashRefreshes(), 0);
        assert.deepEqual(fixture.notifications.map(n => n.type), ['error']);
        assert.ok(fixture.notifications[0].message.length > 0);
      });
    }
    test(`${name} still updates intended state on success (${language})`, async () => {
      const fixture = fixtureState(language);
      const { run, deletedScrollKeys } = storeAction(name, fixture.state, { deleteAlbum: async () => true, deleteAlbumImages: async () => true });
      assert.equal(await run('album-a', ['photo-a']), true);
      assert.equal(fixture.getTrashRefreshes(), 1);
      assert.equal(fixture.notifications[0].type, 'warning');
      if (name === 'deleteAlbum') {
        assert.deepEqual(fixture.state.albums.map(a => a.id), ['album-b']);
        assert.deepEqual(fixture.state.selectedAlbumIds, ['album-b']);
        assert.equal(fixture.state.openTabs[0].albumId, 'album-b');
        assert.equal(deletedScrollKeys.length, 1);
      } else {
        assert.deepEqual(fixture.state.albums[0].images.map(i => i.id), ['photo-b']);
        assert.equal(fixture.state.albums[0].totalSizeBytes, 75);
        assert.equal(fixture.state.albums.length, 2);
        assert.deepEqual(deletedScrollKeys, []);
      }
    });
  }
}

function image(url, id, width = 1000) {
  return { id, title: id, originalUrl: url, rawOriginalUrl: url, width, height: width, fileSizeBytes: 5000 };
}
function album(id, images) { return { id, title: id, images }; }
function duplicates(albums, remove = async () => true) {
  const memos = [], notifications = [], buttons = [];
  const react = {
    createElement: (type, props, ...children) => {
      const node = { type, props: props || {}, children };
      if (type === 'button') buttons.push(node);
      return node;
    },
    useMemo: callback => { const value = callback(); memos.push(value); return value; },
    useState: value => [value, () => {}], useEffect: () => {}
  };
  const component = evaluate(fs.readFileSync(path.join(frontend, 'components/views/DuplicatesView.tsx'), 'utf8'), {
    react: { ...react, default: react }, 'lucide-react': {}, '../common/IconBadge': {},
    '../../utils/duplicateSource': sourceIdentity, '../../i18n/translations': { translations },
    '../../store/useAppStore': { useAppStore: () => ({ albums, settings: { language: 'en-US' }, removeImagesFromAlbum: remove, addNotification: value => notifications.push(value) }) }
  });
  component.DuplicatesView();
  const text = node => typeof node === 'string' ? node : (node?.children || []).flat(Infinity).map(text).join('');
  return { clusters: memos[0], notifications, buttons, text };
}

test('different hosts with the same path are not duplicates', () => {
  assert.equal(duplicates([album('a', [image('https://a.test/photos/001.jpg', 'a')]), album('b', [image('https://b.test/photos/001.jpg', 'b')])]).clusters.length, 0);
});
test('query parameters identifying different images are preserved', () => {
  assert.equal(duplicates([album('a', [image('https://a.test/image.php?id=1', 'a'), image('https://a.test/image.php?id=2', 'b')])]).clusters.length, 0);
});
test('protocol-relative sources preserve different hosts', () => {
  assert.notEqual(sourceIdentity.getDuplicateSourceKey('//a.test/photo.jpg'), sourceIdentity.getDuplicateSourceKey('//b.test/photo.jpg'));
});
test('the same image through a proxy still matches and the highest resolution wins', () => {
  const direct = 'https://cdn.test/photo.jpg?image=1';
  const proxy = '/api/proxy-image?url=' + encodeURIComponent(direct) + '&w=200';
  const result = duplicates([album('a', [image(direct, 'low', 500)]), album('b', [image(proxy, 'high', 2000)])]);
  assert.equal(result.clusters.length, 1);
  assert.equal(result.clusters[0].bestItem.image.id, 'high');
});
test('equal dimensions and size do not prove identical content', () => {
  assert.equal(duplicates([album('a', [image('', 'a'), image('', 'b')])]).clusters.length, 0);
});
test('same image ID in different albums remains eligible for duplicate cleanup', () => {
  const result = duplicates([album('a', [image('https://cdn.test/same.jpg', 'photo')]), album('b', [image('https://cdn.test/same.jpg', 'photo')])]);
  assert.equal(result.clusters[0].redundantItems.length, 1);
});
test('local uploads with distinct source files remain separate', () => {
  assert.notEqual(sourceIdentity.getDuplicateSourceKey('local://albums/a/photo.jpg'), sourceIdentity.getDuplicateSourceKey('local://albums/b/photo.jpg'));
});

const duplicateFixtures = [album('a', [image('https://cdn.test/same.jpg', 'a')]), album('b', [image('https://cdn.test/same.jpg', 'b')])];
test('single duplicate removal awaits success before announcing it', async () => {
  let resolveRemoval;
  const result = duplicates(duplicateFixtures, () => new Promise(resolve => { resolveRemoval = resolve; }));
  const button = result.buttons.find(button => result.text(button).includes(translations['en-US'].duplicates.discardSingle));
  assert.ok(button);
  const operation = button.props.onClick();
  assert.equal(result.notifications.length, 0);
  resolveRemoval(true);
  await operation;
  assert.equal(result.notifications[0].type, 'success');
});
for (const mode of ['single', 'batch']) {
  test(`${mode} duplicate cleanup does not announce success on failure`, async () => {
    const result = duplicates(duplicateFixtures, async () => false);
    const button = mode === 'batch' ? result.buttons[0] : result.buttons.find(button => result.text(button).includes(translations['en-US'].duplicates.discardSingle));
    await button.props.onClick();
    assert.equal(result.notifications.length, 0);
  });
}
test('batch cleanup does not announce all-clean on partial success', async () => {
  let calls = 0;
  const result = duplicates([...duplicateFixtures, album('c', [image('https://cdn.test/other.jpg', 'c')]), album('d', [image('https://cdn.test/other.jpg', 'd')])], async () => ++calls === 1);
  await result.buttons[0].props.onClick();
  assert.equal(calls, 2);
  assert.equal(result.notifications.length, 0);
});
test('batch duplicate cleanup still announces full success', async () => {
  const result = duplicates(duplicateFixtures);
  await result.buttons[0].props.onClick();
  assert.equal(result.notifications[0].type, 'success');
});
