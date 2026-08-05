/**
 * SPARK - Teknik SCADA Tek Hat Şeması (SLD) UI Modülü
 * scada_sld.js
 * 
 * Özellikler:
 * - Backend API & WebSocket Canlı Telemetri Entegrasyonu
 * - Operatör Manevra Onay Mekanizması (Güvenlik Modalı)
 * - Manevraların Veritabanına (ManeuverLog) Kaydedilmesi
 */
const ScadaSldUI = (() => {
    'use strict';

    let ws = null;
    let pendingManeuver = null;

    // SCADA UI State (Initial state populated from Backend)
    const state = {
        activeTab: 'R22kV',
        selectedBolge: 'Ümraniye',
        telemetry: {},
        breakers: {
            "t101-q1": true,
            "t102-q1": true,
            "f1": true, "f2": true, "f3": true, "f4": true, "f5": true, "f6": true, "f7": false
        },
        alarms: []
    };

    let trafolarByBolge = {};

    async function init() {
        bindEvents();
        // Trafo listesini bölgeye göre grupla
        if (typeof VeriModulu !== 'undefined') {
            const trafolar = VeriModulu.getTrafolar();
            if (trafolar) {
                trafolarByBolge = {};
                trafolar.forEach(t => {
                    const bolge = t.bolge || 'Diğer';
                    if (!trafolarByBolge[bolge]) trafolarByBolge[bolge] = [];
                    trafolarByBolge[bolge].push(t);
                });

                const selector = document.getElementById('scada-tm-selector');
                if (selector) {
                    selector.innerHTML = '';
                    Object.keys(trafolarByBolge).forEach(bolge => {
                        const opt = document.createElement('option');
                        opt.value = bolge;
                        opt.textContent = bolge + ' TM';
                        selector.appendChild(opt);
                    });
                    
                    selector.addEventListener('change', (e) => {
                        state.selectedBolge = e.target.value;
                        updateTrafolarForBolge(e.target.value);
                    });

                    if (Object.keys(trafolarByBolge).length > 0) {
                        state.selectedBolge = Object.keys(trafolarByBolge)[0];
                        updateTrafolarForBolge(state.selectedBolge);
                    }
                }
            }
        }
        
        bindModalEvents();
        await fetchInitialState();
        connectWebSocket();
        render();
        
    }

    async function fetchInitialState() {
        try {
            if (typeof ApiClient !== 'undefined' && ApiClient.fetchScadaState) {
                const data = await ApiClient.fetchScadaState();
                if (data) {
                    applySnapshot(data);
                }
            }
        } catch (e) {
            console.warn('[ScadaSldUI] İlk SCADA durumu alınamadı:', e);
        }
    }

    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Backend sunucusu 8000 portunda çalıştığı için oraya bağlanıyoruz
        const wsUrl = `${protocol}//127.0.0.1:8000/ws`;
        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('[ScadaSldUI] Live SCADA WebSocket bağlantısı kuruldu.');
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'scada_telemetry' && msg.data) {
                        applySnapshot(msg.data);
                    }
                } catch (e) {
                    console.error('[ScadaSldUI] WS Ayrıştırma Hatası:', e);
                }
            };

            ws.onclose = () => {
                console.warn('[ScadaSldUI] WS bağlantısı kapandı, 3s sonra tekrar denenecek...');
                setTimeout(connectWebSocket, 3000);
            };

            ws.onerror = (err) => {
                console.error('[ScadaSldUI] WS Hatası:', err);
                ws.close();
            };
        } catch (e) {
            console.error('[ScadaSldUI] WS Bağlantı Hatası:', e);
        }
    }

    function applySnapshot(snapshot) {
        if (snapshot.telemetry) {
            state.telemetry = snapshot.telemetry;
        }
        if (snapshot.breakers) {
            state.breakers = snapshot.breakers;
        }
        if (snapshot.alarms) {
            state.alarms = snapshot.alarms;
        }
        render();
    }

    function updateTrafolarForBolge(bolge) {
        const trafolar = trafolarByBolge[bolge] || [];
        const title1 = document.getElementById('sld-t101-title');
        const title2 = document.getElementById('sld-t102-title');
        
        if (title1) title1.textContent = trafolar.length >= 1 ? trafolar[0].adi : 'Trafo 1 (Yok)';
        if (title2) title2.textContent = trafolar.length >= 2 ? trafolar[1].adi : 'Trafo 2 (Yok)';

        const b1 = document.getElementById('sld-t101-q1');
        if (b1) {
            b1.dataset.breaker = trafolar.length >= 1 ? `${trafolar[0].id.toLowerCase()}-q1` : 't101-q1';
        }
        const b2 = document.getElementById('sld-t102-q1');
        if (b2) {
            b2.dataset.breaker = trafolar.length >= 2 ? `${trafolar[1].id.toLowerCase()}-q1` : 't102-q1';
        }

        render();
    }

    function bindEvents() {
        const container = document.getElementById('screen-scada-sld');
        if (!container) return;

        const toggleSimBtn = document.getElementById('btn-sld-toggle-sim');
        if (toggleSimBtn) {
            toggleSimBtn.addEventListener('click', () => {
                const isPaused = toggleSimBtn.textContent.includes('DURAKLATILDI');
                if (isPaused) {
                    toggleSimBtn.textContent = 'Canlı Akış: AKTİF';
                    toggleSimBtn.style.background = '#3b82f6';
                    document.querySelectorAll('.sld-line-vert, .sld-line-horiz, .scada-busbar, .pulse-dot, .live-dot').forEach(el => {
                        el.style.animationPlayState = 'running';
                    });
                    showToast('▶️ Canlı akış simülasyonu devam ediyor.', 'success');
                } else {
                    toggleSimBtn.textContent = 'Canlı Akış: DURAKLATILDI';
                    toggleSimBtn.style.background = '#64748b';
                    document.querySelectorAll('.sld-line-vert, .sld-line-horiz, .scada-busbar, .pulse-dot, .live-dot').forEach(el => {
                        el.style.animationPlayState = 'paused';
                    });
                    showToast('⏸️ Canlı akış simülasyonu duraklatıldı.', 'info');
                }
            });
        }

        // Kesici, Ayırıcı ve Etiket Tıklamaları
        container.addEventListener('click', (e) => {
            // Eğer kuplaj veya fider yazılarına (butonlarına) tıklandıysa:
            const bayBtn = e.target.closest('.bay-btn-label');
            if (bayBtn) {
                showToast("⚠️ Bu fider/kuplaj detayları şu anda bakım modundadır.", "info");
                return;
            }

            // Eğer ayırıcıya (sarı baklava) veya ayırıcı sembollerine tıklandıysa:
            const disconnector = e.target.closest('.disconnector-diamond');
            if (disconnector) {
                showToast("⚠️ Ayırıcı ve Topraklama manevraları saha güvenliği sebebiyle SCADA'dan kilitlenmiştir. Lokal kumanda gerektirir.", "error");
                return;
            }

            // Eğer kesiciye (sarı kare) veya grubuna (yazılar dahil) tıklandıysa:
            const breakerTarget = e.target.closest('.breaker-box, .disconnector-group');
            if (breakerTarget) {
                let id = breakerTarget.dataset.breaker;
                
                // Eğer grup div'ine tıklandıysa, içindeki breaker'ı bul
                if (!id) {
                    const col = breakerTarget.closest('.feeder-column, .disconnector-group, .transformer-bay');
                    const bBox = col?.querySelector('[data-breaker]');
                    if (bBox) id = bBox.dataset.breaker;
                }
                
                if (id) {
                    requestBreakerToggle(id);
                    return;
                }
            }

            const tabBtn = e.target.closest('.scada-tab-btn');
            if (tabBtn) {
                const tab = tabBtn.dataset.tab;
                switchTab(tab);
                return;
            }

            const epsItem = e.target.closest('.sld-eps-item');
            if (epsItem) {
                const alarmId = epsItem.dataset.alarmId;
                ackAlarm(alarmId);
                return;
            }
        });
    }

    function bindModalEvents() {
        const modal = document.getElementById('scada-confirm-breaker-modal');
        const btnClose = document.getElementById('btn-close-scada-confirm');
        const btnCancel = document.getElementById('btn-cancel-scada-confirm');
        const btnExecute = document.getElementById('btn-execute-scada-confirm');

        const closeModal = () => {
            if (modal) modal.style.display = 'none';
            pendingManeuver = null;
        };

        if (btnClose) btnClose.onclick = closeModal;
        if (btnCancel) btnCancel.onclick = closeModal;

        if (btnExecute) {
            btnExecute.onclick = async () => {
                if (!pendingManeuver) return;
                
                const reasonInput = document.getElementById('scada-confirm-reason');
                const reason = reasonInput ? reasonInput.value : '';

                const { breakerId, targetState, trafoId } = pendingManeuver;
                closeModal();

                try {
                    btnExecute.disabled = true;
                    btnExecute.textContent = 'İşleniyor...';

                    const res = await ApiClient.toggleScadaBreaker(breakerId, targetState, trafoId, reason);
                    if (res && res.success) {
                        showToast(`✅ ${res.message}`, 'success');
                    } else {
                        showToast(`❌ Manevra başarısız oldu.`, 'error');
                    }
                } catch (err) {
                    console.error('[ScadaSldUI] Manevra Hatası:', err);
                    showToast(`❌ Hata: ${err.message}`, 'error');
                } finally {
                    btnExecute.disabled = false;
                    btnExecute.textContent = 'Manevrayı Uygula ve Kaydet';
                }
            };
        }
    }

    function requestBreakerToggle(breakerId) {
        const currentState = state.breakers[breakerId] !== false; // default true if undefined
        const targetState = !currentState;
        
        const trafolar = trafolarByBolge[state.selectedBolge] || [];
        let targetTrafo = trafolar.find(t => breakerId.startsWith(t.id.toLowerCase()));
        if (!targetTrafo && trafolar.length > 0) {
            targetTrafo = trafolar[0];
        }
        const trafoId = targetTrafo ? targetTrafo.id : 'UMR-TRA';
        const trafoName = targetTrafo ? targetTrafo.adi : 'Trafo';

        const actionStr = targetState ? '<strong style="color:#22c55e;">KAPATMA (Enerji Verme)</strong>' : '<strong style="color:#ef4444;">AÇMA (Enerji Kesme)</strong>';
        
        pendingManeuver = { breakerId, targetState, trafoId };

        const modal = document.getElementById('scada-confirm-breaker-modal');
        const confirmText = document.getElementById('scada-confirm-text');
        const reasonInput = document.getElementById('scada-confirm-reason');

        if (confirmText) {
            confirmText.innerHTML = `<strong>${App.escapeHTML(trafoName)}</strong> bünyesindeki <strong>Kesici ${App.escapeHTML(breakerId).toUpperCase()}</strong> için ${actionStr} manevrası uygulamak istediğinize emin misiniz?<br><br><small style="color:#94a3b8;">Bu işlem sunucuya gönderilecek, şebeke durumunu değiştirecek ve manevra loglarına kaydedilecektir.</small>`;
        }
        if (reasonInput) reasonInput.value = '';

        if (modal) {
            modal.style.display = 'flex';
        }
    }

    async function ackAlarm(alarmId) {
        try {
            const res = await ApiClient.ackScadaAlarm(alarmId);
            if (res && res.success) {
                showToast(`🔔 Alarm durumu güncellendi.`, 'info');
            }
        } catch (err) {
            console.error('[ScadaSldUI] Alarm Onaylama Hatası:', err);
        }
    }

    function switchTab(tab) {
        state.activeTab = tab;
        document.querySelectorAll('.scada-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        if (tab === 'R110kV') {
            showToast("🔍 154kV İletim Barası görünümüne odaklanıldı.", "info");
            const topHeader = document.querySelector('.bay-header');
            if (topHeader) topHeader.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            showToast("🔍 34.5kV Dağıtım Barası ve Fiderler görünümüne odaklanıldı.", "info");
            const busbar = document.querySelector('.scada-busbar');
            if (busbar) busbar.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function showToast(message, type = 'info') {
        if (window.showToast) {
            window.showToast(message, type);
            return;
        }
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toast.style.background = type === 'success' ? '#15803d' : type === 'error' ? '#b91c1c' : '#1d4ed8';
        toast.style.color = '#fff';
        toast.style.padding = '10px 16px';
        toast.style.borderRadius = '6px';
        toast.style.marginTop = '8px';
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    function updateTelemetryUI() {
        const trafolar = trafolarByBolge[state.selectedBolge] || [];
        
        const trafo1 = trafolar.length >= 1 ? state.telemetry[trafolar[0].id] : null;
        const trafo2 = trafolar.length >= 2 ? state.telemetry[trafolar[1].id] : null;

        // Trafo 1 Readouts
        const t1Kw = document.getElementById('sld-t101-kw');
        const t1Kvar = document.getElementById('sld-t101-kvar');
        const t1Kv = document.getElementById('sld-t101-kv');
        const t1A = document.getElementById('sld-t101-a');

        if (trafo1) {
            if (t1Kw) t1Kw.textContent = `${trafo1.kw.toFixed(1)} kW`;
            if (t1Kvar) t1Kvar.textContent = `${trafo1.kvar.toFixed(1)} kVAr`;
            if (t1Kv) t1Kv.textContent = `${trafo1.kv.toFixed(1)} kV`;
            if (t1A) t1A.textContent = `${trafo1.a.toFixed(1)} A`;
        } else {
            if (t1Kw) t1Kw.textContent = `0.0 kW`;
            if (t1Kvar) t1Kvar.textContent = `0.0 kVAr`;
            if (t1Kv) t1Kv.textContent = `22.8 kV`;
            if (t1A) t1A.textContent = `0.0 A`;
        }

        // Trafo 2 Readouts
        const t2Kw = document.getElementById('sld-t102-kw');
        const t2Kvar = document.getElementById('sld-t102-kvar');
        const t2Kv = document.getElementById('sld-t102-kv');
        const t2A = document.getElementById('sld-t102-a');

        if (trafo2) {
            if (t2Kw) t2Kw.textContent = `${trafo2.kw.toFixed(1)} kW`;
            if (t2Kvar) t2Kvar.textContent = `${trafo2.kvar.toFixed(1)} kVAr`;
            if (t2Kv) t2Kv.textContent = `${trafo2.kv.toFixed(1)} kV`;
            if (t2A) t2A.textContent = `${trafo2.a.toFixed(1)} A`;
        } else {
            if (t2Kw) t2Kw.textContent = `0.0 kW`;
            if (t2Kvar) t2Kvar.textContent = `0.0 kVAr`;
            if (t2Kv) t2Kv.textContent = `22.8 kV`;
            if (t2A) t2A.textContent = `0.0 A`;
        }

        // Feeders (Proportional calculation based on active transformer telemetry)
        const activeA1 = trafo1 ? trafo1.a : 0;
        const activeA2 = trafo2 ? trafo2.a : 0;

        const f1 = document.getElementById('sld-f1-a');
        const f2 = document.getElementById('sld-f2-a');
        const f4 = document.getElementById('sld-f4-a');
        const f5 = document.getElementById('sld-f5-a');
        const f6 = document.getElementById('sld-f6-a');

        if (f1) f1.textContent = `${(activeA1 * 0.25).toFixed(1)} A`;
        if (f2) f2.textContent = `${(activeA1 * 0.35).toFixed(1)} A`;
        if (f4) f4.textContent = `${(activeA1 * 0.40).toFixed(1)} A`;
        if (f5) f5.textContent = `${(activeA2 * 0.45).toFixed(1)} A`;
        if (f6) f6.textContent = `${(activeA2 * 0.55).toFixed(1)} A`;
    }

    function renderAlarms() {
        const listEl = document.getElementById('sld-eps-list');
        if (!listEl) return;

        listEl.innerHTML = state.alarms.map(alarm => `
            <div class="sld-eps-item ${alarm.active ? 'active' : ''}" data-alarm-id="${alarm.id}">
                <div class="sld-eps-checkbox"></div>
                <span>${alarm.label}</span>
            </div>
        `).join('');
    }

    function renderBreakers() {
        // Tüm kesicileri (breaker-box) ve ayırıcıları (disconnector-diamond) duruma göre güncelle
        document.querySelectorAll('[data-breaker]').forEach(bBox => {
            const id = bBox.dataset.breaker;
            const isClosed = state.breakers[id] !== false; // Varsayılan kapalı (enerjili)
            
            bBox.classList.toggle('open', !isClosed);
            
            // Aynı fider sütunu veya disconnector grubundaki ayırıcı elmasını da görsel güncelle
            const col = bBox.closest('.feeder-column, .transformer-bay');
            if (col) {
                col.querySelectorAll('.disconnector-diamond').forEach(d => {
                    d.classList.toggle('open', !isClosed);
                });
            }
        });
    }

    function render() {
        renderBreakers();
        renderAlarms();
        updateTelemetryUI();
    }

    return {
        init,
        render
    };
})();
