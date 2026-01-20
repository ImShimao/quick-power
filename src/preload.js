// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  schedule: (options) => ipcRenderer.invoke('schedule-power-action', options),
  cancel: () => ipcRenderer.invoke('cancel-power-action'),

  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
  onUpdateCountdown: (callback) => ipcRenderer.on('update-countdown', (event, remainingMilliseconds, ratio) => callback(remainingMilliseconds, ratio)), // Note le ratio ajouté ici si besoin, mais le scheduler envoie un objet ou des args séparés. Vérifions main.js plus bas.
  onShowError: (callback) => ipcRenderer.on('show-error', (event, message) => callback(message)),
  onLoadSettings: (callback) => ipcRenderer.on('load-settings', (event, settings) => callback(settings)),

  saveTheme: (theme) => ipcRenderer.send('save-theme', theme),
  saveAutoStart: (openAtLogin) => ipcRenderer.send('save-auto-start', openAtLogin), // NOUVEAU
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  showWindow: () => ipcRenderer.send('show-window')
});