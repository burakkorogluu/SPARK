/**
 * SPARK Raporlama Modülü (report.js)
 * ─────────────────────────────────
 * PDF + Excel export ile yöneticiye sunulabilir aylık rapor üretir.
 */
const RaporlamaUI = (() => {
    'use strict';

    const AY_ADLARI = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];

    const RISK_BADGE = {
        guvenli: { label: 'Güvenli', cls: 'badge-guvenli', hex: '#10b981', bg: 'rgba(16,185,129,0.15)' },
        dikkat: { label: 'Dikkat', cls: 'badge-dikkat', hex: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
        riskli: { label: 'Riskli', cls: 'badge-riskli', hex: '#f97316', bg: 'rgba(249,115,22,0.15)' },
        tehlikeli: { label: 'Tehlikeli!', cls: 'badge-tehlikeli', hex: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
    };

    let _currentData = null;
    let _trafolar = [];

    // ─── Yardımcılar ─────────────────────────────────────────────
    function fmt(n, dec = 2) {
        if (n === null || n === undefined) return '—';
        return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }

    function fmtInt(n) {
        if (n === null || n === undefined) return '—';
        return Number(n).toLocaleString('tr-TR');
    }

    function riskBadge(seviye) {
        const r = RISK_BADGE[seviye] || RISK_BADGE['guvenli'];
        return `<span style="display:inline-block; padding:2px 10px; border-radius:4px; font-size:12px; font-weight:700;
                background:${r.bg}; color:${r.hex}; border:1px solid ${r.hex}55;">${r.label}</span>`;
    }

    function riskIcon(seviye) {
        const icons = { guvenli: '', dikkat: '', riskli: '', tehlikeli: '' };
        return icons[seviye] || '';
    }

    // ─── render(): Ekran iskeleti ─────────────────────────────────
    function render() {
        const container = document.getElementById('raporlama-container');
        if (!container) return;

        const state = App.getState();
        const trafolar = VeriModulu.getTrafolar ? Array.from(VeriModulu.getTrafolar().values()) : [];
        _trafolar = trafolar;

        // Mevcut seçili ay/trafo bilgileri
        const curAyVal = `${state.selectedYil}-${String(state.selectedAy).padStart(2, '0')}`;

        container.innerHTML = `
        <div class="rapor-screen" style="display:flex; flex-direction:column; height:100%; overflow:hidden;">

            <!-- Kontrol Çubuğu -->
            <div class="rapor-topbar" style="
                display:flex; align-items:center; gap:12px; flex-wrap:wrap;
                padding:16px 20px; border-bottom: 0;
                background:var(--bg-secondary); flex-shrink:0;">

                <div style="display:flex; align-items:center; gap:8px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        style="color:var(--color-primary);">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                    </svg>
                    <span style="font-weight:700; font-size:15px; color:var(--text-primary);">Raporlama & Dışa Aktarma</span>
                </div>

                <div style="width:1px; height:28px; background:var(--border-color); flex-shrink:0;"></div>

                <!-- Trafo Seçici -->
                <div style="display:flex; align-items:center; gap:6px;">
                    <label style="font-size:13px; color:var(--text-muted); white-space:nowrap;">Trafo:</label>
                    <select id="rapor-trafo-select" style="background:var(--bg-card); color:var(--text-primary);
                        border: none !important; padding:5px 10px; font-size:13px; cursor:pointer; min-width:180px;">
                        ${trafolar.map(t => `<option value="${t.id}" ${t.id === state.selectedTrafoId ? 'selected' : ''}>${t.adi}</option>`).join('')}
                    </select>
                </div>

                <!-- Ay Seçici -->
                <div style="display:flex; align-items:center; gap:6px;">
                    <label style="font-size:13px; color:var(--text-muted); white-space:nowrap;">Dönem:</label>
                    <select id="rapor-ay-select" style="background:var(--bg-card); color:var(--text-primary);
                        border: none !important; padding:5px 10px; font-size:13px; cursor:pointer; min-width:160px;">
                        ${_buildAyOptions(curAyVal)}
                    </select>
                </div>

                <!-- Rapor Oluştur Butonu -->
                <button id="btn-rapor-olustur" onclick="RaporlamaUI.generateReport()"
                    style="display:flex; align-items:center; gap:7px; padding:7px 18px;
                    background:var(--color-primary); color:#fff; border:none; font-size:13px;
                    font-weight:600; cursor:pointer; transition:opacity 0.2s;"
                    onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                    Rapor Oluştur
                </button>

                <!-- Export Butonları (başta gizli) -->
                <div id="rapor-export-btns" style="display:none; align-items:center; gap:8px; margin-left:auto;">
                    <button id="btn-rapor-pdf" onclick="RaporlamaUI.exportPDF()"
                        style="display:flex; align-items:center; gap:6px; padding:7px 14px;
                        background:transparent; color:#ef4444; border: none !important;
                        font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s;"
                        onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='transparent'">
                        PDF İndir
                    </button>
                    <button id="btn-rapor-excel" onclick="RaporlamaUI.exportExcel()"
                        style="display:flex; align-items:center; gap:6px; padding:7px 14px;
                        background:transparent; color:#10b981; border: none !important;
                        font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s;"
                        onmouseover="this.style.background='rgba(16,185,129,0.1)'" onmouseout="this.style.background='transparent'">
                        Excel İndir
                    </button>
                </div>
            </div>

            <!-- Önizleme / Yükleme alanı -->
            <div id="rapor-preview-area" style="flex:1; overflow-y:auto; padding:24px; background:var(--bg-primary);">
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;
                    height:100%; color:var(--text-muted); text-align:center; gap:16px;">
                    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="1" opacity="0.3">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <p style="font-size:15px; margin:0;">Trafo ve dönem seçin, ardından <strong style="color:var(--color-primary)">Rapor Oluştur</strong>'a tıklayın.</p>
                    <p style="font-size:12px; margin:0; opacity:0.6;">PDF ve Excel formatlarında dışa aktarım desteklenmektedir.</p>
                </div>
            </div>
        </div>`;
    }

    function _buildAyOptions(curVal) {
        const options = [];
        const now = new Date();
        let cur = new Date(now.getFullYear(), now.getMonth(), 1);
        while (cur.getFullYear() > 2025 || (cur.getFullYear() === 2025 && cur.getMonth() >= 0)) {
            const val = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
            const text = `${AY_ADLARI[cur.getMonth()]} ${cur.getFullYear()}`;
            options.push(`<option value="${val}" ${val === curVal ? 'selected' : ''}>${text}</option>`);
            cur.setMonth(cur.getMonth() - 1);
        }
        return options.join('');
    }

    // ─── generateReport(): API'den çek, önizlemeyi doldur ─────────
    async function generateReport() {
        const trafoSel = document.getElementById('rapor-trafo-select');
        const aySel = document.getElementById('rapor-ay-select');
        const previewArea = document.getElementById('rapor-preview-area');

        if (!trafoSel || !aySel || !previewArea) return;

        const trafoId = trafoSel.value;
        const [yil, ay] = aySel.value.split('-').map(Number);

        // Loading göster
        previewArea.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;
                height:100%; color:var(--text-muted); gap:16px;">
                <div class="loading-spinner" style="width:36px; height:36px; border-width:3px;"></div>
                <p style="font-size:14px; margin:0;">Rapor verileri yükleniyor...</p>
            </div>`;

        try {
            const data = await ApiClient.fetchReportData(trafoId, yil, ay);
            _currentData = data;
            _renderPreview(data, previewArea);

            // Export butonlarını göster
            const exportBtns = document.getElementById('rapor-export-btns');
            if (exportBtns) exportBtns.style.display = 'flex';

        } catch (err) {
            previewArea.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;
                    height:100%; color:#ef4444; gap:12px;">
                    <p style="font-size:14px; margin:0;">Hata: ${App.escapeHTML(err.message)}</p>
                </div>`;
        }
    }

    // ─── _renderPreview(): Rapor HTML'ini oluştur ─────────────────
    function _renderPreview(data, container) {
        const { trafo, donem, ozet, gunlukVeriler, manevraGecmisi, alarmGecmisi } = data;
        const ayAdi = AY_ADLARI[donem.ay - 1];
        const nowStr = new Date().toLocaleString('tr-TR');
        const risk = ozet?.genelRisk?.seviye || 'guvenli';
        const riskInfo = RISK_BADGE[risk] || RISK_BADGE['guvenli'];

        const kapOran = ozet?.kapasitifOran ?? 0;
        const endOran = ozet?.enduktifOran ?? 0;
        const LIMIT_KAP = 15;
        const LIMIT_END = 20;

        // Ceza durumu
        const cezaVarKap = kapOran >= LIMIT_KAP;
        const cezaVarEnd = endOran >= LIMIT_END;
        const cezaDurumu = (cezaVarKap || cezaVarEnd)
            ? `<span style="color:#ef4444; font-weight:700;">CEZA RİSKİ MEVCUT</span>`
            : `<span style="color:#10b981; font-weight:700;">Ceza Riski Yok</span>`;

        container.innerHTML = `
        <div id="rapor-document" style="
            max-width: 960px; margin: 0 auto;
            background: var(--bg-primary);
            border-radius: 12px;
            overflow: hidden;
            border: none !important;
            
            font-family: 'Inter', sans-serif;">

            <!-- Rapor Başlığı -->
            <div style="
                background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%);
                border-bottom: 0;
                padding: 36px 40px; color: var(--text-primary);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
                    <div>
                        <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase;
                            opacity:0.6; margin-bottom:8px;">REACT — Reaktif Güç Takip ve Analiz Sistemi</div>
                        <h1 style="margin:0; font-size:24px; font-weight:800; letter-spacing:-0.5px;">
                            Aylık Reaktif Güç Raporu
                        </h1>
                        <div style="margin-top:10px; font-size:15px; opacity:0.85;">
                            ${App.escapeHTML(trafo.adi)} &nbsp;|&nbsp; ${ayAdi} ${donem.yil}
                        </div>
                    </div>
                    <div style="text-align:right; font-size:12px; opacity:0.65;">
                        <div>Bölge: <strong style="opacity:1;">${App.escapeHTML(trafo.bolge)}</strong></div>
                        <div>Kapasite: <strong style="opacity:1;">${trafo.kapasite} MVA</strong></div>
                        <div style="margin-top:6px;">Oluşturulma: ${nowStr}</div>
                    </div>
                </div>
            </div>

            <div style="padding: 28px 36px; display:flex; flex-direction:column; gap:28px;">

            <!-- KPI Kartları -->
            <div>
                <div class="rapor-section-title" style="font-size:11px; font-weight:700; letter-spacing:2px;
                    text-transform:uppercase; color:var(--text-muted); margin-bottom:14px;
                    padding-bottom:8px; border-bottom: 0;">
                    DÖNEM ÖZETİ
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:14px;">
                    ${_kpiCard('Aktif Tüketim', fmtInt(ozet?.toplamAktif), 'kWh', '#3b82f6')}
                    ${_kpiCard('Kapasitif Reaktif', fmtInt(ozet?.toplamKapasitif), 'kVAr', '#8b5cf6')}
                    ${_kpiCard('Endüktif Reaktif', fmtInt(ozet?.toplamEnduktif), 'kVAr', '#06b6d4')}
                    ${_kpiCard('Kapasitif Oran', fmt(kapOran), '%', kapOran >= LIMIT_KAP ? '#ef4444' : kapOran >= 12 ? '#f59e0b' : '#10b981')}
                    ${_kpiCard('Endüktif Oran', fmt(endOran), '%', endOran >= LIMIT_END ? '#ef4444' : endOran >= 16 ? '#f59e0b' : '#10b981')}
                    ${_kpiCard('Veri Günü', fmtInt(ozet?.gunSayisi), 'gün', '#94a3b8')}
                </div>
            </div>

            <!-- Risk & Ceza Analizi -->
            <div>
                <div class="rapor-section-title" style="font-size:11px; font-weight:700; letter-spacing:2px;
                    text-transform:uppercase; color:var(--text-muted); margin-bottom:14px;
                    padding-bottom:8px; border-bottom: 0;">
                    RİSK & CEZA ANALİZİ
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:stretch;">

                    <!-- Genel Risk -->
                    <div style="padding:24px; background:var(--bg-card); border: none !important; border-radius:12px; ">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                            <div style="font-size:13px; font-weight:600; color:var(--text-muted); letter-spacing:0.5px;">GENEL RİSK SEVİYESİ</div>
                            <div style="padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700; background:${riskInfo.hex}15; color:${riskInfo.hex};">
                                ${riskInfo.label.toUpperCase()}
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:13px; color:var(--text-muted);">Kapasitif Oran</span>
                                <span style="font-size:14px; font-weight:600; color:var(--text-primary);">${fmt(kapOran)}% <span style="font-size:11px; font-weight:400; opacity:0.6;">/ %${LIMIT_KAP} limit</span></span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:13px; color:var(--text-muted);">Endüktif Oran</span>
                                <span style="font-size:14px; font-weight:600; color:var(--text-primary);">${fmt(endOran)}% <span style="font-size:11px; font-weight:400; opacity:0.6;">/ %${LIMIT_END} limit</span></span>
                            </div>
                        </div>
                    </div>

                    <!-- Ceza Durumu -->
                    <div style="padding:24px; background:var(--bg-card); border: none !important; border-radius:12px; ">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                            <div style="font-size:13px; font-weight:600; color:var(--text-muted); letter-spacing:0.5px;">EPDK CEZA DURUMU</div>
                            <div style="padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700; background:${cezaDurumu.includes('RİSKİ') ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'}; color:${cezaDurumu.includes('RİSKİ') ? '#ef4444' : '#10b981'};">
                                ${cezaDurumu.includes('RİSKİ') ? 'RİSK MEVCUT' : 'NORMAL'}
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:13px; color:var(--text-muted);">Kapasitif Durum</span>
                                <span style="font-size:13px; font-weight:600; color:${cezaVarKap ? '#ef4444' : '#10b981'};">${cezaVarKap ? 'Limit Aşıldı' : 'Uygun'}</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:13px; color:var(--text-muted);">Endüktif Durum</span>
                                <span style="font-size:13px; font-weight:600; color:${cezaVarEnd ? '#ef4444' : '#10b981'};">${cezaVarEnd ? 'Limit Aşıldı' : 'Uygun'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Günlük Veriler Tablosu -->
            ${gunlukVeriler.length > 0 ? `
            <div>
                <div class="rapor-section-title" style="font-size:11px; font-weight:700; letter-spacing:2px;
                    text-transform:uppercase; color:var(--text-muted); margin-bottom:14px;
                    padding-bottom:8px; border-bottom: 0;">
                    GÜNLÜK VERİLER (${gunlukVeriler.length} gün)
                </div>
                <div style="overflow-x:auto; border: none !important; border-radius:8px; margin-top:8px;">
                    <table style="width:100%; border-collapse:collapse; font-size:13px;">
                        <thead>
                            <tr style="background:var(--bg-secondary);">
                                <th style="${_th()}">Tarih</th>
                                <th style="${_th()}">Aktif (kWh)</th>
                                <th style="${_th()}">Kapasitif (kVAr)</th>
                                <th style="${_th()}">Endüktif (kVAr)</th>
                                <th style="${_th()}">Kap. Oran (%)</th>
                                <th style="${_th()}">End. Oran (%)</th>
                                <th style="${_th()}">Risk</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${gunlukVeriler.map((g, i) => `
                            <tr style="border-bottom: 0; background: transparent;">
                                <td style="${_td()} font-weight:600;">${g.tarih}</td>
                                <td style="${_td()} text-align:right;">${fmtInt(g.aktif)}</td>
                                <td style="${_td()} text-align:right;">${fmtInt(g.kapasitif)}</td>
                                <td style="${_td()} text-align:right;">${fmtInt(g.enduktif)}</td>
                                <td style="${_td()} text-align:right; color:${g.kapasitifOran >= LIMIT_KAP ? '#ef4444' : 'inherit'}; font-weight:${g.kapasitifOran >= LIMIT_KAP ? '700' : '400'};">
                                    ${fmt(g.kapasitifOran)}
                                </td>
                                <td style="${_td()} text-align:right; color:${g.enduktifOran >= LIMIT_END ? '#ef4444' : 'inherit'};">
                                    ${fmt(g.enduktifOran)}
                                </td>
                                <td style="${_td()}">${riskIcon(g.riskSeviye)} ${riskBadge(g.riskSeviye)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>` : ''}

            <!-- Manevra Geçmişi -->
            ${manevraGecmisi.length > 0 ? `
            <div>
                <div class="rapor-section-title" style="font-size:11px; font-weight:700; letter-spacing:2px;
                    text-transform:uppercase; color:var(--text-muted); margin-bottom:14px;
                    padding-bottom:8px; border-bottom: 0;">
                    MANEVRA GEÇMİŞİ (${manevraGecmisi.length} işlem)
                </div>
                <div style="overflow-x:auto; border: none !important; border-radius:8px; margin-top:8px;">
                    <table style="width:100%; border-collapse:collapse; font-size:13px;">
                        <thead>
                            <tr style="background:var(--bg-secondary);">
                                <th style="${_th()}">Tarih</th>
                                <th style="${_th()}">Varlık</th>
                                <th style="${_th()}">Kaynak Trafo</th>
                                <th style="${_th()}">Hedef Trafo</th>
                                <th style="${_th()}">Etki</th>
                                <th style="${_th()}">Gerekçe</th>
                                <th style="${_th()}">Durum</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${manevraGecmisi.map((m, i) => `
                            <tr style="border-bottom: 0; background: transparent;">
                                <td style="${_td()} white-space:nowrap;">${m.timestamp ? m.timestamp.replace('T', ' ').slice(0, 16) : '—'}</td>
                                <td style="${_td()} font-weight:600;">${App.escapeHTML(m.assetName || m.assetId)}</td>
                                <td style="${_td()}">${App.escapeHTML(m.sourceTrafoName || m.sourceTrafoId || '—')}</td>
                                <td style="${_td()}">${App.escapeHTML(m.targetTrafoName || m.targetTrafoId || '—')}</td>
                                <td style="${_td()}">${App.escapeHTML(m.impactLevel || '—')}</td>
                                <td style="${_td()}; max-width:200px; word-break:break-word;">${App.escapeHTML(m.reason || '—')}</td>
                                <td style="${_td()}">
                                    <span style="padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;
                                        background:${m.status === 'applied' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};
                                        color:${m.status === 'applied' ? '#10b981' : '#ef4444'};">
                                        ${m.status === 'applied' ? 'Uygulandı' : 'Geri Alındı'}
                                    </span>
                                </td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>` : `
            <div style="padding:14px 18px; background:var(--bg-secondary); border: none !important; border-radius:8px; margin-top:8px;
                font-size:13px; color:var(--text-muted);">
                Bu dönemde kayıtlı manevra bulunmuyor.
            </div>`}

            <!-- Alarm Geçmişi -->
            ${alarmGecmisi.length > 0 ? `
            <div>
                <div class="rapor-section-title" style="font-size:11px; font-weight:700; letter-spacing:2px;
                    text-transform:uppercase; color:var(--text-muted); margin-bottom:14px;
                    padding-bottom:8px; border-bottom: 0;">
                    ALARM GEÇMİŞİ (${alarmGecmisi.length} alarm)
                </div>
                <div style="overflow-x:auto; border: none !important; border-radius:8px; margin-top:8px;">
                    <table style="width:100%; border-collapse:collapse; font-size:13px;">
                        <thead>
                            <tr style="background:var(--bg-secondary);">
                                <th style="${_th()}">Tarih</th>
                                <th style="${_th()}">Tür</th>
                                <th style="${_th()}">Seviye</th>
                                <th style="${_th()}">Mesaj</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${alarmGecmisi.map((a, i) => {
            const sColor = a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#3b82f6';
            const sBg = a.severity === 'critical' ? 'rgba(239,68,68,0.15)' : a.severity === 'warning' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)';
            const sLabel = a.severity === 'critical' ? 'Kritik' : a.severity === 'warning' ? 'Uyarı' : 'Bilgi';
            return `
                                <tr style="border-bottom: 0; background: transparent;">
                                    <td style="${_td()} white-space:nowrap;">${a.timestamp ? a.timestamp.replace('T', ' ').slice(0, 16) : '—'}</td>
                                    <td style="${_td()}">${App.escapeHTML(a.alertType || '—')}</td>
                                    <td style="${_td()}">
                                        <span style="padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;
                                            background:${sBg}; color:${sColor};">${sLabel}</span>
                                    </td>
                                    <td style="${_td()}; word-break:break-word;">${App.escapeHTML(a.message || '—')}</td>
                                </tr>`;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>` : `
            <div style="padding:14px 18px; background:var(--bg-secondary); border: none !important; border-radius:8px; margin-top:8px;
                font-size:13px; color:var(--text-muted);">
                Bu dönemde kayıtlı alarm bulunmuyor.
            </div>`}

            <!-- Rapor Altbilgisi -->
            <div style="padding-top:16px; border-top: 0; font-size:11px;
                color:var(--text-muted); display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <span>REACT — Reaktif Güç Takip ve Analiz Sistemi</span>
                <span>Oluşturulma: ${nowStr}</span>
                <span>Trafo: ${App.escapeHTML(trafo.adi)} | ${ayAdi} ${donem.yil}</span>
            </div>

            </div><!-- /padding wrapper -->
        </div>`;
    }

    function _th() {
        return 'padding:14px 16px; text-align:left; font-size:12px; font-weight:600; letter-spacing:0.5px; color:var(--text-muted); white-space:nowrap; border-bottom: 0;';
    }
    function _td() {
        return 'padding:12px 16px; vertical-align:middle; font-size:13px; color:var(--text-primary); border-bottom: 0;';
    }

    function _kpiCard(label, value, unit, color) {
        return `
        <div style="padding:16px 20px; background:var(--bg-card); border: none !important; border-radius:12px;
            position:relative; overflow:hidden; ">
            <div style="position:absolute; top:0; left:0; width:100%; height:3px; background:${color}; opacity:0.9;"></div>
            <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700;
                letter-spacing:0.5px; margin-bottom:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${label}">${label}</div>
            <div style="font-size:24px; font-weight:800; color:var(--text-primary); line-height:1; margin-bottom:4px; white-space:nowrap;">${value}</div>
            <div style="font-size:12px; font-weight:600; color:${color}; white-space:nowrap;">${unit}</div>
        </div>`;
    }

    // ─── exportPDF(): A4 Sayfasına Sığdırma (html2canvas + jsPDF) ─────────────────────
    function exportPDF() {
        if (!_currentData) {
            App.showToast('Önce rapor oluşturun.', 'warning');
            return;
        }
        
        if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
            App.showToast('PDF kütüphaneleri yüklenemedi. Lütfen sayfayı yenileyin.', 'error');
            return;
        }

        const element = document.getElementById('rapor-document');
        if (!element) return;
        
        const { trafo, donem } = _currentData;
        const fileName = `REACT_Rapor_${trafo.id}_${donem.yil}_${String(donem.ay).padStart(2, '0')}.pdf`;

        App.showToast('PDF oluşturuluyor, lütfen bekleyin...', 'info');
        
        // Kutu kaymalarını önlemek için container'ı sabitle
        const originalWidth = element.style.width;
        const originalMaxWidth = element.style.maxWidth;
        const originalMargin = element.style.margin;
        
        // Genişliği daha büyük tutarak kutu içi yazıların sıkışmasını (taşmasını) engelliyoruz
        element.style.width = '1400px';
        element.style.maxWidth = '1400px';
        element.style.margin = '0';

        // DOM'un güncellenmesi için çok kısa bir süre bekle
        setTimeout(async () => {
            try {
                // Elementin resmini çek
                const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false });
                
                // Stilleri eski haline getir (kullanıcı beklerken arayüz düzelsin)
                element.style.width = originalWidth;
                element.style.maxWidth = originalMaxWidth;
                element.style.margin = originalMargin;

                const imgData = canvas.toDataURL('image/jpeg', 1.0);
                
                // jsPDF ile standart A4 PDF oluştur
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = pdf.internal.pageSize.getHeight();
                
                // Resmi A4 sayfasına sığacak şekilde ölçekle (aspect ratio korunur)
                // Hem genişliğe hem yüksekliğe sığması için min oran alınır
                const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
                const finalWidth = canvas.width * ratio;
                const finalHeight = canvas.height * ratio;
                
                // Yatayda ortala, üstten 5mm boşluk bırak
                const x = (pdfWidth - finalWidth) / 2;
                const y = 5;
                
                pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight);
                pdf.save(fileName);
                
                App.showToast(`PDF raporu indirildi: ${fileName}`, 'success');
            } catch (err) {
                element.style.width = originalWidth;
                element.style.maxWidth = originalMaxWidth;
                element.style.margin = originalMargin;
                console.error('PDF Hatası:', err);
                App.showToast('PDF oluşturulurken hata oluştu.', 'error');
            }
        }, 150);
    }

    // ─── exportExcel(): SheetJS ile .xlsx ─────────────────────────
    function exportExcel() {
        if (!_currentData) {
            App.showToast('Önce rapor oluşturun.', 'warning');
            return;
        }

        if (typeof XLSX === 'undefined') {
            App.showToast('SheetJS kütüphanesi yüklenemedi.', 'error');
            return;
        }

        const { trafo, donem, ozet, gunlukVeriler, manevraGecmisi, alarmGecmisi } = _currentData;
        const ayAdi = AY_ADLARI[donem.ay - 1];
        const wb = XLSX.utils.book_new();

        // ── Sayfa 1: Özet ──
        const ozetData = [
            ['REACT — Aylık Reaktif Güç Raporu'],
            [`Trafo: ${trafo.adi} | ${ayAdi} ${donem.yil}`],
            [],
            ['Metrik', 'Değer', 'Birim'],
            ['Aktif Tüketim (Toplam)', ozet?.toplamAktif ?? 0, 'kWh'],
            ['Kapasitif Reaktif (Toplam)', ozet?.toplamKapasitif ?? 0, 'kVAr'],
            ['Endüktif Reaktif (Toplam)', ozet?.toplamEnduktif ?? 0, 'kVAr'],
            ['Kapasitif Oran', ozet?.kapasitifOran ?? 0, '%'],
            ['Endüktif Oran', ozet?.enduktifOran ?? 0, '%'],
            ['Veri Günü Sayısı', ozet?.gunSayisi ?? 0, 'gün'],
            ['Genel Risk Seviyesi', ozet?.genelRisk?.seviye ?? '—', ''],
            ['EPDK Kapasitif Ceza', (ozet?.kapasitifOran ?? 0) >= 15 ? 'EVET' : 'HAYIR', ''],
            ['EPDK Endüktif Ceza', (ozet?.enduktifOran ?? 0) >= 20 ? 'EVET' : 'HAYIR', ''],
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(ozetData);
        ws1['!cols'] = [{ wch: 35 }, { wch: 20 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Özet');

        // ── Sayfa 2: Günlük Veriler ──
        const gunlukHeader = ['Tarih', 'Aktif (kWh)', 'Kapasitif (kVAr)', 'Endüktif (kVAr)', 'Kapasitif Oran (%)', 'Endüktif Oran (%)', 'Risk Seviyesi'];
        const gunlukRows = gunlukVeriler.map(g => [
            g.tarih, g.aktif, g.kapasitif, g.enduktif,
            g.kapasitifOran, g.enduktifOran, g.riskSeviye
        ]);
        const ws2 = XLSX.utils.aoa_to_sheet([gunlukHeader, ...gunlukRows]);
        ws2['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Günlük Veriler');

        // ── Sayfa 3: Manevra & Alarmlar ──
        const manevraHeader = ['Tarih', 'Varlık', 'Kaynak Trafo', 'Hedef Trafo', 'Etki', 'Gerekçe', 'Durum'];
        const manevraRows = manevraGecmisi.map(m => [
            m.timestamp ? m.timestamp.replace('T', ' ').slice(0, 16) : '',
            m.assetName || m.assetId, m.sourceTrafoName || '', m.targetTrafoName || '',
            m.impactLevel || '', m.reason || '',
            m.status === 'applied' ? 'Uygulandı' : 'Geri Alındı'
        ]);

        const alarmHeader = ['Tarih', 'Tür', 'Seviye', 'Mesaj'];
        const alarmRows = alarmGecmisi.map(a => [
            a.timestamp ? a.timestamp.replace('T', ' ').slice(0, 16) : '',
            a.alertType || '', a.severity || '', a.message || ''
        ]);

        const eventData = [
            ['MANEVRA GEÇMİŞİ'],
            manevraHeader,
            ...manevraRows,
            [],
            ['ALARM GEÇMİŞİ'],
            alarmHeader,
            ...alarmRows
        ];
        const ws3 = XLSX.utils.aoa_to_sheet(eventData);
        ws3['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 12 }, { wch: 35 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Manevra & Alarmlar');

        // ── İndir ──
        const fileName = `REACT_Rapor_${trafo.id}_${donem.yil}_${String(donem.ay).padStart(2, '0')}.xlsx`;
        XLSX.writeFile(wb, fileName);
        App.showToast(`Excel raporu indirildi: ${fileName}`, 'success');
    }

    return {
        render,
        generateReport,
        exportPDF,
        exportExcel,
    };
})();
