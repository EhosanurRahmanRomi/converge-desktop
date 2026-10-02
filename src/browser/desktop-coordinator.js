'use strict';

const { installCoordinator, initialState } = require('../../chrome-extension/background');

const SIDES = ['left', 'right'];
const TAB_IDS = { left: 10, right: 11 };
const WINDOW_IDS = { left: 1, right: 2 };
const PAGE_EVENTS = new Set(['REPLY', 'ERROR', 'PAGE_STATUS']);
const CONTROL_COMMANDS = new Set(['GET_STATE', 'OPEN_LAYOUT', 'PREPARE', 'ATTACH_FILES', 'START', 'STOP']);

function clone(value) {
  return structuredClone(value);
}

function eventSource() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => { for (const listener of [...listeners]) listener(...args); },
    clear: () => listeners.clear(),
    listeners,
  };
}

/**
 * Hosts the same debate coordinator as the Chrome extension inside Electron.
 * Synthetic tab IDs refer to the two embedded pages, never Chrome tabs. State
 * and watchdogs live only in memory; credentials and attachment bytes are not
 * written to this state. sendToPage is implemented by the isolated page bridge.
 */
function createDesktopCoordinator({ openPage, sendToPage, getPageUrl, onState, screenBounds } = {}) {
  if (typeof openPage !== 'function' || typeof sendToPage !== 'function') {
    throw new TypeError('The desktop page transport requires openPage and sendToPage.');
  }
  const runtimeMessages = eventSource();
  const installed = eventSource();
  const removed = eventSource();
  const updated = eventSource();
  const alarms = eventSource();
  const timers = new Map();
  const pages = { left: { opened: false, url: 'about:blank' }, right: { opened: false, url: 'about:blank' } };
  const storage = { convergeState: initialState() };
  let disposed = false;
  const bounds = { left: 0, top: 0, width: 1366, height: 768, ...screenBounds };

  function ensureActive() {
    if (disposed) throw new Error('The browser workspace has closed.');
  }

  function sideForTab(tabId) {
    const side = SIDES.find((item) => TAB_IDS[item] === tabId);
    if (!side) throw new Error('That browser page is not part of this workspace.');
    return side;
  }

  function pageUrl(side) {
    return typeof getPageUrl === 'function' ? getPageUrl(side) : pages[side].url;
  }

  function tab(side) {
    if (!pages[side].opened) throw new Error(`Open the ${side} page first.`);
    return { id: TAB_IDS[side], windowId: WINDOW_IDS[side], url: pageUrl(side) };
  }

  async function open(side, url) {
    ensureActive();
    await openPage(side, url);
    ensureActive();
    pages[side] = { opened: true, url };
    return tab(side);
  }

  function windowInfo(id = 1) {
    if (![1, 2].includes(id)) throw new Error('That workspace window is unavailable.');
    return { id, type: 'normal', incognito: false, ...bounds };
  }

  const chrome = {
    runtime: { onMessage: runtimeMessages, onInstalled: installed },
    storage: { session: {
      async get(key) {
        // A page send can reject after window teardown. Let the already queued
        // coordinator callback read the stopped record and discard that reply.
        if (typeof key !== 'string') throw new Error('Unsupported state request.');
        return { [key]: clone(storage[key]) };
      },
      async set(values) {
        ensureActive();
        for (const [key, value] of Object.entries(values)) storage[key] = clone(value);
        if (values.convergeState && typeof onState === 'function') {
          // A disappearing renderer must not interrupt a model exchange.
          try { Promise.resolve(onState(clone(values.convergeState))).catch(() => {}); } catch (_) { }
        }
      },
    } },
    tabs: {
      async get(tabId) { ensureActive(); return tab(sideForTab(tabId)); },
      async create(options) { return open('left', options.url); },
      async sendMessage(tabId, message) {
        ensureActive();
        const side = sideForTab(tabId);
        tab(side);
        return sendToPage(side, clone(message));
      },
      onRemoved: removed,
      onUpdated: updated,
    },
    windows: {
      async get(id) { ensureActive(); return windowInfo(id); },
      async getLastFocused() { ensureActive(); return windowInfo(); },
      async update(id) { ensureActive(); return windowInfo(id); },
      async create(options) { return { ...windowInfo(2), tabs: [await open('right', options.url)] }; },
    },
    sidePanel: { async setPanelBehavior() { } },
    alarms: {
      onAlarm: alarms,
      async clear(name) {
        const handle = timers.get(name);
        if (!handle) return false;
        clearTimeout(handle);
        timers.delete(name);
        return true;
      },
      async create(name, options) {
        ensureActive();
        await this.clear(name);
        const delay = Math.max(0, Number(options.when) - Date.now());
        const handle = setTimeout(() => {
          timers.delete(name);
          if (!disposed) alarms.emit({ name });
        }, Math.min(delay, 2147483647));
        handle.unref?.();
        timers.set(name, handle);
      },
    },
  };

  installCoordinator(chrome);

  function invoke(message, sender = {}) {
    ensureActive();
    return new Promise((resolve, reject) => {
      const listeners = [...runtimeMessages.listeners];
      if (listeners.length !== 1) return reject(new Error('The debate coordinator is unavailable.'));
      let responded = false;
      const respond = (value) => {
        if (!responded) { responded = true; resolve(clone(value)); }
      };
      try {
        const deferred = listeners[0](clone(message), sender, respond);
        if (!deferred && !responded) resolve({ ok: false, error: 'Unsupported browser command.' });
      } catch (error) { reject(error); }
    });
  }

  return {
    request(type, payload = {}) {
      if (!CONTROL_COMMANDS.has(type)) return Promise.resolve({ ok: false, error: 'Unsupported browser command.' });
      // The command chosen by the host cannot be replaced by a payload field.
      return invoke({ ...payload, type });
    },
    async getState() {
      const response = await invoke({ type: 'GET_STATE' });
      if (!response.ok) throw new Error(response.error);
      return response.state;
    },
    stop() { return invoke({ type: 'STOP' }); },
    pageEvent(side, message) {
      if (disposed) return Promise.resolve({ ok: true, ignored: true });
      if (!SIDES.includes(side) || !message || !PAGE_EVENTS.has(message.type)) {
        return Promise.resolve({ ok: false, error: 'Unsupported page event.' });
      }
      if (!pages[side].opened) return Promise.resolve({ ok: true, ignored: true });
      // The main process validates the IPC sender before calling this method.
      // A page cannot impersonate the other pane or issue control commands.
      const url = pageUrl(side);
      if (!/^https:\/\/chatgpt\.com(?:\/|$)/i.test(url || '')) {
        return Promise.resolve({ ok: true, ignored: true });
      }
      // Initial page status can arrive before loadURL resolves. It is harmless
      // until OPEN_LAYOUT commits the new IDs; it must not break preload startup.
      return invoke(message, { tab: { id: TAB_IDS[side], windowId: WINDOW_IDS[side], url }, url });
    },
    pageClosed(side) {
      if (!SIDES.includes(side) || disposed) return;
      pages[side].opened = false;
      removed.emit(TAB_IDS[side]);
    },
    pageNavigation(side, url) {
      if (!SIDES.includes(side) || disposed || typeof url !== 'string') return;
      pages[side].url = url;
      updated.emit(TAB_IDS[side], { url });
    },
    async reset() {
      ensureActive();
      await invoke({ type: 'STOP' });
      await chrome.storage.session.set({ convergeState: initialState() });
      for (const side of SIDES) pages[side] = { opened: false, url: 'about:blank' };
      for (const name of [...timers.keys()]) await chrome.alarms.clear(name);
      return clone(storage.convergeState);
    },
    async dispose() {
      if (disposed) return;
      await invoke({ type: 'STOP' });
      disposed = true;
      for (const name of [...timers.keys()]) await chrome.alarms.clear(name);
      for (const event of [runtimeMessages, installed, removed, updated, alarms]) event.clear();
    },
  };
}

module.exports = { createDesktopCoordinator };
