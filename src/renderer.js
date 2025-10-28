// renderer.js

// Fonction utilitaire pour formater le temps restant
function formatTime(milliseconds) {
    if (milliseconds <= 0) return "00:00:00";
    let totalSeconds = Math.floor(milliseconds / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;

    // Ajoute un zéro devant si nécessaire
    const pad = (num) => String(num).padStart(2, '0');

    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}


document.addEventListener('DOMContentLoaded', () => {

    // Éléments de la fenêtre
    const minimizeBtn = document.getElementById('minimize-btn'); //
    const closeBtn = document.getElementById('close-btn'); //

    // Éléments de Thème
    const themeToggle = document.getElementById('theme-toggle'); //

    // Éléments Shutdown
    const validateBtn = document.getElementById('validate-btn'); //
    const cancelBtn = document.getElementById('cancel-btn'); //
    const statusEl = document.getElementById('status'); //
    const timeValueInput = document.getElementById('time-value'); //
    const timeUnitSelect = document.getElementById('time-unit'); //

    let countdownInterval = null; // Pour afficher le compte à rebours

    // --- Logique Fenêtre ---
    if(minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimize()); //
    if(closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.close()); //

    // --- Logique Thème ---
    if(themeToggle) themeToggle.addEventListener('change', () => { //
        const newTheme = themeToggle.checked ? 'dark' : 'light'; //
        document.body.className = newTheme; // Applique la classe au <body>
        window.electronAPI.saveTheme(newTheme); //
    });

    // Au chargement, on reçoit les réglages de 'main.js'
    window.electronAPI.onLoadSettings((settings) => { //
        const theme = settings.theme || 'light'; //
        document.body.className = theme; //
        if(themeToggle) themeToggle.checked = (theme === 'dark'); //
    });

    // --- Fonction pour mettre à jour le statut/afficher les erreurs ---
    function updateStatusText(message, isError = false) {
        statusEl.textContent = message; //
        if (isError) {
            statusEl.classList.add('error'); // Ajoute une classe CSS pour le style erreur
            statusEl.classList.remove('active'); // Retire la classe succès
        } else {
            statusEl.classList.remove('error'); // Retire la classe erreur
            // La classe 'active' est gérée par onUpdateStatus
        }
        // Réactiver les boutons si une erreur survient après validation
        if (isError && validateBtn.textContent !== 'Valider') {
             resetUIState(false); // Réactive les contrôles de planification
        }
    }

    // --- Fonction pour gérer l'état de l'interface ---
    function setUIState(isShutdownScheduled) {
        const elementsToDisable = [validateBtn, timeValueInput, timeUnitSelect];
        elementsToDisable.forEach(el => el.disabled = isShutdownScheduled); //
        cancelBtn.disabled = !isShutdownScheduled; //

        if (isShutdownScheduled) {
            validateBtn.textContent = 'Programmé'; // Feedback visuel
        } else {
            validateBtn.textContent = 'Valider'; //
            // S'assurer que le compte à rebours est arrêté s'il tournait
            if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
        }
    }
     // Fonction pour réinitialiser l'UI (utilisée en cas d'erreur ou d'annulation)
    function resetUIState(isCancelled = false) {
        setUIState(false);
        statusEl.textContent = isCancelled ? "Arrêt annulé." : "Aucun arrêt programmé."; //
        statusEl.classList.remove('active', 'error'); //
         // Optionnel: Faire disparaître le message "Arrêt annulé" après un délai
         if (isCancelled) {
             setTimeout(() => {
                 if (!cancelBtn.disabled) { // Vérifier si un autre arrêt n'a pas été programmé entre temps
                    statusEl.textContent = "Aucun arrêt programmé.";
                 }
             }, 3000); // 3 secondes
         }
    }


    // --- Logique Shutdown ---
    if(validateBtn) validateBtn.addEventListener('click', () => { //
        validateBtn.textContent = 'Programmation...'; // Feedback immédiat
        validateBtn.disabled = true; // Désactiver pendant l'envoi
        cancelBtn.disabled = true; // Désactiver aussi Annuler temporairement

        const value = parseInt(timeValueInput.value, 10); //
        const unit = timeUnitSelect.value; //

        // Validation d'entrée
        if (isNaN(value) || value <= 0) {
            updateStatusText("Veuillez entrer une durée valide (nombre positif).", true);
            // Pas besoin d'appeler resetUIState ici car updateStatusText le fait déjà en cas d'erreur
            return;
        }

        let minutes = (unit === 'hours') ? (value * 60) : value; //

        // Limite maximale (côté renderer aussi pour feedback rapide)
        const maxMinutes = 60 * 24 * 7; // 1 semaine
         if (minutes > maxMinutes) {
             updateStatusText(`Durée trop longue (max ${maxMinutes / 60 / 24} jours).`, true);
             return;
        }

        window.electronAPI.schedule(minutes); //
    });

    if(cancelBtn) cancelBtn.addEventListener('click', () => { //
        cancelBtn.textContent = 'Annulation...'; // Feedback
        cancelBtn.disabled = true; //
        window.electronAPI.cancel(); //
    });

    // Reçoit l'heure programmée (ou null) du main process
    window.electronAPI.onUpdateStatus((isoTime) => { //
        if (isoTime) {
            setUIState(true);
            // Le compte à rebours sera géré par onUpdateCountdown
        } else {
            resetUIState(cancelBtn.textContent === 'Annulation...'); // Affiche "Arrêt annulé" si on vient de cliquer
            cancelBtn.textContent = 'Annuler'; // Réinitialiser le texte du bouton
        }
    });

     // NOUVEAU: Gère la mise à jour du compte à rebours
     window.electronAPI.onUpdateCountdown((remainingMilliseconds) => {
         if (remainingMilliseconds > 0) {
             statusEl.textContent = `Arrêt dans ${formatTime(remainingMilliseconds)}`; //
             statusEl.classList.add('active'); //
             statusEl.classList.remove('error'); //
         } else if (scheduledShutdownTime) { // Si on arrive à 0 mais qu'il y avait un arrêt
             // L'arrêt est imminent ou passé, on peut laisser le dernier message ou réinitialiser
             // resetUIState(); // Décommentez si vous voulez réinitialiser l'UI après 0
         }
         // Si remainingMilliseconds est 0 ET qu'il n'y a pas d'arrêt programmé (cas initial ou après annulation), ne rien faire ici.
     });


    // NOUVEAU: Gère les messages d'erreur du main process
    window.electronAPI.onShowError((message) => {
        updateStatusText(message, true); // Utilise la fonction dédiée
         // Assure que les boutons sont réactivés si l'erreur survient après avoir cliqué Valider
        if (validateBtn.disabled && validateBtn.textContent !== 'Programmé') {
            resetUIState(false);
        }
    });

    // État initial (Annuler désactivé par défaut)
    if(cancelBtn) cancelBtn.disabled = true; //

});