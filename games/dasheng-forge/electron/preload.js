// 只把遊戲需要的幾個功能交給網頁端，網頁端拿不到 Node 或檔案系統。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('platform', {
  readSave: () => ipcRenderer.invoke('save:read'),
  writeSave: (json) => ipcRenderer.invoke('save:write', json),
  unlock: (id) => ipcRenderer.invoke('steam:unlock', id),
  isSteam: () => ipcRenderer.invoke('steam:available'),
});
