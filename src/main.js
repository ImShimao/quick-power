const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const util = require('util'); // Pour promisify
const execPromise = util.promisify(require('child_process').exec); // Utiliser la version Promesse
const fs = require('fs');
const iconv = require('iconv-lite'); // Pour décoder la sortie console Windows

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
    WINDOW_CLOSE: 'window-close'
};
const POWER_ACTIONS = {
    SHUTDOWN: 'shutdown',
    RESTART: 'restart',
    HIBERNATE: 'hibernate'
};

// --- Logique de sauvegarde des préférences ---
const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

function readSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(data);
       // Assurer la compatibilité avec l'ancien nom de clé
       if (settings.shutdownTime && !settings.scheduledTime) {
          settings.scheduledTime = settings.shutdownTime;
          delete settings.shutdownTime;
          // Action par défaut si non présente
          if (!settings.scheduledAction) settings.scheduledAction = POWER_ACTIONS.SHUTDOWN;
          saveSettings(settings); // Sauvegarder la migration
      }
      return settings;
    }
  } catch (error) {
    console.error("Erreur en lisant les préférences:", error);
  }
  return { theme: 'light' }; // Retourne un objet par défaut
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); // Ajout de l'indentation pour lisibilité
  } catch (error) {
    console.error("Erreur en sauvegardant les préférences:", error);
  }
}

// --- Variables globales ---
let scheduledTime = null; // Date object
let scheduledAction = null; // String ('shutdown', 'restart', 'hibernate')
let shutdownTimerInterval = null; // Interval pour le countdown UI
let hibernateTimeout = null; // Timeout spécifique pour l'hibernation
let win = null; // Référence à la fenêtre, initialisée à null

// --- Fonctions Utilitaires ---
function clearScheduleState() {
    scheduledTime = null;
    scheduledAction = null;
    if (shutdownTimerInterval) {
        clearInterval(shutdownTimerInterval);
        shutdownTimerInterval = null;
    }
    if (hibernateTimeout) {
        clearTimeout(hibernateTimeout);
        hibernateTimeout = null;
    }
    // Nettoyer les settings uniquement si l'action n'est plus valide
    const settings = readSettings();
    if (settings.scheduledTime || settings.scheduledAction) {
        delete settings.scheduledTime;
        delete settings.scheduledAction;
        saveSettings(settings);
    }
}

// Envoie l'état actuel (heure ISO et action, ou null) au renderer
function sendStatusUpdate(windowTarget) {
    const dataToSend = (scheduledTime && scheduledAction)
                       ? { time: scheduledTime.toISOString(), action: scheduledAction }
                       : null;
    if (windowTarget && !windowTarget.isDestroyed()) {
        windowTarget.webContents.send(IPC_CHANNELS.UPDATE_STATUS, dataToSend);
    } else {
        // Optionnel : Log si la fenêtre n'est plus là (peut arriver pendant l'hibernation/fermeture)
        // console.log("Tentative d'envoi de statut à une fenêtre inexistante ou détruite.");
    }
}

// Envoie le temps restant en ms au renderer
function sendCountdownUpdate(windowTarget) {
  if (windowTarget && !windowTarget.isDestroyed() && scheduledTime) {
    const now = new Date();
    const remaining = Math.max(0, scheduledTime.getTime() - now.getTime());
    windowTarget.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, remaining);

    // Si le temps est écoulé ET que ce n'est PAS une hibernation gérée par setTimeout
    if (remaining === 0 && scheduledAction !== POWER_ACTIONS.HIBERNATE) {
        console.log(`Le délai pour ${scheduledAction} est écoulé.`);
        clearScheduleState(); // Nettoyer l'état interne
        sendStatusUpdate(windowTarget); // Envoyer le statut nul
    }
  } else if (shutdownTimerInterval) {
     // Si le timer tourne mais qu'il n'y a plus d'heure/fenêtre valide, on l'arrête
     clearInterval(shutdownTimerInterval);
     shutdownTimerInterval = null;
     if (windowTarget && !windowTarget.isDestroyed()) {
         windowTarget.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, 0); // Indiquer 0 temps restant
     }
  }
}

// Démarre/redémarre le timer interne pour mettre à jour l'UI
function startInternalCountdown(windowTarget) {
    if (!windowTarget || windowTarget.isDestroyed()) return; // Ne rien faire si pas de fenêtre valide
    if (shutdownTimerInterval) clearInterval(shutdownTimerInterval); // Nettoyer l'ancien timer s'il existe
    if (scheduledTime) {
        // Exécute immédiatement puis toutes les secondes
        sendCountdownUpdate(windowTarget); // Envoi initial
        shutdownTimerInterval = setInterval(() => sendCountdownUpdate(windowTarget), 1000);
    } else {
         // S'assurer que le compte à rebours est à 0 s'il n'y a pas d'heure programmée
         sendCountdownUpdate(windowTarget); // Envoie 0 si scheduledTime est null
    }
}

// Fonction pour décoder la sortie console Windows
function decodeConsoleOutput(buffer) {
    if (!buffer) return '';
    const bufferInstance = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    // Tenter avec les encodages les plus probables pour Windows FR
    // cp850 est souvent utilisé par cmd.exe par défaut
    try { return iconv.decode(bufferInstance, 'cp850'); } catch (e) { console.warn('Failed cp850 decode');}
    try { return iconv.decode(bufferInstance, 'cp1252'); } catch (e) { console.warn('Failed cp1252 decode');}
    try { return iconv.decode(bufferInstance, 'latin1'); } catch (e) { console.warn('Failed latin1 decode');}
    return bufferInstance.toString('utf8'); // Fallback en UTF-8
}


// --- Création de la Fenêtre ---
function createWindow() {
  if (win) {
      win.focus();
      return;
  }

  const settings = readSettings();

  // Restauration de l'état au démarrage
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
          // Nettoyer un éventuel ancien timeout fantôme
          if (hibernateTimeout) clearTimeout(hibernateTimeout);
          hibernateTimeout = setTimeout(async () => {
              try {
                  console.log("Exécution de shutdown /h (restauré)...");
                  // Lancer la commande sans attendre de retour car le système va hiberner
                  require('child_process').exec('shutdown /h');
                  // On ne peut pas garantir que le code après arrive à s'exécuter
                  // Le nettoyage se fera au prochain lancement si nécessaire
              } catch (hibernateErr) {
                   // Logguer l'erreur si elle se produit avant l'hibernation effective
                   const decodedStderr = decodeConsoleOutput(hibernateErr.stderr);
                   console.error("Erreur immédiate lors de la tentative d'hibernation (restaurée):", decodedStderr);
                   if (win && !win.isDestroyed()) {
                       win.webContents.send(IPC_CHANNELS.SHOW_ERROR, "Impossible de mettre en veille prolongée.");
                   }
                   clearScheduleState(); // Nettoyer en cas d'erreur
                   sendStatusUpdate(win);
              }
          }, delayMs);
      }
    } else {
      console.log("Action programmée expirée trouvée dans les settings, nettoyage.");
      clearScheduleState();
    }
  }

  win = new BrowserWindow({
    width: 400,
    height: 420, // Ajustée pour les radios
    resizable: false,
    frame: false,
    transparent: true,
    icon: path.join(__dirname, '..', 'assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged // Ouvre les devTools seulement en développement
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.webContents.send(IPC_CHANNELS.LOAD_SETTINGS, settings);
    sendStatusUpdate(win); // Envoyer l'état actuel (important pour restaurer l'UI)
    startInternalCountdown(win); // Démarrer/Mettre à jour le compte à rebours UI
  });

  win.on('closed', () => {
      if (shutdownTimerInterval) clearInterval(shutdownTimerInterval);
      // Ne PAS annuler hibernateTimeout ici, il doit survivre
      shutdownTimerInterval = null;
      win = null;
      console.log("Fenêtre fermée.");
  });
}

// --- Gestion Singleton ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else {
        createWindow(); // Créer la fenêtre si elle a été fermée
    }
  });

  app.whenReady().then(createWindow);
}


// --- Gestion des IPC (Refactorisé) ---

ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => win?.minimize());
ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => win?.close());

ipcMain.on(IPC_CHANNELS.SAVE_THEME, (event, theme) => {
  const settings = readSettings();
  settings.theme = theme;
  saveSettings(settings);
});

// Planification
ipcMain.handle(IPC_CHANNELS.SCHEDULE, async (event, options) => {
  const { minutes, action } = options;

  // Validations
  if (typeof minutes !== 'number' || minutes <= 0) {
      return { success: false, error: "La durée doit être un nombre positif." };
  }
  const maxMinutes = 60 * 24 * 7; // 1 semaine max
  if (minutes > maxMinutes) {
      return { success: false, error: `Durée trop longue (max ${maxMinutes / 60 / 24} jours).` };
  }
  if (!Object.values(POWER_ACTIONS).includes(action)) {
      return { success: false, error: "Action non reconnue." };
  }

  // Annulation préalable de toute action OS et interne
  let previousActionCancelled = false;
  try {
      if (scheduledAction === POWER_ACTIONS.HIBERNATE && hibernateTimeout) {
          console.log("Annulation du timeout d'hibernation précédent.");
          clearTimeout(hibernateTimeout);
          hibernateTimeout = null; // Important de réinitialiser
          previousActionCancelled = true;
      } else if (scheduledAction) { // Pour shutdown/restart
           console.log("Tentative d'annulation OS précédente (shutdown /a)...");
           const { stderr } = await execPromise('shutdown /a', { encoding: 'buffer' });
           const decodedStderr = decodeConsoleOutput(stderr);
           if (stderr && stderr.length > 0 && !decodedStderr.includes('(1116)')) {
               // Log l'erreur mais on continue, car on veut quand même programmer la nouvelle action
               console.warn("Avertissement lors de l'annulation préalable:", decodedStderr);
           } else {
                console.log("Annulation OS préalable réussie ou non nécessaire (code 1116).");
           }
           previousActionCancelled = true; // On considère que l'état interne doit être réinitialisé
      }
  } catch (cancelError) {
      const decodedStderr = decodeConsoleOutput(cancelError.stderr);
      if (!decodedStderr.includes('(1116)')) { // Ignorer l'erreur normale si rien n'était programmé
          console.error("Erreur inattendue lors de l'annulation préalable:", decodedStderr);
          // Ne pas bloquer la nouvelle programmation à cause de ça
      } else {
          console.log("Aucune action OS à annuler (code 1116).");
      }
      previousActionCancelled = true; // L'état interne doit être réinitialisé
  } finally {
     // Nettoie l'état interne (timers, variables, settings) *uniquement si* une action était prévue
     // ou si une erreur d'annulation inattendue s'est produite
     if(previousActionCancelled || (scheduledAction && !hibernateTimeout) ) {
         clearScheduleState();
         // On n'envoie pas de mise à jour UI ici, car on va en programmer une nouvelle juste après
     }
  }

  // Programmer la nouvelle action
  const now = new Date();
  scheduledTime = new Date(now.getTime() + minutes * 60000);
  scheduledAction = action;
  console.log(`Programmation de : ${action} pour ${scheduledTime.toLocaleTimeString()} (${minutes} minutes)`);

  try {
      let command = '';
      const seconds = minutes * 60;

      if (action === POWER_ACTIONS.SHUTDOWN) {
          command = `shutdown /s /t ${seconds}`;
          await execPromise(command);
          console.log(`Commande OS exécutée: ${command}`);
      } else if (action === POWER_ACTIONS.RESTART) {
          command = `shutdown /r /t ${seconds}`;
          await execPromise(command);
          console.log(`Commande OS exécutée: ${command}`);
      } else if (action === POWER_ACTIONS.HIBERNATE) {
          const delayMs = minutes * 60000;
          console.log(`Mise en place du setTimeout pour 'shutdown /h' dans ${delayMs}ms.`);
          if(hibernateTimeout) clearTimeout(hibernateTimeout); // Sécurité supplémentaire
          hibernateTimeout = setTimeout(async () => {
              try {
                  console.log("Exécution de shutdown /h via setTimeout...");
                   // Utilisation de exec simple, car on ne peut pas attendre le résultat
                   require('child_process').exec('shutdown /h', (err) => {
                       if (err) { // Cette erreur ne sera probablement vue que si la cmd échoue immédiatement
                            const decodedStderr = decodeConsoleOutput(err.stderr);
                            console.error("Erreur immédiate lors de l'exécution de shutdown /h:", decodedStderr);
                            // Informer l'utilisateur si possible (fenêtre peut être fermée)
                            if (win && !win.isDestroyed()) {
                                win.webContents.send(IPC_CHANNELS.SHOW_ERROR, "Impossible de mettre en veille prolongée.");
                            }
                            clearScheduleState();
                            sendStatusUpdate(win);
                       }
                       // Pas de nettoyage ici, car le système est censé hiberner
                   });
              } catch (hibernateErr) {
                    // Ce catch est peu probable d'être atteint pour shutdown /h
                    const decodedStderr = decodeConsoleOutput(hibernateErr.stderr);
                    console.error("Erreur (catch) lors de l'exécution de shutdown /h:", decodedStderr);
                    if (win && !win.isDestroyed()) {
                       win.webContents.send(IPC_CHANNELS.SHOW_ERROR, "Impossible de mettre en veille prolongée.");
                    }
                    clearScheduleState();
                    sendStatusUpdate(win);
              }
          }, delayMs);
      }

      // Sauvegarder l'état
      const settings = readSettings();
      settings.scheduledTime = scheduledTime.toISOString();
      settings.scheduledAction = scheduledAction;
      saveSettings(settings);

      // Mettre à jour l'UI
      sendStatusUpdate(win);
      startInternalCountdown(win);

      return { success: true }; // Succès retourné à l'invoke

  } catch (scheduleError) {
      const decodedStderr = decodeConsoleOutput(scheduleError.stderr);
      console.error(`Erreur lors de la programmation OS de ${action}:`, decodedStderr);
      clearScheduleState(); // Nettoyer en cas d'erreur
      sendStatusUpdate(win); // Informer l'UI que c'est annulé/échoué
      return { success: false, error: `Impossible de programmer l'action (${action}). Vérifiez les permissions.` };
  }
});

// Annulation
ipcMain.handle(IPC_CHANNELS.CANCEL, async (event) => {
  let wasActionScheduledInternally = !!scheduledAction; // Vérifie l'état interne *avant* nettoyage

  try {
    let message = "Aucune action interne n'était programmée."; // Message par défaut

    if (wasActionScheduledInternally) {
        if (scheduledAction === POWER_ACTIONS.HIBERNATE && hibernateTimeout) {
            clearTimeout(hibernateTimeout);
            hibernateTimeout = null;
            message = "Timeout d'hibernation annulé.";
            console.log(message);
        } else if (scheduledAction === POWER_ACTIONS.SHUTDOWN || scheduledAction === POWER_ACTIONS.RESTART) {
            console.log("Tentative d'annulation OS (shutdown /a)...");
            try {
                const { stdout, stderr } = await execPromise('shutdown /a', { encoding: 'buffer' });
                const decodedStderr = decodeConsoleOutput(stderr);
                if (stderr && stderr.length > 0 && !decodedStderr.includes('(1116)')) {
                    console.warn("Sortie (stderr) de 'shutdown /a':", decodedStderr);
                    message = "Annulation OS effectuée avec avertissement.";
                } else if (stderr && stderr.length > 0 && decodedStderr.includes('(1116)')) {
                     console.log("Annulation OS non nécessaire (code 1116).");
                     message = "Action annulée (rien à annuler côté OS).";
                } else {
                    message = "Commande shutdown /a exécutée avec succès.";
                    console.log(message);
                }
            } catch (error) {
                 const decodedStderr = decodeConsoleOutput(error.stderr);
                 // Si l'erreur est 1116, ce n'est pas grave
                 if (!decodedStderr.includes('(1116)')) {
                    console.error("Erreur lors de l'exécution de shutdown /a:", decodedStderr);
                    // On ne retourne pas d'erreur ici, car on va quand même nettoyer l'état interne
                    message = "Erreur lors de l'annulation OS, mais état interne nettoyé.";
                 } else {
                      console.log("Annulation OS non nécessaire (code 1116 - via catch).");
                      message = "Action annulée (rien à annuler côté OS).";
                 }
            }
        }
    } else {
         console.log(message);
         // Essayer quand même d'exécuter shutdown /a au cas où une action OS existerait sans être dans notre état
         try {
             await execPromise('shutdown /a', { encoding: 'buffer' });
         } catch(e) { /* Ignorer l'erreur 1116 ici */ }
    }

    clearScheduleState(); // Nettoie l'état interne et les settings DANS TOUS LES CAS
    sendStatusUpdate(win); // Envoie le statut nul à l'UI
    return { success: true, message: message }; // Toujours retourner succès pour l'UX si l'état interne est propre

  } catch (error) { // Ce catch est pour des erreurs inattendues dans la logique handle elle-même
    console.error("Erreur inattendue dans le handler d'annulation:", error);
    clearScheduleState(); // Assurer le nettoyage
    sendStatusUpdate(win);
    return { success: false, error: "Erreur interne lors de l'annulation.", message: error.message };
  }
});


// --- Gestion du cycle de vie de l'application ---
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Ne pas quitter si une hibernation est en attente via setTimeout
    if (!hibernateTimeout) {
        console.log("Toutes les fenêtres sont fermées, fermeture de l'application.");
        app.quit();
    } else {
        console.log("Fenêtre fermée, mais hibernation programmée. L'application reste active.");
        // Optionnel : Créer une icône dans la zone de notification pour pouvoir annuler/quitter
    }
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Gère le cas où l'application est quittée alors qu'un timeout d'hibernation est actif
app.on('before-quit', (event) => {
    if (hibernateTimeout) {
        console.log("Tentative de quitter l'application avec une hibernation programmée. Annulation du timeout.");
        // L'utilisateur a choisi de quitter explicitement (Cmd+Q, Alt+F4, via Tray Icon, etc.)
        // On annule le timeout pour ne pas surprendre l'utilisateur avec une hibernation après coup.
        clearTimeout(hibernateTimeout);
        hibernateTimeout = null;
        // On nettoie aussi les settings pour ne pas le restaurer au prochain lancement
        const settings = readSettings();
        delete settings.scheduledTime;
        delete settings.scheduledAction;
        saveSettings(settings);
    }
    // L'application peut maintenant quitter normalement
});