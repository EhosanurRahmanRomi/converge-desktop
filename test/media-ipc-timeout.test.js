'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real desktop host with in-memory Electron surfaces and a controlled
// clock. This exercises its pending owner and response routing rather than
// inferring deadlines from source text or sleeping for several minutes.
async function harness() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const sent = [];
  class Contents extends EventEmitter {
    constructor() { super(); this.mainFrame = { url: 'https://chatgpt.com/' }; }
    getURL() { return this.mainFrame.url; }
    setWindowOpenHandler() {}
    isDestroyed() { return false; }
    send(channel, payload) { sent.push({ contents: this, channel, payload }); }
    close() {}
  }
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new Contents(); this.contentView = { addChildView() {} }; }
    async loadFile() { this.emit('ready-to-show'); }
    isDestroyed() { return false; }
    getContentSize() { return [1600, 980]; }
    isVisible() { return false; }
    isMinimized() { return false; }
    isMaximized() { return false; }
    show() {}
  }
  class View {
    constructor() { this.webContents = new Contents(); }
    setBounds() {}
    setVisible() {}
  }
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  ipcMain.removeHandler = () => {};
  const browserSession = new EventEmitter();
  browserSession.setPermissionRequestHandler = () => {};
  browserSession.setPermissionCheckHandler = () => {};
  const module = { exports: {} };
  const hostPath = path.join(__dirname, '..', 'desktop-main.js');
  vm.runInNewContext(fs.readFileSync(hostPath, 'utf8'), {
    module, __dirname: path.dirname(hostPath), URL,
    setImmediate,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'electron') return { app: {}, BrowserWindow: Window, WebContentsView: View,
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1600, height: 980 } }) },
        ipcMain, session: { fromPartition: () => browserSession }, dialog: {}, clipboard: {}, shell: {} };
      if (name === './src/browser/cookies') return { parseCookies() {} };
      if (name === './src/browser/files') return { MIME: {}, validateExport() {}, validateTextSource() {} };
      if (name === './src/browser/downloads') return { createDownloadBroker: () => ({ dispose: async () => {} }) };
      if (name === './src/browser/desktop-coordinator') return { createDesktopCoordinator: () => ({ getState: async () => ({}), dispose() {} }) };
      return require(name);
    },
  }, { filename: hostPath });
  const desktop = await module.exports.createCookieApp({ show: false });
  const left = desktop.views.left.webContents;
  const event = { sender: left, senderFrame: left.mainFrame };
  ipcMain.emit('converge:page-ready', event);
  return { desktop, sent,
    tick(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    respond(response) {
      const last = sent.findLast((item) => item.channel === 'converge:page-request');
      ipcMain.emit('converge:page-response', event, { id: last.payload.id, response });
    },
  };
}

test('the IPC owner survives a five-file export past the old 35-second deadline and accepts its exact response', async () => {
  const host = await harness();
  const exporting = host.desktop.sendToPage('left', { type: 'EXPORT_MEDIA', runId: 'run', requestId: 'response', ids: ['1', '2', '3', '4', '5'] });
  let settled = false;
  exporting.then(() => { settled = true; }, () => { settled = true; });
  host.tick(250_000);
  await new Promise(setImmediate);
  assert.equal(settled, false, 'The owner must cover all five sequential file preparations and validation.');
  const response = { ok: true, files: ['complete verified response'] };
  host.respond(response);
  assert.deepEqual(await exporting, response);
});

test('a nonresponsive export still expires and ordinary page requests retain their shorter deadlines', async () => {
  for (const [type, deadline] of [['EXPORT_MEDIA', 270_000], ['SEND_PROMPT', 60_000], ['PREPARE', 60_000], ['INSPECT', 35_000]]) {
    const host = await harness();
    const pending = host.desktop.sendToPage('left', { type });
    const rejected = assert.rejects(pending, new RegExp(`did not acknowledge ${type}`));
    host.tick(deadline);
    await rejected;
  }
});
