/**
 * SPARK Tema Yönetimi Modülü (theme.js)
 */
const ThemeManager = (() => {
    'use strict';

    function initTheme() {
        const savedTheme = localStorage.getItem('spark_theme') || 'dark';
        applyTheme(savedTheme);

        const toggleBtn = document.getElementById('btn-theme-toggle');
        if (toggleBtn && !toggleBtn.dataset.bound) {
            toggleBtn.dataset.bound = "true";
            toggleBtn.addEventListener('click', () => {
                const currentTheme = document.body.getAttribute('data-theme') || 'dark';
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                applyTheme(newTheme);
            });
        }
    }

    function applyTheme(themeName) {
        document.body.setAttribute('data-theme', themeName);
        localStorage.setItem('spark_theme', themeName);

        const iconEl = document.getElementById('theme-icon');
        const textEl = document.getElementById('theme-text');
        if (iconEl) iconEl.textContent = themeName === 'light' ? '🌙' : '☀️';
        if (textEl) textEl.textContent = themeName === 'light' ? 'Koyu' : 'Açık';

        // Logo Değişimi
        const customLogo = document.getElementById('custom-logo');
        const favicon = document.getElementById('favicon');

        const ts = new Date().getTime(); // Önbelleği (cache) kırmak için
        if (customLogo) {
            // style.display='none' kalmışsa diye blokluyoruz
            customLogo.style.display = 'block';
            customLogo.src = themeName === 'light' ? 'assets/images/icon11.jpeg?v=' + ts : 'assets/images/icon31.jpg?v=' + ts;
        }
        if (favicon) {
            favicon.href = themeName === 'light' ? 'assets/images/icon11.jpeg?v=' + ts : 'assets/images/icon31.jpg?v=' + ts;
        }

        if (typeof GrafikModulu !== 'undefined' && GrafikModulu.updateTheme) {
            GrafikModulu.updateTheme(themeName === 'light');
        }

        if (typeof App !== 'undefined' && App.getState && App.getState().currentScreen) {
            App.navigate(App.getState().currentScreen);
        }

        const modal = document.getElementById('power-triangle-modal');
        if (modal && modal.style.display !== 'none' && typeof TopolojiModulu !== 'undefined') {
            const trafoId = modal.dataset.currentTrafoId;
            if (trafoId) TopolojiModulu.openPowerTriangleModal(trafoId);
        }
    }

    return {
        initTheme,
        applyTheme
    };
})();
