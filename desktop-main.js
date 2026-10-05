'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, clipboard, shell, screen, Menu } = require('electron');
const { platform } = require('node:process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseCookies } = require('./src/browser/cookies');
const { createDesktopCoordinator } = require('./src/browser/desktop-coordinator');
const { createBossCoordinator } = require('./src/browser/boss-coordinator');
const { MIME, validateExport, validateTextSource } = require('./src/browser/files');
const { createDownloadBroker } = require('./src/browser/downloads');
const SIDES = ['left', 'right', 'boss'];

async function createCookieApp(options = {}) {
  const SIDES = options.legacyCoordinator === true ? ['left', 'right'] : ['left', 'right', 'boss'];
  const qaOrigin = options.qaOrigin && /^http:\/\/127\.0\.0\.1:\d+$/.test(options.qaOrigin) ? options.qaOrigin : null;
  // Dialog hooks exist only for an isolated localhost QA app. Production uses
  // native OS dialogs and never accepts a renderer-supplied output path.
  const fileDialogs = qaOrigin && options.dialogs ? options.dialogs : dialog;
  const browserSession = session.fromPartition(`converge-cookie-${randomUUID()}`, { cache: false });
  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  // Keep the custom drag strip reachable on displays smaller than the design
  // viewport, including the taskbar's reserved area.
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const mainWindow = new BrowserWindow({
    title: 'Converge — Boss Workspace',
    width: Math.min(1600, workArea.width), height: Math.min(980, workArea.height),
    minWidth: Math.min(1100, workArea.width), minHeight: Math.min(640, workArea.height),
    show: false, backgroundColor: '#0a1118', icon: path.join(__dirname, platform === 'darwin' ? 'assets/icon.png' : 'assets/icon.ico'),
    frame: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'desktop-preload.js'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webviewTag: false },
  });
  // Show after the shell's first paint so startup does not leave a blank
  // visible surface waiting for a manual resize on Windows.
  const firstPaint = new Promise(resolve => mainWindow.once('ready-to-show', resolve));
  const views = {};
  const pending = new Map();
  const ready = new Set();
  let hasSession = false;
  let closing = false;
  let opening = false;
  let fileOperation = false;
  let effectsPaused = false;
  let chatTheme = 'night';
  let closedCleanup = Promise.resolve();
  const emit = (channel, data) => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); };
  let closeRequested = false;
  mainWindow.on('close', (event) => {
    if (closeRequested || !event?.preventDefault) return;
    event.preventDefault();
    closeRequested = true;
    emit('converge:workspace-closing', {});
    // Allow the shell to stop its measured-bounds/effects callbacks before
    // destroying the renderer and unregistering this window's IPC handlers.
    setTimeout(() => { if (!mainWindow.isDestroyed()) mainWindow.close(); }, 75);
  });
  const pageSide = (event) => SIDES.find((side) => views[side]?.webContents === event.sender);
  const permitted = (url) => {
    try { const parsed = new URL(url); return parsed.origin === 'https://chatgpt.com' || (qaOrigin && parsed.origin === qaOrigin); }
    catch (_) { return false; }
  };
  function rejectPending(side, error) {
    for (const [id, task] of pending) if (task.side === side) {
      clearTimeout(task.timer); pending.delete(id); task.reject(new Error(error));
    }
  }
  async function sendToPage(side, message) {
    const view = views[side];
    if (!view || view.webContents.isDestroyed() || !permitted(view.webContents.getURL())) throw new Error(`${side} ChatGPT page is not open.`);
    const until = Date.now() + 30_000;
    while (!ready.has(side)) {
      if (closing || Date.now() > until) throw new Error(`${side} page bridge did not become ready. Reload the page.`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      // EXPORT_MEDIA handles up to five sequential 45-second native file
      // preparations and the bridge's per-file validation. Keep its IPC owner
      // alive until that bounded operation can acknowledge success or failure.
      const timeoutMs = message.type === 'EXPORT_MEDIA' ? 270_000 : ['SEND_PROMPT', 'PREPARE'].includes(message.type) ? 60_000 : 35_000;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${side} page did not acknowledge ${message.type}.`)); }, timeoutMs);
      pending.set(id, { side, resolve, reject, timer, message });
      view.webContents.send('converge:page-request', { id, message });
    });
  }
  const coordinator = (options.legacyCoordinator === true ? createDesktopCoordinator : createBossCoordinator)({
    async openPage(side, url) {
      ready.delete(side);
      rejectPending(side, 'The page is opening a fresh chat.');
      emit('converge:page', { side, state: 'loading' });
      if (!permitted(url)) throw new Error('The requested chat address is not permitted.');
      const target = qaOrigin ? `${qaOrigin}${new URL(url).pathname}${new URL(url).search}` : url;
      await views[side].webContents.loadURL(target);
    },
    sendToPage,
    getPageUrl(side) { const url = views[side]?.webContents.getURL() || ''; return qaOrigin && url.startsWith(qaOrigin) ? 'https://chatgpt.com/' : url; },
    onState(state) { emit('converge:state', { ...state, hasSession }); },
  });

  for (const side of SIDES) {
    const view = new WebContentsView({ webPreferences: {
      session: browserSession, preload: path.join(__dirname, 'src/browser/page-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false,
      additionalArguments: qaOrigin ? [`--converge-qa-origin=${qaOrigin}`] : [],
    } });
    views[side] = view;
    // Hydrate ChatGPT at a usable size even before the shell measures slots.
    // A 1-pixel initial viewport hides the visible privacy controls.
    view.setBounds({ x: 0, y: 0, width: 580, height: 760 });
    view.setVisible(false);
    mainWindow.contentView.addChildView(view);
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, url) => {
      if (!permitted(url) && url !== 'about:blank') {
        event.preventDefault();
        emit('converge:page', { side, state: 'error', message: 'ChatGPT redirected outside its page. Import a current session or sign in yourself; the app will not change your Chrome account.' });
      }
    });
    view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        ready.delete(side); rejectPending(side, 'ChatGPT navigated.');
        emit('converge:page', { side, state: 'loading' });
        if (!opening) coordinator.pageEvent(side, { type: 'PAGE_STATUS', status: {
          ready: false, authenticated: null, busy: false, temporary: null, unpersonalized: null, work: null,
          reason: 'Loading ChatGPT and checking its composer…',
        } }).catch(() => {});
      }
    });
    view.webContents.on('did-navigate', (_event, url) => {
      if (!opening && !qaOrigin) coordinator.pageNavigation(side, url);
    });
    view.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) emit('converge:page', { side, state: 'error', message: `Page load failed: ${description}` });
    });
    view.webContents.on('render-process-gone', () => {
      ready.delete(side); rejectPending(side, 'ChatGPT page stopped.'); coordinator.pageClosed(side);
    });
    view.webContents.on('did-finish-load', async () => {
      emit('converge:page', { side, state: 'loaded' });
      if (opening || closing || !permitted(view.webContents.getURL())) return;
      try {
        const state = await coordinator.getState();
        if (state.tabIds[side] == null || state.status === 'running') return;
        await sendToPage(side, { type: 'INSPECT', chatMode: state.chatMode, requireUnpersonalized: state.requireUnpersonalized });
      } catch (_) { /* Page status reports hydration when the composer appears. */ }
    });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  const downloads = createDownloadBroker({
    browserSession,
    sideForContents(contents) { return SIDES.find((side) => views[side].webContents === contents); },
    authorize(side, payload) {
      return [...pending.values()].some((task) => task.side === side && task.message.type === 'EXPORT_MEDIA' &&
        task.message.runId === payload.runId && task.message.requestId === payload.requestId &&
        task.message.ids?.includes(payload.id));
    },
  });

  const channels = [];
  function handle(channel, operation) {
    channels.push(channel);
    ipcMain.handle(channel, async (event, payload) => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Request denied.');
      return operation(payload);
    });
  }
  const assertIdle = async () => {
    if (fileOperation) throw new Error('Wait for the file operation to finish.');
    if ((await coordinator.getState()).status === 'running') throw new Error('Stop the current exchange before changing pages or session.');
  };
  const unloadPages = async () => {
    opening = true;
    try {
      ready.clear();
      for (const side of SIDES) { rejectPending(side, 'Chat pages were reset.'); views[side].setVisible(false); }
      await Promise.all(SIDES.map((side) => views[side].webContents.loadURL('about:blank')));
      await coordinator.reset();
    } finally { opening = false; }
  };
  const openPages = async (payload) => {
    await assertIdle();
    if (!hasSession) throw new Error('Import your ChatGPT cookies first, then choose a chat type.');
    const chatMode = payload?.chatMode || 'normal';
    if (!['temporary', 'normal', 'work'].includes(chatMode)) throw new Error('Choose Temporary, Normal or Work mode.');
    opening = true;
    try { return await coordinator.request('OPEN_LAYOUT', { chatMode }); } finally { opening = false; }
  };
  // The native pages deliberately keep their transport timers alive in the
  // background. Suspend only decoration when the host is hidden/minimized;
  // their document visibility can remain visible with background throttling off.
  // Electron 44.5.1's macOS isVisible() inverts its native occlusion flag.
  // Observe the native show/hide transitions instead; Windows retains its
  // existing visibility query. Every workspace starts with show:false.
  let macWindowShown = false;
  const windowVisible = () => !mainWindow.isDestroyed() &&
    (platform === 'darwin' ? macWindowShown : mainWindow.isVisible()) && !mainWindow.isMinimized();
  const windowState = () => ({ maximized: mainWindow.isMaximized(), minimized: mainWindow.isMinimized() });
  const publishWindowState = () => {
    if (!mainWindow.isDestroyed()) emit('converge:window-state', windowState());
  };
  function publishEffectsVisibility() {
    const visible = windowVisible();
    emit('converge:window-visibility', { visible });
    for (const side of SIDES) {
      const contents = views[side].webContents;
      if (!contents.isDestroyed() && permitted(contents.getURL())) {
        contents.send('converge:page-effects', { paused: effectsPaused || !visible });
      }
    }
  }
  for (const event of ['show', 'hide', 'minimize', 'restore']) mainWindow.on(event, () => {
    if (platform === 'darwin') macWindowShown = event === 'show' || event === 'restore';
    publishEffectsVisibility();
  });
  for (const event of ['maximize', 'unmaximize', 'minimize', 'restore']) mainWindow.on(event, publishWindowState);
  handle('browser:bootstrap', async () => {
    publishEffectsVisibility();
    return { version: app.getVersion(), platform, hasSession, windowVisible: windowVisible(), windowState: windowState(), state: await coordinator.getState() };
  });
  handle('browser:window-action', (action) => {
    if (!['minimize', 'toggle-maximize', 'close'].includes(action)) throw new Error('Unknown window action.');
    if (mainWindow.isDestroyed()) throw new Error('The app window is closed.');
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'toggle-maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else {
      // Acknowledge the request before normal window teardown removes the
      // invoking frame. Closing still follows the existing cleanup handler.
      setImmediate(() => { if (!mainWindow.isDestroyed()) mainWindow.close(); });
    }
    return { ok: true, windowState: windowState() };
  });
  handle('browser:effects-paused', (paused) => {
    if (typeof paused !== 'boolean') throw new Error('Invalid effects preference.');
    effectsPaused = paused;
    publishEffectsVisibility();
    return { ok: true };
  });
  handle('browser:import', async (text) => {
    await assertIdle();
    const cookies = parseCookies(text);
    const current = cookies.filter((cookie) => !cookie.expirationDate || cookie.expirationDate > Date.now() / 1000);
    if (!current.length) throw new Error('All exported cookies have expired. Export your current signed-in Chrome session.');
    await unloadPages();
    await browserSession.clearData();
    hasSession = false;
    emit('converge:state', { ...(await coordinator.getState()), hasSession: false });
    try { for (const cookie of current) await browserSession.cookies.set(cookie); }
    catch (_) {
      await browserSession.clearData();
      emit('converge:state', { ...(await coordinator.getState()), hasSession: false });
      throw new Error('The app could not import these cookies. Export a fresh ChatGPT session.');
    }
    hasSession = true;
    // Chrome is a separate process/profile. This clears only the app's pasted
    // input through renderer code; Chrome cookies and clipboard are untouched.
    const state = await coordinator.getState();
    emit('converge:state', { ...state, hasSession: true });
    return { ok: true, count: current.length, hasSession: true, state };
  });
  handle('browser:clear', async () => {
    if (fileOperation) throw new Error('Wait for the file operation to finish.');
    // Teardown emits coordinator/page updates before the IPC response arrives.
    // They must not restore the imported badge while this session is clearing.
    hasSession = false;
    try {
      await coordinator.stop();
      await unloadPages();
      await browserSession.clearData();
      const state = await coordinator.getState();
      emit('converge:state', { ...state, hasSession: false });
      return { ok: true, hasSession: false, state };
    } catch (error) {
      // A failed clear leaves the session unverified, with no false readiness.
      emit('converge:state', { ...(await coordinator.getState()), hasSession: false });
      throw error;
    }
  });
  handle('browser:open', openPages);
  handle('browser:reset-chats', async () => {
    await assertIdle();
    await unloadPages();
    return { ok: true, hasSession, state: await coordinator.getState() };
  });
  handle('browser:prepare', () => coordinator.request('PREPARE'));
  handle('browser:start', async (payload) => { await assertIdle(); return coordinator.request('START', payload); });
  handle('browser:stop', () => coordinator.stop());
  handle('browser:boss-message', async (payload) => {
    if (fileOperation || opening) throw new Error('Wait for the workspace operation to finish.');
    return coordinator.request('BOSS_MESSAGE', payload);
  });
  handle('browser:appearance', (payload) => {
    if (!['night', 'horror', 'alien', 'cyberpunk', 'anime'].includes(payload?.chatTheme)) throw new Error('Choose a supported chat background.');
    chatTheme = payload.chatTheme;
    for (const side of SIDES) {
      const contents = views[side].webContents;
      if (!contents.isDestroyed() && permitted(contents.getURL())) contents.send('converge:page-appearance', { chatTheme });
    }
    return { ok: true, chatTheme };
  });
  handle('browser:attach', async () => {
    await assertIdle();
    fileOperation = true;
    try {
    const chosen = await fileDialogs.showOpenDialog(mainWindow, { title: 'Attach source files to the boss and both workers', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images, documents and source code', extensions: Object.keys(MIME) }] });
    if (chosen.canceled) return { ok: true, canceled: true, state: await coordinator.getState() };
    if (chosen.filePaths.length > 5) throw new Error('Choose up to five files.');
    const files = []; let total = 0;
    for (const filename of chosen.filePaths) {
      const stat = await fs.stat(filename); total += stat.size;
      if (!stat.isFile() || stat.size < 1 || stat.size > 12 * 1024 * 1024 || total > 24 * 1024 * 1024) throw new Error('File limit is 12 MB each and 24 MB total.');
      const mimeType = MIME[path.extname(filename).slice(1).toLowerCase()];
      if (!mimeType) throw new Error('Unsupported file type.');
      const bytes = await fs.readFile(filename);
      validateTextSource(path.basename(filename), mimeType, bytes);
      files.push({ name: path.basename(filename), mimeType, base64: bytes.toString('base64') });
    }
    return await coordinator.request('ATTACH_FILES', { files });
    } finally { fileOperation = false; }
  });
  handle('browser:save-files', async () => {
    await assertIdle();
    fileOperation = true;
    const names = [];
    try {
      const state = await coordinator.getState();
      const candidate = state.candidate;
      if (!candidate?.media?.files?.length) throw new Error('The current answer has no downloadable files.');
      const identity = JSON.stringify({ runId: state.runId, id: candidate.id, media: candidate.media });
      const assertCurrentCandidate = async () => {
        const current = await coordinator.getState();
        if (current.status === 'running' || identity !== JSON.stringify({ runId: current.runId, id: current.candidate?.id, media: current.candidate?.media })) {
          throw new Error('The candidate changed while saving. Select the current result again.');
        }
      };
      const media = candidate.media;
      const exported = await sendToPage(media.side, {
        type: 'EXPORT_MEDIA', runId: media.runId, requestId: media.requestId, ids: media.files.map((file) => file.id),
        // A user can keep a completed candidate after stopping its review.
        // Automatic relay never sets this flag and remains canceled.
        allowCancelled: true,
      });
      const files = validateExport(media, exported);
      for (const file of files) {
        await assertCurrentCandidate();
        const extensions = Object.keys(MIME).filter((key) => MIME[key] === file.mimeType);
        const chosen = await fileDialogs.showSaveDialog(mainWindow, {
          title: state.status === 'agreed' ? 'Save final reviewed file' : 'Save current candidate file',
          defaultPath: file.name, filters: [{ name: 'Reviewed file', extensions }],
        });
        if (chosen.canceled) return { ok: true, saved: names.length, names, canceled: true };
        if (!chosen.filePath) throw new Error('No output file was selected.');
        await assertCurrentCandidate();
        await fs.writeFile(chosen.filePath, file.bytes);
        names.push(path.basename(chosen.filePath));
      }
      return { ok: true, saved: names.length, names, canceled: false };
    } catch (error) {
      return { ok: false, saved: names.length, names,
        error: error.message + (names.length ? ` Already saved: ${names.join(', ')}.` : '') };
    } finally { fileOperation = false; }
  });
  handle('browser:bounds', (bounds) => {
    const [width, height] = mainWindow.getContentSize();
    for (const side of SIDES) {
      const value = bounds?.[side];
      if (!value || ['x','y','width','height'].some((key) => !Number.isFinite(value[key])) || value.width < 80 || value.height < 80) { views[side].setVisible(false); continue; }
      const x = Math.max(0, Math.min(width, Math.round(value.x))); const y = Math.max(0, Math.min(height, Math.round(value.y)));
      const box = { x, y, width: Math.max(0, Math.min(width - x, Math.round(value.width))), height: Math.max(0, Math.min(height - y, Math.round(value.height))) };
      views[side].setBounds(box); views[side].setVisible(box.width >= 80 && box.height >= 80);
    }
    return { ok: true };
  });
  handle('browser:reload', async (side) => {
    await assertIdle();
    if (!SIDES.includes(side)) throw new Error('Unknown chat.');
    if ((await coordinator.getState()).attachments?.status === 'attached') {
      throw new Error('Source files are waiting in both chats. Send your command first, or Reset before reloading and attach the files again.');
    }
    await coordinator.pageEvent(side, { type: 'PAGE_STATUS', status: {
      ready: false, authenticated: null, busy: false, temporary: null, unpersonalized: null, work: null,
      reason: 'Reloading ChatGPT and checking its composer…',
    } });
    emit('converge:page', { side, state: 'loading' });
    views[side].webContents.reload(); return { ok: true };
  });
  handle('browser:expand', (side) => { if (side && !SIDES.includes(side)) throw new Error('Unknown chat.'); if (side) views[side].webContents.focus(); return { ok: true }; });
  handle('browser:copy', async (text) => { if (typeof text !== 'string' || text.length > 200_000) throw new Error('Invalid answer text.'); await clipboard.writeText(text); return { ok: true }; });
  handle('browser:save', async (payload) => {
    // The bounded revision record includes the original answer and reported
    // changes as well as the current answer.
    if (typeof payload?.content !== 'string' || payload.content.length > 2_000_000) throw new Error('Invalid review export text.');
    const chosen = await dialog.showSaveDialog(mainWindow, { defaultPath: String(payload.defaultName || 'converge-answer.md').replace(/[\\/:*?"<>|]/g, '-'), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (chosen.canceled) return { ok: true, saved: false };
    await fs.writeFile(chosen.filePath, payload.content, 'utf8'); return { ok: true, saved: true };
  });
  handle('browser:diagnostics', async () => ({ ok: true, diagnostics: Object.fromEntries(await Promise.all(SIDES.map(async (side) => {
    try { return [side, (await sendToPage(side, { type: 'DIAGNOSTICS' })).diagnostics]; }
    catch (error) { return [side, { error: error.message }]; }
  }))) }));

  const pageReady = (event) => {
    const side = pageSide(event);
    if (side && event.senderFrame === event.sender.mainFrame && permitted(event.senderFrame.url)) {
      ready.add(side);
      event.sender.send('converge:page-effects', { paused: effectsPaused || !windowVisible() });
      event.sender.send('converge:page-appearance', { chatTheme });
    }
  };
  const pageResponse = (event, payload) => {
    const side = pageSide(event); const task = pending.get(payload?.id);
    if (!side || !task || task.side !== side || event.senderFrame !== event.sender.mainFrame || !permitted(event.senderFrame.url)) return;
    pending.delete(payload.id); clearTimeout(task.timer); task.resolve(payload.response);
  };
  const pageEvent = (event, payload) => {
    const side = pageSide(event);
    if (!side || event.senderFrame !== event.sender.mainFrame || !permitted(event.senderFrame.url)) return;
    return coordinator.pageEvent(side, payload);
  };
  ipcMain.on('converge:page-ready', pageReady);
  ipcMain.on('converge:page-response', pageResponse);
  ipcMain.handle('converge:page-event', pageEvent);
  const downloadRequest = (operation) => async (event, payload) => {
    const side = pageSide(event);
    if (!side || event.senderFrame !== event.sender.mainFrame || !permitted(event.senderFrame.url)) {
      return { ok: false, error: 'Download request denied.' };
    }
    return operation(side, payload);
  };
  ipcMain.handle('converge:download-begin', downloadRequest((side, payload) => downloads.begin(side, payload)));
  ipcMain.handle('converge:download-read', downloadRequest((side, payload) => downloads.read(side, payload?.token)));
  ipcMain.handle('converge:download-cancel', downloadRequest((side, payload) => downloads.cancel(side, payload?.token)));
  mainWindow.on('closed', () => {
    closing = true; coordinator.dispose();
    const downloadCleanup = downloads.dispose().catch(() => {});
    for (const side of SIDES) { rejectPending(side, 'The app closed.'); if (!views[side].webContents.isDestroyed()) views[side].webContents.close(); }
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.removeHandler('converge:page-event'); ipcMain.removeListener('converge:page-ready', pageReady); ipcMain.removeListener('converge:page-response', pageResponse);
    for (const channel of ['converge:download-begin', 'converge:download-read', 'converge:download-cancel']) ipcMain.removeHandler(channel);
    // Closing a window on macOS leaves the application in the Dock. Do not
    // retain that closed workspace's imported cookies in a live partition.
    hasSession = false;
    closedCleanup = Promise.all([downloadCleanup, Promise.resolve(browserSession.clearData?.()).catch(() => {})]);
  });
  await mainWindow.loadFile(path.join(__dirname, 'renderer/browser.html'));
  await firstPaint;
  if (options.show !== false && !mainWindow.isDestroyed()) mainWindow.show();
  return { mainWindow, views, coordinator, browserSession, openPages, sendToPage, whenClosed: () => closedCleanup };
}

async function runNativeMacSmoke(lifecycle) {
  if (!app.isPackaged || platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Native startup smoke requires the packaged Apple Silicon app.');
  const assert = require('node:assert/strict');
  const desktop = await lifecycle.ready;
  const poll = async (operation, expected, label) => {
    const began = Date.now();
    while (Date.now() - began < 3000) {
      if (await operation() === expected) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Native check did not settle: ${label}`);
  };
  const checkShell = async (owned) => {
    assert.ok(owned && !owned.mainWindow.isDestroyed());
    // Do not trust Electron 44.5.1's inverted macOS isVisible(). Require
    // both the observed show state and the actual native key window.
    app.focus({ steal: true }); owned.mainWindow.show(); owned.mainWindow.focus();
    await poll(() => owned.mainWindow.isFocused(), true, 'native key window');
    // AppKit's occlusion/show notification can follow its key-window
    // notification when a new workspace reopens. Wait for both independent
    // observations rather than requiring them in the same event-loop turn.
    const readBootstrap = () => owned.mainWindow.webContents.executeJavaScript('window.convergeBrowser.bootstrap()');
    await poll(async () => {
      const observed = await readBootstrap();
      return observed.windowVisible === true && owned.mainWindow.isFocused();
    }, true, 'native show state and key window');
    const bootstrap = await readBootstrap();
    assert.equal(bootstrap.windowVisible, true, 'Native show state was not observed');
    assert.equal(owned.mainWindow.isFocused(), true, 'Native key window focus was lost');
    assert.deepEqual(Object.keys(owned.views), SIDES);
    for (const side of SIDES) assert.ok(['', 'about:blank'].includes(owned.views[side].webContents.getURL()), 'Smoke must not navigate a provider page');
    return owned.mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const began=performance.now();const check=()=>{const version=document.getElementById('version')?.textContent;if(version===${JSON.stringify(`v${app.getVersion()}`)}){const ids=['windowMinimize','windowMaximize','windowClose','chooseCookies','leftSlot','rightSlot'];resolve({version,platformHint:document.getElementById('startShortcutModifier')?.textContent,controls:ids.every(id=>!!document.getElementById(id)),sessionImported:document.getElementById('sessionBadge')?.textContent==='Imported'});return;}if(performance.now()-began>5000){reject(Error('Native shell bootstrap did not settle'));return;}setTimeout(check,25);};check();})`);
  };
  const initial = await checkShell(desktop);
  assert.equal(initial.controls, true); assert.equal(initial.sessionImported, false); assert.equal(initial.platformHint, 'Command');
  assert.ok(Menu.getApplicationMenu(), 'The native application menu is missing');
  if (process.env.CONVERGE_MACOS_SMOKE_SCREENSHOT) {
    const output = path.resolve(process.env.CONVERGE_MACOS_SMOKE_SCREENSHOT);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, (await desktop.mainWindow.webContents.capturePage()).toPNG());
  }
  const previousClipboard = await clipboard.readText();
  const editing = {};
  try {
    for (const side of ['shell', ...SIDES]) {
      const contents = side === 'shell' ? desktop.mainWindow.webContents : desktop.views[side].webContents;
      if (side !== 'shell') {
        await contents.loadURL('about:blank');
        desktop.views[side].setVisible(true);
        await contents.executeJavaScript("document.body.innerHTML='<textarea id=question></textarea>'");
      }
      const copyText = `CONVERGE_NATIVE_COPY_${side}`, pasteText = `CONVERGE_NATIVE_PASTE_${side}`;
      await contents.executeJavaScript(`document.getElementById('question').value=${JSON.stringify(copyText)};document.getElementById('question').focus()`);
      app.focus({ steal: true }); desktop.mainWindow.focus(); contents.focus();
      Menu.sendActionToFirstResponder('selectAll:');
      Menu.sendActionToFirstResponder('copy:');
      await poll(() => clipboard.readText(), copyText, `${side} copy`);
      await clipboard.writeText(pasteText);
      Menu.sendActionToFirstResponder('paste:');
      await poll(() => contents.executeJavaScript("document.getElementById('question').value"), pasteText, `${side} paste`);
      editing[side] = true;
    }
  } finally { await clipboard.writeText(previousClipboard); }
  // Retain the WebContents handles before Close. Electron detaches a destroyed
  // native WebContentsView's webContents property during teardown.
  const ownedContents = SIDES.map(side => desktop.views[side].webContents);
  const firstClosed = new Promise(resolve => desktop.mainWindow.once('closed', resolve));
  // Exercise the real shell button and guarded preload/IPC close path.
  await desktop.mainWindow.webContents.executeJavaScript("document.getElementById('windowClose').click()").catch(() => {});
  await firstClosed; await desktop.whenClosed();
  assert.ok(ownedContents.every(contents => contents.isDestroyed()), 'Closed workspace retained a provider renderer');
  assert.equal(lifecycle.getCurrent(), null);
  app.emit('activate');
  const reopened = await lifecycle.showWindow();
  assert.notEqual(reopened, desktop);
  const restored = await checkShell(reopened);
  assert.equal(restored.sessionImported, false); assert.equal(restored.controls, true);
  const report = { status: 'PASS', platform, arch: process.arch, packaged: app.isPackaged,
    version: app.getVersion(), executable: process.execPath, visibleShell: true, nativeKeyWindow: true,
    visibilityScope: 'Observed native show state and actual native key window after shell first paint', commandShortcutHint: true,
    nativeMenu: true, nativeEditingVerified: editing, didClose: true, embeddedViewsDisposed: true, closeCleanupCompleted: true,
    activateEventComplete: true, freshWorkspaceOnActivate: true,
    activationScope: 'Automated Electron activate event, not physical Dock input',
    providerScope: 'Empty isolated session; no authentication, provider navigation or live model task',
  };
  const secondClosed = new Promise(resolve => reopened.mainWindow.once('closed', resolve));
  reopened.mainWindow.close(); await secondClosed; await reopened.whenClosed();
  process.stdout.write(`CONVERGE_MACOS_NATIVE_SMOKE ${JSON.stringify(report)}\n`);
  app.quit();
}

module.exports = { createCookieApp };
if (require.main === module) {
  const { installDesktopLifecycle } = require('./src/platform/desktop-lifecycle');
  const nativeSmoke = platform === 'darwin' && process.argv.includes('--converge-native-startup-smoke');
  if (nativeSmoke) app.setPath('userData', path.join(app.getPath('temp'), `converge-native-smoke-${process.pid}-${randomUUID()}`));
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    const lifecycle = installDesktopLifecycle({ app, Menu, platform, createApp: createCookieApp,
      onError(error) { if (nativeSmoke) { process.stderr.write(`${error.stack || error.message}\n`); app.exit(1); }
        else { dialog.showErrorBox('Converge could not start', error.message); app.quit(); } },
    });
    if (nativeSmoke) runNativeMacSmoke(lifecycle).catch(error => { process.stderr.write(`${error.stack || error.message}\n`); app.exit(1); });
  }
}
