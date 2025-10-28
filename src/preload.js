// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Fonctions Power
  // Modifié: Prend un objet { minutes, action } et utilise invoke
  schedule: (options) => ipcRenderer.invoke('schedule-power-action', options),
  // Modifié: Utilise invoke
  cancel: () => ipcRenderer.invoke('cancel-power-action'),

  // Reste onUpdateStatus pour l'affichage initial et la réinitialisation
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => { // Accepte un objet
    callback(data);
  }),
  // Reste onUpdateCountdown pour le timer
  onUpdateCountdown: (callback) => ipcRenderer.on('update-countdown', (event, remainingMilliseconds) => {
    callback(remainingMilliseconds);
  }),
  // Reste onShowError
  onShowError: (callback) => ipcRenderer.on('show-error', (event, message) => {
      callback(message);
  }),

  // Fonctions Thème
  saveTheme: (theme) => ipcRenderer.send('save-theme', theme),
  onLoadSettings: (callback) => ipcRenderer.on('load-settings', (event, settings) => {
    callback(settings);
  }),

  // Fonctions de la Fenêtre
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close')
});