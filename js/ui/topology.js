// ============================================
// topology.js - Şebeke Topolojisi & SCADA Tek Hat Şeması
// Reaktif Güç Takip ve Analiz Sistemi (SPARK)
// ============================================

const TopolojiModulu = (() => {
    'use strict';

    // ─── Güvenlik (XSS Koruması) ───
    const escapeHTML = typeof App !== 'undefined' ? App.escapeHTML : (str => str);

    let isInit = false;
    let currentAy = 7;
    let currentYil = 2025;

    function init() {
        if (isInit) return;

        // Ay seçimi dinleyicisi
        const aySelect = document.getElementById('topoloji-ay-select');
        if (aySelect) {
            aySelect.addEventListener('change', (e) => {
                currentAy = parseInt(e.target.value, 10);
                render();
            });
        }

        // Akış hızı butonu
        const hizBtn = document.getElementById('btn-topoloji-hiz');
        const scadaBoard = document.getElementById('scada-board');
        if (hizBtn && scadaBoard) {
            hizBtn.addEventListener('click', () => {
                scadaBoard.classList.toggle('fast-flow');
                const isFast = scadaBoard.classList.contains('fast-flow');
                hizBtn.textContent = isFast ? 'Hızlı Akış: Açık (x2)' : 'Hızlı Akış: Kapalı';
                hizBtn.classList.toggle('btn-primary', isFast);
                hizBtn.classList.toggle('btn-outline', !isFast);
            });
        }

        // Tüm trafoları özetle butonu
        const analizAllBtn = document.getElementById('btn-topoloji-analiz-all');
        if (analizAllBtn) {
            analizAllBtn.addEventListener('click', () => {
                if(typeof HesaplamaModulu !== 'undefined') {
                    const appState = App.getState();
                    const ozetler = HesaplamaModulu.tumTrafoOzetleri(appState.selectedYil, appState.selectedAy);
                    if (ozetler && Object.keys(ozetler).length > 0) {
                        const sorted = Object.entries(ozetler).sort((a,b) => b[1].kapasitifOran - a[1].kapasitifOran);
                        openPowerTriangleModal(sorted[0][0]);
                        return;
                    }
                }
                openPowerTriangleModal('UMR-TRB'); // Veri yoksa varsayılan
            });
        }

        // Modal kapatma butonları
        const closeBtn = document.getElementById('btn-close-power-modal');
        const modalOverlay = document.getElementById('power-triangle-modal');
        if (closeBtn && modalOverlay) {
            closeBtn.addEventListener('click', closeModal);
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) closeModal();
            });
        }

        // ESC tuşu ile modal kapatma (Keyboard Listener)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });

        isInit = true;
    }

    function closeModal() {
        const modalOverlay = document.getElementById('power-triangle-modal');
        if (modalOverlay) modalOverlay.style.display = 'none';
    }

    function render() {
        if (!isInit) init();

        // Uygulama global durumundan yılı ve ayı al
        if (typeof App !== 'undefined' && App.getState) {
            const appState = App.getState();
            if (appState.selectedYil) currentYil = appState.selectedYil;
            if (appState.selectedAy) currentAy = appState.selectedAy;
        }

        const aySelect = document.getElementById('topoloji-ay-select');
        if (aySelect && parseInt(aySelect.value, 10) !== currentAy) {
            aySelect.value = currentAy;
        }

        const trafolar = VeriModulu.getTrafolar();
        
        // Önce DOM üzerinde tüm bölge (6 Trafo Merkezi) ve trafo kartlarının (7 Trafo) var olduğundan emin ol
        buildSubstationGrid(trafolar);

        let genelAktif = 0;
        let genelKapasitif = 0;
        let genelEnduktif = 0;
        let enKritikRiskSeviye = 'guvenli';

        // Her trafo için ay verilerini hesapla ve kartlarını güncelle
        trafolar.forEach((trafo) => {
            const veriler = VeriModulu.getAylikVeriler(trafo.id, currentYil, currentAy);
            const ozet = HesaplamaModulu.aylikOzetHesapla(veriler);

            if (ozet) {
                genelAktif += ozet.toplamAktif;
                genelKapasitif += ozet.toplamKapasitif;
                genelEnduktif += ozet.toplamEnduktif;

                // En kötü risk durumunu takibe al
                if (ozet.kapasitifRisk.seviye === 'tehlikeli' || ozet.kapasitifRisk.seviye === 'riskli') {
                    enKritikRiskSeviye = 'riskli';
                } else if (ozet.kapasitifRisk.seviye === 'dikkat' && enKritikRiskSeviye !== 'riskli') {
                    enKritikRiskSeviye = 'dikkat';
                }
            }

            renderTrafoCard(trafo, ozet, ozet ? ozet.gunSayisi : (veriler ? Math.round(veriler.length/24) : 0));
        });

        // Üst Özet Kartlarını Güncelle
        const totalAktifEl = document.getElementById('scada-total-aktif');
        const totalKapasitifEl = document.getElementById('scada-total-kapasitif');
        const systemOranEl = document.getElementById('scada-system-oran');
        const systemDurumEl = document.getElementById('scada-system-durum');

        if (totalAktifEl) totalAktifEl.textContent = `${(genelAktif / 1000).toFixed(1)} MWh`;
        if (totalKapasitifEl) totalKapasitifEl.textContent = `${(genelKapasitif / 1000).toFixed(1)} MVArh`;

        const sistemKapasitifOran = genelAktif > 0 ? (genelKapasitif / genelAktif) * 100 : 0;
        if (systemOranEl) systemOranEl.textContent = `%${sistemKapasitifOran.toFixed(2)}`;

        if (systemDurumEl) {
            if (enKritikRiskSeviye === 'riskli') {
                systemDurumEl.innerHTML = `<span style="color: #ef4444; font-weight: 800;">🔴 RİSKLİ (Ceza Sınırında)</span>`;
            } else if (enKritikRiskSeviye === 'dikkat') {
                systemDurumEl.innerHTML = `<span style="color: #f59e0b; font-weight: 800;">🟡 DİKKAT (Yakın Takip)</span>`;
            } else {
                systemDurumEl.innerHTML = `<span style="color: #10b981; font-weight: 800;">🟢 GÜVENLİ (Normal)</span>`;
            }
        }

        if (typeof App !== 'undefined' && App.renderForecastBanner) {
            App.renderForecastBanner();
        }
    }

    function buildSubstationGrid(trafolar) {
        const gridEl = document.getElementById('scada-substations-grid');
        const feedersEl = document.getElementById('scada-main-feeders');
        if (!gridEl || !feedersEl) return;

        // Bölgeye göre trafoları grupla
        const bolgeMap = {};
        trafolar.forEach(t => {
            const b = t.bolge || 'Diğer';
            if (!bolgeMap[b]) bolgeMap[b] = [];
            bolgeMap[b].push(t);
        });

        // Eğer zaten oluşturulduysa ve trafo sayısı/bölge sayısı değişmediyse tekrar DOM yapısını bozma
        const mevcutKolSayisi = gridEl.querySelectorAll('.scada-substation').length;
        if (mevcutKolSayisi === Object.keys(bolgeMap).length && gridEl.querySelectorAll('.scada-trafo-card').length === trafolar.length) {
            return;
        }

        gridEl.innerHTML = '';
        feedersEl.innerHTML = '';

        const bolgeIkonlari = {
            'Ümraniye': '🏙️',
            'Kartal': '⚓',
            'Merkez': '🏢',
            'Sanayi': '🏭',
            'Sahil': '🏖️',
            'Kuzey': '🧭',
            'Doğu': '🌅',
            'Batı': '🌆'
        };

        Object.keys(bolgeMap).forEach((bolge) => {
            // Besleme hattı
            const feeder = document.createElement('div');
            feeder.className = 'feeder-line';
            feeder.innerHTML = '<div class="flow-particle"></div>';
            feedersEl.appendChild(feeder);

            // Substation kolu
            const subEl = document.createElement('div');
            subEl.className = `scada-substation col-${bolge.toLowerCase()}`;
            
            const ikon = bolgeIkonlari[bolge] || '';
            subEl.innerHTML = `
                <div class="substation-bus-bar">
                    <span>${ikon} ${escapeHTML(bolge)} TM (154 / 33.1 kV Dağıtım Barası)</span>
                </div>
                <div class="transformers-container">
                    ${bolgeMap[bolge].map(trafo => `
                        <div class="scada-trafo-card" data-trafo-id="${trafo.id}">
                            <div class="trafo-card-top">
                                <div class="trafo-title-area">
                                    <h4>${escapeHTML(trafo.adi)}</h4>
                                    <span>${escapeHTML(trafo.tip)} • ${trafo.kapasite} MVA</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            gridEl.appendChild(subEl);
        });
    }

    function renderTrafoCard(trafo, ozet, gunSayisi) {
        const cardEl = document.querySelector(`.scada-trafo-card[data-trafo-id="${trafo.id}"]`);
        if (!cardEl) return;

        if (!ozet) {
            cardEl.innerHTML = `<div class="trafo-card-top"><h4>${escapeHTML(trafo.adi)}</h4><span>Veri Yok</span></div>`;
            return;
        }

        // Eski durum sınıflarını temizle
        cardEl.classList.remove('status-guvenli', 'status-dikkat', 'status-riskli', 'status-tehlikeli');
        cardEl.classList.add(`status-${ozet.kapasitifRisk.seviye}`);

        // Progress bar genişliği (maks %20 referans alınır)
        const barYuzde = Math.min(100, (ozet.kapasitifOran / 20) * 100);

        cardEl.innerHTML = `
            <div class="trafo-card-top">
                <div class="trafo-title-area">
                    <h4>${escapeHTML(trafo.adi)}</h4>
                    <span>${escapeHTML(trafo.tip)} • ${trafo.kapasite} MVA</span>
                </div>
                <div class="trafo-badges">
                    <span class="badge" style="background: ${ozet.kapasitifRisk.bg}; color: ${ozet.kapasitifRisk.renk}; border: 1px solid ${ozet.kapasitifRisk.renk}; font-size: 11px;">
                        ${ozet.kapasitifRisk.ikon} ${ozet.kapasitifRisk.etiket}
                    </span>
                    <span class="badge badge-info" style="font-size: 10px;">${gunSayisi} Gün (${ozet.saatSayisi || gunSayisi*24} sa)</span>
                </div>
            </div>

            <div class="trafo-metrics-grid">
                <div class="trafo-metric">
                    <span class="metric-lbl">Aktif Güç</span>
                    <span class="metric-val">${ozet.toplamAktif.toLocaleString('tr-TR')} kWh</span>
                </div>
                <div class="trafo-metric">
                    <span class="metric-lbl">Kapasitif</span>
                    <span class="metric-val" style="color: #ef4444;">${ozet.toplamKapasitif.toLocaleString('tr-TR')} kVArh (${ozet.kapasitifOran.toFixed(1)}%)</span>
                </div>
                <div class="trafo-metric">
                    <span class="metric-lbl">Endüktif</span>
                    <span class="metric-val" style="color: #f59e0b;">${ozet.toplamEnduktif.toLocaleString('tr-TR')} kVArh (${ozet.enduktifOran.toFixed(1)}%)</span>
                </div>
            </div>

            <div class="trafo-meter-section">
                <div class="meter-header">
                    <span>Kapasitif Ceza Sınırı (Maks %15)</span>
                    <b style="color: ${ozet.kapasitifRisk.renk}; font-size: 12px;">%${ozet.kapasitifOran.toFixed(2)}</b>
                </div>
                <div class="meter-bar-track">
                    <div class="meter-bar-fill" style="width: ${barYuzde}%; background: ${ozet.kapasitifRisk.renk};"></div>
                </div>
            </div>

            <button class="btn-trafo-action" onclick="TopolojiModulu.openPowerTriangleModal('${App.escapeHTML(trafo.id)}')">
                <span>Güç Üçgeni Analizi</span>
            </button>
        `;
    }

    function openPowerTriangleModal(trafoId) {
        const trafo = VeriModulu.getTrafo(trafoId);
        if (!trafo) return;

        if (typeof App !== 'undefined') {
            const state = App.getState();
            if (state.selectedYil) currentYil = state.selectedYil;
            if (state.selectedAy) currentAy = parseInt(state.selectedAy, 10);
        }

        const veriler = VeriModulu.getAylikVeriler(trafoId, currentYil, currentAy);
        const ozet = HesaplamaModulu.aylikOzetHesapla(veriler);
        if (!ozet) return;

        const modalOverlay = document.getElementById('power-triangle-modal');
        const titleEl = document.getElementById('modal-trafo-title');
        const badgeEl = document.getElementById('modal-trafo-badge');
        const metricsListEl = document.getElementById('modal-metrics-list');
        const legalEvalEl = document.getElementById('modal-legal-eval');
        const compTextEl = document.getElementById('modal-compensation-text');

        if (titleEl) titleEl.textContent = `${escapeHTML(trafo.adi)} (${trafo.kapasite} MVA) — Güç Üçgeni Analizi`;
        if (badgeEl) {
            badgeEl.textContent = `${ozet.kapasitifRisk.ikon} ${ozet.kapasitifRisk.etiket}`;
            badgeEl.style.background = ozet.kapasitifRisk.bg;
            badgeEl.style.color = ozet.kapasitifRisk.renk;
            badgeEl.style.border = `1px solid ${ozet.kapasitifRisk.renk}`;
        }

        // Görünür Güç S = sqrt(P^2 + (QC - QL)^2)
        const netReaktif = ozet.toplamKapasitif - ozet.toplamEnduktif;
        const gorunurGuc = Math.sqrt(Math.pow(ozet.toplamAktif, 2) + Math.pow(netReaktif, 2));
        const gucFaktoru = ozet.toplamAktif / (gorunurGuc || 1);
        const aciRadyan = Math.acos(Math.min(1, Math.max(-1, gucFaktoru)));
        const aciDerece = aciRadyan * (180 / Math.PI);

        if (metricsListEl) {
            metricsListEl.innerHTML = `
                <div class="metric-row"><span>Aktif Enerji (P):</span> <span style="color: #3b82f6;">${ozet.toplamAktif.toLocaleString('tr-TR')} kWh</span></div>
                <div class="metric-row"><span>Endüktif Reaktif (QL):</span> <span style="color: #f59e0b;">${ozet.toplamEnduktif.toLocaleString('tr-TR')} kVArh (%${ozet.enduktifOran.toFixed(2)})</span></div>
                <div class="metric-row"><span>Kapasitif Reaktif (QC):</span> <span style="color: #ef4444;">${ozet.toplamKapasitif.toLocaleString('tr-TR')} kVArh (%${ozet.kapasitifOran.toFixed(2)})</span></div>
                <div class="metric-row"><span>Bileşke Görünür Güç (S):</span> <span style="color: #10b981;">${Math.round(gorunurGuc).toLocaleString('tr-TR')} kVAh</span></div>
                <div class="metric-row"><span>Güç Faktörü (cos φ):</span> <span>${gucFaktoru.toFixed(4)} (${aciDerece.toFixed(1)}° ${netReaktif >= 0 ? 'Kapasitif' : 'Endüktif'})</span></div>
            `;
        }

        if (legalEvalEl) {
            if (ozet.kapasitifOran > 15.0) {
                legalEvalEl.innerHTML = `<p style="color: #ef4444; font-size: 13px; font-weight: 600;">Trafo %15.0 yasal kapasitif ceza sınırını aşmıştır! Faturalandırma ceza tarifesi üzerinden işlemektedir.</p>`;
            } else if (ozet.kapasitifOran > 12.0) {
                legalEvalEl.innerHTML = `<p style="color: #f59e0b; font-size: 13px; font-weight: 600;">🔶 Trafo %15.0 ceza sınırına çok yaklaşmıştır (Sınır:%15, Mevcut:%${ozet.kapasitifOran.toFixed(2)}). Acil müdahale önerilir.</p>`;
            } else {
                legalEvalEl.innerHTML = `<p style="color: #10b981; font-size: 13px; font-weight: 600;">Trafo yasal sınırlar altındadır (Sınır:%15, Mevcut:%${ozet.kapasitifOran.toFixed(2)}). Kompanzasyon kademeleri stabil çalışıyor.</p>`;
            }
        }

        if (compTextEl) {
            if (ozet.kapasitifOran > 12.0) {
                // Güvenli %10 seviyesine indirmek için gereken şönt reaktör
                const hedefKapasitif = ozet.toplamAktif * 0.10;
                const asiriKapasitif = ozet.toplamKapasitif - hedefKapasitif;
                const gunlukAsiri = Math.round(asiriKapasitif / veriler.length);
                compTextEl.innerHTML = `Trafo gece saatlerinde ve düşük yükte yüksek kapasitif etki göstermektedir. Ceza riskini sıfıra indirmek ve %10 hedef oranına çekmek için şebekeye ay boyunca toplam <b>${Math.round(asiriKapasitif).toLocaleString('tr-TR')} kVArh</b> (günlük ortalama <b>${gunlukAsiri} kVAr</b> sürekli devrede kalacak şekilde) <b>Şönt Reaktör (Endüktif Yük)</b> bağlanmalıdır.`;
            } else {
                compTextEl.innerHTML = `Trafo reaktif oranları ideal aralıktadır. Mevcut yer altı kablo kapasitansı ile sanayi endüktif yüklerinin dengesi korunmakta olup ek reaktör devreye alınmasına gerek yoktur.`;
            }
        }

        // Canvas üzerinde Fazör Vektör Diyagramını çiz
        drawPowerTriangleCanvas(ozet);

        if (modalOverlay) modalOverlay.style.display = 'flex';
    }

    function drawPowerTriangleCanvas(ozet) {
        const canvas = document.getElementById('power-triangle-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);

        const isLight = document.body.getAttribute('data-theme') === 'light';
        const gridColor = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.08)';
        const axisColor = isLight ? 'rgba(15, 23, 42, 0.3)' : 'rgba(148, 163, 184, 0.3)';
        const phiTextColor = isLight ? '#1e293b' : '#cbd5e1';

        // Arka Plan Grid (SCADA Radar Görünümü)
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        for (let x = 0; x <= W; x += 30) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y <= H; y += 30) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        // Başlangıç Noktası (Orijin - Sol Orta)
        const X0 = 60;
        const Y0 = 170;

        // Eksenler (X ve Y)
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(20, Y0); ctx.lineTo(W - 20, Y0); ctx.stroke(); // X ekseni
        ctx.beginPath(); ctx.moveTo(X0, 20); ctx.lineTo(X0, H - 20); ctx.stroke(); // Y ekseni

        // Ölçeklendirme (Aktif güç P sabit ~260px uzunlukta çizilir)
        const P_px = 260;
        // Dinamik ölçekleme: Maksimum dikey taşmayı önle (maksimum izin verilen Y sapması ~135 px)
        const maxOran = Math.max(ozet.enduktifOran, ozet.kapasitifOran, 15);
        const scaleFactor = Math.min(3.5, 135 / (P_px * (maxOran / 100)));
        const QL_px = P_px * (ozet.enduktifOran / 100) * scaleFactor;
        const QC_px = P_px * (ozet.kapasitifOran / 100) * scaleFactor;

        // 1. Yasal %15 Kapasitif Sınır Çizgisi (Kırmızı kesik çizgi - Aşağı yönlü)
        const limitOran = 0.15;
        const limitY_px = P_px * limitOran * scaleFactor;
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(X0, Y0);
        ctx.lineTo(X0 + P_px + 30, Y0 + limitY_px * ((P_px + 30)/P_px));
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText('Yasal %15 Ceza Sınırı', X0 + P_px - 80, Y0 + limitY_px + 18);

        // 2. Aktif Güç Vektörü P (Mavi - Yatay)
        drawArrow(ctx, X0, Y0, X0 + P_px, Y0, '#3b82f6', 3.5);
        ctx.fillStyle = '#3b82f6';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.fillText('Aktif Güç (P)', X0 + P_px / 2 - 30, Y0 - 10);

        // 3. Endüktif Reaktif Güç Vektörü QL (Sarı - Yukarı)
        drawArrow(ctx, X0 + P_px, Y0, X0 + P_px, Y0 - QL_px, '#f59e0b', 2.5);
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(`QL (%${ozet.enduktifOran.toFixed(1)})`, X0 + P_px + 8, Y0 - QL_px / 2);

        // 4. Kapasitif Reaktif Güç Vektörü QC (Kırmızı - Aşağı yönlü)
        drawArrow(ctx, X0 + P_px, Y0, X0 + P_px, Y0 + QC_px, '#ef4444', 3);
        ctx.fillStyle = '#ef4444';
        ctx.fillText(`QC (%${ozet.kapasitifOran.toFixed(1)})`, X0 + P_px + 8, Y0 + QC_px / 2 + 5);

        // 5. Bileşke Görünür Güç Vektörü S (Yeşil - Orijinden uç noktaya)
        const netY = Y0 + (QC_px - QL_px);
        drawArrow(ctx, X0, Y0, X0 + P_px, netY, '#10b981', 3);
        ctx.fillStyle = '#10b981';
        ctx.fillText('Görünür Güç (S)', X0 + P_px / 2 - 20, netY + (netY > Y0 ? 18 : -12));

        // 6. Orijin Açı Yayı (Güç Faktörü Açısı φ)
        ctx.beginPath();
        ctx.arc(X0, Y0, 45, 0, Math.atan2(netY - Y0, P_px), netY < Y0);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = phiTextColor;
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText('φ', X0 + 52, Y0 + (netY > Y0 ? 12 : -6));
    }

    function drawArrow(ctx, fromX, fromY, toX, toY, color, lineWidth) {
        const headlen = 10;
        const angle = Math.atan2(toY - fromY, toX - fromX);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    return {
        init,
        render,
        openPowerTriangleModal,
        closeModal,
    };
})();

window.TopolojiModulu = TopolojiModulu;
