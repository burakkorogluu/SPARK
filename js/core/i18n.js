/**
 * SPARK Çoklu Dil (i18n) Modülü
 */
const I18n = (() => {
    'use strict';

    // Desteklenen Diller ve Sözlük
    const translations = {
        'tr': {
            'menu_dashboard': 'Kontrol Paneli',
            'menu_data_entry': 'Veri Girişi',
            'menu_maneuver': 'Manevra Önerileri',
            'menu_scada': 'Teknik SCADA (SLD)',
            'menu_settings': 'Ayarlar',
            
            'header_title': 'Kontrol Paneli & Şebeke Topolojisi',
            
            'settings_title': 'Ayarlar',
            'settings_language': 'Dil Seçimi',
            'settings_lang_tr': 'Türkçe',
            'settings_lang_en': 'English',
            
            'theme_dark': 'Koyu',
            'theme_light': 'Açık'
        },
        'en': {
            'menu_dashboard': 'Dashboard',
            'menu_data_entry': 'Data Entry',
            'menu_maneuver': 'Maneuver Suggestions',
            'menu_scada': 'Technical SCADA (SLD)',
            'menu_settings': 'Settings',
            
            'header_title': 'Dashboard & Network Topology',
            
            'settings_title': 'Settings',
            'settings_language': 'Language Selection',
            'settings_lang_tr': 'Turkish',
            'settings_lang_en': 'English',
            
            'theme_dark': 'Dark',
            'theme_light': 'Light'
        }
    };

    let currentLang = 'tr';

    function init() {
        const savedLang = localStorage.getItem('spark_lang');
        if (savedLang && translations[savedLang]) {
            currentLang = savedLang;
        }
        
        applyTranslations();
    }

    function setLanguage(lang) {
        if (!translations[lang]) return;
        currentLang = lang;
        localStorage.setItem('spark_lang', lang);
        
        document.documentElement.lang = lang;
        
        applyTranslations();
        
        if (window.App && typeof window.App.onLanguageChange === 'function') {
            window.App.onLanguageChange();
        }
    }

    function applyTranslations() {
        const dict = translations[currentLang];
        
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dict[key]) {
                el.textContent = dict[key];
            }
        });
        
        updateThemeText();
    }
    
    function updateThemeText() {
        const themeTextEl = document.getElementById('theme-text');
        if (themeTextEl) {
            const themeName = document.body.getAttribute('data-theme') || 'dark';
            themeTextEl.textContent = themeName === 'light' ? t('theme_light') : t('theme_dark');
        }
    }

    function t(key) {
        const dict = translations[currentLang];
        return dict[key] || key;
    }

    return {
        init,
        setLanguage,
        t,
        getCurrent: () => currentLang
    };
})();
