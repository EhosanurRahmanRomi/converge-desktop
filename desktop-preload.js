'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);
const subscribe = (channel) => (listener) => {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};
contextBridge.exposeInMainWorld('convergeBrowser', Object.freeze({
  bootstrap: invoke('browser:bootstrap'), importCookies: invoke('browser:import'), clearSession: invoke('browser:clear'),
  openPages: invoke('browser:open'), prepare: invoke('browser:prepare'), start: invoke('browser:start'), stop: invoke('browser:stop'),
  resetChats: invoke('browser:reset-chats'),
  bossMessage: invoke('browser:boss-message'), setAppearance: invoke('browser:appearance'),
  attachFiles: invoke('browser:attach'), setBounds: invoke('browser:bounds'), reload: invoke('browser:reload'), expand: invoke('browser:expand'),
  setEffectsPaused: invoke('browser:effects-paused'),
  windowAction: invoke('browser:window-action'),
  copy: invoke('browser:copy'), saveText: invoke('browser:save'), saveFiles: invoke('browser:save-files'), diagnostics: invoke('browser:diagnostics'),
  onState: subscribe('converge:state'), onPage: subscribe('converge:page'),
  onWindowVisibility: subscribe('converge:window-visibility'),
  onWindowState: subscribe('converge:window-state'),
  onClosing: subscribe('converge:workspace-closing'),
}));
