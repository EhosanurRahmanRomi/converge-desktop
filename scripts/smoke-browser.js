'use strict';

// A read-only integration smoke test for Electron's in-memory browser session.
// It does not import a real session or inspect ChatGPT page content.
const { app, BaseWindow, WebContentsView, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function withTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Page load timed out.')), milliseconds))
  ]);
}

app.whenReady().then(async () => {
  const ses = session.fromPartition(`converge-smoke-${Date.now()}`, { cache: false });
  const testCookie = { url: 'https://chatgpt.com/', name: 'converge_smoke', value: 'test', secure: true };
  await ses.cookies.set(testCookie);
  const cookies = await ses.cookies.get({ url: 'https://chatgpt.com/', name: 'converge_smoke' });
  if (ses.storagePath !== null || cookies.length !== 1) throw new Error('In-memory cookie roundtrip failed.');
  await ses.clearData();

  const win = new BaseWindow({ width: 720, height: 560, show: false });
  const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 720, height: 560 });
  view.setVisible(true);
  let result = { inMemoryCookies: true, pageLoaded: false, url: null };
  try {
    await withTimeout(view.webContents.loadURL('https://chatgpt.com/'), 25000);
    result = { ...result, pageLoaded: true, url: view.webContents.getURL() };
  } catch (error) {
    result = { ...result, error: error.message };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  fs.writeFileSync(path.join(__dirname, '..', 'smoke-browser-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  view.webContents.close();
  win.close();
  app.quit();
}).catch((error) => {
  process.stderr.write(`Electron smoke test failed: ${error.message}\n`);
  app.exit(1);
});
