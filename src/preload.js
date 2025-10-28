// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Fonctions Shutdown
  schedule: (minutes) => ipcRenderer.send('schedule-shutdown', minutes), //
  cancel: () => ipcRenderer.send('cancel-shutdown'), //
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, isoTime) => { // Modifié pour accepter ISO
    callback(isoTime); //
  }),
  // NOUVEAU: Pour le compte à rebours
  onUpdateCountdown: (callback) => ipcRenderer.on('update-countdown', (event, remainingMilliseconds) => {
    callback(remainingMilliseconds);
  }),
  // NOUVEAU: Pour les erreurs
  onShowError: (callback) => ipcRenderer.on('show-error', (event, message) => {
      callback(message);
  }),

  // Fonctions Thème
  saveTheme: (theme) => ipcRenderer.send('save-theme', theme), //
  onLoadSettings: (callback) => ipcRenderer.on('load-settings', (event, settings) => { //
    callback(settings); //
  }),

  // Fonctions de la Fenêtre
  minimize: () => ipcRenderer.send('window-minimize'), //
  close: () => ipcRenderer.send('window-close') //
});