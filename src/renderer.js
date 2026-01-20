// src/renderer.js

function formatTime(milliseconds) {
    if (milliseconds <= 0) return "00:00:00";
    let totalSeconds = Math.floor(milliseconds / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    const pad = (num) => String(num).padStart(2, '0');
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`; 
}

document.addEventListener('DOMContentLoaded', () => {

    const minimizeBtn = document.getElementById('minimize-btn');
    const closeBtn = document.getElementById('close-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const validateBtn = document.getElementById('validate-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const statusEl = document.getElementById('status');
    const timeValueInput = document.getElementById('time-value');
    const timeUnitSelect = document.getElementById('time-unit');
    const actionRadios = document.querySelectorAll('input[name="powerAction"]');
    const presetBtns = document.querySelectorAll('.preset-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const autoStartToggle = document.getElementById('auto-start-toggle');

    // --- Logique Barre Rectangulaire SVG ---
    const rect = document.querySelector('.progress-rect');
    
    // On récupère les dimensions définies dans le HTML (width="216", height="56")
    const width = parseFloat(rect.getAttribute('width'));
    const height = parseFloat(rect.getAttribute('height'));
    // Périmètre = 2 * (largeur + hauteur)
    const perimeter = 2 * (width + height);

    // Initialisation
    rect.style.strokeDasharray = `${perimeter} ${perimeter}`;
    rect.style.strokeDashoffset = 0; // 0 = Plein

    function setProgress(ratio) {
        // Ratio va de 1.0 (plein) à 0.0 (vide)
        const offset = perimeter - (ratio * perimeter);
        rect.style.strokeDashoffset = offset;
    }

    let currentScheduledAction = null;

    // Listeners
    if(minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
    if(closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.close());
    
    if(settingsBtn) settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
    if(closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    
    if(autoStartToggle) autoStartToggle.addEventListener('change', (e) => window.electronAPI.saveAutoStart(e.target.checked));

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateBtn.disabled && validateBtn.textContent !== "Valider") return;
            timeValueInput.value = btn.dataset.time;
            timeUnitSelect.value = btn.dataset.unit;
        });
    });

    if(themeToggle) themeToggle.addEventListener('change', (event) => {
        const newTheme = event.target.checked ? 'dark' : 'light';
        document.body.className = newTheme;
        window.electronAPI.saveTheme(newTheme);
    });

    // Load Settings
    window.electronAPI.onLoadSettings((settings) => {
        const theme = settings.theme || 'light';
        document.body.className = theme;
        if(themeToggle) themeToggle.checked = (theme === 'dark');
        if (settings.lastDurationValue) timeValueInput.value = settings.lastDurationValue;
        if (settings.lastDurationUnit) timeUnitSelect.value = settings.lastDurationUnit;
        if (settings.openAtLogin !== undefined && autoStartToggle) autoStartToggle.checked = settings.openAtLogin;
        else if (autoStartToggle) autoStartToggle.checked = true;
    });

    // UI Helpers
    function setUIState(isScheduled, action = null) {
        const elementsToDisable = [validateBtn, timeValueInput, timeUnitSelect, ...actionRadios, ...presetBtns];
        elementsToDisable.forEach(el => el.disabled = isScheduled);
        cancelBtn.disabled = !isScheduled;

        if (isScheduled && action) {
             validateBtn.textContent = `Programmé`;
        } else {
            validateBtn.textContent = 'Valider';
            setProgress(1); // Reset plein
        }
    }

    function resetUIState() {
        setUIState(false);
        statusEl.textContent = "Prêt";
        statusEl.classList.remove('active', 'error');
        currentScheduledAction = null;
        setProgress(1);
    }

    // Actions
    if(validateBtn) validateBtn.addEventListener('click', async () => {
        const value = parseInt(timeValueInput.value, 10);
        const unit = timeUnitSelect.value;
        const selectedActionInput = document.querySelector('input[name="powerAction"]:checked');
        const action = selectedActionInput ? selectedActionInput.value : 'shutdown';

        if (isNaN(value) || value <= 0) return;
        let minutes = (unit === 'hours') ? (value * 60) : value;

        const result = await window.electronAPI.schedule({ 
            minutes, action, originalValue: value, originalUnit: unit 
        });

        if (!result.success) {
            statusEl.textContent = "Erreur";
            statusEl.classList.add('error');
        }
    });

    if(cancelBtn) cancelBtn.addEventListener('click', async () => await window.electronAPI.cancel());

    // Updates Main -> Renderer
    window.electronAPI.onUpdateStatus((data) => {
        if (data && data.time && data.action) {
            currentScheduledAction = data.action;
            setUIState(true, currentScheduledAction);
        } else {
            resetUIState();
        }
    });

    window.electronAPI.onUpdateCountdown((remainingMs, ratio) => {
         if (currentScheduledAction) {
             statusEl.textContent = formatTime(remainingMs);
             statusEl.classList.add('active');
             setProgress(ratio);
         }
    });

    resetUIState();
});