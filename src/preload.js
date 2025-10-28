// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Fonctions Power
  schedule: (options) => ipcRenderer.invoke('schedule-power-action', options),
  cancel: () => ipcRenderer.invoke('cancel-power-action'),

  // Listeners
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => { callback(data); }),
  onUpdateCountdown: (callback) => ipcRenderer.on('update-countdown', (event, remainingMilliseconds) => { callback(remainingMilliseconds); }),
  onShowError: (callback) => ipcRenderer.on('show-error', (event, message) => { callback(message); }),

  // Thème (Utilise send/on, plus simple pour une action sans retour immédiat nécessaire)
  saveTheme: (theme) => ipcRenderer.send('save-theme', theme),
  onLoadSettings: (callback) => ipcRenderer.on('load-settings', (event, settings) => { callback(settings); }),

  // Fenêtre
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  showWindow: () => ipcRenderer.send('show-window'),

  // Permissions retiré
});