// Isolated update-notification behavior; no real backend or library data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../frontend-mobile-preview/node_modules/typescript');
const root = path.resolve(__dirname, '../frontend-mobile-preview/src');

function loadTs(file) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', js)(module, module.exports, require);
  return module.exports;
}

function action(state, backendApi, alerts, sounds, translations) {
  const file = path.join(root, 'store/useAppStore.ts');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let fn;
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'checkForUpdates') fn = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(fn);
  const js = ts.transpileModule(`module.exports = (${fn.getText(source)});`, {}).outputText;
  const module = { exports: {} };
  new Function('module', 'backendApi', 'get', 'set', 'claimUpdateNotification', 'vibrateForUpdate', 'soundEffects', 'translations', js)(
    module, backendApi, () => state, patch => Object.assign(state, patch),
    alerts.claimUpdateNotification, alerts.vibrateForUpdate, sounds, translations,
  );
  return module.exports;
}

test('new versions notify once, link settings and respect sound and ignored versions', async () => {
  const values = new Map();
  global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const alerts = loadTs(path.join(root, 'services/updateAlerts.ts'));
  const { translations } = loadTs(path.join(root, 'i18n/translations.ts'));
  const notices = [], sounds = [];
  let version = 'v10.1.0';
  const state = { settings: { language: 'pt-BR', soundEnabled: false }, dismissedUpdateVersion: null,
    addNotification: value => notices.push(value) };
  const run = action(state, { checkForUpdates: async () => ({ update_available: true, latest_version: version }) },
    alerts, { success: enabled => sounds.push(enabled) }, translations);
  await run(true, false);
  await run(true, false);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].linkViewId, 'settings');
  assert.match(notices[0].message, /v10\.1\.0/);
  assert.deepEqual(sounds, [false]);
  assert.equal(alerts.updateNeedsAttention(state.updateInfo, null), true);
  assert.equal(alerts.updateNeedsAttention(state.updateInfo, version), false);
  version = 'v10.2.0'; state.dismissedUpdateVersion = version;
  await run(true, false);
  assert.equal(notices.length, 1);
  state.dismissedUpdateVersion = null; state.settings.language = 'en-US';
  await run(true, false);
  assert.equal(notices.length, 2);
  assert.match(notices[1].message, /Settings/);
  delete global.localStorage;
});

test('Android haptics are attempted only where supported', () => {
  const alerts = loadTs(path.join(root, 'services/updateAlerts.ts'));
  const calls = [];
  Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'Android', vibrate: value => calls.push(value) } });
  alerts.vibrateForUpdate();
  Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'Desktop', vibrate: value => calls.push(value) } });
  alerts.vibrateForUpdate();
  assert.equal(calls.length, 1);
  delete global.navigator;
});

test('notification survives reload and remains usable without storage', () => {
  const values = new Map();
  global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let alerts = loadTs(path.join(root, 'services/updateAlerts.ts'));
  assert.equal(alerts.claimUpdateNotification('v12.0.0', null), true);
  alerts = loadTs(path.join(root, 'services/updateAlerts.ts'));
  assert.equal(alerts.claimUpdateNotification('v12.0.0', null), false);
  global.localStorage = { getItem: () => { throw new Error('unavailable'); } };
  assert.equal(alerts.claimUpdateNotification('v12.1.0', null), true);
  assert.equal(alerts.claimUpdateNotification('v12.1.0', null), false);
  delete global.localStorage;
});
