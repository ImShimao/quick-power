// src/constants.js
const path = require('path');

module.exports = {
    SETTINGS_FILE: 'settings.json',
    IPC_CHANNELS: {
        SCHEDULE: 'schedule-power-action',
        CANCEL: 'cancel-power-action',
        UPDATE_STATUS: 'update-status',
        UPDATE_COUNTDOWN: 'update-countdown',
        SHOW_ERROR: 'show-error',
        SAVE_THEME: 'save-theme',
        SAVE_AUTO_START: 'save-auto-start', // NOUVEAU
        LOAD_SETTINGS: 'load-settings',
        WINDOW_MINIMIZE: 'window-minimize',
        WINDOW_CLOSE: 'window-close',
        SHOW_WINDOW: 'show-window'
    },
    POWER_ACTIONS: {
        SHUTDOWN: 'shutdown',
        RESTART: 'restart',
        HIBERNATE: 'hibernate'
    },
    ICON_PATH: path.join(__dirname, '..', 'assets/icon.ico')
};