// renderer.js

// Attendre que tout le contenu de la page soit chargé
document.addEventListener('DOMContentLoaded', () => {

    // Éléments de la fenêtre
    const minimizeBtn = document.getElementById('minimize-btn');
    const closeBtn = document.getElementById('close-btn');

    // Éléments de Thème
    const themeToggle = document.getElementById('theme-toggle');

    // Éléments Shutdown
    const validateBtn = document.getElementById('validate-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const statusEl = document.getElementById('status');
    const timeValueInput = document.getElementById('time-value');
    const timeUnitSelect = document.getElementById('time-unit');

    // --- Logique Fenêtre ---
    if(minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
    if(closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.close());
    
    // --- Logique Thème ---
    if(themeToggle) themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        document.body.className = newTheme; // Applique la classe au <body>
        window.electronAPI.saveTheme(newTheme);
    });

    // Au chargement, on reçoit les réglages de 'main.js'
    window.electronAPI.onLoadSettings((settings) => {
        const theme = settings.theme || 'light';
        document.body.className = theme;
        if(themeToggle) themeToggle.checked = (theme === 'dark');
    });

    // --- Logique Shutdown ---
    if(validateBtn) validateBtn.addEventListener('click', () => {
        const value = parseInt(timeValueInput.value, 10);
        const unit = timeUnitSelect.value;
        if (value > 0) {
            let minutes = (unit === 'hours') ? (value * 60) : value;
            window.electronAPI.schedule(minutes);
        }
    });

    if(cancelBtn) cancelBtn.addEventListener('click', () => window.electronAPI.cancel());

    // On écoute les mises à jour de statut venant du 'main.js'
    window.electronAPI.onUpdateStatus((time) => {
        if (time) {
            const shutdownTime = new Date(time);
            const displayTime = shutdownTime.toLocaleTimeString('fr-FR', {
                hour: '2-digit', minute: '2-digit'
            });
            statusEl.textContent = `Arrêt programmé pour ${displayTime}`;
            statusEl.classList.add('active');
            [validateBtn, timeValueInput, timeUnitSelect].forEach(el => el.disabled = true);
            cancelBtn.disabled = false;
        } else {
            statusEl.textContent = "Aucun arrêt programmé.";
            statusEl.classList.remove('active');
            [validateBtn, timeValueInput, timeUnitSelect].forEach(el => el.disabled = false);
            cancelBtn.disabled = true;
        }
    });

    // --- Ta demande spécifique ---
    // On garde le bouton "Annuler" désactivé au démarrage
    if(cancelBtn) cancelBtn.disabled = true;

});