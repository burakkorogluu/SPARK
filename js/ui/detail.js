/**
 * SPARK Trafo Detay Ekranı Modülü (detail.js)
 */
const DetailUI = (() => {
    'use strict';

    const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

    async function renderTrafoDetayInContainer(trafoId, containerEl, resolution = 'daily', yontemOverride = null) {
        const state = App.getState();
        const ay = state.selectedAy;
        const yil = state.selectedYil;

        const trafo = VeriModulu.getTrafo(trafoId);
        if (!trafo) {
            containerEl.innerHTML = '<p class="text-muted">Trafo bulunamadı.</p>';
            return;
        }

        const veriler = VeriModulu.getAylikVeriler(trafoId, yil, ay);
        const ozet = HesaplamaModulu.aylikOzetHesapla(veriler);

        if (!ozet) {
            containerEl.innerHTML = '<p class="text-muted">Bu ay için veri bulunamadı.</p>';
            return;
        }

        // Global yöntem select
        const yontem = yontemOverride || document.getElementById('global-yontem-select')?.value || state.selectedYontem || 'ensemble';

        const existingLineCanvas = containerEl.querySelector('#chart-detay-line-' + trafoId);
        if (!existingLineCanvas) {
            containerEl.innerHTML = '<div style="padding: 20px; text-align: center;">Hesaplanıyor... <span class="loading-spinner"></span></div>';
        }

        try {
            const tahminSonucu = await TahminModulu.aySonuTahminiYap(trafoId, yil, ay, yontem);
            const tahminOzet = HesaplamaModulu.aylikOzetHesapla(tahminSonucu.tumVeriler);
            const tahminOranStr = tahminOzet ? HesaplamaModulu.formatSayi(tahminOzet.kapasitifOran) : '—';
            const tahminRisk = tahminOzet ? HesaplamaModulu.riskSeviyesiBelirle(tahminOzet.kapasitifOran, 'kapasitif') : null;

            // HTML Şablonu
            const html = `

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg);">
                    <!-- Kümülatif Oran Grafiği -->
                    <div class="card chart-card">
                        <div class="card-header" style="justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <h3 style="margin:0; font-size: 14px;">Kümülatif Kapasitif Oran Değişimi</h3>

                            </div>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <select class="chart-yontem-select" onchange="DetailUI.renderTrafoDetayInContainer('${trafoId}', this.closest('.trafo-card-details'), this.closest('.chart-card').querySelector('.chart-res-select').value, this.value)" style="background:var(--bg-card); color:var(--text); border:1px solid var(--border-color); border-radius: 0; padding:2px 5px; font-size:12px;">
                                    <option value="ensemble" ${yontem === 'ensemble' ? 'selected' : ''}>Topluluk</option>
                                    <option value="xgboost" ${yontem === 'xgboost' ? 'selected' : ''}>XGBoost</option>
                                    <option value="randomForest" ${yontem === 'randomForest' ? 'selected' : ''}>RF</option>
                                    <option value="regression" ${yontem === 'regression' ? 'selected' : ''}>Reg</option>
                                    <option value="lightgbm" ${yontem === 'lightgbm' ? 'selected' : ''}>LGBM</option>
                                </select>
                                <select class="chart-res-select" onchange="DetailUI.renderTrafoDetayInContainer('${trafoId}', this.closest('.trafo-card-details'), this.value, this.closest('.chart-card').querySelector('.chart-yontem-select').value)" style="background:var(--bg-card); color:var(--text); border:1px solid var(--border-color); border-radius: 0; padding:2px 5px; font-size:12px;">
                                    <option value="daily" ${resolution === 'daily' ? 'selected' : ''}>Günlük</option>
                                    <option value="hourly" ${resolution === 'hourly' ? 'selected' : ''}>Saatlik</option>
                                </select>
                                <button class="btn-icon" onclick="DetailUI.toggleFullscreen(this)" title="Tam Ekran" style="background:none; border:none; color:var(--text-dim); cursor:pointer;">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                                </button>
                            </div>
                        </div>
                        <div class="chart-container chart-line" style="height: 280px; position:relative; width:100%;">
                            <canvas id="chart-detay-line-${trafoId}"></canvas>
                        </div>
                    </div>

                    <!-- Günlük Ayrık Oran Sütun Grafiği -->
                    <div class="card chart-card">
                        <div class="card-header" style="justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <h3 style="margin:0; font-size: 14px;">Günlük Kapasitif Oran Dağılımı (Ayrık)</h3>

                            </div>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <select class="chart-yontem-select" onchange="DetailUI.renderTrafoDetayInContainer('${trafoId}', this.closest('.trafo-card-details'), this.closest('.chart-card').querySelector('.chart-res-select').value, this.value)" style="background:var(--bg-card); color:var(--text); border:1px solid var(--border-color); border-radius: 0; padding:2px 5px; font-size:12px;">
                                    <option value="ensemble" ${yontem === 'ensemble' ? 'selected' : ''}>Topluluk</option>
                                    <option value="xgboost" ${yontem === 'xgboost' ? 'selected' : ''}>XGBoost</option>
                                    <option value="randomForest" ${yontem === 'randomForest' ? 'selected' : ''}>RF</option>
                                    <option value="regression" ${yontem === 'regression' ? 'selected' : ''}>Reg</option>
                                    <option value="lightgbm" ${yontem === 'lightgbm' ? 'selected' : ''}>LGBM</option>
                                </select>
                                <select class="chart-res-select" onchange="DetailUI.renderTrafoDetayInContainer('${trafoId}', this.closest('.trafo-card-details'), this.value, this.closest('.chart-card').querySelector('.chart-yontem-select').value)" style="background:var(--bg-card); color:var(--text); border:1px solid var(--border-color); border-radius: 0; padding:2px 5px; font-size:12px;">
                                    <option value="daily" ${resolution === 'daily' ? 'selected' : ''}>Günlük</option>
                                    <option value="hourly" ${resolution === 'hourly' ? 'selected' : ''}>Saatlik</option>
                                </select>
                                <button class="btn-icon" onclick="DetailUI.toggleFullscreen(this)" title="Tam Ekran" style="background:none; border:none; color:var(--text-dim); cursor:pointer;">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                                </button>
                            </div>
                        </div>
                        <div class="chart-container chart-bar" style="height: 280px; position:relative; width:100%;">
                            <canvas id="chart-detay-bar-${trafoId}"></canvas>
                        </div>
                    </div>
                </div>


                <!-- Günlük Veri Tablosu -->
                <div class="card mt-lg" style="margin-top: var(--space-lg);">
                    <div class="card-header">
                        <h3 style="margin:0;">Günlük Veri Detayı</h3>
                    </div>
                    <div class="table-wrapper" style="max-height: 400px; overflow-y: auto;">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Tarih</th>
                                    <th>Gün</th>
                                    <th class="text-right">Aktif (kWh)</th>
                                    <th class="text-right">Endüktif (kVArh)</th>
                                    <th class="text-right">Kapasitif (kVArh)</th>
                                    <th class="text-right">Günlük Oran</th>
                                    <th class="text-right">Kümülatif Oran</th>
                                    <th class="text-center">Durum</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${ozet.kumulatifGunluk.map(v => {
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
                                        <td class="text-right" style="color:${risk.renk}; font-weight:600;">%${HesaplamaModulu.formatSayi(v.kumulatifKapasitifOran)}</td>
                                        <td class="text-center"><span class="badge badge-${risk.seviye}" style="font-size:10px">${risk.ikon}</span></td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            const currentExistingLineCanvas = containerEl.querySelector('#chart-detay-line-' + trafoId);
            if (currentExistingLineCanvas) {
                // DOM zaten var. Sadece grafikleri güncelleyelim.
                // select kutularının değerini eşitle
                const selects = containerEl.querySelectorAll('.chart-res-select');
                selects.forEach(sel => sel.value = resolution);
                
                const yontemSelects = containerEl.querySelectorAll('.chart-yontem-select');
                yontemSelects.forEach(sel => sel.value = yontem);

                // Tabloyu güncelle (eğer veri değiştiyse diye)
                const tbody = containerEl.querySelector('tbody');
                if (tbody) {
                    tbody.innerHTML = ozet.kumulatifGunluk.map(v => {
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
                            <td class="text-right" style="color:${risk.renk}; font-weight:600;">%${HesaplamaModulu.formatSayi(v.kumulatifKapasitifOran)}</td>
                            <td class="text-center"><span class="badge badge-${risk.seviye}" style="font-size:10px">${risk.ikon}</span></td>
                        </tr>`;
                    }).join('');
                }
            } else {
                containerEl.innerHTML = html;
            }

            if (typeof GrafikModulu !== 'undefined') {
                GrafikModulu.createCumulativeLineChart(
                    `chart-detay-line-${trafoId}`,
                    resolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                    tahminSonucu.tahminVeriler.length > 0 ? tahminSonucu.tahminVeriler : null,
                    HesaplamaModulu.SINIRLAR.kapasitif,
                    resolution
                );
                GrafikModulu.createDailyBarChart(
                    `chart-detay-bar-${trafoId}`,
                    resolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                    tahminSonucu.tahminVeriler.length > 0 ? tahminSonucu.tahminVeriler : null,
                    HesaplamaModulu.SINIRLAR.kapasitif,
                    resolution
                );
            }

        } catch (e) {
            containerEl.innerHTML = `<p class="text-danger">Hata: ${App.escapeHTML(e.message)}</p>`;
        }
    }

    function toggleFullscreen(btnEl) {
        const cardEl = btnEl.closest('.chart-card');
        
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            // Native Tam Ekrana geç
            if (cardEl.requestFullscreen) {
                cardEl.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
            } else if (cardEl.webkitRequestFullscreen) { /* Safari */
                cardEl.webkitRequestFullscreen();
            }
            
            cardEl.classList.add('fullscreen-mode');
            btnEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3h-3m18-3v3h-3m-18 12v-3h3m12 3v-3h3"></path></svg>';
            
            // ESC tuşu veya native çıkış durumlarını yakalamak için listener
            const fsHandler = () => {
                if (typeof Chart !== 'undefined') {
                    const canvas = cardEl.querySelector('canvas');
                    if (canvas) {
                        const chart = Chart.getChart(canvas);
                        if (chart) chart.resize();
                    }
                }

                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    cardEl.classList.remove('fullscreen-mode');
                    btnEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
                    document.removeEventListener('fullscreenchange', fsHandler);
                    document.removeEventListener('webkitfullscreenchange', fsHandler);
                }
            };
            document.addEventListener('fullscreenchange', fsHandler);
            document.addEventListener('webkitfullscreenchange', fsHandler);
            
        } else {
            // Tam ekrandan çık
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => console.error('Exit fullscreen error:', err));
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    return {
        renderTrafoDetayInContainer,
        toggleFullscreen
    };
})();
