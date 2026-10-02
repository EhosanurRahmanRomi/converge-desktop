'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('duet', {
  getBootstrap: () => ipcRenderer.invoke('duet:get-bootstrap'),
  importCookies: (payload) => ipcRenderer.invoke('duet:import-cookies', payload),
  clearSession: () => ipcRenderer.invoke('duet:clear-session'),
  openPages: () => ipcRenderer.invoke('duet:open-pages'),
  newChats: () => ipcRenderer.invoke('duet:new-chats'),
  reloadPage: (side) => ipcRenderer.invoke('duet:reload-page', side),
  setViewBounds: (bounds) => ipcRenderer.invoke('duet:set-view-bounds', bounds),
  setMode: (mode) => ipcRenderer.invoke('duet:set-mode', mode),
  pasteTo: (side) => ipcRenderer.invoke('duet:paste-to', side),
  saveText: (payload) => ipcRenderer.invoke('duet:save-text', payload),
  copy: (value) => ipcRenderer.invoke('duet:copy', value),
  getClipboard: () => ipcRenderer.invoke('duet:get-clipboard'),
  onEvent: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('duet:event', wrapped);
    return () => ipcRenderer.removeListener('duet:event', wrapped);
  }
});

contextBridge.exposeInMainWorld('converge', {
  setMode: (mode) => ipcRenderer.invoke('duet:set-mode', mode),
  auto: {
    getAuthStatus: () => ipcRenderer.invoke('auto:get-auth-status'),
    setApiKey: (key) => ipcRenderer.invoke('auto:set-api-key', key),
    clearApiKey: () => ipcRenderer.invoke('auto:clear-api-key'),
    chooseAttachments: () => ipcRenderer.invoke('auto:choose-attachments'),
    clearAttachments: () => ipcRenderer.invoke('auto:clear-attachments'),
    start: (payload) => ipcRenderer.invoke('auto:start', payload),
    stop: () => ipcRenderer.invoke('auto:stop'),
    signInWithChatGPT: () => ipcRenderer.invoke('auto:siwc-sign-in'),
    signOutChatGPT: () => ipcRenderer.invoke('auto:siwc-sign-out'),
    onEvent: (listener) => {
      if (typeof listener !== 'function') return () => {};
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on('auto:event', wrapped);
      return () => ipcRenderer.removeListener('auto:event', wrapped);
    }
  }
});
