// renderer.js

// Fonctions formatTime et getActionLabel (inchangées)
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
        case 'hibernate': return 'Veille prolongée'; // Corrigé
        default: return 'Action';
    }
}


document.addEventListener('DOMContentLoaded', () => { // Plus besoin d'async

    // Éléments
    const minimizeBtn = document.getElementById('minimize-btn');
    const closeBtn = document.getElementById('close-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const validateBtn = document.getElementById('validate-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const statusEl = document.getElementById('status');
    const timeValueInput = document.getElementById('time-value');
    const timeUnitSelect = document.getElementById('time-unit');
    const actionRadios = document.querySelectorAll('input[name="powerAction"]');
    // Plus besoin de contentDiv pour le warning

    let currentScheduledAction = null;
    let currentScheduledTime = null;
    // adminWarningElement retiré

    // --- Logique Fenêtre & Thème ---
    if(minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
    if(closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.close());
    if(themeToggle) themeToggle.addEventListener('change', (event) => { // 'event' est bon ici
        const newTheme = event.target.checked ? 'dark' : 'light';
        console.log("Theme toggle changed to:", newTheme); // Log pour débugger
        document.body.className = newTheme;
        window.electronAPI.saveTheme(newTheme);
    });

    // --- Chargement des Settings ---
    window.electronAPI.onLoadSettings((settings) => {
        console.log("Settings reçus:", settings);
        const theme = settings.theme || 'light';
        document.body.className = theme;
        if(themeToggle) themeToggle.checked = (theme === 'dark');
        if (settings.lastDurationValue && timeValueInput) { timeValueInput.value = settings.lastDurationValue; }
        if (settings.lastDurationUnit && timeUnitSelect) { timeUnitSelect.value = settings.lastDurationUnit; }
    });

    // displayAdminWarning retiré

    // --- Fonctions UI ---
    function updateStatusText(message, isError = false) {
        statusEl.textContent = message;
        statusEl.classList.toggle('error', isError);
        statusEl.classList.toggle('active', !isError && message.includes("dans")); // 'active' seulement si c'est un countdown
        // Reset UI si erreur PENDANT la programmation/annulation
        if (isError && (validateBtn.textContent.includes('...') || cancelBtn.textContent.includes('...'))) {
            // Si on avait une action programmée avant l'erreur, revenir à cet état
            if (currentScheduledAction) {
                 setUIState(true, currentScheduledAction);
            } else {
                 resetUIState(false); // Sinon, réinitialiser complètement
            }
             // Réinitialiser les textes des boutons
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
        setUIState(false); // Réactive les contrôles
        statusEl.textContent = isCancelled ? "Action annulée !" : "Aucune action programmée.";
        statusEl.classList.remove('active', 'error');
        currentScheduledAction = null;
        currentScheduledTime = null;

        if (isCancelled) {
             setTimeout(() => {
                 // Ne reset le message que s'il est toujours "Action annulée !"
                 if (statusEl.textContent === "Action annulée !") {
                     statusEl.textContent = "Aucune action programmée.";
                 }
             }, 3000);
         }
    }

    // --- Logique Power Actions ---
    if(validateBtn) validateBtn.addEventListener('click', async () => {
        validateBtn.textContent = 'Programmation...';
        validateBtn.disabled = true;
        cancelBtn.disabled = true; // Désactiver Annuler aussi temporairement
        [...actionRadios, timeValueInput, timeUnitSelect].forEach(el => el.disabled = true);

        const value = parseInt(timeValueInput.value, 10);
        const unit = timeUnitSelect.value;
        const selectedActionInput = document.querySelector('input[name="powerAction"]:checked');
        const action = selectedActionInput ? selectedActionInput.value : 'shutdown';

        if (isNaN(value) || value <= 0) {
            updateStatusText("Veuillez entrer une durée valide (nombre positif).", true);
            return;
        }
        let minutes = (unit === 'hours') ? (value * 60) : value;
        const maxMinutes = 60 * 24 * 7;
        if (minutes > maxMinutes) {
             updateStatusText(`Durée trop longue (max ${maxMinutes / 60 / 24} jours).`, true);
             return;
        }

        try {
            console.log("Envoi IPC schedule:", { minutes, action, originalValue: value, originalUnit: unit });
            const result = await window.electronAPI.schedule({ minutes, action, originalValue: value, originalUnit: unit });
            console.log("Retour IPC schedule:", result);
            if (!result.success) {
                // L'erreur sera affichée par onShowError si elle vient du catch de main.js,
                // sinon on l'affiche ici (erreur de validation par ex.)
                updateStatusText(result.error || "Erreur inconnue.", true);
            }
            // Si succès, onUpdateStatus et onUpdateCountdown mettront à jour l'UI
        } catch (error) {
            console.error("Erreur IPC schedule (catch renderer):", error);
            updateStatusText("Erreur de communication (programmation).", true);
        }
    });

    if(cancelBtn) cancelBtn.addEventListener('click', async () => {
        cancelBtn.textContent = 'Annulation...';
        cancelBtn.disabled = true;
        validateBtn.disabled = true; // Désactive aussi Valider pendant l'annulation

        try {
            console.log("Envoi IPC cancel");
            const result = await window.electronAPI.cancel();
            console.log("Retour IPC cancel:", result);
            if (!result.success) {
                 updateStatusText(result.error || "Erreur lors de l'annulation.", true);
                 // Si l'annulation échoue, on restaure l'état précédent si on le connait
                 if(currentScheduledAction) {
                     setUIState(true, currentScheduledAction);
                 }
            }
             // Si succès, onUpdateStatus fera le resetUIState via le message null reçu
             // On s'assure juste que le bouton Annuler retrouve son texte
             cancelBtn.textContent = 'Annuler';

        } catch(error) {
             console.error("Erreur IPC cancel (catch renderer):", error);
             updateStatusText("Erreur de communication (annulation).", true);
             // Réactiver l'UI dans l'état où elle était si possible
             if(currentScheduledAction) setUIState(true, currentScheduledAction); else resetUIState(false);
             cancelBtn.textContent = 'Annuler';
        }
    });

    // Reçoit l'état du main process
    window.electronAPI.onUpdateStatus((data) => {
        console.log("IPC: update-status received:", data);
        if (data && data.time && data.action) {
            currentScheduledTime = new Date(data.time);
            currentScheduledAction = data.action;
            setUIState(true, currentScheduledAction);
            // Le texte de status sera mis à jour par onUpdateCountdown
        } else {
            // Détermine si on vient d'annuler en regardant si le bouton affiche "Annulation..."
            const justCancelled = (cancelBtn.textContent === 'Annulation...');
            resetUIState(justCancelled);
            // S'assurer que les textes des boutons sont corrects après reset
            validateBtn.textContent = 'Valider';
            cancelBtn.textContent = 'Annuler';
        }
    });

     // Gère la mise à jour du compte à rebours
     window.electronAPI.onUpdateCountdown((remainingMilliseconds) => {
         // console.log("IPC: update-countdown received:", remainingMilliseconds); // Peut être verbeux
         if (remainingMilliseconds > 0 && currentScheduledAction) {
             const actionLabel = getActionLabel(currentScheduledAction);
             statusEl.textContent = `${actionLabel} dans ${formatTime(remainingMilliseconds)} !`;
             statusEl.classList.add('active');
             statusEl.classList.remove('error');
         } else if (currentScheduledAction && remainingMilliseconds <= 0) {
              const actionLabel = getActionLabel(currentScheduledAction);
              statusEl.textContent = `${actionLabel} imminent !`;
              statusEl.classList.add('active'); // Garder le style succès
              statusEl.classList.remove('error');
              // L'état (boutons désactivés etc.) reste jusqu'à ce que main process envoie un update-status null
         }
         // Si currentScheduledAction est null, ne rien faire (resetUIState s'en charge)
     });

    // Gère les messages d'erreur du main process
    window.electronAPI.onShowError((message) => {
        console.log("IPC: show-error received:", message);
        updateStatusText(message, true);
        // La logique de réactivation est maintenant dans updateStatusText
    });

    // État initial
    resetUIState(false);

}); // Fin de DOMContentLoaded