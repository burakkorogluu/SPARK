/**
 * SPARK Tahmin ve Senaryo Ekranı Modülü (forecast_ui.js)
 */
const ForecastUI = (() => {
    'use strict';

    async function renderTahmin() {
        const state = App.getState();
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
                <div class="dc-unit">puan (${App.yontemEtiketiGetir(bilgi.adi)})</div>
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
            if (typeof GrafikModulu !== 'undefined') {
                GrafikModulu.createCumulativeLineChart(
                    'chart-tahmin-line',
                    kumulatif,
                    tahmin.tahminVeriler,
                    HesaplamaModulu.SINIRLAR.kapasitif
                );
            }
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
            const labelEl = document.getElementById('senaryo-miktar-label');
            const descEl = document.getElementById('senaryo-aciklama');
            if (labelEl) labelEl.textContent = turInfo.etiketMiktar;
            if (descEl) descEl.textContent = turInfo.aciklama;
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
        const state = App.getState();
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
            App.showToast('Lütfen geçerli bir tarih ve miktar girin.', 'error');
            return;
        }

        try {
            const tahmin = await TahminModulu.aySonuTahminiYap(trafoId, state.selectedYil, state.selectedAy, yontem);
            const orijinalVeriler = tahmin.tumVeriler;
            const senaryoluVeriler = SenaryoModulu.senaryoUygula(orijinalVeriler, senaryoTuru, baslangicTarihi, miktar);
            const karsilastirma = SenaryoModulu.senaryoKarsilastir(orijinalVeriler, senaryoluVeriler);

            if (!karsilastirma) {
                App.showToast('Karşılaştırma yapılamadı.', 'error');
                return;
            }

            const sonucEl = document.getElementById('senaryo-sonuc');
            if (sonucEl) sonucEl.style.display = '';

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

            const compEl = document.getElementById('senaryo-karsilastirma');
            if (compEl) {
                compEl.innerHTML = `
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
            }

            if (typeof GrafikModulu !== 'undefined') {
                GrafikModulu.createScenarioChart(
                    'chart-senaryo-line',
                    orijinalVeriler,
                    senaryoluVeriler,
                    HesaplamaModulu.SINIRLAR.kapasitif
                );
            }

        } catch (e) {
            App.showToast('Senaryo hatası: ' + e.message, 'error');
        } finally {
            if (kullaniciTetikledi) {
                const btn = document.getElementById('btn-senaryo-calistir');
                if (btn) btn.innerHTML = 'Senaryoyu Uygula ve Test Et';
            }
            if (sonucEl) {
                sonucEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
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

    return {
        renderTahmin,
        setupSenaryoForm,
        runSenaryo,
        toggleModelDetail
    };
})();
