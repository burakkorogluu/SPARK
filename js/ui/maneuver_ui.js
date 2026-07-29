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
        
        bindSuggestionTabs();
    }
    
    function bindSuggestionTabs() {
        const btnNormal = document.getElementById('btn-sug-tab-normal');
        const btnPred = document.getElementById('btn-sug-tab-predictive');
        const contNormal = document.getElementById('manevra-onerileri-container-normal');
        const contPred = document.getElementById('manevra-onerileri-container-predictive');
        
        if (btnNormal && btnPred) {
            btnNormal.addEventListener('click', () => {
                btnNormal.classList.add('active');
                btnPred.classList.remove('active');
                contNormal.style.display = 'block';
                contPred.style.display = 'none';
            });
            
            btnPred.addEventListener('click', () => {
                btnPred.classList.add('active');
                btnNormal.classList.remove('active');
                contPred.style.display = 'block';
                contNormal.style.display = 'none';
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
                        <td class="text-center"><button class="btn btn-sm btn-outline btn-delete-asset" style="padding: 4px 8px;" data-type="feeder" data-id="${App.escapeHTML(f.id)}" title="Sil">Sil</button></td>
                    </tr>
                `).join('');
            } else {
                feederBody.innerHTML = '<tr><td colspan="5" class="text-center">Fider bulunamadı.</td></tr>';
            }

            if (data.reactors && data.reactors.length > 0) {
                reactorBody.innerHTML = data.reactors.map(r => `
                    <tr>
                        <td><b>${App.escapeHTML(r.name)}</b> <span class="text-muted" style="font-size:11px;">(${App.escapeHTML(r.id)})</span></td>
                        <td><span class="badge badge-info">${App.escapeHTML(r.current_transformer_id)}</span></td>
                        <td><span class="badge">${App.escapeHTML(r.alternative_transformer_id || '—')}</span></td>
                        <td class="text-right"><b>${r.capacity_kvar.toLocaleString('tr-TR')}</b> kVAr</td>
                        <td class="text-center"><span class="badge ${r.status === 'active' ? 'badge-success' : 'badge-danger'}">${r.status === 'active' ? 'Aktif' : 'Pasif'}</span></td>
                        <td class="text-center"><button class="btn btn-sm btn-outline btn-delete-asset" style="padding: 4px 8px;" data-type="reactor" data-id="${App.escapeHTML(r.id)}" title="Sil">Sil</button></td>
                    </tr>
                `).join('');
            } else {
                reactorBody.innerHTML = '<tr><td colspan="6" class="text-center">Reaktör bulunamadı.</td></tr>';
            }

            // Silme butonları event listener
            document.querySelectorAll('.btn-delete-asset').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const type = btn.dataset.type;
                    const id = btn.dataset.id;
                    if (!confirm(`Bu ${type === 'feeder' ? 'fideri' : 'reaktörü'} silmek istediğinizden emin misiniz?`)) return;
                    
                    try {
                        btn.disabled = true;
                        btn.textContent = '...';
                        if (type === 'feeder') {
                            await ApiClient.deleteFeeder(id);
                        } else {
                            await ApiClient.deleteReactor(id);
                        }
                        App.showToast('Başarıyla silindi.', 'success');
                        _cachedAssets = null;
                        loadManevraAssets();
                        loadManevraSummaryStats();
                    } catch (err) {
                        App.showToast(`Silme hatası: ${err.message}`, 'error');
                        btn.disabled = false;
                        btn.textContent = 'Sil';
                    }
                });
            });

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
        const contNormal = document.getElementById('manevra-onerileri-container-normal');
        const contPred = document.getElementById('manevra-onerileri-container-predictive');
        if (!contNormal || !contPred) return;

        const loadingHtml = `
            <div style="padding: 20px; text-align: center;">
                <div class="loading-spinner" style="width: 24px; height: 24px; border-width: 3px; margin: 0 auto 10px auto;"></div>
                <span>Akıllı Manevra Önerileri Analiz Ediliyor...</span>
            </div>
        `;
        contNormal.innerHTML = loadingHtml;
        contPred.innerHTML = loadingHtml;

        try {
            const suggestions = await ApiClient.fetchManeuverSuggestions();
            _cachedSuggestions = suggestions;
            
            const normalSuggs = suggestions ? suggestions.filter(s => !s.is_predictive) : [];
            const predSuggs = suggestions ? suggestions.filter(s => s.is_predictive) : [];

            const suggestionCount = document.getElementById('stat-suggestion-count');
            if (suggestionCount) suggestionCount.textContent = normalSuggs.length; // Sadece kesinleşenleri ana sayaca ekle
            
            const badgePred = document.getElementById('badge-predictive-count');
            if (badgePred) {
                badgePred.textContent = predSuggs.length;
                badgePred.style.display = predSuggs.length > 0 ? 'inline-block' : 'none';
            }

            const renderCards = (suggs, emptyMsg) => {
                if (suggs.length === 0) return `<div style="padding: 16px; border-radius: 8px; background: rgba(46, 125, 50, 0.06); border: 1px solid rgba(46, 125, 50, 0.15); color: var(--text-secondary); font-size: 14px;">${emptyMsg}</div>`;
                
                return suggs.map((s, idx) => {
                    const assetType = s.feeder_id ? 'feeder' : 'reactor';
                    const assetId = s.feeder_id || s.reactor_id;
                    const impactClass = s.impact === 'Yüksek' ? 'impact-high' : (s.impact === 'Orta' ? 'impact-medium' : 'impact-low');
                    const preview = s.simulation_preview || {};

                    return `
                    <div class="suggestion-card ${idx === 0 && !s.is_predictive ? 'highlight' : ''}" style="animation-delay: ${idx * 0.1}s; ${s.is_predictive ? 'border-left-color: var(--color-warning);' : ''}">
                        <div class="suggestion-card-top">
                            <div style="display: flex; gap: 16px; align-items: flex-start; flex: 1;">
                                ${renderScoreGauge(s.score || 50)}
                                <div class="suggestion-card-info">
                                    <div class="suggestion-card-badges">
                                        <span class="maneuver-badge ${impactClass}">Öncelik: ${App.escapeHTML(s.impact)}</span>
                                        ${s.is_predictive ? `<span class="maneuver-badge" style="background: var(--color-warning); color: white;">Proaktif</span>` : ''}
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
            };

            contNormal.innerHTML = renderCards(normalSuggs, "Şu anda yapılması gereken kritik (kesinleşmiş) bir manevra önerisi bulunmamaktadır. Tüm trafolar dengeli çalışıyor.");
            contPred.innerHTML = renderCards(predSuggs, "Ay sonu projeksiyonlarına göre proaktif bir manevra ihtiyacı öngörülmemiştir.");

            document.querySelectorAll('.btn-sim-open').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const type = btn.dataset.assetType;
                    const id = btn.dataset.assetId;
                    const target = btn.dataset.target;
                    await openSimulationModal(type, id, target);
                });
            });

        } catch (err) {
            console.error("Manevra önerileri çekilirken hata:", err);
            const errHtml = `<div style="padding: 16px; border-radius: 8px; background: rgba(198, 40, 40, 0.06); border: 1px solid rgba(198, 40, 40, 0.15); color: var(--color-danger-light); font-size: 14px;">Öneriler alınırken sunucu hatası oluştu.</div>`;
            contNormal.innerHTML = errHtml;
            contPred.innerHTML = errHtml;
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
                const map = { tehlikeli: 'Tehlikeli', riskli: 'Riskli', dikkat: 'Dikkat', guvenli: 'Güvenli' };
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
                        ${sim.source_cap_ratio_before !== undefined ? `
                        <div class="sim-metric">
                            <span class="sim-metric-label">Kapasitif Oran</span>
                            <span class="sim-metric-value">%${sim.source_cap_ratio_before} → %${sim.source_cap_ratio_after}</span>
                        </div>
                        ` : ''}
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
                        ${sim.target_cap_ratio_before !== undefined ? `
                        <div class="sim-metric">
                            <span class="sim-metric-label">Kapasitif Oran</span>
                            <span class="sim-metric-value">%${sim.target_cap_ratio_before} → %${sim.target_cap_ratio_after}</span>
                        </div>
                        ` : ''}
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

    let _animFrameId = null;
    let _isEditMode = false;
    let _isFullscreen = false;
    let _pendingAdditions = { transformers: [], feeders: [], reactors: [] };
    let _pendingPositionUpdates = {};

    let _topologyState = {
        nodes: [],
        hoveredId: null,
        draggedNode: null,
        dragX: 0,
        dragY: 0,
        particles: [],
        lastTime: 0
    };
    let _topologyCanvasBound = false;

    function drawManevraTopology(assets) {
        const canvas = document.getElementById('maneuver-topology-canvas');
        if (!canvas) return;

        const wrap = canvas.parentElement;
        let logicalWidth = 900;
        let logicalHeight = 440;
        if (wrap) {
            logicalWidth = wrap.clientWidth || 900;
            if (_isFullscreen) {
                logicalHeight = wrap.clientHeight || (window.innerHeight - 100);
            } else {
                logicalHeight = 440;
            }
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        canvas.style.width = logicalWidth + 'px';
        canvas.style.height = logicalHeight + 'px';

        const ctx = canvas.getContext('2d');
        
        if (_animFrameId) {
            cancelAnimationFrame(_animFrameId);
        }
        
        const W = logicalWidth;
        const H = logicalHeight;

        const trafoObjects = assets.transformers || [];
        const trafoSet = new Set();
        (assets.feeders || []).forEach(f => { trafoSet.add(f.current_transformer_id); if (f.alternative_transformer_id) trafoSet.add(f.alternative_transformer_id); });
        (assets.reactors || []).forEach(r => { trafoSet.add(r.current_transformer_id); if (r.alternative_transformer_id) trafoSet.add(r.alternative_transformer_id); });
        trafoObjects.forEach(t => trafoSet.add(t.id));
        
        const trafos = trafoObjects.length > 0 ? trafoObjects : Array.from(trafoSet).map(id => ({ id, name: id }));
        const allTrafos = [...trafos, ..._pendingAdditions.transformers];
        const allFeeders = [...(assets.feeders || []), ..._pendingAdditions.feeders];
        const allReactors = [...(assets.reactors || []), ..._pendingAdditions.reactors];

        const reactorY = Math.round(H * 0.18);
        const trafoY   = Math.round(H * 0.50);
        const feederY  = Math.round(H * 0.82);
        const trafoSpacing = W / (allTrafos.length + 1);
        const feederSpacing = allFeeders.length > 0 ? W / (allFeeders.length + 1) : W / 2;
        const reactorSpacing = allReactors.length > 0 ? W / (allReactors.length + 1) : W / 2;

        _topologyState.nodes = [];
        
        allTrafos.forEach((t, i) => {
            const up = _pendingPositionUpdates[t.id];
            const x = up && up.pos_x != null ? up.pos_x : (t.pos_x != null ? t.pos_x : Math.round(trafoSpacing * (i + 1)));
            const y = up && up.pos_y != null ? up.pos_y : (t.pos_y != null ? t.pos_y : trafoY);
            _topologyState.nodes.push({ id: t.id, type: 'trafo', x, y, w: 88, h: 32, asset: t });
        });
        
        allReactors.forEach((r, i) => {
            const up = _pendingPositionUpdates[r.id];
            const x = up && up.pos_x != null ? up.pos_x : (r.pos_x != null ? r.pos_x : Math.round(reactorSpacing * (i + 1)));
            const y = up && up.pos_y != null ? up.pos_y : (r.pos_y != null ? r.pos_y : reactorY);
            _topologyState.nodes.push({ id: r.id, type: 'reactor', x, y, r: 16, asset: r });
        });
        
        allFeeders.forEach((f, i) => {
            const up = _pendingPositionUpdates[f.id];
            const x = up && up.pos_x != null ? up.pos_x : (f.pos_x != null ? f.pos_x : Math.round(feederSpacing * (i + 1)));
            const y = up && up.pos_y != null ? up.pos_y : (f.pos_y != null ? f.pos_y : feederY);
            _topologyState.nodes.push({ id: f.id, type: 'feeder', x, y, w: 104, h: 40, asset: f });
        });

        _topologyState.particles = [];
        const addParticles = (sourceNode, targetNode, count, color) => {
            if (!sourceNode || !targetNode) return;
            for (let i = 0; i < count; i++) {
                _topologyState.particles.push({
                    progress: Math.random(),
                    speed: 0.002 + Math.random() * 0.002,
                    source: sourceNode,
                    target: targetNode,
                    color: color
                });
            }
        };

        const isLight = document.body.getAttribute('data-theme') === 'light';
        const activeParticleColor = isLight ? 'rgba(59, 130, 246, 0.8)' : 'rgba(96, 165, 250, 0.8)';
        const reactorParticleColor = isLight ? 'rgba(217, 119, 6, 0.8)' : 'rgba(251, 191, 36, 0.8)';

        allReactors.forEach(r => {
            if (r.status === 'active') {
                const rn = _topologyState.nodes.find(n => n.id === r.id);
                const tn = _topologyState.nodes.find(n => n.id === r.current_transformer_id);
                addParticles(tn, rn, 3, reactorParticleColor);
            }
        });
        allFeeders.forEach(f => {
            const fn = _topologyState.nodes.find(n => n.id === f.id);
            const tn = _topologyState.nodes.find(n => n.id === f.current_transformer_id);
            addParticles(tn, fn, 5, activeParticleColor);
        });

        if (!_topologyCanvasBound) {
            _topologyCanvasBound = true;
            
            const getMousePos = (e) => {
                const rect = canvas.getBoundingClientRect();
                return { x: (e.clientX - rect.left) * (logicalWidth / rect.width), y: (e.clientY - rect.top) * (logicalHeight / rect.height) };
            };

            const hitTest = (x, y) => {
                for (let i = _topologyState.nodes.length - 1; i >= 0; i--) {
                    const n = _topologyState.nodes[i];
                    if (n.type === 'reactor') {
                        const dx = x - n.x, dy = y - n.y;
                        if (dx*dx + dy*dy <= n.r * n.r) return n;
                    } else {
                        if (x >= n.x - n.w/2 && x <= n.x + n.w/2 && y >= n.y - n.h/2 && y <= n.y + n.h/2) return n;
                    }
                }
                return null;
            };

            canvas.addEventListener('mousemove', (e) => {
                const pos = getMousePos(e);
                
                if (_topologyState.draggedNode) {
                    _topologyState.dragX = pos.x;
                    _topologyState.dragY = pos.y;
                    canvas.style.cursor = 'grabbing';
                    
                    if (_isEditMode) {
                        _topologyState.draggedNode.x = pos.x;
                        _topologyState.draggedNode.y = pos.y;
                        _pendingPositionUpdates[_topologyState.draggedNode.id] = {
                            id: _topologyState.draggedNode.id,
                            type: _topologyState.draggedNode.type,
                            pos_x: Math.round(pos.x),
                            pos_y: Math.round(pos.y),
                            current_transformer_id: _topologyState.draggedNode.asset.current_transformer_id,
                            alternative_transformer_id: _topologyState.draggedNode.asset.alternative_transformer_id
                        };
                    } else {
                        const hit = hitTest(pos.x, pos.y);
                        if (hit && hit.type === 'trafo' && hit.id !== _topologyState.draggedNode.asset.current_transformer_id) {
                            _topologyState.hoveredId = hit.id;
                        } else {
                            _topologyState.hoveredId = null;
                        }
                    }
                    return;
                }

                const hit = hitTest(pos.x, pos.y);
                if (hit) {
                    canvas.style.cursor = _isEditMode ? 'move' : (hit.type === 'trafo' ? 'pointer' : 'grab');
                    if (_topologyState.hoveredId !== hit.id) {
                        _topologyState.hoveredId = hit.id;
                    }
                } else {
                    canvas.style.cursor = 'default';
                    if (_topologyState.hoveredId !== null) {
                        _topologyState.hoveredId = null;
                    }
                }
            });

            canvas.addEventListener('mousedown', (e) => {
                const pos = getMousePos(e);
                const hit = hitTest(pos.x, pos.y);
                if (hit) {
                    if (_isEditMode || hit.type === 'feeder' || hit.type === 'reactor') {
                        _topologyState.draggedNode = hit;
                        _topologyState.dragX = pos.x;
                        _topologyState.dragY = pos.y;
                        canvas.style.cursor = 'grabbing';
                    }
                }
            });

            canvas.addEventListener('mouseup', (e) => {
                if (_topologyState.draggedNode) {
                    const pos = getMousePos(e);
                    const hit = hitTest(pos.x, pos.y);
                    
                    if (_isEditMode) {
                        if (hit && hit.type === 'trafo' && _topologyState.draggedNode.type !== 'trafo' && hit.id !== _topologyState.draggedNode.asset.current_transformer_id) {
                            _topologyState.draggedNode.asset.current_transformer_id = hit.id;
                            if (!_pendingPositionUpdates[_topologyState.draggedNode.id]) {
                                _pendingPositionUpdates[_topologyState.draggedNode.id] = {
                                    id: _topologyState.draggedNode.id,
                                    type: _topologyState.draggedNode.type,
                                    pos_x: Math.round(_topologyState.draggedNode.x),
                                    pos_y: Math.round(_topologyState.draggedNode.y)
                                };
                            }
                            _pendingPositionUpdates[_topologyState.draggedNode.id].current_transformer_id = hit.id;
                            App.showToast(`${_topologyState.draggedNode.asset.name || _topologyState.draggedNode.id} -> ${hit.id} bağlantısı güncellendi.`, 'info');
                        }
                    } else {
                        if (hit && hit.type === 'trafo' && hit.id !== _topologyState.draggedNode.asset.current_transformer_id) {
                            openSimulationModal(_topologyState.draggedNode.type, _topologyState.draggedNode.id, hit.id);
                        }
                    }
                    _topologyState.draggedNode = null;
                    _topologyState.hoveredId = null;
                }
                canvas.style.cursor = 'default';
            });
            
            canvas.addEventListener('mouseleave', () => {
                _topologyState.hoveredId = null;
                _topologyState.draggedNode = null;
            });
        }

        const render = (time) => {
            _topologyState.lastTime = time;
            
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.scale(dpr, dpr);
            
            const isLight = document.body.getAttribute('data-theme') === 'light';
            const textColor = isLight ? '#334155' : '#f8fafc';
            const mutedColor = isLight ? '#94a3b8' : '#94a3b8';
            const borderColor = isLight ? '#e2e8f0' : '#334155';
            const trafoColor = isLight ? '#0f172a' : '#ffffff';
            const trafoBg = isLight ? '#ffffff' : '#1e293b';
            const activeLineColor = isLight ? 'rgba(59, 130, 246, 0.45)' : 'rgba(96, 165, 250, 0.4)';
            const activeStroke = isLight ? '#3b82f6' : '#60a5fa';
            const altLineColor = isLight ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.5)';
            const hoveredNode = _topologyState.hoveredId ? _topologyState.nodes.find(n => n.id === _topologyState.hoveredId) : null;
            
            const drawConnection = (startX, startY, endX, endY, isAlt, customColor = null, isFaded = false) => {
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                const diff = endY - startY;
                ctx.bezierCurveTo(startX, startY + diff * 0.4, endX, endY - diff * 0.4, endX, endY);
                ctx.lineWidth = isAlt ? 1.5 : 2;
                
                if (isFaded) {
                    ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
                } else {
                    ctx.strokeStyle = customColor ? customColor : (isAlt ? altLineColor : activeLineColor);
                }
                
                if (isAlt) ctx.setLineDash([6, 6]);
                else ctx.setLineDash([]);
                ctx.stroke();
                ctx.setLineDash([]);
            };
            
            const drawLines = () => {
                _topologyState.nodes.forEach(n => {
                    if (n.type === 'reactor') {
                        const tn = _topologyState.nodes.find(t => t.id === n.asset.current_transformer_id);
                        if (tn) {
                            const isFaded = hoveredNode && hoveredNode.id !== n.id && hoveredNode.id !== tn.id;
                            const isActive = n.asset.status === 'active';
                            const lineColor = isActive ? (isLight ? 'rgba(217, 119, 6, 0.6)' : 'rgba(251, 191, 36, 0.6)') : altLineColor;
                            drawConnection(n.x, n.y + n.r, tn.x, tn.y - 16, false, lineColor, isFaded);
                        }
                    } else if (n.type === 'feeder') {
                        const tn = _topologyState.nodes.find(t => t.id === n.asset.current_transformer_id);
                        if (tn) {
                            const isFaded = hoveredNode && hoveredNode.id !== n.id && hoveredNode.id !== tn.id;
                            drawConnection(n.x, n.y - n.h/2, tn.x, tn.y + 16, false, null, isFaded);
                        }
                        if (n.asset.alternative_transformer_id) {
                            const an = _topologyState.nodes.find(t => t.id === n.asset.alternative_transformer_id);
                            if (an) {
                                const isFaded = hoveredNode && hoveredNode.id !== n.id && hoveredNode.id !== an.id;
                                drawConnection(n.x, n.y - n.h/2, an.x, an.y + 16, true, null, isFaded);
                            }
                        }
                    }
                });
            };
            drawLines();

            if (_topologyState.draggedNode) {
                const dn = _topologyState.draggedNode;
                const isFaded = false;
                if (dn.type === 'feeder') {
                    drawConnection(_topologyState.dragX, _topologyState.dragY - dn.h/2, dn.x, dn.y - dn.h/2, false, 'rgba(239, 68, 68, 0.8)', isFaded);
                } else if (dn.type === 'reactor') {
                    drawConnection(_topologyState.dragX, _topologyState.dragY + dn.r, dn.x, dn.y + dn.r, false, 'rgba(239, 68, 68, 0.8)', isFaded);
                }
            }

            _topologyState.particles.forEach(p => {
                p.progress += p.speed;
                if (p.progress > 1) p.progress = 0;
                
                const isFaded = hoveredNode && hoveredNode.id !== p.source.id && hoveredNode.id !== p.target.id;
                if (isFaded) return;

                let startX, startY, endX, endY;
                if (p.source.type === 'trafo' && p.target.type === 'feeder') {
                    startX = p.source.x; startY = p.source.y + 16;
                    endX = p.target.x; endY = p.target.y - p.target.h/2;
                } else if (p.source.type === 'trafo' && p.target.type === 'reactor') {
                    startX = p.source.x; startY = p.source.y - 16;
                    endX = p.target.x; endY = p.target.y + p.target.r;
                } else {
                    return;
                }
                
                const diff = endY - startY;
                const cpY1 = startY + diff * 0.4;
                const cpY2 = endY - diff * 0.4;
                
                const t = p.progress;
                const u = 1 - t;
                const tt = t*t, uu = u*u;
                const uuu = uu * u, ttt = tt * t;
                
                const px = uuu * startX + 3 * uu * t * startX + 3 * u * tt * endX + ttt * endX;
                const py = uuu * startY + 3 * uu * t * cpY1 + 3 * u * tt * cpY2 + ttt * endY;
                
                ctx.beginPath();
                ctx.arc(px, py, 2.5, 0, Math.PI*2);
                ctx.fillStyle = p.color;
                ctx.fill();
            });

            _topologyState.nodes.forEach(n => {
                const isHovered = hoveredNode && (hoveredNode.id === n.id || 
                    (hoveredNode.type === 'feeder' && (hoveredNode.asset.current_transformer_id === n.id || hoveredNode.asset.alternative_transformer_id === n.id)) ||
                    (hoveredNode.type === 'reactor' && hoveredNode.asset.current_transformer_id === n.id) ||
                    (n.type === 'feeder' && (n.asset.current_transformer_id === hoveredNode.id || n.asset.alternative_transformer_id === hoveredNode.id)) ||
                    (n.type === 'reactor' && n.asset.current_transformer_id === hoveredNode.id)
                );
                
                const isFaded = hoveredNode && !isHovered;
                const isDragged = _topologyState.draggedNode && _topologyState.draggedNode.id === n.id;
                
                let nx = isDragged ? _topologyState.dragX : n.x;
                let ny = isDragged ? _topologyState.dragY : n.y;

                ctx.globalAlpha = isFaded ? 0.3 : 1.0;

                if (n.type === 'reactor') {
                    const isActive = n.asset.status === 'active';
                    const rColor = isActive ? (isLight ? '#d97706' : '#fbbf24') : (isLight ? '#94a3b8' : '#64748b');
                    const rBg = isActive ? (isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.08)') : (isLight ? '#f8fafc' : 'rgba(148, 163, 184, 0.08)');
                    
                    if (isHovered || isDragged) {
                        ctx.shadowColor = isActive ? 'rgba(245, 158, 11, 0.6)' : 'rgba(0,0,0,0.2)';
                        ctx.shadowBlur = 15;
                    } else {
                        ctx.shadowColor = isActive ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0,0,0,0.05)';
                        ctx.shadowBlur = 10;
                    }
                    ctx.shadowOffsetY = 4;
                    
                    ctx.fillStyle = rBg;
                    ctx.strokeStyle = rColor;
                    ctx.lineWidth = isHovered ? 2 : 1.5;
                    ctx.beginPath();
                    ctx.arc(nx, ny, n.r, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    
                    ctx.shadowColor = 'transparent';
                    
                    ctx.fillStyle = rColor;
                    ctx.font = '700 12px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('R', nx, ny);
                    
                    ctx.fillStyle = mutedColor;
                    ctx.font = '400 10px Inter, sans-serif';
                    const shortRName = n.asset.name.length > 16 ? n.asset.name.substring(0, 16) + '…' : n.asset.name;
                    ctx.fillText(shortRName, nx, ny - 26);
                } 
                else if (n.type === 'trafo') {
                    if (isHovered) {
                        ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
                        ctx.shadowBlur = 15;
                    } else {
                        ctx.shadowColor = 'rgba(0,0,0,0.08)';
                        ctx.shadowBlur = 12;
                    }
                    ctx.shadowOffsetY = 4;
                    
                    ctx.fillStyle = trafoBg;
                    ctx.strokeStyle = isHovered ? activeStroke : borderColor;
                    ctx.lineWidth = isHovered ? 2 : 1;
                    ctx.beginPath();
                    ctx.roundRect(nx - n.w/2, ny - n.h/2, n.w, n.h, n.h/2);
                    ctx.fill();
                    ctx.stroke();
                    
                    ctx.shadowColor = 'transparent';
                    
                    ctx.fillStyle = trafoColor;
                    ctx.font = '600 12px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const cleanName = n.id.split('-').pop();
                    ctx.fillText(cleanName, nx, ny);
                    
                    ctx.fillStyle = mutedColor;
                    ctx.font = '10px Inter, sans-serif';
                    ctx.fillText(n.id, nx + n.w/2 + 30, ny);
                }
                else if (n.type === 'feeder') {
                    if (isHovered || isDragged) {
                        ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
                        ctx.shadowBlur = 15;
                    } else {
                        ctx.shadowColor = 'rgba(0,0,0,0.06)';
                        ctx.shadowBlur = 10;
                    }
                    ctx.shadowOffsetY = 4;
                    
                    ctx.fillStyle = trafoBg;
                    ctx.strokeStyle = activeStroke;
                    ctx.lineWidth = isHovered ? 2.5 : 1.5;
                    ctx.beginPath();
                    ctx.roundRect(nx - n.w/2, ny - n.h/2, n.w, n.h, 6);
                    ctx.fill();
                    ctx.stroke();
                    
                    ctx.shadowColor = 'transparent';
                    
                    ctx.fillStyle = textColor;
                    ctx.font = '500 11px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const shortName = n.asset.name.length > 14 ? n.asset.name.substring(0, 14) + '…' : n.asset.name;
                    ctx.fillText(shortName, nx, ny - 5);
                    
                    ctx.fillStyle = mutedColor;
                    ctx.font = '400 10px Inter, sans-serif';
                    ctx.fillText(`${n.asset.simulated_load_kw.toLocaleString('tr-TR')} kW`, nx, ny + 9);
                }
                
                ctx.globalAlpha = 1.0;
            });

            ctx.fillStyle = mutedColor;
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            ctx.strokeStyle = activeLineColor;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(20, H - 24); ctx.lineTo(46, H - 24); ctx.stroke();
            ctx.fillText('Aktif Fider', 56, H - 24);

            ctx.strokeStyle = isLight ? 'rgba(217, 119, 6, 0.6)' : 'rgba(251, 191, 36, 0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(130, H - 24); ctx.lineTo(156, H - 24); ctx.stroke();
            ctx.fillText('Reaktör Bağlantısı', 166, H - 24);

            ctx.strokeStyle = altLineColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(280, H - 24); ctx.lineTo(306, H - 24); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillText('Alternatif Fider (Sürükle-bırak destekli)', 316, H - 24);

            ctx.restore();
            _animFrameId = requestAnimationFrame(render);
        };
        
        _animFrameId = requestAnimationFrame(render);
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
                    simulated_load_kw: parseFloat(document.getElementById('new-feeder-load').value),
                    pos_x: 450,
                    pos_y: 220
                };
                if (typeof _isEditMode !== 'undefined' && _isEditMode) {
                    if (typeof _pendingAdditions !== 'undefined' && _pendingAdditions.feeders) {
                        _pendingAdditions.feeders.push(data);
                    }
                    App.showToast(`Yeni fider '${data.name}' haritaya eklendi (Kaydetmeyi unutmayın).`, 'success');
                    feederModal.style.display = 'none';
                    feederForm.reset();
                    if (typeof _cachedAssets !== 'undefined' && _cachedAssets && typeof drawManevraTopology === 'function') {
                        drawManevraTopology(_cachedAssets);
                    }
                } else {
                    try {
                        const res = await ApiClient.addFeeder(data);
                        App.showToast(res.message || "Fider oluşturuldu!", "success");
                        feederModal.style.display = 'none';
                        feederForm.reset();
                        if (typeof _cachedAssets !== 'undefined') _cachedAssets = null;
                        if (typeof loadManevraAssets === 'function') await loadManevraAssets();
                        if (typeof loadManevraSummaryStats === 'function') await loadManevraSummaryStats();
                    } catch (err) {
                        App.showToast("Fider oluşturulamadı: " + err.message, "error");
                    }
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
                    status: document.getElementById('new-reactor-status').value,
                    pos_x: 450,
                    pos_y: 220
                };
                if (typeof _isEditMode !== 'undefined' && _isEditMode) {
                    if (typeof _pendingAdditions !== 'undefined' && _pendingAdditions.reactors) {
                        _pendingAdditions.reactors.push(data);
                    }
                    App.showToast(`Yeni reaktör '${data.name}' haritaya eklendi (Kaydetmeyi unutmayın).`, 'success');
                    reactorModal.style.display = 'none';
                    reactorForm.reset();
                    if (typeof _cachedAssets !== 'undefined' && _cachedAssets && typeof drawManevraTopology === 'function') {
                        drawManevraTopology(_cachedAssets);
                    }
                } else {
                    try {
                        const res = await ApiClient.addReactor(data);
                        App.showToast(res.message || "Reaktör oluşturuldu!", "success");
                        reactorModal.style.display = 'none';
                        reactorForm.reset();
                        if (typeof _cachedAssets !== 'undefined') _cachedAssets = null;
                        if (typeof loadManevraAssets === 'function') await loadManevraAssets();
                        if (typeof loadManevraSummaryStats === 'function') await loadManevraSummaryStats();
                    } catch (err) {
                        App.showToast("Reaktör oluşturulamadı: " + err.message, "error");
                    }
                }
            });
        }
        // ── Topoloji Düzenleme Modu & Tam Ekran Dinleyicileri ──
        const btnToggleEdit = document.getElementById('btn-toggle-edit-mode');
        const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
        const editorToolbar = document.getElementById('maneuver-editor-toolbar');
        const topologyContainer = document.getElementById('maneuver-topology-container');
        const txtEditMode = document.getElementById('txt-edit-mode');

        if (btnToggleEdit && !btnToggleEdit.dataset.bound) {
            btnToggleEdit.dataset.bound = "true";
            btnToggleEdit.addEventListener('click', () => {
                _isEditMode = !_isEditMode;
                if (editorToolbar) editorToolbar.style.display = _isEditMode ? 'flex' : 'none';
                if (txtEditMode) txtEditMode.textContent = _isEditMode ? 'Düzenleme Modundan Çık' : 'Düzenleme Modu';
                btnToggleEdit.style.background = _isEditMode ? 'rgba(239, 68, 68, 0.2)' : '';
                btnToggleEdit.style.borderColor = _isEditMode ? '#ef4444' : '';
                App.showToast(_isEditMode ? "Düzenleme modu aktif. Nesneleri serbestçe taşıyabilir ve düzenleyebilirsiniz." : "Düzenleme modundan çıkıldı.", "info");
                if (_cachedAssets) drawManevraTopology(_cachedAssets);
            });
        }

        const updateFullscreenUI = () => {
            if (topologyContainer) {
                topologyContainer.classList.toggle('fullscreen-topology', _isFullscreen);
            }
            if (btnToggleFullscreen) {
                if (_isFullscreen) {
                    btnToggleFullscreen.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ✕ Tam Ekrandan Çık (ESC)`;
                    btnToggleFullscreen.style.background = 'rgba(239, 68, 68, 0.25)';
                    btnToggleFullscreen.style.borderColor = '#ef4444';
                    btnToggleFullscreen.style.color = '#ef4444';
                    btnToggleFullscreen.style.fontWeight = '600';
                } else {
                    btnToggleFullscreen.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg> Tam Ekran`;
                    btnToggleFullscreen.style.background = '';
                    btnToggleFullscreen.style.borderColor = '';
                    btnToggleFullscreen.style.color = '';
                    btnToggleFullscreen.style.fontWeight = '';
                }
            }
            const btnExitFixed = document.getElementById('btn-exit-fullscreen-fixed');
            if (btnExitFixed) {
                btnExitFixed.style.display = _isFullscreen ? 'flex' : 'none';
            }
            setTimeout(() => {
                if (_cachedAssets) drawManevraTopology(_cachedAssets);
            }, 100);
        };

        if (btnToggleFullscreen && !btnToggleFullscreen.dataset.bound) {
            btnToggleFullscreen.dataset.bound = "true";
            btnToggleFullscreen.addEventListener('click', () => {
                _isFullscreen = !_isFullscreen;
                if (_isFullscreen && topologyContainer && topologyContainer.requestFullscreen) {
                    topologyContainer.requestFullscreen().catch(() => {});
                } else if (!_isFullscreen && document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                }
                updateFullscreenUI();
            });

            document.addEventListener('fullscreenchange', () => {
                _isFullscreen = !!document.fullscreenElement;
                updateFullscreenUI();
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && _isFullscreen) {
                    _isFullscreen = false;
                    if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => {});
                    }
                    updateFullscreenUI();
                }
            });
            
            const btnExitFixed = document.getElementById('btn-exit-fullscreen-fixed');
            if (btnExitFixed) {
                btnExitFixed.addEventListener('click', () => {
                    _isFullscreen = false;
                    if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => {});
                    }
                    updateFullscreenUI();
                });
            }
        }

        // Trafo Ekle Modalı
        const addTrafoBtn = document.getElementById('btn-editor-add-trafo');
        const trafoModal = document.getElementById('add-trafo-modal');
        const closeTrafoBtn = document.getElementById('btn-close-add-trafo');
        const trafoForm = document.getElementById('add-trafo-form');

        if (addTrafoBtn && trafoModal && !addTrafoBtn.dataset.bound) {
            addTrafoBtn.dataset.bound = "true";
            addTrafoBtn.addEventListener('click', () => { trafoModal.style.display = 'flex'; });
            closeTrafoBtn?.addEventListener('click', () => { trafoModal.style.display = 'none'; });
            trafoModal.addEventListener('click', (e) => { if (e.target === trafoModal) trafoModal.style.display = 'none'; });
            
            // Bind editor buttons for feeder and reactor as well
            const editorAddFeederBtn = document.getElementById('btn-editor-add-feeder');
            if (editorAddFeederBtn) {
                editorAddFeederBtn.addEventListener('click', () => {
                    const fModal = document.getElementById('add-feeder-modal');
                    if (fModal) {
                        populateModalTrafoSelects(['new-feeder-trafo', 'new-feeder-alt-trafo']);
                        fModal.style.display = 'flex';
                    }
                });
            }
            
            const editorAddReactorBtn = document.getElementById('btn-editor-add-reactor');
            if (editorAddReactorBtn) {
                editorAddReactorBtn.addEventListener('click', () => {
                    const rModal = document.getElementById('add-reactor-modal');
                    if (rModal) {
                        populateModalTrafoSelects(['new-reactor-trafo', 'new-reactor-alt-trafo']);
                        rModal.style.display = 'flex';
                    }
                });
            }

            trafoForm?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newT = {
                    id: document.getElementById('new-trafo-id').value.trim(),
                    name: document.getElementById('new-trafo-name').value.trim(),
                    region: document.getElementById('new-trafo-region').value.trim(),
                    power_mva: parseInt(document.getElementById('new-trafo-power').value, 10),
                    status: 'active',
                    pos_x: 450,
                    pos_y: 220
                };
                if (_isEditMode) {
                    _pendingAdditions.transformers.push(newT);
                    App.showToast(`Yeni trafo '${newT.name}' haritaya eklendi (Kaydetmeyi unutmayın).`, 'success');
                    trafoModal.style.display = 'none';
                    trafoForm.reset();
                    if (_cachedAssets) drawManevraTopology(_cachedAssets);
                } else {
                    try {
                        const res = await ApiClient.addTransformer(newT);
                        App.showToast(res.message || "Trafo başarıyla oluşturuldu!", 'success');
                        trafoModal.style.display = 'none';
                        trafoForm.reset();
                        _cachedAssets = null;
                        await loadManevraAssets();
                    } catch (err) {
                        App.showToast("Trafo oluşturulamadı: " + err.message, "error");
                    }
                }
            });
        }

        // ── Bağlantı Düzenleme Modalı ──
        const addConnBtn = document.getElementById('btn-editor-add-connection');
        const connModal = document.getElementById('edit-connection-modal');
        const closeConnBtn = document.getElementById('btn-close-edit-conn');
        const connForm = document.getElementById('edit-connection-form');
        const connAssetSel = document.getElementById('conn-asset-select');
        const connPrimarySel = document.getElementById('conn-primary-trafo');
        const connAltSel = document.getElementById('conn-alt-trafo');

        if (addConnBtn && connModal && !addConnBtn.dataset.bound) {
            addConnBtn.dataset.bound = "true";
            
            const populateConnectionModal = async () => {
                const data = _cachedAssets || await ApiClient.fetchManeuverAssets();
                const allF = [...(data.feeders || []), ..._pendingAdditions.feeders];
                const allR = [...(data.reactors || []), ..._pendingAdditions.reactors];
                const allT = [...(data.transformers || []), ..._pendingAdditions.transformers];

                if (connAssetSel) {
                    connAssetSel.innerHTML = '<option value="">— Varlık Seçin —</option>';
                    if (allF.length > 0) {
                        connAssetSel.innerHTML += '<optgroup label="Fiderler">' + allF.map(f => `<option value="${f.id}" data-type="feeder" data-primary="${f.current_transformer_id}" data-alt="${f.alternative_transformer_id || ''}">${f.name} (${f.id})</option>`).join('') + '</optgroup>';
                    }
                    if (allR.length > 0) {
                        connAssetSel.innerHTML += '<optgroup label="Reaktörler">' + allR.map(r => `<option value="${r.id}" data-type="reactor" data-primary="${r.current_transformer_id}" data-alt="${r.alternative_transformer_id || ''}">${r.name} (${r.id})</option>`).join('') + '</optgroup>';
                    }
                }

                if (connPrimarySel && connAltSel) {
                    connPrimarySel.innerHTML = allT.map(t => `<option value="${t.id}">${t.name} (${t.id})</option>`).join('');
                    connAltSel.innerHTML = '<option value="">— Yok —</option>' + allT.map(t => `<option value="${t.id}">${t.name} (${t.id})</option>`).join('');
                }
            };

            addConnBtn.addEventListener('click', async () => {
                await populateConnectionModal();
                connModal.style.display = 'flex';
            });

            connAssetSel?.addEventListener('change', () => {
                const opt = connAssetSel.options[connAssetSel.selectedIndex];
                if (opt && opt.dataset.primary) {
                    if (connPrimarySel) connPrimarySel.value = opt.dataset.primary;
                    if (connAltSel) connAltSel.value = opt.dataset.alt || '';
                }
            });

            closeConnBtn?.addEventListener('click', () => { connModal.style.display = 'none'; });
            connModal.addEventListener('click', (e) => { if (e.target === connModal) connModal.style.display = 'none'; });

            connForm?.addEventListener('submit', (e) => {
                e.preventDefault();
                const assetId = connAssetSel.value;
                const opt = connAssetSel.options[connAssetSel.selectedIndex];
                const type = opt?.dataset.type || 'feeder';
                const primaryId = connPrimarySel.value;
                const altId = connAltSel.value || null;

                if (!assetId || !primaryId) return;

                const node = _topologyState.nodes.find(n => n.id === assetId);
                if (node && node.asset) {
                    node.asset.current_transformer_id = primaryId;
                    node.asset.alternative_transformer_id = altId;
                }

                if (!_pendingPositionUpdates[assetId]) {
                    _pendingPositionUpdates[assetId] = {
                        id: assetId,
                        type: type,
                        pos_x: node ? Math.round(node.x) : 0,
                        pos_y: node ? Math.round(node.y) : 0
                    };
                }
                _pendingPositionUpdates[assetId].current_transformer_id = primaryId;
                _pendingPositionUpdates[assetId].alternative_transformer_id = altId;

                App.showToast(`'${assetId}' varlığının bağlantısı güncellendi (Kaydetmeyi unutmayın).`, 'success');
                connModal.style.display = 'none';
                connForm.reset();
                if (_cachedAssets) drawManevraTopology(_cachedAssets);
            });
        }

        // Toolbar Fider / Reaktör Butonları
        const editorAddFeederBtn = document.getElementById('btn-editor-add-feeder');
        if (editorAddFeederBtn && !editorAddFeederBtn.dataset.bound) {
            editorAddFeederBtn.dataset.bound = "true";
            editorAddFeederBtn.addEventListener('click', () => {
                populateModalTrafoSelects(['new-feeder-trafo', 'new-feeder-alt-trafo']);
                const feederModal = document.getElementById('add-feeder-modal');
                if (feederModal) feederModal.style.display = 'flex';
            });
        }

        const editorAddReactorBtn = document.getElementById('btn-editor-add-reactor');
        if (editorAddReactorBtn && !editorAddReactorBtn.dataset.bound) {
            editorAddReactorBtn.dataset.bound = "true";
            editorAddReactorBtn.addEventListener('click', () => {
                populateModalTrafoSelects(['new-reactor-trafo', 'new-reactor-alt-trafo']);
                const reactorModal = document.getElementById('add-reactor-modal');
                if (reactorModal) reactorModal.style.display = 'flex';
            });
        }

        // Vazgeç / Çık Butonu
        const btnEditorCancel = document.getElementById('btn-editor-cancel');
        if (btnEditorCancel && !btnEditorCancel.dataset.bound) {
            btnEditorCancel.dataset.bound = "true";
            btnEditorCancel.addEventListener('click', () => {
                _pendingAdditions = { transformers: [], feeders: [], reactors: [] };
                _pendingPositionUpdates = {};
                _isEditMode = false;
                if (editorToolbar) editorToolbar.style.display = 'none';
                if (txtEditMode) txtEditMode.textContent = 'Düzenleme Modu';
                btnToggleEdit.style.background = '';
                btnToggleEdit.style.borderColor = '';
                App.showToast("Düzenleme iptal edildi ve değişiklikler sıfırlandı.", "info");
                if (_cachedAssets) drawManevraTopology(_cachedAssets);
            });
        }

        // Toplu Kaydet Onay Modalı
        const btnSaveConfirm = document.getElementById('btn-editor-save-confirm');
        const saveModal = document.getElementById('topology-save-confirm-modal');
        const closeSaveModal = document.getElementById('btn-close-topology-save');
        const cancelSaveModal = document.getElementById('btn-topology-save-cancel');
        const execSaveModal = document.getElementById('btn-topology-save-execute');
        const summaryBody = document.getElementById('topology-save-summary-body');

        if (btnSaveConfirm && saveModal && !btnSaveConfirm.dataset.bound) {
            btnSaveConfirm.dataset.bound = "true";
            btnSaveConfirm.addEventListener('click', () => {
                const addTCount = _pendingAdditions.transformers.length;
                const addFCount = _pendingAdditions.feeders.length;
                const addRCount = _pendingAdditions.reactors.length;
                const posUpdatesList = Object.values(_pendingPositionUpdates);
                const posCount = posUpdatesList.length;

                if (addTCount === 0 && addFCount === 0 && addRCount === 0 && posCount === 0) {
                    App.showToast("Kaydedilecek herhangi bir değişiklik yapılmadı.", "warning");
                    return;
                }

                if (summaryBody) {
                    summaryBody.innerHTML = `
                        <div style="background: rgba(15, 23, 42, 0.4); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 16px;">
                            <h4 style="margin: 0 0 8px 0; color: var(--text-primary); font-size: 14px;">Yapılan Değişiklikler Özet Listesi:</h4>
                            <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6;">
                                ${addTCount > 0 ? `<li><b style="color: var(--color-success);">${addTCount} Yeni Trafo:</b> ${App.escapeHTML(_pendingAdditions.transformers.map(t => t.name).join(', '))}</li>` : ''}
                                ${addFCount > 0 ? `<li><b style="color: var(--color-success);">${addFCount} Yeni Fider:</b> ${App.escapeHTML(_pendingAdditions.feeders.map(f => f.name).join(', '))}</li>` : ''}
                                ${addRCount > 0 ? `<li><b style="color: var(--color-success);">${addRCount} Yeni Reaktör:</b> ${App.escapeHTML(_pendingAdditions.reactors.map(r => r.name).join(', '))}</li>` : ''}
                                ${posCount > 0 ? `<li><b style="color: var(--color-primary);">${posCount} Varlığın Konumu / Bağlantısı Güncellendi:</b> ${App.escapeHTML(posUpdatesList.map(u => u.id).join(', '))}</li>` : ''}
                            </ul>
                        </div>
                        <p style="margin: 0; color: var(--text-secondary); font-size: 12px;">Bu değişiklikleri onayladığınızda tüm yeni nesneler ve görsel düzenleme verileri kalıcı olarak kaydedilecektir.</p>
                    `;
                }

                saveModal.style.display = 'flex';
            });

            closeSaveModal?.addEventListener('click', () => { saveModal.style.display = 'none'; });
            cancelSaveModal?.addEventListener('click', () => { saveModal.style.display = 'none'; });
            saveModal.addEventListener('click', (e) => { if (e.target === saveModal) saveModal.style.display = 'none'; });

            execSaveModal?.addEventListener('click', async () => {
                const bulkPayload = {
                    new_transformers: _pendingAdditions.transformers,
                    new_feeders: _pendingAdditions.feeders,
                    new_reactors: _pendingAdditions.reactors,
                    updated_assets: Object.values(_pendingPositionUpdates)
                };
                try {
                    execSaveModal.disabled = true;
                    execSaveModal.textContent = 'Kaydediliyor...';
                    const res = await ApiClient.bulkUpdateTopology(bulkPayload);
                    App.showToast(res.message || "Topoloji başarıyla kaydedildi!", "success");
                    saveModal.style.display = 'none';
                    _pendingAdditions = { transformers: [], feeders: [], reactors: [] };
                    _pendingPositionUpdates = {};
                    _isEditMode = false;
                    if (editorToolbar) editorToolbar.style.display = 'none';
                    if (txtEditMode) txtEditMode.textContent = 'Düzenleme Modu';
                    btnToggleEdit.style.background = '';
                    btnToggleEdit.style.borderColor = '';
                    _cachedAssets = null;
                    await loadManevraAssets();
                    await loadManevraSummaryStats();
                } catch (err) {
                    App.showToast("Kaydetme hatası: " + err.message, "error");
                } finally {
                    execSaveModal.disabled = false;
                    execSaveModal.textContent = 'Değişiklikleri Onayla ve Kaydet';
                }
            });
        }
    }

    async function populateModalTrafoSelects(selectIds) {
        try {
            const data = _cachedAssets || await ApiClient.fetchManeuverAssets();
            const trafolar = data.transformers || await ApiClient.fetchTransformers();
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
