'use strict';

// End-to-end offline Chromium check of the actual panel, coordinator, and page
// bridge. The only fake component is the local model page responding with a
// deterministic draft/challenge/accept sequence. No live browser profile or
// ChatGPT URL is loaded, and all network requests are blocked.
const { ipcRenderer } = require('electron');

if (process.type === 'renderer') {
  const pageId = () => window.location.pathname.endsWith('/chat-left.html') ? 11
    : window.location.pathname.endsWith('/chat-right.html') ? 12 : null;
  const listeners = new Set();
  const fixtureChrome = {
    runtime: {
      id: 'converge-offline-pipeline-qa',
      sendMessage: (message) => ipcRenderer.invoke('pipeline-qa:runtime', { message, pageId: pageId() }),
      onMessage: { addListener(listener) { window.__qaPageListener = listener; } }
    },
    windows: {
      getCurrent: () => Promise.resolve({ id: 101 }),
      update: (id, properties) => ipcRenderer.invoke('pipeline-qa:window', { id, properties })
    },
    tabs: {
      get: (id) => Promise.resolve({ id, windowId: id === 11 ? 101 : 102 }),
      update: (id) => Promise.resolve({ id, windowId: id === 11 ? 101 : 102 }),
      sendMessage: (id, message) => ipcRenderer.invoke('pipeline-qa:page', { id, message })
    },
    storage: {
      session: {
        get: (keys) => ipcRenderer.invoke('pipeline-qa:get', keys),
        set: (values) => ipcRenderer.invoke('pipeline-qa:set', values)
      },
      onChanged: { addListener(listener) { listeners.add(listener); } }
    }
  };
  Object.defineProperty(window, 'chrome', { configurable: true, value: fixtureChrome });
  ipcRenderer.on('pipeline-qa:changed', (_event, changes) => {
    for (const listener of listeners) listener(changes, 'session');
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { app, BrowserWindow, ipcMain, session } = require('electron');
  const extensionRoot = path.resolve(__dirname, '..', 'chrome-extension');
  const profileRoot = require('node:fs').mkdtempSync(path.join(app.getPath('temp'), 'converge-pipeline-qa-'));
  app.setPath('userData', profileRoot);
  const fixtureRoot = path.join(profileRoot, 'extension-fixture');
  const browserWindows = [];
  const pages = new Map();
  const stored = {};
  const pageCalls = [];
  const runtimeCalls = [];
  const stateHistory = [];
  const clone = (value) => structuredClone(value);
  let backgroundMessage;
  let fixtureSession;
  let extensionId;

  function publish(values) {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      changes[key] = { oldValue: clone(stored[key]), newValue: clone(value) };
      stored[key] = clone(value);
    }
    if (values.convergeState) stateHistory.push(clone(values.convergeState));
    for (const win of browserWindows) {
      if (!win.isDestroyed()) win.webContents.send('pipeline-qa:changed', changes);
    }
  }

  async function sendRuntime(message, pageId) {
    runtimeCalls.push({ message: clone(message), pageId });
    return new Promise((resolve) => backgroundMessage(message,
      pageId ? { tab: { id: pageId, url: 'https://chatgpt.com/' } } : {}, resolve));
  }
  async function sendPage(id, message) {
    pageCalls.push({ id, message: clone(message) });
    const page = pages.get(id);
    if (!page || page.isDestroyed()) throw new Error('The fixture page is unavailable.');
    return page.webContents.executeJavaScript(`new Promise(resolve=>window.__qaPageListener(${JSON.stringify(message)}, {}, resolve))`, true);
  }

  ipcMain.handle('pipeline-qa:get', (_event, keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.map((key) => [key, clone(stored[key])]));
  });
  ipcMain.handle('pipeline-qa:set', (_event, values) => { publish(values); });
  ipcMain.handle('pipeline-qa:runtime', (_event, { message, pageId }) => sendRuntime(message, pageId));
  ipcMain.handle('pipeline-qa:page', (_event, { id, message }) => sendPage(id, message));
  ipcMain.handle('pipeline-qa:window', (_event, value) => value);

  const fixturePage = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:24px;font:14px Segoe UI,sans-serif;background:#101923;color:#eee}
    header{display:flex;gap:18px}header h1,header h2{font-size:14px}
    #turns{padding-bottom:220px}#turns>[data-message-author-role]{padding:15px;border-bottom:1px solid #35495e;white-space:pre-wrap;overflow-wrap:anywhere}
    form{position:fixed;bottom:15px;left:15px;right:15px;background:#182839;border:1px solid #536b81;padding:12px}
    [contenteditable]{min-height:40px;max-height:70px;overflow:auto;padding:8px;outline:1px solid #6d8193}
    #previews img{width:80px;height:80px}#turns img{width:128px;height:128px}
  </style><script defer src="fixture-page.js"></script><script defer src="content.js"></script></head>
  <body><header><h1>Temporary Chat</h1><h2>Unpersonalized</h2></header><div id="turns"></div>
  <form><div role="textbox" data-placeholder="Ask anything" contenteditable="true"></div>
  <input id="fileInput" type="file" multiple><div id="previews"></div>
  <button type="button" data-testid="send-button" id="send" hidden>Send</button>
  <button type="button" data-testid="stop-button" id="stopFixture" hidden>Stop</button></form></body></html>`;

  const fixtureBehavior = `(() => {
    const side=location.pathname.includes('left')?'left':'right';
    const editor=document.querySelector('[contenteditable]'),send=document.getElementById('send');
    const picker=document.getElementById('fileInput'),previews=document.getElementById('previews'),stop=document.getElementById('stopFixture');
    window.fixtureSends=[];window.fixtureUploads=[];
    editor.addEventListener('input',()=>{send.hidden=!editor.innerText.trim()});
    picker.addEventListener('change',()=>{
      window.fixtureUploads.push(Array.from(picker.files).map(file=>({name:file.name,type:file.type,size:file.size})));
      previews.replaceChildren();for(const file of picker.files){if(file.type.startsWith('image/')){
        const image=document.createElement('img');image.alt='Attached preview';image.src=URL.createObjectURL(file);previews.append(image)
      }else{const chip=document.createElement('span');chip.textContent=file.name;previews.append(chip)}}
    });
    const picture=(color)=>{const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
      const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,128,128);
      const img=document.createElement('img');img.alt='Generated fixture picture';img.src=canvas.toDataURL('image/png');return img};
    const documentLink=(color)=>{const link=document.createElement('a');link.download='review-notes.txt';link.textContent='review-notes.txt';
      link.href=URL.createObjectURL(new Blob(['Fixture image evidence: '+color],{type:'text/plain'}));return link};
    send.addEventListener('click',()=>{
      const text=editor.innerText.trim(),attachments=Array.from(picker.files).map(file=>({name:file.name,type:file.type,size:file.size}));
      window.fixtureSends.push({text,attachments});
      const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=text;document.getElementById('turns').append(user);
      editor.innerText='';send.hidden=true;stop.hidden=false;picker.value='';previews.replaceChildren();
      setTimeout(()=>{
        const assistant=document.createElement('div');assistant.setAttribute('data-message-author-role','assistant');
        let reply,color;
        if(text.includes('Phase: independent draft')){
          reply={answer:side==='left'?'Initial answer with generated image':'Independent right draft',uncertainties:[]};color=side==='left'?'#bb3333':'#3333bb';
        }else{
          const candidate=text.match(/Current candidate ID: (C\\d+)/)?.[1];
          reply={candidateId:candidate,verdict:'accept',issues:[],revisedAnswer:'',resolvedIssueIds:[],uncertainties:[]};
          if(side==='right'&&candidate==='C1'){
            reply.verdict='challenge';reply.issues=[{severity:'major',problem:'The initial picture requires correction',evidence:'The visible fixture color is red',correction:'Use the corrected green picture'}];
            reply.revisedAnswer='Improved answer with corrected generated image';color='#339933';
          }else if(side==='left'&&candidate==='C2'){reply.resolvedIssueIds=['I1']}
        }
        const body=document.createElement('div');body.className='markdown';body.textContent=JSON.stringify(reply);assistant.append(body);
        if(color)assistant.append(picture(color),documentLink(color));document.getElementById('turns').append(assistant);stop.hidden=true;
      },35);
    });
  })();`;

  async function makeWindow(filename, pageId) {
    const win = new BrowserWindow({ show: false, width: pageId ? 720 : 420, height: 900,
      webPreferences: { session: fixtureSession, offscreen: true, contextIsolation: false,
        nodeIntegration: false, preload: __filename, backgroundThrottling: false,
        additionalArguments: pageId ? [`--converge-page-id=${pageId}`] : [] } });
    browserWindows.push(win);
    if (pageId) pages.set(pageId, win);
    await win.loadURL(`chrome-extension://${extensionId}/${filename}`);
    return win;
  }

  async function run() {
    fixtureSession = session.fromPartition('persist:converge-pipeline-offline-qa');
    fixtureSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(?:chrome-extension:|file:|data:|blob:|about:|devtools:)/.test(details.url) });
    });
    await fs.mkdir(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Converge offline pipeline fixture', version: '1.0.0'
    }));
    for (const name of ['panel.html', 'panel.css', 'panel.js', 'content.js']) {
      await fs.copyFile(path.join(extensionRoot, name), path.join(fixtureRoot, name));
    }
    for (const side of ['left', 'right']) await fs.writeFile(path.join(fixtureRoot, `chat-${side}.html`), fixturePage);
    await fs.writeFile(path.join(fixtureRoot, 'fixture-page.js'), fixtureBehavior);
    extensionId = (await fixtureSession.extensions.loadExtension(fixtureRoot)).id;

    // The coordinator is unmodified production code. Its chrome.tabs transport
    // addresses our local pages, never the real URL returned by the tab fixture.
    global.chrome = {
      runtime: { onMessage: { addListener(listener) { backgroundMessage = listener; } }, onInstalled: { addListener() {} } },
      storage: { session: {
        async get(key) { return { [key]: clone(stored[key]) }; },
        async set(values) { publish(values); }
      } },
      sidePanel: { async setPanelBehavior() {} },
      alarms: { async clear() {}, async create() {}, onAlarm: { addListener() {} } },
      tabs: {
        async get(id) { return { id, url: 'https://chatgpt.com/', windowId: id === 11 ? 101 : 102 }; },
        async create() { await makeWindow('chat-left.html', 11); return { id: 11, url: 'https://chatgpt.com/' }; },
        sendMessage: sendPage,
        onRemoved: { addListener() {} }, onUpdated: { addListener() {} }
      },
      windows: {
        async get(id) { return { id, type: 'normal', width: 1366, height: 768, left: 0, top: 0 }; },
        async getLastFocused() { return { id: 101, type: 'normal', width: 1366, height: 768, left: 0, top: 0 }; },
        async update() {},
        async create() { await makeWindow('chat-right.html', 12); return { tabs: [{ id: 12, url: 'https://chatgpt.com/' }] }; }
      }
    };
    require(path.join(extensionRoot, 'background.js'));
    try {
      const panel = await makeWindow('panel.html');
      await panel.webContents.executeJavaScript(`document.getElementById('openLayout').click()`, true);
      await panel.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=Date.now();const wait=()=>{
        if(!document.getElementById('start').disabled&&document.getElementById('confirmLeft').checked&&document.getElementById('confirmRight').checked)return resolve();
        if(Date.now()-started>10000)return reject(Error('Setup failed: '+document.getElementById('statusDetail').textContent));setTimeout(wait,20)};wait()})`);
      process.stdout.write('PASS: actual panel opens and verifies two offline pages through actual coordinator/content scripts.\n');
      await panel.webContents.executeJavaScript(`document.getElementById('question').value='Create an image and review it until both reviewers accept the corrected result';document.getElementById('maxRounds').value='3';document.getElementById('start').click()`, true);
      await panel.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=Date.now();const wait=()=>{
        const status=document.getElementById('footerStatus').textContent;
        if(status==='AGREED')return resolve();if(['ERROR','STALLED','LIMIT REACHED'].includes(status))return reject(Error(status+': '+document.getElementById('statusDetail').textContent));
        if(Date.now()-started>45000)return reject(Error('Pipeline timed out: '+document.getElementById('statusDetail').textContent));setTimeout(wait,50)};wait()})`);
      const state = stored.convergeState;
      assert.equal(state.status, 'agreed');
      assert.equal(state.candidate.id, 'C2');
      assert.equal(state.candidate.media.side, 'right');
      assert.deepEqual(state.candidate.media.files.map((file) => file.mimeType), ['image/png', 'text/plain']);
      assert.equal(state.answer, 'Improved answer with corrected generated image');
      assert.deepEqual(state.acceptedBy, { left: 'C2', right: 'C2' });
      assert.equal(state.issues.every((issue) => issue.resolved), true);
      assert.equal(state.transcript.length, 5);
      assert.deepEqual(pageCalls.filter(({ message }) => message.type === 'SEND_PROMPT').map(({ id }) => id), [11, 12, 12, 11, 12]);
      assert.equal(pageCalls.filter(({ message }) => message.type === 'EXPORT_MEDIA').length, 3);
      assert.equal(runtimeCalls.filter(({ message }) => message.type === 'REPLY').length, 5);
      assert.equal(JSON.stringify(state).includes('base64'), false, 'Only media identity metadata belongs in coordinator storage');
      assert.equal(stateHistory.some((item) => item.candidate?.id === 'C2' && Object.keys(item.acceptedBy).length === 0), true,
        'A changed image candidate must reset prior acceptance');
      for (const [id, page] of pages) {
        const actual = await page.webContents.executeJavaScript(`({sends:window.fixtureSends,uploads:window.fixtureUploads})`);
        const uploads = actual.uploads.flat();
        assert.equal(uploads.length, id === 11 ? 2 : 4);
        assert.equal(uploads.filter((file) => file.type === 'image/png').every((file) => file.size > 64), true);
        assert.equal(uploads.filter((file) => file.type === 'text/plain').every((file) => file.name === 'review-notes.txt' && file.size > 20), true);
        assert.equal(actual.sends.slice(1).every((send) => send.attachments.length === 2), true,
          'Each review prompt must include the actual transferred candidate PNG and TXT');
      }
      const visible = await panel.webContents.executeJavaScript(`({answer:document.getElementById('answer').textContent,outputs:document.getElementById('answerOutputs').textContent,stopHidden:document.getElementById('stop').hidden})`);
      assert.equal(visible.answer, state.answer);
      assert.match(visible.outputs, /Outputs in chat B: generated-image-1\.png/);
      assert.match(visible.outputs, /review-notes\.txt/);
      assert.equal(visible.stopHidden, true);
      process.stdout.write('PASS: independent drafts -> rendered PNG and visible TXT download relay -> challenge/new candidate -> both accept C2; result appears in actual panel.\n');
      process.stdout.write('PASS: 5 replies, 3 actual PNG/TXT transfers, cleared acceptance on replacement, resolved issue, no media bytes in stored state.\n');
    } catch (error) {
      process.stderr.write(`Coordinator diagnosis: ${JSON.stringify({
        state: stored.convergeState,
        pageCalls: pageCalls.map(({id,message})=>({id,type:message.type})),
        runtimeCalls: runtimeCalls.map(({pageId,message})=>({pageId,type:message.type}))
      })}\n`);
      for (const [id, page] of pages) {
        const diagnosis = await page.webContents.executeJavaScript(`({editor:document.querySelector('[contenteditable]').innerText,html:document.querySelector('[contenteditable]').innerHTML,sends:window.fixtureSends,
          assistants:Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).map(node=>({text:node.innerText,images:Array.from(node.querySelectorAll('img')).map(img=>({complete:img.complete,width:img.naturalWidth,height:img.naturalHeight}))})),
          stopHidden:document.getElementById('stopFixture').hidden})`);
        const prompt = pageCalls.find((call) => call.id === id && call.message.type === 'SEND_PROMPT')?.message.text;
        process.stderr.write(`Fixture page ${id} diagnosis: ${JSON.stringify({
          expectedLength: prompt?.length, editorLength: diagnosis.editor.length,
          expectedStart: prompt?.slice(0, 600), editorStart: diagnosis.editor.slice(0, 600),
          htmlStart: diagnosis.html.slice(0, 600), sends: diagnosis.sends.map((send) => ({ textLength: send.text.length, attachments: send.attachments })),
          assistants:diagnosis.assistants,stopHidden:diagnosis.stopHidden
        })}\n`);
      }
      throw error;
    } finally {
      for (const win of browserWindows) if (!win.isDestroyed()) win.destroy();
      delete global.chrome;
    }
  }

  app.whenReady().then(run).then(() => app.quit(), (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  });
}
