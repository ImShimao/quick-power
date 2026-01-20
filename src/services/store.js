const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { SETTINGS_FILE, POWER_ACTIONS } = require('../constants');

const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

class Store {
    constructor() {
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(settingsPath)) {
                const raw = fs.readFileSync(settingsPath, 'utf-8');
                const data = JSON.parse(raw);
                
                // Migration (Logique conservée de ton ancien code)
                if (data.shutdownTime && !data.scheduledTime) {
                    data.scheduledTime = data.shutdownTime;
                    delete data.shutdownTime;
                    if (!data.scheduledAction) data.scheduledAction = POWER_ACTIONS.SHUTDOWN;
                }
                
                return { 
                    theme: 'light', 
                    lastDurationValue: 30, 
                    lastDurationUnit: 'minutes', 
                    ...data 
                };
            }
        } catch (e) {
            console.error("Erreur lecture settings:", e);
        }
        return { theme: 'light', lastDurationValue: 30, lastDurationUnit: 'minutes' };
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
        this._save();
    }

    getAll() {
        return { ...this.data };
    }

    // Sauvegarde spécifique pour l'état programmé
    saveState(time, action) {
        if (time && action) {
            this.data.scheduledTime = time.toISOString();
            this.data.scheduledAction = action;
        } else {
            delete this.data.scheduledTime;
            delete this.data.scheduledAction;
        }
        this._save();
    }

    _save() {
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error("Erreur sauvegarde settings:", e);
        }
    }
}

module.exports = new Store();