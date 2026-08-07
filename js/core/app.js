// ============================================
// app.js - Ana Uygulama Orkestratörü
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const App = (() => {
    'use strict';

    const AY_ADLARI = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];

    const YONTEM_ETIKETLERI = {
        ensemble: 'Ensemble',
        randomForest: 'Random Forest',
        regression: 'Regresyon'
    };

    function yontemEtiketiGetir(adi) {
        if (!adi) return 'Model';
        return YONTEM_ETIKETLERI[adi] || (adi.charAt(0).toUpperCase() + adi.slice(1));
    }

    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    let state = {
        currentScreen: 'dashboard',
        selectedTrafoId: null,
        selectedAy: new Date().getMonth() + 1,
        selectedYil: new Date().getFullYear(),
        selectedYontem: 'ensemble',
        lastOzetler: null,
        lastOzetlerKey: null,
        tablePage: 1,
        tablePerPage: 50,
        chartResolution: 'monthly'
    };

    async function init() {
        if (!document.getElementById('global-ay-select')) return;

        try {
            const loader = document.createElement('div');
            loader.id = 'global-loader';
            loader.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(18,18,18,0.9); z-index:9999; display:flex; justify-content:center; align-items:center; color:white; font-size:20px; font-weight: 500; backdrop-filter: blur(4px);';
            loader.innerHTML = 'Sistem Başlatılıyor, Veriler Yükleniyor... <div class="loading-spinner" style="margin-left: 12px; width: 24px; height: 24px; border-width: 3px;"></div>';
            document.body.appendChild(loader);

            localStorage.removeItem('spark_trafolar');
            localStorage.removeItem('spark_veriler');

            const trafolar = await ApiClient.fetchTransformers();
            trafolar.forEach(t => VeriModulu.trafoEkle({
                id: t.id,
                adi: t.name,
                bolge: t.region,
                kapasite: t.power_mva,
                tip: 'Bilinmiyor',
                aciklama: `${t.name}, ${t.power_mva} MVA`
            }));

            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);

        } catch (e) {
            console.error("Başlangıç veri çekme hatası:", e);
            document.getElementById('global-loader').innerHTML = 'Sunucuya bağlanılamadı. Python backend çalışıyor mu?';
            return;
        }

        // current-date removed

        if (typeof ThemeManager !== 'undefined') {
            ThemeManager.initTheme();
        }
        if (typeof I18n !== 'undefined') {
            I18n.init();
        }

        const kayitliTrafolar = VeriModulu.getTrafolar();
        if (kayitliTrafolar.length > 0) {
            state.selectedTrafoId = kayitliTrafolar[0].id;
        }

        populateTrafoSelects();
        setupNavigation();
        if (typeof DataEntryUI !== 'undefined') DataEntryUI.setupFormHandlers();
        if (typeof ForecastUI !== 'undefined') ForecastUI.setupSenaryoForm();

        if (typeof TopolojiModulu !== 'undefined') {
            TopolojiModulu.init();
        }

        if (typeof ScadaSldUI !== 'undefined') {
            ScadaSldUI.init();
        }

        renderDashboard();

        document.getElementById('global-loader')?.remove();
    }

    function formatDisplayDate(dateStr) {
        const d = VeriModulu.parseDate(dateStr);
        return `${d.getDate()} ${AY_ADLARI[d.getMonth()]} ${d.getFullYear()}`;
    }

    function setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                navigate(btn.dataset.screen);
            });
        });

        const toggleBtn = document.getElementById('sidebar-toggle-btn');
        const sidebar = document.getElementById('app-sidebar');

        if (toggleBtn && sidebar) {
            const isCollapsed = localStorage.getItem('spark_sidebar_collapsed') === 'true';
            if (isCollapsed) {
                sidebar.classList.add('collapsed');
            }

            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
                localStorage.setItem('spark_sidebar_collapsed', sidebar.classList.contains('collapsed'));
            });
        }

        const langSelect = document.getElementById('global-lang-select');
        if (langSelect) {
            langSelect.value = I18n.getCurrent();
            langSelect.addEventListener('change', (e) => {
                I18n.setLanguage(e.target.value);
            });
        }
    }

    function navigate(screen) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-screen="${screen}"]`)?.classList.add('active');

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const el = document.getElementById(`screen-${screen}`);
        if (el) el.classList.add('active');

        state.currentScreen = screen;

        const screenTitles = {
            'dashboard': 'Kontrol Paneli & Şebeke Topolojisi',
            'veri-giris': 'Veri Girişi',
            'trafo-detay': 'Trafo Detay & Risk Analizi',
            'tahmin': 'Tahmin & Senaryo Simülasyonu',
            'manevra': 'Manevra Öneri & Karar Destek Modülü',
            'scada-sld': 'Teknik SCADA (SLD)',
            'ayarlar': 'Ayarlar'
        };
        const titleEl = document.getElementById('header-tab-title-text');
        if (titleEl && screenTitles[screen]) {
            titleEl.textContent = screenTitles[screen];
        }

        switch (screen) {
            case 'dashboard':
                renderDashboard();
                break;
            case 'veri-giris':
                if (typeof DataEntryUI !== 'undefined') DataEntryUI.renderVeriGiris();
                break;
            case 'trafo-detay':
                if (typeof DetailUI !== 'undefined') DetailUI.renderTrafoDetay();
                break;
            case 'tahmin':
                if (typeof ForecastUI !== 'undefined') ForecastUI.renderTahmin();
                break;
            case 'manevra':
                if (typeof ManeuverUI !== 'undefined') ManeuverUI.renderManevra();
                break;
            case 'scada-sld':
                if (typeof ScadaSldUI !== 'undefined') ScadaSldUI.render();
                break;
        }
    }

    function populateAySelects() {
        const selects = ['global-ay-select', 'detay-ay-select', 'topoloji-ay-select', 'tahmin-ay-select'];
        const now = new Date();
        const options = [];
        let cur = new Date(now.getFullYear(), now.getMonth(), 1);

        while (cur.getFullYear() > 2025 || (cur.getFullYear() === 2025 && cur.getMonth() >= 0)) {
            const val = `${cur.getFullYear()}-${(cur.getMonth() + 1).toString().padStart(2, '0')}`;
            const text = `${AY_ADLARI[cur.getMonth()]} ${cur.getFullYear()}`;
            const isSelected = (cur.getFullYear() === state.selectedYil && (cur.getMonth() + 1) === state.selectedAy);
            options.push({ val, text, isSelected });
            cur.setMonth(cur.getMonth() - 1);
        }
        selects.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = options.map(o => `<option value="${o.val}" ${o.isSelected ? 'selected' : ''}>${o.text}</option>`).join('');
        });
    }

    function populateTrafoSelects() {
        populateAySelects();

        const trafolar = Array.from(VeriModulu.getTrafolar().values());
        const selectIds = ['input-trafo', 'table-trafo-filter', 'detay-trafo-select', 'tahmin-trafo-select'];

        selectIds.forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = '';
            if (id === 'table-trafo-filter') {
                const optAll = document.createElement('option');
                optAll.value = '';
                optAll.textContent = 'Tüm Trafolar';
                sel.appendChild(optAll);
            }
            trafolar.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.adi;
                sel.appendChild(opt);
            });
        });

        document.getElementById('detay-trafo-select')?.addEventListener('change', (e) => {
            state.selectedTrafoId = e.target.value;
            if (typeof DetailUI !== 'undefined') DetailUI.renderTrafoDetay();
        });

        const syncAySelects = (newVal) => {
            const [y, m] = newVal.split('-');
            state.selectedYil = parseInt(y, 10);
            state.selectedAy = parseInt(m, 10);

            const detayAy = document.getElementById('detay-ay-select');
            const topolojiAy = document.getElementById('topoloji-ay-select');
            const dashAy = document.getElementById('global-ay-select');
            const tahminAy = document.getElementById('tahmin-ay-select');

            if (detayAy && detayAy.value !== newVal) detayAy.value = newVal;
            if (topolojiAy && topolojiAy.value !== newVal) topolojiAy.value = newVal;
            if (dashAy && dashAy.value !== newVal) dashAy.value = newVal;
            if (tahminAy && tahminAy.value !== newVal) tahminAy.value = newVal;
        };

        document.getElementById('detay-ay-select')?.addEventListener('change', async (e) => {
            syncAySelects(e.target.value);
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);
            if (typeof DetailUI !== 'undefined') DetailUI.renderTrafoDetay();
        });

        document.getElementById('global-ay-select')?.addEventListener('change', async (e) => {
            syncAySelects(e.target.value);
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);
            if (state.currentScreen === 'dashboard') {
                renderDashboard();
            } else if (state.currentScreen === 'trafo-detay' && typeof DetailUI !== 'undefined') {
                DetailUI.renderTrafoDetay();
            } else if (state.currentScreen === 'tahmin' && typeof ForecastUI !== 'undefined') {
                ForecastUI.renderTahmin();
            }
        });
        document.getElementById('tahmin-ay-select')?.addEventListener('change', async (e) => {
            syncAySelects(e.target.value);
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);
            if (typeof ForecastUI !== 'undefined') ForecastUI.renderTahmin();
        });
        document.getElementById('tahmin-trafo-select')?.addEventListener('change', (e) => {
            state.selectedTrafoId = e.target.value;
            if (typeof ForecastUI !== 'undefined') {
                ForecastUI.renderTahmin();
                if (document.getElementById('senaryo-sonuc')?.style.display !== 'none') {
                    ForecastUI.runSenaryo(false);
                }
            }
        });
        const syncYontemSelects = (newYontem) => {
            state.selectedYontem = newYontem;
            const globalY = document.getElementById('global-yontem-select');
            const tahminY = document.getElementById('tahmin-yontem-select');
            if (globalY && globalY.value !== newYontem) globalY.value = newYontem;
            if (tahminY && tahminY.value !== newYontem) tahminY.value = newYontem;
        };

        document.getElementById('global-yontem-select')?.addEventListener('change', (e) => {
            syncYontemSelects(e.target.value);
            if (state.currentScreen === 'dashboard') {
                if (typeof DashboardUI !== 'undefined') {
                    DashboardUI.clearCache(); // Tahminler değiştiği için cache'i temizle
                    DashboardUI.renderDashboard();
                }
            } else if (state.currentScreen === 'tahmin' && typeof ForecastUI !== 'undefined') {
                ForecastUI.renderTahmin();
                if (document.getElementById('senaryo-sonuc')?.style.display !== 'none') {
                    ForecastUI.runSenaryo(false);
                }
            }
        });
        document.getElementById('tahmin-yontem-select')?.addEventListener('change', (e) => {
            syncYontemSelects(e.target.value);
            if (typeof ForecastUI !== 'undefined') {
                ForecastUI.renderTahmin();
                if (document.getElementById('senaryo-sonuc')?.style.display !== 'none') {
                    ForecastUI.runSenaryo(false);
                }
            }
        });
        document.getElementById('table-trafo-filter')?.addEventListener('change', () => {
            state.tablePage = 1;
            if (typeof DataEntryUI !== 'undefined') DataEntryUI.renderVeriTablosu();
        });
        document.getElementById('table-date-start')?.addEventListener('change', () => {
            state.tablePage = 1;
            if (typeof DataEntryUI !== 'undefined') DataEntryUI.renderVeriTablosu();
        });
        document.getElementById('table-date-end')?.addEventListener('change', () => {
            state.tablePage = 1;
            if (typeof DataEntryUI !== 'undefined') DataEntryUI.renderVeriTablosu();
        });
        document.getElementById('table-per-page')?.addEventListener('change', (e) => {
            state.tablePerPage = e.target.value === 'all' ? 'all' : parseInt(e.target.value);
            state.tablePage = 1;
            if (typeof DataEntryUI !== 'undefined') DataEntryUI.renderVeriTablosu();
        });
        document.getElementById('table-prev-page')?.addEventListener('click', () => {
            if (state.tablePage > 1) {
                state.tablePage--;
                if (typeof DataEntryUI !== 'undefined') DataEntryUI.renderVeriTablosu();
            }
        });
        document.getElementById('table-next-page')?.addEventListener('click', () => {
            state.tablePage++;
            if (typeof DataEntryUI !== 'undefined') DataEntryUI.renderVeriTablosu();
        });
    }

    async function renderDashboard() {
        if (typeof DashboardUI !== 'undefined') {
            await DashboardUI.renderDashboard();
        }
    }

    function switchDashboardView(viewName) {
        if (typeof DashboardUI !== 'undefined') {
            DashboardUI.switchDashboardView(viewName);
        }
    }

    function navigateToTrafo(trafoId) {
        state.selectedTrafoId = trafoId;
        navigate('dashboard');
        
        setTimeout(() => {
            const cardEl = document.getElementById(`trafo-card-${trafoId}`);
            if (cardEl) {
                if (!cardEl.classList.contains('expanded')) {
                    if (typeof DashboardUI !== 'undefined') {
                        DashboardUI.toggleTrafoDetail(trafoId);
                    }
                }
                cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    function silVeri(trafoId, tarih) {
        if (typeof DataEntryUI !== 'undefined') {
            DataEntryUI.silVeri(trafoId, tarih);
        }
    }

    function toggleModelDetail() {
        if (typeof ForecastUI !== 'undefined') {
            ForecastUI.toggleModelDetail();
        }
    }

    function renderForecastBanner(ozetler) {
        if (typeof DashboardUI !== 'undefined') {
            DashboardUI.renderForecastBanner(ozetler);
        }
    }

    function renderManevra() {
        if (typeof ManeuverUI !== 'undefined') {
            ManeuverUI.renderManevra();
        }
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `${escapeHTML(message)}`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    return {
        init,
        navigate,
        navigateToTrafo,
        silVeri,
        switchDashboardView,
        escapeHTML,
        yontemEtiketiGetir,
        toggleModelDetail,
        renderForecastBanner,
        renderDashboard,
        renderManevra,
        showToast,
        populateTrafoSelects,
        getState: () => state,
    };
})();

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof VeriModulu !== 'undefined' && VeriModulu.init) {
        await VeriModulu.init();
    }
    App.init();

    document.querySelectorAll('.chart-res-toggle button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const res = e.target.dataset.res;
            const state = App.getState();
            state.chartResolution = res;

            if (state.currentScreen === 'trafo-detay') {
                App.navigate('trafo-detay');
            }
        });
    });
});
