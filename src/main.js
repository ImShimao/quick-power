const { app, BrowserWindow, ipcMain, Tray, Menu, Notification } = require('electron');
const path = require('path');
// Ajout de POWER_ACTIONS dans les imports
const { IPC_CHANNELS, ICON_PATH, POWER_ACTIONS } = require('./constants');
const store = require('./services/store');
const scheduler = require('./services/scheduler');

let win = null;
let tray = null;
let isQuitting = false;

// --- Fonctions Helper ---

function sendStatusToWindow() {
    if (win && !win.isDestroyed()) {
        const state = scheduler.getState();
        const data = state.time ? { time: state.time.toISOString(), action: state.action } : null;
        win.webContents.send(IPC_CHANNELS.UPDATE_STATUS, data);
    }
}

function updateTray(remainingMs = null) {
    if (!tray) return;
    const state = scheduler.getState();

    if (state.action && state.time) {
        let tooltipText = `${state.action} programmé`;
        if (remainingMs !== null) {
            const minutes = Math.floor(remainingMs / 60000);
            const seconds = Math.floor((remainingMs % 60000) / 1000);
            tooltipText = `${state.action} dans ${minutes}m ${seconds}s`;
        }
        tray.setToolTip(tooltipText);
    } else {
        tray.setToolTip('QuickPower - Prêt');
    }
    buildContextMenu(); 
}

// Fonction pour les programmations rapides depuis le menu
function scheduleQuick(minutes, action) {
    scheduler.schedule(minutes, action);
    // Petit feedback visuel immédiat si la fenêtre n'est pas là
    if (!win || !win.isVisible()) {
        const notif = new Notification({
            title: 'QuickPower',
            body: `${action} programmé dans ${minutes} minutes.`,
            icon: ICON_PATH
        });
        notif.show();
    }
}

// --- Écouteurs du Scheduler ---

scheduler.on('status-changed', (state) => {
    sendStatusToWindow();
    updateTray();
    
    // Reset de la barre de progression quand on annule (-1 enlève la barre)
    if (!state && win) win.setProgressBar(-1);

    if (state) {
        store.saveState(state.time, state.action);
    } else {
        store.saveState(null, null);
    }
});

// Réception du TICK (chaque seconde)
scheduler.on('tick', ({ remaining, ratio }) => {
    if (win && !win.isDestroyed()) {
        // MISE À JOUR : On envoie maintenant le ratio au Renderer pour le cercle SVG
        win.webContents.send(IPC_CHANNELS.UPDATE_COUNTDOWN, remaining, ratio);
        
        // Barre de progression dans la taskbar Windows
        win.setProgressBar(ratio);
    }
    updateTray(remaining);
});

// --- IPC Handlers ---

ipcMain.handle(IPC_CHANNELS.SCHEDULE, async (event, { minutes, action, originalValue, originalUnit }) => {
    try {
        if (!minutes || minutes <= 0) throw new Error("Durée invalide");
        scheduler.schedule(minutes, action);
        store.set('lastDurationValue', originalValue);
        store.set('lastDurationUnit', originalUnit);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle(IPC_CHANNELS.CANCEL, async () => {
    scheduler.cancel();
    return { success: true, message: "Action annulée" };
});

ipcMain.on(IPC_CHANNELS.SAVE_THEME, (event, theme) => store.set('theme', theme));

// NOUVEAU : Handler pour sauvegarder le paramètre "Lancer au démarrage"
ipcMain.on(IPC_CHANNELS.SAVE_AUTO_START, (event, openAtLogin) => {
    store.set('openAtLogin', openAtLogin);
    app.setLoginItemSettings({ 
        openAtLogin: openAtLogin, 
        path: process.execPath, 
        args: ['--hidden'] 
    });
});

ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => win?.minimize());
ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => win?.close());
ipcMain.on(IPC_CHANNELS.SHOW_WINDOW, () => win?.show());

// --- App Lifecycle ---

function createWindow() {
    if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        return;
    }

    const settings = store.getAll();

    win = new BrowserWindow({
        width: 350,   // Légèrement plus large pour éviter que le texte ne soit serré
        height: 460,  // Beaucoup plus court (au lieu de 520) pour supprimer le vide
        resizable: false,
        frame: false,
        transparent: true,
        icon: ICON_PATH,
        backgroundColor: '#00000000',
        show: false, 
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged
        }
    });

    win.loadFile(path.join(__dirname, 'index.html'));

    win.webContents.on('did-finish-load', () => {
        // On envoie les settings au chargement pour cocher/décocher le bouton auto-start
        win.webContents.send(IPC_CHANNELS.LOAD_SETTINGS, settings);
        sendStatusToWindow();
    });

    win.once('ready-to-show', () => {
        win.show();
    });

    win.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            win.hide();
            return false;
        }
    });

    win.on('closed', () => { win = null; });
}

function buildContextMenu() {
    if (!tray) return;

    const state = scheduler.getState();
    const isActionScheduled = !!state.action;

    const contextMenu = Menu.buildFromTemplate([
        {
            label: (win && win.isVisible()) ? 'Masquer Fenêtre' : 'Ouvrir QuickPower',
            click: () => {
                if (win) win.isVisible() ? win.hide() : win.show();
                else createWindow();
            }
        },
        { type: 'separator' },
        {
            label: 'Programmation Rapide',
            enabled: !isActionScheduled,
            submenu: [
                { label: 'Arrêter dans 15 min', click: () => scheduleQuick(15, POWER_ACTIONS.SHUTDOWN) },
                { label: 'Arrêter dans 30 min', click: () => scheduleQuick(30, POWER_ACTIONS.SHUTDOWN) },
                { label: 'Arrêter dans 1h', click: () => scheduleQuick(60, POWER_ACTIONS.SHUTDOWN) },
                { type: 'separator' },
                { label: 'Redémarrer dans 15 min', click: () => scheduleQuick(15, POWER_ACTIONS.RESTART) },
            ]
        },
        {
            label: 'Annuler l\'action en cours',
            enabled: isActionScheduled,
            click: () => scheduler.cancel()
        },
        { type: 'separator' },
        {
            label: 'Quitter totalement',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
    // MISE À JOUR : Chargement dynamique du paramètre "openAtLogin"
    const autoStart = store.get('openAtLogin') ?? true;
    app.setLoginItemSettings({ openAtLogin: autoStart, path: process.execPath, args: ['--hidden'] });

    try {
        tray = new Tray(ICON_PATH);
        tray.setToolTip('QuickPower');
        tray.on('click', () => {
             if (win) win.isVisible() ? win.hide() : win.show();
             else createWindow();
        });
        buildContextMenu();
    } catch (e) { console.error("Erreur Tray:", e); }

    createWindow();

    const savedTime = store.get('scheduledTime');
    const savedAction = store.get('scheduledAction');
    
    if (savedTime && savedAction) {
        const targetDate = new Date(savedTime);
        const now = new Date();
        if (targetDate > now) {
            const minutesRemaining = (targetDate.getTime() - now.getTime()) / 60000;
            scheduler.schedule(minutesRemaining, savedAction);
        } else {
            store.saveState(null, null);
        }
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        } else {
            createWindow();
        }
    });
}

app.on('window-all-closed', () => {});