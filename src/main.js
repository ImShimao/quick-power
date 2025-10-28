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
  return { theme: 'light' }; // Retourne un objet par défaut
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
  } catch (error) {
    console.error("Erreur en sauvegardant les préférences:", error);
  }
}

let scheduledShutdownTime = null;
let shutdownTimerInterval = null; // Pour gérer le compte à rebours interne si nécessaire
let win;

function createWindow() {
  const settings = readSettings();

  if (settings.shutdownTime) {
    const savedTime = new Date(settings.shutdownTime);
    const now = new Date();

    if (savedTime > now) {
      scheduledShutdownTime = savedTime;
      startInternalCountdown(); // Redémarre le compte à rebours si nécessaire
    } else {
      delete settings.shutdownTime;
      saveSettings(settings);
    }
  }

  win = new BrowserWindow({
    width: 400,
    height: 400, // Légèrement plus haut pour le compte à rebours
    resizable: false,
    frame: false,
    transparent: true,
    icon: path.join(__dirname, '..', 'assets/icon.ico'), //
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), //
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(path.join(__dirname, 'index.html')); //

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('load-settings', settings); //
    // Envoie l'heure programmée (ou null) pour initialiser le renderer
    win.webContents.send('update-status', scheduledShutdownTime ? scheduledShutdownTime.toISOString() : null); //
  });
}

// Fonction pour envoyer le temps restant au renderer
function updateRendererCountdown() {
  if (win && scheduledShutdownTime) {
    const now = new Date();
    const remaining = Math.max(0, scheduledShutdownTime.getTime() - now.getTime());
    win.webContents.send('update-countdown', remaining); // Nouvel événement
    if (remaining === 0) {
      clearInterval(shutdownTimerInterval);
      shutdownTimerInterval = null;
      scheduledShutdownTime = null; // Réinitialiser après l'heure
      // Optionnel: Nettoyer les settings ici aussi si l'app reste ouverte
    }
  } else if (shutdownTimerInterval) {
     clearInterval(shutdownTimerInterval); // Nettoyer si plus d'heure programmée
     shutdownTimerInterval = null;
     if (win) {
         win.webContents.send('update-countdown', 0); // Indiquer 0 temps restant
     }
  }
}

// Démarre le timer interne pour mettre à jour le renderer
function startInternalCountdown() {
    if (shutdownTimerInterval) clearInterval(shutdownTimerInterval); // Nettoyer l'ancien
    if (scheduledShutdownTime) {
        shutdownTimerInterval = setInterval(updateRendererCountdown, 1000); // Met à jour chaque seconde
        updateRendererCountdown(); // Mise à jour immédiate
    }
}

app.whenReady().then(createWindow);

ipcMain.on('window-minimize', () => { //
  if (win) win.minimize(); //
});

ipcMain.on('window-close', () => { //
  if (win) win.close(); //
});

// --- Logique Shutdown ---
ipcMain.on('schedule-shutdown', (event, minutes) => { //
  if (minutes <= 0) {
      event.sender.send('show-error', "La durée doit être positive."); //
      return;
  }
  // Limite (exemple: 1 semaine en minutes)
  const maxMinutes = 60 * 24 * 7;
  if (minutes > maxMinutes) {
      event.sender.send('show-error', `Durée maximale : ${maxMinutes / 60 / 24} jours.`); //
      return;
  }

  const seconds = minutes * 60;
  exec(`shutdown /s /t ${seconds}`, (err, stdout, stderr) => { //
    if (err) {
      console.error("Erreur lors de la planification:", stderr);
      event.sender.send('show-error', "Impossible de programmer l'arrêt. Vérifiez les permissions."); //
      return;
    }
    scheduledShutdownTime = new Date(new Date().getTime() + minutes * 60000); //
    const settings = readSettings();
    settings.shutdownTime = scheduledShutdownTime.toISOString();
    saveSettings(settings); //
    event.sender.send('update-status', scheduledShutdownTime.toISOString()); // Envoyer ISO string
    startInternalCountdown(); // Démarrer le compte à rebours
  });
});

ipcMain.on('cancel-shutdown', (event) => { //
  exec('shutdown /a', (err, stdout, stderr) => { //
    if (err) {
      // Même si l'annulation OS échoue (par ex. rien n'était programmé),
      // on essaie de nettoyer l'état de notre application.
      console.warn("Avertissement lors de l'annulation (peut être normal s'il n'y avait rien à annuler):", stderr);
      // On pourrait envoyer une info, mais souvent l'utilisateur clique "Annuler" même s'il n'y a rien.
      // event.sender.send('show-error', "Impossible d'annuler.");
    }
    scheduledShutdownTime = null; //
    if (shutdownTimerInterval) {
        clearInterval(shutdownTimerInterval); // Arrêter le compte à rebours
        shutdownTimerInterval = null;
    }
    const settings = readSettings();
    delete settings.shutdownTime;
    saveSettings(settings); //
    event.sender.send('update-status', null); //
  });
});

ipcMain.on('save-theme', (event, theme) => { //
  const settings = readSettings();
  settings.theme = theme;
  saveSettings(settings); //
});

app.on('window-all-closed', () => { //
  if (process.platform !== 'darwin') { //
    app.quit(); //
  }
});

// Optionnel: Gérer la réactivation depuis la barre des tâches
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});