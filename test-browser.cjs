// Run with: node test-browser.cjs (Chrome/Chromium; no npm dependencies).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-test-'));
  const files = {'': 'text/html', 'index.html': 'text/html', 'sw.js': 'text/javascript',
    'manifest.webmanifest': 'application/manifest+json', 'icon.svg': 'image/svg+xml',
    'icon-192.png': 'image/png', 'icon-512.png': 'image/png'};
  let workerRevision = 0;
  const previousRef = process.env.PACE_PREVIOUS_REF;
  const previous = new Map();
  if (previousRef && !/^0+$/.test(previousRef)) {
    for (const file of ['index.html', 'sw.js']) {
      previous.set(file, execFileSync('git', ['show', `${previousRef}:${file}`], {cwd: __dirname}));
    }
  }
  let servePrevious = previous.size > 0;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const filename = pathname.startsWith('/pace/') ? pathname.slice(6) : null;
    if (filename === null || !Object.hasOwn(files, filename)) { response.writeHead(404).end(); return; }
    response.writeHead(200, {'Content-Type': files[filename], 'Cache-Control': 'no-store'});
    const file = filename || 'index.html';
    let body = servePrevious && previous.has(file) ? previous.get(file) : fs.readFileSync(path.join(__dirname, file));
    if (filename === 'sw.js') body = `${body}\n// Test worker revision: ${workerRevision}\n`;
    response.end(body);
  });
  let browser;
  let socket;
  const watchdog = setTimeout(() => { console.error('Browser checks timed out.'); browser?.kill(); process.exit(1); }, 60000);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/pace/`;
    browser = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless', '--no-sandbox',
      '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      browser.on('error', reject);
      browser.stderr.on('data', chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]);
      });
      browser.once('exit', code => reject(new Error(`Browser exited early (${code}): ${output}`)));
    });
    const targets = await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, {once: true}));
    const pending = new Map();
    const events = new Map();
    const errors = [];
    let serial = 0;
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.exceptionThrown') errors.push(data.params);
      if (events.has(data.method)) { events.get(data.method)(); events.delete(data.method); }
      if (pending.has(data.id)) {
        const {resolve, reject} = pending.get(data.id);
        pending.delete(data.id);
        data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, {resolve, reject});
      socket.send(JSON.stringify({id, method, params}));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${expression}`);
    };
    const load = async (method, params = {}) => {
      const loaded = new Promise(resolve => events.set('Page.loadEventFired', resolve));
      await send(method, params);
      await loaded;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await load('Page.navigate', {url});
    await waitFor('!!navigator.serviceWorker.controller');
    assert.deepEqual((await send('Page.getInstallabilityErrors')).installabilityErrors, []);

    // Upgrade a real v1 running snapshot, then refresh without pausing or resetting it.
    await evaluate(`localStorage.setItem('pace-theme', 'frappe');
      localStorage.setItem('pace-session', JSON.stringify({version:1,state:'running',goal:3,
      unit:'questions',activity:'Existing session',checkpoints:[0,60000],elapsed:90000,savedAt:Date.now()-15000}));`);
    await load('Page.reload');
    const beforeUpdate = await evaluate('({state, time:elapsed(), progress:checkpoints.length})');
    assert.equal(beforeUpdate.state, 'running');
    assert.equal(beforeUpdate.progress, 2);
    assert.ok(beforeUpdate.time >= 105000 && beforeUpdate.time < 120000);

    // Installing an updated worker must not reload or interrupt an open timer.
    await evaluate('window.testLoadMarker = "unchanged"');
    servePrevious = false;
    workerRevision++;
    await evaluate('navigator.serviceWorker.getRegistration().then(registration => registration.update())');
    await waitFor('navigator.serviceWorker.getRegistration().then(registration => !!registration.waiting)');
    assert.equal(await evaluate('window.testLoadMarker'), 'unchanged');
    assert.equal(await evaluate('state'), 'running');
    await load('Page.reload');
    const upgraded = await evaluate(`({state, id:sessionId, time:elapsed(), progress:checkpoints.length,
      count:sessions.length, theme:document.documentElement.dataset.theme})`);
    assert.equal(upgraded.state, 'running');
    assert.equal(upgraded.progress, 2);
    assert.equal(upgraded.count, 1);
    assert.equal(upgraded.theme, 'frappe');
    assert.ok(upgraded.time >= beforeUpdate.time);
    await load('Page.reload');
    assert.equal(await evaluate('state'), 'running');
    assert.equal(await evaluate('sessionId'), upgraded.id);
    assert.equal(await evaluate('sessions.length'), 1);
    assert.ok(await evaluate('elapsed()') >= upgraded.time);

    const result = await evaluate(`(() => {
      const get = id => document.getElementById(id);
      get('history').open = true; renderHistory(true);
      const review = get('history-list').querySelector('button[data-action="edit"]');
      review.focus(); render();
      if (document.activeElement !== review || !review.isConnected) throw Error('Clock ticks must preserve history focus');
      get('history-list').querySelector('button[data-action="edit"]').click();
      if (state !== 'paused' || !get('session-editor').open) throw Error('Review pauses the current session');
      get('edit-activity').value = 'Geometry'; get('edit-unit').value = 'exercises'; get('edit-goal').value = '3';
      get('unit-times').querySelector('input').value = '45'; get('edit-current').value = '15';
      get('edit-form').requestSubmit();
      if (get('session-editor').open || get('total').textContent !== '00:01:00') throw Error('Editor save');
      if (get('last').textContent !== '00:00:45' || get('current').textContent !== '00:00:15') throw Error('Edited statistics');
      get('history-list').querySelector('button[data-action="edit"]').click();
      get('edit-goal').value = '0'; get('edit-form').requestSubmit();
      if (!get('session-editor').open) throw Error('Goal validation');
      get('edit-goal').value = '3'; get('add-unit').click(); get('remove-unit').click();
      if (get('unit-times').children.length !== 1) throw Error('Unit count editing');
      get('cancel-edit').dispatchEvent(new KeyboardEvent('keydown', {key:'t',bubbles:true}));
      if (state !== 'paused') throw Error('Shortcuts must not run behind a dialog');
      get('cancel-edit').click();
      const original = sessionId;
      get('history-list').querySelector('button[data-action="restart"]').click();
      if (sessionId === original || sessions.length !== 2) throw Error('Restart preserves original');
      get('done').click();
      if (get('sparkles').childElementCount !== 18) throw Error('Unit sparkles');
      get('done').click(); get('done').click();
      if (get('sparkles').childElementCount !== 100) throw Error('Completion sparkles');
      if (localStorage.getItem('pace-session') !== null || !sessions.some(item => item.state === 'complete')) throw Error('Completion archive');
      [...get('history-list').querySelectorAll('button[data-action="resume"]')].find(button => button.dataset.id === original).click();
      get('pause').click();
      return get('progress-text').textContent;
    })()`);
    assert.equal(result, '1 of 3 exercises finished');
    await waitFor('document.getElementById("sparkles").childElementCount === 0');
    await send('Emulation.setEmulatedMedia', {features: [{name:'prefers-reduced-motion', value:'reduce'}]});
    await evaluate('celebrate(true)');
    assert.equal(await evaluate('document.getElementById("sparkles").childElementCount'), 0);
    await send('Emulation.setEmulatedMedia', {features: []});

    const originalId = await evaluate('sessionId');
    await evaluate(`(() => {
      const get = id => document.getElementById(id);
      get('options').open = true;
      document.querySelector('.extras').open = true;
      get('notes').value = 'Resume at exercise 2.\\n<strong>Literal note</strong>';
      get('notes').dispatchEvent(new Event('input'));
      if (state !== 'paused') throw Error('Notes must not change timer state');
      editSession(sessionId);
      if (!get('pace-chart').querySelector('polyline') || !get('chart-summary').textContent.includes('1 unit')) throw Error('Pace chart');
      get('edit-notes').value += ' Edited';
      get('edit-form').requestSubmit();
      if (!get('notes').value.endsWith('Edited')) throw Error('Note editing');
      if (get('history-list').querySelector('.saved-note strong')) throw Error('Notes must be plain text');
      get('save-preset').click(); get('save-preset').click();
      if (presets.length !== 1) throw Error('Preset deduplication');
      const previous = sessionId;
      get('start-preset').click();
      if (sessionId === previous || checkpoints.length !== 1 || get('notes').value !== '') throw Error('Start preset');
      get('pause').click(); resumeSession(previous); get('pause').click();
      for (const id of ['show-quotes', 'show-sparkles']) {
        get(id).checked = false; get(id).dispatchEvent(new Event('change'));
      }
      const quote = get('quote').textContent; rotateQuote();
      if (!get('quote').hidden || get('quote').textContent !== quote) throw Error('Quote setting');
      celebrate(true);
      if (get('sparkles').childElementCount !== 0) throw Error('Sparkle setting');
    })()`);
    const downloads = path.join(profile, 'downloads');
    fs.mkdirSync(downloads);
    await send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: downloads});
    await evaluate('document.getElementById("export-backup").click()');
    let backupPath;
    for (let attempt = 0; attempt < 100 && !backupPath; attempt++) {
      const name = fs.readdirSync(downloads).find(file => file.endsWith('.json'));
      if (name) backupPath = path.join(downloads, name);
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(backupPath, 'Backup downloads as a JSON file');
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.app, 'pace');
    assert.equal(backup.presets.length, 1);
    assert.ok(backup.sessions.some(saved => saved.notes.includes('<strong>Literal note</strong> Edited')));
    await load('Page.reload');
    assert.equal(await evaluate('sessionId'), originalId);
    assert.equal(await evaluate('document.getElementById("quote").hidden'), true);
    assert.equal(await evaluate('document.getElementById("show-sparkles").checked'), false);
    assert.equal(await evaluate('document.getElementById("notes").value.endsWith("Edited")'), true);
    await evaluate(`(() => {
      document.getElementById('options').open = true;
      document.querySelector('.extras').open = true;
      const originalConfirm = window.confirm; window.confirm = () => true;
      document.getElementById('preset').value = presets[0].id;
      document.getElementById('preset').dispatchEvent(new Event('change'));
      document.getElementById('remove-preset').click(); window.confirm = originalConfirm;
    })()`);
    assert.equal(await evaluate('presets.length'), 0);
    const upload = async contents => evaluate(`(() => {
      const files = new DataTransfer();
      files.items.add(new File([${JSON.stringify(contents)}], 'backup.json', {type:'application/json'}));
      const input = document.getElementById('backup-file'); input.files = files.files; input.dispatchEvent(new Event('change'));
    })()`);
    await upload('not json');
    await waitFor('document.getElementById("backup-status").textContent === "Invalid JSON backup."');
    await upload(JSON.stringify(backup));
    await waitFor('document.getElementById("backup-status").textContent.includes("Imported 0 sessions and 1 preset.")');
    await upload(JSON.stringify(backup));
    await waitFor('document.getElementById("backup-status").textContent.includes("Imported 0 sessions and 0 presets")');
    assert.equal(await evaluate('sessionId'), originalId);
    assert.equal(await evaluate('state'), 'paused');

    // Exercise the browser event wiring with a deterministic wake-lock sentinel.
    await evaluate(`(() => {
      window.originalWakeDescriptor = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
      window.testWakeRequests = 0;
      Object.defineProperty(navigator, 'wakeLock', {configurable:true,value:{async request() {
        window.testWakeRequests++;
        window.testWakeSentinel = {released:false,addEventListener(){},async release(){this.released=true;}};
        return window.testWakeSentinel;
      }}});
      applySettings();
      const toggle = document.getElementById('keep-awake'); toggle.checked = true; toggle.dispatchEvent(new Event('change'));
      document.getElementById('pause').click();
    })()`);
    await waitFor('screenLock !== null');
    assert.equal(await evaluate('window.testWakeRequests'), 1);
    await evaluate('document.getElementById("pause").click()');
    await waitFor('window.testWakeSentinel.released');
    await evaluate(`(() => {
      const toggle = document.getElementById('keep-awake'); toggle.checked = false; toggle.dispatchEvent(new Event('change'));
      if (window.originalWakeDescriptor) Object.defineProperty(navigator, 'wakeLock', window.originalWakeDescriptor);
      else delete navigator.wakeLock;
      document.getElementById('show-quotes').checked = true;
      document.getElementById('show-quotes').dispatchEvent(new Event('change'));
    })()`);

    for (const [width, height] of [[320,640], [360,800], [412,915], [915,412]]) {
      await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:true});
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
      await evaluate('editSession(sessionId)');
      assert.equal(await evaluate('document.getElementById("session-editor").scrollWidth <= document.getElementById("session-editor").clientWidth'), true);
      await evaluate('document.getElementById("session-editor").close()');
    }
    const savedCount = await evaluate('sessions.length');
    await send('Network.emulateNetworkConditions', {offline:true, latency:0, downloadThroughput:-1, uploadThroughput:-1});
    await load('Page.reload');
    assert.equal(await evaluate('state'), 'paused');
    assert.equal(await evaluate('sessions.length'), savedCount);
    assert.equal(await evaluate('document.getElementById("progress-text").textContent'), '1 of 3 exercises finished');
    assert.equal(await evaluate(`fetch('./icon-192.png').then(response => response.ok)`), true);
    assert.equal(await evaluate('document.getElementById("notes").value.endsWith("Edited")'), true);
    assert.equal(await evaluate('presets.length'), 1);
    const offlineImport = await evaluate('importBackup(JSON.stringify(createBackup()))');
    assert.equal(offlineImport.sessions, 0, 'Backup round trips work offline without duplication');
    assert.equal(offlineImport.presets, 0);
    assert.equal(await evaluate(`(() => {const before = el('quote').textContent; rotateQuote(); return el('quote').textContent !== before;})()`), true);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: uninterrupted upgrades, backups/download/import, presets, notes/chart, settings, wake lock, mobile layouts, and offline use.');
  } finally {
    clearTimeout(watchdog);
    if (socket) socket.close();
    if (browser && browser.exitCode === null) {
      browser.kill();
      await new Promise(resolve => browser.once('exit', resolve));
    }
    server.closeAllConnections();
    server.close();
    fs.rmSync(profile, {recursive:true, force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
