'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const previewProfile = require('node:fs').mkdtempSync(path.join(app.getPath('temp'), 'converge-preview-'));
app.setPath('userData', previewProfile);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 430, height: 980, show: false, backgroundColor: '#0b111b', webPreferences: { offscreen: true } });
  const output = path.join(__dirname, '..', 'chrome-extension-panel.png');
  const painted = new Promise((resolve) => {
    window.webContents.once('paint', (_event, _dirty, image) => resolve(image));
  });
  await window.loadFile(path.join(__dirname, '..', 'chrome-extension', 'panel.html'));
  const image = await painted;
  await fs.writeFile(output, image.toPNG());
  const scrolled = new Promise((resolve) => {
    window.webContents.once('paint', (_event, _dirty, nextImage) => resolve(nextImage));
  });
  await window.webContents.executeJavaScript('window.scrollTo(0, 440)');
  await fs.writeFile(path.join(__dirname, '..', 'chrome-extension-panel-setup.png'), (await scrolled).toPNG());
  process.stdout.write(`${output}\n`);
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
