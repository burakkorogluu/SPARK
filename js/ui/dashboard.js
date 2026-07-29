/**
 * SPARK Dashboard Ekranı Modülü (dashboard.js)
 */
const DashboardUI = (() => {
    'use strict';

    const _dashboardCache = new Map();

    async function renderForecastBanner(ozetler) {
        const state = App.getState();
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
                                <br><strong>${riskliTahminTrafolar.length} adet trafoda (${riskliTahminTrafolar.map(t => `${App.escapeHTML(t.trafo.adi)}: <b>%${HesaplamaModulu.formatSayi(t.tahminOzet.kapasitifOran)}</b>`).join(', ')})</strong> ay sonuna kadar %15 yasal ceza sınırının aşılması beklenmektedir! Acil şönt reaktör devreye alma veya yük transferi önerilir.
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
                                <br>Hiçbir trafo %15 ceza sınırını aşmayacak olsa da, <strong>${dikkatTahminTrafolar.length} adet trafoda (${dikkatTahminTrafolar.map(t => `${App.escapeHTML(t.trafo.adi)}: <b>%${HesaplamaModulu.formatSayi(t.tahminOzet.kapasitifOran)}</b>`).join(', ')})</strong> %12 uyarı sınırının üzerinde seyredilecektir.
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

    async function renderManeuverBanner() {
        const container = document.getElementById('dashboard-maneuver-banner');
        if (!container) return;

        try {
            const suggestions = await ApiClient.fetchManeuverSuggestions();
            if (!suggestions || suggestions.length === 0) {
                container.innerHTML = `
                    <div class="alert alert-success" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2);">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                        <div>
                            <strong style="color: var(--color-success);">Sistem Optimizasyonu Tamam</strong>
                            <div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">Şu an için şebekede yapılması gereken aktif bir manevra önerisi bulunmuyor.</div>
                        </div>
                    </div>
                `;
                return;
            }

            // En yüksek öncelikli olanı bul
            const topSuggestion = suggestions[0];
            const isPredictive = topSuggestion.is_predictive;
            const impactColor = isPredictive ? 'var(--color-warning)' : 'var(--color-primary)';
            const bgAlpha = isPredictive ? '0.1' : '0.1';
            
            container.innerHTML = `
                <div class="alert" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; background: rgba(49, 116, 246, 0.1); border: 1px solid rgba(49, 116, 246, 0.3);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <strong style="color: var(--color-primary);">Aktif Manevra Önerisi Var</strong>
                            <span class="badge" style="background: var(--color-primary); color: white; padding: 2px 6px; font-size: 11px; border-radius: 4px;">${suggestions.length} Öneri</span>
                        </div>
                        <div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">
                            <b>${topSuggestion.title}</b>: ${topSuggestion.description}
                        </div>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="App.navigate('maneuver')">Manevra Paneline Git</button>
                </div>
            `;
            
        } catch (e) {
            console.error("Manevra önerileri alınamadı:", e);
            container.innerHTML = '';
        }
    }

    async function renderDashboard() {
        const state = App.getState();
        const cacheKey = `${state.selectedYil}_${state.selectedAy}_${state.selectedYontem}`;
        let ozetler;

        document.getElementById('summary-cards').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Sunucudan analizler ve projeksiyonlar çekiliyor... <span class="loading-spinner"></span></div>';
        const bannerCharts = document.getElementById('dashboard-forecast-banner');
        if (bannerCharts) bannerCharts.innerHTML = '';

        // Manevra önerilerini arka planda getir
        renderManeuverBanner();

        if (_dashboardCache.has(cacheKey)) {
            ozetler = _dashboardCache.get(cacheKey);
        } else {
            try {
                const hamOzetler = await ApiClient.fetchAnalysisSummary(state.selectedYil, state.selectedAy);
                ozetler = [];
                for (const item of hamOzetler) {
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

                    ozetler.push({ trafo: item.trafo, ozet: enrichedOzet, tahminOzet });
                }

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
        const state = App.getState();
        state.dashboardView = viewName;
        const panelCharts = document.getElementById('dashboard-view-charts');

        if (panelCharts) {
            panelCharts.style.display = viewName === 'charts' ? 'block' : 'none';
        }

        if (viewName === 'charts') {
            renderDashboard();
        }
    }

    function updateDashboardUI(ozetler) {
        const state = App.getState();
        const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        let guvenliSayisi = 0, dikkatSayisi = 0, riskliSayisi = 0, tehlikeliSayisi = 0;
        let toplamAktif = 0, toplamEnduktif = 0, toplamKapasitif = 0;

        ozetler.forEach(({ ozet }) => {
            if (!ozet) return;
            toplamAktif     += ozet.toplamAktif;
            toplamEnduktif  += ozet.toplamEnduktif;
            toplamKapasitif += ozet.toplamKapasitif;

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

        if (typeof GrafikModulu !== 'undefined') {
            GrafikModulu.createDashboardBarChart('chart-dashboard-bar', ozetler);
        }

        const ayBadge = document.getElementById('dashboard-ay-badge');
        if (ayBadge) ayBadge.textContent = `${AY_ADLARI[state.selectedAy - 1]} ${state.selectedYil}`;

        const gridEl = document.getElementById('trafo-grid');
        if (!gridEl) return;
        gridEl.innerHTML = ozetler.map(({ trafo, ozet, tahminOzet }, idx) => {
            if (!ozet) return '';

            const _RISK_SIRA = { guvenli: 0, normal: 0, dikkat: 1, riskli: 2, tehlikeli: 3 };
            const kapRisk = ozet.kapasitifRisk || HesaplamaModulu.riskSeviyesiBelirle(ozet.kapasitifOran || 0, 'kapasitif');
            const endRisk = ozet.enduktifRisk  || HesaplamaModulu.riskSeviyesiBelirle(ozet.enduktifOran  || 0, 'enduktif');
            const risk = (_RISK_SIRA[kapRisk.seviye] >= _RISK_SIRA[endRisk.seviye]) ? kapRisk : endRisk;

            const ratio = Math.min((ozet.kapasitifOran / 20) * 100, 100);
            const limitPos = (15 / 20) * 100;

            const tOran = tahminOzet ? tahminOzet.kapasitifOran : ozet.kapasitifOran;
            const tRisk = tahminOzet ? tahminOzet.kapasitifRisk : risk;

            return `
                <div class="trafo-card risk-${risk.seviye}" style="animation-delay: ${idx * 0.06}s"
                     onclick="App.navigateToTrafo('${trafo.id}')">
                    <div class="trafo-card-header">
                        <div style="flex: 1; min-width: 0; padding-right: 8px;">
                            <h3 style="margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${App.escapeHTML(trafo.adi)}">
                                ${App.escapeHTML(trafo.adi)}
                            </h3>
                            <div class="trafo-tip">${trafo.tip ? App.escapeHTML(trafo.tip) + ' · ' : ''}${App.escapeHTML(trafo.bolge)}</div>
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

    function clearCache() {
        _dashboardCache.clear();
    }

    return {
        renderDashboard,
        renderForecastBanner,
        switchDashboardView,
        updateDashboardUI,
        clearCache
    };
})();
