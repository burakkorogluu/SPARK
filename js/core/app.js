// ============================================
// app.js - Ana Uygulama Mantığı
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const App = (() => {
    'use strict';

    // ─── Sabitler ───
    const AY_ADLARI = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];
    const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

    // ─── Yöntem Adı Görüntüleme ───
    // Backend'den dönen modelBilgi.adi artık tek kelimelik bir yöntem key'i
    // (örn. "ensemble", "randomForest", "holtWinters") olduğundan okunabilir
    // bir etikete çeviriyoruz.
    const YONTEM_ETIKETLERI = {
        ensemble: 'Ensemble',
        randomForest: 'Random Forest',
        holtWinters: 'Holt-Winters',
        regression: 'Regresyon',
        persistence: 'Persistence',
    };
    function yontemEtiketiGetir(adi) {
        if (!adi) return 'Model';
        return YONTEM_ETIKETLERI[adi] || (adi.charAt(0).toUpperCase() + adi.slice(1));
    }

    // ─── Güvenlik (XSS Koruması) ───
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ─── Uygulama Durumu ───
    let state = {
        currentScreen: 'dashboard',
        selectedTrafoId: null,
        selectedAy: new Date().getMonth() + 1,
        selectedYil: new Date().getFullYear(),
        selectedYontem: 'ensemble',
        lastOzetler: null,
        lastOzetlerKey: null,
        tablePage: 1,
        tablePerPage: 50
    };

    // ═══════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════

    async function init() {
        // Eğer sayfa ana index.html değilse (örneğin audit.html) DOM elementleri yoksa çık
        if (!document.getElementById('current-date')) return;

        // Backend'den başlangıç verilerini çek
        try {
            const loader = document.createElement('div');
            loader.id = 'global-loader';
            loader.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(18,18,18,0.9); z-index:9999; display:flex; justify-content:center; align-items:center; color:white; font-size:20px; font-weight: 500; backdrop-filter: blur(4px);';
            loader.innerHTML = 'Sistem Başlatılıyor, Veriler Yükleniyor... <div class="loading-spinner" style="margin-left: 12px; width: 24px; height: 24px; border-width: 3px;"></div>';
            document.body.appendChild(loader);

            // VeriModulu'nü temizle (eski local data varsa diye)
            localStorage.removeItem('spark_trafolar');
            localStorage.removeItem('spark_veriler');

            // 1. Trafoları Çek
            const trafolar = await ApiClient.fetchTransformers();
            trafolar.forEach(t => VeriModulu.trafoEkle({
                id: t.id,
                adi: t.name,
                bolge: t.region,
                kapasite: t.power_mva,
                tip: 'Bilinmiyor',
                aciklama: `${t.name}, ${t.power_mva} MVA`
            }));

            // 2. Bu ayın verilerini çek
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);

        } catch (e) {
            console.error("Başlangıç veri çekme hatası:", e);
            document.getElementById('global-loader').innerHTML = 'Sunucuya bağlanılamadı. Python backend çalışıyor mu?';
            return;
        }

        // Tarih gösterimi
        document.getElementById('current-date').textContent = formatDisplayDate(VeriModulu.BUGUN);

        // Tema yönetimi
        initTheme();

        // Varsayılan trafo
        const kayitliTrafolar = VeriModulu.getTrafolar();
        if (kayitliTrafolar.length > 0) {
            state.selectedTrafoId = kayitliTrafolar[0].id;
        }

        // Select doldur
        populateTrafoSelects();

        // Navigasyon
        setupNavigation();

        // Form handler'lar
        setupFormHandlers();

        // Senaryo formu
        setupSenaryoForm();

        // Topoloji Modülü
        if (typeof TopolojiModulu !== 'undefined') {
            TopolojiModulu.init();
        }

        // İlk ekranı çiz
        await renderDashboard();

        // Yükleme ekranını tüm veriler ve dashboard geldikten sonra kaldır
        document.getElementById('global-loader')?.remove();
    }

    // ─── Tarih Formatlama ───
    function formatDisplayDate(dateStr) {
        const d = VeriModulu.parseDate(dateStr);
        return `${d.getDate()} ${AY_ADLARI[d.getMonth()]} ${d.getFullYear()}`;
    }

    // ═══════════════════════════════════════════
    // NAVIGATION
    // ═══════════════════════════════════════════

    function setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                navigate(btn.dataset.screen);
            });
        });
    }

    function navigate(screen) {
        // Nav butonları güncelle
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-screen="${screen}"]`)?.classList.add('active');

        // Ekranları göster/gizle
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const el = document.getElementById(`screen-${screen}`);
        if (el) el.classList.add('active');

        state.currentScreen = screen;

        // Ekran içeriğini çiz
        switch (screen) {
            case 'dashboard':
                renderDashboard();
                if (state.dashboardView === 'scada' && typeof TopolojiModulu !== 'undefined') {
                    TopolojiModulu.render();
                }
                break;
            case 'veri-giris': renderVeriGiris(); break;
            case 'trafo-detay': renderTrafoDetay(); break;
            case 'tahmin': renderTahmin(); break;
            case 'manevra': renderManevra(); break;
        }
    }


    // ═══════════════════════════════════════════
    // SELECT POPULATE
    // ═══════════════════════════════════════════

    function populateAySelects() {
        const selects = ['dashboard-ay-select', 'detay-ay-select', 'topoloji-ay-select', 'tahmin-ay-select'];
        const now = new Date();
        const options = [];
        let cur = new Date(now.getFullYear(), now.getMonth(), 1);

        while (cur.getFullYear() > 2025 || (cur.getFullYear() === 2025 && cur.getMonth() >= 0)) {
            const val = `${cur.getFullYear()}-${(cur.getMonth() + 1).toString().padStart(2, '0')}`;
            const text = `${AY_ADLARI[cur.getMonth()]} ${cur.getFullYear()}`;
            options.push({ val, text });
            cur.setMonth(cur.getMonth() - 1);
        }
        selects.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = options.map(o => `<option value="${o.val}">${o.text}</option>`).join('');
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

        // Change listeners
        document.getElementById('detay-trafo-select')?.addEventListener('change', (e) => {
            state.selectedTrafoId = e.target.value;
            renderTrafoDetay();
        });

        const syncAySelects = (newVal) => {
            const [y, m] = newVal.split('-');
            state.selectedYil = parseInt(y, 10);
            state.selectedAy = parseInt(m, 10);

            const detayAy = document.getElementById('detay-ay-select');
            const topolojiAy = document.getElementById('topoloji-ay-select');
            const dashAy = document.getElementById('dashboard-ay-select');
            const tahminAy = document.getElementById('tahmin-ay-select');

            if (detayAy && detayAy.value !== newVal) detayAy.value = newVal;
            if (topolojiAy && topolojiAy.value !== newVal) topolojiAy.value = newVal;
            if (dashAy && dashAy.value !== newVal) dashAy.value = newVal;
            if (tahminAy && tahminAy.value !== newVal) tahminAy.value = newVal;
        };

        document.getElementById('detay-ay-select')?.addEventListener('change', async (e) => {
            syncAySelects(e.target.value);
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);
            renderTrafoDetay();
        });
        document.getElementById('topoloji-ay-select')?.addEventListener('change', async (e) => {
            syncAySelects(e.target.value);
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);
            if (typeof TopolojiModulu !== 'undefined') {
                TopolojiModulu.render();
            }
        });
        document.getElementById('dashboard-ay-select')?.addEventListener('change', async (e) => {
            syncAySelects(e.target.value);
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);
            renderDashboard();
        });
        document.getElementById('tahmin-ay-select')?.addEventListener('change', async (e) => {
            syncAySelects(e.target.value);
            await VeriModulu.loadAylikVeriler(state.selectedYil, state.selectedAy);
            renderTahmin();
        });
        document.getElementById('tahmin-trafo-select')?.addEventListener('change', (e) => {
            state.selectedTrafoId = e.target.value;
            renderTahmin();
            if (document.getElementById('senaryo-sonuc')?.style.display !== 'none') {
                runSenaryo(false);
            }
        });
        const syncYontemSelects = (newYontem) => {
            state.selectedYontem = newYontem;
            const detayY = document.getElementById('detay-yontem-select');
            const tahminY = document.getElementById('tahmin-yontem-select');
            if (detayY && detayY.value !== newYontem) detayY.value = newYontem;
            if (tahminY && tahminY.value !== newYontem) tahminY.value = newYontem;
        };

        document.getElementById('detay-yontem-select')?.addEventListener('change', (e) => {
            syncYontemSelects(e.target.value);
            renderTrafoDetay();
        });
        document.getElementById('tahmin-yontem-select')?.addEventListener('change', (e) => {
            syncYontemSelects(e.target.value);
            renderTahmin();
            if (document.getElementById('senaryo-sonuc')?.style.display !== 'none') {
                runSenaryo(false);
            }
        });
        document.getElementById('table-trafo-filter')?.addEventListener('change', () => {
            state.tablePage = 1;
            renderVeriTablosu();
        });
        document.getElementById('table-date-start')?.addEventListener('change', () => {
            state.tablePage = 1;
            renderVeriTablosu();
        });
        document.getElementById('table-date-end')?.addEventListener('change', () => {
            state.tablePage = 1;
            renderVeriTablosu();
        });
        document.getElementById('table-per-page')?.addEventListener('change', (e) => {
            state.tablePerPage = e.target.value === 'all' ? 'all' : parseInt(e.target.value);
            state.tablePage = 1;
            renderVeriTablosu();
        });
        document.getElementById('table-prev-page')?.addEventListener('click', () => {
            if (state.tablePage > 1) {
                state.tablePage--;
                renderVeriTablosu();
            }
        });
        document.getElementById('table-next-page')?.addEventListener('click', () => {
            state.tablePage++;
            renderVeriTablosu();
        });
    }

    // ═══════════════════════════════════════════
    // SCREEN 1: DASHBOARD
    // ═══════════════════════════════════════════

    async function renderForecastBanner(ozetler) {
        const currentKey = `${state.selectedYil}-${state.selectedAy}-${state.selectedYontem}`;

        if (!ozetler) {
            if (state.lastOzetler && state.lastOzetlerKey === currentKey) {
                ozetler = state.lastOzetler;
            } else {
                const hamOzetler = HesaplamaModulu.tumTrafoOzetleri(state.selectedYil, state.selectedAy);
                ozetler = await Promise.all(hamOzetler.map(async ({ trafo, ozet }) => {
                    if (!ozet) return { trafo, ozet: null, tahminOzet: null };
                    let tahminOzet = null;
                    try {
                        if (typeof TahminModulu !== 'undefined') {
                            const tSonuc = await TahminModulu.aySonuTahminiYap(trafo.id, state.selectedYil, state.selectedAy, state.selectedYontem || 'ensemble');
                            if (tSonuc && tSonuc.tumVeriler) {
                                tahminOzet = HesaplamaModulu.aylikOzetHesapla(tSonuc.tumVeriler);
                            }
                        }
                    } catch (e) {
                        console.warn('Tahmin hatası:', e);
                    }
                    return { trafo, ozet, tahminOzet };
                }));
                state.lastOzetler = ozetler;
                state.lastOzetlerKey = currentKey;
            }
        } else {
            state.lastOzetler = ozetler;
            state.lastOzetlerKey = currentKey;
        }

        if (!ozetler || ozetler.length === 0) return;

        let toplamTahminAktif = 0;
        let toplamTahminKapasitif = 0;
        let toplamMevcutAktif = 0;
        let toplamMevcutKapasitif = 0;
        let riskliTahminTrafolar = [];
        let dikkatTahminTrafolar = [];

        ozetler.forEach(({ trafo, ozet, tahminOzet }) => {
            if (ozet) {
                toplamMevcutAktif += ozet.toplamAktif;
                toplamMevcutKapasitif += ozet.toplamKapasitif;
            }
            if (tahminOzet) {
                toplamTahminAktif += tahminOzet.toplamAktif;
                toplamTahminKapasitif += tahminOzet.toplamKapasitif;
                if (tahminOzet.kapasitifOran >= HesaplamaModulu.SINIRLAR.kapasitif) {
                    riskliTahminTrafolar.push({ trafo, tahminOzet, mevcutOzet: ozet });
                } else if (tahminOzet.kapasitifOran >= 12) {
                    dikkatTahminTrafolar.push({ trafo, tahminOzet, mevcutOzet: ozet });
                }
            }
        });

        const genelTahminOran = HesaplamaModulu.oranHesapla(toplamTahminKapasitif, toplamTahminAktif);
        const genelMevcutOran = HesaplamaModulu.oranHesapla(toplamMevcutKapasitif, toplamMevcutAktif);

        let bannerHTML = '';
        if (riskliTahminTrafolar.length > 0) {
            bannerHTML = `
                <div class="forecast-alert-card alert-card-riskli">
                    <div class="forecast-alert-left">
                        <div class="forecast-alert-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
                        <div class="forecast-alert-text">
                            <h3>AY SONU PROJEKSİYONU & RİSK BİLDİRİMİ <span class="badge badge-tehlikeli" style="margin-left:8px;">Ceza Sınırı Aşım Riski!</span></h3>
                            <p>
                                Mevcut kullanım trendi devam ederse ay sonunda tesis geneli kapasitif oranı <strong>%${HesaplamaModulu.formatSayi(genelTahminOran)}</strong> seviyesine ulaşacaktır (Mevcut: %${HesaplamaModulu.formatSayi(genelMevcutOran)}).
                                <br><strong>${riskliTahminTrafolar.length} adet trafoda (${riskliTahminTrafolar.map(t => `${escapeHTML(t.trafo.adi)}: <b>%${HesaplamaModulu.formatSayi(t.tahminOzet.kapasitifOran)}</b>`).join(', ')})</strong> ay sonuna kadar %15 yasal ceza sınırının aşılması beklenmektedir! Acil şönt reaktör devreye alma veya yük transferi önerilir.
                            </p>
                        </div>
                    </div>
                    <div class="forecast-alert-right">
                        <div class="forecast-alert-metric-box">
                            <div class="forecast-alert-metric-label">Ay Sonu Tahmini</div>
                            <div class="forecast-alert-metric-val" style="color: var(--color-danger)">%${HesaplamaModulu.formatSayi(genelTahminOran)}</div>
                        </div>
                        <button class="forecast-alert-btn btn btn-primary" onclick="App.navigateToTrafo('${riskliTahminTrafolar[0].trafo.id}')" style="background: var(--color-danger); border: none;">
                            Riskli Trafoyu İncele
                        </button>
                    </div>
                </div>
            `;
        } else if (dikkatTahminTrafolar.length > 0) {
            bannerHTML = `
                <div class="forecast-alert-card alert-card-dikkat">
                    <div class="forecast-alert-left">
                        <div class="forecast-alert-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
                        <div class="forecast-alert-text">
                            <h3>AY SONU PROJEKSİYONU & DİKKAT BİLDİRİMİ <span class="badge badge-dikkat" style="margin-left:8px;">Uyarı Eşiği</span></h3>
                            <p>
                                Mevcut kullanım trendi devam ederse ay sonunda tesis geneli kapasitif oranı <strong>%${HesaplamaModulu.formatSayi(genelTahminOran)}</strong> seviyesine ulaşacaktır (Mevcut: %${HesaplamaModulu.formatSayi(genelMevcutOran)}).
                                <br>Hiçbir trafo %15 ceza sınırını aşmayacak olsa da, <strong>${dikkatTahminTrafolar.length} adet trafoda (${dikkatTahminTrafolar.map(t => `${escapeHTML(t.trafo.adi)}: <b>%${HesaplamaModulu.formatSayi(t.tahminOzet.kapasitifOran)}</b>`).join(', ')})</strong> %12 uyarı sınırının üzerinde seyredilecektir.
                            </p>
                        </div>
                    </div>
                    <div class="forecast-alert-right">
                        <div class="forecast-alert-metric-box">
                            <div class="forecast-alert-metric-label">Ay Sonu Tahmini</div>
                            <div class="forecast-alert-metric-val" style="color: var(--color-warning)">%${HesaplamaModulu.formatSayi(genelTahminOran)}</div>
                        </div>
                        <button class="forecast-alert-btn btn btn-outline" onclick="App.navigateToTrafo('${dikkatTahminTrafolar[0].trafo.id}')">
                            Detayları Gör
                        </button>
                    </div>
                </div>
            `;
        } else {
            bannerHTML = `
                <div class="forecast-alert-card alert-card-guvenli">
                    <div class="forecast-alert-left">
                        <div class="forecast-alert-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
                        <div class="forecast-alert-text">
                            <h3>AY SONU PROJEKSİYONU & RİSK BİLDİRİMİ <span class="badge badge-guvenli" style="margin-left:8px;">Tamamen Güvenli</span></h3>
                            <p>
                                Harika! Tesis geneli ay sonu tahmini kapasitif oranı <strong>%${HesaplamaModulu.formatSayi(genelTahminOran)}</strong> ile güvenli yeşil bölgede öngörülmektedir (Mevcut: %${HesaplamaModulu.formatSayi(genelMevcutOran)}).
                                <br>Tüm trafoların ay sonuna kadar hem %15 yasal ceza sınırının hem de %12 uyarı eşiğinin çok altında kalarak konforlu bir şekilde ayı tamamlaması bekleniyor.
                            </p>
                        </div>
                    </div>
                    <div class="forecast-alert-right">
                        <div class="forecast-alert-metric-box">
                            <div class="forecast-alert-metric-label">Ay Sonu Tahmini</div>
                            <div class="forecast-alert-metric-val" style="color: var(--color-success)">%${HesaplamaModulu.formatSayi(genelTahminOran)}</div>
                        </div>
                        <button class="forecast-alert-btn btn btn-outline" onclick="App.navigate('tahmin')">
                            Tahmin Detayları
                        </button>
                    </div>
                </div>
            `;
        }

        const bannerCharts = document.getElementById('dashboard-forecast-banner');
        const bannerScada = document.getElementById('scada-forecast-banner');
        if (bannerCharts) bannerCharts.innerHTML = bannerHTML;
        if (bannerScada) bannerScada.innerHTML = bannerHTML;
    }

    const _dashboardCache = new Map();
    async function renderDashboard() {
        const cacheKey = `${state.selectedYil}_${state.selectedAy}_${state.selectedYontem}`;
        let ozetler;

        // Show loading state
        document.getElementById('summary-cards').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Sunucudan analizler ve projeksiyonlar çekiliyor... <span class="loading-spinner"></span></div>';
        const bannerCharts = document.getElementById('dashboard-forecast-banner');
        if (bannerCharts) bannerCharts.innerHTML = '';

        if (_dashboardCache.has(cacheKey)) {
            ozetler = _dashboardCache.get(cacheKey);
        } else {
            try {
                // Backend'den gerçek veri özetlerini al
                const hamOzetler = await ApiClient.fetchAnalysisSummary(state.selectedYil, state.selectedAy);

                // Tahminleri de bekle (Artık backend milisaniyeler içinde cevap veriyor)
                ozetler = await Promise.all(hamOzetler.map(async (item) => {
                    let tahminOzet = null;
                    try {
                        const tSonuc = await TahminModulu.aySonuTahminiYap(item.trafo.id, state.selectedYil, state.selectedAy, state.selectedYontem || 'ensemble');
                        if (tSonuc && tSonuc.tumVeriler) {
                            tahminOzet = HesaplamaModulu.aylikOzetHesapla(tSonuc.tumVeriler);
                        }
                    } catch (e) {
                        console.error(`Tahmin hatası (${item.trafo.id}):`, e);
                    }

                    const enrichedOzet = {
                        ...item.ozet,
                        kapasitifRisk: HesaplamaModulu.riskSeviyesiBelirle(item.ozet.kapasitifOran || 0, 'kapasitif'),
                        enduktifRisk: HesaplamaModulu.riskSeviyesiBelirle(item.ozet.enduktifOran || 0, 'enduktif')
                    };

                    return { trafo: item.trafo, ozet: enrichedOzet, tahminOzet };
                }));

                _dashboardCache.set(cacheKey, ozetler);
            } catch (error) {
                document.getElementById('summary-cards').innerHTML = `<div style="padding: 20px; color: var(--color-danger);">Bağlantı hatası: ${error.message}</div>`;
                return;
            }
        }

        renderForecastBanner(ozetler);
        updateDashboardUI(ozetler);
    }


    function switchDashboardView(viewName) {
        state.dashboardView = viewName;
        const btnCharts = document.getElementById('btn-view-charts');
        const btnScada = document.getElementById('btn-view-scada');
        const panelCharts = document.getElementById('dashboard-view-charts');
        const panelScada = document.getElementById('dashboard-view-scada');

        if (btnCharts && btnScada) {
            btnCharts.classList.toggle('active', viewName === 'charts');
            btnScada.classList.toggle('active', viewName === 'scada');
        }
        if (panelCharts && panelScada) {
            panelCharts.style.display = viewName === 'charts' ? 'block' : 'none';
            panelScada.style.display = viewName === 'scada' ? 'block' : 'none';
        }

        if (viewName === 'scada' && typeof TopolojiModulu !== 'undefined') {
            TopolojiModulu.render();
        } else if (viewName === 'charts') {
            renderDashboard();
        }
    }

    // Trafo kartına tıklayınca detay ekranına git
    function navigateToTrafo(trafoId) {
        state.selectedTrafoId = trafoId;
        const sel = document.getElementById('detay-trafo-select');
        if (sel) sel.value = trafoId;
        navigate('trafo-detay');
    }

    // ═══════════════════════════════════════════
    // SCREEN 2: VERİ GİRİŞİ
    // ═══════════════════════════════════════════

    function setupFormHandlers() {
        // Manuel veri giriş formu
        const form = document.getElementById('veri-giris-form');
        form?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const trafoId = document.getElementById('input-trafo').value;
            let tarih = document.getElementById('input-tarih').value;
            tarih = tarih.replace('T', ' '); // YYYY-MM-DD HH:mm formatı için T'yi boşluğa çevir
            const aktif = parseInt(document.getElementById('input-aktif').value);
            const enduktif = parseInt(document.getElementById('input-enduktif').value);
            const kapasitif = parseInt(document.getElementById('input-kapasitif').value);

            if (!trafoId || !tarih || isNaN(aktif) || isNaN(enduktif) || isNaN(kapasitif)) {
                showToast('Lütfen tüm alanları doldurun.', 'error');
                return;
            }

            if (aktif < 0 || enduktif < 0 || kapasitif < 0) {
                showToast('Negatif enerji değeri girilemez (Hatalı ölçüm).', 'error');
                return;
            }

            const d = VeriModulu.parseDate(tarih);
            _dashboardCache.clear();
            
            try {
                await VeriModulu.veriEkle({
                    trafoId,
                    tarih,
                    aktifEnerji: aktif,
                    enduktifEnerji: enduktif,
                    kapasitifEnerji: kapasitif,
                    haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                    tatil: false,
                });
                showToast('Veri veritabanına başarıyla kaydedildi!', 'success');
                form.reset();
                renderVeriTablosu();
            } catch (err) {
                console.error("Veri eklenirken hata oluştu:", err);
                showToast('Veri kaydedilirken hata oluştu!', 'error');
            }
        });

        // CSV dosya seçimi
        document.getElementById('btn-csv-sec')?.addEventListener('click', () => {
            document.getElementById('csv-file-input')?.click();
        });

        document.getElementById('csv-file-input')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            handleCSVUpload(file);
        });

        // Drag & drop
        const dropArea = document.getElementById('csv-upload-area');
        if (dropArea) {
            ['dragover', 'dragenter'].forEach(ev => {
                dropArea.addEventListener(ev, (e) => {
                    e.preventDefault();
                    dropArea.classList.add('drag-over');
                });
            });
            ['dragleave', 'drop'].forEach(ev => {
                dropArea.addEventListener(ev, (e) => {
                    // dragleave: Yalnızca alanın dışına çıkıldığında kaldır
                    // (child elementlere geçişte titreşmeyi önle)
                    if (ev === 'dragleave' && dropArea.contains(e.relatedTarget)) return;
                    dropArea.classList.remove('drag-over');
                });
            });
            dropArea.addEventListener('drop', (e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file && file.name.endsWith('.csv')) {
                    handleCSVUpload(file);
                }
            });
        }

        // Yeni Trafo Ekleme Modalı Kontrolleri
        const btnOpenYeniTrafo = document.getElementById('btn-open-yeni-trafo');
        const btnCloseYeniTrafo = document.getElementById('btn-close-yeni-trafo');
        const modalYeniTrafo = document.getElementById('yeni-trafo-modal');
        const formYeniTrafo = document.getElementById('yeni-trafo-form');

        if (btnOpenYeniTrafo && modalYeniTrafo) {
            btnOpenYeniTrafo.addEventListener('click', () => {
                modalYeniTrafo.style.display = 'flex';
            });
        }
        if (btnCloseYeniTrafo && modalYeniTrafo) {
            btnCloseYeniTrafo.addEventListener('click', () => {
                modalYeniTrafo.style.display = 'none';
            });
        }
        if (formYeniTrafo) {
            formYeniTrafo.addEventListener('submit', (e) => {
                e.preventDefault();
                const id = document.getElementById('new-trafo-id').value.trim().toUpperCase();
                const adi = document.getElementById('new-trafo-adi').value.trim();
                const bolge = document.getElementById('new-trafo-bolge').value.trim();
                const guc = parseInt(document.getElementById('new-trafo-guc').value, 10);

                if (id && adi) {
                    VeriModulu.trafoEkle({
                        id: id,
                        adi: adi,
                        bolge: bolge || 'Bilinmiyor',
                        tip: 'Bilinmiyor',
                        kapasite: isNaN(guc) ? 100 : guc,
                        aciklama: 'Manuel eklendi.'
                    });

                    showToast('Yeni trafo başarıyla eklendi.', 'success');
                    modalYeniTrafo.style.display = 'none';
                    formYeniTrafo.reset();

                    populateTrafoSelects();
                    const select = document.getElementById('input-trafo');
                    if (select) select.value = id;
                }
            });
        }

        // OSOS Veri Çekme
        const btnOsosFetch = document.getElementById('btn-osos-fetch');
        if (btnOsosFetch) {
            btnOsosFetch.addEventListener('click', async () => {
                const start = document.getElementById('osos-date-start').value;
                const end = document.getElementById('osos-date-end').value;

                if (!start || !end) {
                    showToast('Lütfen başlangıç ve bitiş tarihlerini seçin.', 'error');
                    return;
                }

                try {
                    btnOsosFetch.disabled = true;
                    btnOsosFetch.innerHTML = 'Çekiliyor...';

                    const data = await ApiClient.fetchMeasurements(start, end);
                    if (data && data.length > 0) {
                        for (const m of data) {
                            const d = new Date(m.timestamp);
                            await VeriModulu.veriEkle({
                                trafoId: m.transformer_id,
                                tarih: m.timestamp.replace('T', ' '),
                                aktifEnerji: m.active_kwh,
                                enduktifEnerji: m.inductive_kvarh,
                                kapasitifEnerji: m.capacitive_kvarh,
                                haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                                tatil: false,
                            });
                        }

                        _dashboardCache.clear();
                        showToast(`${data.length} ölçüm başarıyla OSOS'tan çekildi!`, 'success');
                        renderVeriTablosu();
                    } else {
                        showToast('Belirtilen aralıkta veri bulunamadı.', 'warning');
                    }
                } catch (error) {
                    showToast(error.message, 'error');
                } finally {
                    btnOsosFetch.disabled = false;
                    btnOsosFetch.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 5px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Verileri Çek';
                }
            });
        }
    }

    function handleCSVUpload(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const lines = text.split('\n').filter(l => l.trim());
            const trafolar = VeriModulu.getTrafolar();
            const trafoMap = new Set(trafolar.map(t => t.id));

            // PASS 1: Detect new trafos
            const yeniTrafolar = new Set();
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(/[,;\t]/).map(s => s.trim());
                if (parts.length >= 5) {
                    const trafoId = parts[0];
                    if (!trafoMap.has(trafoId)) {
                        yeniTrafolar.add(trafoId);
                    }
                }
            }

            if (yeniTrafolar.size > 0) {
                const onay = confirm(`CSV dosyasında daha önce karşılaşılmamış şu yeni trafolar bulundu:\n${Array.from(yeniTrafolar).join(', ')}\n\nBunları sisteme otomatik olarak eklemek istiyor musunuz?`);
                if (onay) {
                    yeniTrafolar.forEach(id => {
                        VeriModulu.trafoEkle({
                            id: id,
                            adi: id,
                            bolge: 'Bilinmiyor',
                            tip: 'Bilinmiyor',
                            kapasite: 100,
                            aciklama: 'CSV\'den otomatik eklendi.'
                        });
                        trafoMap.add(id);
                    });
                    populateTrafoSelects();
                    showToast('Yeni trafolar sisteme kaydedildi.', 'success');
                }
            }

            // PASS 2: Parse normally
            let count = 0;
            let skipped = 0;

            const yeniVeriler = [];

            // Başlık satırını atla
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(/[,;\t]/).map(s => s.trim());
                if (parts.length >= 5) {
                    const [trafoId, tarih, aktifStr, enduktifStr, kapasitifStr] = parts;
                    const aktif = parseInt(aktifStr, 10);
                    const enduktif = parseInt(enduktifStr, 10);
                    const kapasitif = parseInt(kapasitifStr, 10);
                    const dateMatch = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])( ([01]\d|2[0-3]):[0-5]\d)?$/.test(tarih);

                    if (!trafoMap.has(trafoId) || !dateMatch || isNaN(aktif) || isNaN(enduktif) || isNaN(kapasitif)) {
                        skipped++;
                        continue;
                    }

                    if (aktif < 0 || enduktif < 0 || kapasitif < 0) {
                        skipped++;
                        continue;
                    }

                    const d = VeriModulu.parseDate(tarih);
                    if (isNaN(d.getTime())) {
                        skipped++;
                        continue;
                    }

                    yeniVeriler.push({
                        trafoId,
                        tarih,
                        aktifEnerji: aktif,
                        enduktifEnerji: enduktif,
                        kapasitifEnerji: kapasitif,
                        haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                        tatil: false,
                    });
                    count++;
                } else {
                    skipped++;
                }
            }

            if (yeniVeriler.length > 0) {
                _dashboardCache.clear();
                VeriModulu.veriEkleToplu(yeniVeriler);
            }

            if (count > 0) {
                showToast(`${count} adet veri başarıyla yüklendi!${skipped > 0 ? ` (${skipped} satır atlandı)` : ''}`, 'success');
                renderVeriTablosu();
            } else {
                showToast(`Yüklenecek geçerli veri bulunamadı.${skipped > 0 ? ` (${skipped} hatalı satır atlandı)` : ''}`, 'error');
            }
        };
        reader.readAsText(file);
    }

    function renderVeriGiris() {
        // Tarih varsayılan değeri (saatlik formatta)
        let varsayilan = VeriModulu.BUGUN_SAATLIK || '2025-07-22 14:00';
        document.getElementById('input-tarih').value = varsayilan.replace(' ', 'T');
        renderVeriTablosu();
    }

    function renderVeriTablosu() {
        try {
            const filterTrafo = document.getElementById('table-trafo-filter')?.value || '';
            const startDateStr = document.getElementById('table-date-start')?.value;
            const endDateStr = document.getElementById('table-date-end')?.value;
            let veriler;

            if (filterTrafo) {
                veriler = [...VeriModulu.getTrafoVerileri(filterTrafo)];
            } else {
                veriler = [...VeriModulu.getTumVeriler()];
            }

            // Apply Date Filters safely
            if (startDateStr) {
                veriler = veriler.filter(v => v && v.tarih && v.tarih.substring(0, 10) >= startDateStr);
            }
            if (endDateStr) {
                veriler = veriler.filter(v => v && v.tarih && v.tarih.substring(0, 10) <= endDateStr);
            }

            // Sort by date descending safely
            veriler.sort((a, b) => {
                const ta = (a && a.tarih) ? a.tarih : '';
                const tb = (b && b.tarih) ? b.tarih : '';
                return tb.localeCompare(ta);
            });

            // Pagination calculations
            const totalRows = veriler.length;
            const totalRecords = VeriModulu.getTumVeriler().length;
            const totalRowsEl = document.getElementById('table-total-rows');
            const totalRecordsEl = document.getElementById('table-total-records');
            if (totalRowsEl) totalRowsEl.textContent = totalRows;
            if (totalRecordsEl) totalRecordsEl.textContent = totalRecords;

            let totalPages = 1;
            if (state.tablePerPage !== 'all') {
                totalPages = Math.ceil(totalRows / state.tablePerPage) || 1;
                if (state.tablePage > totalPages) state.tablePage = totalPages;

            const startIndex = (state.tablePage - 1) * state.tablePerPage;
            const endIndex = startIndex + state.tablePerPage;
            veriler = veriler.slice(startIndex, endIndex);
        } else {
            state.tablePage = 1;
        }

        const pageInfoEl = document.getElementById('table-page-info');
        if (pageInfoEl) pageInfoEl.textContent = `${state.tablePage} / ${totalPages}`;

        const prevBtn = document.getElementById('table-prev-page');
        const nextBtn = document.getElementById('table-next-page');
        if (prevBtn) prevBtn.disabled = state.tablePage <= 1;
        if (nextBtn) nextBtn.disabled = state.tablePage >= totalPages;

        const tbody = document.getElementById('veri-table-body');
        if (!tbody) return;

        if (veriler.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 25px 15px; font-size: 14px;">Gösterilecek kayıt bulunamadı.</td></tr>`;
            return;
        }

        tbody.innerHTML = veriler.map(v => {
            const oran = HesaplamaModulu.oranHesapla(v.kapasitifEnerji, v.aktifEnerji);
            const risk = HesaplamaModulu.riskSeviyesiBelirle(oran, 'kapasitif');
            const trafo = VeriModulu.getTrafo(v.trafoId);
            const rowClass = v.haftaSonu ? 'row-weekend' : (v.tatil ? 'row-tatil' : '');

            return `
                <tr class="${rowClass}">
                    <td>${v.tarih}</td>
                    <td>${escapeHTML(trafo ? (trafo.adi.split(' – ').length > 1 ? trafo.adi.split(' – ')[0] + ' (' + trafo.adi.split(' – ')[1] + ')' : trafo.adi) : v.trafoId)}</td>
                    <td class="text-right">${HesaplamaModulu.formatEnerji(v.aktifEnerji)}</td>
                    <td class="text-right">${HesaplamaModulu.formatEnerji(v.enduktifEnerji)}</td>
                    <td class="text-right">${HesaplamaModulu.formatEnerji(v.kapasitifEnerji)}</td>
                    <td class="text-right" style="color:${risk.renk}; font-weight:600;">
                        %${HesaplamaModulu.formatSayi(oran)}
                    </td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-ghost" onclick="App.silVeri('${v.trafoId}','${v.tarih}')">Sil</button>
                    </td>
                </tr>
            `;
        }).join('');
        
        } catch (e) {
            console.error("renderVeriTablosu ERROR:", e);
            const totalRowsEl = document.getElementById('table-total-rows');
            if (totalRowsEl) totalRowsEl.innerHTML = `<span style="color:red;">Error: ${e.message}</span>`;
            
            const tbody = document.getElementById('veri-table-body');
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 25px 15px; font-size: 14px; color: red;">Error rendering table: ${e.message}</td></tr>`;
        }
    }

    async function silVeri(trafoId, tarih) {
        try {
            await VeriModulu.veriSil(trafoId, tarih);
            _dashboardCache.clear();
            showToast('Veri veritabanından silindi.', 'info');
            renderVeriTablosu();
        } catch (err) {
            console.error("Veri silinirken hata oluştu:", err);
            showToast('Veri silinirken hata oluştu!', 'error');
        }
    }

    // ═══════════════════════════════════════════
    // SCREEN 3: TRAFO DETAY & RİSK ANALİZİ
    // ═══════════════════════════════════════════

    async function renderTrafoDetay() {
        const trafoId = state.selectedTrafoId;
        const ay = state.selectedAy;
        const yil = state.selectedYil;

        const trafo = VeriModulu.getTrafo(trafoId);
        if (!trafo) return;

        const veriler = VeriModulu.getAylikVeriler(trafoId, yil, ay);
        const ozet = HesaplamaModulu.aylikOzetHesapla(veriler);

        if (!ozet) {
            document.getElementById('detay-summary').innerHTML = '<p class="text-muted">Bu ay için veri bulunamadı.</p>';
            return;
        }

        // Tahmin yap (seçilen yöntemle)
        const yontem = document.getElementById('detay-yontem-select')?.value || state.selectedYontem || 'ensemble';
        const selYontem = document.getElementById('detay-yontem-select');
        if (selYontem && selYontem.value !== yontem) selYontem.value = yontem;

        document.getElementById('detay-summary').innerHTML = '<p class="text-muted">Hesaplanıyor... <span class="loading-spinner"></span></p>';

        try {
            const tahminSonucu = await TahminModulu.aySonuTahminiYap(trafoId, yil, ay, yontem);
            const tahminOzet = HesaplamaModulu.aylikOzetHesapla(tahminSonucu.tumVeriler);
            const tahminOranStr = tahminOzet ? HesaplamaModulu.formatSayi(tahminOzet.kapasitifOran) : '—';
            const tahminRisk = tahminOzet ? HesaplamaModulu.riskSeviyesiBelirle(tahminOzet.kapasitifOran, 'kapasitif') : null;

            // ── Özet Kartlar ──
            document.getElementById('detay-summary').innerHTML = `
            <div class="detay-card">
                <div class="dc-label">Kapasitif Oran</div>
                <div class="dc-value" style="color:${ozet.kapasitifRisk.renk}">%${HesaplamaModulu.formatSayi(ozet.kapasitifOran)}</div>
                <div class="dc-unit">
                    <span class="badge badge-${ozet.kapasitifRisk.seviye}">${ozet.kapasitifRisk.ikon} ${ozet.kapasitifRisk.etiket}</span>
                </div>
            </div>
            <div class="detay-card">
                <div class="dc-label">Endüktif Oran</div>
                <div class="dc-value" style="color:${ozet.enduktifRisk.renk}">%${HesaplamaModulu.formatSayi(ozet.enduktifOran)}</div>
                <div class="dc-unit">
                    <span class="badge badge-${ozet.enduktifRisk.seviye}">${ozet.enduktifRisk.ikon} ${ozet.enduktifRisk.etiket}</span>
                </div>
            </div>
            <div class="detay-card">
                <div class="dc-label">Aktif Enerji</div>
                <div class="dc-value text-info">${HesaplamaModulu.formatEnerji(ozet.toplamAktif)}</div>
                <div class="dc-unit">kWh (toplam)</div>
            </div>
            <div class="detay-card">
                <div class="dc-label">Ay Sonu Tahmini <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">(${tahminSonucu.modelBilgi ? yontemEtiketiGetir(tahminSonucu.modelBilgi.adi) : 'Ensemble'})</span></div>
                <div class="dc-value" style="color:${tahminRisk ? tahminRisk.renk : 'inherit'}">%${tahminOranStr}</div>
                <div class="dc-unit">${tahminRisk ? `<span class="badge badge-${tahminRisk.seviye}">${tahminRisk.ikon} ${tahminRisk.etiket}</span>` : ''}</div>
            </div>
            <div class="detay-card">
                <div class="dc-label">Veri Süresi</div>
                <div class="dc-value text-info">${ozet.gunSayisi} Gün</div>
                <div class="dc-unit">${ozet.saatSayisi} saat kayıt (${TahminModulu.aydakiGunSayisi(yil, ay)} günden)</div>
            </div>
        `;

            // ── Grafik ──
            const tahminBadge = document.getElementById('detay-tahmin-badge');
            const barTahminBadge = document.getElementById('detay-bar-tahmin-badge');
            // Sync Toggle UI state
            document.querySelectorAll('.chart-res-toggle button').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.res === state.chartResolution);
            });
            const barTitle = document.getElementById('detay-bar-title');
            if (barTitle) {
                barTitle.textContent = state.chartResolution === 'hourly' ? 'Saatlik Kapasitif Oran Dağılımı (Ayrık)' : 'Günlük Kapasitif Oran Dağılımı (Ayrık)';
            }

            if (tahminSonucu.tahminVeriler.length > 0) {
                tahminBadge.style.display = '';
                if (barTahminBadge) barTahminBadge.style.display = '';
                GrafikModulu.createCumulativeLineChart(
                    'chart-detay-line',
                    state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                    tahminSonucu.tahminVeriler,
                    HesaplamaModulu.SINIRLAR.kapasitif,
                    state.chartResolution
                );
                GrafikModulu.createDailyBarChart(
                    'chart-detay-bar',
                    state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                    tahminSonucu.tahminVeriler,
                    HesaplamaModulu.SINIRLAR.kapasitif,
                    state.chartResolution
                );
            } else {
                tahminBadge.style.display = 'none';
                if (barTahminBadge) barTahminBadge.style.display = 'none';
                GrafikModulu.createCumulativeLineChart(
                    'chart-detay-line',
                    state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                    null,
                    HesaplamaModulu.SINIRLAR.kapasitif,
                    state.chartResolution
                );
                GrafikModulu.createDailyBarChart(
                    'chart-detay-bar',
                    state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                    null,
                    HesaplamaModulu.SINIRLAR.kapasitif,
                    state.chartResolution
                );
            }

            // ── Uyarı Kutusu ──
            const uyariEl = document.getElementById('detay-uyari');
            const uyariMesaj = HesaplamaModulu.uyariMesajiUret(
                escapeHTML(trafo.adi),
                ozet.kapasitifOran,
                tahminOzet ? tahminOzet.kapasitifOran : null
            );
            uyariEl.style.display = '';
            uyariEl.className = `alert-box alert-${ozet.kapasitifRisk.seviye}`;
            uyariEl.innerHTML = uyariMesaj;

            // ── Günlük Tablo ──
            const kumulatifler = ozet.kumulatifGunluk;
            const tbody = document.getElementById('detay-table-body');
            tbody.innerHTML = kumulatifler.map(v => {
                const tarih = VeriModulu.parseDate(v.tarih);
                const gunAdi = GUN_KISA[tarih.getDay()];
                const risk = HesaplamaModulu.riskSeviyesiBelirle(v.kumulatifKapasitifOran, 'kapasitif');
                const rowClass = v.haftaSonu ? 'row-weekend' : (v.tatil ? 'row-tatil' : '');

                return `
                <tr class="${rowClass}">
                    <td>${v.tarih}</td>
                    <td>${gunAdi}${v.tatil ? ' (Tatil)' : ''}</td>
                    <td class="text-right">${HesaplamaModulu.formatEnerji(v.aktifEnerji)}</td>
                    <td class="text-right">${HesaplamaModulu.formatEnerji(v.enduktifEnerji)}</td>
                    <td class="text-right">${HesaplamaModulu.formatEnerji(v.kapasitifEnerji)}</td>
                    <td class="text-right">%${HesaplamaModulu.formatSayi(v.gunlukKapasitifOran)}</td>
                    <td class="text-right" style="color:${risk.renk}; font-weight:600;">
                        %${HesaplamaModulu.formatSayi(v.kumulatifKapasitifOran)}
                    </td>
                    <td class="text-center">
                        <span class="badge badge-${risk.seviye}" style="font-size:10px">${risk.ikon}</span>
                    </td>
                </tr>
            `;
            }).join('');
        } catch (e) {
            document.getElementById('detay-summary').innerHTML = `<p class="text-danger">Hata: ${e.message}</p>`;
        }
    }

    // ═══════════════════════════════════════════
    // SCREEN 4: TAHMİN & SENARYO
    // ═══════════════════════════════════════════

    async function renderTahmin() {
        if (!state.selectedTrafoId) {
            const trafolar = VeriModulu.getTrafolar();
            if (trafolar.length) state.selectedTrafoId = trafolar[0].id;
        }
        const trafoId = state.selectedTrafoId;
        const selTrafo = document.getElementById('tahmin-trafo-select');
        if (selTrafo && selTrafo.value !== trafoId) selTrafo.value = trafoId;

        const yontem = document.getElementById('tahmin-yontem-select')?.value || state.selectedYontem || 'ensemble';
        const selY = document.getElementById('tahmin-yontem-select');
        if (selY && selY.value !== yontem) selY.value = yontem;
        const yil = state.selectedYil;
        const ay = state.selectedAy;
        const trafo = VeriModulu.getTrafo(trafoId);

        if (!trafo) return;

        document.getElementById('tahmin-summary').innerHTML = '<p class="text-muted">Tahmin Modeli çalıştırılıyor... <span class="loading-spinner"></span></p>';

        try {
            const tahmin = await TahminModulu.aySonuTahminiYap(trafoId, yil, ay, yontem);
            const mevcutOzet = HesaplamaModulu.aylikOzetHesapla(tahmin.mevcutVeriler);
            const tahminOzet = HesaplamaModulu.aylikOzetHesapla(tahmin.tumVeriler);

            if (!mevcutOzet || !tahminOzet) {
                document.getElementById('tahmin-summary').innerHTML = '<p class="text-muted">Yeterli veri bulunamadı.</p>';
                return;
            }

            const mevcutRisk = mevcutOzet.kapasitifRisk;
            const tahminRisk = tahminOzet.kapasitifRisk;
            const fark = tahminOzet.kapasitifOran - mevcutOzet.kapasitifOran;
            const farkStr = fark >= 0 ? `+${HesaplamaModulu.formatSayi(fark)}` : HesaplamaModulu.formatSayi(fark);
            const bilgi = tahmin.modelBilgi || { adi: 'Seçilen Model', skor: null, aciklama: 'Aylık tahmin projeksiyonu.' };

            // ── Özet Kartlar & Model Bilgi Paneli ──
            document.getElementById('tahmin-summary').innerHTML = `
            <div class="detay-card">
                <div class="dc-label">Mevcut Oran (${mevcutOzet.gunSayisi} gün / ${mevcutOzet.saatSayisi} saat)</div>
                <div class="dc-value" style="color:${mevcutRisk.renk}">%${HesaplamaModulu.formatSayi(mevcutOzet.kapasitifOran)}</div>
                <div class="dc-unit"><span class="badge badge-${mevcutRisk.seviye}">${mevcutRisk.ikon} ${mevcutRisk.etiket}</span></div>
            </div>
            <div class="detay-card">
                <div class="dc-label">Tahmini Ay Sonu Oranı</div>
                <div class="dc-value" style="color:${tahminRisk.renk}">%${HesaplamaModulu.formatSayi(tahminOzet.kapasitifOran)}</div>
                <div class="dc-unit"><span class="badge badge-${tahminRisk.seviye}">${tahminRisk.ikon} ${tahminRisk.etiket}</span></div>
            </div>
            <div class="detay-card">
                <div class="dc-label">Model Değişimi</div>
                <div class="dc-value" style="color:${fark >= 0 ? 'var(--color-danger)' : 'var(--color-success)'}">
                    ${farkStr}
                </div>
                <div class="dc-unit">puan (${yontemEtiketiGetir(bilgi.adi)})</div>
            </div>
            <div class="detay-card" style="border-left: 3px solid #3b82f6; cursor: pointer;" onclick="App.toggleModelDetail()" title="Açıklama ve test detayları için tıklayın">
                <div class="dc-label">Canlı Model Güven Skoru</div>
                <div class="dc-value text-info">
                    ${bilgi.skor !== null ? `%${bilgi.skor}` : 'Test Edilmedi'}
                </div>
                <div class="dc-unit" id="model-info-hint" style="font-size:11px; color:#3b82f6; font-weight:600; display:flex; align-items:center; gap:4px; margin-top:4px;">
                    Detay ve Açıklamayı Göster ▼
                </div>
                <div id="model-info-detail" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid rgba(148,163,184,0.2); font-size:11px; white-space:normal; line-height:1.4; color:var(--text-secondary);" onclick="event.stopPropagation();">
                    <div style="margin-bottom:6px; color:var(--text-primary); font-weight:500;">${bilgi.aciklama}</div>
                    ${bilgi.canliTest ? `<div style="padding:8px 10px; background:rgba(59,130,246,0.1); border-radius:6px; color:#3b82f6; border-left:3px solid #3b82f6;">${bilgi.canliTest.detay}</div>` : ''}
                </div>
            </div>
        `;

            const kumulatif = HesaplamaModulu.kumulatifOranlarHesapla(tahmin.mevcutVeriler);
            GrafikModulu.createCumulativeLineChart(
                'chart-tahmin-line',
                kumulatif,
                tahmin.tahminVeriler,
                HesaplamaModulu.SINIRLAR.kapasitif
            );
        } catch (e) {
            document.getElementById('tahmin-summary').innerHTML = `<p class="text-danger">Hata: ${e.message}</p>`;
        }
    }

    function setupSenaryoForm() {
        const turSelect = document.getElementById('senaryo-tur');
        const miktarInput = document.getElementById('senaryo-miktar');

        turSelect?.addEventListener('change', () => {
            const tur = turSelect.value;
            const turInfo = SenaryoModulu.SENARYO_TURLERI[tur];
            document.getElementById('senaryo-miktar-label').textContent = turInfo.etiketMiktar;
            document.getElementById('senaryo-aciklama').textContent = turInfo.aciklama;
            if (miktarInput) {
                miktarInput.value = tur === 'yukTransferi' ? 3500 : 2500;
            }
        });

        const form = document.getElementById('senaryo-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            runSenaryo(true);
        });
    }

    async function runSenaryo(kullaniciTetikledi = true) {
        if (kullaniciTetikledi) {
            const btn = document.getElementById('btn-senaryo-calistir');
            if (btn) btn.innerHTML = 'Hesaplanıyor... <span class="loading-spinner"></span>';
        }

        const trafoId = state.selectedTrafoId;
        const yontem = document.getElementById('tahmin-yontem-select')?.value || state.selectedYontem || 'ensemble';
        const senaryoTuru = document.getElementById('senaryo-tur').value;
        const baslangicTarihi = document.getElementById('senaryo-tarih').value;
        const miktar = parseInt(document.getElementById('senaryo-miktar').value);

        if (!baslangicTarihi || isNaN(miktar) || miktar <= 0) {
            showToast('Lütfen geçerli bir tarih ve miktar girin.', 'error');
            return;
        }

        try {
            const tahmin = await TahminModulu.aySonuTahminiYap(trafoId, state.selectedYil, state.selectedAy, yontem);
            const orijinalVeriler = tahmin.tumVeriler;
            const senaryoluVeriler = SenaryoModulu.senaryoUygula(orijinalVeriler, senaryoTuru, baslangicTarihi, miktar);
            const karsilastirma = SenaryoModulu.senaryoKarsilastir(orijinalVeriler, senaryoluVeriler);

            if (!karsilastirma) {
                showToast('Karşılaştırma yapılamadı.', 'error');
                return;
            }

            const sonucEl = document.getElementById('senaryo-sonuc');
            sonucEl.style.display = '';

            const orijRisk = karsilastirma.orijinal.kapasitifRisk;
            const senRisk = karsilastirma.senaryo.kapasitifRisk;

            const tasarrufKap = Math.round(karsilastirma.orijinal.toplamKapasitif - karsilastirma.senaryo.toplamKapasitif);
            const eklenenAktif = Math.round(karsilastirma.senaryo.toplamAktif - karsilastirma.orijinal.toplamAktif);

            const resultClass = karsilastirma.iyilesmeSaglandi ? 'result-positive' : 'result-negative';
            let resultText;
            if (karsilastirma.sinirAltinaIndi) {
                resultText = `Mükemmel! ${SenaryoModulu.SENARYO_TURLERI[senaryoTuru].adi} müdahalesi ile kapasitif oran %${HesaplamaModulu.formatSayi(karsilastirma.kapasitifOranSenaryo)} seviyesine düşürüldü ve %15 ceza sınırının altına inildi! (${tasarrufKap > 0 ? tasarrufKap + ' kVArh reaktif yük sönümlendi' : eklenenAktif + ' kWh aktif yük dengelendi'})`;
            } else if (karsilastirma.iyilesmeSaglandi && karsilastirma.kapasitifOranSenaryo < 12) {
                resultText = `Başarılı Müdahale! Oran %${HesaplamaModulu.formatSayi(Math.abs(karsilastirma.kapasitifFark))} puan düşürülerek %${HesaplamaModulu.formatSayi(karsilastirma.kapasitifOranSenaryo)} ile Güvenli Yeşil Bölgede konforlu bir seviyeye ulaştı.`;
            } else if (karsilastirma.iyilesmeSaglandi) {
                resultText = `Oran %${HesaplamaModulu.formatSayi(Math.abs(karsilastirma.kapasitifFark))} puan iyileştirildi (${tasarrufKap > 0 ? tasarrufKap + ' kVArh azaltıldı' : eklenenAktif + ' kWh eklendi'}). Ancak %${HesaplamaModulu.formatSayi(karsilastirma.kapasitifOranSenaryo)} seviyesi hâlâ ${karsilastirma.kapasitifOranSenaryo >= 15 ? '%15 ceza sınırının üzerinde. Ceza sınırının altına inmek için günlük müdahale miktarını (kVArh) artırmanız veya müdahaleye ayın daha erken bir gününde başlamanız önerilir!' : '%12 uyarı sınırına yakın. Daha güvenli bir seviye için müdahale miktarını bir miktar yükseltebilirsiniz.'}`;
            } else {
                resultText = `Bu senaryo ile oranda iyileşme sağlanamadı. Lütfen günlük müdahale miktarını (kVArh) artırmayı veya müdahaleye ayın daha erken bir gününde başlamayı deneyin.`;
            }

            document.getElementById('senaryo-karsilastirma').innerHTML = `
            <div class="senaryo-comparison">
                <div class="senaryo-col">
                    <div class="sc-label">Müdahalesiz Orijinal</div>
                    <div class="sc-value" style="color:${orijRisk.renk}">%${HesaplamaModulu.formatSayi(karsilastirma.kapasitifOranOrijinal)}</div>
                    <span class="badge badge-${orijRisk.seviye}" style="margin-top:8px">${orijRisk.ikon} ${orijRisk.etiket}</span>
                </div>
                <div class="senaryo-arrow">→</div>
                <div class="senaryo-col">
                    <div class="sc-label">Müdahale Sonrası</div>
                    <div class="sc-value" style="color:${senRisk.renk}">%${HesaplamaModulu.formatSayi(karsilastirma.kapasitifOranSenaryo)}</div>
                    <span class="badge badge-${senRisk.seviye}" style="margin-top:8px">${senRisk.ikon} ${senRisk.etiket}</span>
                </div>
            </div>
            <div class="senaryo-result-text ${resultClass}" style="line-height:1.5; font-size:14px; margin-top:16px;">${resultText}</div>
        `;

            GrafikModulu.createScenarioChart(
                'chart-senaryo-line',
                orijinalVeriler,
                senaryoluVeriler,
                HesaplamaModulu.SINIRLAR.kapasitif
            );

        } catch (e) {
            showToast('Senaryo hatası: ' + e.message, 'error');
        } finally {
            if (kullaniciTetikledi) {
                const btn = document.getElementById('btn-senaryo-calistir');
                if (btn) btn.innerHTML = 'Senaryoyu Uygula ve Test Et';
            }
            if (shouldScroll) {
                const sonucEl = document.getElementById('senaryo-sonuc');
                sonucEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    // ═══════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = { success: '', error: '', warning: '', info: '' };
        toast.innerHTML = `${message}`;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ═══════════════════════════════════════════
    // THEME MANAGEMENT
    // ═══════════════════════════════════════════

    function initTheme() {
        const savedTheme = localStorage.getItem('spark_theme') || 'dark';
        applyTheme(savedTheme);

        const toggleBtn = document.getElementById('btn-theme-toggle');
        if (toggleBtn) {
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

        if (typeof GrafikModulu !== 'undefined' && GrafikModulu.updateTheme) {
            GrafikModulu.updateTheme(themeName === 'light');
        }

        if (state.currentScreen) {
            navigate(state.currentScreen);
        }

        const modal = document.getElementById('power-triangle-modal');
        if (modal && modal.style.display === 'flex' && typeof TopolojiModulu !== 'undefined' && state.selectedTrafoId) {
            TopolojiModulu.openPowerTriangleModal(state.selectedTrafoId);
        }
    }

    function toggleModelDetail() {
        const el = document.getElementById('model-info-detail');
        const hint = document.getElementById('model-info-hint');
        if (!el) return;
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'block' : 'none';
        if (hint) {
            hint.innerHTML = isHidden ? 'Detayı Gizle ▲' : 'Detay ve Açıklamayı Göster ▼';
        }
    }

    // ═══════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════

    function updateDashboardUI(ozetler) {
        let guvenliSayisi = 0, dikkatSayisi = 0, riskliSayisi = 0, tehlikeliSayisi = 0;
        let toplamAktif = 0, toplamEnduktif = 0, toplamKapasitif = 0;

        ozetler.forEach(({ ozet }) => {
            if (!ozet) return;
            toplamAktif     += ozet.toplamAktif;
            toplamEnduktif  += ozet.toplamEnduktif;
            toplamKapasitif += ozet.toplamKapasitif;

            // Her iki risk türünden en kötüsünü al
            const _RISK_SIRA = { guvenli: 0, normal: 0, dikkat: 1, riskli: 2, tehlikeli: 3 };
            const kapSev = ozet.kapasitifRisk ? ozet.kapasitifRisk.seviye : 'guvenli';
            const endSev = ozet.enduktifRisk  ? ozet.enduktifRisk.seviye  : 'guvenli';
            const sev = (_RISK_SIRA[kapSev] >= _RISK_SIRA[endSev]) ? kapSev : endSev;

            if (sev === 'guvenli' || sev === 'normal') guvenliSayisi++;
            else if (sev === 'dikkat') dikkatSayisi++;
            else if (sev === 'riskli') riskliSayisi++;
            else tehlikeliSayisi++;
        });

        document.getElementById('summary-cards').innerHTML = `
            <div class="summary-card card-total">
                <div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg></div>
                <div class="card-content">
                    <div class="card-value">${ozetler.length}</div>
                    <div class="card-label">Toplam Trafo</div>
                </div>
            </div>
            <div class="summary-card card-safe">
                <div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
                <div class="card-content">
                    <div class="card-value">${guvenliSayisi}</div>
                    <div class="card-label">Güvenli / Normal</div>
                </div>
            </div>
            <div class="summary-card card-warning">
                <div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>
                <div class="card-content">
                    <div class="card-value">${dikkatSayisi}</div>
                    <div class="card-label">Dikkat Durumu</div>
                </div>
            </div>
            <div class="summary-card card-danger">
                <div class="card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></div>
                <div class="card-content">
                    <div class="card-value">${riskliSayisi + tehlikeliSayisi}</div>
                    <div class="card-label">Ceza Riski</div>
                </div>
            </div>
        `;

        // ── Grafikler ──
        GrafikModulu.createDashboardBarChart('chart-dashboard-bar', ozetler);
        GrafikModulu.createEnergyDoughnut('chart-dashboard-doughnut', toplamAktif, toplamEnduktif, toplamKapasitif);

        // ── Dashboard Ay Badge Güncelle ──
        const ayBadge = document.getElementById('dashboard-ay-badge');
        if (ayBadge) ayBadge.textContent = `${AY_ADLARI[state.selectedAy - 1]} ${state.selectedYil}`;

        // ── Trafo Kartları ──
        const gridEl = document.getElementById('trafo-grid');
        if (!gridEl) return;
        gridEl.innerHTML = ozetler.map(({ trafo, ozet, tahminOzet }, idx) => {
            if (!ozet) return '';

            // Her iki risk türünden en kötüsünü genel risk olarak kullan
            const _RISK_SIRA = { guvenli: 0, normal: 0, dikkat: 1, riskli: 2, tehlikeli: 3 };
            const kapRisk = ozet.kapasitifRisk || HesaplamaModulu.riskSeviyesiBelirle(ozet.kapasitifOran || 0, 'kapasitif');
            const endRisk = ozet.enduktifRisk  || HesaplamaModulu.riskSeviyesiBelirle(ozet.enduktifOran  || 0, 'enduktif');
            const risk = (_RISK_SIRA[kapRisk.seviye] >= _RISK_SIRA[endRisk.seviye]) ? kapRisk : endRisk;

            // Mevcut oran gösterimi — her iki oran da gösterilir
            const ratio = Math.min((ozet.kapasitifOran / 20) * 100, 100);
            const limitPos = (15 / 20) * 100;

            const tOran = tahminOzet ? tahminOzet.kapasitifOran : ozet.kapasitifOran;
            const tRisk = tahminOzet ? tahminOzet.kapasitifRisk : risk;
            const tahminIkon = tOran >= 15 ? '🔴' : (tOran >= 12 ? '🟡' : '🟢');
            const tahminEtiket = tOran >= 15 ? 'Ceza Riski!' : (tOran >= 12 ? 'Dikkat' : 'Güvenli');

            return `
                <div class="trafo-card risk-${risk.seviye}" style="animation-delay: ${idx * 0.06}s"
                     onclick="App.navigateToTrafo('${trafo.id}')">
                    <div class="trafo-card-header">
                        <div style="flex: 1; min-width: 0; padding-right: 8px;">
                            <h3 style="margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(trafo.adi)}">
                                ${escapeHTML(trafo.adi)}
                            </h3>
                            <div class="trafo-tip">${trafo.tip ? escapeHTML(trafo.tip) + ' · ' : ''}${escapeHTML(trafo.bolge)}</div>
                        </div>
                        <span class="badge badge-${risk.seviye}" style="flex-shrink: 0; white-space: nowrap;">${risk.ikon || ''} ${risk.etiket || risk.seviye.toUpperCase()}</span>
                    </div>
                    <div class="trafo-card-stats">
                        <div class="trafo-stat">
                            <span class="trafo-stat-label">Kapasitif Oran</span>
                            <span class="trafo-stat-value highlight" style="color:${kapRisk.renk || 'var(--text)'}">
                                %${HesaplamaModulu.formatSayi(ozet.kapasitifOran)}
                            </span>
                        </div>
                        <div class="trafo-stat">
                            <span class="trafo-stat-label">Ay Sonu Tahmini</span>
                            <span class="trafo-stat-value highlight" style="color:${tRisk.renk || 'var(--text)'}">
                                %${HesaplamaModulu.formatSayi(tOran)}
                            </span>
                        </div>
                        <div class="trafo-stat">
                            <span class="trafo-stat-label">Endüktif Oran</span>
                            <span class="trafo-stat-value" style="color:${endRisk.renk || 'var(--text)'}">
                                %${HesaplamaModulu.formatSayi(ozet.enduktifOran)}
                                ${(_RISK_SIRA[endRisk.seviye] >= 2) ? `<span class="badge badge-${endRisk.seviye}" style="font-size:9px;margin-left:4px;">${endRisk.ikon}</span>` : ''}
                            </span>
                        </div>
                        <div class="trafo-stat">
                            <span class="trafo-stat-label">Aktif Enerji</span>
                            <span class="trafo-stat-value">${HesaplamaModulu.formatEnerji(ozet.toplamAktif)}</span>
                        </div>
                    </div>

                    <div class="ratio-meter">
                        <div class="ratio-meter-bar">
                            <div class="ratio-meter-fill" style="width:${ratio}%; background:${risk.renk || 'var(--color-primary)'}"></div>
                            <div class="ratio-meter-limit" style="left:${limitPos}%" data-label="%15"></div>
                        </div>
                    </div>
                    <div class="trafo-card-footer" style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px;" onclick="event.stopPropagation();">
                        <button class="btn btn-sm btn-outline" onclick="App.navigateToTrafo('${trafo.id}')" style="font-size: 11px; padding: 4px 10px;">Detaylar</button>
                        <button class="btn btn-sm btn-primary" onclick="if(typeof TopolojiModulu !== 'undefined') TopolojiModulu.openPowerTriangleModal('${trafo.id}')" style="font-size: 11px; padding: 4px 10px;">Güç Üçgeni Analizi</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ═══════════════════════════════════════════
    // MANEVRA ÖNERİ & KARAR DESTEK MODÜLÜ
    // ═══════════════════════════════════════════

    // Module-level state for simulation flow
    let _simCurrentData = null;
    let _cachedAssets = null;
    let _cachedSuggestions = null;

    async function renderManevra() {
        await loadManevraAssets();
        await loadManevraSummaryStats();
        bindManevraSubTabs();
        bindManevraCRUDModals();
        bindSimulationModal();

        const btnOneri = document.getElementById('btn-manevra-onerisi-al');
        if (btnOneri && !btnOneri.dataset.bound) {
            btnOneri.dataset.bound = "true";
            btnOneri.addEventListener('click', async () => {
                await fetchAndRenderManevraSuggestions();
            });
        }
    }

    // ─── Sub-Tab Navigation ───
    function bindManevraSubTabs() {
        const nav = document.getElementById('maneuver-subtab-nav');
        if (!nav || nav.dataset.bound) return;
        nav.dataset.bound = "true";

        nav.querySelectorAll('.maneuver-subtab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                nav.querySelectorAll('.maneuver-subtab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.maneuver-tab-content').forEach(tc => tc.classList.remove('active'));
                const tabId = `tab-${btn.dataset.subtab}`;
                const tabEl = document.getElementById(tabId);
                if (tabEl) tabEl.classList.add('active');

                if (btn.dataset.subtab === 'gecmis') {
                    loadManevraHistory();
                }
            });
        });
    }

    // ─── Summary Stats ───
    async function loadManevraSummaryStats() {
        try {
            const assets = await ApiClient.fetchManeuverAssets();
            _cachedAssets = assets;

            const feederCount = document.getElementById('stat-feeder-count');
            const reactorCount = document.getElementById('stat-reactor-count');
            if (feederCount) feederCount.textContent = assets.feeders ? assets.feeders.length : 0;
            if (reactorCount) reactorCount.textContent = assets.reactors ? assets.reactors.length : 0;

            const subtabVarliklar = document.getElementById('subtab-count-varliklar');
            if (subtabVarliklar) subtabVarliklar.textContent = (assets.feeders?.length || 0) + (assets.reactors?.length || 0);

            // History count
            const historyData = await ApiClient.fetchManeuverHistory(1, 0);
            const historyCount = document.getElementById('stat-history-count');
            if (historyCount) historyCount.textContent = historyData.total || 0;

            const subtabGecmis = document.getElementById('subtab-count-gecmis');
            if (subtabGecmis) subtabGecmis.textContent = historyData.total || 0;
        } catch (err) {
            console.error("Manevra özet istatistikleri yüklenirken hata:", err);
        }
    }

    // ─── Asset Tables ───
    async function loadManevraAssets() {
        const feederBody = document.getElementById('feeder-table-body');
        const reactorBody = document.getElementById('reactor-table-body');
        if (!feederBody || !reactorBody) return;

        try {
            const data = _cachedAssets || await ApiClient.fetchManeuverAssets();
            _cachedAssets = data;

            if (data.feeders && data.feeders.length > 0) {
                feederBody.innerHTML = data.feeders.map(f => `
                    <tr>
                        <td><b>${escapeHTML(f.name)}</b> <span class="text-muted" style="font-size:11px;">(${escapeHTML(f.id)})</span></td>
                        <td><span class="badge badge-info">${escapeHTML(f.current_transformer_id)}</span></td>
                        <td><span class="badge">${escapeHTML(f.alternative_transformer_id || '—')}</span></td>
                        <td class="text-right">
                            <div class="load-bar-wrapper">
                                <div class="load-bar-track">
                                    <div class="load-bar-fill ${f.simulated_load_kw > 1000 ? 'high' : (f.simulated_load_kw > 600 ? 'medium' : 'low')}" style="width: ${Math.min(100, f.simulated_load_kw / 20)}%; animation: loadBarGrow 0.8s ease;"></div>
                                </div>
                                <span class="load-bar-label">${f.simulated_load_kw.toLocaleString('tr-TR')}</span>
                            </div>
                        </td>
                    </tr>
                `).join('');
            } else {
                feederBody.innerHTML = '<tr><td colspan="4" class="text-center">Fider bulunamadı.</td></tr>';
            }

            if (data.reactors && data.reactors.length > 0) {
                reactorBody.innerHTML = data.reactors.map(r => `
                    <tr>
                        <td><b>${escapeHTML(r.name)}</b> <span class="text-muted" style="font-size:11px;">(${escapeHTML(r.id)})</span></td>
                        <td><span class="badge badge-info">${escapeHTML(r.current_transformer_id)}</span></td>
                        <td><span class="badge">${escapeHTML(r.alternative_transformer_id || '—')}</span></td>
                        <td class="text-right"><b>${r.capacity_kvar.toLocaleString('tr-TR')}</b> kVAr</td>
                        <td class="text-center"><span class="badge ${r.status === 'active' ? 'badge-success' : 'badge-danger'}">${r.status === 'active' ? 'Aktif' : 'Pasif'}</span></td>
                    </tr>
                `).join('');
            } else {
                reactorBody.innerHTML = '<tr><td colspan="5" class="text-center">Reaktör bulunamadı.</td></tr>';
            }

            // Draw topology diagram
            drawManevraTopology(data);

        } catch (err) {
            console.error("Manevra varlıkları yüklenirken hata:", err);
        }
    }

    // ─── Score Gauge SVG Helper ───
    function renderScoreGauge(score) {
        const r = 22;
        const circ = 2 * Math.PI * r;
        const offset = circ - (score / 100) * circ;
        const color = score >= 70 ? '#c62828' : (score >= 40 ? '#f57c00' : '#2e7d32');
        return `
            <div class="score-gauge">
                <svg width="56" height="56" viewBox="0 0 56 56">
                    <circle class="score-gauge-bg" cx="28" cy="28" r="${r}"/>
                    <circle class="score-gauge-fill" cx="28" cy="28" r="${r}" stroke="${color}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
                </svg>
                <span class="score-gauge-text">${score}</span>
                <span class="score-gauge-label">Puan</span>
            </div>
        `;
    }

    // ─── Suggestions ───
    async function fetchAndRenderManevraSuggestions() {
        const container = document.getElementById('manevra-onerileri-container');
        if (!container) return;

        container.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <div class="loading-spinner" style="width: 24px; height: 24px; border-width: 3px; margin: 0 auto 10px auto;"></div>
                <span>Akıllı Manevra Önerileri Analiz Ediliyor...</span>
            </div>
        `;

        try {
            const suggestions = await ApiClient.fetchManeuverSuggestions();
            _cachedSuggestions = suggestions;

            const suggestionCount = document.getElementById('stat-suggestion-count');
            if (suggestionCount) suggestionCount.textContent = suggestions ? suggestions.length : 0;

            if (!suggestions || suggestions.length === 0) {
                container.innerHTML = `<div style="padding: 16px; border-radius: 8px; background: rgba(46, 125, 50, 0.06); border: 1px solid rgba(46, 125, 50, 0.15); color: var(--text-secondary); font-size: 14px;">Şu anda yapılması gereken kritik bir manevra önerisi bulunmamaktadır. Tüm trafolar dengeli çalışıyor.</div>`;
                return;
            }

            container.innerHTML = suggestions.map((s, idx) => {
                const assetType = s.feeder_id ? 'feeder' : 'reactor';
                const assetId = s.feeder_id || s.reactor_id;
                const impactClass = s.impact === 'Yüksek' ? 'impact-high' : (s.impact === 'Orta' ? 'impact-medium' : 'impact-low');
                const preview = s.simulation_preview || {};

                return `
                <div class="suggestion-card ${idx === 0 ? 'highlight' : ''}" style="animation-delay: ${idx * 0.1}s;">
                    <div class="suggestion-card-top">
                        <div style="display: flex; gap: 16px; align-items: flex-start; flex: 1;">
                            ${renderScoreGauge(s.score || 50)}
                            <div class="suggestion-card-info">
                                <div class="suggestion-card-badges">
                                    <span class="maneuver-badge ${impactClass}">Öncelik: ${escapeHTML(s.impact)}</span>
                                    <span class="maneuver-badge" style="background: rgba(49, 116, 246, 0.1); color: var(--color-primary); border: 1px solid rgba(49, 116, 246, 0.3);">${escapeHTML(s.id)}</span>
                                </div>
                                <h4>${escapeHTML(s.title)}</h4>
                                <p class="suggestion-card-desc">${escapeHTML(s.description)}</p>
                                <div class="suggestion-card-meta">
                                    <span><b>Kaynak:</b> ${escapeHTML(s.source_trafo_name)}</span>
                                    <span><b>Hedef:</b> ${escapeHTML(s.target_trafo_name)}</span>
                                </div>
                            </div>
                        </div>
                        <div class="suggestion-card-actions">
                            <button class="btn-simulate btn-sim-open"
                                    data-asset-type="${assetType}"
                                    data-asset-id="${assetId}"
                                    data-target="${s.target_trafo_id}">Simüle Et</button>
                        </div>
                    </div>
                    ${preview.source_load_before !== undefined ? `
                    <div class="sim-preview">
                        <div class="sim-preview-item">
                            <span class="sim-preview-label">Kaynak Yük</span>
                            <div class="sim-preview-values">
                                <span class="sim-preview-val before">%${preview.source_load_before}</span>
                                <span class="sim-preview-arrow">→</span>
                                <span class="sim-preview-val after ${preview.source_load_after > preview.source_load_before ? 'worse' : ''}">%${preview.source_load_after}</span>
                            </div>
                        </div>
                        <div class="sim-preview-item">
                            <span class="sim-preview-label">Hedef Yük</span>
                            <div class="sim-preview-values">
                                <span class="sim-preview-val before">%${preview.target_load_before}</span>
                                <span class="sim-preview-arrow">→</span>
                                <span class="sim-preview-val after ${preview.target_load_after > 80 ? 'worse' : ''}">%${preview.target_load_after}</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>`;
            }).join('');

            // Bind simulate buttons
            container.querySelectorAll('.btn-sim-open').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const type = btn.dataset.assetType;
                    const id = btn.dataset.assetId;
                    const target = btn.dataset.target;
                    await openSimulationModal(type, id, target);
                });
            });

        } catch (err) {
            console.error("Manevra önerileri çekilirken hata:", err);
            container.innerHTML = `<div style="padding: 16px; border-radius: 8px; background: rgba(198, 40, 40, 0.06); border: 1px solid rgba(198, 40, 40, 0.15); color: var(--color-danger-light); font-size: 14px;">Öneriler alınırken sunucu hatası oluştu.</div>`;
        }
    }

    // ─── Simulation Modal ───
    function bindSimulationModal() {
        const modal = document.getElementById('maneuver-simulation-modal');
        const closeBtn = document.getElementById('btn-close-sim-modal');
        const cancelBtn = document.getElementById('btn-sim-cancel');
        const applyBtn = document.getElementById('btn-sim-apply');

        if (!modal) return;
        if (modal.dataset.bound) return;
        modal.dataset.bound = "true";

        const closeModal = () => { modal.style.display = 'none'; _simCurrentData = null; };
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        if (applyBtn) {
            applyBtn.addEventListener('click', async () => {
                if (!_simCurrentData) return;
                const reason = document.getElementById('sim-reason-input')?.value || '';
                try {
                    applyBtn.disabled = true;
                    applyBtn.textContent = 'Uygulanıyor...';
                    const res = await ApiClient.applyManeuver(
                        _simCurrentData.asset_type,
                        _simCurrentData.asset_id,
                        _simCurrentData.target_trafo_id,
                        reason || null
                    );
                    showToast(res.message || "Manevra başarıyla uygulandı!", "success");
                    closeModal();
                    _cachedAssets = null;
                    await loadManevraAssets();
                    await loadManevraSummaryStats();
                    await fetchAndRenderManevraSuggestions();
                } catch (err) {
                    console.error("Manevra uygulama hatası:", err);
                    showToast("Manevra uygulanamadı: " + err.message, "error");
                } finally {
                    applyBtn.disabled = false;
                    applyBtn.textContent = 'Onayla ve Uygula';
                }
            });
        }
    }

    async function openSimulationModal(assetType, assetId, targetTrafoId) {
        const modal = document.getElementById('maneuver-simulation-modal');
        const body = document.getElementById('sim-modal-body');
        const reasonInput = document.getElementById('sim-reason-input');
        if (!modal || !body) return;

        modal.style.display = 'flex';
        if (reasonInput) reasonInput.value = '';

        body.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div class="loading-spinner" style="width: 24px; height: 24px; border-width: 3px; margin: 0 auto 10px;"></div>
                <span>Simülasyon hesaplanıyor...</span>
            </div>
        `;

        try {
            const sim = await ApiClient.simulateManeuver(assetType, assetId, targetTrafoId);
            _simCurrentData = sim;

            const riskColor = (risk) => {
                if (risk === 'tehlikeli' || risk === 'riskli') return 'var(--color-danger-light)';
                if (risk === 'dikkat') return 'var(--color-warning-light)';
                return 'var(--color-success-light)';
            };
            const riskLabel = (risk) => {
                const map = { tehlikeli: 'Tehlikeli', riskli: 'Riskli', dikkat: 'Dikkat', normal: 'Normal', guvenli: 'Güvenli' };
                return map[risk] || risk;
            };
            const loadBarClass = (ratio) => ratio > 70 ? 'high' : (ratio > 50 ? 'medium' : 'low');

            body.innerHTML = `
                <div class="sim-comparison-grid">
                    <div class="sim-trafo-panel">
                        <h4>Kaynak Trafo</h4>
                        <p class="trafo-subtitle">${escapeHTML(sim.source_trafo_name)}</p>
                        <div class="sim-metric">
                            <span class="sim-metric-label">Yük (kW)</span>
                            <span class="sim-metric-value">${sim.source_load_before.toLocaleString('tr-TR')} → ${sim.source_load_after.toLocaleString('tr-TR')}</span>
                        </div>
                        <div class="sim-metric">
                            <span class="sim-metric-label">Yük Oranı</span>
                            <span class="sim-metric-value">%${sim.source_load_ratio_before} → %${sim.source_load_ratio_after}</span>
                        </div>
                        <div class="sim-metric">
                            <span class="sim-metric-label">Risk Seviyesi</span>
                            <span class="sim-metric-value">
                                <span style="color: ${riskColor(sim.source_risk_before)}">${riskLabel(sim.source_risk_before)}</span>
                                →
                                <span style="color: ${riskColor(sim.source_risk_after)}">${riskLabel(sim.source_risk_after)}</span>
                            </span>
                        </div>
                        <div class="sim-load-bar-large">
                            <div class="load-bar-wrapper">
                                <div class="load-bar-track">
                                    <div class="load-bar-fill ${loadBarClass(sim.source_load_ratio_after)}" style="width: ${Math.min(100, sim.source_load_ratio_after)}%; animation: loadBarGrow 1s ease;"></div>
                                </div>
                                <span class="load-bar-label">%${sim.source_load_ratio_after}</span>
                            </div>
                        </div>
                    </div>

                    <div class="sim-arrow-column">
                        <div class="sim-arrow-icon">→</div>
                        <span class="sim-arrow-label">${escapeHTML(sim.asset_name)}</span>
                    </div>

                    <div class="sim-trafo-panel">
                        <h4>Hedef Trafo</h4>
                        <p class="trafo-subtitle">${escapeHTML(sim.target_trafo_name)}</p>
                        <div class="sim-metric">
                            <span class="sim-metric-label">Yük (kW)</span>
                            <span class="sim-metric-value">${sim.target_load_before.toLocaleString('tr-TR')} → ${sim.target_load_after.toLocaleString('tr-TR')}</span>
                        </div>
                        <div class="sim-metric">
                            <span class="sim-metric-label">Yük Oranı</span>
                            <span class="sim-metric-value">%${sim.target_load_ratio_before} → %${sim.target_load_ratio_after}</span>
                        </div>
                        <div class="sim-metric">
                            <span class="sim-metric-label">Risk Seviyesi</span>
                            <span class="sim-metric-value">
                                <span style="color: ${riskColor(sim.target_risk_before)}">${riskLabel(sim.target_risk_before)}</span>
                                →
                                <span style="color: ${riskColor(sim.target_risk_after)}">${riskLabel(sim.target_risk_after)}</span>
                            </span>
                        </div>
                        <div class="sim-load-bar-large">
                            <div class="load-bar-wrapper">
                                <div class="load-bar-track">
                                    <div class="load-bar-fill ${loadBarClass(sim.target_load_ratio_after)}" style="width: ${Math.min(100, sim.target_load_ratio_after)}%; animation: loadBarGrow 1s ease;"></div>
                                </div>
                                <span class="load-bar-label">%${sim.target_load_ratio_after}</span>
                            </div>
                        </div>
                    </div>
                </div>

                ${sim.reactive_improvement ? `
                <div class="sim-reactive-note">
                    <b>Reaktif Güç Değerlendirmesi:</b> ${escapeHTML(sim.reactive_improvement)}
                </div>
                ` : ''}
            `;
        } catch (err) {
            console.error("Simülasyon hatası:", err);
            body.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--color-danger-light);">Simülasyon yapılırken hata oluştu: ${escapeHTML(err.message)}</div>`;
        }
    }

    // ─── History ───
    async function loadManevraHistory() {
        const tbody = document.getElementById('history-table-body');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 20px;"><div class="loading-spinner" style="width: 20px; height: 20px; border-width: 2px; margin: 0 auto;"></div></td></tr>';

        try {
            const data = await ApiClient.fetchManeuverHistory(50, 0);
            const filterType = document.getElementById('history-filter-type')?.value || '';
            const filterStatus = document.getElementById('history-filter-status')?.value || '';

            let logs = data.logs || [];
            if (filterType) logs = logs.filter(l => l.action_type === filterType);
            if (filterStatus) logs = logs.filter(l => l.status === filterStatus);

            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 30px; color: var(--text-muted);">Filtrelere uygun manevra geçmişi bulunmuyor.</td></tr>';
                return;
            }

            tbody.innerHTML = logs.map(log => {
                const date = log.timestamp ? new Date(log.timestamp).toLocaleString('tr-TR') : '—';
                const typeLabel = log.action_type === 'feeder_transfer' ? 'Fider Aktarımı' : 'Reaktör Değişimi';
                const statusBadge = log.status === 'applied'
                    ? '<span class="maneuver-badge applied">Uygulandı</span>'
                    : '<span class="maneuver-badge rolled-back">Geri Alındı</span>';
                const impactClass = log.impact_level === 'Yüksek' ? 'impact-high' : (log.impact_level === 'Orta' ? 'impact-medium' : 'impact-low');

                return `
                    <tr>
                        <td style="white-space: nowrap;">${date}</td>
                        <td>${typeLabel}</td>
                        <td><b>${escapeHTML(log.asset_name)}</b> <span class="text-muted" style="font-size: 11px;">(${escapeHTML(log.asset_id)})</span></td>
                        <td><span class="badge badge-info">${escapeHTML(log.source_trafo_name)}</span></td>
                        <td><span class="badge badge-info">${escapeHTML(log.target_trafo_name)}</span></td>
                        <td><span class="maneuver-badge ${impactClass}">${escapeHTML(log.impact_level)}</span></td>
                        <td>${statusBadge}</td>
                        <td class="text-center">
                            ${log.status === 'applied' ? `<button class="btn-rollback" data-log-id="${log.id}">Geri Al</button>` : '<span class="text-muted">—</span>'}
                        </td>
                    </tr>
                `;
            }).join('');

            // Bind rollback buttons
            tbody.querySelectorAll('.btn-rollback').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const logId = btn.dataset.logId;
                    if (!confirm('Bu manevrayı geri almak istediğinizden emin misiniz?')) return;
                    try {
                        btn.disabled = true;
                        btn.textContent = '...';
                        const res = await ApiClient.rollbackManeuver(logId);
                        showToast(res.message || "Manevra geri alındı!", "success");
                        _cachedAssets = null;
                        await loadManevraAssets();
                        await loadManevraSummaryStats();
                        await loadManevraHistory();
                    } catch (err) {
                        showToast("Geri alma hatası: " + err.message, "error");
                        btn.disabled = false;
                        btn.textContent = 'Geri Al';
                    }
                });
            });
        } catch (err) {
            console.error("Geçmiş yüklenirken hata:", err);
            tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: var(--color-danger-light);">Geçmiş yüklenirken hata oluştu.</td></tr>';
        }
    }

    // ─── History Filters ───
    (function bindHistoryFilters() {
        document.addEventListener('change', (e) => {
            if (e.target.id === 'history-filter-type' || e.target.id === 'history-filter-status') {
                loadManevraHistory();
            }
        });
    })();

    // ─── Mini Topology Canvas ───
    function drawManevraTopology(assets) {
        const canvas = document.getElementById('maneuver-topology-canvas');
        if (!canvas) return;

        // Resize canvas to its container width
        const wrap = canvas.parentElement;
        if (wrap) {
            canvas.width = wrap.clientWidth || 900;
            canvas.height = 280;
        }

        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        const isLight = document.body.getAttribute('data-theme') === 'light';
        const textColor = isLight ? '#1e293b' : '#e0e0e0';
        const mutedColor = isLight ? '#64748b' : '#757575';
        const lineColor = isLight ? 'rgba(15,23,42,0.15)' : 'rgba(148,163,184,0.15)';
        const activeLineColor = isLight ? '#3174f6' : '#5b8df6';

        // Collect unique trafos from feeders and reactors
        const trafoSet = new Set();
        (assets.feeders || []).forEach(f => { trafoSet.add(f.current_transformer_id); if (f.alternative_transformer_id) trafoSet.add(f.alternative_transformer_id); });
        (assets.reactors || []).forEach(r => { trafoSet.add(r.current_transformer_id); if (r.alternative_transformer_id) trafoSet.add(r.alternative_transformer_id); });
        const trafos = Array.from(trafoSet);

        if (trafos.length === 0) {
            ctx.fillStyle = mutedColor;
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Trafo verisi bulunamadı', W / 2, H / 2);
            return;
        }

        // Layout: Trafos at top row, feeders/reactors at bottom
        const trafoY = 50;
        const feederY = 180;
        const reactorY = 230;
        const trafoSpacing = W / (trafos.length + 1);

        const trafoPositions = {};
        trafos.forEach((tid, i) => {
            const x = trafoSpacing * (i + 1);
            trafoPositions[tid] = x;

            // Draw trafo node
            ctx.fillStyle = activeLineColor;
            ctx.beginPath();
            ctx.arc(x, trafoY, 20, 0, Math.PI * 2);
            ctx.fill();

            // Trafo label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tid.split('-').pop(), x, trafoY);

            ctx.fillStyle = textColor;
            ctx.font = '11px Inter, sans-serif';
            ctx.fillText(tid, x, trafoY - 30);
        });

        // Draw feeders
        const feeders = assets.feeders || [];
        const feederSpacing = feeders.length > 0 ? W / (feeders.length + 1) : W / 2;

        feeders.forEach((f, i) => {
            const fx = feederSpacing * (i + 1);

            // Feeder box
            const boxW = 80, boxH = 28;
            ctx.fillStyle = isLight ? '#e3f2fd' : 'rgba(49, 116, 246, 0.15)';
            ctx.strokeStyle = activeLineColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(fx - boxW / 2, feederY - boxH / 2, boxW, boxH, 6);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const shortName = f.name.length > 12 ? f.name.substring(0, 12) + '…' : f.name;
            ctx.fillText(shortName, fx, feederY);

            // Load label
            ctx.fillStyle = mutedColor;
            ctx.font = '9px Inter, sans-serif';
            ctx.fillText(`${f.simulated_load_kw} kW`, fx, feederY + 20);

            // Connection line: feeder → current trafo (solid)
            if (trafoPositions[f.current_transformer_id] !== undefined) {
                const tx = trafoPositions[f.current_transformer_id];
                ctx.strokeStyle = activeLineColor;
                ctx.lineWidth = 2;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(fx, feederY - boxH / 2);
                ctx.lineTo(tx, trafoY + 20);
                ctx.stroke();
            }

            // Connection line: feeder → alternative trafo (dashed)
            if (f.alternative_transformer_id && trafoPositions[f.alternative_transformer_id] !== undefined) {
                const ax = trafoPositions[f.alternative_transformer_id];
                ctx.strokeStyle = isLight ? 'rgba(15,23,42,0.2)' : 'rgba(148,163,184,0.25)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(fx, feederY - boxH / 2);
                ctx.lineTo(ax, trafoY + 20);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });

        // Draw reactors
        const reactors = assets.reactors || [];
        const reactorSpacing = reactors.length > 0 ? W / (reactors.length + 1) : W / 2;

        reactors.forEach((r, i) => {
            const rx = reactorSpacing * (i + 1);

            // Reactor circle
            const rr = 14;
            ctx.fillStyle = r.status === 'active'
                ? (isLight ? '#fff3e0' : 'rgba(245, 124, 0, 0.15)')
                : (isLight ? '#fafafa' : 'rgba(117,117,117,0.15)');
            ctx.strokeStyle = r.status === 'active' ? '#f57c00' : '#757575';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(rx, reactorY, rr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = r.status === 'active' ? '#f57c00' : '#757575';
            ctx.font = 'bold 9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('R', rx, reactorY);

            // Reactor label
            ctx.fillStyle = mutedColor;
            ctx.font = '9px Inter, sans-serif';
            const shortRName = r.name.length > 14 ? r.name.substring(0, 14) + '…' : r.name;
            ctx.fillText(shortRName, rx, reactorY + 22);

            // Line to current trafo
            if (trafoPositions[r.current_transformer_id] !== undefined) {
                const tx = trafoPositions[r.current_transformer_id];
                ctx.strokeStyle = r.status === 'active' ? '#f57c00' : '#757575';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(rx, reactorY - rr);
                ctx.lineTo(tx, trafoY + 20);
                ctx.stroke();
            }
        });

        // Legend
        ctx.setLineDash([]);
        ctx.fillStyle = mutedColor;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';

        // Solid line legend
        ctx.strokeStyle = activeLineColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(10, H - 16); ctx.lineTo(30, H - 16); ctx.stroke();
        ctx.fillText('Aktif Bağlantı', 34, H - 12);

        // Dashed line legend
        ctx.strokeStyle = mutedColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(140, H - 16); ctx.lineTo(160, H - 16); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText('Alternatif Bağlantı', 164, H - 12);
    }

    // ─── CRUD Modals ───
    function bindManevraCRUDModals() {
        // Feeder modal
        const addFeederBtn = document.getElementById('btn-add-feeder');
        const feederModal = document.getElementById('add-feeder-modal');
        const closeFeederBtn = document.getElementById('btn-close-add-feeder');
        const feederForm = document.getElementById('add-feeder-form');

        if (addFeederBtn && feederModal && !addFeederBtn.dataset.bound) {
            addFeederBtn.dataset.bound = "true";
            addFeederBtn.addEventListener('click', () => {
                populateModalTrafoSelects(['new-feeder-trafo', 'new-feeder-alt-trafo']);
                feederModal.style.display = 'flex';
            });
            closeFeederBtn?.addEventListener('click', () => { feederModal.style.display = 'none'; });
            feederModal.addEventListener('click', (e) => { if (e.target === feederModal) feederModal.style.display = 'none'; });

            feederForm?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = {
                    id: document.getElementById('new-feeder-id').value.trim(),
                    name: document.getElementById('new-feeder-name').value.trim(),
                    current_transformer_id: document.getElementById('new-feeder-trafo').value,
                    alternative_transformer_id: document.getElementById('new-feeder-alt-trafo').value || null,
                    simulated_load_kw: parseFloat(document.getElementById('new-feeder-load').value)
                };
                try {
                    const res = await ApiClient.addFeeder(data);
                    showToast(res.message || "Fider oluşturuldu!", "success");
                    feederModal.style.display = 'none';
                    feederForm.reset();
                    _cachedAssets = null;
                    await loadManevraAssets();
                    await loadManevraSummaryStats();
                } catch (err) {
                    showToast("Fider oluşturulamadı: " + err.message, "error");
                }
            });
        }

        // Reactor modal
        const addReactorBtn = document.getElementById('btn-add-reactor');
        const reactorModal = document.getElementById('add-reactor-modal');
        const closeReactorBtn = document.getElementById('btn-close-add-reactor');
        const reactorForm = document.getElementById('add-reactor-form');

        if (addReactorBtn && reactorModal && !addReactorBtn.dataset.bound) {
            addReactorBtn.dataset.bound = "true";
            addReactorBtn.addEventListener('click', () => {
                populateModalTrafoSelects(['new-reactor-trafo', 'new-reactor-alt-trafo']);
                reactorModal.style.display = 'flex';
            });
            closeReactorBtn?.addEventListener('click', () => { reactorModal.style.display = 'none'; });
            reactorModal.addEventListener('click', (e) => { if (e.target === reactorModal) reactorModal.style.display = 'none'; });

            reactorForm?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = {
                    id: document.getElementById('new-reactor-id').value.trim(),
                    name: document.getElementById('new-reactor-name').value.trim(),
                    current_transformer_id: document.getElementById('new-reactor-trafo').value,
                    alternative_transformer_id: document.getElementById('new-reactor-alt-trafo').value || null,
                    capacity_kvar: parseFloat(document.getElementById('new-reactor-capacity').value),
                    status: document.getElementById('new-reactor-status').value
                };
                try {
                    const res = await ApiClient.addReactor(data);
                    showToast(res.message || "Reaktör oluşturuldu!", "success");
                    reactorModal.style.display = 'none';
                    reactorForm.reset();
                    _cachedAssets = null;
                    await loadManevraAssets();
                    await loadManevraSummaryStats();
                } catch (err) {
                    showToast("Reaktör oluşturulamadı: " + err.message, "error");
                }
            });
        }
    }

    async function populateModalTrafoSelects(selectIds) {
        try {
            const trafolar = await ApiClient.fetchTransformers();
            selectIds.forEach(selectId => {
                const sel = document.getElementById(selectId);
                if (!sel) return;
                const isAlt = selectId.includes('alt');
                sel.innerHTML = isAlt ? '<option value="">— Yok —</option>' : '';
                trafolar.forEach(t => {
                    sel.innerHTML += `<option value="${t.id}">${t.name} (${t.id})</option>`;
                });
            });
        } catch (err) {
            console.error("Trafo listesi yüklenemedi:", err);
        }
    }

    return {
        init,
        navigate,
        navigateToTrafo,
        silVeri,
        switchDashboardView,
        escapeHTML,
        toggleModelDetail,
        renderForecastBanner,
        renderDashboard,
        renderManevra,
        getState: () => state,
    };
})();

// Uygulama başlatma
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof VeriModulu !== 'undefined' && VeriModulu.init) {
        await VeriModulu.init();
    }
    App.init();

    // Chart resolution toggle binding
    document.querySelectorAll('.chart-res-toggle button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const res = e.target.dataset.res;
            const state = App.getState();
            state.chartResolution = res;

            // Re-render specifically the trafo-detay screen if it's the active one
            if (state.currentScreen === 'trafo-detay') {
                App.navigate('trafo-detay');
                // Or we can just call renderTrafoDetay if it was exposed, 
                // but navigate handles everything neatly.
            }
        });
    });
});
