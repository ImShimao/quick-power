// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Fonctions Shutdown
  schedule: (minutes) => ipcRenderer.send('schedule-shutdown', minutes),
  cancel: () => ipcRenderer.send('cancel-shutdown'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, time) => {
    callback(time);
  }),
  
  // Fonctions Thème
  saveTheme: (theme) => ipcRenderer.send('save-theme', theme),
  onLoadSettings: (callback) => ipcRenderer.on('load-settings', (event, settings) => {
    callback(settings);
  }),

  // NOUVEAU: Fonctions de la Fenêtre
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close')
});