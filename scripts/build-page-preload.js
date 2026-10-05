'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'chrome-extension/content.js'), 'utf8');
const galaxy = fs.readFileSync(path.join(root, 'renderer/galaxy-scene.js'), 'utf8');
const appearance = fs.readFileSync(path.join(root, 'src/browser/page-appearance.js'), 'utf8');
const header = `/* Generated from the bridge and desktop-only appearance modules. Run scripts/build-page-preload.js after source changes. */
'use strict';
const { ipcRenderer } = require('electron');
const qaOrigin = process.argv.find((item) => item.startsWith('--converge-qa-origin='))?.slice('--converge-qa-origin='.length);
if (process.isMainFrame && (location.origin === 'https://chatgpt.com' || (qaOrigin && /^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(qaOrigin) && location.origin === qaOrigin))) {
  const listeners = [];
  const runtime = {
    onMessage: { addListener(listener) { listeners.push(listener); } },
    sendMessage(message) { return ipcRenderer.invoke('converge:page-event', message); }
  };
  ipcRenderer.on('converge:page-request', (_event, payload) => {
    let answered = false;
    const respond = (response) => { if (!answered) { answered = true; ipcRenderer.send('converge:page-response', { id: payload.id, response }); } };
    try { for (const listener of listeners) listener(payload.message, {}, respond); }
    catch (error) { respond({ ok: false, error: error.message }); }
  });
  const module = { exports: {} };
`;
const decoration = `
  // Cosmetic failures must never stop the authenticated transport bridge.
  try {
    (() => { const module = { exports: {} }; ${galaxy}\n${appearance}\n })();
  } catch (_) { /* Retain ChatGPT's native appearance if effects cannot load. */ }
  let pageAppearance = null;
  let pageEffectsPaused = false;
  let chatTheme = 'night';
  ipcRenderer.on('converge:page-appearance', (_event, payload) => {
    if (!['night', 'horror', 'alien', 'cyberpunk', 'anime'].includes(payload?.chatTheme)) return;
    chatTheme = payload.chatTheme;
    pageAppearance?.setTheme(chatTheme);
  });
  ipcRenderer.on('converge:page-effects', (_event, payload) => {
    if (typeof payload?.paused !== 'boolean') return;
    pageEffectsPaused = payload.paused;
    pageAppearance?.setPaused(pageEffectsPaused);
  });
`;
const footer = `
  const initialize = () => {
    try {
      pageAppearance = globalThis.ConvergePageAppearance?.create({ document, window, qaOrigin });
      pageAppearance?.setPaused(pageEffectsPaused);
      pageAppearance?.setTheme(chatTheme);
    } catch (_) { /* A decoration is optional; composer and file transport remain native. */ }
    module.exports.createBridge({ chrome: { runtime }, document, window,
      async downloadVisible({ element, runId, requestId, id, name, mimeType, signal, isCurrent }) {
        if (signal.aborted) return { ok: false, error: 'File export canceled.' };
        const started = await ipcRenderer.invoke('converge:download-begin', { runId, requestId, id, name, mimeType });
        if (!started?.ok) return started;
        const token = started.token;
        const cancel = () => { ipcRenderer.invoke('converge:download-cancel', { token }).catch(() => {}); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          if (signal.aborted) { cancel(); return await ipcRenderer.invoke('converge:download-read', { token }); }
          // Authorization yields to IPC. Recheck this exact captured action
          // and source before its one click; a React replacement must not be
          // clicked through or left waiting for a download that never starts.
          if (element?.isConnected !== true || element.disabled || element.getAttribute?.('aria-disabled') === 'true' ||
              typeof isCurrent !== 'function' || isCurrent() !== true) {
            throw new Error('The captured file action or source changed before the download click.');
          }
          element.click();
          const downloaded = await ipcRenderer.invoke('converge:download-read', { token });
          return downloaded?.ok ? { ...downloaded, sourceVerifiedAtClick: true } : downloaded;
        } catch (error) {
          cancel();
          await ipcRenderer.invoke('converge:download-read', { token }).catch(() => {});
          return { ok: false, error: error.message };
        }
        finally { signal.removeEventListener('abort', cancel); }
      }
    });
    ipcRenderer.send('converge:page-ready');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
`;
fs.writeFileSync(path.join(root, 'src/browser/page-preload.js'), header + source + decoration + footer);
process.stdout.write('Built isolated ChatGPT page bridge.\n');
