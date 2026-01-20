const { exec } = require('child_process');
const EventEmitter = require('events');
const { POWER_ACTIONS } = require('../constants');

class Scheduler extends EventEmitter {
    constructor() {
        super();
        this.scheduledTime = null;
        this.scheduledAction = null;
        this.initialDuration = 0; // Nouveau : pour calculer la barre de progression
        this.timerInterval = null;
        this.hibernateTimeout = null;
    }

    schedule(minutes, action) {
        this.cancel(false); 

        const now = new Date();
        this.initialDuration = minutes * 60000; // On stocke la durée totale
        this.scheduledTime = new Date(now.getTime() + this.initialDuration);
        this.scheduledAction = action;
        
        const seconds = Math.floor(minutes * 60);

        let cmd = '';
        if (action === POWER_ACTIONS.SHUTDOWN) cmd = `shutdown /s /t ${seconds}`;
        else if (action === POWER_ACTIONS.RESTART) cmd = `shutdown /r /t ${seconds}`;
        
        if (cmd) {
            this._execCmd(cmd);
        } else if (action === POWER_ACTIONS.HIBERNATE) {
            this.hibernateTimeout = setTimeout(() => {
                this._execCmd('shutdown /h');
            }, this.initialDuration);
        }

        this._startTicker();
        this.emit('status-changed', { time: this.scheduledTime, action: this.scheduledAction });
    }

    cancel(notify = true) {
        if (this.scheduledAction && this.scheduledAction !== POWER_ACTIONS.HIBERNATE) {
            this._execCmd('shutdown /a');
        }

        if (this.hibernateTimeout) clearTimeout(this.hibernateTimeout);
        if (this.timerInterval) clearInterval(this.timerInterval);

        this.scheduledTime = null;
        this.scheduledAction = null;
        this.initialDuration = 0;
        this.hibernateTimeout = null;
        this.timerInterval = null;

        if (notify) {
            this.emit('status-changed', null);
        }
    }

    _startTicker() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this._tick(); // Tick immédiat
        this.timerInterval = setInterval(() => this._tick(), 1000);
    }

    _tick() {
        if (!this.scheduledTime) return;
        
        const now = new Date();
        const remaining = Math.max(0, this.scheduledTime.getTime() - now.getTime());
        
        // Calcul du ratio (1.0 = plein, 0.0 = vide) pour la barre Windows
        const ratio = this.initialDuration > 0 ? remaining / this.initialDuration : 0;

        // On envoie maintenant un objet { remaining, ratio }
        this.emit('tick', { remaining, ratio });

        if (remaining <= 0) {
            this.cancel(true);
        }
    }

    _execCmd(cmd) {
        console.log(`Exécution commande: ${cmd}`);
        exec(cmd, (err) => {
            if (err) console.error(`Erreur exec "${cmd}":`, err.message);
        });
    }

    getState() {
        return { time: this.scheduledTime, action: this.scheduledAction };
    }
}

module.exports = new Scheduler();