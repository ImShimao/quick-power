const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

// --- Logique de sauvegarde des préférences ---
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Erreur en lisant les préférences:", error);
  }
  // Retourne un objet par défaut si le fichier n'existe pas ou est corrompu
  return { theme: 'light' }; 
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
  } catch (error) {
    console.error("Erreur en sauvegardant les préférences:", error);
  }
}

let scheduledShutdownTime = null;
let win; 

function createWindow() {
  const settings = readSettings();

  // --- NOUVELLE LOGIQUE DE MÉMOIRE (AU DÉMARRAGE) ---
  if (settings.shutdownTime) {
    const savedTime = new Date(settings.shutdownTime);
    const now = new Date();

    if (savedTime > now) {
      // Un arrêt valide est déjà programmé, on le restaure
      scheduledShutdownTime = savedTime;
    } else {
      // L'heure est dans le passé (l'app a été fermée pendant l'arrêt)
      // On nettoie le réglage devenu inutile
      delete settings.shutdownTime;
      saveSettings(settings);
    }
  }
  // ------------------------------------------------

  win = new BrowserWindow({
    width: 400,
    height: 400,
    resizable: false,
    frame: false,
    transparent: true,
    icon: path.join(__dirname, '..', 'assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    // 1. Envoie les réglages (pour le thème)
    win.webContents.send('load-settings', settings);
    // 2. Envoie le statut d'arrêt (restauré ou null)
    // C'est ce qui dit au renderer d'afficher "Arrêt programmé pour..."
    win.webContents.send('update-status', scheduledShutdownTime);
  });
}

app.whenReady().then(createWindow);

// --- GESTION DES BOUTONS DE FENÊTRE ---
ipcMain.on('window-minimize', () => {
  win.minimize();
});

ipcMain.on('window-close', () => {
  win.close();
});

// --- Logique Shutdown ---
ipcMain.on('schedule-shutdown', (event, minutes) => {
  const seconds = minutes * 60;
  exec(`shutdown /s /t ${seconds}`, (err) => {
    if (err) { return; }
    scheduledShutdownTime = new Date(new Date().getTime() + minutes * 60000);
    
    // --- AJOUT POUR LA MÉMOIRE ---
    const settings = readSettings();
    settings.shutdownTime = scheduledShutdownTime.toISOString(); // Sauvegarde l'heure en format ISO
    saveSettings(settings);
    // ---------------------------

    event.sender.send('update-status', scheduledShutdownTime);
  });
});

ipcMain.on('cancel-shutdown', (event) => {
  exec('shutdown /a', () => {
    scheduledShutdownTime = null;
    
    // --- AJOUT POUR LA MÉMOIRE ---
    const settings = readSettings();
    delete settings.shutdownTime; // Supprime l'heure de la sauvegarde
    saveSettings(settings);
    // ---------------------------

    event.sender.send('update-status', null);
  });
});

// (Inchangé, gère uniquement le thème)
ipcMain.on('save-theme', (event, theme) => {
  const settings = readSettings();
  settings.theme = theme;
  saveSettings(settings);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});