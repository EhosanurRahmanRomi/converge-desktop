'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real host and preload without opening a window or touching a
// Chrome profile. The fake surfaces record observable native calls and events.
async function harness(options = {}) {
  const handlers = new Map(), sent = [], actions = [], deferred = [];
  let coordinatorDisposed = false, downloadsDisposed = false, sessionCleared = false;
  class Contents extends EventEmitter {
    constructor() { super(); this.mainFrame = { url: 'https://chatgpt.com/' }; this.destroyed = false; }
    getURL() { return this.mainFrame.url; }
    setWindowOpenHandler() {}
    isDestroyed() { return this.destroyed; }
    send(channel, payload) { sent.push({ contents: this, channel, payload }); }
    close() { this.destroyed = true; }
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new Contents(); this.contentView = { addChildView() {} }; this.maximized = false; this.minimized = false; this.destroyed = false; }
    async loadFile() { this.emit('ready-to-show'); }
    isDestroyed() { return this.destroyed; }
    getContentSize() { return [1600, 980]; }
    isVisible() { return !this.minimized && !this.destroyed; }
    isMinimized() { return this.minimized; }
    isMaximized() { return this.maximized; }
    show() {}
    minimize() { actions.push('minimize'); this.minimized = true; this.emit('minimize'); }
    maximize() { actions.push('maximize'); this.maximized = true; this.emit('maximize'); }
    unmaximize() { actions.push('unmaximize'); this.maximized = false; this.emit('unmaximize'); }
    restore() { actions.push('restore'); this.minimized = false; this.emit('restore'); }
    close() { actions.push('close'); this.destroyed = true; this.emit('closed'); }
  }
  class View { constructor() { this.webContents = new Contents(); } setBounds() {} setVisible() {} }
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  ipcMain.removeHandler = channel => handlers.delete(channel);
  const browserSession = new EventEmitter();
  browserSession.setPermissionRequestHandler = () => {};
  browserSession.setPermissionCheckHandler = () => {};
  browserSession.clearData = async () => { sessionCleared = true; };
  const module = { exports: {} }, hostPath = path.join(__dirname, '..', 'desktop-main.js');
  vm.runInNewContext(fs.readFileSync(hostPath, 'utf8'), {
    module, __dirname: path.dirname(hostPath), URL, AbortController, Buffer, setTimeout, clearTimeout,
    setImmediate: fn => deferred.push(fn),
    require(name) {
      if (name === 'electron') return { app: { getVersion: () => 'fixture', getPath: () => path.dirname(hostPath) }, BrowserWindow: Window, WebContentsView: View, ipcMain,
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1366, height: 728 } }) },
        session: { fromPartition: () => browserSession }, dialog: options.dialogs || {}, clipboard: options.clipboard || {}, shell: {} };
      if (name === 'node:fs/promises' && options.filesystem) return options.filesystem;
      if (name === 'node:process') return { platform: options.platform || 'win32' };
      if (name === './src/browser/cookies') return { parseCookies() {} };
      if (name === './src/browser/files') return require('../src/browser/files');
      if (name === './src/browser/file-store') return require('../src/browser/file-store');
      if (name === './src/browser/upload-transport') return require('../src/browser/upload-transport');
      if (name === './src/platform/studio-desktop') return { createStudioDesktop: () => ({ register() {}, getInfo: () => ({ status: 'unsaved' }), isBusy: () => options.projectBusy === true, checkpoint() {}, verification() {}, dispose: async () => {} }) };
      if (name === './src/browser/downloads') return { createDownloadBroker: () => ({ dispose: async () => { downloadsDisposed = true; } }) };
      if (name === './src/browser/desktop-coordinator') return { createDesktopCoordinator: () => ({ getState: async () => ({ status: 'idle' }), dispose() { coordinatorDisposed = true; } }) };
      if (name === './src/browser/boss-coordinator') return { createBossCoordinator: hooks => ({ getState: async () => ({ status: 'idle' }), ...options.coordinator, ...options.coordinatorFactory?.(hooks), dispose() { coordinatorDisposed = true; } }) };
      return require(name);
    },
  }, { filename: hostPath });
  const desktop = await module.exports.createCookieApp({ show: false });
  const window = desktop.mainWindow;
  const owner = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { desktop, window, owner, handlers, actions, sent, deferred, ipcMain,
    invoke(channel, payload, event = owner) { return handlers.get(channel)(event, payload); },
    cleanup: () => ({ coordinatorDisposed, downloadsDisposed }),
    sessionCleared: () => sessionCleared,
  };
}
const plain = value => JSON.parse(JSON.stringify(value));

const pageEvent = (host, side) => ({ sender: host.desktop.views[side].webContents, senderFrame: host.desktop.views[side].webContents.mainFrame });
const acknowledge = (host, request, response = { ok: true }) => host.ipcMain.emit('converge:page-response',
  { sender: request.contents, senderFrame: request.contents.mainFrame }, { id: request.payload.id, response });

test('Stop during source reading prevents a late ATTACH_FILES and allows an explicit retry', async () => {
  let releaseRead, defer = true, stops = 0;
  const requests = [];
  const host = await harness({ dialogs: { showOpenDialog: async () => ({ canceled: false, filePaths: ['source.txt'] }) },
    filesystem: { stat: async () => ({ isFile: () => true, size: 5 }), readFile: async () => defer ? new Promise(resolve => { releaseRead = resolve; }) : Buffer.from('hello') },
    coordinator: { request: async type => { requests.push(type); return { ok: true }; }, stop: async () => { stops += 1; return { ok: true }; } } });
  const attach = host.invoke('browser:attach');
  const rejected = assert.rejects(attach, /stopped by the user/);
  await new Promise(resolve => setImmediate(resolve));
  await host.invoke('browser:stop');
  releaseRead(Buffer.from('hello')); await rejected;
  assert.equal(stops, 1); assert.deepEqual(requests, []);
  assert.equal(host.sent.some(item => item.channel === 'converge:page-request'), false);
  defer = false;
  assert.equal((await host.invoke('browser:attach')).ok, true);
  assert.deepEqual(requests, ['ATTACH_FILES']); host.window.close();
});

test('Stop retires a pending source picker before it reads files or submits them', async () => {
  let select;
  const requests = [], reads = [];
  const host = await harness({ dialogs: { showOpenDialog: () => new Promise(resolve => { select = resolve; }) },
    filesystem: { stat: async name => { reads.push(name); return { isFile: () => true, size: 5 }; } },
    coordinator: { request: async type => { requests.push(type); return { ok: true }; }, stop: async () => ({ ok: true }) } });
  const attach = host.invoke('browser:attach');
  const rejected = assert.rejects(attach, /stopped by the user/);
  await new Promise(resolve => setImmediate(resolve));
  await host.invoke('browser:stop'); select({ canceled: false, filePaths: ['source.txt'] }); await rejected;
  assert.deepEqual(reads, []); assert.deepEqual(requests, []); host.window.close();
});

test('design reference upload preserves its explicit role through the native picker', async () => {
  const requests = [], pickers = [];
  const host = await harness({ dialogs: { showOpenDialog: async (_window, options) => {
    pickers.push(options); return { canceled: false, filePaths: ['visual-reference.pdf'] };
  } }, filesystem: { stat: async () => ({ isFile: () => true, size: 8 }), readFile: async () => Buffer.from('%PDF-1.4') },
    coordinator: { request: async (type, payload) => { requests.push({ type, payload }); return { ok: true }; } } });
  assert.equal((await host.invoke('browser:attach', { fileRole: 'style-reference' })).ok, true);
  assert.match(pickers[0].title, /design references for appearance only/);
  assert.equal(requests[0].type, 'ATTACH_FILES');
  assert.equal(requests[0].payload.fileRole, 'style-reference');
  assert.equal(requests[0].payload.files[0].name, 'visual-reference.pdf');
  assert.equal(requests[0].payload.files[0].base64, Buffer.from('%PDF-1.4').toString('base64'));
  await assert.rejects(host.invoke('browser:attach', { fileRole: 'candidate-output' }), /content files or a design reference/);
  assert.equal(pickers.length, 1); host.window.close();
});

test('Stop during native readiness checks prevents Start, Prepare and Open dispatch', async () => {
  for (const channel of ['browser:start', 'browser:prepare', 'browser:open']) {
    let release;
    const requests = [];
    const host = await harness({ coordinator: { getState: () => new Promise(resolve => { release = resolve; }),
      request: async type => { requests.push(type); return { ok: true }; }, stop: async () => ({ ok: true }) } });
    const operation = host.invoke(channel, { question: 'Pending task' });
    const rejected = assert.rejects(operation, /stopped by the user/);
    await new Promise(resolve => setImmediate(resolve));
    await host.invoke('browser:stop'); release({ status: 'idle' }); await rejected;
    assert.deepEqual(requests, [], channel); host.window.close();
  }
});

test('Stop cancels only the owned upload and retires staged transfers before any chunk or commit', async () => {
  for (const staged of [false, true]) {
    const bytes = staged ? Buffer.alloc(3_200_000) : Buffer.from('hello');
    const host = await harness({ dialogs: { showOpenDialog: async () => ({ canceled: false, filePaths: [staged ? 'source.png' : 'source.txt'] }) },
      filesystem: { stat: async () => ({ isFile: () => true, size: bytes.length }), readFile: async () => bytes },
      coordinator: { stop: async () => ({ ok: true }) },
      coordinatorFactory: hooks => ({ request: (type, payload) => hooks.sendToPage('left', { type: 'UPLOAD_FILES', files: payload.files }) }) });
    host.ipcMain.emit('converge:page-ready', pageEvent(host, 'left'));
    const attach = host.invoke('browser:attach');
    const rejected = assert.rejects(attach, /stopped by the user/);
    await new Promise(resolve => setImmediate(resolve));
    const transfer = host.sent.find(item => item.channel === 'converge:page-request');
    assert.equal(transfer.payload.message.type, staged ? 'FILE_STAGE_BEGIN' : 'UPLOAD_FILES');
    await host.invoke('browser:stop');
    await new Promise(resolve => setImmediate(resolve));
    const cancel = host.sent.find(item => item.channel === 'converge:page-request' && item.payload.message.type === 'CANCEL');
    assert.equal(cancel.contents, transfer.contents);
    assert.equal(cancel.payload.message.runId, transfer.payload.message.runId);
    assert.equal(cancel.payload.message.requestId, transfer.payload.message.requestId);
    assert.equal(cancel.payload.message.stopGeneration, false);
    assert.equal(host.sent.some(item => ['FILE_STAGE_CHUNK', 'FILE_STAGE_COMMIT'].includes(item.payload?.message?.type)), false);
    for (const request of host.sent.filter(item => ['CANCEL', 'FILE_STAGE_ABORT'].includes(item.payload?.message?.type))) acknowledge(host, request);
    await rejected; host.window.close();
  }
});

test('Stop preserves an explicit save of a completed candidate file', async () => {
  const descriptor = { id: 'file-1', name: 'result.txt', mimeType: 'text/plain', fingerprint: 'exact-file' };
  const current = { status: 'blocked', runId: 'run-1', candidate: { id: 'C1', media: { side: 'left', runId: 'run-1', requestId: 'result-1', files: [descriptor] } } };
  const writes = [];
  let select;
  const host = await harness({ dialogs: { showSaveDialog: () => new Promise(resolve => { select = resolve; }) },
    filesystem: { writeFile: async (...args) => { writes.push(args); } },
    coordinator: { getState: async () => current, getCurrentCandidate: async () => ({ ...current.candidate,
      files: [{ ...descriptor, base64: Buffer.from('hello').toString('base64') }] }), stop: async () => ({ ok: true }) } });
  const save = host.invoke('browser:save-files');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof select, 'function');
  assert.equal(host.sent.some(item => item.payload?.message?.type === 'EXPORT_MEDIA'), false);
  await host.invoke('browser:stop');
  assert.equal(host.sent.some(item => item.payload?.message?.type === 'CANCEL'), false);
  select({ canceled: false, filePath: 'result.txt' });
  const saved = await save;
  assert.equal(saved.ok, true); assert.equal(saved.saved, 1);
  assert.equal(writes.length, 1); assert.equal(writes[0][1].toString(), 'hello'); host.window.close();
});

test('running or disconnected downloads save immutable captured bytes even when the next candidate arrives', async () => {
  for (const status of ['running', 'idle']) {
    const digest = require('node:crypto').createHash('sha256').update('checkpoint').digest('hex');
    const descriptor = { id: 'saved-file-1', name: 'checkpoint.txt', mimeType: 'text/plain', fingerprint: digest,
      contentSha256: digest, byteLength: 10 };
    let candidate = { id: 'C1', sha256: 'candidate-one', status: 'draft',
      media: { side: 'left', runId: 'saved-project', requestId: 'R1', files: [descriptor] },
      files: [{ ...descriptor, base64: Buffer.from('checkpoint').toString('base64') }] };
    let select;
    const writes = [];
    const host = await harness({ dialogs: { showSaveDialog: () => new Promise(resolve => { select = resolve; }) },
      filesystem: { writeFile: async (...args) => writes.push(args) },
      coordinator: { getState: async () => ({ status }), getDeliverySnapshot: async () => candidate } });
    const saving = host.invoke('browser:save-files', { candidateId: 'C1', sha256: 'candidate-one',
      files: [{ name: descriptor.name, contentSha256: digest }], draft: true });
    await new Promise(resolve => setImmediate(resolve));
    candidate = { id: 'C2', sha256: 'candidate-two', media: null, files: [] };
    select({ canceled: false, filePath: 'checkpoint.txt' });
    const saved = await saving;
    assert.equal(saved.ok, true); assert.equal(saved.saved, 1);
    assert.equal(writes[0][1].toString(), 'checkpoint');
    assert.equal(host.sent.some(item => item.channel === 'converge:page-request'), false);
    host.window.close();
  }
});

test('a stale or fabricated download selection cannot open a picker or save substituted bytes', async () => {
  const digest = require('node:crypto').createHash('sha256').update('checkpoint').digest('hex');
  const descriptor = { id: 'file-1', name: 'checkpoint.txt', mimeType: 'text/plain', fingerprint: digest,
    contentSha256: digest, byteLength: 10 };
  let picked = 0;
  const host = await harness({ dialogs: { showSaveDialog: async () => { picked++; return { canceled: true }; } },
    coordinator: { getDeliverySnapshot: async () => ({ id: 'C1', sha256: 'candidate-one',
      media: { side: 'left', requestId: 'R1', files: [descriptor] },
      files: [{ ...descriptor, base64: Buffer.from('checkpoint').toString('base64') }] }) } });
  for (const payload of [{ candidateId: 'C2' }, { sha256: 'wrong' },
    { files: [{ name: 'checkpoint.txt', contentSha256: 'wrong' }] },
    { files: [{ name: descriptor.name, contentSha256: digest }, { name: descriptor.name, contentSha256: digest }] }]) {
    assert.equal((await host.invoke('browser:save-files', payload)).ok, false);
  }
  assert.equal(picked, 0); host.window.close();
});

test('closing during a checkpoint picker prevents a late write, and corrupted captured bytes never reach a picker', async () => {
  const digest = require('node:crypto').createHash('sha256').update('checkpoint').digest('hex');
  const descriptor = { id: 'file-1', name: 'checkpoint.txt', mimeType: 'text/plain', fingerprint: digest,
    contentSha256: digest, byteLength: 10 };
  let select, corrupted = false;
  const writes = [];
  const host = await harness({ dialogs: { showSaveDialog: () => new Promise(resolve => { select = resolve; }) },
    filesystem: { writeFile: async (...args) => writes.push(args) },
    coordinator: { getDeliverySnapshot: async () => ({ id: 'C1', status: 'running', draft: true,
      media: { side: 'left', runId: 'saved-project', requestId: 'R1', files: [descriptor] },
      files: [{ ...descriptor, base64: Buffer.from(corrupted ? 'substitute' : 'checkpoint').toString('base64') }] }) } });
  corrupted = true;
  const bad = await host.invoke('browser:save-files');
  assert.equal(bad.ok, false); assert.match(bad.error, /contents changed/); assert.equal(select, undefined);
  corrupted = false;
  const saving = host.invoke('browser:save-files');
  await new Promise(resolve => setImmediate(resolve));
  host.window.close(); select({ canceled: false, filePath: 'late.txt' });
  const saved = await saving;
  assert.equal(saved.ok, false); assert.match(saved.error, /closing/); assert.equal(writes.length, 0);
});

test('Stop before page readiness cannot send a delayed upload or general Cancel into the ready page', async () => {
  const host = await harness({ dialogs: { showOpenDialog: async () => ({ canceled: false, filePaths: ['source.txt'] }) },
    filesystem: { stat: async () => ({ isFile: () => true, size: 5 }), readFile: async () => Buffer.from('hello') },
    coordinator: { stop: async () => ({ ok: true }) },
    coordinatorFactory: hooks => ({ request: (type, payload) => hooks.sendToPage('left', { type: 'UPLOAD_FILES', files: payload.files }) }) });
  const attach = host.invoke('browser:attach');
  const rejected = assert.rejects(attach, /stopped by the user/);
  await new Promise(resolve => setImmediate(resolve));
  await host.invoke('browser:stop');
  host.ipcMain.emit('converge:page-ready', pageEvent(host, 'left'));
  await rejected;
  assert.equal(host.sent.some(item => item.channel === 'converge:page-request'), false); host.window.close();
});

test('overlapping Start requests cannot reset a task twice while initial page checks are pending', async () => {
  let release;
  const requests = [];
  const host = await harness({ coordinator: { request: async (type, payload) => {
    requests.push({ type, payload }); await new Promise(resolve => { release = resolve; }); return { ok: true };
  } } });
  const first = host.invoke('browser:start', { question: 'First task' });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(host.invoke('browser:start', { question: 'Second task' }), /workspace operation/);
  await assert.rejects(host.invoke('browser:reset-chats'), /workspace operation/);
  assert.equal(requests.length, 1);
  release(); assert.equal((await first).ok, true);
});

test('native task/session/file changes wait for an existing project operation while Stop remains available', async () => {
  let stops = 0;
  const host = await harness({ projectBusy: true, coordinator: { stop: async () => { stops += 1; return { ok: true }; } } });
  for (const channel of ['browser:start', 'browser:reset-chats', 'browser:import', 'browser:attach', 'browser:open', 'browser:boss-message']) {
    await assert.rejects(host.invoke(channel, {}), /project operation/);
  }
  assert.equal((await host.invoke('browser:stop')).ok, true); assert.equal(stops, 1);
});

test('two file-picking requests cannot overlap and a late picker result cannot mutate a closed workspace', async () => {
  let select;
  let dialogs = 0;
  const host = await harness({ dialogs: { showOpenDialog: async () => {
    dialogs += 1; return new Promise(resolve => { select = resolve; });
  } } });
  const first = host.invoke('browser:attach');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(host.invoke('browser:attach'), /workspace operation/);
  assert.equal(dialogs, 1);
  host.window.close();
  const rejected = assert.rejects(first, /workspace is closing/);
  select({ canceled: true }); await rejected;
});

test('a Markdown save dialog resolved after Close cannot write an output', async () => {
  let select;
  const writes = [];
  const host = await harness({ dialogs: { showSaveDialog: () => new Promise(resolve => { select = resolve; }) },
    filesystem: { writeFile: async (...args) => { writes.push(args); } } });
  const save = host.invoke('browser:save', { content: 'Current report' });
  await new Promise(resolve => setImmediate(resolve));
  host.window.close();
  const rejected = assert.rejects(save, /workspace is closing/);
  select({ canceled: false, filePath: 'late-report.md' }); await rejected;
  assert.equal(writes.length, 0);
});

test('frameless shell retains isolated web preferences and reports actual native window state at bootstrap', async () => {
  const host = await harness();
  assert.equal(host.window.options.frame, false);
  assert.equal(host.window.options.width, 1366);
  assert.equal(host.window.options.height, 728);
  assert.equal(host.window.options.minWidth, 1100);
  assert.equal(host.window.options.minHeight, 640);
  assert.equal(host.window.options.webPreferences.sandbox, true);
  assert.equal(host.window.options.webPreferences.contextIsolation, true);
  assert.equal(host.window.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(plain((await host.invoke('browser:bootstrap')).windowState), { maximized: false, minimized: false });
  host.window.maximized = true;
  assert.deepEqual(plain((await host.invoke('browser:bootstrap')).windowState), { maximized: true, minimized: false });
});

test('three isolated views share a validated background and reapply it after navigation', async () => {
  const host = await harness();
  assert.deepEqual(Object.keys(host.desktop.views).sort(), ['boss', 'left', 'right']);
  for (const chatTheme of ['horror', 'alien', 'night', 'cyberpunk', 'anime']) {
    assert.equal((await host.invoke('browser:appearance', { chatTheme })).ok, true);
    for (const side of ['boss', 'left', 'right']) {
      const applied = host.sent.findLast(item => item.contents === host.desktop.views[side].webContents && item.channel === 'converge:page-appearance');
      assert.equal(applied.payload.chatTheme, chatTheme);
    }
  }
  await assert.rejects(host.invoke('browser:appearance', { chatTheme: 'url(https://untrusted.invalid)' }), /supported/);
  const boss = host.desktop.views.boss.webContents;
  await assert.rejects(host.invoke('browser:appearance', { chatTheme: 'alien' }, { sender: boss, senderFrame: boss.mainFrame }), /denied/);
  await assert.rejects(host.invoke('browser:boss-message', { text: 'impersonate user' }, { sender: boss, senderFrame: boss.mainFrame }), /denied/);
});

test('native window controls reject embedded chats, child frames, foreign senders and unknown actions', async () => {
  const host = await harness();
  const rejected = [
    { sender: host.desktop.views.left.webContents, senderFrame: host.desktop.views.left.webContents.mainFrame },
    { sender: host.window.webContents, senderFrame: { url: host.window.webContents.mainFrame.url } },
    { sender: {}, senderFrame: host.window.webContents.mainFrame },
  ];
  for (const event of rejected) for (const action of ['minimize', 'toggle-maximize', 'close']) {
    await assert.rejects(host.invoke('browser:window-action', action, event), /Request denied/);
  }
  for (const action of [null, 'restore', 'open-file', { action: 'close' }, ['close']]) {
    await assert.rejects(host.invoke('browser:window-action', action), /Unknown window action/);
  }
  assert.deepEqual(host.actions, []);
  assert.equal(host.deferred.length, 0);
});

test('minimize and maximize controls update native state and broadcast only observed window transitions', async () => {
  const host = await harness();
  let result = await host.invoke('browser:window-action', 'toggle-maximize');
  assert.deepEqual(plain(result), { ok: true, windowState: { maximized: true, minimized: false } });
  result = await host.invoke('browser:window-action', 'toggle-maximize');
  assert.equal(result.windowState.maximized, false);
  result = await host.invoke('browser:window-action', 'minimize');
  assert.equal(result.windowState.minimized, true);
  assert.equal(host.sent.findLast(item => item.channel === 'converge:window-visibility').payload.visible, false);
  host.window.restore();
  assert.equal(host.sent.findLast(item => item.channel === 'converge:window-visibility').payload.visible, true);
  assert.deepEqual(host.actions, ['maximize', 'unmaximize', 'minimize', 'restore']);
  assert.deepEqual(plain(host.sent.filter(item => item.channel === 'converge:window-state').map(item => item.payload)), [
    { maximized: true, minimized: false }, { maximized: false, minimized: false },
    { maximized: false, minimized: true }, { maximized: false, minimized: false },
  ]);
});

test('Close acknowledges before owner teardown and follows existing page and IPC cleanup', async () => {
  const host = await harness();
  const result = await host.invoke('browser:window-action', 'close');
  assert.equal(result.ok, true);
  assert.equal(host.window.isDestroyed(), false);
  assert.deepEqual(host.actions, []);
  assert.equal(host.deferred.length, 1);
  host.deferred.shift()();
  assert.deepEqual(host.actions, ['close']);
  assert.equal(host.window.isDestroyed(), true);
  assert.equal(host.handlers.size, 0);
  assert.equal(host.desktop.views.left.webContents.isDestroyed(), true);
  assert.equal(host.desktop.views.right.webContents.isDestroyed(), true);
  assert.deepEqual(host.cleanup(), { coordinatorDisposed: true, downloadsDisposed: true });
  assert.equal(host.sessionCleared(), true);
});

test('macOS keeps the same isolated frameless geometry and exposes platform without native ICO icon', async () => {
  const host = await harness({ platform: 'darwin' });
  assert.equal((await host.invoke('browser:bootstrap')).platform, 'darwin');
  assert.match(host.window.options.icon, /icon\.png$/);
  assert.equal(host.window.options.frame, false);
  assert.equal(host.window.options.width, 1366);
  assert.equal(host.window.options.height, 728);
  assert.equal(host.window.options.webPreferences.sandbox, true);
  assert.equal(host.window.options.webPreferences.contextIsolation, true);
});

test('macOS decoration follows native visibility events even when Electron isVisible is inverted', async () => {
  const host = await harness({ platform: 'darwin' });
  // Reproduce the pinned macOS runtime's inverted occlusion query without
  // changing Windows query-based visibility or either provider bridge.
  host.window.isVisible = () => false;
  assert.equal((await host.invoke('browser:bootstrap')).windowVisible, false);
  host.window.emit('show');
  assert.equal((await host.invoke('browser:bootstrap')).windowVisible, true);
  for (const side of ['left', 'right']) assert.equal(host.sent.findLast(item => item.contents === host.desktop.views[side].webContents && item.channel === 'converge:page-effects').payload.paused, false);
  host.window.emit('hide');
  assert.equal((await host.invoke('browser:bootstrap')).windowVisible, false);
  host.window.emit('show'); host.window.minimize();
  assert.equal((await host.invoke('browser:bootstrap')).windowVisible, false);
  host.window.restore();
  assert.equal((await host.invoke('browser:bootstrap')).windowVisible, true);
  await host.invoke('browser:effects-paused', true);
  host.window.emit('hide'); host.window.emit('show');
  for (const side of ['left', 'right']) assert.equal(host.sent.findLast(item => item.contents === host.desktop.views[side].webContents && item.channel === 'converge:page-effects').payload.paused, true);
  host.window.close();
  assert.equal(host.desktop.views.left.webContents.isDestroyed(), true);
  assert.equal(host.desktop.views.right.webContents.isDestroyed(), true);
});

test('copy waits for Electron async clipboard completion and propagates native failure', async () => {
  let release;
  const writes = [];
  const host = await harness({ clipboard: { writeText: text => {
    writes.push(text); return new Promise(resolve => { release = resolve; });
  } } });
  let settled = false;
  const operation = host.invoke('browser:copy', 'reviewed result').then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(writes, ['reviewed result']);
  release(); assert.equal((await operation).ok, true);
  const failure = await harness({ clipboard: { writeText: async () => { throw Error('Native clipboard unavailable'); } } });
  await assert.rejects(failure.invoke('browser:copy', 'result'), /Native clipboard unavailable/);
  await assert.rejects(failure.invoke('browser:copy', 'x'.repeat(200001)), /Invalid answer text/);
});

test('preload exposes a bounded window-action channel and removable state subscription', async () => {
  const ipcRenderer = new EventEmitter(), calls = [];
  ipcRenderer.invoke = async (channel, payload) => { calls.push({ channel, payload }); return { ok: true }; };
  let bridge;
  const preloadPath = path.join(__dirname, '..', 'desktop-preload.js');
  vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), {
    require(name) { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'convergeBrowser'); bridge = api; } }, ipcRenderer }; },
  }, { filename: preloadPath });
  assert.equal(Object.isFrozen(bridge), true);
  await bridge.windowAction('toggle-maximize');
  assert.deepEqual(calls, [{ channel: 'browser:window-action', payload: 'toggle-maximize' }]);
  const received = [];
  const remove = bridge.onWindowState(payload => received.push(payload));
  const event = { sender: 'must not cross the bridge' }, state = { maximized: true, minimized: false };
  ipcRenderer.emit('converge:window-state', event, state);
  assert.deepEqual(received, [state]);
  remove(); ipcRenderer.emit('converge:window-state', event, { maximized: false });
  assert.deepEqual(received, [state]);
  assert.doesNotThrow(() => bridge.onWindowState(null)());
});
