'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installDesktopLifecycle, macApplicationMenu } = require('../src/platform/desktop-lifecycle');

function harness(platform = 'darwin', createOverride) {
  const app = new EventEmitter();
  app.name = 'Converge';
  app.whenReady = () => Promise.resolve();
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls++; app.emit('before-quit'); };
  const actions = [], menus = [], errors = [], windows = [];
  app.setAppUserModelId = value => actions.push(['app-id', value]);
  const Menu = { buildFromTemplate: template => template, setApplicationMenu: menu => menus.push(menu) };
  const makeWindow = () => {
    const win = new EventEmitter();
    win.destroyed = false; win.minimized = false;
    win.isDestroyed = () => win.destroyed;
    win.isMinimized = () => win.minimized;
    win.restore = () => { win.minimized = false; actions.push('restore'); };
    win.show = () => actions.push('show');
    win.focus = () => actions.push('focus');
    win.close = () => { actions.push('close'); win.destroyed = true; win.emit('closed'); };
    const desktop = { mainWindow: win }; windows.push(desktop); return desktop;
  };
  const lifecycle = installDesktopLifecycle({ app, Menu, platform,
    createApp: createOverride ? () => createOverride(makeWindow) : async () => makeWindow(),
    onError: error => errors.push(error),
  });
  return { app, lifecycle, actions, menus, errors, windows, makeWindow };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('macOS native menu supplies focused editing roles and separate Close and Quit', () => {
  const show = () => {};
  const menu = macApplicationMenu({ name: 'Converge' }, show);
  const roles = menu.flatMap(entry => entry.submenu.map(item => item.role).filter(Boolean));
  for (const role of ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit', 'close', 'undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll', 'minimize', 'zoom', 'front']) assert.ok(roles.includes(role), role);
  assert.equal(menu[1].submenu[0].click, show);
  assert.equal(menu[1].submenu[0].accelerator, 'Command+0');
  assert.ok(!roles.includes('reload'), 'A provider view must not receive an unguarded menu reload');
});

test('macOS Close keeps the app alive and Dock activation creates one fresh window', async () => {
  const h = harness(); await h.lifecycle.ready;
  h.windows[0].mainWindow.close(); h.app.emit('window-all-closed');
  assert.equal(h.app.quitCalls, 0);
  assert.equal(h.lifecycle.getCurrent(), null);
  h.app.emit('activate'); h.app.emit('activate'); await flush();
  assert.equal(h.windows.length, 2);
  assert.equal(h.lifecycle.getCurrent(), h.windows[1]);
  assert.equal(h.menus.length, 1);
});

test('concurrent startup and Dock activation serialize creation before global IPC is installed', async () => {
  let release, creates = 0;
  const h = harness('darwin', make => {
    creates++;
    return new Promise(resolve => { release = () => resolve(make()); });
  });
  h.app.emit('activate'); h.app.emit('activate'); await flush();
  assert.equal(creates, 1);
  release(); await h.lifecycle.ready; await flush();
  assert.equal(h.windows.length, 1);
});

test('activating or starting a second instance restores and focuses the existing workspace', async () => {
  const h = harness(); await h.lifecycle.ready;
  h.windows[0].mainWindow.minimized = true;
  h.app.emit('second-instance'); await flush();
  assert.equal(h.windows.length, 1);
  assert.deepEqual(h.actions, ['restore', 'show', 'focus']);
  h.app.emit('activate'); await flush();
  assert.deepEqual(h.actions, ['restore', 'show', 'focus', 'show', 'focus']);
});

test('Command Quit prevents a later activation from reopening the workspace', async () => {
  const h = harness(); await h.lifecycle.ready;
  h.app.emit('before-quit'); h.windows[0].mainWindow.close();
  h.app.emit('activate'); h.app.emit('second-instance'); await flush();
  assert.equal(h.windows.length, 1);
});

test('a window created during Quit is immediately closed rather than retained', async () => {
  let release;
  const h = harness('darwin', make => new Promise(resolve => { release = () => resolve(make()); }));
  await flush(); h.app.emit('before-quit'); release();
  assert.equal(await h.lifecycle.ready, null);
  assert.equal(h.windows[0].mainWindow.isDestroyed(), true);
  assert.equal(h.lifecycle.getCurrent(), null);
});

test('Windows retains quit-on-last-window and its application ID without a macOS menu', async () => {
  const h = harness('win32'); await h.lifecycle.ready;
  assert.deepEqual(h.actions, [['app-id', 'app.converge.browser-studio']]);
  assert.equal(h.menus.length, 0);
  assert.equal(h.app.listenerCount('activate'), 0);
  h.windows[0].mainWindow.close(); h.app.emit('window-all-closed');
  assert.equal(h.app.quitCalls, 1);
});

test('startup errors are reported and a later request does not retain a failed creation promise', async () => {
  let attempts = 0;
  const failure = new Error('Fixture startup failed');
  const h = harness('darwin', make => { if (++attempts === 1) throw failure; return make(); });
  await assert.rejects(h.lifecycle.ready, /Fixture startup failed/); await flush();
  assert.deepEqual(h.errors, [failure]);
  await h.lifecycle.showWindow();
  assert.equal(attempts, 2);
  assert.equal(h.windows.length, 1);
});
