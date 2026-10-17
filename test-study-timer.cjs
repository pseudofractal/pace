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
function createApp(localStorage = storage) {
  const nodes = new Map();
  const listeners = {};
  const timers = new Map();
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    nodes.set(id, {
      textContent: '', value: ({ goal: '20', unit: 'units' })[id] || '', disabled: false,
      firstChild: { nodeValue: '' }, validity: { valid: true }, handlers: {},
      reportValidity() { return this.validity.valid; },
      addEventListener(name, callback) { this.handlers[name] = callback; },
      click() { if (!this.disabled) this.handlers.click(); },
    });
  }
  const context = vm.createContext({
    document: {
      documentElement: { dataset: {} },
      querySelector: () => ({ content: '' }),
      getElementById: id => nodes.get(id),
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
    window: {
      addEventListener: (name, callback) => { listeners[name] = callback; },
      matchMedia: () => ({ matches: true }),
    },
    navigator: {}, location: { protocol: 'file:' },
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
console.log('Pace checks passed: timing, Android sleep, quotes, controls, themes, persistence, completion cleanup.');
