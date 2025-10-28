// renderer.js

// Fonction utilitaire pour formater le temps restant (inchangée)
function formatTime(milliseconds) {
    if (milliseconds <= 0) return "00:00:00";
    let totalSeconds = Math.floor(milliseconds / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;

    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Fonction pour obtenir le libellé de l'action (inchangée)
function getActionLabel(action) {
    switch(action) {
        case 'shutdown': return 'Arrêt';
        case 'restart': return 'Redémarrage';
        case 'hibernate': return 'Mise en veille prolongée';
        default: return 'Action inconnue';
    }
}


document.addEventListener('DOMContentLoaded', () => {

    // Éléments (inchangés)
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

    // --- Logique Fenêtre & Thème (inchangés) ---
    if(minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
    if(closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.close());
    if(themeToggle) themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        document.body.className = newTheme;
        window.electronAPI.saveTheme(newTheme);
    });
    window.electronAPI.onLoadSettings((settings) => {
        const theme = settings.theme || 'light';
        document.body.className = theme;
        if(themeToggle) themeToggle.checked = (theme === 'dark');
    });

    // --- Fonction pour mettre à jour le statut/afficher les erreurs ---
    function updateStatusText(message, isError = false) {
        statusEl.textContent = message; // Mise à jour simple ici
        statusEl.classList.toggle('error', isError);
        if (isError) {
             statusEl.classList.remove('active');
        }
        if (isError && validateBtn.textContent.includes('...')) {
            resetUIState(false);
        }
    }

    // --- Fonction pour gérer l'état de l'interface ---
    function setUIState(isScheduled, action = null) {
        const elementsToDisable = [validateBtn, timeValueInput, timeUnitSelect, ...actionRadios];
        elementsToDisable.forEach(el => el.disabled = isScheduled);
        cancelBtn.disabled = !isScheduled;

        if (isScheduled && action) {
             const actionLabel = getActionLabel(action);
             // Modification ici pour le texte du bouton
             validateBtn.textContent = `${actionLabel} programmé !`;
        } else {
            validateBtn.textContent = 'Valider';
        }
    }

    // Fonction pour réinitialiser l'UI
    function resetUIState(isCancelled = false) {
        setUIState(false);
        // Modification ici pour les messages
        statusEl.textContent = isCancelled ? "Action annulée !" : "Aucune action programmée.";
        statusEl.classList.remove('active', 'error');
        currentScheduledAction = null;
        currentScheduledTime = null;

        if (isCancelled) {
             setTimeout(() => {
                 if (statusEl.textContent === "Action annulée !") { // Vérifie si le message n'a pas changé entre temps
                     statusEl.textContent = "Aucune action programmée.";
                 }
             }, 3000); // Disparaît après 3 secondes
         }
    }


    // --- Logique Power Actions (Validate et Cancel inchangés au niveau de l'appel API) ---
    if(validateBtn) validateBtn.addEventListener('click', async () => {
        validateBtn.textContent = 'Programmation...'; // Texte temporaire
        validateBtn.disabled = true;
        cancelBtn.disabled = true;
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
            const result = await window.electronAPI.schedule({ minutes, action });
            if (!result.success) {
                // L'erreur est gérée par onShowError si elle vient du main process
                // Si l'invoke lui-même échoue (rare), on l'affiche ici
                updateStatusText(result.error || "Erreur inconnue.", true);
            }
            // Pas besoin de else, onUpdateStatus fera le reste si succès
        } catch (error) {
            console.error("Erreur IPC schedule:", error);
            updateStatusText("Erreur de communication (programmation).", true);
        }
    });

    if(cancelBtn) cancelBtn.addEventListener('click', async () => {
        cancelBtn.textContent = 'Annulation...'; // Texte temporaire
        cancelBtn.disabled = true;
        validateBtn.disabled = true; // Inchangé

        try {
            const result = await window.electronAPI.cancel();
            if (!result.success) {
                // Gérer les erreurs spécifiques d'annulation retournées par le main process
                 updateStatusText(result.error || "Erreur inconnue lors de l'annulation.", true);
                 // Si l'annulation échoue mais qu'une action était prévue, on remet l'état "programmé"
                 if(currentScheduledAction){
                    setUIState(true, currentScheduledAction); // Remettre l'état visuel programmé
                 } else {
                    resetUIState(false); // Sinon, réinitialiser
                 }
                 cancelBtn.textContent = 'Annuler'; // Réinitialiser texte bouton Annuler
            }
             // Si succès, onUpdateStatus fera le resetUIState
        } catch(error) {
             console.error("Erreur IPC cancel:", error);
             updateStatusText("Erreur de communication (annulation).", true);
             // En cas d'erreur IPC, réactiver au cas où
             if(currentScheduledAction) setUIState(true, currentScheduledAction); else resetUIState(false);
             cancelBtn.textContent = 'Annuler';
        }
    });

    // Reçoit l'état initial ou après une action (programmation/annulation)
    window.electronAPI.onUpdateStatus((data) => {
        if (data && data.time && data.action) {
            currentScheduledTime = new Date(data.time);
            currentScheduledAction = data.action;
            setUIState(true, currentScheduledAction); // Met l'UI en état "programmé", met à jour le texte du bouton Valider
            // Le compte à rebours sera mis à jour par onUpdateCountdown
        } else {
             // Si on reçoit null, c'est soit une annulation réussie, soit l'état initial
             // On vérifie si le bouton annuler affichait "Annulation..." pour savoir si on vient d'annuler
            resetUIState(cancelBtn.textContent === 'Annulation...');
            cancelBtn.textContent = 'Annuler'; // S'assurer que le texte est réinitialisé
        }
    });

     // Gère la mise à jour du compte à rebours
     window.electronAPI.onUpdateCountdown((remainingMilliseconds) => {
         if (remainingMilliseconds > 0 && currentScheduledAction) {
             const actionLabel = getActionLabel(currentScheduledAction);
             // --- MODIFICATION ICI ---
             statusEl.textContent = `${actionLabel} dans ${formatTime(remainingMilliseconds)} !`;
             statusEl.classList.add('active');
             statusEl.classList.remove('error');
         } else if (currentScheduledAction && remainingMilliseconds <= 0) {
              const actionLabel = getActionLabel(currentScheduledAction);
              // --- MODIFICATION ICI ---
              statusEl.textContent = `${actionLabel} imminent !`; // Ou "en cours..."
              // Peut-être arrêter le clignotement ou changer de style
              // resetUIState(); // Décommenter pour réinitialiser l'UI une fois le temps écoulé
         }
         // Si pas d'action (currentScheduledAction est null), on ne fait rien ici, géré par resetUIState
     });


    // Gère les messages d'erreur du main process (inchangé)
    window.electronAPI.onShowError((message) => {
        updateStatusText(message, true);
        if (validateBtn.textContent.includes('...')) {
           resetUIState(false);
        } else if (cancelBtn.textContent.includes('...')) {
           if(currentScheduledAction) setUIState(true, currentScheduledAction); else resetUIState(false);
           cancelBtn.textContent = 'Annuler';
        }
    });

    // État initial
    resetUIState(false);

});