'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'chrome-extension/content.js'), 'utf8');
const galaxy = fs.readFileSync(path.join(root, 'renderer/galaxy-scene.js'), 'utf8');
const appearance = fs.readFileSync(path.join(root, 'src/browser/page-appearance.js'), 'utf8');
const chatFont = fs.readFileSync(path.join(root, 'renderer/assets/fonts/Manrope-Variable.ttf')).toString('base64');
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
    const respond = (response) => {
      if (answered) return;
      answered = true;
      // Keep IPC messages small even for a 100 MB generated file.
      if (response?.files?.some(file => file.base64?.length > 4 * 1024 * 1024) ||
          response?.files?.reduce((sum, file) => sum + (file.base64?.length || 0), 0) > 4 * 1024 * 1024) {
        const serialized = JSON.stringify(response);
        let index = 0;
        for (let offset = 0; offset < serialized.length; offset += 1024 * 1024) {
          ipcRenderer.send('converge:page-response-chunk', { id: payload.id, index: index++, data: serialized.slice(offset, offset + 1024 * 1024) });
        }
        ipcRenderer.send('converge:page-response', { id: payload.id, response: { chunked: true, totalChunks: index, totalLength: serialized.length } });
      } else ipcRenderer.send('converge:page-response', { id: payload.id, response });
    };
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
    // Load the same local typeface as the shell from memory. This makes no
    // network request and retains the native monospace font for code and math.
    try {
      const fontBytes = Uint8Array.from(atob(${JSON.stringify(chatFont)}), character => character.charCodeAt(0));
      const face = new FontFace('Converge Manrope', fontBytes.buffer, { weight: '200 800' });
      face.load().then(loaded => document.fonts.add(loaded)).catch(() => {});
    } catch (_) { /* Native system typeface remains available. */ }
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
          let downloaded = await ipcRenderer.invoke('converge:download-read', { token });
          if (downloaded?.ok && downloaded.chunked === true) {
            if (!Number.isSafeInteger(downloaded.totalLength) || downloaded.totalLength < 1 || downloaded.totalLength > Math.ceil(128 * 1024 * 1024 / 3) * 4) throw new Error('Invalid native download length.');
            const chunks = []; let offset = 0;
            while (offset < downloaded.totalLength) {
              // The provider may consume its download control after the one
              // verified click. The owned native token now binds these bytes.
              if (signal.aborted) throw new Error('File export canceled.');
              const chunk = await ipcRenderer.invoke('converge:download-chunk', { token, offset });
              if (!chunk?.ok || typeof chunk.data !== 'string' || !chunk.data.length || chunk.data.length > 1024 * 1024 || offset + chunk.data.length > downloaded.totalLength) throw new Error(chunk?.error || 'Invalid native download chunk.');
              chunks.push(chunk.data); offset += chunk.data.length;
              if (chunk.done !== (offset === downloaded.totalLength)) throw new Error('Incomplete native file transfer.');
            }
            downloaded = { ok: true, mimeType: downloaded.mimeType, base64: chunks.join('') };
          }
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
