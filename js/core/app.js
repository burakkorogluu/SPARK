// ============================================
// app.js - Ana Uygulama Mantığı
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const App = (() => {
    'use strict';

    // ─── Sabitler ───
    const AY_ADLARI = [
        'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
        'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'
    ];
    const GUN_ADLARI = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
    const GUN_KISA = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];

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
        
        while(cur.getFullYear() > 2025 || (cur.getFullYear() === 2025 && cur.getMonth() >= 0)) {
            const val = `${cur.getFullYear()}-${(cur.getMonth()+1).toString().padStart(2, '0')}`;
            const text = `${AY_ADLARI[cur.getMonth()]} ${cur.getFullYear()}`;
            options.push({val, text});
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

    function renderForecastBanner(ozetler) {
        const currentKey = `${state.selectedYil}-${state.selectedAy}-${state.selectedYontem}`;
        
        if (!ozetler) {
            if (state.lastOzetler && state.lastOzetlerKey === currentKey) {
                ozetler = state.lastOzetler;
            } else {
                const hamOzetler = HesaplamaModulu.tumTrafoOzetleri(state.selectedYil, state.selectedAy);
                ozetler = hamOzetler.map(({ trafo, ozet }) => {
                    if (!ozet) return { trafo, ozet: null, tahminOzet: null };
                    let tahminOzet = null;
                    try {
                        if (typeof TahminModulu !== 'undefined') {
                            const tSonuc = TahminModulu.aySonuTahminiYap(trafo.id, state.selectedYil, state.selectedAy, state.selectedYontem || 'ensemble');
                            if (tSonuc && tSonuc.tumVeriler) {
                                tahminOzet = HesaplamaModulu.aylikOzetHesapla(tSonuc.tumVeriler);
                            }
                        }
                    } catch (e) {
                        console.warn('Tahmin hatası:', e);
                    }
                    return { trafo, ozet, tahminOzet };
                });
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
                                <br>🎉 Tüm trafoların ay sonuna kadar hem %15 yasal ceza sınırının hem de %12 uyarı eşiğinin çok altında kalarak konforlu bir şekilde ayı tamamlaması bekleniyor.
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
        form?.addEventListener('submit', (e) => {
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
            if(typeof TahminModulu !== 'undefined') TahminModulu.clearCache();
                _dashboardCache.clear();
                VeriModulu.veriEkle({
                trafoId,
                tarih,
                aktifEnerji: aktif,
                enduktifEnerji: enduktif,
                kapasitifEnerji: kapasitif,
                haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                tatil: false,
            });

            showToast('Veri başarıyla kaydedildi!', 'success');
            form.reset();
            renderVeriTablosu();
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
                        data.forEach(m => {
                            const d = new Date(m.timestamp);
                            VeriModulu.veriEkle({
                                trafoId: m.transformer_id,
                                tarih: m.timestamp.replace('T', ' '),
                                aktifEnerji: m.active_kwh,
                                enduktifEnerji: m.inductive_kvarh,
                                kapasitifEnerji: m.capacitive_kvarh,
                                haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                                tatil: false,
                            });
                        });
                        
                        if(typeof TahminModulu !== 'undefined') TahminModulu.clearCache();
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
                if(typeof TahminModulu !== 'undefined') TahminModulu.clearCache();
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
        const filterTrafo = document.getElementById('table-trafo-filter')?.value || '';
        const startDateStr = document.getElementById('table-date-start')?.value;
        const endDateStr = document.getElementById('table-date-end')?.value;
        let veriler;

        if (filterTrafo) {
            veriler = VeriModulu.getAylikVeriler(filterTrafo, state.selectedYil, state.selectedAy);
        } else {
            veriler = [...VeriModulu.getTumVeriler()];
        }

        // Apply Date Filters
        if (startDateStr) {
            veriler = veriler.filter(v => v.tarih.substring(0, 10) >= startDateStr);
        }
        if (endDateStr) {
            veriler = veriler.filter(v => v.tarih.substring(0, 10) <= endDateStr);
        }

        // Sort by date descending
        veriler.sort((a, b) => b.tarih.localeCompare(a.tarih));

        // Pagination calculations
        const totalRows = veriler.length;
        const totalRowsEl = document.getElementById('table-total-rows');
        if (totalRowsEl) totalRowsEl.textContent = totalRows;

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
                        <button class="btn btn-sm btn-ghost" onclick="App.silVeri('${v.trafoId}','${v.tarih}')">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function silVeri(trafoId, tarih) {
        VeriModulu.veriSil(trafoId, tarih);
        if(typeof TahminModulu !== 'undefined') TahminModulu.clearCache();
        _dashboardCache.clear();
        showToast('Veri silindi.', 'info');
        renderVeriTablosu();
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
                <div class="dc-label">Ay Sonu Tahmini <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">(${tahminSonucu.modelBilgi ? (tahminSonucu.modelBilgi.adi.split(' ')[1] || 'Model') : 'Ensemble'})</span></div>
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

        if (!tahminSonucu.tamamlanmis && tahminSonucu.tahminVeriler.length > 0) {
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
                <div class="dc-unit">puan (${bilgi.adi.split(' ')[1] || 'Model'})</div>
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
            resultText = `🎉 Mükemmel! ${SenaryoModulu.SENARYO_TURLERI[senaryoTuru].adi} müdahalesi ile kapasitif oran %${HesaplamaModulu.formatSayi(karsilastirma.kapasitifOranSenaryo)} seviyesine düşürüldü ve %15 ceza sınırının altına inildi! (${tasarrufKap > 0 ? tasarrufKap + ' kVArh reaktif yük sönümlendi' : eklenenAktif + ' kWh aktif yük dengelendi'})`;
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

        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        toast.innerHTML = `<span>${icons[type] ?? 'ℹ️'}</span> ${message}`;

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
            toplamAktif += ozet.toplamAktif;
            toplamEnduktif += ozet.toplamEnduktif;
            toplamKapasitif += ozet.toplamKapasitif;

            const sev = ozet.kapasitifRisk.seviye;
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
            const risk = ozet.kapasitifRisk;
            const ratio = Math.min((ozet.kapasitifOran / 20) * 100, 100);
            const limitPos = (15 / 20) * 100; // %15 sınırın bar üzerindeki pozisyonu

            const tOran = tahminOzet ? tahminOzet.kapasitifOran : ozet.kapasitifOran;
            const tRisk = tahminOzet ? tahminOzet.kapasitifRisk : risk;
            const tahminIkon = tOran >= 15 ? '🔴' : (tOran >= 12 ? '🟡' : '🟢');
            const tahminEtiket = tOran >= 15 ? 'Ceza Riski!' : (tOran >= 12 ? 'Dikkat' : 'Güvenli');

            return `
                <div class="trafo-card risk-${risk.seviye}" style="animation-delay: ${idx * 0.06}s"
                     onclick="App.navigateToTrafo('${trafo.id}')">
                    <div class="trafo-card-header">
                        <div>
                            <h3>${escapeHTML(trafo.adi)} <span class="badge badge-${tRisk.seviye}" style="margin-left:8px; font-size:10px;">${tahminEtiket}</span></h3>
                            <div class="trafo-tip">${escapeHTML(trafo.tip)} · ${escapeHTML(trafo.bolge)}</div>
                        </div>
                        <span class="badge badge-${risk.seviye}">${risk.ikon || ''} ${risk.etiket || risk.seviye.toUpperCase()}</span>
                    </div>
                    <div class="trafo-card-stats">
                        <div class="trafo-stat">
                            <span class="trafo-stat-label">Mevcut Oran</span>
                            <span class="trafo-stat-value highlight" style="color:${risk.renk || 'var(--text)'}">
                                %${HesaplamaModulu.formatSayi(ozet.kapasitifOran)}
                            </span>
                        </div>
                        <div class="trafo-stat">
                            <span class="trafo-stat-label">Ay Sonu Tahmini</span>
                            <span class="trafo-stat-value highlight" style="color:${tRisk.renk || 'var(--text)'}">
                                %${HesaplamaModulu.formatSayi(tOran)}
                                <span style="font-size: 13px; margin-left: 2px;" title="${tahminEtiket}">${tahminIkon}</span>
                            </span>
                        </div>
                        <div class="trafo-stat">
                            <span class="trafo-stat-label">Endüktif Oran</span>
                            <span class="trafo-stat-value">
                                %${HesaplamaModulu.formatSayi(ozet.enduktifOran)}
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
