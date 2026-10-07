'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, clipboard, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { parseCookies } = require('./src/browser/cookies');
const { createOpenAIClient } = require('./src/core/api');
const { runDebate } = require('./src/core/engine');
const { getCodexStatus, createCodexClient } = require('./src/core/codex-cli');

const CHAT_URL = 'https://chatgpt.com/';
const APP_ID = 'app.converge.desktop';
const SIDES = ['left', 'right'];
const smokeImagePath = process.env.CONVERGE_SMOKE_IMAGE;

let mainWindow;
let browserSession;
let views = {};
let cookiesImported = false;
let importedCookieFingerprint;
let currentMode = 'auto';
let apiKey = '';
let activeDebate = null;
const attachmentStore = new Map();

const MIME_TYPES = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.json': 'application/json'
});
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 30 * 1024 * 1024;

function fingerprint(value) {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex');
}

function isImportedCookieText(value) {
  return Boolean(importedCookieFingerprint && value && fingerprint(value) === importedCookieFingerprint);
}

function sendEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('duet:event', payload);
  }
}

function sendAutoEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto:event', payload);
  }
}


function attachmentMetadata(item) {
  return { id: item.id, name: item.name, type: item.type, size: item.size };
}

function selectedAttachments(ids) {
  if (!Array.isArray(ids) || ids.length > 8) throw new Error('Choose up to eight attachments.');
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new Error('An attachment was selected more than once.');
  return ids.map((id) => {
    if (typeof id !== 'string' || !attachmentStore.has(id)) throw new Error('An attachment is no longer available. Add it again.');
    return attachmentStore.get(id).attachment;
  });
}

function cleanSettings(value) {
  if (!value || typeof value !== 'object') return {};
  const model = (side) => {
    const chosen = String(value[side]?.model || '').trim();
    if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(chosen)) throw new Error(`Enter a valid ${side} model ID.`);
    const effort = String(value[side]?.effort || '').trim();
    if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) throw new Error(`Choose a valid ${side} reasoning effort.`);
    return { model: chosen, effort };
  };
  const maxRounds = Number(value.maxRounds);
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 40) throw new Error('Rounds must be between 1 and 40.');
  const debatePrompt = String(value.debatePrompt || '').trim();
  if (debatePrompt.length > 12000) throw new Error('The debate instructions are too long.');
  return { left: model('left'), right: model('right'), maxRounds, debatePrompt };
}

function isAllowedChatOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com') ||
      url.hostname === 'openai.com' || url.hostname.endsWith('.openai.com');
  } catch {
    return false;
  }
}

function getView(side) {
  if (!SIDES.includes(side)) throw new Error('Choose the left or right pane.');
  const view = views[side];
  if (!view || view.webContents.isDestroyed()) throw new Error('That pane is not available.');
  return view;
}

function createChatView(side) {
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false
    }
  });
  view.setVisible(false);
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedChatOrigin(url)) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url).catch(() => {});
    }
  });
  view.webContents.on('did-finish-load', () => {
    sendEvent({ type: 'page', side, state: 'loaded', url: view.webContents.getURL() });
  });
  view.webContents.on('did-start-loading', () => {
    sendEvent({ type: 'page', side, state: 'loading' });
  });
  view.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      sendEvent({ type: 'page', side, state: 'error', message: description || `Load failed (${code})`, url: validatedURL });
    }
  });
  mainWindow.contentView.addChildView(view);
  views[side] = view;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Converge',
    width: 1600,
    height: 970,
    minWidth: 1050,
    minHeight: 690,
    backgroundColor: '#0b1020',
    show: !smokeImagePath,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  createChatView('left');
  createChatView('right');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (smokeImagePath) {
    mainWindow.webContents.once('did-finish-load', async () => {
      if (process.env.CONVERGE_SMOKE_MODE === 'manual') {
        await mainWindow.webContents.executeJavaScript("document.getElementById('modeManual').click();");
      }
      if (process.env.CONVERGE_SMOKE_FOCUS === '1') {
        await mainWindow.webContents.executeJavaScript("document.getElementById('focusMode').click(); document.getElementById('closeSidebar').click();");
      }
      const requestedDelay = Number(process.env.CONVERGE_SMOKE_DELAY_MS);
      const captureDelay = Number.isFinite(requestedDelay) && requestedDelay >= 0 && requestedDelay <= 10000 ? requestedDelay : 750;
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          await fs.writeFile(smokeImagePath, image.toPNG());
          process.stdout.write(`Smoke screenshot saved: ${smokeImagePath}\n`);
        } catch (error) {
          process.stderr.write(`Smoke screenshot failed: ${error.message}\n`);
          process.exitCode = 1;
        } finally {
          app.quit();
        }
      }, captureDelay);
    });
  }
  mainWindow.on('closed', () => {
    if (activeDebate) activeDebate.abortController.abort();
    activeDebate = null;
    apiKey = '';
    attachmentStore.clear();
    for (const side of SIDES) {
      const view = views[side];
      if (view && !view.webContents.isDestroyed()) view.webContents.close();
    }
    views = {};
    mainWindow = null;
  });
}

function validateSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Request denied.');
  }
}

async function loadBoth() {
  const results = await Promise.allSettled(SIDES.map(async (side) => {
    const view = getView(side);
    await view.webContents.loadURL(CHAT_URL);
  }));
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length === 2) throw new Error('Both ChatGPT pages failed to load. Check your internet connection.');
  return { ok: true, failed: failed.length };
}

function normalizedBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const fields = ['x', 'y', 'width', 'height'];
  if (fields.some((key) => !Number.isFinite(value[key]))) return null;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const x = Math.max(0, Math.min(contentWidth, Math.round(value.x)));
  const y = Math.max(0, Math.min(contentHeight, Math.round(value.y)));
  const width = Math.max(0, Math.min(contentWidth - x, Math.round(value.width)));
  const height = Math.max(0, Math.min(contentHeight - y, Math.round(value.height)));
  return width >= 80 && height >= 80 ? { x, y, width, height } : null;
}

function registerHandlers() {
  ipcMain.handle('duet:get-bootstrap', async (event) => {
    validateSender(event);
    return { hasSession: cookiesImported, version: app.getVersion() };
  });

  ipcMain.handle('duet:import-cookies', async (event, payload) => {
    validateSender(event);
    const text = typeof payload === 'string' ? payload : payload?.text;
    const cookies = parseCookies(text);
    await browserSession.clearData();
    try {
      for (const cookie of cookies) await browserSession.cookies.set(cookie);
    } catch {
      await browserSession.clearData();
      cookiesImported = false;
      throw new Error('The browser session could not import these cookies.');
    }
    cookiesImported = true;
    importedCookieFingerprint = fingerprint(text);
    try {
      if (isImportedCookieText(await clipboard.readText())) clipboard.clear();
    } catch { /* Clipboard may be unavailable; paste actions still check it later. */ }
    sendEvent({ type: 'session', state: 'imported', count: cookies.length });
    return { ok: true, count: cookies.length };
  });

  ipcMain.handle('duet:clear-session', async (event) => {
    validateSender(event);
    for (const side of SIDES) getView(side).webContents.stop();
    await browserSession.clearData();
    cookiesImported = false;
    importedCookieFingerprint = undefined;
    await Promise.allSettled(SIDES.map((side) => getView(side).webContents.loadURL('about:blank')));
    sendEvent({ type: 'session', state: 'cleared' });
    return { ok: true };
  });

  ipcMain.handle('duet:open-pages', async (event) => {
    validateSender(event);
    return loadBoth();
  });

  ipcMain.handle('duet:new-chats', async (event) => {
    validateSender(event);
    return loadBoth();
  });

  ipcMain.handle('duet:reload-page', async (event, side) => {
    validateSender(event);
    getView(side).webContents.reload();
    return { ok: true };
  });

  ipcMain.handle('duet:set-view-bounds', async (event, bounds) => {
    validateSender(event);
    for (const side of SIDES) {
      const view = getView(side);
      const box = normalizedBounds(bounds?.[side]);
      if (currentMode === 'manual' && box) {
        view.setBounds(box);
        view.setVisible(true);
      } else {
        view.setVisible(false);
      }
    }
    return { ok: true };
  });

  ipcMain.handle('duet:set-mode', async (event, mode) => {
    validateSender(event);
    if (!['auto', 'manual'].includes(mode)) throw new Error('Choose a valid workspace mode.');
    currentMode = mode;
    if (mode === 'auto') {
      for (const side of SIDES) getView(side).setVisible(false);
    }
    return { ok: true, mode };
  });

  ipcMain.handle('auto:get-auth-status', async (event) => {
    validateSender(event);
    const codex = await getCodexStatus();
    return { hasKey: Boolean(apiKey), codexAvailable: codex.available, codexLoggedIn: codex.loggedIn };
  });

  ipcMain.handle('auto:set-api-key', async (event, value) => {
    validateSender(event);
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key || key.length > 512 || /\s/.test(key) || key.startsWith('{') || key.startsWith('[')) {
      throw new Error('Enter an OpenAI API key. ChatGPT browser cookies cannot be used here.');
    }
    apiKey = key;
    return { ok: true, hasKey: true };
  });

  ipcMain.handle('auto:clear-api-key', async (event) => {
    validateSender(event);
    if (activeDebate) activeDebate.abortController.abort();
    apiKey = '';
    return { ok: true, hasKey: false };
  });

  ipcMain.handle('auto:choose-attachments', async (event) => {
    validateSender(event);
    const chosen = await dialog.showOpenDialog(mainWindow, {
      title: 'Add source files for both analysts',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images, PDF, and text', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'md', 'csv', 'tsv', 'json'] }
      ]
    });
    if (chosen.canceled) return [];
    if (chosen.filePaths.length > 8) throw new Error('Choose up to eight attachments.');
    const incoming = [];
    let totalSize = 0;
    for (const filePath of chosen.filePaths) {
      const name = path.basename(filePath);
      const type = MIME_TYPES[path.extname(name).toLowerCase()];
      if (!type) throw new Error(`The file type of ${name} is not supported.`);
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || stats.size > MAX_ATTACHMENT_BYTES) throw new Error(`${name} exceeds the 15 MB file limit.`);
      if (type.startsWith('text/') || type === 'application/json') {
        if (stats.size > 2 * 1024 * 1024) throw new Error(`${name} exceeds the 2 MB text file limit.`);
      }
      totalSize += stats.size;
      if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Attachments together exceed 30 MB.');
      const bytes = await fs.readFile(filePath);
      const kind = type.startsWith('image/') ? 'image' : type === 'application/pdf' ? 'file' : 'text';
      const id = randomUUID();
      incoming.push({ id, name, type, size: bytes.length, attachment: {
        kind, name, mimeType: type, dataUrl: `data:${type};base64,${bytes.toString('base64')}`
      } });
    }
    attachmentStore.clear();
    for (const item of incoming) attachmentStore.set(item.id, item);
    return incoming.map(attachmentMetadata);
  });

  ipcMain.handle('auto:clear-attachments', async (event) => {
    validateSender(event);
    attachmentStore.clear();
    return { ok: true };
  });

  ipcMain.handle('auto:start', async (event, payload) => {
    validateSender(event);
    if (activeDebate) throw new Error('A debate is already running. Stop it before starting another.');
    const provider = payload?.provider || 'codex';
    if (!['codex', 'api'].includes(provider)) throw new Error('Choose a valid automatic connection.');
    if (provider === 'api' && !apiKey) throw new Error('Enter an OpenAI API key to use the API connection.');
    const question = String(payload?.question || '').trim();
    if (!question || question.length > 20000) throw new Error('Enter a question up to 20,000 characters.');
    const attachments = selectedAttachments(payload?.attachments || []);
    const settings = cleanSettings(payload?.settings);
    if (provider === 'api' && (settings.left.effort === 'ultra' || settings.right.effort === 'ultra')) {
      throw new Error('Ultra effort is available only through the Codex account connection.');
    }
    let client;
    if (provider === 'api') {
      client = createOpenAIClient(apiKey);
    } else {
      const codex = await getCodexStatus();
      if (!codex.available) throw new Error('Codex CLI is not installed. Install it or use an API key.');
      if (!codex.loggedIn) throw new Error('Codex CLI is not signed in with ChatGPT. Sign in with Codex and try again.');
      client = createCodexClient(codex.cliPath);
    }
    const abortController = new AbortController();
    activeDebate = { abortController };
    try {
      return await runDebate({
        client, question, attachments, settings,
        signal: abortController.signal, onEvent: sendAutoEvent
      });
    } finally {
      activeDebate = null;
    }
  });

  ipcMain.handle('auto:stop', async (event) => {
    validateSender(event);
    if (activeDebate) activeDebate.abortController.abort();
    return { ok: true };
  });

  ipcMain.handle('duet:paste-to', async (event, side) => {
    validateSender(event);
    if (isImportedCookieText(await clipboard.readText())) {
      throw new Error('The clipboard still contains your session cookies. Copy the protocol, question, or answer first.');
    }
    const view = getView(side);
    view.webContents.focus();
    view.webContents.paste();
    return { ok: true };
  });

  ipcMain.handle('duet:copy', async (event, value) => {
    validateSender(event);
    if (typeof value !== 'string' || value.length > 200000) throw new Error('Text is too long to copy.');
    await clipboard.writeText(value);
    return { ok: true };
  });

  ipcMain.handle('duet:get-clipboard', async (event) => {
    validateSender(event);
    const value = await clipboard.readText();
    if (isImportedCookieText(value)) return { text: '(Session cookies are on the clipboard. Copy another item before pasting.)' };
    return { text: value.slice(0, 200000) };
  });

  ipcMain.handle('duet:save-text', async (event, payload) => {
    validateSender(event);
    const content = payload?.content;
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 10_000_000) {
      throw new Error('The note is too large to export.');
    }
    const name = String(payload.defaultName || 'converge-notes.md').replace(/[\\/:*?"<>|]/g, '-');
    const chosen = await dialog.showSaveDialog(mainWindow, {
      title: 'Export notes',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }]
    });
    if (chosen.canceled || !chosen.filePath) return { saved: false };
    await fs.writeFile(chosen.filePath, content, 'utf8');
    return { saved: true, path: chosen.filePath };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    browserSession = session.fromPartition('converge-temporary-browser', { cache: false });
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    registerHandlers();
    createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
