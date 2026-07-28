/**
 * SPARK Manevra Öneri ve Karar Destek Ekranı Modülü (maneuver_ui.js)
 */
const ManeuverUI = (() => {
    'use strict';

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

            const historyData = await ApiClient.fetchManeuverHistory(1, 0);
            const historyCount = document.getElementById('stat-history-count');
            if (historyCount) historyCount.textContent = historyData.total || 0;

            const subtabGecmis = document.getElementById('subtab-count-gecmis');
            if (subtabGecmis) subtabGecmis.textContent = historyData.total || 0;
        } catch (err) {
            console.error("Manevra özet istatistikleri yüklenirken hata:", err);
        }
    }

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
                        <td><b>${App.escapeHTML(f.name)}</b> <span class="text-muted" style="font-size:11px;">(${App.escapeHTML(f.id)})</span></td>
                        <td><span class="badge badge-info">${App.escapeHTML(f.current_transformer_id)}</span></td>
                        <td><span class="badge">${App.escapeHTML(f.alternative_transformer_id || '—')}</span></td>
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
                        <td><b>${App.escapeHTML(r.name)}</b> <span class="text-muted" style="font-size:11px;">(${App.escapeHTML(r.id)})</span></td>
                        <td><span class="badge badge-info">${App.escapeHTML(r.current_transformer_id)}</span></td>
                        <td><span class="badge">${App.escapeHTML(r.alternative_transformer_id || '—')}</span></td>
                        <td class="text-right"><b>${r.capacity_kvar.toLocaleString('tr-TR')}</b> kVAr</td>
                        <td class="text-center"><span class="badge ${r.status === 'active' ? 'badge-success' : 'badge-danger'}">${r.status === 'active' ? 'Aktif' : 'Pasif'}</span></td>
                    </tr>
                `).join('');
            } else {
                reactorBody.innerHTML = '<tr><td colspan="5" class="text-center">Reaktör bulunamadı.</td></tr>';
            }

            drawManevraTopology(data);

        } catch (err) {
            console.error("Manevra varlıkları yüklenirken hata:", err);
        }
    }

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
                                    <span class="maneuver-badge ${impactClass}">Öncelik: ${App.escapeHTML(s.impact)}</span>
                                    <span class="maneuver-badge" style="background: rgba(49, 116, 246, 0.1); color: var(--color-primary); border: 1px solid rgba(49, 116, 246, 0.3);">${App.escapeHTML(s.id)}</span>
                                </div>
                                <h4>${App.escapeHTML(s.title)}</h4>
                                <p class="suggestion-card-desc">${App.escapeHTML(s.description)}</p>
                                <div class="suggestion-card-meta">
                                    <span><b>Kaynak:</b> ${App.escapeHTML(s.source_trafo_name)}</span>
                                    <span><b>Hedef:</b> ${App.escapeHTML(s.target_trafo_name)}</span>
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
                const overrideChk = document.getElementById('chk-override-overload');
                const overrideOverload = overrideChk ? overrideChk.checked : false;

                if (overrideChk && !overrideChk.checked) {
                    App.showToast("Bu manevra hedef trafoda aşırı yüke sebep oluyor! Devam etmek için onay kutusunu işaretleyin.", "warning");
                    return;
                }

                try {
                    applyBtn.disabled = true;
                    applyBtn.textContent = 'Uygulanıyor...';
                    const res = await ApiClient.applyManeuver(
                        _simCurrentData.asset_type,
                        _simCurrentData.asset_id,
                        _simCurrentData.target_trafo_id,
                        reason || null,
                        overrideOverload
                    );
                    App.showToast(res.message || "Manevra başarıyla uygulandı!", "success");
                    closeModal();
                    _cachedAssets = null;
                    await loadManevraAssets();
                    await loadManevraSummaryStats();
                    await fetchAndRenderManevraSuggestions();
                } catch (err) {
                    console.error("Manevra uygulama hatası:", err);
                    App.showToast("Manevra uygulanamadı: " + err.message, "error");
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
            const loadBarClass = (ratio) => ratio > 100 ? 'high' : (ratio > 70 ? 'high' : (ratio > 50 ? 'medium' : 'low'));

            body.innerHTML = `
                ${sim.is_overload ? `
                <div style="margin-bottom: 16px; padding: 12px 16px; border-radius: 8px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 13px;">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 4px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        ${App.escapeHTML(sim.overload_warning || 'Aşırı Yük Uyarısı!')}
                    </div>
                    <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px; cursor: pointer; color: var(--text-primary); font-weight: 500;">
                        <input type="checkbox" id="chk-override-overload" style="width: 16px; height: 16px; accent-color: #ef4444;">
                        Aşırı Yük Riskini Kabul Ediyorum ve Yine de Devam Et
                    </label>
                </div>
                ` : ''}

                <div class="sim-comparison-grid">
                    <div class="sim-trafo-panel">
                        <h4>Kaynak Trafo</h4>
                        <p class="trafo-subtitle">${App.escapeHTML(sim.source_trafo_name)}</p>
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
                        <span class="sim-arrow-label">${App.escapeHTML(sim.asset_name)}</span>
                    </div>

                    <div class="sim-trafo-panel">
                        <h4>Hedef Trafo</h4>
                        <p class="trafo-subtitle">${App.escapeHTML(sim.target_trafo_name)}</p>
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
                    <b>Reaktif Güç Değerlendirmesi:</b> ${App.escapeHTML(sim.reactive_improvement)}
                </div>
                ` : ''}
            `;
        } catch (err) {
            console.error("Simülasyon hatası:", err);
            body.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--color-danger-light); font-weight: 500; font-size: 14px;">${App.escapeHTML(err.message)}</div>`;
        }
    }

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
                        <td><b>${App.escapeHTML(log.asset_name)}</b> <span class="text-muted" style="font-size: 11px;">(${App.escapeHTML(log.asset_id)})</span></td>
                        <td><span class="badge badge-info">${App.escapeHTML(log.source_trafo_name)}</span></td>
                        <td><span class="badge badge-info">${App.escapeHTML(log.target_trafo_name)}</span></td>
                        <td><span class="maneuver-badge ${impactClass}">${App.escapeHTML(log.impact_level)}</span></td>
                        <td>${statusBadge}</td>
                        <td class="text-center">
                            ${log.status === 'applied' ? `<button class="btn-rollback" data-log-id="${log.id}">Geri Al</button>` : '<span class="text-muted">—</span>'}
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('.btn-rollback').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const logId = btn.dataset.logId;
                    if (!confirm('Bu manevrayı geri almak istediğinizden emin misiniz?')) return;
                    try {
                        btn.disabled = true;
                        btn.textContent = '...';
                        const res = await ApiClient.rollbackManeuver(logId);
                        App.showToast(res.message || "Manevra geri alındı!", "success");
                        _cachedAssets = null;
                        await loadManevraAssets();
                        await loadManevraSummaryStats();
                        await loadManevraHistory();
                    } catch (err) {
                        App.showToast("Geri alma hatası: " + err.message, "error");
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

    (function bindHistoryFilters() {
        document.addEventListener('change', (e) => {
            if (e.target.id === 'history-filter-type' || e.target.id === 'history-filter-status') {
                loadManevraHistory();
            }
        });
    })();

    function drawManevraTopology(assets) {
        const canvas = document.getElementById('maneuver-topology-canvas');
        if (!canvas) return;

        const wrap = canvas.parentElement;
        let logicalWidth = 900;
        let logicalHeight = 440;
        
        if (wrap) {
            logicalWidth = wrap.clientWidth || 900;
        }

        // Görüntü Kalitesi (High DPI / Retina Display) Desteği
        const dpr = window.devicePixelRatio || 1;
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        canvas.style.width = logicalWidth + 'px';
        canvas.style.height = logicalHeight + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        
        const W = logicalWidth;
        const H = logicalHeight;
        
        ctx.clearRect(0, 0, W, H);

        const isLight = document.body.getAttribute('data-theme') === 'light';
        const textColor = isLight ? '#334155' : '#f8fafc';
        const mutedColor = isLight ? '#94a3b8' : '#94a3b8';
        const borderColor = isLight ? '#e2e8f0' : '#334155';
        
        const trafoColor = isLight ? '#0f172a' : '#ffffff';
        const trafoBg = isLight ? '#ffffff' : '#1e293b';
        
        const activeLineColor = isLight ? 'rgba(59, 130, 246, 0.45)' : 'rgba(96, 165, 250, 0.4)';
        const activeStroke = isLight ? '#3b82f6' : '#60a5fa';
        
        const altLineColor = isLight ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.5)';

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

        // YENİ YERLEŞİM (Daha Ferah): Reaktörler üstte, Trafolar ortada, Fiderler altta
        const reactorY = 80;
        const trafoY = 220;
        const feederY = 360;

        const trafoSpacing = W / (trafos.length + 1);
        const trafoPositions = {};
        
        trafos.forEach((tid, i) => {
            trafoPositions[tid] = trafoSpacing * (i + 1);
        });

        const feeders = assets.feeders || [];
        const feederSpacing = feeders.length > 0 ? W / (feeders.length + 1) : W / 2;
        const feederPositions = [];
        
        const reactors = assets.reactors || [];
        const reactorSpacing = reactors.length > 0 ? W / (reactors.length + 1) : W / 2;
        const reactorPositions = [];

        // Yardımcı fonksiyon: Bezier eğrisi çizimi
        const drawConnection = (startX, startY, endX, endY, isAlt, customColor = null) => {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            
            const diff = endY - startY;
            const cpY1 = startY + diff * 0.4;
            const cpY2 = endY - diff * 0.4;
            
            ctx.bezierCurveTo(startX, cpY1, endX, cpY2, endX, endY);
            
            ctx.lineWidth = isAlt ? 1.5 : 2;
            ctx.strokeStyle = customColor ? customColor : (isAlt ? altLineColor : activeLineColor);
            
            if (isAlt) ctx.setLineDash([6, 6]);
            else ctx.setLineDash([]);
            
            ctx.stroke();
            ctx.setLineDash([]);
        };

        // Bağlantıların çizimi (En altta kalsın diye önce çiziliyor)
        
        // Reaktör Bağlantıları (Üstten Ortaya)
        reactors.forEach((r, i) => {
            const rx = reactorSpacing * (i + 1);
            reactorPositions.push(rx);
            const rr = 16;
            
            if (trafoPositions[r.current_transformer_id] !== undefined) {
                const tx = trafoPositions[r.current_transformer_id];
                const isActive = r.status === 'active';
                const lineColor = isActive ? (isLight ? 'rgba(217, 119, 6, 0.6)' : 'rgba(251, 191, 36, 0.6)') : altLineColor;
                drawConnection(rx, reactorY + rr, tx, trafoY - 16, false, lineColor);
            }
        });

        // Fider Bağlantıları (Alttan Ortaya)
        feeders.forEach((f, i) => {
            const fx = feederSpacing * (i + 1);
            feederPositions.push(fx);
            const boxH = 40;
            
            if (trafoPositions[f.current_transformer_id] !== undefined) {
                const tx = trafoPositions[f.current_transformer_id];
                drawConnection(fx, feederY - boxH / 2, tx, trafoY + 16, false);
            }
            if (f.alternative_transformer_id && trafoPositions[f.alternative_transformer_id] !== undefined) {
                const ax = trafoPositions[f.alternative_transformer_id];
                drawConnection(fx, feederY - boxH / 2, ax, trafoY + 16, true);
            }
        });

        // Reaktörler (Üst)
        reactors.forEach((r, i) => {
            const rx = reactorPositions[i];
            const rr = 16;
            
            const isActive = r.status === 'active';
            const rColor = isActive ? (isLight ? '#d97706' : '#fbbf24') : (isLight ? '#94a3b8' : '#64748b');
            const rBg = isActive ? (isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.08)') : (isLight ? '#f8fafc' : 'rgba(148, 163, 184, 0.08)');
            
            ctx.shadowColor = isActive ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0,0,0,0.05)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            
            ctx.fillStyle = rBg;
            ctx.strokeStyle = rColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(rx, reactorY, rr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            ctx.shadowColor = 'transparent';
            
            ctx.fillStyle = rColor;
            ctx.font = '700 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('R', rx, reactorY);
            
            ctx.fillStyle = mutedColor;
            ctx.font = '400 10px Inter, sans-serif';
            const shortRName = r.name.length > 16 ? r.name.substring(0, 16) + '…' : r.name;
            ctx.fillText(shortRName, rx, reactorY - 26); // Etiketi üste aldık
        });

        // Trafolar (Orta)
        trafos.forEach((tid, i) => {
            const x = trafoPositions[tid];
            const tw = 88;
            const th = 32;
            
            ctx.shadowColor = 'rgba(0,0,0,0.08)';
            ctx.shadowBlur = 12;
            ctx.shadowOffsetY = 4;
            
            ctx.fillStyle = trafoBg;
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(x - tw/2, trafoY - th/2, tw, th, th/2);
            ctx.fill();
            ctx.stroke();
            
            ctx.shadowColor = 'transparent';
            
            ctx.fillStyle = trafoColor;
            ctx.font = '600 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const cleanName = tid.split('-').pop();
            ctx.fillText(cleanName, x, trafoY);
            
            ctx.fillStyle = mutedColor;
            ctx.font = '10px Inter, sans-serif';
            ctx.fillText(tid, x + tw/2 + 30, trafoY); // Etiketi sağa aldık
        });

        // Fiderler (Alt)
        feeders.forEach((f, i) => {
            const fx = feederPositions[i];
            const boxW = 104, boxH = 40;
            
            ctx.shadowColor = 'rgba(0,0,0,0.06)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            
            ctx.fillStyle = trafoBg;
            ctx.strokeStyle = activeStroke;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(fx - boxW/2, feederY - boxH/2, boxW, boxH, 6);
            ctx.fill();
            ctx.stroke();
            
            ctx.shadowColor = 'transparent';
            
            ctx.fillStyle = textColor;
            ctx.font = '500 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const shortName = f.name.length > 14 ? f.name.substring(0, 14) + '…' : f.name;
            ctx.fillText(shortName, fx, feederY - 5);
            
            ctx.fillStyle = mutedColor;
            ctx.font = '400 10px Inter, sans-serif';
            ctx.fillText(`${f.simulated_load_kw.toLocaleString('tr-TR')} kW`, fx, feederY + 9);
        });

        // Lejant
        ctx.fillStyle = mutedColor;
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Aktif Bağlantı
        ctx.strokeStyle = activeLineColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(20, H - 24); ctx.lineTo(46, H - 24); ctx.stroke();
        ctx.fillText('Aktif Fider', 56, H - 24);

        // Reaktör Bağlantısı
        ctx.strokeStyle = isLight ? 'rgba(217, 119, 6, 0.6)' : 'rgba(251, 191, 36, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(130, H - 24); ctx.lineTo(156, H - 24); ctx.stroke();
        ctx.fillText('Reaktör Bağlantısı', 166, H - 24);

        // Alternatif Bağlantı
        ctx.strokeStyle = altLineColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(280, H - 24); ctx.lineTo(306, H - 24); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText('Alternatif Fider', 316, H - 24);
    }

    function bindManevraCRUDModals() {
        // Manuel Manevra Binds
        const btnManuel = document.getElementById('btn-manuel-manevra');
        const modalManuel = document.getElementById('manuel-manevra-modal');
        const closeManuelBtn = document.getElementById('btn-close-manuel-modal');
        const formManuel = document.getElementById('manuel-manevra-form');
        const selectAssetType = document.getElementById('manuel-asset-type');
        const selectAssetId = document.getElementById('manuel-asset-id');
        
        if (btnManuel && modalManuel && !btnManuel.dataset.bound) {
            btnManuel.dataset.bound = "true";
            
            const filterTargetTrafos = async () => {
                const assetId = selectAssetId.value;
                const type = selectAssetType.value;
                const targetSelect = document.getElementById('manuel-target-trafo');
                if (!targetSelect) return;
                
                if (!assetId || !_cachedAssets) {
                    await populateModalTrafoSelects(['manuel-target-trafo']);
                    return;
                }

                const list = type === 'feeder' ? _cachedAssets.feeders : _cachedAssets.reactors;
                const asset = (list || []).find(a => a.id === assetId);
                
                if (asset) {
                    const allTrafos = await ApiClient.fetchTransformers();
                    let allowed = [];
                    
                    if (asset.alternative_transformer_id) {
                        allowed = allTrafos.filter(t => t.id === asset.alternative_transformer_id);
                    } else {
                        allowed = allTrafos.filter(t => t.id !== asset.current_transformer_id);
                    }

                    if (allowed.length === 0) {
                        targetSelect.innerHTML = '<option value="">Uygun alternatif trafo bulunamadı</option>';
                    } else {
                        targetSelect.innerHTML = allowed.map(t => `<option value="${t.id}">${t.name} (${t.id})</option>`).join('');
                    }
                }
            };

            const populateAssets = async (type) => {
                if (!_cachedAssets) return;
                const assets = type === 'feeder' ? _cachedAssets.feeders : _cachedAssets.reactors;
                selectAssetId.innerHTML = '<option value="">Seçiniz...</option>' + 
                    (assets || []).map(a => `<option value="${a.id}">${a.name} (${a.current_transformer_id})</option>`).join('');
                await filterTargetTrafos();
            };

            btnManuel.addEventListener('click', async () => {
                await populateAssets(selectAssetType.value);
                modalManuel.style.display = 'flex';
            });
            
            closeManuelBtn?.addEventListener('click', () => { modalManuel.style.display = 'none'; });
            modalManuel.addEventListener('click', (e) => { if (e.target === modalManuel) modalManuel.style.display = 'none'; });

            selectAssetType?.addEventListener('change', async (e) => {
                await populateAssets(e.target.value);
            });

            selectAssetId?.addEventListener('change', async () => {
                await filterTargetTrafos();
            });

            formManuel?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const type = selectAssetType.value;
                const assetId = selectAssetId.value;
                const target = document.getElementById('manuel-target-trafo').value;
                
                if (!assetId || !target) return;
                
                modalManuel.style.display = 'none';
                await openSimulationModal(type, assetId, target);
            });
        }

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
                    App.showToast(res.message || "Fider oluşturuldu!", "success");
                    feederModal.style.display = 'none';
                    feederForm.reset();
                    _cachedAssets = null;
                    await loadManevraAssets();
                    await loadManevraSummaryStats();
                } catch (err) {
                    App.showToast("Fider oluşturulamadı: " + err.message, "error");
                }
            });
        }

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
                    App.showToast(res.message || "Reaktör oluşturuldu!", "success");
                    reactorModal.style.display = 'none';
                    reactorForm.reset();
                    _cachedAssets = null;
                    await loadManevraAssets();
                    await loadManevraSummaryStats();
                } catch (err) {
                    App.showToast("Reaktör oluşturulamadı: " + err.message, "error");
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
        renderManevra,
        loadManevraAssets,
        loadManevraHistory
    };
})();
