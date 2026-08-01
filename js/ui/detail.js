/**
 * SPARK Trafo Detay Ekranı Modülü (detail.js)
 */
const DetailUI = (() => {
    'use strict';

    const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

    async function renderTrafoDetay() {
        const state = App.getState();
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

        const yontem = document.getElementById('detay-yontem-select')?.value || state.selectedYontem || 'ensemble';
        const selYontem = document.getElementById('detay-yontem-select');
        if (selYontem && selYontem.value !== yontem) selYontem.value = yontem;

        document.getElementById('detay-summary').innerHTML = '<p class="text-muted">Hesaplanıyor... <span class="loading-spinner"></span></p>';

        try {
            const tahminSonucu = await TahminModulu.aySonuTahminiYap(trafoId, yil, ay, yontem);
            const tahminOzet = HesaplamaModulu.aylikOzetHesapla(tahminSonucu.tumVeriler);
            const tahminOranStr = tahminOzet ? HesaplamaModulu.formatSayi(tahminOzet.kapasitifOran) : '—';
            const tahminRisk = tahminOzet ? HesaplamaModulu.riskSeviyesiBelirle(tahminOzet.kapasitifOran, 'kapasitif') : null;

            // Özet Kartlar
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
                <div class="dc-label">Ay Sonu Tahmini <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">(${tahminSonucu.modelBilgi ? App.yontemEtiketiGetir(tahminSonucu.modelBilgi.adi) : 'Ensemble'})</span></div>
                <div class="dc-value" style="color:${tahminRisk ? tahminRisk.renk : 'inherit'}">%${tahminOranStr}</div>
                <div class="dc-unit">${tahminRisk ? `<span class="badge badge-${tahminRisk.seviye}">${tahminRisk.ikon} ${tahminRisk.etiket}</span>` : ''}</div>
            </div>
            <div class="detay-card">
                <div class="dc-label">Veri Süresi</div>
                <div class="dc-value text-info">${ozet.gunSayisi} Gün</div>
                <div class="dc-unit">${ozet.saatSayisi} saat kayıt (${TahminModulu.aydakiGunSayisi(yil, ay)} günden)</div>
            </div>
            `;

            // Grafik
            const tahminBadge = document.getElementById('detay-tahmin-badge');
            const barTahminBadge = document.getElementById('detay-bar-tahmin-badge');
            document.querySelectorAll('.chart-res-toggle button').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.res === state.chartResolution);
            });
            const barTitle = document.getElementById('detay-bar-title');
            if (barTitle) {
                barTitle.textContent = state.chartResolution === 'hourly' ? 'Saatlik Kapasitif Oran Dağılımı (Ayrık)' : 'Günlük Kapasitif Oran Dağılımı (Ayrık)';
            }

            if (tahminSonucu.tahminVeriler.length > 0) {
                if (tahminBadge) tahminBadge.style.display = '';
                if (barTahminBadge) barTahminBadge.style.display = '';
                if (typeof GrafikModulu !== 'undefined') {
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
                }
            } else {
                if (tahminBadge) tahminBadge.style.display = 'none';
                if (barTahminBadge) barTahminBadge.style.display = 'none';
                if (typeof GrafikModulu !== 'undefined') {
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
            }

            // Uyarı Kutusu
            const uyariEl = document.getElementById('detay-uyari');
            if (uyariEl) {
                const uyariMesaj = HesaplamaModulu.uyariMesajiUret(
                    App.escapeHTML(trafo.adi),
                    ozet.kapasitifOran,
                    ozet.enduktifOran || 0,
                    tahminOzet ? tahminOzet.kapasitifOran : null,
                    tahminOzet ? tahminOzet.enduktifOran : null
                );
                uyariEl.style.display = '';
                uyariEl.className = `alert-box alert-${ozet.kapasitifRisk.seviye}`;
                uyariEl.innerHTML = uyariMesaj;
            }

            // Günlük Tablo
            const kumulatifler = ozet.kumulatifGunluk;
            const tbody = document.getElementById('detay-table-body');
            if (tbody) {
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
            }
        } catch (e) {
            document.getElementById('detay-summary').innerHTML = `<p class="text-danger">Hata: ${App.escapeHTML(e.message)}</p>`;
        }
    }

    return {
        renderTrafoDetay
    };
})();
