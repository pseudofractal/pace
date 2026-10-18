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
      focus() {},
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
    node.value = ({ goal: '20', unit: 'units', 'history-filter': 'all', 'history-sort': 'newest', 'eta-mode': 'recent' })[id] || '';
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
assert.equal(run(limited, 'createBackup().sessions.find(saved => saved.id === sessionId).elapsed'), 115000, 'Backup includes the latest active time even when history storage is full');

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
const historyBeforeNote = featureStorage.getItem('pace-sessions');
features.node('notes').value = note;
features.node('notes').handlers.input();
assert.equal(JSON.parse(featureStorage.getItem('pace-session')).notes, note);
assert.equal(featureStorage.getItem('pace-sessions'), historyBeforeNote, 'Typing notes does not rewrite history storage');
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

// Pure clock ticks batch history writes; real changes flush immediately.
const tickStorage = memoryStorage();
const tickApp = createApp(tickStorage);
run(tickApp, 'startSession({goal:5, unit:"units", activity:"Tick throttle"})');
const tickId = run(tickApp, 'sessionId');
const historyBeforeTicks = tickStorage.getItem('pace-sessions');
const nowBeforeTicks = now;
for (let i = 0; i < 4; i++) { now += 1000; tickApp.render(); }
assert.equal(tickStorage.getItem('pace-sessions'), historyBeforeTicks, 'Pure clock ticks batch history writes');
now += 1000;
tickApp.render();
assert.equal(JSON.parse(tickStorage.getItem('pace-sessions')).sessions.find(item => item.id === tickId).elapsed, 5000,
  'Batched history writes flush on their interval');
now = nowBeforeTicks;

// Setups stop growing at the preset limit; existing setups still save.
const presetCapStorage = memoryStorage();
const presetCapApp = createApp(presetCapStorage);
for (let i = 0; i < 500; i++) {
  assert.equal(run(presetCapApp, `savePreset(${JSON.stringify({activity: `Setup ${i}`, unit: 'units', goal: 1})})`), '');
}
assert.equal(run(presetCapApp, 'presets.length'), 500, 'Preset storage stops at the limit');
assert.match(run(presetCapApp, `savePreset(${JSON.stringify({activity: 'Setup 500', unit: 'units', goal: 1})})`),
  /Preset limit/, 'New setups past the limit are refused');
assert.equal(run(presetCapApp, `savePreset(${JSON.stringify({activity: 'Setup 499', unit: 'units', goal: 1})})`), '',
  'Saving an existing setup still works at the limit');
assert.equal(run(presetCapApp, 'presets.length'), 500);

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
  JSON.stringify({...JSON.parse(fullBackup), sessions: [{...legacy, notes: 'x'.repeat(4001)}]}),
  ...[{deadline: -1}, {deadline: 'tomorrow'}, {deadline: 8640000000000001}, {etaMode: 'unknown'}, {completedAt: wall}]
    .map(fields => JSON.stringify({version: 1, sessions: [{...legacy, ...fields}]}))]) {
  assert.throws(() => run(importedApp, `importBackup(${JSON.stringify(invalid)})`));
  assert.deepEqual(destination.data, beforeInvalid, 'Invalid imports do not mutate storage');
}
assert.throws(() => run(importedApp, `parseBackup(${JSON.stringify({version: 1, sessions: Array(10001).fill({})})})`),
  /session list/, 'Backups with absurd session counts are rejected');
assert.throws(() => run(importedApp, `parseBackup(${JSON.stringify({version: 1, sessions: JSON.parse(fullBackup).sessions, presets: Array(501).fill({})})})`),
  /invalid preset/, 'Backups with absurd preset counts are rejected');
assert.throws(() => run(importedApp, `importBackup(${JSON.stringify({version: 1, sessions: [{...legacy, goal: 10001}]})})`),
  /invalid session/, 'Goals beyond the supported limit are rejected');
assert.throws(() => run(importedApp, 'parseBackup("x".repeat(33554433))'), /too large/,
  'Oversized backup files are rejected before parsing');
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

// Storage events from another tab apply immediately.
const syncStorage = memoryStorage();
const syncApp = createApp(syncStorage);
syncStorage.setItem('pace-sessions', JSON.stringify({version: 1, sessions: [
  {version: 1, id: 'other-tab', createdAt: wall, state: 'stopped', goal: 1, unit: 'units',
    activity: 'From other tab', checkpoints: [0], elapsed: 0, savedAt: wall},
]}));
syncApp.listeners.storage({key: 'pace-sessions'});
assert.equal(run(syncApp, 'sessions.some(saved => saved.id === "other-tab")'), true, 'Storage events sync history from another tab');
run(syncApp, 'startSession({goal:2, unit:"units", activity:"Synced timer"})');
assert.equal(run(syncApp, 'state'), 'running');
const syncedId = run(syncApp, 'sessionId');
syncStorage.setItem('pace-sessions', JSON.stringify({version: 1, sessions:
  JSON.parse(syncStorage.getItem('pace-sessions')).sessions.map(saved =>
    saved.id === syncedId ? {...saved, state: 'paused'} : saved)}));
syncApp.listeners.storage({key: 'pace-sessions'});
assert.equal(run(syncApp, 'state'), 'paused', 'A pause from another tab applies through storage events');
syncStorage.setItem('pace-presets', JSON.stringify({version: 1, presets: [
  {id: 'other-preset', name: 'Reading', activity: 'Reading', unit: 'pages', goal: 5},
]}));
syncApp.listeners.storage({key: 'pace-presets'});
assert.equal(run(syncApp, 'presets.length'), 1, 'Storage events sync setups from another tab');
syncStorage.setItem('pace-settings', JSON.stringify({version: 1, settings: {quotes: false, sparkles: true, awake: false}}));
syncApp.listeners.storage({key: 'pace-settings'});
assert.equal(syncApp.node('show-quotes').checked, false, 'Storage events sync settings from another tab');
assert.equal(run(syncApp, 'settings.quotes'), false);
syncStorage.setItem('pace-theme', 'latte');
syncApp.listeners.storage({key: 'pace-theme'});
assert.equal(syncApp.context.document.documentElement.dataset.theme, 'latte', 'Storage events sync the theme from another tab');
syncApp.listeners.storage({key: 'pace-unknown'});
syncApp.listeners.storage({key: null});

// Becoming visible repaints without waiting for the next tick.
const visStorage = memoryStorage();
const visApp = createApp(visStorage);
const nowBeforeVisible = now;
run(visApp, 'startSession({goal:3, unit:"steps", activity:"Visible repaint"})');
now += 5000;
visApp.context.document.visibilityState = 'hidden';
visApp.listeners.visibilitychange();
assert.notEqual(visApp.node('total').textContent, '00:00:05', 'A hidden tab only flushes storage');
visApp.context.document.visibilityState = 'visible';
visApp.listeners.visibilitychange();
assert.equal(visApp.node('total').textContent, '00:00:05', 'Becoming visible repaints immediately');
now = nowBeforeVisible;

// Session management preserves timing/state and stays deleted across stale tabs.
const crudStorage = memoryStorage({
  'pace-session': JSON.stringify(oldActive),
  'pace-sessions': JSON.stringify({version: 1, sessions: [oldActive, oldCompleted]}),
});
const crud = createApp(crudStorage);
const staleTab = createApp(crudStorage);
const archivedBeforeRename = JSON.parse(crudStorage.getItem('pace-sessions')).sessions.find(item => item.id === oldCompleted.id);
assert.equal(run(crud, 'renameSavedSession("old-complete", "  Finished algebra  ")'), '');
const archivedAfterRename = JSON.parse(crudStorage.getItem('pace-sessions')).sessions.find(item => item.id === oldCompleted.id);
assert.deepEqual({...archivedAfterRename, activity: archivedBeforeRename.activity, savedAt: archivedBeforeRename.savedAt}, archivedBeforeRename, 'Rename only changes the name and modification timestamp');
now += 1234;
wall += 1234;
const timeBeforeRename = run(crud, 'elapsed()');
assert.equal(run(crud, 'renameSavedSession("old-active", "Current algebra")'), '');
assert.equal(run(crud, 'state'), 'running', 'Renaming a running session never pauses it');
assert.equal(run(crud, 'elapsed()'), timeBeforeRename);
assert.equal(crud.node('activity').value, 'Current algebra');
assert.equal(JSON.parse(crudStorage.getItem('pace-session')).elapsed, timeBeforeRename, 'Rename saves the latest active time');
staleTab.render();
assert.equal(staleTab.node('activity').value, 'Current algebra', 'Another open tab does not overwrite the new name');
assert.equal(createApp(crudStorage).node('activity').value, 'Current algebra', 'Rename survives reopening');
const beforeInvalidRename = new Map(crudStorage.data);
assert.match(run(crud, 'renameSavedSession("old-active", "x".repeat(81))'), /80 characters/);
assert.match(run(crud, 'renameSavedSession("missing", "Name")'), /not found/);
assert.deepEqual(crudStorage.data, beforeInvalidRename, 'Invalid renames do not change storage');
const activeBeforeDelete = crudStorage.getItem('pace-session');
assert.equal(run(crud, 'deleteSavedSessions(["old-complete"])'), '');
assert.equal(crudStorage.getItem('pace-session'), activeBeforeDelete, 'Deleting an archive leaves the active snapshot untouched');
staleTab.render();
assert.equal(JSON.parse(crudStorage.getItem('pace-sessions')).sessions.length, 1, 'A stale tab cannot resurrect deleted archives');
assert.equal(run(crud, 'createBackup().sessions.length'), 1, 'Deleted sessions are excluded from backups');
assert.equal(run(crud, 'deleteSavedSessions(["old-active"])'), '');
crud.render();
assert.equal(crud.node('status').textContent, 'Ready');
assert.equal(crud.node('history-count').textContent, '(0)');
assert.equal(crud.node('total').textContent, '00:00:00');
assert.equal(crudStorage.getItem('pace-session'), null);
staleTab.listeners.pagehide();
assert.equal(run(staleTab, 'state'), 'ready', 'A deleted timer is cleared before another tab can autosave it');
assert.equal(run(createApp(crudStorage), 'sessions.length'), 0, 'Deleting the last session survives reopening');

// Failed writes, including removal of the active snapshot, leave sessions intact.
const failureStorage = memoryStorage({
  'pace-session': JSON.stringify(oldActive),
  'pace-sessions': JSON.stringify({version: 1, sessions: [oldActive, oldCompleted]}),
});
let failingKey = '';
const failingCrud = createApp({...failureStorage,
  setItem(key, value) {
    if (key === failingKey) throw Error('Quota exceeded');
    failureStorage.setItem(key, value);
  },
  removeItem(key) {
    if (key === failingKey) throw Error('Storage disabled');
    failureStorage.removeItem(key);
  },
});
const beforeFailedCrud = new Map(failureStorage.data);
for (const key of ['pace-sessions', 'pace-session']) {
  failingKey = key;
  assert.match(run(failingCrud, 'renameSavedSession("old-active", "Lost name")'), /could not be saved/);
  assert.match(run(failingCrud, 'deleteSavedSessions(["old-active", "old-complete"])'), /could not be deleted/);
  assert.deepEqual(failureStorage.data, beforeFailedCrud, 'Failed CRUD rolls back storage writes');
  assert.equal(run(failingCrud, 'state'), 'running');
  assert.equal(failingCrud.node('activity').value, oldActive.activity);
  assert.equal(run(failingCrud, 'sessions.length'), 2);
  assert.equal(run(failingCrud, 'deletionUndo'), null, 'A failed deletion does not create an undo action');
}

const browseRecords = [
  {...legacy, id: 'alpha', createdAt: 1000, activity: 'Alpha'},
  {...legacy, id: 'beta', createdAt: 3000, activity: 'zebra', state: 'stopped'},
  {...oldCompleted, id: 'done', createdAt: 2000, activity: 'Alpha done'},
  {...legacy, id: 'untitled', createdAt: 4000, activity: '', state: 'running'},
];
const browseStorage = memoryStorage({'pace-sessions': JSON.stringify({version: 1, sessions: browseRecords})});
const browse = createApp(browseStorage);
browse.click('sessions-tab');
browse.render();
assert.equal(run(browse, 'visibleSessions().map(saved => saved.id).join(",")'), 'untitled,beta,done,alpha', 'Default order uses creation dates, not autosave order');
browse.node('history-sort').value = 'oldest'; browse.node('history-sort').handlers.change();
assert.equal(run(browse, 'visibleSessions().map(saved => saved.id).join(",")'), 'alpha,done,beta,untitled');
browse.node('history-sort').value = 'name'; browse.node('history-sort').handlers.change();
assert.equal(run(browse, 'visibleSessions().map(saved => saved.id).join(",")'), 'alpha,done,untitled,beta');
browse.node('history-sort').value = 'name-desc'; browse.node('history-sort').handlers.change();
assert.equal(run(browse, 'visibleSessions().map(saved => saved.id).join(",")'), 'beta,untitled,done,alpha');
browse.node('history-search').value = '  ALPHA  '; browse.node('history-search').handlers.input();
assert.equal(run(browse, 'visibleSessions().length'), 2, 'Search is case-insensitive and trims surrounding spaces');
browse.node('history-filter').value = 'incomplete'; browse.node('history-filter').handlers.change();
assert.equal(run(browse, 'visibleSessions()[0].id'), 'alpha', 'Search and status filters combine');
browse.node('history-search').value = ''; browse.node('history-search').handlers.input();
assert.equal(run(browse, 'visibleSessions().length'), 3);
for (const [status, id] of [['running', 'untitled'], ['paused', 'alpha'], ['stopped', 'beta'], ['complete', 'done']]) {
  browse.node('history-filter').value = status; browse.node('history-filter').handlers.change();
  assert.equal(run(browse, 'visibleSessions().map(saved => saved.id).join(",")'), id);
}
browse.node('history-filter').value = 'all'; browse.node('history-filter').handlers.change();
browse.click('toggle-selection');
const firstSelection = browse.node('history-list').querySelectorAll('input')[0];
firstSelection.checked = true;
browse.node('history-list').handlers.change({target: firstSelection});
assert.equal(browse.node('select-visible').indeterminate, true);
browse.render();
assert.equal(browse.node('history-list').querySelectorAll('input')[0], firstSelection, 'Clock ticks preserve focused selection controls');
browse.node('history-sort').value = 'newest'; browse.node('history-sort').handlers.change();
assert.equal(run(browse, 'selectedSessionIds.size'), 1, 'Sorting preserves selection');
browse.node('history-filter').value = 'complete'; browse.node('history-filter').handlers.change();
assert.equal(run(browse, 'selectedSessionIds.size'), 0, 'Changing filters clears hidden selections');
browse.node('select-visible').checked = true; browse.node('select-visible').handlers.change();
browse.click('delete-selected');
assert.deepEqual(JSON.parse(browseStorage.getItem('pace-sessions')).sessions.map(saved => saved.id).sort(), ['alpha', 'beta', 'untitled'], 'Bulk delete only removes selected results');
assert.equal(browse.node('delete-undo').hidden, false);
assert.equal(browse.node('delete-selected').disabled, true);
browse.click('undo-delete');
assert.equal(JSON.parse(browseStorage.getItem('pace-sessions')).sessions.length, 4);
assert.equal(browse.node('delete-undo').hidden, true);
browse.node('history-search').value = 'no match'; browse.node('history-search').handlers.input();
assert.equal(browse.node('history-results').textContent, 'Showing 0 of 4 sessions');
assert.match(browse.node('history-list').querySelectorAll('h3')[0].textContent, /No sessions match/);
assert.equal(browse.node('select-visible').disabled, true);

// Undo restores a whole batch and freezes a deleted running timer at deletion time.
const undoStorage = memoryStorage({
  'pace-session': JSON.stringify(oldActive),
  'pace-sessions': JSON.stringify({version: 1, sessions: [oldActive, oldCompleted]}),
});
const undoApp = createApp(undoStorage);
const undoStaleTab = createApp(undoStorage);
now += 4321; wall += 4321;
const deletedTime = run(undoApp, 'elapsed()');
assert.equal(run(undoApp, 'deleteSavedSessions(["old-active", "old-complete"])'), '');
undoApp.render();
assert.equal(undoApp.node('history-count').textContent, '(0)');
assert.match(undoApp.node('delete-undo-message').textContent, /2 sessions/);
now += 3000; wall += 3000;
assert.equal(run(undoApp, 'undoSessionDeletion()'), '');
undoApp.render();
assert.equal(run(undoApp, 'sessionId'), oldActive.id);
assert.equal(run(undoApp, 'state'), 'paused');
assert.equal(run(undoApp, 'elapsed()'), deletedTime, 'The deleted interval is excluded');
const recovered = JSON.parse(undoStorage.getItem('pace-sessions')).sessions;
assert.deepEqual(recovered.find(saved => saved.id === oldCompleted.id), {...oldCompleted, savedAt: wall}, 'Completed session details are restored exactly');
undoStaleTab.render();
assert.equal(run(undoStaleTab, 'state'), 'paused', 'A stale running tab honors the restored paused state');
assert.equal(run(undoStaleTab, 'elapsed()'), deletedTime);
assert.equal(createApp(undoStorage).node('status').textContent, 'Paused');
assert.equal(run(undoApp, 'deleteSavedSessions(["old-complete"])'), '');
run(undoApp, `startSession(${JSON.stringify(setup)})`);
const newActive = undoStorage.getItem('pace-session');
assert.equal(run(undoApp, 'undoSessionDeletion()'), '');
assert.equal(undoStorage.getItem('pace-session'), newActive, 'Undo keeps a session started after deletion active');
assert.equal(run(undoApp, 'deleteSavedSessions(["old-complete"])'), '');
const independentlyRecovered = JSON.parse(undoStorage.getItem('pace-sessions'));
independentlyRecovered.sessions.push({...oldCompleted, activity: 'Recovered elsewhere'});
undoStorage.setItem('pace-sessions', JSON.stringify(independentlyRecovered));
assert.equal(run(undoApp, 'undoSessionDeletion()'), '');
assert.equal(JSON.parse(undoStorage.getItem('pace-sessions')).sessions.find(saved => saved.id === oldCompleted.id).activity, 'Recovered elsewhere', 'Undo preserves records already restored or changed elsewhere');
assert.equal(run(undoApp, 'deleteSavedSessions(["old-complete"])'), '');
wall += 10000;
assert.match(run(undoApp, 'undoSessionDeletion()'), /expired/);
undoApp.render();
assert.equal(undoApp.node('delete-undo').hidden, true);
assert.equal(run(undoApp, 'sessions.some(saved => saved.id === "old-complete")'), false);

const restoreStorage = memoryStorage({
  'pace-session': JSON.stringify(oldActive),
  'pace-sessions': JSON.stringify({version: 1, sessions: [oldActive, oldCompleted]}),
});
let restoreFailure = '';
const restoreApp = createApp({...restoreStorage, setItem(key, value) {
  if (key === restoreFailure) throw Error('Quota exceeded');
  restoreStorage.setItem(key, value);
}});
assert.equal(run(restoreApp, 'deleteSavedSessions(["old-active", "old-complete"])'), '');
const beforeFailedUndo = new Map(restoreStorage.data);
for (const key of ['pace-sessions', 'pace-session']) {
  restoreFailure = key;
  assert.match(run(restoreApp, 'undoSessionDeletion()'), /could not be restored/);
  assert.deepEqual(restoreStorage.data, beforeFailedUndo, 'A failed undo rolls back all restored records');
  assert.equal(run(restoreApp, 'state'), 'ready');
  assert.equal(run(restoreApp, 'deletionUndo.records.length'), 2, 'A failed undo can be retried within its deadline');
}
restoreFailure = '';
assert.equal(run(restoreApp, 'undoSessionDeletion()'), '');
assert.equal(run(restoreApp, 'sessions.length'), 2);

// Recent estimates adapt to changing pace and never spend future-unit time on an overdue unit.
const trendPoints = [0, 100000, 200000, 300000, 400000, 500000, 520000, 540000, 560000, 580000, 600000];
const recentMetrics = run(features, `paceMetrics(${JSON.stringify(trendPoints)}, 610000, 13, 'recent')`);
const averageMetrics = run(features, `paceMetrics(${JSON.stringify(trendPoints)}, 610000, 13, 'average')`);
assert.equal(recentMetrics.recent, 20000);
assert.equal(recentMetrics.average, 60000);
assert.equal(recentMetrics.remaining, 50000);
assert.equal(averageMetrics.remaining, 170000);
assert.ok(recentMetrics.trend < 0);
const slowingPoints = [0, 20000, 40000, 60000, 80000, 100000, 200000, 300000, 400000, 500000, 600000];
assert.equal(run(features, `paceMetrics(${JSON.stringify(slowingPoints)}, 610000, 13).remaining`), 290000);
assert.ok(run(features, `paceMetrics(${JSON.stringify(slowingPoints)}, 610000, 13).trend`) > 0);
assert.equal(run(features, 'paceMetrics([0], 10000, 3).remaining'), null);
assert.equal(run(features, 'paceMetrics([0,0,0], 0, 3).trend'), 0, 'Zero-duration records never produce NaN trends');
assert.equal(run(features, 'paceMetrics([0,60000], 300000, 4).remaining'), 120000);
assert.equal(run(features, 'paceMetrics([0,60000], 300000, 4).overrun'), true);
assert.equal(run(features, 'paceMetrics([0,60000], 60000, 1).overrun'), false);

// A median level with a Theil-Sen slope tracks improving and tiring pace; flat means cannot.
const improvingPoints = [0, 60000, 110000, 150000, 180000, 200000];
const improving = run(features, `paceMetrics(${JSON.stringify(improvingPoints)}, 200000, 10, 'recent')`);
assert.equal(run(features, `paceMetrics(${JSON.stringify(improvingPoints)}, 200000, 10, 'average')`).remaining, 200000, 'Whole-session average stays a flat baseline');
assert.ok(Math.abs(improving.remaining - 107571) < 2, 'Trend-aware ETA beats the flat mean on a warming-up pace');
assert.ok(Math.abs(improving.forecastNext - 32000) < 2, 'The next-unit forecast follows the improving trend');
assert.ok(improving.band > 38000 && improving.band < 43000, 'The band reflects typical forecast spread');
const slowingWindow = run(features, `paceMetrics(${JSON.stringify([0, 20000, 50000, 90000, 140000, 200000])}, 200000, 10, 'recent')`);
assert.ok(slowingWindow.remaining > 200000, 'A tiring pace raises the estimate above the flat mean');
assert.ok(slowingWindow.band > 0);
assert.equal(run(features, `paceMetrics(${JSON.stringify(trendPoints)}, 610000, 13, 'recent')`).band, 0, 'A steady window shows no variability band');
assert.equal(run(features, 'paceMetrics([0,60000,90000], 90000, 5, \'recent\').band'), null, 'Trend estimates wait for at least three units');

// One interrupted unit must not skew the forecast or widen the band.
const outlierPoints = [0, 40000, 82000, 120000, 520000, 561000];
const outlier = run(features, `paceMetrics(${JSON.stringify(outlierPoints)}, 561000, 10, 'recent')`);
assert.ok(outlier.forecastNext > 40000 && outlier.forecastNext < 45000, 'A single spike leaves the median pace nearly unchanged');
assert.ok(outlier.band < 20000, 'The conformal band discards the single worst residual');
assert.ok(outlier.remaining < 250000, 'The outlier session estimates far below the flat mean');
assert.ok(outlier.remaining > run(features, `paceMetrics(${JSON.stringify(outlierPoints)}, 561000, 10, 'average')`).remaining / 4);
const outlook = (offset, metrics = recentMetrics, state = 'running', finishedAt = null) => run(features,
  `deadlineOutlook(${wall + offset}, ${wall}, ${JSON.stringify(metrics)}, ${JSON.stringify(state)}, ${JSON.stringify(finishedAt)})`);
assert.equal(outlook(180000).required, 60000);
assert.equal(outlook(180000).margin, 130000);
assert.equal(outlook(180000).status, 'On track');
assert.equal(outlook(40000).status, 'Behind schedule');
assert.equal(outlook(-1).status, 'Deadline passed');
assert.equal(outlook(300000, run(features, 'paceMetrics([0,60000], 300000, 4)')).status, 'Pace uncertain');
assert.equal(outlook(180000, run(features, 'paceMetrics([0], 0, 3)')).status, 'Waiting for pace');
assert.equal(outlook(0, recentMetrics, 'complete', wall).status, 'Met deadline');
assert.equal(outlook(0, recentMetrics, 'complete', wall + 1).status, 'Finished late');
assert.equal(outlook(0, recentMetrics, 'complete').margin, null, 'Old completed sessions do not invent a finish timestamp');

const planningRecord = {...legacy, id: 'planning', createdAt: wall, goal: 13, checkpoints: trendPoints,
  elapsed: 610000, deadline: wall + 180000, etaMode: 'recent', notes: 'Keep the plan'};
const planningStorage = memoryStorage({
  'pace-session': JSON.stringify(planningRecord),
  'pace-sessions': JSON.stringify({version: 1, sessions: [planningRecord]}),
});
const planning = createApp(planningStorage);
const planningTab = createApp(planningStorage);
assert.equal(planning.node('recent-average').textContent, '00:00:20');
assert.equal(planning.node('pace-trend').textContent, '67% less time');
assert.equal(planning.node('eta').textContent, '00:00:50');
assert.equal(planning.node('live-pace-chart').querySelectorAll('polyline').length, 1);
planning.node('eta-mode').value = 'average'; planning.node('eta-mode').handlers.change();
assert.equal(planning.node('eta').textContent, '00:02:50');
assert.equal(run(planning, 'state'), 'paused', 'Changing the forecast never changes timer state');
planningTab.render();
assert.equal(planningTab.node('eta-mode').value, 'average', 'Stale tabs retain the chosen ETA basis');
const plannedDeadline = Math.ceil((wall + 600000) / 60000) * 60000;
planning.node('deadline').value = run(planning, `localDateTime(${plannedDeadline})`);
planning.node('deadline').handlers.change();
assert.equal(run(planning, 'deadline'), plannedDeadline, 'Datetime controls convert local time to a timestamp');
planningTab.render();
assert.equal(run(planningTab, 'deadline'), plannedDeadline, 'Stale tabs retain deadline edits');

// A session with a warming pace shows the trend ETA and its ± variability band.
const warmingRecord = {version: 1, id: 'warming', createdAt: wall, state: 'paused', goal: 10, unit: 'units',
  activity: 'Warming up', checkpoints: improvingPoints, elapsed: 200000, savedAt: wall, etaMode: 'recent'};
const warming = createApp(memoryStorage({
  'pace-session': JSON.stringify(warmingRecord),
  'pace-sessions': JSON.stringify({version: 1, sessions: [warmingRecord]}),
}));
assert.equal(warming.node('eta').textContent, '00:01:48 ± 00:00:41', 'The ETA renders the trend forecast with its band');
assert.ok(warming.node('estimate-note').textContent.includes('pace trend across the last 5 completed units'));
assert.ok(warming.node('estimate-note').textContent.includes('± range reflects recent pace variability'));
const marginBeforeBreak = run(planning, 'deadlineOutlook(deadline, Date.now(), paceMetrics(checkpoints, elapsed(), goal, etaMode), state).margin');
wall += 120000; now += 120000;
planning.render();
assert.equal(run(planning, 'elapsed()'), 610000);
assert.equal(run(planning, 'deadlineOutlook(deadline, Date.now(), paceMetrics(checkpoints, elapsed(), goal, etaMode), state).margin'), marginBeforeBreak - 120000, 'Breaks consume deadline budget without adding active time');
const planningBackup = JSON.stringify(run(planning, 'createBackup()'));
const planningDestination = memoryStorage();
const importedPlan = createApp(planningDestination);
assert.equal(run(importedPlan, `importBackup(${JSON.stringify(planningBackup)}).sessions`), 1);
assert.equal(JSON.parse(planningDestination.getItem('pace-sessions')).sessions[0].deadline, plannedDeadline);
assert.equal(JSON.parse(planningDestination.getItem('pace-sessions')).sessions[0].etaMode, 'average');
assert.equal(run(importedPlan, `importBackup(${JSON.stringify(planningBackup)}).sessions`), 0);
const conflictingPlan = JSON.parse(planningBackup);
conflictingPlan.sessions[0].deadline += 60000;
assert.equal(run(importedPlan, `importBackup(${JSON.stringify(JSON.stringify(conflictingPlan))}).sessions`), 1, 'Deadline conflicts preserve both backup versions');
assert.equal(run(planning, 'deleteSavedSessions(["planning"])'), '');
assert.equal(planning.node('deadline').value, '');
assert.equal(run(planning, 'undoSessionDeletion()'), '');
assert.equal(run(planning, 'deadline'), plannedDeadline);
assert.equal(run(planning, 'etaMode'), 'average');
assert.equal(createApp(planningStorage).node('deadline').value, run(planning, `localDateTime(${plannedDeadline})`));
const restoredPlanningTab = createApp(planningStorage);
restoredPlanningTab.node('eta-mode').value = 'recent'; restoredPlanningTab.node('eta-mode').handlers.change();
planning.render();
assert.equal(run(planning, 'etaMode'), 'recent', 'Undo keeps subsequent cross-tab planning changes in sync');
run(planning, 'restartSession("planning")');
assert.equal(run(planning, 'deadline'), null, 'Restart keeps the old deadline on the archived session only');
assert.equal(run(planning, 'completedAt'), null);
assert.equal(JSON.parse(planningStorage.getItem('pace-sessions')).sessions.find(saved => saved.id === 'planning').deadline, plannedDeadline);

const planningQuotaStorage = memoryStorage({
  'pace-session': JSON.stringify(planningRecord),
  'pace-sessions': JSON.stringify({version: 1, sessions: [planningRecord]}),
});
let failPlanningSnapshot = false;
const planningQuota = {...planningQuotaStorage, setItem(key, value) {
  if (failPlanningSnapshot && key === 'pace-session') throw Error('Quota exceeded');
  planningQuotaStorage.setItem(key, value);
}};
const quotaPlanningApp = createApp(planningQuota);
failPlanningSnapshot = true;
wall += 1000;
quotaPlanningApp.node('deadline').value = run(quotaPlanningApp, `localDateTime(${plannedDeadline})`);
quotaPlanningApp.node('deadline').handlers.change();
assert.equal(createApp(planningQuota).node('deadline').value, run(quotaPlanningApp, `localDateTime(${plannedDeadline})`), 'A stale active snapshot cannot overwrite a deadline already saved in history');

const finishStorage = memoryStorage();
const finishApp = createApp(finishStorage);
run(finishApp, `startSession({goal:1, unit:'tasks', activity:'Deadline check', deadline:${wall + 10000}})`);
now += 1000; wall += 1000; finishApp.click('done');
const recordedFinish = run(finishApp, 'completedAt');
assert.equal(finishApp.node('deadline-status').textContent, 'Met deadline');
wall += 60000; finishApp.render();
assert.equal(run(finishApp, 'completedAt'), recordedFinish);
assert.equal(finishApp.node('deadline-status').textContent, 'Met deadline', 'A met deadline stays met after its wall-clock deadline passes');
const finishId = run(finishApp, 'sessionId');
assert.equal(run(finishApp, `updateSavedSession(${JSON.stringify(finishId)}, {activity:'Corrected', unit:'tasks', goal:1, times:[1000], current:0})`), '');
assert.equal(run(finishApp, 'completedAt'), recordedFinish, 'Editing a completed session preserves its recorded completion time');
finishApp.click('undo');
assert.equal(run(finishApp, 'completedAt'), null);
finishApp.click('pause'); finishApp.click('done');
assert.equal(finishApp.node('deadline-status').textContent, 'Finished late');

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
  console.log('Pace checks passed: deadlines, recent-pace ETA/trends, history search/filter/sort, bulk deletion/undo/rollback/stale tabs, session CRUD, backups, presets, notes, settings, charts, and wake-lock lifecycle.');
}).catch(error => { console.error(error); process.exitCode = 1; });
