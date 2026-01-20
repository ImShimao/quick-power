// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Fonctions Power ---
  schedule: (options) => ipcRenderer.invoke('schedule-power-action', options),
  cancel: () => ipcRenderer.invoke('cancel-power-action'),

  // --- Listeners (Réception de données du Main) ---
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
  onUpdateCountdown: (callback) => ipcRenderer.on('update-countdown', (event, remainingMilliseconds) => callback(remainingMilliseconds)),
  onShowError: (callback) => ipcRenderer.on('show-error', (event, message) => callback(message)),
  onLoadSettings: (callback) => ipcRenderer.on('load-settings', (event, settings) => callback(settings)),

  // --- Gestion Thème & Fenêtre ---
  saveTheme: (theme) => ipcRenderer.send('save-theme', theme),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  showWindow: () => ipcRenderer.send('show-window')
});