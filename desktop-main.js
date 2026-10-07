'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, clipboard, shell, screen, Menu, nativeImage } = require('electron');
const { platform } = require('node:process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseCookies } = require('./src/browser/cookies');
const { createDesktopCoordinator } = require('./src/browser/desktop-coordinator');
const { createBossCoordinator } = require('./src/browser/boss-coordinator');
const { MIME, MAX_FILE_BYTES, MAX_TOTAL_BYTES, FILE_LIMIT_MESSAGE, validateExport, validateTextSource, providerUploadAdvice } = require('./src/browser/files');
const { createFileStore, copyStoredFile } = require('./src/browser/file-store');
const { sendUpload } = require('./src/browser/upload-transport');
const { createDownloadBroker } = require('./src/browser/downloads');
const { createStudioDesktop } = require('./src/platform/studio-desktop');
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
  const nativeExports = new Map();
  const activeUploads = new Set();
  const activeFileReads = new Set();
  const activeFileSaves = new Set();
  const fileStore = createFileStore({ directory: path.join(app.getPath('userData'), 'file-cache') });
  let uploadProgress = null;
  const MAX_RESPONSE_CHARS = Math.ceil(256 * 1024 * 1024 / 3) * 4 + 2_000_000;
  let hasSession = false;
  let closing = false;
  let opening = false;
  let fileOperation = false;
  let workspaceOperation = false;
  let nativeWorkEpoch = 0;
  let effectsPaused = false;
  let chatTheme = 'night';
  let closedCleanup = Promise.resolve();
  const emit = (channel, data) => {
    if (channel === 'converge:state' && uploadProgress) data = { ...data, attachments: { ...data.attachments, progress: { ...uploadProgress } } };
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  };
  let lastProgressAt = 0;
  function reportUploadProgress(progress) {
    if (!progress && !uploadProgress) return;
    uploadProgress = progress;
    const now = Date.now();
    if (progress && progress.processedBytes !== progress.totalBytes && now - lastProgressAt < 150) return;
    lastProgressAt = now;
    if (coordinator && !closing) void coordinator.getState().then(state => emit('converge:state', { ...state, hasSession, projectInfo: studio.getInfo() })).catch(() => {});
  }
  const assertWindowOpen = () => {
    if (closing || closeRequested || mainWindow.isDestroyed()) throw new Error('This workspace is closing.');
  };
  const captureNativeWork = () => {
    const token = nativeWorkEpoch;
    return () => {
      assertWindowOpen();
      if (token !== nativeWorkEpoch) throw new Error('This operation was stopped by the user. Choose the action again to continue.');
    };
  };
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
  function rejectPending(side, error, code) {
    for (const [id, task] of pending) if (task.side === side) {
      clearTimeout(task.timer); pending.delete(id); task.reject(Object.assign(new Error(error), code ? { code } : {}));
    }
  }
  async function sendToPage(side, message) {
    if (qaOrigin && message?.type === 'RESUME_OBSERVATION' && message.observationUrl?.startsWith('https://chatgpt.com/')) {
      const expected = new URL(message.observationUrl);
      message = { ...message, observationUrl: `${qaOrigin}${expected.pathname}${expected.search}` };
    }
    if (!['UPLOAD_FILES', 'SEND_PROMPT'].includes(message?.type) || !message.files?.length) return sendSmallToPage(side, message);
    const ownedMessage = message.type === 'UPLOAD_FILES' && !message.runId ?
      { ...message, runId: `native-upload-${randomUUID()}`, requestId: randomUUID() } : message;
    const controller = new AbortController();
    const upload = { side, message: ownedMessage, controller };
    activeUploads.add(upload);
    try {
      return await sendUpload((target, payload) => {
        // Cleanup is scoped to the old transfer. A navigated/unready page no
        // longer owns that staging buffer and must not delay cancellation.
        if (payload.type === 'FILE_STAGE_ABORT') return ready.has(target) ? sendSmallToPage(target, payload) : Promise.resolve({ ok: true });
        return sendSmallToPage(target, payload, controller.signal);
      }, side, ownedMessage, { signal: controller.signal,
        onProgress(progress) {
          coordinator.sourceUploadProgress?.({ ...progress, side });
          reportUploadProgress({ ...progress, side, totalPages: SIDES.length });
        } });
    } finally { activeUploads.delete(upload); reportUploadProgress(null); }
  }
  async function sendSmallToPage(side, message, signal) {
    const assertNotAborted = () => { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('The file operation was stopped.'); };
    assertNotAborted();
    const view = views[side];
    if (!view || view.webContents.isDestroyed() || !permitted(view.webContents.getURL())) throw new Error(`${side} ChatGPT page is not open.`);
    const until = Date.now() + 30_000;
    while (!ready.has(side)) {
      assertNotAborted();
      if (closing || Date.now() > until) throw new Error(`${side} page bridge did not become ready. Reload the page.`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assertNotAborted();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      // File operations include provider processing and five bounded downloads.
      // Prompt acknowledgment covers upload only; reasoning uses its own clock.
      const timeoutMs = message.type === 'EXPORT_MEDIA' ? 3 * 60 * 60_000 :
        ['UPLOAD_FILES', 'FILE_STAGE_COMMIT'].includes(message.type) || message.type === 'SEND_PROMPT' && message.files?.length ? 35 * 60_000 :
        ['SEND_PROMPT', 'PREPARE'].includes(message.type) ? 60_000 : 35_000;
      const abort = () => {
        const task = pending.get(id);
        if (!task) return;
        pending.delete(id); clearTimeout(task.timer); task.reject(signal.reason instanceof Error ? signal.reason : new Error('The file operation was stopped.'));
      };
      const settle = callback => value => { signal?.removeEventListener('abort', abort); callback(value); };
      const timer = setTimeout(() => { const task = pending.get(id); pending.delete(id); task?.reject(new Error(`${side} page did not acknowledge ${message.type}.`)); }, timeoutMs);
      pending.set(id, { side, resolve: settle(resolve), reject: settle(reject), timer, message });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      view.webContents.send('converge:page-request', { id, message });
    });
  }
  let coordinator;
  const studio = createStudioDesktop({ directory: path.join(app.getPath('userData'), 'projects'), dialogs: fileDialogs, shell, nativeImage,
    onChange() { if (coordinator) void coordinator.getState().then(state => emit('converge:state', { ...state, hasSession, projectInfo: studio.getInfo() })).catch(() => {}); } });
  coordinator = (options.legacyCoordinator === true ? createDesktopCoordinator : createBossCoordinator)({
    // Accelerated clocks are confined to a local offline QA harness. A normal
    // workspace always uses the coordinator's five-minute supervision clock.
    ...(qaOrigin && Number.isFinite(options.qaSupervisionIntervalMs) ?
      { supervisionIntervalMs: Math.max(250, options.qaSupervisionIntervalMs) } : {}),
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
    onState(state) { emit('converge:state', { ...state, hasSession, projectInfo: studio.getInfo() }); },
    runVerification: studio.verification,
    onCheckpoint: studio.checkpoint,
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
        ready.delete(side);
        if (!opening && permitted(url)) void coordinator.pageReload?.(side)?.catch(() => {});
        rejectPending(side, 'ChatGPT navigated.', 'page-navigation');
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
    ingestFile: fileStore.ingest,
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
      assertWindowOpen();
      if (['browser:import', 'browser:clear', 'browser:open', 'browser:reset-chats', 'browser:prepare',
        'browser:start', 'browser:boss-message', 'browser:attach', 'browser:save-files', 'browser:reload'].includes(channel) && studio.isBusy?.()) {
        throw new Error('Wait for the current project operation to finish.');
      }
      return operation(payload);
    });
  }
  const assertIdle = async (ownOperation = false) => {
    assertWindowOpen();
    if (!ownOperation && (fileOperation || workspaceOperation || opening)) throw new Error('Wait for the workspace operation to finish.');
    if ((await coordinator.getState()).status === 'running') throw new Error('Stop the current exchange before changing pages or session.');
    assertWindowOpen();
  };
  const exclusive = (kind, operation) => async payload => {
    assertWindowOpen();
    if (fileOperation || workspaceOperation || opening || studio.isBusy?.()) throw new Error('Wait for the workspace operation to finish.');
    if (kind === 'file') fileOperation = true;
    else workspaceOperation = true;
    try { return await operation(payload); }
    finally { if (kind === 'file') fileOperation = false; else workspaceOperation = false; }
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
  const openPages = exclusive('workspace', async (payload) => {
    const assertCurrentWork = captureNativeWork();
    await assertIdle(true);
    assertCurrentWork();
    if (!hasSession) throw new Error('Import your ChatGPT cookies first, then choose a chat type.');
    const chatMode = payload?.chatMode || 'normal';
    if (!['temporary', 'normal', 'work'].includes(chatMode)) throw new Error('Choose Temporary, Normal or Work mode.');
    opening = true;
    try { return await coordinator.request('OPEN_LAYOUT', { chatMode }); } finally { opening = false; }
  });
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
    return { version: app.getVersion(), platform, hasSession, windowVisible: windowVisible(), windowState: windowState(), state: { ...(await coordinator.getState()), projectInfo: studio.getInfo() } };
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
  handle('browser:import', exclusive('workspace', async (text) => {
    await assertIdle(true);
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
  }));
  handle('browser:clear', exclusive('workspace', async () => {
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
  }));
  handle('browser:open', openPages);
  handle('browser:reset-chats', exclusive('workspace', async () => {
    await assertIdle(true);
    await unloadPages();
    return { ok: true, hasSession, state: await coordinator.getState() };
  }));
  handle('browser:prepare', exclusive('workspace', async () => {
    const assertCurrentWork = captureNativeWork();
    await assertIdle(true); assertCurrentWork(); return coordinator.request('PREPARE');
  }));
  handle('browser:start', exclusive('workspace', async (payload) => {
    const assertCurrentWork = captureNativeWork();
    await assertIdle(true); assertCurrentWork(); return coordinator.request('START', payload);
  }));
  handle('browser:stop', async () => {
    nativeWorkEpoch += 1;
    for (const controller of activeFileReads) controller.abort(new Error('This file operation was stopped by the user.'));
    reportUploadProgress(null);
    for (const upload of activeUploads) {
      upload.controller.abort(new Error('This file operation was stopped by the user.'));
      // Cancel exactly the upload that was dispatched. Never queue a general
      // CANCEL behind readiness or cancel a completed candidate's user export.
      if (ready.has(upload.side)) void sendSmallToPage(upload.side, { type: 'CANCEL',
        runId: upload.message.runId, requestId: upload.message.requestId, stopGeneration: false }).catch(() => {});
    }
    return coordinator.stop();
  });
  handle('browser:boss-message', async (payload) => {
    if (fileOperation || workspaceOperation || opening) throw new Error('Wait for the workspace operation to finish.');
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
  handle('browser:attach', exclusive('file', async (payload = {}) => {
    const fileRole = payload.fileRole ?? 'content-source';
    if (!['content-source', 'style-reference'].includes(fileRole)) throw new Error('Choose content files or a design reference.');
    const assertCurrentWork = captureNativeWork();
    await assertIdle(true);
    assertCurrentWork();
    const attachmentState = await coordinator.getState();
    assertCurrentWork();
    if (['partial', 'failed'].includes(attachmentState.attachments?.status)) {
      return await coordinator.request('RECHECK_ATTACHMENTS');
    }
    const chosen = await fileDialogs.showOpenDialog(mainWindow, { title: fileRole === 'style-reference' ? 'Attach design references for appearance only' : 'Attach source files to the boss and both workers', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images, documents and source code', extensions: Object.keys(MIME) }] });
    assertCurrentWork();
    if (chosen.canceled) return { ok: true, canceled: true, state: await coordinator.getState() };
    if (chosen.filePaths.length > 5) throw new Error('Choose up to five files.');
    const files = []; let total = 0;
    const controller = new AbortController(); activeFileReads.add(controller);
    try { for (const [fileIndex, filename] of chosen.filePaths.entries()) {
      const stat = await fs.stat(filename); total += stat.size;
      assertCurrentWork();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
      const mimeType = MIME[path.extname(filename).slice(1).toLowerCase()];
      if (!mimeType) throw new Error('Unsupported file type.');
      const warning = providerUploadAdvice(path.basename(filename), mimeType, stat.size);
      if (stat.size > 4 * 1024 * 1024) {
        const file = await fileStore.ingest(filename, { name: path.basename(filename), mimeType, signal: controller.signal,
          onProgress(progress) { reportUploadProgress({ phase: 'reading', ...progress, fileName: path.basename(filename),
            fileIndex, fileCount: chosen.filePaths.length, warning }); } });
        assertCurrentWork(); files.push(file); continue;
      }
      const bytes = await fs.readFile(filename);
      assertCurrentWork();
      if (!bytes.length || bytes.length > MAX_FILE_BYTES || files.reduce((sum, file) => sum + (file.byteLength ?? Buffer.byteLength(file.base64, 'base64')), 0) + bytes.length > MAX_TOTAL_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
      validateTextSource(path.basename(filename), mimeType, bytes);
      files.push({ name: path.basename(filename), mimeType, base64: bytes.toString('base64') });
    }
    assertCurrentWork();
    return await coordinator.request('ATTACH_FILES', { files, fileRole });
    } finally { activeFileReads.delete(controller); reportUploadProgress(null); }
  }));
  handle('browser:save-files', exclusive('file', async (payload = {}) => {
    const names = [];
    try {
      const state = await coordinator.getState();
      // Capture retained, verified bytes before the picker opens. Downloading
      // a checkpoint neither needs a connected page nor pauses the team.
      const candidate = typeof coordinator.getDeliverySnapshot === 'function'
        ? await coordinator.getDeliverySnapshot(payload) : await coordinator.getCurrentCandidate();
      if (!candidate?.media?.files?.length) throw new Error('The current answer has no downloadable files.');
      if (payload.deliveryId && payload.deliveryId !== candidate.id ||
          payload.candidateId && payload.candidateId !== (candidate.candidateId || candidate.id) ||
          payload.sha256 && payload.sha256 !== candidate.sha256) {
        throw new Error('The displayed output changed before the download started. Choose the file again.');
      }
      const captured = candidate.files?.map((file, index) => ({ ...candidate.media.files[index], ...file }));
      let files = validateExport(candidate.media, { ok: true, files: captured });
      if (payload.files !== undefined) {
        if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > files.length) throw new Error('Choose an available output file.');
        const selected = new Set();
        files = payload.files.map(identity => {
          const index = candidate.media.files.findIndex(file => file.name === identity?.name && file.contentSha256 === identity?.contentSha256);
          if (index < 0 || selected.has(index)) throw new Error('The selected output file is unavailable or changed.');
          selected.add(index); return files[index];
        });
      }
      for (const file of files) {
        assertWindowOpen();
        const extensions = Object.keys(MIME).filter((key) => MIME[key] === file.mimeType);
        const chosen = await fileDialogs.showSaveDialog(mainWindow, {
          title: candidate.status === 'agreed' && candidate.draft !== true ? 'Save final reviewed file' : 'Save unfinished checkpoint file',
          defaultPath: file.name, filters: [{ name: 'Reviewed file', extensions }],
        });
        if (chosen.canceled) return { ok: true, saved: names.length, names, canceled: true };
        if (!chosen.filePath) throw new Error('No output file was selected.');
        assertWindowOpen();
        if (file.blobId) {
          const controller = new AbortController(); activeFileSaves.add(controller);
          try { await copyStoredFile(file, chosen.filePath, { signal: controller.signal }); }
          finally { activeFileSaves.delete(controller); }
        }
        else await fs.writeFile(chosen.filePath, file.bytes);
        names.push(path.basename(chosen.filePath));
      }
      return { ok: true, saved: names.length, names, canceled: false };
    } catch (error) {
      return { ok: false, saved: names.length, names,
        error: error.message + (names.length ? ` Already saved: ${names.join(', ')}.` : '') };
    }
  }));
  handle('browser:bounds', (bounds) => {
    const [width, height] = mainWindow.getContentSize();
    for (const side of SIDES) {
      const value = bounds?.[side];
      if (!value || ['x','y','width','height'].some((key) => !Number.isFinite(value[key])) || value.width < 80 || value.height < 80) {
        views[side].setBounds({ x: 0, y: 0, width: 0, height: 0 });
        views[side].setVisible(false); continue;
      }
      const x = Math.max(0, Math.min(width, Math.round(value.x))); const y = Math.max(0, Math.min(height, Math.round(value.y)));
      const box = { x, y, width: Math.max(0, Math.min(width - x, Math.round(value.width))), height: Math.max(0, Math.min(height - y, Math.round(value.height))) };
      views[side].setBounds(box); views[side].setVisible(box.width >= 80 && box.height >= 80);
    }
    return { ok: true };
  });
  handle('browser:reload', exclusive('workspace', async (side) => {
    await assertIdle(true);
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
  }));
  handle('browser:expand', (side) => { if (side && !SIDES.includes(side)) throw new Error('Unknown chat.'); if (side) views[side].webContents.focus(); return { ok: true }; });
  handle('browser:copy', async (text) => { if (typeof text !== 'string' || text.length > 200_000) throw new Error('Invalid answer text.'); await clipboard.writeText(text); return { ok: true }; });
  handle('browser:save', async (payload) => {
    // The bounded revision record includes the original answer and reported
    // changes as well as the current answer.
    if (typeof payload?.content !== 'string' || payload.content.length > 2_000_000) throw new Error('Invalid review export text.');
    const chosen = await fileDialogs.showSaveDialog(mainWindow, { defaultPath: String(payload.defaultName || 'converge-answer.md').replace(/[\\/:*?"<>|]/g, '-'), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    assertWindowOpen();
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
    pending.delete(payload.id); clearTimeout(task.timer);
    if (payload.response?.chunked === true) {
      try {
        if (task.responseChunks?.length !== payload.response.totalChunks || task.responseLength !== payload.response.totalLength) throw new Error('The page response was not received in full.');
        task.resolve(JSON.parse(task.responseChunks.join('')));
      } catch (error) { task.reject(error); }
    } else task.resolve(payload.response);
  };
  const pageResponseChunk = (event, payload) => {
    const side = pageSide(event); const task = pending.get(payload?.id);
    if (!side || !task || task.side !== side || event.senderFrame !== event.sender.mainFrame || !permitted(event.senderFrame.url)) return;
    task.responseChunks ||= [];
    task.responseLength ||= 0;
    if (payload.index !== task.responseChunks.length || typeof payload.data !== 'string' || !payload.data.length || payload.data.length > 1024 * 1024 ||
        task.responseLength + payload.data.length > MAX_RESPONSE_CHARS) {
      pending.delete(payload.id); clearTimeout(task.timer); task.reject(new Error('Invalid or oversized page response chunk.')); return;
    }
    task.responseChunks.push(payload.data); task.responseLength += payload.data.length;
  };
  const pageEvent = (event, payload) => {
    const side = pageSide(event);
    if (!side || event.senderFrame !== event.sender.mainFrame || !permitted(event.senderFrame.url)) return;
    return coordinator.pageEvent(side, payload);
  };
  ipcMain.on('converge:page-ready', pageReady);
  ipcMain.on('converge:page-response', pageResponse);
  ipcMain.on('converge:page-response-chunk', pageResponseChunk);
  ipcMain.handle('converge:page-event', pageEvent);
  const downloadRequest = (operation) => async (event, payload) => {
    const side = pageSide(event);
    if (!side || event.senderFrame !== event.sender.mainFrame || !permitted(event.senderFrame.url)) {
      return { ok: false, error: 'Download request denied.' };
    }
    return operation(side, payload);
  };
  ipcMain.handle('converge:download-begin', downloadRequest((side, payload) => downloads.begin(side, payload)));
  ipcMain.handle('converge:download-read', downloadRequest(async (side, payload) => {
    const result = await downloads.read(side, payload?.token);
    if (!result?.ok || typeof result.base64 !== 'string' || result.base64.length <= 4 * 1024 * 1024) return result;
    const key = `${side}:${payload.token}`;
    const timer = setTimeout(() => nativeExports.delete(key), 15 * 60_000); timer.unref?.();
    nativeExports.set(key, { base64: result.base64, offset: 0, timer });
    const { base64, ...metadata } = result;
    return { ...metadata, chunked: true, totalLength: base64.length };
  }));
  ipcMain.handle('converge:download-chunk', downloadRequest((side, payload) => {
    const key = `${side}:${payload?.token}`; const entry = nativeExports.get(key);
    if (!entry || payload.offset !== entry.offset) return { ok: false, error: 'The native download chunk is missing or out of order.' };
    const data = entry.base64.slice(entry.offset, entry.offset + 1024 * 1024);
    entry.offset += data.length;
    const done = entry.offset === entry.base64.length;
    if (done) { clearTimeout(entry.timer); nativeExports.delete(key); }
    return { ok: true, data, done };
  }));
  ipcMain.handle('converge:download-cancel', downloadRequest((side, payload) => {
    const key = `${side}:${payload?.token}`; const entry = nativeExports.get(key);
    if (entry) { clearTimeout(entry.timer); nativeExports.delete(key); }
    return downloads.cancel(side, payload?.token);
  }));
  if (options.legacyCoordinator !== true) studio.register({ handle, getCoordinator: () => coordinator, assertIdle, unloadPages });
  mainWindow.on('closed', () => {
    closing = true; coordinator.dispose();
    for (const controller of activeFileReads) controller.abort(new Error('The app closed.'));
    for (const controller of activeFileSaves) controller.abort(new Error('The app closed during the file save.'));
    for (const upload of activeUploads) upload.controller.abort(new Error('The app closed.'));
    const downloadCleanup = downloads.dispose().catch(() => {});
    for (const side of SIDES) { rejectPending(side, 'The app closed.'); if (!views[side].webContents.isDestroyed()) views[side].webContents.close(); }
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.removeHandler('converge:page-event'); ipcMain.removeListener('converge:page-ready', pageReady); ipcMain.removeListener('converge:page-response', pageResponse); ipcMain.removeListener('converge:page-response-chunk', pageResponseChunk);
    for (const entry of nativeExports.values()) clearTimeout(entry.timer);
    nativeExports.clear();
    for (const channel of ['converge:download-begin', 'converge:download-read', 'converge:download-chunk', 'converge:download-cancel']) ipcMain.removeHandler(channel);
    // Closing a window on macOS leaves the application in the Dock. Do not
    // retain that closed workspace's imported cookies in a live partition.
    hasSession = false;
    closedCleanup = Promise.all([downloadCleanup, studio.dispose(), Promise.resolve(browserSession.clearData?.()).catch(() => {})])
      .finally(() => fileStore.close());
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
    return owned.mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const began=performance.now();const check=()=>{const version=document.getElementById('version')?.textContent;if(version===${JSON.stringify(`v${app.getVersion()}`)}){const ids=['windowMinimize','windowMaximize','windowClose','chooseCookies','leftSlot','rightSlot','toggleBoss','closeBoss','bossSlot','bossMessageInput'];resolve({version,platformHint:document.getElementById('startShortcutModifier')?.textContent,controls:ids.every(id=>!!document.getElementById(id)),sessionImported:document.getElementById('sessionBadge')?.textContent==='Imported'});return;}if(performance.now()-began>5000){reject(Error('Native shell bootstrap did not settle'));return;}setTimeout(check,25);};check();})`);
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
    for (const side of ['shell', ...SIDES, 'bossInstruction']) {
      // Use the real drawer controls and their measured slot geometry. There
      // is no imported session in this smoke, so provider layout is inactive;
      // blank local views only exercise native first-responder editing here.
      for (const viewSide of SIDES) desktop.views[viewSide].setVisible(false);
      const bossSurface = side === 'boss' || side === 'bossInstruction';
      await desktop.mainWindow.webContents.executeJavaScript(`(()=>{const boss=document.getElementById('bossDrawer');if(boss.hidden===${bossSurface})document.getElementById('toggleBoss').click();const app=document.getElementById('app');if(app.classList.contains('sidebar-collapsed')===${side === 'shell'})document.getElementById('toggleSidebar').click();})()`);
      if (bossSurface) {
        await poll(() => desktop.mainWindow.webContents.executeJavaScript("document.getElementById('bossDrawer').hidden===false && document.getElementById('toggleBoss').getAttribute('aria-expanded')==='true'"), true, 'boss drawer open');
        await desktop.mainWindow.webContents.executeJavaScript("Promise.all(document.getElementById('bossDrawer').getAnimations().map(animation=>animation.finished.catch(()=>{})))");
      }
      const shellSurface = side === 'shell' || side === 'bossInstruction';
      const editorId = side === 'bossInstruction' ? 'bossMessageInput' : 'question';
      const contents = shellSurface ? desktop.mainWindow.webContents : desktop.views[side].webContents;
      if (!shellSurface) {
        await contents.loadURL('about:blank');
        const slotId = side === 'boss' ? 'bossSlot' : `${side}Slot`;
        const bounds = await desktop.mainWindow.webContents.executeJavaScript(`(()=>{const r=document.getElementById(${JSON.stringify(slotId)}).getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
        assert.ok(bounds.width >= 80 && bounds.height >= 80, `${side} native editing slot is not visible`);
        desktop.views[side].setBounds(bounds);
        desktop.views[side].setVisible(true);
        await contents.executeJavaScript("document.body.innerHTML='<textarea id=question></textarea>'");
      }
      const copyText = `CONVERGE_NATIVE_COPY_${side}`, pasteText = `CONVERGE_NATIVE_PASTE_${side}`;
      await contents.executeJavaScript(`document.getElementById(${JSON.stringify(editorId)}).value=${JSON.stringify(copyText)};document.getElementById(${JSON.stringify(editorId)}).focus()`);
      app.focus({ steal: true }); desktop.mainWindow.focus(); contents.focus();
      await poll(() => contents.isFocused(), true, `${side} native first responder`);
      await poll(() => contents.executeJavaScript(`document.activeElement?.id===${JSON.stringify(editorId)}`), true, `${side} editor focus`);
      Menu.sendActionToFirstResponder('selectAll:');
      Menu.sendActionToFirstResponder('copy:');
      await poll(() => clipboard.readText(), copyText, `${side} copy`);
      await clipboard.writeText(pasteText);
      Menu.sendActionToFirstResponder('paste:');
      await poll(() => contents.executeJavaScript(`document.getElementById(${JSON.stringify(editorId)}).value`), pasteText, `${side} paste`);
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
    nativeMenu: true, nativeEditingVerified: editing, bossDrawerVerified: true, didClose: true, embeddedViewsDisposed: true, closeCleanupCompleted: true,
    activateEventComplete: true, freshWorkspaceOnActivate: true,
    activationScope: 'Automated Electron activate event, not physical Dock input',
    providerScope: 'Empty isolated session; no authentication, provider navigation or live model task',
  };
  const secondClosed = new Promise(resolve => reopened.mainWindow.once('closed', resolve));
  reopened.mainWindow.close(); await secondClosed; await reopened.whenClosed();
  process.stdout.write(`CONVERGE_MACOS_NATIVE_SMOKE ${JSON.stringify(report)}\n`);
  app.quit();
}

async function writeWindowsSmokeReport(report) {
  const output = process.env.CONVERGE_WINDOWS_SMOKE_REPORT;
  if (!output) throw new Error('Windows startup smoke requires an isolated report path.');
  const filename = path.resolve(output);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ ...report, nonce: process.env.CONVERGE_WINDOWS_SMOKE_NONCE,
    pid: process.pid, version: app.getVersion(), executable: process.execPath,
    portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE || '', userData: app.getPath('userData') }, null, 2));
  await fs.rename(temporary, filename);
}

async function runNativeWindowsSmoke(lifecycle) {
  if (!app.isPackaged || platform !== 'win32') throw new Error('Native Windows startup smoke requires the packaged Windows app.');
  const assert = require('node:assert/strict');
  assert.equal(app.getVersion(), require('./package.json').version, 'Native build metadata must match its packaged version.');
  await writeWindowsSmokeReport({ status: 'STARTED', platform, arch: process.arch, packaged: app.isPackaged });
  const desktop = await lifecycle.ready;
  const window = desktop.mainWindow;
  const contents = SIDES.map(side => desktop.views[side].webContents);
  const poll = async (operation, label) => {
    const start = Date.now();
    while (Date.now() - start < 7000) {
      if (await operation()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Windows startup did not settle: ${label}`);
  };
  await poll(() => !window.isDestroyed() && window.isVisible(), 'visible first paint');
  assert.deepEqual(Object.keys(desktop.views), SIDES);
  for (const view of contents) assert.ok(['', 'about:blank'].includes(view.getURL()), 'No provider navigation is allowed in startup smoke.');
  const bootstrap = await window.webContents.executeJavaScript('window.convergeBrowser.bootstrap()');
  assert.equal(bootstrap.hasSession, false, 'The smoke must use its empty isolated session.');
  await poll(() => window.webContents.executeJavaScript(`document.getElementById('version')?.textContent===${JSON.stringify(`v${app.getVersion()}`)}`), 'shell version');
  const shell = await window.webContents.executeJavaScript(`(()=>{const ids=['toggleSidebar','question','chooseCookies','toggleBoss','closeBoss','bossMessageInput','bossSlot','leftSlot','rightSlot','toggleResults','activityTab','teamHealth','teamHealthSummary','teamHealthLog','windowClose'];return {controls:ids.every(id=>!!document.getElementById(id)),shortcut:document.getElementById('startShortcutModifier')?.textContent,width:innerWidth,height:innerHeight};})()`);
  assert.equal(shell.controls, true); assert.equal(shell.shortcut, 'Ctrl');
  assert.ok(shell.width >= 640 && shell.height >= 400);
  const firstPaint = await window.webContents.capturePage();
  assert.equal(firstPaint.isEmpty(), false, 'Visible shell first paint was empty.');
  if (process.env.CONVERGE_WINDOWS_SMOKE_SCREENSHOT) {
    const screenshot = path.resolve(process.env.CONVERGE_WINDOWS_SMOKE_SCREENSHOT);
    await fs.mkdir(path.dirname(screenshot), { recursive: true });
    await fs.writeFile(screenshot, firstPaint.toPNG());
  }
  const initiallyCollapsed = await window.webContents.executeJavaScript("document.getElementById('app').classList.contains('sidebar-collapsed')");
  await window.webContents.executeJavaScript("document.getElementById('toggleSidebar').click()");
  await poll(() => window.webContents.executeJavaScript(`document.getElementById('app').classList.contains('sidebar-collapsed')!==${initiallyCollapsed}`), 'sidebar toggle');
  await window.webContents.executeJavaScript("document.getElementById('toggleSidebar').click();document.getElementById('toggleBoss').click()");
  await poll(() => window.webContents.executeJavaScript("document.getElementById('bossDrawer').hidden===false && document.getElementById('toggleBoss').getAttribute('aria-expanded')==='true'"), 'boss drawer open');
  await window.webContents.executeJavaScript("document.getElementById('closeBoss').click()");
  await poll(() => window.webContents.executeJavaScript("document.getElementById('bossDrawer').hidden===true"), 'boss drawer close');
  await window.webContents.executeJavaScript("document.getElementById('toggleResults').click();document.getElementById('activityTab').click()");
  await poll(() => window.webContents.executeJavaScript("document.getElementById('activityPanel').hidden===false && document.getElementById('teamHealthSummary').textContent.includes('5 minutes')"), 'five-minute progress section');
  let holdExit = true;
  const preventEarlyExit = event => { if (holdExit) event.preventDefault(); };
  app.on('before-quit', preventEarlyExit);
  const closed = new Promise(resolve => window.once('closed', resolve));
  try {
    await window.webContents.executeJavaScript("document.getElementById('windowClose').click()").catch(() => {});
    await closed; await desktop.whenClosed();
    assert.ok(contents.every(view => view.isDestroyed()), 'Native Close retained a worker or boss renderer.');
    assert.equal(lifecycle.getCurrent(), null);
    const report = { status: 'PASS', platform, arch: process.arch, packaged: app.isPackaged,
      visibleShell: true, firstPaint: true, embeddedViews: SIDES, sidebarToggleVerified: true,
      bossDrawerVerified: true, progressSectionVerified: true, didClose: true,
      embeddedViewsDisposed: true, closeCleanupCompleted: true, isolatedSession: true,
      providerScope: 'Empty isolated session; no authentication, provider navigation or live model task',
      clipboardScope: 'The Windows startup smoke does not access the clipboard' };
    await writeWindowsSmokeReport(report);
    try { process.stdout.write(`CONVERGE_WINDOWS_NATIVE_SMOKE ${JSON.stringify(report)}\n`); } catch (_) { }
  } finally { holdExit = false; app.removeListener('before-quit', preventEarlyExit); }
  app.quit();
}

module.exports = { createCookieApp };
if (require.main === module) {
  const { installDesktopLifecycle } = require('./src/platform/desktop-lifecycle');
  const nativeSmoke = platform === 'darwin' && process.argv.includes('--converge-native-startup-smoke');
  const windowsSmoke = platform === 'win32' && process.argv.includes('--converge-windows-startup-smoke');
  if (nativeSmoke || windowsSmoke) app.setPath('userData', path.join(app.getPath('temp'), `converge-native-smoke-${process.pid}-${randomUUID()}`));
  const failSmoke = error => {
    if (windowsSmoke) writeWindowsSmokeReport({ status: 'FAIL', error: String(error?.stack || error), platform, packaged: app.isPackaged }).finally(() => app.exit(1));
    else { process.stderr.write(`${error.stack || error.message}\n`); app.exit(1); }
  };
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    const lifecycle = installDesktopLifecycle({ app, Menu, platform, createApp: createCookieApp,
      onError(error) { if (nativeSmoke || windowsSmoke) failSmoke(error);
        else { dialog.showErrorBox('Converge could not start', error.message); app.quit(); } },
    });
    if (nativeSmoke) runNativeMacSmoke(lifecycle).catch(error => { process.stderr.write(`${error.stack || error.message}\n`); app.exit(1); });
    if (windowsSmoke) runNativeWindowsSmoke(lifecycle).catch(failSmoke);
  }
}
