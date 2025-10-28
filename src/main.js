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
    SHOW_WINDOW: 'show-window' // Pour Tray
};
const POWER_ACTIONS = {
    SHUTDOWN: 'shutdown',
    RESTART: 'restart',
    HIBERNATE: 'hibernate'
};
const TRAY_TOOLTIP_DEFAULT = 'QuickPower - Aucune action programmée';
const NOTIFICATION_THRESHOLD_MS = 60 * 1000; // Prévenir 1 minute avant

// --- Icônes ---
const iconPath = path.join(__dirname, '..', 'assets/icon.ico');

// --- Logique de sauvegarde des préférences ---
const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

function readSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf-8');
            const settings = JSON.parse(data);
            // Migration ancienne clé + ajout action par défaut si besoin
             if (settings.shutdownTime && !settings.scheduledTime) {
                settings.scheduledTime = settings.shutdownTime;
                delete settings.shutdownTime;
                if (!settings.scheduledAction) settings.scheduledAction = POWER_ACTIONS.SHUTDOWN;
                // Pas besoin de resauvegarder ici si on le fait au prochain schedule
            }
            // Retourne avec valeurs par défaut si manquantes
            return {
                theme: 'light',
                lastDurationValue: 30,
                lastDurationUnit: 'minutes',
                ...settings
            };
        }
    } catch (error) { console.error("Erreur lecture settings:", error); }
    // Défauts complets si le fichier n'existe pas ou erreur
    return { theme: 'light', lastDurationValue: 30, lastDurationUnit: 'minutes' };
}

function saveSettings(settings) {
  try {
    // Ne sauvegarde pas les champs schedule s'ils sont null (géré par clearScheduleState)
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

// --- Fonctions Utilitaires ---
function getActionLabel(action) {
    switch(action) {
        case POWER_ACTIONS.SHUTDOWN: return 'Arrêt';
        case POWER_ACTIONS.RESTART: return 'Redémarrage';
        case POWER_ACTIONS.HIBERNATE: return 'Veille prolongée'; // Corrigé
        default: return 'Action';
    }
}
function formatTime(milliseconds) { /* ... (inchangé) ... */ }
function showNotification(title, body) { /* ... (inchangé) ... */ }
function decodeConsoleOutput(buffer) { /* ... (inchangé) ... */ }

function clearScheduleState(updateTrayMenu = true) {
    console.log("Nettoyage de l'état programmé.");
    scheduledTime = null;
    scheduledAction = null;
    if (shutdownTimerInterval) { clearInterval(shutdownTimerInterval); shutdownTimerInterval = null; }
    if (hibernateTimeout) { clearTimeout(hibernateTimeout); hibernateTimeout = null; }
    lastNotificationTime = 0;

    // Nettoyer uniquement les clés de planification dans les settings
    const settings = readSettings();
    let settingsChanged = false;
    if (settings.scheduledTime) { delete settings.scheduledTime; settingsChanged = true; }
    if (settings.scheduledAction) { delete settings.scheduledAction; settingsChanged = true; }
    if (settingsChanged) saveSettings(settings); // Sauvegarde que si on a supprimé qqch

    if (tray) {
        tray.setToolTip(TRAY_TOOLTIP_DEFAULT);
        if (updateTrayMenu) buildContextMenu();
    }
    // S'assurer que le renderer est aussi informé (s'il existe)
    if (win && !win.isDestroyed()){
        win.webContents.send(IPC_CHANNELS.UPDATE_STATUS, null);
        win.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, 0); // Assure reset countdown UI
    }
}

// Envoie l'état au renderer ET met à jour le Tray
function sendStatusUpdate(windowTarget) {
    const dataToSend = (scheduledTime && scheduledAction)
                       ? { time: scheduledTime.toISOString(), action: scheduledAction }
                       : null;
    if (windowTarget && !windowTarget.isDestroyed()) {
        windowTarget.webContents.send(IPC_CHANNELS.UPDATE_STATUS, dataToSend);
    }
    // Mise à jour Tray Tooltip
    if (tray) {
        if (dataToSend) {
            const label = getActionLabel(dataToSend.action);
            tray.setToolTip(`${label} programmé pour ${new Date(dataToSend.time).toLocaleTimeString()}`);
        } else {
            tray.setToolTip(TRAY_TOOLTIP_DEFAULT);
        }
    }
    // Mettre à jour Menu Tray (Activer/Désactiver Annuler)
    buildContextMenu();
}

// Envoie le countdown au renderer ET met à jour le Tray + Gère Notification
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

    // Gérer la notification préventive (inchangé)
    if (remaining > 0 && remaining <= NOTIFICATION_THRESHOLD_MS && now.getTime() - lastNotificationTime > NOTIFICATION_THRESHOLD_MS) {
        showNotification('QuickPower Action Imminente', `${getActionLabel(scheduledAction)} dans moins d'une minute !`);
        lastNotificationTime = now.getTime();
    }

    // Nettoyer si le temps est écoulé (sauf hibernation)
    if (remaining === 0 && scheduledAction !== POWER_ACTIONS.HIBERNATE) {
        console.log(`Le délai pour ${scheduledAction} est écoulé (timer UI). Action OS en cours.`);
        clearScheduleState(); // Nettoie état interne/settings
        // sendStatusUpdate est appelé implicitement par clearScheduleState si tray existe, sinon on le fait pour la fenêtre si elle existe
        if (windowTarget && !windowTarget.isDestroyed()) sendStatusUpdate(windowTarget);
    }
  } else {
      // S'il n'y a pas d'action programmée, on s'assure que le timer est arrêté
      if (shutdownTimerInterval) {
          clearInterval(shutdownTimerInterval);
          shutdownTimerInterval = null;
          if (windowTarget && !windowTarget.isDestroyed()) {
              windowTarget.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, 0); // Assure UI à 0
          }
          if (tray) {
              tray.setToolTip(TRAY_TOOLTIP_DEFAULT);
          }
          buildContextMenu(); // MAJ menu tray
      }
  }
}

// Démarre/redémarre le timer interne UI (inchangé)
function startInternalCountdown(windowTarget) {
    if (!windowTarget || windowTarget.isDestroyed()) return;
    if (shutdownTimerInterval) clearInterval(shutdownTimerInterval);
    if (scheduledTime) {
        sendCountdownUpdate(windowTarget); // Envoi initial
        shutdownTimerInterval = setInterval(() => sendCountdownUpdate(windowTarget), 1000);
    } else {
         sendCountdownUpdate(windowTarget); // Envoie 0 si rien n'est programmé
    }
}

// Construction du Menu Contextuel Tray (Simplification du click Annuler)
function buildContextMenu() {
    if (!tray) return;

    const isActionScheduled = !!(scheduledTime && scheduledAction);

    const contextMenuTemplate = [
        {
            label: (win && win.isVisible()) ? 'Masquer' : 'Afficher',
            click: () => {
                if (win) { win.isVisible() ? win.hide() : win.show(); }
                else { createWindow(); } // Recréer si elle a été détruite
            }
        },
        {
            label: 'Annuler l\'action programmée',
            enabled: isActionScheduled,
            click: () => { // Plus besoin d'async ici, on utilise invoke
                console.log("Annulation demandée depuis le menu Tray.");
                ipcMain.invoke(IPC_CHANNELS.CANCEL) // Appelle directement le handler
                    .then(result => {
                        if (!result.success) console.error("Erreur annulation via Tray (retour handle):", result.error);
                    })
                    .catch(err => console.error("Erreur IPC invoke cancel via Tray:", err));
            }
        },
        { type: 'separator' },
        {
            label: 'Quitter',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ];
    const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
    tray.setContextMenu(contextMenu);

    // Mettre à jour l'état du menu Afficher/Masquer
    if (win) {
         contextMenu.items[0].label = win.isVisible() ? 'Masquer' : 'Afficher';
         tray.setContextMenu(contextMenu); // Réappliquer le menu
    }
}


// --- Création de la Fenêtre ---
function createWindow() { // Plus besoin d'async
  if (win) { win.focus(); return; }

  const settings = readSettings(); // Lire les settings (inclut last duration)

  // Restauration de l'état (légèrement ajustée pour timeout hibernation)
  if (settings.scheduledTime && settings.scheduledAction) {
    const savedTime = new Date(settings.scheduledTime);
    const now = new Date();
    if (savedTime > now) {
      scheduledTime = savedTime;
      scheduledAction = settings.scheduledAction;
      console.log(`Action restaurée : ${scheduledAction} pour ${scheduledTime.toLocaleTimeString()}`);
      if (scheduledAction === POWER_ACTIONS.HIBERNATE) {
          const delayMs = Math.max(0, scheduledTime.getTime() - now.getTime());
          console.log(`Relance du setTimeout pour hibernation dans ${(delayMs / 1000).toFixed(0)} secondes.`);
          if (hibernateTimeout) clearTimeout(hibernateTimeout); // Nettoyer ancien au cas où
          hibernateTimeout = setTimeout(() => { // Pas besoin d'async ici
              console.log("Exécution de shutdown /h (restauré)...");
              require('child_process').exec('shutdown /h', (err) => { // Utilise exec simple
                   if (err) {
                       const decodedStderr = decodeConsoleOutput(err.stderr);
                       console.error("Erreur hibernation (restaurée):", decodedStderr);
                       // Pas fiable d'envoyer à la fenêtre ici
                       clearScheduleState();
                       sendStatusUpdate(null); // Tente MAJ Tray
                   }
                   // Si succès, on ne fait rien, le PC hiberne
              });
          }, delayMs);
      }
    } else {
      console.log("Action programmée expirée trouvée, nettoyage.");
      // Nettoie seulement les clés de schedule
      delete settings.scheduledTime;
      delete settings.scheduledAction;
      saveSettings(settings); // Sauvegarde sans l'action expirée
      scheduledTime = null;
      scheduledAction = null;
    }
  }

  win = new BrowserWindow({ /* ... options inchangées ... */
      width: 400,
      height: 420, // Garder 420
      resizable: false, frame: false, transparent: true, icon: iconPath,
      webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true, nodeIntegration: false,
          devTools: !app.isPackaged
      }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => { // Plus besoin d'async
    console.log("did-finish-load event");
    win.webContents.send(IPC_CHANNELS.LOAD_SETTINGS, settings); // Envoie tous les settings
    sendStatusUpdate(win); // Synchro état initial
    startInternalCountdown(win); // Synchro countdown initial
    // Plus de check admin ici
  });

  win.on('close', (event) => { /* ... (inchangé) ... */ });
  win.on('closed', () => { /* ... (inchangé) ... */ });
  win.on('show', buildContextMenu);
  win.on('hide', buildContextMenu);
}

// --- Initialisation App et Tray ---
app.whenReady().then(() => { // Plus besoin d'async
    // Plus de check admin ici
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
    app.on('activate', () => { /* ... (inchangé) ... */ });
});

// --- Gestion Singleton (inchangée) ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }
else { app.on('second-instance', (event, commandLine, workingDirectory) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } else { createWindow(); } }); }


// --- Gestion des IPC ---

ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => win?.minimize());
ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => win?.close()); // Déclenche win.on('close')
ipcMain.on(IPC_CHANNELS.SHOW_WINDOW, () => { if (win) win.show(); else createWindow(); });

// Thème (Utilise .on car pas besoin de retour direct)
ipcMain.on(IPC_CHANNELS.SAVE_THEME, (event, theme) => {
  console.log("IPC: save-theme received:", theme);
  const settings = readSettings();
  settings.theme = theme;
  saveSettings(settings);
  // Optionnel: Notifier les autres fenêtres si on en avait plusieurs
});

// Planification (Retour à async/await mais sans check admin)
ipcMain.handle(IPC_CHANNELS.SCHEDULE, async (event, options) => {
    const { minutes, action, originalValue, originalUnit } = options;
    console.log(`IPC: schedule-power-action received: ${action} in ${minutes} mins`);

    // Validations (inchangées)
    if (typeof minutes !== 'number' || minutes <= 0) return { success: false, error: "Durée invalide." };
    const maxMinutes = 60 * 24 * 7;
    if (minutes > maxMinutes) return { success: false, error: `Durée max: ${maxMinutes / 60 / 24} jours.` };
    if (!Object.values(POWER_ACTIONS).includes(action)) return { success: false, error: "Action inconnue." };

    // Annulation préalable (simplifiée)
    try {
        if (scheduledAction === POWER_ACTIONS.HIBERNATE && hibernateTimeout) {
            console.log("Annulation timeout hibernation précédent.");
            clearTimeout(hibernateTimeout); hibernateTimeout = null;
        } else if (scheduledAction) {
             console.log("Tentative d'annulation OS précédente (shutdown /a)...");
             await execPromise('shutdown /a', { encoding: 'buffer' });
             console.log("Annulation OS préalable (ou tentative) effectuée.");
        }
    } catch (cancelError) {
        const decodedStderr = decodeConsoleOutput(cancelError.stderr);
        // Ignorer l'erreur 1116
        if (!decodedStderr.includes('(1116)')) {
            console.error("Erreur annulation préalable:", decodedStderr);
        } else {
             console.log("Aucune action OS à annuler (code 1116).");
        }
    } finally {
        // Nettoyer l'état interne *avant* de programmer la nouvelle action
        clearScheduleState(false); // false car sendStatusUpdate sera appelé après
    }


    // Programmer la nouvelle action
    const now = new Date();
    scheduledTime = new Date(now.getTime() + minutes * 60000);
    scheduledAction = action;
    console.log(`Programmation effective: ${action} pour ${scheduledTime.toLocaleTimeString()}`);

    try {
        let command = '';
        const seconds = minutes * 60;

        if (action === POWER_ACTIONS.SHUTDOWN) { command = `shutdown /s /t ${seconds}`; await execPromise(command); }
        else if (action === POWER_ACTIONS.RESTART) { command = `shutdown /r /t ${seconds}`; await execPromise(command); }
        else if (action === POWER_ACTIONS.HIBERNATE) {
            const delayMs = minutes * 60000;
            console.log(`Mise en place setTimeout 'shutdown /h' dans ${delayMs}ms.`);
            if(hibernateTimeout) clearTimeout(hibernateTimeout); // Sécurité
            hibernateTimeout = setTimeout(() => { // Pas async
                 console.log("Exécution de shutdown /h via setTimeout...");
                 require('child_process').exec('shutdown /h', (err) => {
                     if (err) {
                         const decodedStderr = decodeConsoleOutput(err.stderr);
                         console.error("Erreur exécution shutdown /h:", decodedStderr);
                         // Difficile d'informer l'UI ici, mais on nettoie l'état
                         clearScheduleState();
                         sendStatusUpdate(null); // Tente MAJ Tray
                     }
                     // Si succès, le PC hiberne, rien à faire de plus ici.
                 });
            }, delayMs);
        }

        if (action !== POWER_ACTIONS.HIBERNATE) { console.log(`Commande OS exécutée: ${command}`); }

        // Sauvegarder l'état (inclut last duration)
        const settings = readSettings();
        settings.scheduledTime = scheduledTime.toISOString();
        settings.scheduledAction = scheduledAction;
        settings.lastDurationValue = originalValue;
        settings.lastDurationUnit = originalUnit;
        saveSettings(settings);

        // Mettre à jour l'UI
        sendStatusUpdate(win);
        startInternalCountdown(win);

        if (win && !win.isVisible()){ showNotification('QuickPower', `${getActionLabel(action)} programmé pour ${scheduledTime.toLocaleTimeString()}.`); }

        return { success: true };

    } catch (scheduleError) {
        const decodedStderr = decodeConsoleOutput(scheduleError.stderr);
        console.error(`Erreur programmation OS (${action}):`, decodedStderr);
        let errorMessage = `Impossible de programmer : ${action}.`;
        // Simplification: plus de check admin ici
        if (decodedStderr) {
             errorMessage += ` Détail : ${decodedStderr.split('\n')[0].trim()}`;
        } else {
             errorMessage += " Vérifiez les permissions."; // Conseil générique
        }
        clearScheduleState();
        sendStatusUpdate(win); // Informe UI/Tray de l'échec
        return { success: false, error: errorMessage };
    }
});

// Annulation (Simplifié)
ipcMain.handle(IPC_CHANNELS.CANCEL, async (event) => {
    console.log("IPC: cancel-power-action received");
    let wasActionScheduledInternally = !!scheduledAction;
    let messageLog = "Annulation demandée.";

    try {
        if (scheduledAction === POWER_ACTIONS.HIBERNATE && hibernateTimeout) {
            clearTimeout(hibernateTimeout); hibernateTimeout = null;
            messageLog = "Timeout d'hibernation annulé.";
        } else if (scheduledAction) { // Shutdown ou Restart
            messageLog = "Tentative d'annulation OS (shutdown /a)...";
            try {
                await execPromise('shutdown /a', { encoding: 'buffer' });
                messageLog = "Commande shutdown /a exécutée.";
            } catch (error) {
                 const decodedStderr = decodeConsoleOutput(error.stderr);
                 if (!decodedStderr.includes('(1116)')) {
                    console.error("Erreur lors de shutdown /a:", decodedStderr);
                    // NE PAS retourner false ici, l'état interne sera nettoyé quand même
                    messageLog = "Erreur lors de l'annulation OS, mais nettoyage interne effectué.";
                    showNotification('QuickPower Erreur', "Impossible d'annuler l'action système."); // Notifier l'échec OS
                 } else {
                    messageLog = "Annulation OS non nécessaire (code 1116).";
                 }
            }
        } else {
             messageLog = "Aucune action interne à annuler.";
             // Tenter /a quand même au cas où
             try { await execPromise('shutdown /a', { encoding: 'buffer' }); } catch(e) { /* ignore */ }
        }

        console.log(messageLog);
        clearScheduleState(true); // Nettoie tout et met à jour le Tray
        if (wasActionScheduledInternally) { // Notifier seulement si on a vraiment annulé qqch
            showNotification('QuickPower', 'Action programmée annulée.');
        }

        return { success: true, message: "Action annulée !" }; // Message pour le renderer

    } catch (error) { // Erreur inattendue dans le handler lui-même
        console.error("Erreur inattendue dans le handler d'annulation:", error);
        clearScheduleState(true);
        sendStatusUpdate(win); // Assurer la mise à jour UI/Tray
        return { success: false, error: "Erreur interne lors de l'annulation.", message: error.message };
    }
});


// --- Gestion du cycle de vie de l'application (inchangée) ---
app.on('window-all-closed', () => { /* ... */ });
app.on('activate', () => { /* ... */ });
app.on('before-quit', (event) => { /* ... */ });
app.on('quit', () => { /* ... */ });