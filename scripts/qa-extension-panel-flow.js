'use strict';

// Actual panel HTML/CSS/JavaScript in an isolated Chromium profile. All Chrome
// APIs are local fixtures: no user profile, ChatGPT page, or network is accessed.
const { ipcRenderer } = require('electron');

if (process.type === 'renderer') {
  const listeners = new Set();
  const fixtureChrome = {
    runtime: {
      id: 'converge-offline-panel-qa',
      sendMessage: (message) => ipcRenderer.invoke('panel-qa:runtime', message)
    },
    windows: {
      getCurrent: () => Promise.resolve({ id: 101 }),
      update: (id, properties) => ipcRenderer.invoke('panel-qa:window', { id, properties })
    },
    tabs: {
      get: (id) => Promise.resolve({ id, windowId: id === 11 ? 101 : 102 }),
      update: (id, properties) => ipcRenderer.invoke('panel-qa:tab', { id, properties }),
      sendMessage: () => Promise.resolve({ ok: true, diagnostics: { composerFound: true } })
    },
    storage: {
      session: {
        get: (keys) => ipcRenderer.invoke('panel-qa:get', keys),
        set: (values) => ipcRenderer.invoke('panel-qa:set', values)
      },
      onChanged: { addListener(listener) { listeners.add(listener); } }
    }
  };
  Object.defineProperty(window, 'chrome', { configurable: true, value: fixtureChrome });
  ipcRenderer.on('panel-qa:changed', (_event, changes) => {
    for (const listener of listeners) listener(changes, 'session');
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { app, BrowserWindow, ipcMain, session } = require('electron');
  const extensionRoot = path.resolve(__dirname, '..', 'chrome-extension');
  const profileRoot = require('node:fs').mkdtempSync(path.join(app.getPath('temp'), 'converge-panel-qa-'));
  app.setPath('userData', profileRoot);
  const windows = [];
  const failures = [];
  const calls = [];
  let releaseStart;
  const stored = { convergeState: { status: 'idle', tabIds: { left: null, right: null }, pages: {} } };
  const clone = (value) => structuredClone(value);

  function publish(values) {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      changes[key] = { oldValue: clone(stored[key]), newValue: clone(value) };
      stored[key] = clone(value);
    }
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('panel-qa:changed', changes);
    }
  }

  ipcMain.handle('panel-qa:get', (_event, keys) => Object.fromEntries(keys.map((key) => [key, clone(stored[key])])));
  ipcMain.handle('panel-qa:set', (_event, values) => { publish(values); return undefined; });
  ipcMain.handle('panel-qa:window', (_event, value) => { calls.push({ type: 'WINDOW_UPDATE', ...value }); return value; });
  ipcMain.handle('panel-qa:tab', (_event, value) => {
    calls.push({ type: 'TAB_UPDATE', ...value });
    return { id: value.id, windowId: value.id === 11 ? 101 : 102 };
  });
  ipcMain.handle('panel-qa:runtime', async (_event, message) => {
    calls.push(clone(message));
    if (message.type === 'OPEN_LAYOUT') {
      publish({ convergeState: {
        status: 'setup', stage: 'Chat composers ready; confirm privacy modes',
        tabIds: { left: 11, right: 12 },
        pages: {
          left: { ready: true, authenticated: true, temporary: null, unpersonalized: null },
          right: { ready: true, authenticated: true, temporary: null, unpersonalized: null }
        },
        layout: { left: 0, top: 0, width: 1366, height: 768, leftWidth: 819 },
        transcript: [], candidate: ''
      } });
    } else if (message.type === 'START') {
      publish({ convergeState: {
        ...stored.convergeState, status: 'running', stage: 'Sending the first question',
        question: message.question, protocol: message.protocol,
        maxRounds: message.maxRounds, relayMedia: message.relayMedia,
        candidate: 'A fixture best answer', round: 1,
        transcript: [{ side: 'left', role: 'draft', text: 'A fixture draft' }]
      } });
      // A real send can await a page while running state is already visible.
      await new Promise((resolve) => { releaseStart = resolve; });
    } else if (message.type === 'STOP') {
      publish({ convergeState: { ...stored.convergeState, status: 'stopped', stage: 'Stopped' } });
    }
    return { ok: true, state: clone(stored.convergeState) };
  });

  async function makePanel(fixtureSession, extensionId, localPreview = false) {
    const win = new BrowserWindow({ show: false, width: 420, height: 900,
      webPreferences: {
        session: fixtureSession, offscreen: true, contextIsolation: false, nodeIntegration: false,
        preload: __filename, backgroundThrottling: false
      } });
    windows.push(win);
    if (localPreview) await win.loadFile(path.join(extensionRoot, 'panel.html'));
    else await win.loadURL(`chrome-extension://${extensionId}/panel.html`);
    return win;
  }

  const evaluate = (win, source) => win.webContents.executeJavaScript(source, true);
  async function waitFor(win, predicate, timeout = 3000) {
    await evaluate(win, `new Promise((resolve,reject)=>{const started=Date.now();const check=()=>{
      if(${predicate})return resolve();if(Date.now()-started>${timeout})return reject(Error('Timed out waiting for '+${JSON.stringify(predicate)}));
      setTimeout(check,20)};check()})`);
  }
  async function check(name, callback) {
    try { await callback(); process.stdout.write(`PASS: ${name}\n`); }
    catch (error) { failures.push({ name, error }); process.stderr.write(`FAIL: ${name}: ${error.message}\n`); }
  }

  async function run() {
    const fixtureSession = session.fromPartition('persist:converge-panel-offline-qa');
    fixtureSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(?:chrome-extension:|file:|data:|about:|devtools:)/.test(details.url) });
    });
    // Load a minimal fixture extension so Chromium supplies its genuine extension
    // origin. The app's worker and ChatGPT content script are deliberately absent.
    const fixtureRoot = path.join(profileRoot, 'extension-fixture');
    await fs.mkdir(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Converge offline panel fixture', version: '1.0.0'
    }));
    for (const name of ['panel.html', 'panel.css', 'panel.js']) {
      await fs.copyFile(path.join(extensionRoot, name), path.join(fixtureRoot, name));
    }
    const extension = await fixtureSession.extensions.loadExtension(fixtureRoot);
    try {
      const left = await makePanel(fixtureSession, extension.id);
      const right = await makePanel(fixtureSession, extension.id);
      await waitFor(left, `document.getElementById('footerStatus').textContent==='IDLE'`);
      await check('local file preview guard remains active even with mocked APIs', async () => {
        const preview = await makePanel(fixtureSession, extension.id, true);
        assert.equal(await evaluate(preview, `!document.getElementById('installWarning').hidden&&document.getElementById('openLayout').disabled`), true);
        preview.destroy();
      });
      await check('setup starts disabled and opens both pages through the rendered button', async () => {
        assert.equal(await evaluate(left, `document.getElementById('start').disabled`), true);
        await evaluate(left, `document.getElementById('openLayout').click()`);
        await waitFor(left, `document.getElementById('footerStatus').textContent==='SETUP'&&!document.getElementById('start').disabled`);
        assert.equal(calls.filter((call) => call.type === 'OPEN_LAYOUT').length, 1);
        assert.equal(calls.find((call) => call.type === 'OPEN_LAYOUT').windowId, 101);
        assert.equal(await evaluate(left, `document.getElementById('confirmLeft').checked`), false);
      });
      await check('question, review direction, and round count sync to a second panel', async () => {
        await evaluate(left, `for(const [id,value]of [['question','Review this offline example'],['protocol','Verify every calculation'],['maxRounds','8']]){
          const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}`);
        await waitFor(right, `document.getElementById('question').value==='Review this offline example'&&document.getElementById('maxRounds').value==='8'`);
        assert.equal(await evaluate(right, `document.getElementById('protocol').value`), 'Verify every calculation');
      });
      await check('generated output sharing defaults on and syncs across panels', async () => {
        assert.equal(await evaluate(left, `document.getElementById('relayMedia').checked`), true);
        await evaluate(left, `{const el=document.getElementById('relayMedia');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}))}`);
        await waitFor(right, `document.getElementById('relayMedia').checked===false`);
        await evaluate(left, `{const el=document.getElementById('relayMedia');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}`);
        await waitFor(right, `document.getElementById('relayMedia').checked===true`);
      });
      await check('missing privacy confirmations explain the problem and send no START', async () => {
        await evaluate(left, `document.getElementById('start').click()`);
        await waitFor(left, `document.getElementById('statusDetail').textContent.includes('Confirm Temporary')`);
        assert.equal(calls.some((call) => call.type === 'START'), false);
        assert.equal(await evaluate(left, `document.getElementById('privacyHint').classList.contains('alert')`), true);
      });
      await check('confirmed setup submits the same question and settings', async () => {
        await evaluate(left, `for(const id of ['confirmLeft','confirmRight']){const el=document.getElementById(id);el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}
          document.getElementById('start').click()`);
        await waitFor(left, `!document.getElementById('stop').hidden`);
        const start = calls.find((call) => call.type === 'START');
        assert.equal(start.question, 'Review this offline example');
        assert.equal(start.protocol, 'Verify every calculation');
        assert.equal(start.maxRounds, 8);
        assert.equal(start.confirmTemporary, true);
        assert.equal(start.relayMedia, true);
        assert.equal(await evaluate(left, `document.getElementById('relayMedia').disabled`), true);
      });
      await check('running question and controls stay locked to actual run settings', async () => {
        publish({ convergeDraft: { question: 'A changed idle draft', protocol: 'Different draft direction', maxRounds: 1, relayMedia: false } });
        assert.equal(await evaluate(left, `['question','protocol','maxRounds','roundMinus','roundPlus'].every(id=>document.getElementById(id).disabled)`), true);
        assert.equal(await evaluate(right, `document.getElementById('question').value`), 'Review this offline example');
        assert.equal(await evaluate(right, `document.getElementById('maxRounds').value`), '8');
        assert.equal(await evaluate(right, `document.getElementById('relayMedia').checked`), true);
      });
      await check('Stop remains usable while the initial START request is still pending', async () => {
        assert.equal(await evaluate(left, `document.getElementById('stop').disabled`), false,
          'A published running state must permit immediate Stop even before START returns');
        await evaluate(left, `document.getElementById('stop').click()`);
        await waitFor(left, `document.getElementById('footerStatus').textContent==='STOPPED'`);
        assert.equal(calls.filter((call) => call.type === 'STOP').length, 1);
        assert.equal(await evaluate(left, `document.getElementById('answer').textContent`), 'A fixture best answer');
      });
      releaseStart?.();
      await check('output names render as text and View opens the original output tab', async () => {
        const outputName = '<img src=x onerror="window.qaUnexpectedOutputHTML=true">.png';
        publish({ convergeState: { ...stored.convergeState, status: 'agreed', answer: '',
          candidate: { id: 'C2', text: 'An improved generated answer', media: {
            side: 'right', files: [{ name: outputName }]
          } }
        } });
        await waitFor(left, `!document.getElementById('viewOutput').hidden&&!document.getElementById('openLayout').disabled`);
        assert.equal(await evaluate(left, `document.getElementById('answerOutputs').querySelector('img')===null&&!window.qaUnexpectedOutputHTML`), true);
        assert.match(await evaluate(left, `document.getElementById('answerOutputs').textContent`), /Outputs in chat B: <img src=x/);
        await evaluate(left, `document.getElementById('viewOutput').click()`);
        await waitFor(left, `!document.getElementById('openLayout').disabled`);
        assert.deepEqual(calls.find((call) => call.type === 'TAB_UPDATE'), {
          type: 'TAB_UPDATE', id: 12, properties: { active: true }
        });
        assert.deepEqual(calls.find((call) => call.type === 'WINDOW_UPDATE'), {
          type: 'WINDOW_UPDATE', id: 102, properties: { focused: true }
        });
      });
      await check('known disabled privacy mode revokes confirmation and explains next step', async () => {
        publish({ convergeState: { ...stored.convergeState, status: 'setup',
          pages: { ...stored.convergeState.pages, left: { ready: true, temporary: false, unpersonalized: false } } } });
        await waitFor(left, `document.getElementById('confirmLeft').disabled&&!document.getElementById('confirmLeft').checked`);
        assert.match(await evaluate(left, `document.getElementById('privacyHint').textContent`), /reports that Temporary or Unpersonalized is off/);
      });
      await check('uncertain file uploads prevent starting or attaching duplicate files', async () => {
        for (const status of ['failed', 'partial']) {
          publish({ convergeState: { ...stored.convergeState, status: 'setup',
            attachments: { status, names: ['source.png'], error: 'The preview was not confirmed.' } } });
          await waitFor(left, `document.getElementById('start').disabled&&document.getElementById('chooseFiles').disabled`);
          assert.match(await evaluate(left, `document.getElementById('fileStatus').textContent`), /preview was not confirmed/);
        }
      });
      await check('script treats transcript text as text instead of HTML', async () => {
        publish({ convergeState: { ...stored.convergeState, transcript: [
          { side: 'right', role: 'review', text: '<img src=x onerror="window.qaUnexpectedHTML=true">' }
        ] } });
        await waitFor(left, `document.getElementById('transcript').textContent.includes('<img src=x')`);
        assert.equal(await evaluate(left, `document.getElementById('transcript').querySelector('img')===null&&!window.qaUnexpectedHTML`), true);
      });
      await check('rendered controls fit a narrow 320 px Chrome side panel', async () => {
        left.setContentSize(320, 768);
        await waitFor(left, `window.innerWidth===320`);
        const dimensions = await evaluate(left, `({viewport:innerWidth,document:document.documentElement.scrollWidth})`);
        assert.equal(dimensions.document <= dimensions.viewport, true,
          `Panel overflowed its viewport: ${JSON.stringify(dimensions)}`);
      });
      if (failures.length) throw new Error(`${failures.length} panel workflow check(s) failed.`);
      process.stdout.write('PASS: complete offline rendered panel workflow.\n');
    } finally {
      releaseStart?.();
      for (const win of windows) if (!win.isDestroyed()) win.destroy();
    }
  }

  app.whenReady().then(run).then(() => app.quit(), (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
}
