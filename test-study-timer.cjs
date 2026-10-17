// Run with: node test-study-timer.cjs (no dependencies).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
let now = 0;
let wall = 1700000000000;
let acceptReset = true;
const store = new Map();
const storage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: key => store.delete(key),
};
function createApp(localStorage = storage, environment = {}) {
  const nodes = new Map();
  const listeners = {};
  const timers = new Map();
  function element(tag = '') {
    return {
      tagName: tag.toUpperCase(), textContent: '', value: '', disabled: false, children: [], dataset: {},
      firstChild: { nodeValue: '' }, validity: { valid: true }, handlers: {},
      reportValidity() { return this.validity.valid; },
      addEventListener(name, callback) { this.handlers[name] = callback; },
      click() { if (!this.disabled) this.handlers.click?.(); },
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      setAttribute(key, value) { this[key] = value; },
      querySelectorAll(tagName) { return this.children.flatMap(child => [...(child.tagName === tagName.toUpperCase() ? [child] : []), ...child.querySelectorAll(tagName)]); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
      get lastElementChild() { return this.children[this.children.length - 1]; },
    };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    const node = element();
    node.value = ({ goal: '20', unit: 'units' })[id] || '';
    nodes.set(id, node);
  }
  const context = vm.createContext({
    document: {
      documentElement: { dataset: {} },
      visibilityState: 'visible',
      createElement: element,
      createElementNS: (_namespace, tag) => element(tag),
      querySelector: () => ({ content: '' }),
      getElementById: id => nodes.get(id),
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
    window: {
      addEventListener: (name, callback) => { listeners[name] = callback; },
      matchMedia: () => ({ matches: true }),
    },
    navigator: environment.navigator || {}, location: { protocol: 'file:' },
    localStorage,
    performance: { now: () => now },
    Date: class extends Date { static now() { return wall; } },
    setInterval: (callback, delay) => timers.set(delay, callback), confirm: () => acceptReset,
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const node = id => nodes.get(id);
  return { context, listeners, timers, node, click: id => node(id).click(), render: () => vm.runInContext('render()', context) };
}
const { context, listeners, timers, node, click, render } = createApp();
assert.equal(node('status').textContent, 'Ready');
const firstQuote = node('quote').textContent;
timers.get(120000)();
assert.notEqual(node('quote').textContent, firstQuote, 'Quote changes after two minutes');
for (let i = 1; i < vm.runInContext('quotes.length', context); i++) timers.get(120000)();
assert.equal(node('quote').textContent, firstQuote, 'Quotes cycle without a network request');
node('goal').value = '2';
node('goal').handlers.input();
node('unit').value = 'problems';
node('unit').handlers.input();
node('activity').value = 'Practice algebra';
assert.equal(node('progress-text').textContent, '0 of 2 problems finished');
click('session');
assert.match(node('message').textContent, /Practice algebra/);
now = 60000;
click('done');
assert.equal(node('last').textContent, '00:01:00');
assert.equal(node('eta').textContent, '00:01:00');
now = 90000;
click('pause');
now = 390000;
render();
assert.equal(node('total').textContent, '00:01:30');
assert.equal(node('current').textContent, '00:00:30');
click('done');
assert.equal(node('remaining').textContent, '1 left');
click('pause');
now = 420000;
click('done');
assert.equal(node('status').textContent, 'Complete');
assert.equal(node('total').textContent, '00:02:00');
assert.equal(store.has('pace-session'), false, 'Completion clears saved session');
click('undo');
assert.equal(JSON.parse(store.get('pace-session')).state, 'paused', 'Undo completion saves again');
assert.equal(node('status').textContent, 'Paused');
assert.equal(node('current').textContent, '00:01:00');
click('pause');
now = 450000;
click('done');
assert.equal(node('average').textContent, '00:01:15');
assert.equal(node('min').textContent, '00:01:00');
assert.equal(node('max').textContent, '00:01:30');
acceptReset = false;
click('session');
assert.equal(node('status').textContent, 'Complete');
acceptReset = true;
click('session');
assert.equal(node('total').textContent, '00:00:00');
click('session');
now += 60000;
render();
assert.equal(node('status').textContent, 'Stopped');
assert.equal(node('total').textContent, '00:00:00');
let prevented = false;
listeners.keydown({ key: 's', target: { matches: () => true }, preventDefault() { prevented = true; } });
assert.equal(prevented, false, 'Typing in inputs must not trigger shortcuts');
listeners.keydown({ key: 's', target: { matches: () => false }, preventDefault() { prevented = true; } });
assert.equal(node('status').textContent, 'Running');
assert.equal(prevented, true);
node('theme').value = 'latte';
node('theme').handlers.change();
assert.equal(context.document.documentElement.dataset.theme, 'latte');
node('theme').value = 'invalid';
node('theme').handlers.change();
assert.equal(context.document.documentElement.dataset.theme, 'mocha');

// New app instances simulate refresh/reopening against the same browser storage.
wall += 10000;
const running = createApp();
assert.equal(running.node('status').textContent, 'Running');
assert.equal(running.node('total').textContent, '00:00:10');
assert.equal(running.node('unit').value, 'problems');
assert.equal(running.node('activity').value, 'Practice algebra');
now += 5000;
running.listeners.pagehide();
wall += 2000;
const reopened = createApp();
assert.equal(reopened.node('total').textContent, '00:00:17', 'Pagehide saves partial-second progress');
reopened.click('pause');
wall += 60000;
const paused = createApp();
assert.equal(paused.node('status').textContent, 'Paused');
assert.equal(paused.node('total').textContent, '00:00:17', 'Closed time excluded when paused');
paused.click('session');
wall += 60000;
const stopped = createApp();
assert.equal(stopped.node('status').textContent, 'Stopped');
assert.equal(stopped.node('total').textContent, '00:00:17');
stopped.click('session');
now += 60000;
stopped.click('done');
const partial = createApp();
assert.equal(partial.node('progress-text').textContent, '1 of 2 problems finished');
assert.equal(partial.node('last').textContent, '00:01:00');
assert.equal(partial.node('eta').textContent, '00:01:00');
now += 60000;
partial.click('done');
assert.equal(store.has('pace-session'), false);
assert.equal(store.get('pace-theme'), 'mocha', 'Completion preserves theme');
assert.equal(createApp().node('status').textContent, 'Ready');
for (const invalid of ['not json', 'null', '{"version":1,"state":"running"}']) {
  store.set('pace-session', invalid);
  assert.equal(createApp().node('status').textContent, 'Ready');
  assert.equal(store.has('pace-session'), false);
}
const sleeping = createApp();
sleeping.click('session');
wall += 60000;
sleeping.render();
assert.equal(sleeping.node('total').textContent, '00:01:00', 'Device sleep counts without a performance clock tick');
sleeping.click('pause');
wall += 60000;
sleeping.render();
assert.equal(sleeping.node('total').textContent, '00:01:00', 'Paused device sleep is excluded');
const unavailable = createApp({
  getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); }, removeItem() { throw Error('disabled'); },
});
unavailable.click('session');
assert.equal(unavailable.node('status').textContent, 'Running');
assert.match(unavailable.node('storage-status').textContent, /unavailable/);

// An existing v1 installation migrates without losing timings, theme, or progress.
const legacy = {
  version: 1, state: 'paused', goal: 3, unit: 'lessons', activity: 'Algebra',
  checkpoints: [0, 60000], elapsed: 90000, savedAt: wall,
};
const legacyStore = new Map([['pace-session', JSON.stringify(legacy)], ['pace-theme', 'frappe']]);
const legacyStorage = {
  getItem: key => legacyStore.get(key) ?? null,
  setItem: (key, value) => legacyStore.set(key, value),
  removeItem: key => legacyStore.delete(key),
};
const history = () => JSON.parse(legacyStore.get('pace-sessions')).sessions;
const run = (app, expression) => vm.runInContext(expression, app.context);
const migrated = createApp(legacyStorage);
assert.equal(migrated.node('progress-text').textContent, '1 of 3 lessons finished');
assert.equal(migrated.node('total').textContent, '00:01:30');
assert.equal(migrated.context.document.documentElement.dataset.theme, 'frappe');
assert.equal(history().length, 1);
const oldId = history()[0].id;
assert.equal(JSON.parse(legacyStore.get('pace-session')).id, oldId);
const restoredLegacy = createApp(legacyStorage);
assert.equal(history().length, 1, 'Migration is idempotent');
run(restoredLegacy, `resumeSession(${JSON.stringify(oldId)})`);
now += 30000;
restoredLegacy.click('done');
assert.equal(restoredLegacy.node('last').textContent, '00:01:00');
restoredLegacy.click('new-session');
assert.equal(restoredLegacy.node('status').textContent, 'Ready');
assert.equal(history()[0].state, 'paused', 'Switching sessions freezes the previous timer');
assert.equal(history()[0].elapsed, 120000);
assert.equal(legacyStore.has('pace-session'), false);
restoredLegacy.node('activity').value = 'Packing';
restoredLegacy.node('unit').value = 'orders';
restoredLegacy.node('unit').handlers.input();
restoredLegacy.node('goal').value = '2';
restoredLegacy.node('goal').handlers.input();
restoredLegacy.click('session');
now += 20000;
restoredLegacy.click('done');
now += 20000;
restoredLegacy.click('done');
const completedId = history()[0].id;
assert.equal(history().length, 2);
assert.equal(history()[0].state, 'complete', 'Completed sessions are archived');
assert.equal(legacyStore.has('pace-session'), false, 'Completion still clears the legacy active-session key');
const archiveOnly = createApp(legacyStorage);
assert.equal(archiveOnly.node('status').textContent, 'Ready');
assert.equal(archiveOnly.node('history-count').textContent, '(2)');
run(archiveOnly, `resumeSession(${JSON.stringify(oldId)})`);
assert.equal(archiveOnly.node('total').textContent, '00:02:00', 'Archived time excludes other sessions');
now += 30000;
archiveOnly.click('done');
assert.equal(archiveOnly.node('status').textContent, 'Complete');
run(archiveOnly, `restartSession(${JSON.stringify(oldId)})`);
assert.equal(archiveOnly.node('total').textContent, '00:00:00');
assert.equal(history().length, 3, 'Restart creates a new session and preserves the original');
assert.equal(history().find(item => item.id === oldId).state, 'complete');
const activeId = JSON.parse(legacyStore.get('pace-session')).id;
const edited = {activity: 'Parcels', unit: 'parcels', goal: 3, times: [10000, 30000], current: 5000};
assert.equal(run(archiveOnly, `updateSavedSession(${JSON.stringify(completedId)}, ${JSON.stringify(edited)})`), '');
const changed = history().find(item => item.id === completedId);
assert.deepEqual(changed.checkpoints, [0, 10000, 40000]);
assert.equal(changed.elapsed, 45000);
assert.equal(changed.state, 'paused');
assert.equal(JSON.parse(legacyStore.get('pace-session')).id, activeId, 'Editing an archived session does not replace the current one');
assert.match(run(archiveOnly, `updateSavedSession(${JSON.stringify(completedId)}, ${JSON.stringify({...edited, goal: 1})})`), /Goal cannot/);
assert.match(run(archiveOnly, `updateSavedSession(${JSON.stringify(completedId)}, ${JSON.stringify({...edited, times: [-1]})})`), /valid/);
assert.match(run(archiveOnly, `updateSavedSession(${JSON.stringify(completedId)}, ${JSON.stringify({...edited, goal: 2})})`), /unfinished unit time/);
run(archiveOnly, `resumeSession(${JSON.stringify(completedId)})`);
assert.equal(archiveOnly.node('progress-text').textContent, '2 of 3 parcels finished');
assert.equal(archiveOnly.node('average').textContent, '00:00:20');
assert.equal(archiveOnly.node('current').textContent, '00:00:05');
archiveOnly.click('session');
archiveOnly.node('activity').value = 'New draft';
archiveOnly.click('session');
assert.equal(history().find(item => item.id === completedId).activity, 'Parcels', 'New-session drafts do not overwrite old metadata');
assert.equal(history()[0].activity, 'New draft');
const runningStore = new Map([['pace-session', JSON.stringify({...legacy, state: 'running', savedAt: wall - 15000})]]);
const runningStorage = {
  getItem: key => runningStore.get(key) ?? null,
  setItem: (key, value) => runningStore.set(key, value),
  removeItem: key => runningStore.delete(key),
};
const upgradedRunning = createApp(runningStorage);
assert.equal(upgradedRunning.node('status').textContent, 'Running', 'Upgrading does not pause a v1 running session');
assert.equal(upgradedRunning.node('total').textContent, '00:01:45');
assert.equal(upgradedRunning.node('current').textContent, '00:00:45');
const migratedId = JSON.parse(runningStore.get('pace-session')).id;
now += 5000;
wall += 5000;
upgradedRunning.context.document.visibilityState = 'hidden';
upgradedRunning.listeners.visibilitychange();
const refreshedRunning = createApp(runningStorage);
assert.equal(refreshedRunning.node('status').textContent, 'Running');
assert.equal(refreshedRunning.node('total').textContent, '00:01:50', 'Refresh preserves running time exactly once');
assert.equal(refreshedRunning.node('progress-text').textContent, '1 of 3 lessons finished');
assert.equal(JSON.parse(runningStore.get('pace-session')).id, migratedId);
assert.equal(JSON.parse(runningStore.get('pace-sessions')).sessions.length, 1);
assert.equal(JSON.parse(runningStore.get('pace-session')).version, 1, 'Active data stays readable by the old client');
const limitedStorage = {
  ...runningStorage,
  setItem(key, value) {
    if (key === 'pace-sessions') throw Error('History quota exceeded');
    runningStore.set(key, value);
  },
};
const limited = createApp(limitedStorage);
now += 5000;
limited.render();
assert.equal(JSON.parse(runningStore.get('pace-session')).elapsed, 115000, 'History failure does not stop active-session saving');
assert.equal(createApp(limitedStorage).node('total').textContent, '00:01:55');
assert.match(limited.node('storage-status').textContent, /History not saved/);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
const featureStorage = memoryStorage({'pace-session': JSON.stringify(legacy)});
const oldCompleted = {...legacy, id: 'old-complete', createdAt: wall - 60000, goal: 2, state: 'complete', checkpoints: [0, 20000, 45000], elapsed: 45000};
const oldActive = {...legacy, id: 'old-active', createdAt: wall, state: 'running'};
const oldHistoryStorage = memoryStorage({
  'pace-session': JSON.stringify(oldActive),
  'pace-sessions': JSON.stringify({version: 1, sessions: [oldActive, oldCompleted]}),
  'pace-theme': 'macchiato',
});
const historyUpgrade = createApp(oldHistoryStorage);
assert.equal(historyUpgrade.node('status').textContent, 'Running');
assert.equal(run(historyUpgrade, 'sessionId'), 'old-active');
assert.equal(run(historyUpgrade, 'sessions.length'), 2);
assert.deepEqual(JSON.parse(oldHistoryStorage.getItem('pace-sessions')).sessions.find(item => item.id === 'old-complete'), oldCompleted, 'Previously archived sessions remain intact');
assert.equal(historyUpgrade.context.document.documentElement.dataset.theme, 'macchiato');
const features = createApp(featureStorage);
assert.equal(features.node('notes').value, '', 'Old sessions default to empty notes');
const note = 'Continue at exercise 12.\n<img src=x onerror=alert(1)>';
features.node('notes').value = note;
features.node('notes').handlers.input();
assert.equal(JSON.parse(featureStorage.getItem('pace-session')).notes, note);
const withNotes = createApp(featureStorage);
assert.equal(withNotes.node('notes').value, note);
const notedId = JSON.parse(featureStorage.getItem('pace-session')).id;
run(withNotes, `resumeSession(${JSON.stringify(notedId)})`);
now += 5000;
const firstBackup = run(withNotes, 'createBackup()');
assert.equal(firstBackup.sessions[0].notes, note);
assert.equal(run(withNotes, 'state'), 'running', 'Export never pauses the timer');
assert.equal(firstBackup.sessions[0].elapsed, 95000);
const setup = {activity: 'Daily practice', unit: 'problems', goal: 15};
assert.equal(run(withNotes, `savePreset(${JSON.stringify(setup)})`), '');
assert.equal(run(withNotes, `savePreset(${JSON.stringify(setup)})`), '');
assert.equal(run(withNotes, 'presets.length'), 1, 'Saving the same setup is idempotent');
run(withNotes, 'startSession(presets[0])');
assert.equal(withNotes.node('progress-text').textContent, '0 of 15 problems finished');
assert.equal(withNotes.node('notes').value, '', 'Presets contain setup, not old progress or notes');
assert.equal(JSON.parse(featureStorage.getItem('pace-sessions')).sessions.find(item => item.id === notedId).notes, note);
for (const id of ['show-quotes', 'show-sparkles']) {
  withNotes.node(id).checked = false;
  withNotes.node(id).handlers.change();
  if (id === 'show-quotes') assert.equal(withNotes.node('show-sparkles').checked, true, 'Celebration settings are independent');
}
const hiddenQuote = withNotes.node('quote').textContent;
withNotes.timers.get(120000)();
assert.equal(withNotes.node('quote').hidden, true);
assert.equal(withNotes.node('quote').textContent, hiddenQuote);
withNotes.node('theme').value = 'latte';
withNotes.node('theme').handlers.change();
const settingsReload = createApp(featureStorage);
assert.equal(settingsReload.node('show-quotes').checked, false);
assert.equal(settingsReload.node('show-sparkles').checked, false);
assert.equal(settingsReload.node('keep-awake').disabled, true, 'Unsupported wake lock is optional');
const fullBackup = JSON.stringify(run(settingsReload, 'createBackup()'));
const destination = memoryStorage();
const importedApp = createApp(destination);
const importResult = run(importedApp, `importBackup(${JSON.stringify(fullBackup)})`);
assert.equal(importResult.sessions, 2);
assert.equal(importResult.presets, 1);
assert.equal(importedApp.node('status').textContent, 'Ready', 'Import never auto-starts a session');
assert.equal(destination.getItem('pace-session'), null);
assert.ok(JSON.parse(destination.getItem('pace-sessions')).sessions.every(item => item.state !== 'running'));
assert.equal(importedApp.node('show-quotes').checked, true, 'Import settings are opt-in');
assert.equal(run(importedApp, `importBackup(${JSON.stringify(fullBackup)}).sessions`), 0);
run(importedApp, `importBackup(${JSON.stringify(fullBackup)}, true)`);
assert.equal(importedApp.node('show-quotes').checked, false);
assert.equal(importedApp.context.document.documentElement.dataset.theme, 'latte');
run(importedApp, `resumeSession(${JSON.stringify(notedId)})`);
const activeBeforeImport = JSON.parse(destination.getItem('pace-session'));
const conflicting = JSON.parse(fullBackup);
conflicting.sessions.find(item => item.id === notedId).notes = 'Recovered note';
conflicting.presets[0].goal++;
const conflictJSON = JSON.stringify(conflicting);
const conflicts = run(importedApp, `importBackup(${JSON.stringify(conflictJSON)})`);
assert.equal(conflicts.sessions, 1);
assert.equal(conflicts.presets, 1);
assert.equal(run(importedApp, 'state'), 'running');
assert.equal(run(importedApp, 'sessionId'), activeBeforeImport.id);
assert.equal(importedApp.node('notes').value, note, 'Conflicting imports do not overwrite the current session');
assert.equal(run(importedApp, `importBackup(${JSON.stringify(conflictJSON)}).sessions`), 0, 'Repeated conflicting imports do not duplicate recovered copies');
const beforeInvalid = new Map(destination.data);
for (const invalid of ['invalid json', '{"version":2}', '{"version":1,"sessions":{}}',
  JSON.stringify({...JSON.parse(fullBackup), sessions: [{...legacy, checkpoints: [0, -1]}]}),
  JSON.stringify({...JSON.parse(fullBackup), settings: {quotes: 'yes', sparkles: true, awake: false}}),
  JSON.stringify({...JSON.parse(fullBackup), sessions: [JSON.parse(fullBackup).sessions[0], JSON.parse(fullBackup).sessions[0]]}),
  JSON.stringify({...JSON.parse(fullBackup), presets: [JSON.parse(fullBackup).presets[0], JSON.parse(fullBackup).presets[0]]}),
  JSON.stringify({...JSON.parse(fullBackup), sessions: [{...legacy, notes: 'x'.repeat(4001)}]})]) {
  assert.throws(() => run(importedApp, `importBackup(${JSON.stringify(invalid)})`));
  assert.deepEqual(destination.data, beforeInvalid, 'Invalid imports do not mutate storage');
}
const rawLegacy = run(importedApp, `parseBackup(${JSON.stringify(JSON.stringify({...legacy, state: 'running'}))})`);
assert.equal(rawLegacy.sessions[0].state, 'paused');
assert.equal(rawLegacy.sessions[0].notes, '');
assert.equal(run(importedApp, `parseBackup(${JSON.stringify('\uFEFF' + fullBackup)}).sessions.length`), 2, 'Windows-style UTF-8 BOM backups are accepted');
let failPresetWrite = false;
const quota = {...destination, setItem(key, value) {
  if (failPresetWrite && key === 'pace-presets') throw Error('Quota exceeded');
  destination.setItem(key, value);
}};
const quotaApp = createApp(quota);
const quotaBaseline = new Map(destination.data);
failPresetWrite = true;
const newRecord = {...legacy, id: 'new-import', createdAt: wall, notes: ''};
assert.throws(() => run(quotaApp, `importBackup(${JSON.stringify(JSON.stringify({version: 1, sessions: [newRecord]}))})`), /could not be saved/);
assert.deepEqual(destination.data, quotaBaseline, 'Failed multi-key imports roll back prior writes');
assert.equal(run(quotaApp, 'state'), 'running');
for (const times of [[], [0], [60000, 30000], Array(1000).fill(1000)]) {
  const chart = run(features, `paceChartData(${JSON.stringify(times)})`);
  assert.ok(chart.points.length <= 200);
  assert.ok(chart.points.every(point => point.every(Number.isFinite)));
}
assert.equal(run(features, 'paceChartData([-1]).points.length'), 0);
assert.equal(JSON.stringify(run(features, 'paceChartData([60000, 30000]).points')), JSON.stringify([[20, 20], [460, 80]]), 'Chart positions reflect unit durations');
const noteChanges = {...edited, notes: 'Edited notes'};
assert.equal(run(importedApp, `updateSavedSession(${JSON.stringify(notedId)}, ${JSON.stringify(noteChanges)})`), '');
assert.equal(importedApp.node('notes').value, 'Edited notes');
const setupStorage = memoryStorage();
const setupTabA = createApp(setupStorage);
const setupTabB = createApp(setupStorage);
run(setupTabA, `savePreset(${JSON.stringify(setup)})`);
run(setupTabB, `savePreset(${JSON.stringify({...setup, activity: 'Reading', unit: 'pages'})})`);
assert.equal(JSON.parse(setupStorage.getItem('pace-presets')).presets.length, 2, 'Saving from another tab preserves existing setups');
assert.equal(run(setupTabA, 'createBackup().presets.length'), 2, 'Backups include setups saved from another tab');
setupTabA.click('remove-preset');
assert.equal(JSON.parse(setupStorage.getItem('pace-presets')).presets.length, 1);
assert.equal(JSON.parse(setupStorage.getItem('pace-presets')).presets[0].activity, 'Reading');

async function testWakeLock() {
  const locks = [];
  const sentinel = () => {
    const handlers = {};
    return { released: false, addEventListener: (name, callback) => { handlers[name] = callback; },
      async release() { this.released = true; handlers.release?.(); } };
  };
  const navigator = {wakeLock: {async request(type) {
    assert.equal(type, 'screen');
    const lock = sentinel(); locks.push(lock); return lock;
  }}};
  const app = createApp(memoryStorage(), {navigator});
  const flush = () => new Promise(resolve => setImmediate(resolve));
  app.node('keep-awake').checked = true; app.node('keep-awake').handlers.change();
  app.click('session');
  await flush();
  assert.equal(locks.length, 1);
  assert.equal(run(app, 'screenLock !== null'), true);
  app.render(); await flush();
  assert.equal(locks.length, 1, 'Clock ticks do not issue duplicate requests');
  app.click('pause'); await flush();
  assert.equal(locks[0].released, true);
  app.click('pause'); await flush();
  assert.equal(locks.length, 2);
  app.context.document.visibilityState = 'hidden'; app.listeners.visibilitychange(); await flush();
  assert.equal(locks[1].released, true);
  app.context.document.visibilityState = 'visible'; app.listeners.visibilitychange(); await flush();
  assert.equal(locks.length, 3);
  await locks[2].release(); app.render(); await flush();
  assert.equal(locks.length, 3, 'Device release does not cause a retry loop');
  app.node('keep-awake').checked = false; app.node('keep-awake').handlers.change(); await flush();
  assert.equal(run(app, 'screenLock'), null);

  let grant;
  const pending = createApp(memoryStorage(), {navigator: {wakeLock: {request: () => new Promise(resolve => { grant = resolve; })}}});
  pending.node('keep-awake').checked = true; pending.node('keep-awake').handlers.change();
  pending.click('session'); pending.click('pause');
  const late = sentinel(); grant(late); await flush();
  assert.equal(late.released, true, 'A late grant after pausing is immediately released');
  pending.click('pause'); pending.listeners.pagehide();
  const hidden = sentinel(); grant(hidden); await flush();
  assert.equal(hidden.released, true, 'A late grant after closing is released');
  pending.listeners.pageshow();
  const restoredLock = sentinel(); grant(restoredLock); await flush();
  assert.equal(run(pending, 'screenLock !== null'), true, 'Returning from the back-forward cache reacquires the lock');
  pending.click('pause'); await flush();
  assert.equal(restoredLock.released, true);
  const denied = createApp(memoryStorage(), {navigator: {wakeLock: {async request() { throw Error('Permission denied'); }}}});
  denied.node('keep-awake').checked = true; denied.node('keep-awake').handlers.change(); denied.click('session');
  await flush();
  assert.equal(denied.node('status').textContent, 'Running', 'Wake lock failure never stops the timer');
  assert.match(denied.node('wake-status').textContent, /unavailable/);
}
testWakeLock().then(() => {
  console.log('Pace checks passed: legacy data, history, backup merging/rollback, presets, notes, settings, chart, and wake-lock lifecycle.');
}).catch(error => { console.error(error); process.exitCode = 1; });
