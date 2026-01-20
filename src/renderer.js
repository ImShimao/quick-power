// renderer.js

// --- Fonctions Utilitaires ---
function formatTime(milliseconds) {
    if (milliseconds <= 0) return "00:00:00";
    let totalSeconds = Math.floor(milliseconds / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function getActionLabel(action) {
    switch(action) {
        case 'shutdown': return 'Arrêt';
        case 'restart': return 'Redémarrage';
        case 'hibernate': return 'Veille prolongée';
        default: return 'Action';
    }
}

// --- Initialisation ---
document.addEventListener('DOMContentLoaded', () => {

    // Éléments du DOM
    const minimizeBtn = document.getElementById('minimize-btn');
    const closeBtn = document.getElementById('close-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const validateBtn = document.getElementById('validate-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const statusEl = document.getElementById('status');
    const timeValueInput = document.getElementById('time-value');
    const timeUnitSelect = document.getElementById('time-unit');
    const actionRadios = document.querySelectorAll('input[name="powerAction"]');

    let currentScheduledAction = null;
    let currentScheduledTime = null;

    // --- Logique Fenêtre (Minimiser / Fermer vers Tray) ---
    if(minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
    if(closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.close());
    
    // --- Logique Thème ---
    if(themeToggle) themeToggle.addEventListener('change', (event) => {
        const newTheme = event.target.checked ? 'dark' : 'light';
        document.body.className = newTheme;
        window.electronAPI.saveTheme(newTheme);
    });

    // --- Chargement des Paramètres au démarrage ---
    window.electronAPI.onLoadSettings((settings) => {
        console.log("Settings reçus:", settings);
        const theme = settings.theme || 'light';
        document.body.className = theme;
        if(themeToggle) themeToggle.checked = (theme === 'dark');
        
        // Restaure la dernière durée utilisée
        if (settings.lastDurationValue && timeValueInput) { 
            timeValueInput.value = settings.lastDurationValue; 
        }
        if (settings.lastDurationUnit && timeUnitSelect) { 
            timeUnitSelect.value = settings.lastDurationUnit; 
        }
    });

    // --- Fonctions UI (Gestion de l'affichage) ---
    function updateStatusText(message, isError = false) {
        statusEl.textContent = message;
        statusEl.classList.toggle('error', isError);
        // Ajoute la classe 'active' seulement pour le compte à rebours
        statusEl.classList.toggle('active', !isError && message.includes("dans")); 

        // Reset UI en cas d'erreur pendant une action
        if (isError && (validateBtn.textContent.includes('...') || cancelBtn.textContent.includes('...'))) {
            if (currentScheduledAction) {
                 setUIState(true, currentScheduledAction);
            } else {
                 resetUIState(false);
            }
             validateBtn.textContent = currentScheduledAction ? `${getActionLabel(currentScheduledAction)} programmé !` : 'Valider';
             cancelBtn.textContent = 'Annuler';
        }
    }

    function setUIState(isScheduled, action = null) {
        const elementsToDisable = [validateBtn, timeValueInput, timeUnitSelect, ...actionRadios];
        elementsToDisable.forEach(el => el.disabled = isScheduled);
        cancelBtn.disabled = !isScheduled;

        if (isScheduled && action) {
             const actionLabel = getActionLabel(action);
             validateBtn.textContent = `${actionLabel} programmé !`;
        } else {
            validateBtn.textContent = 'Valider';
        }
    }

    function resetUIState(isCancelled = false) {
        setUIState(false);
        statusEl.textContent = isCancelled ? "Action annulée !" : "Aucune action programmée.";
        statusEl.classList.remove('active', 'error');
        currentScheduledAction = null;
        currentScheduledTime = null;

        if (isCancelled) {
             setTimeout(() => {
                 if (statusEl.textContent === "Action annulée !") {
                     statusEl.textContent = "Aucune action programmée.";
                 }
             }, 3000);
         }
    }

    // --- Action : PROGRAMMER ---
    if(validateBtn) validateBtn.addEventListener('click', async () => {
        // État temporaire "Chargement"
        validateBtn.textContent = 'Programmation...';
        validateBtn.disabled = true;
        cancelBtn.disabled = true;
        [...actionRadios, timeValueInput, timeUnitSelect].forEach(el => el.disabled = true);

        const value = parseInt(timeValueInput.value, 10);
        const unit = timeUnitSelect.value;
        const selectedActionInput = document.querySelector('input[name="powerAction"]:checked');
        const action = selectedActionInput ? selectedActionInput.value : 'shutdown';

        if (isNaN(value) || value <= 0) {
            updateStatusText("Veuillez entrer une durée valide (nombre positif).", true);
            return; // L'état d'erreur resettera les boutons via updateStatusText
        }
        
        let minutes = (unit === 'hours') ? (value * 60) : value;
        const maxMinutes = 60 * 24 * 7; // 1 semaine
        if (minutes > maxMinutes) {
             updateStatusText(`Durée trop longue (max ${maxMinutes / 60 / 24} jours).`, true);
             return;
        }

        try {
            const result = await window.electronAPI.schedule({ 
                minutes, 
                action, 
                originalValue: value, 
                originalUnit: unit 
            });

            if (!result.success) {
                updateStatusText(result.error || "Erreur inconnue.", true);
            }
            // En cas de succès, onUpdateStatus s'occupera de l'UI
        } catch (error) {
            console.error("Erreur communication:", error);
            updateStatusText("Erreur de communication.", true);
        }
    });

    // --- Action : ANNULER ---
    if(cancelBtn) cancelBtn.addEventListener('click', async () => {
        cancelBtn.textContent = 'Annulation...';
        cancelBtn.disabled = true;
        validateBtn.disabled = true;

        try {
            const result = await window.electronAPI.cancel();
            
            if (!result.success) {
                 updateStatusText(result.error || "Erreur lors de l'annulation.", true);
                 // Restaure l'état si échec
                 if(currentScheduledAction) {
                     setUIState(true, currentScheduledAction);
                 }
            }
             cancelBtn.textContent = 'Annuler';

        } catch(error) {
             console.error("Erreur communication (cancel):", error);
             updateStatusText("Erreur de communication.", true);
             if(currentScheduledAction) setUIState(true, currentScheduledAction); else resetUIState(false);
             cancelBtn.textContent = 'Annuler';
        }
    });

    // --- Écouteurs d'événements (Venant du Main) ---

    // Changement d'état (Programmé / Annulé)
    window.electronAPI.onUpdateStatus((data) => {
        if (data && data.time && data.action) {
            currentScheduledTime = new Date(data.time);
            currentScheduledAction = data.action;
            setUIState(true, currentScheduledAction);
        } else {
            // Si data est null, c'est que rien n'est programmé
            const justCancelled = (cancelBtn.textContent === 'Annulation...');
            resetUIState(justCancelled);
            validateBtn.textContent = 'Valider';
            cancelBtn.textContent = 'Annuler';
        }
    });

    // Mise à jour du compte à rebours (chaque seconde)
    window.electronAPI.onUpdateCountdown((remainingMilliseconds) => {
         if (remainingMilliseconds > 0 && currentScheduledAction) {
             const actionLabel = getActionLabel(currentScheduledAction);
             statusEl.textContent = `${actionLabel} dans ${formatTime(remainingMilliseconds)} !`;
             statusEl.classList.add('active');
             statusEl.classList.remove('error');
         } else if (currentScheduledAction && remainingMilliseconds <= 0) {
              const actionLabel = getActionLabel(currentScheduledAction);
              statusEl.textContent = `${actionLabel} imminent !`;
              statusEl.classList.add('active');
              statusEl.classList.remove('error');
         }
    });

    // Affichage des erreurs système
    window.electronAPI.onShowError((message) => {
        updateStatusText(message, true);
    });

    // --- État Initial ---
    resetUIState(false);
});