const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

// --- Logique de sauvegarde des préférences ---
// Note : app.getPath('userData') est géré par Electron,
// il n'y a pas besoin de changer ce chemin.
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

  win = new BrowserWindow({
    width: 400,
    height: 400,
    resizable: false,
    frame: false,
    transparent: true,
    
    // --- MISE À JOUR DU CHEMIN DE L'ICÔNE ---
    // __dirname est 'src', on remonte ('..'), puis 'assets', puis 'icon.ico'
    icon: path.join(__dirname, '..', 'assets/icon.ico'),
    
    webPreferences: {
      // --- MISE À JOUR DU CHEMIN DE PRELOAD ---
      // __dirname est 'src', on prend 'preload.js' à côté
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // --- MISE À JOUR DU CHEMIN DE L'INTERFACE ---
  // __dirname est 'src', on prend 'index.html' à côté
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('load-settings', settings);
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

// --- Logique Shutdown (inchangée) ---
ipcMain.on('schedule-shutdown', (event, minutes) => {
  const seconds = minutes * 60;
  exec(`shutdown /s /t ${seconds}`, (err) => {
    if (err) { return; }
    scheduledShutdownTime = new Date(new Date().getTime() + minutes * 60000);
    event.sender.send('update-status', scheduledShutdownTime);
  });
});

ipcMain.on('cancel-shutdown', (event) => {
  exec('shutdown /a', () => {
    scheduledShutdownTime = null;
    event.sender.send('update-status', null);
  });
});

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