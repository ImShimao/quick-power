// main.js
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification } = require('electron');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(require('child_process').exec);
const fs = require('fs');
const iconv = require('iconv-lite');

// --- Constantes ---
const SETTINGS_FILE = 'settings.json';
const IPC_CHANNELS = {
    SCHEDULE: 'schedule-power-action',
    CANCEL: 'cancel-power-action',
    UPDATE_STATUS: 'update-status',
    UPDATE_COUNTDOWN: 'update-countdown',
    SHOW_ERROR: 'show-error',
    SAVE_THEME: 'save-theme',
    LOAD_SETTINGS: 'load-settings',
    WINDOW_MINIMIZE: 'window-minimize',
    WINDOW_CLOSE: 'window-close',
    SHOW_WINDOW: 'show-window'
};
const POWER_ACTIONS = {
    SHUTDOWN: 'shutdown',
    RESTART: 'restart',
    HIBERNATE: 'hibernate'
};
const TRAY_TOOLTIP_DEFAULT = 'QuickPower - Aucune action programmée';
const NOTIFICATION_THRESHOLD_MS = 60 * 1000; // Prévenir 1 minute avant

// --- Icônes ---
// Remonte d'un niveau car main.js est dans src/
const iconPath = path.join(__dirname, '..', 'assets/icon.ico');

// --- Logique de sauvegarde des préférences ---
const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

function readSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf-8');
            const settings = JSON.parse(data);
            
            // Migration et nettoyage
             if (settings.shutdownTime && !settings.scheduledTime) {
                settings.scheduledTime = settings.shutdownTime;
                delete settings.shutdownTime;
                if (!settings.scheduledAction) settings.scheduledAction = POWER_ACTIONS.SHUTDOWN;
            }
            
            return {
                theme: 'light',
                lastDurationValue: 30,
                lastDurationUnit: 'minutes',
                ...settings
            };
        }
    } catch (error) { console.error("Erreur lecture settings:", error); }
    return { theme: 'light', lastDurationValue: 30, lastDurationUnit: 'minutes' };
}

function saveSettings(settings) {
  try {
    const settingsToSave = {...settings};
    if (!settingsToSave.scheduledTime) delete settingsToSave.scheduledTime;
    if (!settingsToSave.scheduledAction) delete settingsToSave.scheduledAction;

    fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2));
  } catch (error) { console.error("Erreur sauvegarde settings:", error); }
}

// --- Variables globales ---
let scheduledTime = null;
let scheduledAction = null;
let shutdownTimerInterval = null;
let hibernateTimeout = null;
let win = null;
let tray = null;
let isQuitting = false;
let lastNotificationTime = 0;

// --- Fonctions Utilitaires (REMPLIES) ---

function getActionLabel(action) {
    switch(action) {
        case POWER_ACTIONS.SHUTDOWN: return 'Arrêt';
        case POWER_ACTIONS.RESTART: return 'Redémarrage';
        case POWER_ACTIONS.HIBERNATE: return 'Veille prolongée';
        default: return 'Action';
    }
}

function formatTime(milliseconds) {
    if (milliseconds <= 0) return "00:00:00";
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function showNotification(title, body) {
    if (Notification.isSupported()) {
        new Notification({
            title: title,
            body: body,
            icon: iconPath
        }).show();
    }
}

function decodeConsoleOutput(buffer) {
    // Décodage CP850 pour les accents Windows standard
    return iconv.decode(Buffer.from(buffer), 'cp850');
}

function clearScheduleState(updateTrayMenu = true) {
    console.log("Nettoyage de l'état programmé.");
    scheduledTime = null;
    scheduledAction = null;
    if (shutdownTimerInterval) { clearInterval(shutdownTimerInterval); shutdownTimerInterval = null; }
    if (hibernateTimeout) { clearTimeout(hibernateTimeout); hibernateTimeout = null; }
    lastNotificationTime = 0;

    const settings = readSettings();
    let settingsChanged = false;
    if (settings.scheduledTime) { delete settings.scheduledTime; settingsChanged = true; }
    if (settings.scheduledAction) { delete settings.scheduledAction; settingsChanged = true; }
    if (settingsChanged) saveSettings(settings);

    if (tray) {
        tray.setToolTip(TRAY_TOOLTIP_DEFAULT);
        if (updateTrayMenu) buildContextMenu();
    }
    
    if (win && !win.isDestroyed()){
        win.webContents.send(IPC_CHANNELS.UPDATE_STATUS, null);
        win.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, 0);
    }
}

function sendStatusUpdate(windowTarget) {
    const dataToSend = (scheduledTime && scheduledAction)
                       ? { time: scheduledTime.toISOString(), action: scheduledAction }
                       : null;
    if (windowTarget && !windowTarget.isDestroyed()) {
        windowTarget.webContents.send(IPC_CHANNELS.UPDATE_STATUS, dataToSend);
    }

    if (tray) {
        if (dataToSend) {
            const label = getActionLabel(dataToSend.action);
            tray.setToolTip(`${label} programmé pour ${new Date(dataToSend.time).toLocaleTimeString()}`);
        } else {
            tray.setToolTip(TRAY_TOOLTIP_DEFAULT);
        }
    }
    buildContextMenu();
}

function sendCountdownUpdate(windowTarget) {
  if (scheduledTime && scheduledAction) {
    const now = new Date();
    const remaining = Math.max(0, scheduledTime.getTime() - now.getTime());

    if (windowTarget && !windowTarget.isDestroyed()) {
        windowTarget.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, remaining);
    }

    if (tray) {
        const label = getActionLabel(scheduledAction);
        tray.setToolTip(remaining > 0 ? `${label} dans ${formatTime(remaining)}` : `${label} imminent...`);
    }

    if (remaining > 0 && remaining <= NOTIFICATION_THRESHOLD_MS && now.getTime() - lastNotificationTime > NOTIFICATION_THRESHOLD_MS) {
        showNotification('QuickPower Action Imminente', `${getActionLabel(scheduledAction)} dans moins d'une minute !`);
        lastNotificationTime = now.getTime();
    }

    if (remaining === 0 && scheduledAction !== POWER_ACTIONS.HIBERNATE) {
        console.log(`Le délai pour ${scheduledAction} est écoulé. Action OS en cours.`);
        clearScheduleState(); 
        if (windowTarget && !windowTarget.isDestroyed()) sendStatusUpdate(windowTarget);
    }
  } else {
      if (shutdownTimerInterval) {
          clearInterval(shutdownTimerInterval);
          shutdownTimerInterval = null;
          if (windowTarget && !windowTarget.isDestroyed()) {
              windowTarget.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, 0);
          }
          if (tray) { tray.setToolTip(TRAY_TOOLTIP_DEFAULT); }
          buildContextMenu();
      }
  }
}

function startInternalCountdown(windowTarget) {
    if (!windowTarget || windowTarget.isDestroyed()) return;
    if (shutdownTimerInterval) clearInterval(shutdownTimerInterval);
    if (scheduledTime) {
        sendCountdownUpdate(windowTarget);
        shutdownTimerInterval = setInterval(() => sendCountdownUpdate(windowTarget), 1000);
    } else {
         sendCountdownUpdate(windowTarget);
    }
}

function buildContextMenu() {
    if (!tray) return;

    const isActionScheduled = !!(scheduledTime && scheduledAction);

    const contextMenuTemplate = [
        {
            label: (win && win.isVisible()) ? 'Masquer' : 'Afficher',
            click: () => {
                if (win) { win.isVisible() ? win.hide() : win.show(); }
                else { createWindow(); }
            }
        },
        {
            label: 'Annuler l\'action programmée',
            enabled: isActionScheduled,
            click: () => {
                console.log("Annulation demandée depuis le menu Tray.");
                ipcMain.invoke(IPC_CHANNELS.CANCEL)
                    .then(result => {
                        if (!result.success) console.error("Erreur annulation via Tray:", result.error);
                    })
                    .catch(err => console.error("Erreur IPC invoke cancel via Tray:", err));
            }
        },
        { type: 'separator' },
        {
            label: 'Quitter',
            click: () => {
                isQuitting = true; // IMPORTANT : Autorise la fermeture réelle
                app.quit();
            }
        }
    ];
    const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
    tray.setContextMenu(contextMenu);

    if (win) {
         contextMenu.items[0].label = win.isVisible() ? 'Masquer' : 'Afficher';
         tray.setContextMenu(contextMenu);
    }
}


// --- Création de la Fenêtre ---
function createWindow() {
  if (win) { 
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus(); 
      return; 
  }

  const settings = readSettings();

  // Restauration de l'état
  if (settings.scheduledTime && settings.scheduledAction) {
    const savedTime = new Date(settings.scheduledTime);
    const now = new Date();
    if (savedTime > now) {
      scheduledTime = savedTime;
      scheduledAction = settings.scheduledAction;
      console.log(`Action restaurée : ${scheduledAction} pour ${scheduledTime.toLocaleTimeString()}`);
      if (scheduledAction === POWER_ACTIONS.HIBERNATE) {
          const delayMs = Math.max(0, scheduledTime.getTime() - now.getTime());
          if (hibernateTimeout) clearTimeout(hibernateTimeout);
          hibernateTimeout = setTimeout(() => {
              require('child_process').exec('shutdown /h', (err) => {
                   if (err) {
                       console.error("Erreur hibernation (restaurée):", err);
                       clearScheduleState();
                       sendStatusUpdate(null);
                   }
              });
          }, delayMs);
      }
    } else {
      // Nettoyage si expiré pendant que l'app était fermée
      delete settings.scheduledTime;
      delete settings.scheduledAction;
      saveSettings(settings);
      scheduledTime = null;
      scheduledAction = null;
    }
  }

  win = new BrowserWindow({
      width: 400,
      height: 420,
      resizable: false, 
      frame: false, 
      transparent: true, 
      icon: iconPath,
      show: false, // On ne montre pas tout de suite (pour éviter le flash ou gérer le démarrage caché)
      webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true, 
          nodeIntegration: false,
          devTools: !app.isPackaged
      }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.webContents.send(IPC_CHANNELS.LOAD_SETTINGS, settings);
    sendStatusUpdate(win);
    startInternalCountdown(win);
  });

  // Afficher la fenêtre quand elle est prête (sauf si lancée en caché, logique simplifiée ici)
  win.once('ready-to-show', () => {
      win.show();
  });

  // --- GESTION FERMETURE (TRAY) ---
  win.on('close', (event) => {
      if (!isQuitting) {
          event.preventDefault(); // Empêche la fermeture
          win.hide(); // Cache seulement
          if (tray) buildContextMenu(); // Met à jour le menu (Afficher/Masquer)
          return false;
      }
      // Si isQuitting est true, on laisse fermer
  });

  win.on('closed', () => {
      win = null;
  });

  win.on('show', buildContextMenu);
  win.on('hide', buildContextMenu);
}

// --- Initialisation App et Tray ---
app.whenReady().then(() => {
    
    // Configurer le lancement au démarrage de Windows
    app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--hidden'] // Argument conventionnel pour démarrer caché (à gérer si tu veux complexifier)
    });

    try {
        tray = new Tray(iconPath);
        tray.setToolTip(TRAY_TOOLTIP_DEFAULT);
        tray.on('click', () => {
            if (win) { win.isVisible() ? win.hide() : win.show(); }
            else { createWindow(); }
        });
        buildContextMenu();
    } catch (error) { console.error("Impossible de créer l'icône Tray:", error); tray = null; }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// --- Gestion Singleton ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { 
    app.quit(); 
} else { 
    app.on('second-instance', (event, commandLine, workingDirectory) => { 
        if (win) { 
            if (win.isMinimized()) win.restore(); 
            if (!win.isVisible()) win.show();
            win.focus(); 
        } else { 
            createWindow(); 
        } 
    }); 
}

// --- Gestion IPC ---

ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => win?.minimize());
ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => win?.close()); // Déclenche win.on('close') -> donc hide()
ipcMain.on(IPC_CHANNELS.SHOW_WINDOW, () => { if (win) win.show(); else createWindow(); });

ipcMain.on(IPC_CHANNELS.SAVE_THEME, (event, theme) => {
  const settings = readSettings();
  settings.theme = theme;
  saveSettings(settings);
});

ipcMain.handle(IPC_CHANNELS.SCHEDULE, async (event, options) => {
    const { minutes, action, originalValue, originalUnit } = options;
    
    if (typeof minutes !== 'number' || minutes <= 0) return { success: false, error: "Durée invalide." };
    if (!Object.values(POWER_ACTIONS).includes(action)) return { success: false, error: "Action inconnue." };

    // Nettoyage préventif
    try {
        if (scheduledAction === POWER_ACTIONS.HIBERNATE && hibernateTimeout) {
            clearTimeout(hibernateTimeout); hibernateTimeout = null;
        } else if (scheduledAction) {
             await execPromise('shutdown /a', { encoding: 'buffer' });
        }
    } catch (e) { /* Ignorer erreur si pas de shutdown en cours */ }
    
    clearScheduleState(false);

    // Nouvelle programmation
    const now = new Date();
    scheduledTime = new Date(now.getTime() + minutes * 60000);
    scheduledAction = action;

    try {
        const seconds = minutes * 60;
        if (action === POWER_ACTIONS.SHUTDOWN) { await execPromise(`shutdown /s /t ${seconds}`); }
        else if (action === POWER_ACTIONS.RESTART) { await execPromise(`shutdown /r /t ${seconds}`); }
        else if (action === POWER_ACTIONS.HIBERNATE) {
            const delayMs = minutes * 60000;
            hibernateTimeout = setTimeout(() => {
                 require('child_process').exec('shutdown /h', (err) => {
                     if (err) {
                         console.error("Erreur shutdown /h:", err);
                         clearScheduleState();
                         sendStatusUpdate(null);
                     }
                 });
            }, delayMs);
        }

        const settings = readSettings();
        settings.scheduledTime = scheduledTime.toISOString();
        settings.scheduledAction = scheduledAction;
        settings.lastDurationValue = originalValue;
        settings.lastDurationUnit = originalUnit;
        saveSettings(settings);

        sendStatusUpdate(win);
        startInternalCountdown(win);
        if (win && !win.isVisible()){ showNotification('QuickPower', `${getActionLabel(action)} programmé.`); }

        return { success: true };

    } catch (scheduleError) {
        const decodedStderr = decodeConsoleOutput(scheduleError.stderr || '');
        console.error(`Erreur programmation:`, decodedStderr);
        clearScheduleState();
        sendStatusUpdate(win);
        return { success: false, error: "Impossible de programmer l'action. Vérifiez les droits." };
    }
});

ipcMain.handle(IPC_CHANNELS.CANCEL, async (event) => {
    let wasActionScheduledInternally = !!scheduledAction;
    try {
        if (scheduledAction === POWER_ACTIONS.HIBERNATE && hibernateTimeout) {
            clearTimeout(hibernateTimeout); hibernateTimeout = null;
        } else {
            try { await execPromise('shutdown /a', { encoding: 'buffer' }); } catch(e) {}
        }

        clearScheduleState(true);
        if (wasActionScheduledInternally) {
            showNotification('QuickPower', 'Action annulée.');
        }
        return { success: true, message: "Action annulée !" };

    } catch (error) {
        clearScheduleState(true);
        sendStatusUpdate(win);
        return { success: false, error: "Erreur interne annulation." };
    }
});

// IMPORTANT : Ne pas quitter quand toutes les fenêtres sont fermées (Comportement Tray)
app.on('window-all-closed', () => {
    // Sur Windows/Linux, on garde l'app en vie pour le Tray.
    // Si on voulait quitter explicitement, on le ferait via le menu Tray.
});

app.on('before-quit', () => {
    isQuitting = true;
});