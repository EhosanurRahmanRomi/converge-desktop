'use strict';

// Electron's native menu roles route editing to the focused first responder,
// including an embedded ChatGPT view. They do not inject text into a page.
function macApplicationMenu(app, showWindow) {
  return [
    { label: app.name || 'Converge', submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'services' },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'Show Converge', accelerator: 'Command+0', click: showWindow },
      { type: 'separator' }, { role: 'close' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' },
      { role: 'delete' }, { role: 'selectAll' },
    ] },
    { label: 'Window', role: 'window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' },
    ] },
  ];
}

function installDesktopLifecycle({ app, Menu, platform, createApp, onError }) {
  let current = null;
  let opening = null;
  let quitting = false;

  const showWindow = async () => {
    await app.whenReady();
    if (quitting) return null;
    if (current && !current.mainWindow.isDestroyed()) {
      if (current.mainWindow.isMinimized()) current.mainWindow.restore();
      current.mainWindow.show();
      current.mainWindow.focus();
      return current;
    }
    if (opening) return opening;
    // One shared creation promise prevents multiple Dock activations from
    // registering duplicate global IPC handlers while the first shell loads.
    opening = Promise.resolve().then(createApp).then((desktop) => {
      if (quitting) {
        if (!desktop.mainWindow.isDestroyed()) desktop.mainWindow.close();
        return null;
      }
      if (desktop.mainWindow.isDestroyed()) return null;
      current = desktop;
      desktop.mainWindow.once('closed', () => {
        if (current === desktop) current = null;
      });
      return desktop;
    }).finally(() => { opening = null; });
    return opening;
  };
  const requestWindow = () => { showWindow().catch(onError); };
  app.on('before-quit', () => { quitting = true; });
  app.on('second-instance', requestWindow);
  app.on('window-all-closed', () => {
    if (platform !== 'darwin') app.quit();
  });
  if (platform === 'darwin') app.on('activate', requestWindow);

  const ready = app.whenReady().then(() => {
    if (quitting) return null;
    if (platform === 'win32') app.setAppUserModelId('app.converge.browser-studio');
    if (platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate(macApplicationMenu(app, requestWindow)));
    return showWindow();
  });
  ready.catch(onError);
  return { ready, showWindow, getCurrent: () => current };
}

module.exports = { installDesktopLifecycle, macApplicationMenu };
