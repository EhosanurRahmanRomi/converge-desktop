'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real host and preload without opening a window or touching a
// Chrome profile. The fake surfaces record observable native calls and events.
async function harness() {
  const handlers = new Map(), sent = [], actions = [], deferred = [];
  let coordinatorDisposed = false, downloadsDisposed = false;
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
  const module = { exports: {} }, hostPath = path.join(__dirname, '..', 'desktop-main.js');
  vm.runInNewContext(fs.readFileSync(hostPath, 'utf8'), {
    module, __dirname: path.dirname(hostPath), URL, setTimeout, clearTimeout,
    setImmediate: fn => deferred.push(fn),
    require(name) {
      if (name === 'electron') return { app: { getVersion: () => 'fixture' }, BrowserWindow: Window, WebContentsView: View, ipcMain,
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1366, height: 728 } }) },
        session: { fromPartition: () => browserSession }, dialog: {}, clipboard: {}, shell: {} };
      if (name === './src/browser/cookies') return { parseCookies() {} };
      if (name === './src/browser/files') return { MIME: {}, validateExport() {}, validateTextSource() {} };
      if (name === './src/browser/downloads') return { createDownloadBroker: () => ({ dispose: async () => { downloadsDisposed = true; } }) };
      if (name === './src/browser/desktop-coordinator') return { createDesktopCoordinator: () => ({ getState: async () => ({ status: 'idle' }), dispose() { coordinatorDisposed = true; } }) };
      return require(name);
    },
  }, { filename: hostPath });
  const desktop = await module.exports.createCookieApp({ show: false });
  const window = desktop.mainWindow;
  const owner = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { desktop, window, owner, handlers, actions, sent, deferred,
    invoke(channel, payload, event = owner) { return handlers.get(channel)(event, payload); },
    cleanup: () => ({ coordinatorDisposed, downloadsDisposed }),
  };
}
const plain = value => JSON.parse(JSON.stringify(value));

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
